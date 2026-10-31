using System.Globalization;
using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Bibliotheque.Web;

/// <summary>
/// Point de spécialisation du module Bibliothèque (classe mère) : droits sur les référentiels et les tarifs.
/// Par défaut : référentiels et paramètres réservés à un administrateur, tarifs modifiables par tous.
/// </summary>
public class SpecialisationBibliotheque
{
    public virtual bool PeutParametrer(Utilisateur u) => u.EstAdmin;

    public virtual bool PeutModifierTarifs(Utilisateur u) => true;

    /// <summary>
    /// Prix d'un ouvrage recalculé avec de nouveaux coefficients (période modifiée) : l'application qui sait calculer la
    /// composition le fait ; par défaut les prix de l'ouvrage restent inchangés.
    /// </summary>
    public virtual void RecalculerOuvrage(Element ouvrage) { }
}

/// <summary>
/// Services du module Bibliothèque (classe mère) : paramètres, référentiels (bibliothèques, familles hiérarchiques,
/// regroupements, natures), tarifs fournisseurs avec recalcul du prix de l'élément, historique des prix, recherche.
/// La fiche de l'élément passe par le module Fiche (spécialisée par l'application).
/// </summary>
public class ServiceBibliotheque(BibliothequeDbContext db, SpecialisationBibliotheque specialisation)
{
    protected BibliothequeDbContext Db => db;

    private void Parametrage(Utilisateur u)
    {
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.ParametrageRefuse();
    }

