using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Pointage.Web;

public class NatureAbsenceEntite
{
    public string PnaCode { get; set; } = "";
    public string PnaLibelle { get; set; } = "";
    public string? PnaCodePaie { get; set; }
    public string? PnaCouleur { get; set; }
    public int PnaOrdre { get; set; }
    public bool PnaActif { get; set; } = true;
}

public class CongeEntite
{
    public long PcoId { get; set; }
    public int PcoSalId { get; set; }
    public DateOnly PcoDu { get; set; }
    public DateOnly PcoAu { get; set; }
    public bool PcoDebutMidi { get; set; }
    public bool PcoFinMidi { get; set; }
    public string? PcoCommentaire { get; set; }
    public string PcoEtat { get; set; } = "DEMANDE";
    public string? PcoNature { get; set; }
    public string PcoDemandePar { get; set; } = "";
    public DateTimeOffset PcoDemandeLe { get; set; } = DateTimeOffset.UtcNow;
    public string? PcoTraitePar { get; set; }
    public DateTimeOffset? PcoTraiteLe { get; set; }
    public string? PcoReponse { get; set; }
    public long? PcoTacId { get; set; }
    public int PcoVersion { get; set; } = 1;
}

public sealed record NatureAbsenceDto(string Code, string Libelle, string? CodePaie, string? Couleur, int Ordre, bool Actif);
/// <summary>Demande saisie : salarié, période, demi-journées aux bornes, commentaire ; le RH peut la valider d'office (nature).</summary>
public sealed record CongeSaisi(int Salarie, DateOnly Du, DateOnly Au, bool DebutMidi, bool FinMidi, string? Commentaire, int? Version = null,
    string? Nature = null, bool Valider = false);
public sealed record TraitementConge(int? Version, string? Nature, string? Reponse);
/// <summary>Jour d'absence d'un salarié (jours travaillés seulement) : part 1 ou 0,5, congé, état, nature.</summary>
public sealed record JourAbsence(int Salarie, DateOnly Date, decimal Part, long Conge, string Etat, string? Nature);

/// <summary>
/// Demandes de congés et absences : le salarié ou le responsable de son service demande une période avec un commentaire
/// (sans nature) ; le service RH valide en affectant la nature (liste modifiable <c>poi_nature_absence</c>) ou refuse ;
/// annulation par le demandeur (demande) ou le RH (congé validé). Règles <see cref="ReglesConges"/>. Les congés validés
/// comptent dans la synthèse et l'export de paie (<see cref="AbsencesAsync"/>) ; l'application en est avertie
/// (<see cref="SpecialisationPointage.ApresCongeAsync"/> : planning, tâche au RH).
/// </summary>
public sealed class ServiceConges(PointageDbContext db, SpecialisationPointage specialisation, ServicePointage pointage, IServiceProvider services)
{
    private async Task<bool> RhAsync(Utilisateur u, CancellationToken ct) => u.EstAdmin || await specialisation.EstRhAsync(db, u, ct);

    private async Task Rh(Utilisateur u, CancellationToken ct)
    {
        if (!await RhAsync(u, ct)) throw ExceptionMetier.AccesRefuse("VALIDER_CONGES");
    }

    public async Task<List<NatureAbsenceDto>> NaturesAsync(CancellationToken ct) =>
        await db.NaturesAbsence.AsNoTracking().OrderBy(n => n.PnaOrdre).ThenBy(n => n.PnaCode)
            .Select(n => new NatureAbsenceDto(n.PnaCode, n.PnaLibelle, n.PnaCodePaie, n.PnaCouleur, n.PnaOrdre, n.PnaActif)).ToListAsync(ct);

