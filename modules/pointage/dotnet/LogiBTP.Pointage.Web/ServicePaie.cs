using System.Globalization;
using System.Text;
using System.Text.Json;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Pointage.Web;

public class ProfilEntite
{
    public int PpfId { get; set; }
    public string PpfCode { get; set; } = "";
    public string PpfLibelle { get; set; } = "";
    public bool PpfExport { get; set; } = true;
    public int PpfOrdre { get; set; }
    public bool PpfActif { get; set; } = true;
}

public class RubriqueEntite
{
    public int RubId { get; set; }
    public int RubPpfId { get; set; }
    public string RubCode { get; set; } = "";
    public string RubLibelle { get; set; } = "";
    public string RubUnite { get; set; } = "H";
    public string RubSaisie { get; set; } = "C";
    public string? RubCodePaie { get; set; }
    public int RubOrdre { get; set; }
}

public class RegleEntite
{
    public int PrgId { get; set; }
    public int PrgPpfId { get; set; }
    public string PrgType { get; set; } = "";
    public string? PrgRubrique { get; set; }
    public string PrgParametres { get; set; } = "{}";
    public int PrgOrdre { get; set; }
    public bool PrgActif { get; set; } = true;
}

public class ValeurEntite
{
    public int PvaSalId { get; set; }
    public DateOnly PvaDate { get; set; }
    public string PvaRubrique { get; set; } = "";
    public int PvaValeur { get; set; }
    public string PvaPar { get; set; } = "";
    public DateTimeOffset PvaLe { get; set; } = DateTimeOffset.UtcNow;
}

public class ZoneEntite
{
    public int PzcChaId { get; set; }
    public string PzcAgence { get; set; } = "";
    public short PzcZone { get; set; }
    public string PzcValidePar { get; set; } = "";
    public DateTimeOffset PzcValideLe { get; set; } = DateTimeOffset.UtcNow;
}

public class ExportEntite
{
    public long PexId { get; set; }
    public DateOnly PexDu { get; set; }
    public DateOnly PexAu { get; set; }
    public int? PexService { get; set; }
    public int[] PexSalaries { get; set; } = [];
    public int PexLignes { get; set; }
    public string PexContenu { get; set; } = "";
    public string PexPar { get; set; } = "";
    public DateTimeOffset PexLe { get; set; } = DateTimeOffset.UtcNow;
}

public sealed record RubriqueDto(string Code, string Libelle, string Unite, string Saisie, string? CodePaie, int Ordre);
public sealed record RegleDto(string Type, string? Rubrique, JsonElement? Parametres, int Ordre, bool Actif = true);
public sealed record ProfilDto(int? Id, string Code, string Libelle, bool Export, int Ordre, bool Actif, List<RubriqueDto> Rubriques, List<RegleDto> Regles);
public sealed record ValeurSaisie(DateOnly Date, string Rubrique, int Valeur);
public sealed record ValeursSaisies(List<ValeurSaisie> Valeurs);
public sealed record ZoneSaisie(string Agence, int? Zone);
public sealed record DemandeExport(DateOnly Du, DateOnly Au, int? Service);
public sealed record TauxImporte(string Matricule, decimal Taux);
public sealed record DemandeValorisation(DateOnly Du, DateOnly Au, int? Service, string Mode, List<TauxImporte>? Taux);