    private static string? Texte(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    private static string Obligatoire(string? v, string champ) =>
        Texte(v) ?? throw ExceptionMetier.Invalide("OBLIGATOIRE", $"{champ} obligatoire");

    // ------------------------------------------------------------------ paramètres

    public virtual async Task<ParametresBibliothequeDto> Parametres(CancellationToken ct)
    {
        var p = await db.Parametres.AsNoTracking().ToDictionaryAsync(x => x.PbiCle, x => x.PbiValeur.RootElement.Clone(), ct);
        var r = new ParametresBibliothequeDto();
        if (p.TryGetValue("scenario_defaut", out var s) && s.ValueKind == JsonValueKind.String) r.ScenarioDefaut = s.GetString()!;
        if (p.TryGetValue("scenarios_autorises", out var a) && a.ValueKind == JsonValueKind.Array) r.ScenariosAutorises = a.EnumerateArray().Select(x => x.GetString()!).ToList();
        if (p.TryGetValue("coef_fg_defaut", out var f) && f.ValueKind == JsonValueKind.Number) r.CoefFgDefaut = f.GetDecimal();
        if (p.TryGetValue("coef_benef_defaut", out var b) && b.ValueKind == JsonValueKind.Number) r.CoefBenefDefaut = b.GetDecimal();
        if (p.TryGetValue("pv_fixe_ouvrages_envoyes", out var o) && o.ValueKind is JsonValueKind.True or JsonValueKind.False) r.PvFixeOuvragesEnvoyes = o.GetBoolean();
        return r;
    }

    public virtual async Task<ParametresBibliothequeDto> EnregistrerParametres(ParametresBibliothequeDto p, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        if (!CalculElement.Scenarios.Contains(p.ScenarioDefaut)) throw ExceptionMetier.Invalide("SCENARIO", "Scénario inconnu");
        if (p.ScenariosAutorises.Any(s => !CalculElement.Scenarios.Contains(s))) throw ExceptionMetier.Invalide("SCENARIO", "Scénario inconnu");
        if (!p.ScenariosAutorises.Contains(p.ScenarioDefaut)) throw ExceptionMetier.Invalide("SCENARIO", "Le scénario par défaut doit être autorisé");
        if (p.CoefFgDefaut <= 0 || p.CoefBenefDefaut <= 0) throw ExceptionMetier.Invalide("COEF", "Coefficients strictement positifs");
        var valeurs = new Dictionary<string, object>
        {
            ["scenario_defaut"] = p.ScenarioDefaut, ["scenarios_autorises"] = p.ScenariosAutorises,
            ["coef_fg_defaut"] = p.CoefFgDefaut, ["coef_benef_defaut"] = p.CoefBenefDefaut,
            ["pv_fixe_ouvrages_envoyes"] = p.PvFixeOuvragesEnvoyes,
        };
        foreach (var (cle, v) in valeurs)
        {
            var ligne = await db.Parametres.FirstOrDefaultAsync(x => x.PbiCle == cle, ct);
            var json = JsonSerializer.SerializeToDocument(v);
            if (ligne is null) db.Parametres.Add(new ParametreBibliotheque { PbiCle = cle, PbiValeur = json });
            else ligne.PbiValeur = json;
        }
        await db.SaveChangesAsync(ct);
        return await Parametres(ct);
    }

    // ------------------------------------------------------------------ bibliothèques

    public virtual async Task<List<BibliothequeDto>> Bibliotheques(CancellationToken ct) =>
        (await db.Bibliotheques.AsNoTracking().OrderBy(b => b.BibOrdre).ThenBy(b => b.BibCode).ToListAsync(ct))
        .Select(b => new BibliothequeDto(b.BibId, b.BibCode, b.BibLibelle, b.BibDefaut, b.BibActif, b.BibOrdre)).ToList();

    public virtual async Task<List<BibliothequeDto>> EnregistrerBibliotheque(BibliothequeDto d, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        var code = Obligatoire(d.Code, "Code").ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9_]{1,10}$")) throw ExceptionMetier.Invalide("CODE", "Code : lettres, chiffres ou _ (10 au plus), sans « : »");
        if (await db.Bibliotheques.AnyAsync(b => b.BibCode == code && b.BibId != d.Id, ct)) throw ExceptionMetier.Conflit("CODE", $"Bibliothèque {code} déjà existante");
        var b = d.Id > 0 ? await db.Bibliotheques.FirstOrDefaultAsync(x => x.BibId == d.Id, ct) ?? throw ExceptionMetier.Introuvable($"Bibliothèque {d.Id}") : new Bibliotheque();
        if (d.Defaut) await db.Bibliotheques.Where(x => x.BibDefaut && x.BibId != d.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.BibDefaut, false), ct);
        b.BibCode = code; b.BibLibelle = Obligatoire(d.Libelle, "Libellé"); b.BibDefaut = d.Defaut; b.BibActif = d.Actif; b.BibOrdre = d.Ordre;
        if (b.BibId == 0) db.Bibliotheques.Add(b);
        await db.SaveChangesAsync(ct);
        return await Bibliotheques(ct);
    }

    public virtual async Task<List<BibliothequeDto>> SupprimerBibliotheque(int id, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        if (await db.Elements.AnyAsync(e => e.EleBibId == id, ct)) throw ExceptionMetier.Conflit("UTILISEE", "Bibliothèque contenant des éléments : désactivez-la plutôt");
        await db.Bibliotheques.Where(b => b.BibId == id).ExecuteDeleteAsync(ct);
        return await Bibliotheques(ct);
    }

    // ------------------------------------------------------------------ familles (arborescence par bibliothèque)

    public virtual async Task<List<FamilleDto>> Familles(int? bibId, CancellationToken ct)
    {
        var q = db.FamillesChemins.AsNoTracking();
        if (bibId is { } b) q = q.Where(f => f.FamBibId == b);
        // Tri par la base (collation de la base ; l'API tourne en globalisation invariante).
        return (await q.OrderBy(f => f.FamBibId).ThenBy(f => f.Chemin).ToListAsync(ct))
            .Select(f => new FamilleDto(f.FamId, f.FamBibId, f.FamParentId, f.FamCode, f.FamLibelle, f.FamOrdre, f.Chemin, f.Niveau)).ToList();
    }

    public virtual async Task<List<FamilleDto>> EnregistrerFamille(FamilleDto d, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        var code = Obligatoire(d.Code, "Code").ToUpperInvariant();
        if (await db.Familles.AnyAsync(f => f.FamBibId == d.BibId && f.FamCode == code && f.FamId != d.Id, ct)) throw ExceptionMetier.Conflit("CODE", $"Famille {code} déjà existante");
        if (d.ParentId is { } p)
        {
            var parent = await db.Familles.AsNoTracking().FirstOrDefaultAsync(f => f.FamId == p, ct) ?? throw ExceptionMetier.Introuvable($"Famille {p}");
            if (parent.FamBibId != d.BibId) throw ExceptionMetier.Invalide("PARENT", "La famille parente appartient à une autre bibliothèque");
            // Pas de cycle : le parent ne peut pas être la famille elle-même ni l'un de ses descendants.
            for (int? x = p; x is { } courant;)
            {
                if (courant == d.Id) throw ExceptionMetier.Invalide("PARENT", "Une famille ne peut pas être rangée sous elle-même");
                x = await db.Familles.AsNoTracking().Where(f => f.FamId == courant).Select(f => f.FamParentId).FirstOrDefaultAsync(ct);
            }
        }
        var fam = d.Id > 0 ? await db.Familles.FirstOrDefaultAsync(f => f.FamId == d.Id, ct) ?? throw ExceptionMetier.Introuvable($"Famille {d.Id}") : new FamilleElement();
        fam.FamBibId = d.BibId; fam.FamParentId = d.ParentId; fam.FamCode = code; fam.FamLibelle = Obligatoire(d.Libelle, "Libellé"); fam.FamOrdre = d.Ordre;
        if (fam.FamId == 0) db.Familles.Add(fam);
        await db.SaveChangesAsync(ct);
        return await Familles(d.BibId, ct);
    }

    public virtual async Task<List<FamilleDto>> SupprimerFamille(int id, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        var f = await db.Familles.AsNoTracking().FirstOrDefaultAsync(x => x.FamId == id, ct) ?? throw ExceptionMetier.Introuvable($"Famille {id}");
        if (await db.Familles.AnyAsync(x => x.FamParentId == id, ct)) throw ExceptionMetier.Conflit("SOUS_FAMILLES", "Famille contenant des sous-familles");
        await db.Familles.Where(x => x.FamId == id).ExecuteDeleteAsync(ct); // éléments : famille retirée (ON DELETE SET NULL)
        return await Familles(f.FamBibId, ct);
    }

    // ------------------------------------------------------------------ regroupements et natures

    public virtual async Task<List<RegroupementDto>> Regroupements(CancellationToken ct) =>
        (await db.Regroupements.AsNoTracking().OrderBy(r => r.RgnOrdre).ToListAsync(ct)).Select(r => new RegroupementDto(r.RgnCode, r.RgnLibelle, r.RgnOrdre)).ToList();

    public virtual async Task<List<RegroupementDto>> EnregistrerRegroupement(RegroupementDto d, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        var code = Obligatoire(d.Code, "Code").ToUpperInvariant();
        var r = await db.Regroupements.FirstOrDefaultAsync(x => x.RgnCode == code, ct);
        if (r is null) db.Regroupements.Add(r = new RegroupementNature { RgnCode = code });
        r.RgnLibelle = Obligatoire(d.Libelle, "Libellé");
        r.RgnOrdre = d.Ordre;
        await db.SaveChangesAsync(ct);
        return await Regroupements(ct);
    }

    public virtual async Task<List<RegroupementDto>> SupprimerRegroupement(string code, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        if (await db.Natures.AnyAsync(n => n.NatRgnCode == code, ct)) throw ExceptionMetier.Conflit("UTILISE", "Regroupement utilisé par des natures");
        await db.Regroupements.Where(r => r.RgnCode == code).ExecuteDeleteAsync(ct);
        return await Regroupements(ct);
    }

    public virtual async Task<List<NatureDto>> Natures(CancellationToken ct) =>
        (await db.Natures.AsNoTracking().OrderBy(n => n.NatCode).ToListAsync(ct))
        .Select(n => new NatureDto(n.NatId, n.NatCode, n.NatLibelle, n.NatRgnCode, n.NatAxeAnalytique, n.NatActif, n.NatIsolant,
            n.NatTypes.RootElement.ValueKind == JsonValueKind.Array ? n.NatTypes.RootElement.EnumerateArray().Select(x => x.GetString()!).ToList() : [])).ToList();

    public virtual async Task<List<NatureDto>> EnregistrerNature(NatureDto d, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        var code = Obligatoire(d.Code, "Code").ToUpperInvariant();
        if (await db.Natures.AnyAsync(n => n.NatCode == code && n.NatId != d.Id, ct)) throw ExceptionMetier.Conflit("CODE", $"Nature {code} déjà existante");
        if (Texte(d.Regroupement) is { } rg && !await db.Regroupements.AnyAsync(r => r.RgnCode == rg, ct)) throw ExceptionMetier.Invalide("REGROUPEMENT", $"Regroupement {rg} inconnu");
        var n = d.Id > 0 ? await db.Natures.FirstOrDefaultAsync(x => x.NatId == d.Id, ct) ?? throw ExceptionMetier.Introuvable($"Nature {d.Id}") : new NatureElement();
        n.NatCode = code; n.NatLibelle = Obligatoire(d.Libelle, "Libellé"); n.NatRgnCode = Texte(d.Regroupement); n.NatAxeAnalytique = Texte(d.AxeAnalytique);
        n.NatActif = d.Actif; n.NatIsolant = d.Isolant;
        var types = (d.Types ?? []).Distinct().ToList();
        if (types.Any(t => !CoefficientsElement.TypesNature.Contains(t))) throw ExceptionMetier.Invalide("TYPE", "Type de nature inconnu");
        n.NatTypes = JsonSerializer.SerializeToDocument(types);
        if (n.NatId == 0) db.Natures.Add(n);
        await db.SaveChangesAsync(ct);
        return await Natures(ct);
    }

    public virtual async Task<List<NatureDto>> SupprimerNature(int id, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        await db.Natures.Where(n => n.NatId == id).ExecuteDeleteAsync(ct); // éléments : nature retirée (ON DELETE SET NULL)
        return await Natures(ct);
    }

    // ------------------------------------------------------------------ coefficients par période

    private static PeriodeDto VersDto(CoefficientPeriode p) => new(p.CopId, p.CopNatId, p.CopDebut.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        p.CopCoefFg, p.CopCoefBenef, p.CopCommentaire, p.CopCreeLe, p.CopCreePar);

    public virtual async Task<List<PeriodeDto>> Periodes(CancellationToken ct) =>
        (await db.Periodes.AsNoTracking().OrderBy(p => p.CopNatId).ThenByDescending(p => p.CopDebut).ToListAsync(ct)).Select(VersDto).ToList();

    /// <summary>Périodes au format de la résolution (CoefficientsElement).</summary>
    public virtual async Task<List<PeriodeCoefficients>> PeriodesCalcul(CancellationToken ct) =>
        (await db.Periodes.AsNoTracking().ToListAsync(ct)).Select(p => new PeriodeCoefficients
        {
            NatId = p.CopNatId, Debut = p.CopDebut.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), CoefFg = p.CopCoefFg, CoefBenef = p.CopCoefBenef,
        }).ToList();

    /// <summary>Coefficients effectifs d'un élément à la date du jour (imposés, nature, global, défaut).</summary>
    public virtual async Task<CoefficientsResolus> Coefficients(int? natId, decimal? coefFg, bool fgImpose, decimal? coefBenef, bool benefImpose, CancellationToken ct)
    {
        var p = await Parametres(ct);
        return CoefficientsElement.Resoudre(new CoefficientsSaisis { NatId = natId, CoefFg = coefFg, CoefFgImpose = fgImpose, CoefBenef = coefBenef, CoefBenefImpose = benefImpose },
            await PeriodesCalcul(ct), DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), p.CoefFgDefaut, p.CoefBenefDefaut);
    }

    /// <summary>
    /// Nouvelle période (globale ou d'une nature). Une période commencée ne se modifie pas : on en crée une autre. Les
    /// éléments qui suivent ces coefficients sont recalculés (historique des prix alimenté).
    /// </summary>
    public virtual async Task<PeriodeEnregistree> EnregistrerPeriode(PeriodeDto d, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        var debut = DateOnly.ParseExact(Obligatoire(d.Debut, "Début")[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (d.CoefFg is null && d.CoefBenef is null) throw ExceptionMetier.Invalide("COEF", "Au moins un coefficient");
        if (d.CoefFg <= 0 || d.CoefBenef <= 0) throw ExceptionMetier.Invalide("COEF", "Coefficients strictement positifs");
        if (d.NatId is { } nat && !await db.Natures.AnyAsync(n => n.NatId == nat, ct)) throw ExceptionMetier.Introuvable($"Nature {nat}");
        var aujourdhui = DateOnly.FromDateTime(DateTime.Today);
        var p = d.Id > 0 ? await db.Periodes.FirstOrDefaultAsync(x => x.CopId == d.Id, ct) ?? throw ExceptionMetier.Introuvable($"Période {d.Id}") : new CoefficientPeriode();
        if (p.CopId > 0 && p.CopDebut <= aujourdhui) throw ExceptionMetier.Invalide("PERIODE_COMMENCEE", "Période commencée : créez une nouvelle période");
        if (await db.Periodes.AnyAsync(x => x.CopNatId == d.NatId && x.CopDebut == debut && x.CopId != d.Id, ct))
            throw ExceptionMetier.Conflit("PERIODE", "Une période commence déjà à cette date pour cette portée");
        p.CopNatId = d.NatId; p.CopDebut = debut; p.CopCoefFg = d.CoefFg; p.CopCoefBenef = d.CoefBenef; p.CopCommentaire = Texte(d.Commentaire);
        if (p.CopId == 0) { p.CopCreeLe = DateTimeOffset.UtcNow; p.CopCreePar = u.Code; db.Periodes.Add(p); }
        await db.SaveChangesAsync(ct);
        var n = await RecalculerElements($"Coefficients {(d.NatId is null ? "globaux" : "de la nature")} au {debut:dd/MM/yyyy}", u, ct);
        return new PeriodeEnregistree(await Periodes(ct), n);
    }

    public virtual async Task<PeriodeEnregistree> SupprimerPeriode(int id, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        var p = await db.Periodes.FirstOrDefaultAsync(x => x.CopId == id, ct) ?? throw ExceptionMetier.Introuvable($"Période {id}");
        if (p.CopDebut <= DateOnly.FromDateTime(DateTime.Today)) throw ExceptionMetier.Invalide("PERIODE_COMMENCEE", "Période commencée : elle fait partie de l'historique");
        db.Periodes.Remove(p);
        await db.SaveChangesAsync(ct);
        return new PeriodeEnregistree(await Periodes(ct), 0);
    }

    /// <summary>
    /// Recalcul des éléments qui suivent les coefficients de période (non imposés) : coefficients en vigueur aujourd'hui,
    /// puis prix ; seuls les éléments dont un coefficient change sont écrits. Renvoie le nombre d'éléments modifiés.
    /// </summary>
    public virtual async Task<int> RecalculerElements(string commentaire, Utilisateur u, CancellationToken ct)
    {
        var p = await Parametres(ct);
        var periodes = await PeriodesCalcul(ct);
        var date = DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var elements = await db.Elements.Where(e => !e.EleCoefFgImpose || !e.EleCoefBenefImpose).ToListAsync(ct);
        var tarifs = (await db.Tarifs.AsNoTracking().ToListAsync(ct)).GroupBy(t => t.TfoEleId)
            .ToDictionary(g => g.Key, g => g.Select(VersCalcul).ToList());
        var n = 0;
        foreach (var e in elements)
        {
            var c = CoefficientsElement.Resoudre(new CoefficientsSaisis { NatId = e.EleNatId, CoefFg = e.EleCoefFg, CoefFgImpose = e.EleCoefFgImpose, CoefBenef = e.EleCoefBenef, CoefBenefImpose = e.EleCoefBenefImpose },
                periodes, date, p.CoefFgDefaut, p.CoefBenefDefaut);
            if (c.CoefFg == e.EleCoefFg && (c.CoefBenef == e.EleCoefBenef || e.ElePvFixe)) continue;
            e.EleCoefFg = c.CoefFg;
            if (!e.ElePvFixe) e.EleCoefBenef = c.CoefBenef;
            if (e.EleType is "OUVRAGE" or "ENSEMBLE") specialisation.RecalculerOuvrage(e);
            else
            {
                var r = CalculElement.Calculer(Entree(e, tarifs.GetValueOrDefault(e.EleId) ?? []));
                e.ElePa = r.Pa; e.ElePr = r.Pr; e.ElePv = r.Pv; e.EleCoefBenef = r.CoefBenef ?? e.EleCoefBenef; e.ElePvNet = r.PvNet;
            }
            e.EleMajPar = u.Code;
            e.EleCommentairePrix = commentaire;
            n++;
        }
        await db.SaveChangesAsync(ct);
        return n;
    }

    // ------------------------------------------------------------------ tarifs fournisseurs et recalcul

    private static string? Date(DateOnly? d) => d?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static TarifDto VersDto(TarifFournisseur t) => new(t.TfoId, t.TfoFournisseur, t.TfoTiersId, t.TfoReference, t.TfoLibelle, t.TfoUntCode, t.TfoPrix,
        Date(t.TfoDebut), Date(t.TfoFin), t.TfoPrincipal, t.TfoLien, t.TfoMajLe, t.TfoMajPar, t.TfoPrixPublic, t.TfoRemise1, t.TfoRemise2, t.TfoDelai, t.TfoCodeBarre);

    private static TarifCalcul VersCalcul(TarifFournisseur t) => new()
    {
        Prix = t.TfoPrix, PrixPublic = t.TfoPrixPublic, Remise1 = t.TfoRemise1, Remise2 = t.TfoRemise2,
        Unite = t.TfoUntCode, Principal = t.TfoPrincipal, Debut = Date(t.TfoDebut), Fin = Date(t.TfoFin),
    };

    public virtual async Task<List<TarifDto>> Tarifs(long eleId, CancellationToken ct) =>
        (await db.Tarifs.AsNoTracking().Where(t => t.TfoEleId == eleId).OrderByDescending(t => t.TfoPrincipal).ThenBy(t => t.TfoFournisseur).ThenBy(t => t.TfoId).ToListAsync(ct))
        .Select(VersDto).ToList();

    /// <summary>Tarifs d'un fournisseur de l'annuaire (tfo_tiers_id), avec l'élément ; par code d'élément.</summary>
    public virtual async Task<List<TarifTiersDto>> TarifsTiers(long tiersId, CancellationToken ct) =>
        (await (from t in db.Tarifs.AsNoTracking()
                join e in db.Elements.AsNoTracking() on t.TfoEleId equals e.EleId
                join b in db.Bibliotheques.AsNoTracking() on e.EleBibId equals b.BibId
                where t.TfoTiersId == tiersId
                orderby e.EleCode, t.TfoPrincipal descending, t.TfoId
                select new { t, e.EleCode, e.EleLibelle, e.EleUntStock, b.BibCode }).ToListAsync(ct))
        .Select(x => new TarifTiersDto(x.t.TfoId, x.t.TfoEleId, x.BibCode, x.EleCode, x.EleLibelle, x.EleUntStock, x.t.TfoFournisseur, x.t.TfoReference, x.t.TfoLibelle,
            x.t.TfoUntCode, x.t.TfoPrix, Date(x.t.TfoDebut), Date(x.t.TfoFin), x.t.TfoPrincipal, x.t.TfoLien,
            x.t.TfoPrixPublic, x.t.TfoRemise1, x.t.TfoRemise2, x.t.TfoDelai, x.t.TfoCodeBarre)).ToList();

    /// <summary>Tarifs au format du calcul (prix, unité, principal, validité).</summary>
    public virtual async Task<List<TarifCalcul>> TarifsCalcul(long eleId, CancellationToken ct) =>
        (await db.Tarifs.AsNoTracking().Where(t => t.TfoEleId == eleId).ToListAsync(ct))
        .Select(VersCalcul).ToList();

    /// <summary>Données techniques (champs supplémentaires numériques) utilisables dans les formules d'unités.</summary>
    public static Dictionary<string, decimal?> Donnees(JsonElement proprietes)
    {
        var r = new Dictionary<string, decimal?>();
        if (proprietes.ValueKind != JsonValueKind.Object) return r;
        foreach (var p in proprietes.EnumerateObject())
        {
            r[p.Name] = p.Value.ValueKind switch
            {
                JsonValueKind.Number => p.Value.GetDecimal(),
                JsonValueKind.String when decimal.TryParse(p.Value.GetString()!.Replace(',', '.').Replace(" ", ""), NumberStyles.Number, CultureInfo.InvariantCulture, out var d) => d,
                _ => null,
            };
        }
        return r;
    }

    public static List<UniteElement> Unites(JsonElement unites) =>
        unites.ValueKind == JsonValueKind.Array ? unites.Deserialize<List<UniteElement>>(JsonCalcul.Options) ?? [] : [];

    /// <summary>Codes des données techniques dans les formules (mêmes codes que la fiche et DONNEES_TECHNIQUES côté JS).</summary>
    public static readonly string[] CodesTechniques = ["poids", "surface", "surface_peinture", "volume", "hauteur", "largeur", "epaisseur", "longueur", "isolant_r", "isolant_lambda", "isolant_u"];

    /// <summary>Données des formules : champs supplémentaires, puis données techniques renseignées.</summary>
    public static Dictionary<string, decimal?> Donnees(JsonElement proprietes, IReadOnlyDictionary<string, decimal?> techniques)
    {
        var r = Donnees(proprietes);
        foreach (var (code, v) in techniques) if (v is not null) r[code] = v;
        return r;
    }

    public static Dictionary<string, decimal?> Techniques(Element e) => new()
    {
        ["poids"] = e.ElePoids, ["surface"] = e.EleSurface, ["surface_peinture"] = e.EleSurfacePeinture, ["volume"] = e.EleVolume,
        ["hauteur"] = e.EleHauteur, ["largeur"] = e.EleLargeur, ["epaisseur"] = e.EleEpaisseur, ["longueur"] = e.EleLongueur,
        ["isolant_r"] = e.EleIsolantR, ["isolant_lambda"] = e.EleIsolantLambda, ["isolant_u"] = e.EleIsolantU,
    };

    /// <summary>Entrée du calcul depuis l'élément enregistré et ses tarifs.</summary>
    public static EntreeElement Entree(Element e, List<TarifCalcul> tarifs) => new()
    {
        UniteStock = e.EleUntStock, Unites = Unites(e.EleUnites.RootElement), Donnees = Donnees(e.EleProprietes.RootElement, Techniques(e)),
        Scenario = e.EleScenarioPa, PaFixe = e.ElePaFixe, DernierPa = e.EleDernierPa, Pmp = e.ElePmp, Tarifs = tarifs,
        CoefFg = e.EleCoefFg, CoefBenef = e.EleCoefBenef, Pv = e.ElePv, PvFixe = e.ElePvFixe, CoefRemise = e.EleCoefRemise,
    };

    /// <summary>
    /// Recalcul des prix d'un élément (tarifs, dernier PA ou PMP changés) ; l'historique est alimenté par le trigger
    /// de la table avec l'auteur et le commentaire. Un ouvrage garde les prix de sa composition.
    /// </summary>
    public virtual async Task<PrixElementDto> Recalculer(long eleId, string commentaire, Utilisateur u, CancellationToken ct)
    {
        var e = await db.Elements.FirstOrDefaultAsync(x => x.EleId == eleId, ct) ?? throw ExceptionMetier.Introuvable($"Élément {eleId}");
        if (e.EleType is "OUVRAGE" or "ENSEMBLE" or "POSTE_PIED") return new PrixElementDto(e.ElePa, e.ElePr, e.ElePv, e.EleCoefBenef, e.ElePvNet, []);
        var r = CalculElement.Calculer(Entree(e, await TarifsCalcul(eleId, ct)));
        e.ElePa = r.Pa; e.ElePr = r.Pr; e.ElePv = r.Pv; e.EleCoefBenef = r.CoefBenef ?? e.EleCoefBenef; e.ElePvNet = r.PvNet;
        e.EleMajPar = u.Code;
        e.EleCommentairePrix = commentaire;
        await db.SaveChangesAsync(ct);
        return new PrixElementDto(r.Pa, r.Pr, r.Pv, e.EleCoefBenef, r.PvNet, r.Alertes);
    }

    private async Task<TarifsElementDto> ApresTarif(long eleId, string commentaire, Utilisateur u, CancellationToken ct)
    {
        var prix = await Recalculer(eleId, commentaire, u, ct);
        return new TarifsElementDto(await Tarifs(eleId, ct), prix);
    }

    public virtual async Task<TarifsElementDto> EnregistrerTarif(long eleId, TarifDto d, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutModifierTarifs(u)) throw ExceptionMetier.AccesRefuse("TARIFS");
        if (!await db.Elements.AnyAsync(e => e.EleId == eleId, ct)) throw ExceptionMetier.Introuvable($"Élément {eleId}");
        ControlerTarif(d.Prix, d.PrixPublic, d.Remise1, d.Remise2, d.Delai);
        DateOnly? Lire(string? s) => string.IsNullOrWhiteSpace(s) ? null : DateOnly.ParseExact(s[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var debut = Lire(d.Debut);
        var fin = Lire(d.Fin);
        if (debut is { } a && fin is { } b && b < a) throw ExceptionMetier.Invalide("DATES", "Fin de validité avant le début");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = d.Id > 0 ? await db.Tarifs.FirstOrDefaultAsync(x => x.TfoId == d.Id && x.TfoEleId == eleId, ct) ?? throw ExceptionMetier.Introuvable($"Tarif {d.Id}") : new TarifFournisseur { TfoEleId = eleId };
        // Un seul tarif principal par élément.
        if (d.Principal) await db.Tarifs.Where(x => x.TfoEleId == eleId && x.TfoPrincipal && x.TfoId != d.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.TfoPrincipal, false), ct);
        t.TfoFournisseur = Obligatoire(d.Fournisseur, "Fournisseur"); t.TfoTiersId = d.TiersId; t.TfoReference = Texte(d.Reference); t.TfoLibelle = Texte(d.Libelle);
        t.TfoUntCode = Obligatoire(d.Unite, "Unité"); t.TfoDebut = debut; t.TfoFin = fin; t.TfoPrincipal = d.Principal;
        t.TfoPrixPublic = d.PrixPublic; t.TfoRemise1 = d.Remise1; t.TfoRemise2 = d.Remise2; t.TfoDelai = d.Delai; t.TfoCodeBarre = Texte(d.CodeBarre);
        // Prix net : prix public remisé s'il est renseigné (même règle que le calcul), sinon le prix saisi.
        t.TfoPrix = CalculElement.PrixNetTarif(new TarifCalcul { Prix = d.Prix, PrixPublic = d.PrixPublic, Remise1 = d.Remise1, Remise2 = d.Remise2 });
        t.TfoLien = Texte(d.Lien); t.TfoMajLe = DateTimeOffset.UtcNow; t.TfoMajPar = u.Code;
        if (t.TfoId == 0) db.Tarifs.Add(t);
        await db.SaveChangesAsync(ct);
        var r = await ApresTarif(eleId, $"Tarif fournisseur {t.TfoFournisseur} : {t.TfoPrix.ToString("0.######", CultureInfo.InvariantCulture)} / {t.TfoUntCode}", u, ct);
        await tx.CommitAsync(ct);
        return r;
    }

    /// <summary>
    /// Import des tarifs d'un fournisseur (format fixe, lot 8 : A12) : élément trouvé par son code d'appel, sinon par la
    /// référence d'un tarif existant du fournisseur, sinon par code-barres (tarif du fournisseur, puis élément) ; unité de
    /// la ligne, sinon celle du tarif existant, sinon l'unité d'achat ou de stock (convertible) ; prix public remisé ou
    /// prix saisi ; tarif existant du fournisseur pour l'élément mis à jour, sinon créé. Simulation : contrôle seul ;
    /// sinon lignes valables écrites en une transaction, prix des éléments recalculés, import journalisé.
    /// </summary>
    public virtual async Task<ResultatImportTarifs> ImporterTarifs(DemandeImportTarifs d, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutModifierTarifs(u)) throw ExceptionMetier.AccesRefuse("TARIFS");
        var fournisseur = Obligatoire(d.Fournisseur, "Fournisseur");
        var defaut = await db.Bibliotheques.AsNoTracking().Where(b => b.BibDefaut).Select(b => b.BibCode).FirstOrDefaultAsync(ct);
        var existants = await db.Tarifs.Where(t => t.TfoTiersId == d.TiersId).ToListAsync(ct);
        var resultats = new List<ResultatLigneImport>();
        var aEcrire = new List<(TarifFournisseur Tarif, bool Nouveau, int Rang)>();
        DateOnly? Lire(string? s) => string.IsNullOrWhiteSpace(s) ? null : DateOnly.ParseExact(s.Trim()[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture);
        for (var i = 0; i < d.Lignes.Count; i++)
        {
            var l = d.Lignes[i];
            var rang = i + 1;
            try
            {
                Element? e = null;
                if (Texte(l.Element) is { } code)
                {
                    var (bib, c) = CalculElement.AnalyserCodeAppel(code, defaut);
                    e = await (from x in db.Elements.AsNoTracking() join b in db.Bibliotheques.AsNoTracking() on x.EleBibId equals b.BibId
                               where b.BibCode == bib && x.EleCode == c && x.EleActif select x).FirstOrDefaultAsync(ct);
                }
                var ref_ = Texte(l.Reference);
                var codeBarre = Texte(l.CodeBarre);
                var parReference = ref_ is null ? null : existants.FirstOrDefault(t => t.TfoReference == ref_ && (e is null || t.TfoEleId == e.EleId));
                var parCodeBarre = codeBarre is null ? null : existants.FirstOrDefault(t => t.TfoCodeBarre == codeBarre && (e is null || t.TfoEleId == e.EleId));
                var eleId = e?.EleId ?? parReference?.TfoEleId ?? parCodeBarre?.TfoEleId;
                if (eleId is null && codeBarre is not null)
                    eleId = await db.Elements.AsNoTracking().Where(x => x.EleCodeBarre == codeBarre && x.EleActif).Select(x => (long?)x.EleId).FirstOrDefaultAsync(ct);
                if (eleId is null) throw ExceptionMetier.Invalide("ELEMENT", "Élément introuvable (code, référence fournisseur ou code-barres)");
                e ??= await db.Elements.AsNoTracking().FirstAsync(x => x.EleId == eleId, ct);
                if (e.EleType is not ("ARTICLE" or "OUVRAGE")) throw ExceptionMetier.Invalide("ELEMENT", $"{e.EleCode} : ni article ni ouvrage");
                var tarif = parReference ?? parCodeBarre ?? existants.FirstOrDefault(t => t.TfoEleId == e.EleId);
                var unite = Texte(l.Unite) ?? tarif?.TfoUntCode ?? e.EleUntAchat ?? e.EleUntStock;
                try { CalculElement.Ratio(unite, Entree(e, [])); }
                catch (ErreurCalcul x) { throw ExceptionMetier.Invalide("UNITE", $"{unite} : {x.Message}"); }
                if (l.PrixPublic is null && l.Prix is null) throw ExceptionMetier.Invalide("PRIX", "Prix public ou prix net obligatoire");
                ControlerTarif(l.Prix ?? 0, l.PrixPublic, l.Remise1, l.Remise2, l.Delai);
                var debut = Lire(l.Debut);
                var fin = Lire(l.Fin);
                if (debut is { } a && fin is { } b2 && b2 < a) throw ExceptionMetier.Invalide("DATES", "Fin de validité avant le début");
                var nouveau = tarif is null;
                var t = tarif ?? new TarifFournisseur { TfoEleId = e.EleId, TfoTiersId = d.TiersId };
                t.TfoFournisseur = fournisseur; t.TfoReference = ref_ ?? t.TfoReference; t.TfoCodeBarre = codeBarre ?? t.TfoCodeBarre;
                t.TfoLibelle = Texte(l.Libelle) ?? t.TfoLibelle; t.TfoUntCode = unite; t.TfoPrixPublic = l.PrixPublic; t.TfoRemise1 = l.Remise1; t.TfoRemise2 = l.Remise2;
                t.TfoPrix = CalculElement.PrixNetTarif(new TarifCalcul { Prix = l.Prix ?? 0, PrixPublic = l.PrixPublic, Remise1 = l.Remise1, Remise2 = l.Remise2 });
                t.TfoDelai = l.Delai ?? t.TfoDelai; t.TfoDebut = debut ?? t.TfoDebut; t.TfoFin = fin ?? t.TfoFin; t.TfoPrincipal = l.Principal || t.TfoPrincipal;
                t.TfoMajLe = DateTimeOffset.UtcNow; t.TfoMajPar = u.Code;
                if (nouveau) existants.Add(t);
                aEcrire.Add((t, nouveau, rang));
                resultats.Add(new(rang, e.EleId, e.EleCode, nouveau ? "CREE" : "MAJ", null));
            }
            catch (ExceptionMetier x) { resultats.Add(new(rang, null, Texte(l.Element), "ERREUR", x.Message)); }
            catch (FormatException) { resultats.Add(new(rang, null, Texte(l.Element), "ERREUR", "Date au format AAAA-MM-JJ")); }
        }
        var crees = resultats.Count(r => r.Action == "CREE");
        var maj = resultats.Count(r => r.Action == "MAJ");
        var erreurs = resultats.Count(r => r.Action == "ERREUR");
        if (d.Simulation)
        {
            foreach (var entree in db.ChangeTracker.Entries<TarifFournisseur>().ToList()) entree.State = EntityState.Detached;
            return new(crees, maj, erreurs, resultats);
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        foreach (var (t, nouveau, _) in aEcrire.Where(x => x.Tarif.TfoPrincipal))
            await db.Tarifs.Where(x => x.TfoEleId == t.TfoEleId && x.TfoPrincipal && x.TfoId != t.TfoId).ExecuteUpdateAsync(s => s.SetProperty(x => x.TfoPrincipal, false), ct);
        foreach (var (t, nouveau, _) in aEcrire) if (nouveau) db.Tarifs.Add(t);
        db.ImportsTarifs.Add(new TarifImport { TimTiersId = d.TiersId, TimFournisseur = fournisseur, TimFichier = Texte(d.Fichier), TimCrees = crees, TimMaj = maj, TimErreurs = erreurs, TimPar = u.Code, TimLe = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync(ct);
        foreach (var eleId in aEcrire.Select(x => x.Tarif.TfoEleId).Distinct()) await Recalculer(eleId, $"Import des tarifs {fournisseur}", u, ct);
        await tx.CommitAsync(ct);
        return new(crees, maj, erreurs, resultats);
    }

    /// <summary>Contrôles d'un tarif : prix positifs, remises de 0 à 100 %, délai positif.</summary>
    private static void ControlerTarif(decimal prix, decimal? prixPublic, decimal? remise1, decimal? remise2, int? delai)
    {
        if (prix < 0 || prixPublic < 0) throw ExceptionMetier.Invalide("PRIX", "Prix négatif");
        if (remise1 is < 0 or > 100 || remise2 is < 0 or > 100) throw ExceptionMetier.Invalide("REMISE", "Remise de 0 à 100 %");
        if (delai < 0) throw ExceptionMetier.Invalide("DELAI", "Délai négatif");
    }

    public virtual async Task<TarifsElementDto> SupprimerTarif(long eleId, long tarifId, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutModifierTarifs(u)) throw ExceptionMetier.AccesRefuse("TARIFS");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = await db.Tarifs.AsNoTracking().FirstOrDefaultAsync(x => x.TfoId == tarifId && x.TfoEleId == eleId, ct) ?? throw ExceptionMetier.Introuvable($"Tarif {tarifId}");
        await db.Tarifs.Where(x => x.TfoId == tarifId).ExecuteDeleteAsync(ct);
        var r = await ApresTarif(eleId, $"Tarif fournisseur {t.TfoFournisseur} supprimé", u, ct);
        await tx.CommitAsync(ct);
        return r;
    }

    // ------------------------------------------------------------------ appel dans les documents

    private static ElementDetailDto VersDetail(Element e, string bibCode) => new(e.EleId, e.EleBibId, bibCode, e.EleCode, e.EleType, e.EleLibelleHtml, e.EleLibelle,
        e.EleFamId, e.EleNatId, e.EleUntStock, e.EleUntAchat, e.EleUntVente, e.EleUnites.RootElement.Clone(), Donnees(e.EleProprietes.RootElement, Techniques(e)),
        e.ElePa, e.EleCoefFg, e.ElePr, e.EleCoefBenef, e.ElePv, e.ElePvFixe, e.EleCoefRemise, e.ElePvNet, e.EleComposition?.RootElement.Clone(), e.EleActif,
        e.EleType == "POSTE_PIED" ? new PosteElementDto(e.ElePiedNiveau, e.ElePiedMode, e.ElePiedBase, e.ElePiedSens, e.ElePiedValeur, e.ElePiedRetenue, e.EleCptCode, e.EleTvaCode, e.ElePiedGenre) : null,
        e.EleCodeBarre, e.EleDelaiLivraison);

    public virtual async Task<ElementDetailDto> Element(long id, CancellationToken ct)
    {
        var x = await (from e in db.Elements.AsNoTracking() join b in db.Bibliotheques.AsNoTracking() on e.EleBibId equals b.BibId where e.EleId == id select new { e, b.BibCode })
            .FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Élément {id}");
        return VersDetail(x.e, x.BibCode);
    }

    /// <summary>
    /// Appel par code : « CODE » dans la bibliothèque du document (ou la bibliothèque par défaut), « BIB:CODE » dans une
    /// autre bibliothèque ; sinon le code-barres saisi (lecteur), dans la bibliothèque du document d'abord. Élément actif
    /// uniquement.
    /// </summary>
    public virtual async Task<ElementDetailDto> Appel(string saisie, string? bibliotheque, CancellationToken ct)
    {
        var defaut = Texte(bibliotheque)?.ToUpperInvariant()
            ?? await db.Bibliotheques.AsNoTracking().Where(b => b.BibDefaut).Select(b => b.BibCode).FirstOrDefaultAsync(ct);
        var (bib, code) = CalculElement.AnalyserCodeAppel(Obligatoire(saisie, "Code"), defaut);
        var x = await (from e in db.Elements.AsNoTracking() join b in db.Bibliotheques.AsNoTracking() on e.EleBibId equals b.BibId
                       where b.BibCode == bib && e.EleCode == code && e.EleActif
                       select new { e, b.BibCode }).FirstOrDefaultAsync(ct);
        var codeBarre = saisie.Trim();
        x ??= await (from e in db.Elements.AsNoTracking() join b in db.Bibliotheques.AsNoTracking() on e.EleBibId equals b.BibId
                     where e.EleCodeBarre == codeBarre && e.EleActif
                     orderby b.BibCode == bib descending, b.BibCode
                     select new { e, b.BibCode }).FirstOrDefaultAsync(ct);
        if (x is null) throw ExceptionMetier.Introuvable($"Élément {code} dans la bibliothèque {bib}");
        return VersDetail(x.e, x.BibCode);
    }

    // ------------------------------------------------------------------ historique et recherche

    public virtual async Task<List<HistoriqueDto>> Historique(long eleId, CancellationToken ct) =>
        (await db.Historique.AsNoTracking().Where(h => h.HpeEleId == eleId).OrderByDescending(h => h.HpeDate).ThenByDescending(h => h.HpeId).Take(500).ToListAsync(ct))
        .Select(h => new HistoriqueDto(h.HpeId, h.HpeDate, h.HpeAuteur, h.HpeCommentaire, h.HpeAvant?.RootElement.Clone(), h.HpeApres.RootElement.Clone())).ToList();

    /// <summary>
    /// Recherche d'éléments (chaque mot dans le code, le libellé, les mots-clés ou le code-barres, sans accent ni casse) :
    /// composition des ouvrages, appel dans les documents.
    /// </summary>
    public virtual async Task<List<ElementRechercheDto>> Rechercher(string? recherche, int? bibId, string? type, CancellationToken ct)
    {
        var q = from e in db.Elements.AsNoTracking()
                join b in db.Bibliotheques.AsNoTracking() on e.EleBibId equals b.BibId
                where e.EleActif
                select new { e, b.BibCode };
        if (bibId is { } bib) q = q.Where(x => x.e.EleBibId == bib);
        if (!string.IsNullOrEmpty(type)) q = q.Where(x => x.e.EleType == type);
        foreach (var mot in (recherche ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var motif = "%" + mot.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
            q = q.Where(x => EF.Functions.ILike(EF.Functions.Unaccent(x.e.EleCode + " " + (x.e.EleLibelle ?? "") + " " + (x.e.EleMotsCles ?? "") + " " + (x.e.EleCodeBarre ?? "")),
                EF.Functions.Unaccent(motif)));
        }
        return (await q.OrderBy(x => x.e.EleCode).Take(50).ToListAsync(ct))
            .Select(x => new ElementRechercheDto(x.e.EleId, x.BibCode, x.e.EleCode, x.e.EleType, x.e.EleLibelle, x.e.EleLibelleHtml, x.e.EleUntStock,
                x.e.ElePa, x.e.ElePr, x.e.ElePv, x.e.ElePvNet, x.e.EleCoefFg, x.e.EleCoefBenef)).ToList();
    }
}