    /// <summary>Natures (RH ou administrateur) : une nature retirée déjà affectée devient inactive.</summary>
    public async Task<List<NatureAbsenceDto>> EnregistrerNaturesAsync(List<NatureAbsenceDto> l, Utilisateur u, CancellationToken ct)
    {
        await Rh(u, ct);
        if (l.Any(n => string.IsNullOrWhiteSpace(n.Code) || n.Code.Trim().Length > 20 || string.IsNullOrWhiteSpace(n.Libelle))
            || l.Select(n => n.Code.Trim().ToUpperInvariant()).Distinct().Count() != l.Count)
            throw ExceptionMetier.Invalide("CNG_NATURES", "Natures : code (20 caractères au plus, unique) et libellé obligatoires");
        var existantes = await db.NaturesAbsence.ToDictionaryAsync(n => n.PnaCode, ct);
        var codes = l.Select(n => n.Code.Trim().ToUpperInvariant()).ToHashSet();
        var utilisees = (await db.Conges.Where(c => c.PcoNature != null).Select(c => c.PcoNature!).Distinct().ToListAsync(ct)).ToHashSet();
        foreach (var (code, e) in existantes.Where(x => !codes.Contains(x.Key)))
        {
            if (utilisees.Contains(code)) e.PnaActif = false;
            else db.NaturesAbsence.Remove(e);
        }
        foreach (var n in l)
        {
            var code = n.Code.Trim().ToUpperInvariant();
            if (!existantes.TryGetValue(code, out var e)) db.NaturesAbsence.Add(e = new NatureAbsenceEntite { PnaCode = code });
            e.PnaLibelle = n.Libelle.Trim();
            e.PnaCodePaie = string.IsNullOrWhiteSpace(n.CodePaie) ? null : n.CodePaie.Trim();
            e.PnaCouleur = string.IsNullOrWhiteSpace(n.Couleur) ? null : n.Couleur.Trim();
            e.PnaOrdre = n.Ordre;
            e.PnaActif = n.Actif;
        }
        await db.SaveChangesAsync(ct);
        return await NaturesAsync(ct);
    }

    /// <summary>Jours travaillés d'une période par salarié (semaine par semaine, jours de la spécialisation).</summary>
    internal async Task<Dictionary<int, HashSet<string>>> JoursTravaillesAsync(IReadOnlyCollection<int> salaries, DateOnly du, DateOnly au, CancellationToken ct)
    {
        var r = salaries.ToDictionary(s => s, _ => new HashSet<string>(StringComparer.Ordinal));
        for (var lundi = ReglesPointage.LundiDe(du); lundi <= au; lundi = lundi.AddDays(7))
        {
            foreach (var (s, jours) in await specialisation.JoursTravaillesAsync(db, salaries, lundi, ct))
            {
                if (r.TryGetValue(s, out var e)) e.UnionWith(jours.Where(j => j >= du && j <= au).Select(j => j.ToString("yyyy-MM-dd")));
            }
        }
        return r;
    }

    private static CongePeriode Periode(CongeEntite c) =>
        new(c.PcoId, c.PcoDu.ToString("yyyy-MM-dd"), c.PcoAu.ToString("yyyy-MM-dd"), c.PcoDebutMidi, c.PcoFinMidi, c.PcoEtat);

    /// <summary>
    /// Jours d'absence des congés demandés ou validés couvrant la période (jours travaillés seulement, bornés à la
    /// période) : synthèse et export de paie.
    /// </summary>
    public async Task<List<JourAbsence>> AbsencesAsync(IReadOnlyCollection<int> salaries, DateOnly du, DateOnly au, CancellationToken ct)
    {
        var conges = await db.Conges.AsNoTracking().Where(c => salaries.Contains(c.PcoSalId) && (c.PcoEtat == "DEMANDE" || c.PcoEtat == "VALIDE")
            && c.PcoDu <= au && c.PcoAu >= du).ToListAsync(ct);
        if (conges.Count == 0) return [];
        var travailles = await JoursTravaillesAsync(conges.Select(c => c.PcoSalId).Distinct().ToList(), du, au, ct);
        return conges.SelectMany(c => ReglesConges.Jours(Periode(c), travailles[c.PcoSalId])
            .Select(j => new JourAbsence(c.PcoSalId, DateOnly.ParseExact(j.Date, "yyyy-MM-dd"), j.Part, c.PcoId, c.PcoEtat, c.PcoNature))).ToList();
    }