/// <summary>
/// Paie (lot 3) : profils (rubriques, règles typées), variables d'une semaine (<see cref="ReglesPaie"/> sur les
/// pointages retenus, zones du chantier pour l'agence du salarié, saisies des rubriques), zones de déplacement, export
/// CSV des variables des jours validés par le RH (profils exportés), valorisation des heures.
/// </summary>
public sealed class ServicePaie(PointageDbContext db, SpecialisationPointage specialisation, ServicePointage pointage, ServiceSynthese synthese, ServiceConges conges)
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    private async Task Rh(Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin && !await specialisation.EstRhAsync(db, u, ct)) throw ExceptionMetier.AccesRefuse("PAIE");
    }

    private static ReglePaie Regle(RegleEntite r) =>
        new(r.PrgType, r.PrgRubrique, JsonSerializer.Deserialize<ParametresRegle>(r.PrgParametres, Json));

    public async Task<List<ProfilDto>> ProfilsAsync(CancellationToken ct)
    {
        var profils = await db.Profils.AsNoTracking().OrderBy(p => p.PpfOrdre).ThenBy(p => p.PpfCode).ToListAsync(ct);
        var rubriques = await db.Rubriques.AsNoTracking().OrderBy(r => r.RubOrdre).ThenBy(r => r.RubCode).ToListAsync(ct);
        var regles = await db.Regles.AsNoTracking().OrderBy(r => r.PrgOrdre).ThenBy(r => r.PrgId).ToListAsync(ct);
        return profils.Select(p => new ProfilDto(p.PpfId, p.PpfCode, p.PpfLibelle, p.PpfExport, p.PpfOrdre, p.PpfActif,
            rubriques.Where(r => r.RubPpfId == p.PpfId).Select(r => new RubriqueDto(r.RubCode, r.RubLibelle, r.RubUnite, r.RubSaisie, r.RubCodePaie, r.RubOrdre)).ToList(),
            regles.Where(r => r.PrgPpfId == p.PpfId).Select(r => new RegleDto(r.PrgType, r.PrgRubrique, JsonSerializer.Deserialize<JsonElement>(r.PrgParametres), r.PrgOrdre, r.PrgActif)).ToList()))
            .ToList();
    }

    /// <summary>Remplace les profils (administrateur) ; un profil retiré passe inactif (il peut être attribué).</summary>
    public async Task<List<ProfilDto>> EnregistrerProfilsAsync(List<ProfilDto> l, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        foreach (var p in l)
        {
            if (string.IsNullOrWhiteSpace(p.Code) || string.IsNullOrWhiteSpace(p.Libelle)) throw ExceptionMetier.Invalide("PRF_CODE", "Code et libellé du profil obligatoires");
            var e = ReglesPaie.ControlerProfil(p.Rubriques.Select(r => new RubriquePaie(r.Code.Trim().ToUpperInvariant(), r.Unite, r.Saisie)).ToList(),
                p.Regles.Select(r => new ReglePaie(r.Type, r.Rubrique?.Trim().ToUpperInvariant(),
                    r.Parametres is JsonElement j && j.ValueKind == JsonValueKind.Object ? j.Deserialize<ParametresRegle>(Json) : null)).ToList());
            if (e.Count > 0) throw ExceptionMetier.Invalide(e[0], $"Profil {p.Code} : {ReglesPaie.Messages[e[0]]}", e);
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var existants = await db.Profils.ToListAsync(ct);
        foreach (var p in l)
        {
            var code = p.Code.Trim().ToUpperInvariant();
            var e = existants.FirstOrDefault(x => x.PpfId == p.Id) ?? existants.FirstOrDefault(x => x.PpfCode == code);
            if (e is null) db.Profils.Add(e = new ProfilEntite { PpfCode = code });
            e.PpfLibelle = p.Libelle.Trim();
            e.PpfExport = p.Export;
            e.PpfOrdre = p.Ordre;
            e.PpfActif = p.Actif;
            await db.SaveChangesAsync(ct);
            await db.Rubriques.Where(r => r.RubPpfId == e.PpfId).ExecuteDeleteAsync(ct);
            await db.Regles.Where(r => r.PrgPpfId == e.PpfId).ExecuteDeleteAsync(ct);
            db.Rubriques.AddRange(p.Rubriques.Select(r => new RubriqueEntite
            {
                RubPpfId = e.PpfId, RubCode = r.Code.Trim().ToUpperInvariant(), RubLibelle = r.Libelle.Trim(), RubUnite = r.Unite, RubSaisie = r.Saisie,
                RubCodePaie = string.IsNullOrWhiteSpace(r.CodePaie) ? null : r.CodePaie.Trim(), RubOrdre = r.Ordre,
            }));
            db.Regles.AddRange(p.Regles.Select(r => new RegleEntite
            {
                PrgPpfId = e.PpfId, PrgType = r.Type, PrgRubrique = r.Rubrique?.Trim().ToUpperInvariant(),
                PrgParametres = r.Parametres is JsonElement j && j.ValueKind == JsonValueKind.Object ? j.GetRawText() : "{}", PrgOrdre = r.Ordre, PrgActif = r.Actif,
            }));
        }
        foreach (var e in existants.Where(x => l.All(p => p.Id != x.PpfId && p.Code.Trim().ToUpperInvariant() != x.PpfCode))) e.PpfActif = false;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await ProfilsAsync(ct);
    }

    /// <summary>Données de paie d'une période (semaines entières) pour des salariés, chargées en une fois.</summary>
    private sealed class Contexte
    {
        public required Dictionary<int, SalariePointage> Salaries { get; init; }
        public required Dictionary<int, (ProfilEntite Profil, List<RubriqueEntite> Rubriques, List<ReglePaie> Regles)> Profils { get; init; }
        public required List<PointageEntite> Retenus { get; init; }
        public required List<ValeurEntite> Valeurs { get; init; }
        public required Dictionary<(int, string), short> Zones { get; init; }
        public required Dictionary<int, ChantierPointage> Chantiers { get; init; }
        public required HashSet<(int, DateOnly)> ValidesRh { get; init; }
        public required HashSet<(int, DateOnly)> Repas { get; init; }
    }

    private async Task<Contexte> ContexteAsync(List<SalariePointage> salaries, DateOnly du, DateOnly au, bool suivre, CancellationToken ct)
    {
        var ids = salaries.Select(s => s.Id).ToList();
        var corrigees = (await db.Semaines.AsNoTracking().Where(x => ids.Contains(x.PsmSalId) && x.PsmLundi >= du && x.PsmLundi <= au)
            .Select(x => new { x.PsmSalId, x.PsmLundi }).ToListAsync(ct)).Select(x => (x.PsmSalId, x.PsmLundi)).ToHashSet();
        var q = db.Pointages.Where(p => ids.Contains(p.PoiSalId) && p.PoiDate >= du && p.PoiDate <= au);
        var tous = suivre ? await q.ToListAsync(ct) : await q.AsNoTracking().ToListAsync(ct);
        var retenus = tous.Where(p => p.PoiCouche == (corrigees.Contains((p.PoiSalId, ReglesPointage.LundiDe(p.PoiDate))) ? Couches.Valide : Couches.Saisie)).ToList();
        var profils = await db.Profils.AsNoTracking().ToListAsync(ct);
        var rubriques = await db.Rubriques.AsNoTracking().OrderBy(r => r.RubOrdre).ToListAsync(ct);
        var regles = await db.Regles.AsNoTracking().Where(r => r.PrgActif).OrderBy(r => r.PrgOrdre).ThenBy(r => r.PrgId).ToListAsync(ct);
        var chantiersIds = retenus.Select(p => p.PoiChaId).Distinct().ToList();
        var validations = await db.Validations.AsNoTracking().Where(v => ids.Contains(v.PvlSalId) && v.PvlAnnuleLe == null && v.PvlNiveau == "RH" && v.PvlDu <= au && v.PvlAu >= du)
            .ToListAsync(ct);
        var valides = new HashSet<(int, DateOnly)>();
        foreach (var v in validations)
        {
            for (var d = v.PvlDu; d <= v.PvlAu; d = d.AddDays(1)) valides.Add((v.PvlSalId, d));
        }
        return new Contexte
        {
            Salaries = salaries.ToDictionary(s => s.Id),
            Profils = profils.ToDictionary(p => p.PpfId, p => (p, rubriques.Where(r => r.RubPpfId == p.PpfId).ToList(), regles.Where(r => r.PrgPpfId == p.PpfId).Select(Regle).ToList())),
            Retenus = retenus,
            Valeurs = await db.Valeurs.AsNoTracking().Where(v => ids.Contains(v.PvaSalId) && v.PvaDate >= du && v.PvaDate <= au).ToListAsync(ct),
            Zones = (await db.Zones.AsNoTracking().Where(z => chantiersIds.Contains(z.PzcChaId)).ToListAsync(ct)).ToDictionary(z => (z.PzcChaId, z.PzcAgence), z => z.PzcZone),
            Chantiers = (await specialisation.ChantiersAsync(db, null, chantiersIds, ct)).ToDictionary(c => c.Id),
            ValidesRh = valides,
            Repas = (await db.Repas.AsNoTracking().Where(r => ids.Contains(r.PrpSalId) && r.PrpDate >= du && r.PrpDate <= au)
                .Select(r => new { r.PrpSalId, r.PrpDate }).ToListAsync(ct)).Select(r => (r.PrpSalId, r.PrpDate)).ToHashSet(),
        };
    }

    private static VariablesSemaine? Variables(Contexte c, int salarie, DateOnly lundi)
    {
        var s = c.Salaries[salarie];
        if (s.PpfId is not int ppf || !c.Profils.TryGetValue(ppf, out var p)) return null;
        var jours = Enumerable.Range(0, 7).Select(i => lundi.AddDays(i)).Select(d => new JourPaie(d.ToString("yyyy-MM-dd"),
            c.Retenus.Where(x => x.PoiSalId == salarie && x.PoiDate == d).Select(x => new PointagePaie(x.PoiMinutes, x.PoiSousType,
                c.Chantiers.TryGetValue(x.PoiChaId, out var ch) && ch.Interne || s.Agence is null ? null
                    : c.Zones.TryGetValue((x.PoiChaId, s.Agence), out var z) ? z : null)).ToList(),
            c.Valeurs.Where(v => v.PvaSalId == salarie && v.PvaDate == d).ToDictionary(v => v.PvaRubrique, v => v.PvaValeur), c.Repas.Contains((salarie, d)))).ToList();
        var complete = Enumerable.Range(0, 7).All(i => c.ValidesRh.Contains((salarie, lundi.AddDays(i)))) || lundi.AddDays(6) < DateOnly.FromDateTime(DateTime.Today);
        return ReglesPaie.Calculer(p.Rubriques.Select(r => new RubriquePaie(r.RubCode, r.RubUnite, r.RubSaisie)).ToList(), p.Regles, jours, complete, s.Agence);
    }

    /// <summary>Variables d'une semaine d'un salarié, saisies des rubriques, zones des chantiers de la semaine.</summary>
    public async Task<object> VariablesAsync(int salarie, DateOnly lundi, Utilisateur u, CancellationToken ct)
    {
        lundi = ReglesPointage.LundiDe(lundi);
        var (s, _) = await synthese.AccesAsync(salarie, u, ct);
        var c = await ContexteAsync([s], lundi, lundi.AddDays(6), false, ct);
        var profil = s.PpfId is int ppf && c.Profils.TryGetValue(ppf, out var p) ? p : default;
        return new
        {
            profil = profil.Profil is null ? null : new { code = profil.Profil.PpfCode, libelle = profil.Profil.PpfLibelle, export = profil.Profil.PpfExport },
            rubriques = profil.Rubriques?.Select(r => new RubriqueDto(r.RubCode, r.RubLibelle, r.RubUnite, r.RubSaisie, r.RubCodePaie, r.RubOrdre)) ?? [],
            variables = Variables(c, salarie, lundi),
            saisies = c.Valeurs.Select(v => new { date = v.PvaDate, rubrique = v.PvaRubrique, valeur = v.PvaValeur }),
            agence = s.Agence,
            zones = c.Chantiers.Values.Where(x => !x.Interne).Select(x => new
            {
                cha_id = x.Id, x.Code, x.Libelle, zone = s.Agence is not null && c.Zones.TryGetValue((x.Id, s.Agence), out var z) ? (short?)z : null,
            }),
        };
    }

    /// <summary>Saisies des rubriques S et SC d'une semaine (remplacées) ; semaine non validée par le RH.</summary>
    public async Task<object> EnregistrerValeursAsync(int salarie, DateOnly lundi, ValeursSaisies v, Utilisateur u, CancellationToken ct)
    {
        lundi = ReglesPointage.LundiDe(lundi);
        var (s, roles) = await synthese.AccesAsync(salarie, u, ct);
        await synthese.ControlerModifiableAsync(salarie, lundi, roles, ct);
        var saisissables = s.PpfId is int ppf
            ? await db.Rubriques.Where(r => r.RubPpfId == ppf && r.RubSaisie != "C").Select(r => r.RubCode).ToListAsync(ct) : [];
        if (v.Valeurs.Any(x => x.Date < lundi || x.Date > lundi.AddDays(6) || !saisissables.Contains(x.Rubrique)))
            throw ExceptionMetier.Invalide("POI_RUBRIQUE", "Rubrique non saisissable ou date hors de la semaine");
        await db.Valeurs.Where(x => x.PvaSalId == salarie && x.PvaDate >= lundi && x.PvaDate <= lundi.AddDays(6)).ExecuteDeleteAsync(ct);
        db.Valeurs.AddRange(v.Valeurs.GroupBy(x => (x.Date, x.Rubrique)).Select(g => new ValeurEntite
        {
            PvaSalId = salarie, PvaDate = g.Key.Date, PvaRubrique = g.Key.Rubrique, PvaValeur = g.Last().Valeur, PvaPar = u.Code,
        }));
        synthese.Journaliser(salarie, lundi, "RUBRIQUES", new { valeurs = v.Valeurs.Count }, u);
        await db.SaveChangesAsync(ct);
        return await VariablesAsync(salarie, lundi, u, ct);
    }

    public async Task<object> ZonesAsync(int chantier, CancellationToken ct) =>
        await db.Zones.AsNoTracking().Where(z => z.PzcChaId == chantier).OrderBy(z => z.PzcAgence)
            .Select(z => new { agence = z.PzcAgence, zone = z.PzcZone, valide_par = z.PzcValidePar, valide_le = z.PzcValideLe }).ToListAsync(ct);

    /// <summary>Zones d'un chantier par agence (RH) : zone vide = retirée.</summary>
    public async Task<object> EnregistrerZonesAsync(int chantier, List<ZoneSaisie> l, Utilisateur u, CancellationToken ct)
    {
        await Rh(u, ct);
        if (l.Any(z => string.IsNullOrWhiteSpace(z.Agence) || z.Zone is < 0 or > 9)) throw ExceptionMetier.Invalide("POI_ZONE", "Agence obligatoire, zone de 0 à 9");
        var existants = await db.Zones.Where(z => z.PzcChaId == chantier).ToListAsync(ct);
        foreach (var z in l)
        {
            var e = existants.FirstOrDefault(x => x.PzcAgence == z.Agence.Trim());
            if (z.Zone is not int n)
            {
                if (e is not null) db.Zones.Remove(e);
                continue;
            }
            if (e is null) db.Zones.Add(e = new ZoneEntite { PzcChaId = chantier, PzcAgence = z.Agence.Trim() });
            e.PzcZone = (short)n;
            e.PzcValidePar = u.Code;
            e.PzcValideLe = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);
        return await ZonesAsync(chantier, ct);
    }

    private static (DateOnly Du, DateOnly Au) Semaines(DateOnly du, DateOnly au)
    {
        if (du.DayOfWeek != DayOfWeek.Monday || au.DayOfWeek != DayOfWeek.Sunday || au < du || au.DayNumber - du.DayNumber > 62)
            throw ExceptionMetier.Invalide("POI_PERIODE", "Période en semaines entières (du lundi au dimanche, neuf semaines au plus)");
        return (du, au);
    }

    /// <summary>Nombre à la française (virgule décimale) ; le serveur tourne sans globalisation.</summary>
    private static string Nombre(decimal v) => v.ToString("0.##", CultureInfo.InvariantCulture).Replace('.', ',');

    /// <summary>
    /// Variables de paie de la période (semaines entières) des salariés à profil exporté : salariés dont tous les jours
    /// pointés ou saisis sont validés par le RH ; les autres sont listés à part. Enregistré : export tracé (fichier
    /// gardé, salariés exportés : la dévalidation ultérieure est signalée).
    /// </summary>
    public async Task<object> ExportAsync(DemandeExport d, bool enregistrer, Utilisateur u, CancellationToken ct)
    {
        await Rh(u, ct);
        var (du, au) = Semaines(d.Du, d.Au);
        var salaries = await specialisation.SalariesAsync(db, new FiltreSalaries(d.Service, null, null, 100000), ct);
        var c = await ContexteAsync(salaries, du, au, false, ct);
        // Congés de la période (jours travaillés décomptés) : validés exportés par nature, demandés signalés.
        var absences = await conges.AbsencesAsync(salaries.Select(s => s.Id).ToList(), du, au, ct);
        var natures = (await conges.NaturesAsync(ct)).ToDictionary(n => n.Code);
        var lignes = new List<(SalariePointage S, string Rubrique, string? CodePaie, string Libelle, decimal Quantite)>();
        var nonValides = new List<object>();
        var exportes = new List<int>();
        foreach (var s in salaries)
        {
            if (s.PpfId is not int ppf || !c.Profils.TryGetValue(ppf, out var p) || !p.Profil.PpfExport) continue;
            var jours = c.Retenus.Where(x => x.PoiSalId == s.Id).Select(x => x.PoiDate).Concat(c.Valeurs.Where(v => v.PvaSalId == s.Id).Select(v => v.PvaDate)).Distinct().ToList();
            var abs = absences.Where(a => a.Salarie == s.Id && a.Etat == "VALIDE" && a.Nature is not null).ToList();
            if (jours.Count == 0 && abs.Count == 0) continue;
            var manquants = jours.Where(j => !c.ValidesRh.Contains((s.Id, j))).OrderBy(j => j).ToList();
            if (manquants.Count > 0)
            {
                nonValides.Add(new { salarie = s, jours = manquants });
                continue;
            }
            var totaux = new Dictionary<string, int>();
            for (var lundi = du; lundi <= au; lundi = lundi.AddDays(7))
            {
                foreach (var (k, v) in Variables(c, s.Id, lundi)?.Totaux ?? []) totaux[k] = totaux.GetValueOrDefault(k) + v;
            }
            exportes.Add(s.Id);
            foreach (var r in p.Rubriques)
            {
                if (r.RubUnite == "ZONE")
                {
                    foreach (var (k, v) in totaux.Where(x => x.Key.StartsWith(r.RubCode + "_", StringComparison.Ordinal)).OrderBy(x => x.Key, StringComparer.Ordinal))
                    {
                        var n = k[(r.RubCode.Length + 1)..];
                        lignes.Add((s, k, r.RubCodePaie is null ? null : r.RubCodePaie + n, $"{r.RubLibelle} {n}", v));
                    }
                }
                else if (totaux.TryGetValue(r.RubCode, out var v) && v != 0)
                {
                    lignes.Add((s, r.RubCode, r.RubCodePaie, r.RubLibelle, ReglesPaie.QuantiteExport(r.RubUnite, v)));
                }
            }
            foreach (var g in abs.GroupBy(a => a.Nature!).OrderBy(g => natures.GetValueOrDefault(g.Key)?.Ordre ?? 0).ThenBy(g => g.Key, StringComparer.Ordinal))
            {
                var n = natures.GetValueOrDefault(g.Key);
                lignes.Add((s, "ABS_" + g.Key, n?.CodePaie ?? g.Key, n?.Libelle ?? g.Key, g.Sum(a => a.Part)));
            }
        }
        var csv = new StringBuilder("matricule;nom;prenom;rubrique;code_paie;libelle;quantite;du;au\r\n");
        foreach (var l in lignes)
        {
            csv.Append($"{l.S.MatriculePaie ?? l.S.Matricule};{l.S.Nom};{l.S.Prenom};{l.Rubrique};{l.CodePaie};{l.Libelle};{Nombre(l.Quantite)};{du:dd/MM/yyyy};{au:dd/MM/yyyy}\r\n");
        }
        long? id = null;
        if (enregistrer)
        {
            var e = new ExportEntite { PexDu = du, PexAu = au, PexService = d.Service, PexSalaries = [.. exportes], PexLignes = lignes.Count, PexContenu = csv.ToString(), PexPar = u.Code };
            db.Exports.Add(e);
            await db.SaveChangesAsync(ct);
            id = e.PexId;
        }
        return new
        {
            id, du, au, csv = csv.ToString(), non_valides = nonValides, salaries = exportes.Count,
            conges_en_attente = absences.Where(a => a.Etat == "DEMANDE").GroupBy(a => a.Conge).Select(g => new
            {
                conge = g.Key, salarie = salaries.First(s => s.Id == g.First().Salarie), du = g.Min(a => a.Date), au = g.Max(a => a.Date), jours = g.Sum(a => a.Part),
            }),
            lignes = lignes.Select(l => new { matricule = l.S.MatriculePaie ?? l.S.Matricule, nom = l.S.Nom, prenom = l.S.Prenom, rubrique = l.Rubrique, code_paie = l.CodePaie, libelle = l.Libelle, quantite = l.Quantite }),
        };
    }

    public async Task<object> ExportsAsync(Utilisateur u, CancellationToken ct)
    {
        await Rh(u, ct);
        return await db.Exports.AsNoTracking().OrderByDescending(e => e.PexLe).Take(50)
            .Select(e => new { id = e.PexId, du = e.PexDu, au = e.PexAu, service = e.PexService, salaries = e.PexSalaries.Length, lignes = e.PexLignes, par = e.PexPar, le = e.PexLe })
            .ToListAsync(ct);
    }

    public async Task<IResult> FichierExportAsync(long id, Utilisateur u, CancellationToken ct)
    {
        await Rh(u, ct);
        var e = await db.Exports.AsNoTracking().FirstOrDefaultAsync(x => x.PexId == id, ct) ?? throw ExceptionMetier.Introuvable($"Export {id}");
        return Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(e.PexContenu)).ToArray(), "text/csv; charset=utf-8",
            $"variables-paie-{e.PexDu:yyyyMMdd}-{e.PexAu:yyyyMMdd}.csv");
    }

    /// <summary>
    /// Valorise les pointages retenus de la période (M20) : taux du salarié (coût horaire de la fiche, ou taux de la
    /// mission pour un intérimaire si la société les impute) ou taux importés après la paie (matricule → coût horaire
    /// réel) ; coût = heures × taux, arrondi au centime ; source gardée sur le pointage.
    /// </summary>
    public async Task<object> ValoriserAsync(DemandeValorisation d, Utilisateur u, CancellationToken ct)
    {
        await Rh(u, ct);
        if (d.Au < d.Du || d.Au.DayNumber - d.Du.DayNumber > 370) throw ExceptionMetier.Invalide("POI_PERIODE", "Période invalide (un an au plus)");
        if (d.Mode is not ("SALARIE" or "IMPORT")) throw ExceptionMetier.Invalide("POI_VALORISATION", "Mode de valorisation inconnu");
        var salaries = await specialisation.SalariesAsync(db, new FiltreSalaries(d.Service, null, null, 100000), ct);
        var p0 = await pointage.ParametresAsync(ct);
        Dictionary<int, (decimal Taux, string Source)> taux;
        if (d.Mode == "IMPORT")
        {
            var parMatricule = (d.Taux ?? []).GroupBy(t => t.Matricule.Trim()).ToDictionary(g => g.Key, g => g.Last().Taux);
            // Matricule de paie (celui du fichier de paie) s'il est renseigné, sinon matricule.
            string? Cle(SalariePointage s) => s.MatriculePaie is string m && parMatricule.ContainsKey(m) ? m : parMatricule.ContainsKey(s.Matricule) ? s.Matricule : null;
            taux = salaries.Where(s => Cle(s) is not null).ToDictionary(s => s.Id, s => (parMatricule[Cle(s)!], "IMPORT"));
        }
        else
        {
            taux = (await specialisation.TauxAsync(db, salaries.Select(s => s.Id).ToList(), d.Du, d.Au, ct))
                .Where(x => x.Value.Source != "INTERIM" || p0.InterimImputes).ToDictionary(x => x.Key, x => x.Value);
        }
        var cibles = salaries.Where(s => taux.ContainsKey(s.Id)).ToList();
        var c = await ContexteAsync(cibles, d.Du, d.Au, true, ct);
        var maintenant = DateTimeOffset.UtcNow;
        decimal total = 0;
        foreach (var p in c.Retenus)
        {
            var (t, source) = taux[p.PoiSalId];
            p.PoiTaux = t;
            p.PoiCout = Math.Round(p.PoiMinutes * t / 60m, 2, MidpointRounding.AwayFromZero);
            p.PoiValorisation = source;
            p.PoiValoriseLe = maintenant;
            total += p.PoiCout.Value;
        }
        await db.SaveChangesAsync(ct);
        return new { pointages = c.Retenus.Count, salaries = cibles.Count, sans_taux = salaries.Count - cibles.Count, cout = total };
    }
}