    /// <summary>
    /// Congés d'une période : RH (toute la société), sinon les salariés dont l'utilisateur est le responsable de service
    /// et les siens ; filtres salarié, service, état.
    /// </summary>
    public async Task<object> CongesAsync(DateOnly? du, DateOnly? au, int? salarie, int? service, string? etat, string? recherche, Utilisateur u, CancellationToken ct)
    {
        var rh = await RhAsync(u, ct);
        var moi = await specialisation.SalarieDeAsync(db, u, ct);
        List<SalariePointage> salaries;
        if (salarie is int id) salaries = [await pointage.SalarieAsync(id, u, ct)];
        else
        {
            salaries = await specialisation.SalariesAsync(db, new FiltreSalaries(service, recherche, null, 100000), ct);
            if (!rh)
            {
                var chef = await specialisation.ChefDeAsync(db, u, salaries.Select(s => s.Id).ToList(), ct);
                salaries = salaries.Where(s => chef.Contains(s.Id) || s.Id == moi).ToList();
            }
        }
        var ids = salaries.Select(s => s.Id).ToList();
        var q = db.Conges.AsNoTracking().Where(c => ids.Contains(c.PcoSalId));
        if (du is DateOnly d) q = q.Where(c => c.PcoAu >= d);
        if (au is DateOnly a) q = q.Where(c => c.PcoDu <= a);
        if (!string.IsNullOrEmpty(etat)) q = q.Where(c => c.PcoEtat == etat);
        var conges = await q.OrderBy(c => c.PcoDu).ThenBy(c => c.PcoId).Take(2000).ToListAsync(ct);
        var parId = salaries.ToDictionary(s => s.Id);
        var lignes = new List<object>();
        if (conges.Count > 0)
        {
            var travailles = await JoursTravaillesAsync(conges.Select(c => c.PcoSalId).Distinct().ToList(), conges.Min(c => c.PcoDu), conges.Max(c => c.PcoAu), ct);
            lignes.AddRange(conges.Select(c => Ligne(c, parId[c.PcoSalId], ReglesConges.Total(ReglesConges.Jours(Periode(c), travailles[c.PcoSalId])))));
        }
        return new { rh, moi, natures = await NaturesAsync(ct), conges = lignes };
    }

    private static object Ligne(CongeEntite c, SalariePointage s, decimal jours) => new
    {
        id = c.PcoId, salarie = c.PcoSalId, nom = s.Nom, prenom = s.Prenom, matricule = s.Matricule, service = s.Service, srv_id = s.SrvId,
        du = c.PcoDu, au = c.PcoAu, debut_midi = c.PcoDebutMidi, fin_midi = c.PcoFinMidi, commentaire = c.PcoCommentaire, etat = c.PcoEtat, nature = c.PcoNature,
        demande_par = c.PcoDemandePar, demande_le = c.PcoDemandeLe, traite_par = c.PcoTraitePar, traite_le = c.PcoTraiteLe, reponse = c.PcoReponse,
        tac_id = c.PcoTacId, version = c.PcoVersion, jours,
    };

    private async Task<object> LigneAsync(CongeEntite c, SalariePointage s, CancellationToken ct)
    {
        var travailles = await JoursTravaillesAsync([c.PcoSalId], c.PcoDu, c.PcoAu, ct);
        return Ligne(c, s, ReglesConges.Total(ReglesConges.Jours(Periode(c), travailles[c.PcoSalId])));
    }

    private async Task ControlerAsync(CongeEntite c, CancellationToken ct)
    {
        var autres = await db.Conges.AsNoTracking().Where(x => x.PcoSalId == c.PcoSalId && x.PcoId != c.PcoId && x.PcoDu <= c.PcoAu && x.PcoAu >= c.PcoDu).ToListAsync(ct);
        var codes = ReglesConges.Controler(Periode(c) with { Id = c.PcoId == 0 ? null : c.PcoId }, autres.Select(Periode));
        if (codes.Count > 0) throw ExceptionMetier.Invalide(codes[0], string.Join(" · ", codes.Select(k => ReglesConges.Messages[k])), codes);
    }

    private async Task NatureActiveAsync(string? nature, CancellationToken ct)
    {
        if (nature is not null && !await db.NaturesAbsence.AnyAsync(n => n.PnaCode == nature && n.PnaActif, ct))
            throw ExceptionMetier.Invalide("CNG_NATURE", "Nature d'absence inconnue ou inactive");
    }

    private static void Traiter(CongeEntite c, string etat, string? nature, string? reponse, Utilisateur u)
    {
        c.PcoEtat = etat;
        if (nature is not null) c.PcoNature = nature;
        c.PcoTraitePar = u.Code;
        c.PcoTraiteLe = DateTimeOffset.UtcNow;
        c.PcoReponse = string.IsNullOrWhiteSpace(reponse) ? c.PcoReponse : reponse.Trim();
    }

    /// <summary>Nouvelle demande (qui peut saisir les pointages du salarié) ; le RH peut la valider d'office avec sa nature.</summary>
    public async Task<object> DemanderAsync(CongeSaisi d, Utilisateur u, CancellationToken ct)
    {
        var s = await pointage.SalarieAsync(d.Salarie, u, ct);
        var c = new CongeEntite { PcoSalId = d.Salarie, PcoDemandePar = u.Code };
        Remplir(c, d);
        await ControlerAsync(c, ct);
        if (d.Valider)
        {
            await Rh(u, ct);
            var codes = ReglesConges.ControlerTraitement("VALIDER", Periode(c), d.Nature);
            if (codes.Count > 0) throw ExceptionMetier.Invalide(codes[0], ReglesConges.Messages[codes[0]]);
            await NatureActiveAsync(d.Nature, ct);
            Traiter(c, "VALIDE", d.Nature, null, u);
        }
        db.Conges.Add(c);
        await db.SaveChangesAsync(ct);
        await specialisation.ApresCongeAsync(db, services, u, s, c, d.Valider ? "VALIDER" : "DEMANDER", ct);
        return await LigneAsync(c, s, ct);
    }

    private static void Remplir(CongeEntite c, CongeSaisi d)
    {
        c.PcoDu = d.Du;
        c.PcoAu = d.Au;
        c.PcoDebutMidi = d.DebutMidi;
        c.PcoFinMidi = d.FinMidi;
        c.PcoCommentaire = string.IsNullOrWhiteSpace(d.Commentaire) ? null : d.Commentaire.Trim();
    }

    private async Task<CongeEntite> CongeAsync(long id, int? version, CancellationToken ct)
    {
        var c = await db.Conges.FirstOrDefaultAsync(x => x.PcoId == id, ct) ?? throw ExceptionMetier.Introuvable($"Congé {id}");
        if (version is int v && v != c.PcoVersion) throw ExceptionMetier.Conflit("CNG_VERSION", "Le congé a été modifié entre-temps : le recharger");
        return c;
    }

    /// <summary>Modifie une demande (qui peut saisir, tant qu'elle est demandée) ; le RH modifie aussi un congé validé et sa nature.</summary>
    public async Task<object> ModifierAsync(long id, CongeSaisi d, Utilisateur u, CancellationToken ct)
    {
        var c = await CongeAsync(id, d.Version, ct);
        var s = await pointage.SalarieAsync(c.PcoSalId, u, ct);
        var rh = await RhAsync(u, ct);
        if (c.PcoEtat != "DEMANDE" && !(rh && c.PcoEtat == "VALIDE")) throw ExceptionMetier.Conflit("CNG_ETAT", ReglesConges.Messages["CNG_ETAT"]);
        Remplir(c, d);
        await ControlerAsync(c, ct);
        if (rh && c.PcoEtat == "VALIDE" && d.Nature is not null && d.Nature != c.PcoNature)
        {
            await NatureActiveAsync(d.Nature, ct);
            c.PcoNature = d.Nature;
        }
        c.PcoVersion++;
        await db.SaveChangesAsync(ct);
        await specialisation.ApresCongeAsync(db, services, u, s, c, "MODIFIER", ct);
        return await LigneAsync(c, s, ct);
    }

    /// <summary>VALIDER (RH, nature obligatoire), REFUSER (RH), ANNULER (demande : qui peut saisir ; congé validé : RH).</summary>
    public async Task<object> TraiterAsync(long id, string action, TraitementConge t, Utilisateur u, CancellationToken ct)
    {
        var c = await CongeAsync(id, t.Version, ct);
        var s = await pointage.SalarieAsync(c.PcoSalId, u, ct);
        if (action != "ANNULER" || c.PcoEtat == "VALIDE") await Rh(u, ct);
        var nature = action == "VALIDER" ? t.Nature : null;
        var codes = ReglesConges.ControlerTraitement(action, Periode(c), nature);
        if (codes.Count > 0) throw ExceptionMetier.Invalide(codes[0], string.Join(" · ", codes.Select(k => ReglesConges.Messages[k])), codes);
        await NatureActiveAsync(nature, ct);
        Traiter(c, action switch { "VALIDER" => "VALIDE", "REFUSER" => "REFUSE", _ => "ANNULE" }, nature, t.Reponse, u);
        c.PcoVersion++;
        await db.SaveChangesAsync(ct);
        await specialisation.ApresCongeAsync(db, services, u, s, c, action, ct);
        return await LigneAsync(c, s, ct);
    }
}
