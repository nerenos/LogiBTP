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
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.AccesRefuse("PARAMETRER");
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
        .Select(n => new NatureDto(n.NatId, n.NatCode, n.NatLibelle, n.NatRgnCode, n.NatAxeAnalytique, n.NatCompteAchat, n.NatCompteVente, n.NatActif, n.NatIsolant)).ToList();

    public virtual async Task<List<NatureDto>> EnregistrerNature(NatureDto d, Utilisateur u, CancellationToken ct)
    {
        Parametrage(u);
        var code = Obligatoire(d.Code, "Code").ToUpperInvariant();
        if (await db.Natures.AnyAsync(n => n.NatCode == code && n.NatId != d.Id, ct)) throw ExceptionMetier.Conflit("CODE", $"Nature {code} déjà existante");
        if (Texte(d.Regroupement) is { } rg && !await db.Regroupements.AnyAsync(r => r.RgnCode == rg, ct)) throw ExceptionMetier.Invalide("REGROUPEMENT", $"Regroupement {rg} inconnu");
        var n = d.Id > 0 ? await db.Natures.FirstOrDefaultAsync(x => x.NatId == d.Id, ct) ?? throw ExceptionMetier.Introuvable($"Nature {d.Id}") : new NatureElement();
        n.NatCode = code; n.NatLibelle = Obligatoire(d.Libelle, "Libellé"); n.NatRgnCode = Texte(d.Regroupement); n.NatAxeAnalytique = Texte(d.AxeAnalytique);
        n.NatCompteAchat = Texte(d.CompteAchat); n.NatCompteVente = Texte(d.CompteVente); n.NatActif = d.Actif; n.NatIsolant = d.Isolant;
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

    // ------------------------------------------------------------------ tarifs fournisseurs et recalcul

    private static string? Date(DateOnly? d) => d?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static TarifDto VersDto(TarifFournisseur t) => new(t.TfoId, t.TfoFournisseur, t.TfoTiersId, t.TfoReference, t.TfoLibelle, t.TfoUntCode, t.TfoPrix,
        Date(t.TfoDebut), Date(t.TfoFin), t.TfoPrincipal, t.TfoLien, t.TfoMajLe, t.TfoMajPar);

    public virtual async Task<List<TarifDto>> Tarifs(long eleId, CancellationToken ct) =>
        (await db.Tarifs.AsNoTracking().Where(t => t.TfoEleId == eleId).OrderByDescending(t => t.TfoPrincipal).ThenBy(t => t.TfoFournisseur).ThenBy(t => t.TfoId).ToListAsync(ct))
        .Select(VersDto).ToList();

    /// <summary>Tarifs au format du calcul (prix, unité, principal, validité).</summary>
    public virtual async Task<List<TarifCalcul>> TarifsCalcul(long eleId, CancellationToken ct) =>
        (await db.Tarifs.AsNoTracking().Where(t => t.TfoEleId == eleId).ToListAsync(ct))
        .Select(t => new TarifCalcul { Prix = t.TfoPrix, Unite = t.TfoUntCode, Principal = t.TfoPrincipal, Debut = Date(t.TfoDebut), Fin = Date(t.TfoFin) }).ToList();

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
    public static readonly string[] CodesTechniques = ["poids", "surface", "surface_peinture", "volume", "hauteur", "largeur", "epaisseur", "isolant_r", "isolant_lambda", "isolant_u"];

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
        ["hauteur"] = e.EleHauteur, ["largeur"] = e.EleLargeur, ["epaisseur"] = e.EleEpaisseur,
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
        if (e.EleType == "OUVRAGE") return new PrixElementDto(e.ElePa, e.ElePr, e.ElePv, e.EleCoefBenef, e.ElePvNet, []);
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
        if (d.Prix < 0) throw ExceptionMetier.Invalide("PRIX", "Prix négatif");
        DateOnly? Lire(string? s) => string.IsNullOrWhiteSpace(s) ? null : DateOnly.ParseExact(s[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var debut = Lire(d.Debut);
        var fin = Lire(d.Fin);
        if (debut is { } a && fin is { } b && b < a) throw ExceptionMetier.Invalide("DATES", "Fin de validité avant le début");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var t = d.Id > 0 ? await db.Tarifs.FirstOrDefaultAsync(x => x.TfoId == d.Id && x.TfoEleId == eleId, ct) ?? throw ExceptionMetier.Introuvable($"Tarif {d.Id}") : new TarifFournisseur { TfoEleId = eleId };
        // Un seul tarif principal par élément.
        if (d.Principal) await db.Tarifs.Where(x => x.TfoEleId == eleId && x.TfoPrincipal && x.TfoId != d.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.TfoPrincipal, false), ct);
        t.TfoFournisseur = Obligatoire(d.Fournisseur, "Fournisseur"); t.TfoTiersId = d.TiersId; t.TfoReference = Texte(d.Reference); t.TfoLibelle = Texte(d.Libelle);
        t.TfoUntCode = Obligatoire(d.Unite, "Unité"); t.TfoPrix = d.Prix; t.TfoDebut = debut; t.TfoFin = fin; t.TfoPrincipal = d.Principal;
        t.TfoLien = Texte(d.Lien); t.TfoMajLe = DateTimeOffset.UtcNow; t.TfoMajPar = u.Code;
        if (t.TfoId == 0) db.Tarifs.Add(t);
        await db.SaveChangesAsync(ct);
        var r = await ApresTarif(eleId, $"Tarif fournisseur {t.TfoFournisseur} : {t.TfoPrix.ToString("0.######", CultureInfo.InvariantCulture)} / {t.TfoUntCode}", u, ct);
        await tx.CommitAsync(ct);
        return r;
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
        e.ElePa, e.EleCoefFg, e.ElePr, e.EleCoefBenef, e.ElePv, e.ElePvFixe, e.EleCoefRemise, e.ElePvNet, e.EleComposition?.RootElement.Clone(), e.EleActif);

    public virtual async Task<ElementDetailDto> Element(long id, CancellationToken ct)
    {
        var x = await (from e in db.Elements.AsNoTracking() join b in db.Bibliotheques.AsNoTracking() on e.EleBibId equals b.BibId where e.EleId == id select new { e, b.BibCode })
            .FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Élément {id}");
        return VersDetail(x.e, x.BibCode);
    }

    /// <summary>
    /// Appel par code : « CODE » dans la bibliothèque du document (ou la bibliothèque par défaut), « BIB:CODE » dans une
    /// autre bibliothèque. Élément actif uniquement.
    /// </summary>
    public virtual async Task<ElementDetailDto> Appel(string saisie, string? bibliotheque, CancellationToken ct)
    {
        var defaut = Texte(bibliotheque)?.ToUpperInvariant()
            ?? await db.Bibliotheques.AsNoTracking().Where(b => b.BibDefaut).Select(b => b.BibCode).FirstOrDefaultAsync(ct);
        var (bib, code) = CalculElement.AnalyserCodeAppel(Obligatoire(saisie, "Code"), defaut);
        var x = await (from e in db.Elements.AsNoTracking() join b in db.Bibliotheques.AsNoTracking() on e.EleBibId equals b.BibId
                       where b.BibCode == bib && e.EleCode == code && e.EleActif
                       select new { e, b.BibCode }).FirstOrDefaultAsync(ct)
            ?? throw ExceptionMetier.Introuvable($"Élément {code} dans la bibliothèque {bib}");
        return VersDetail(x.e, x.BibCode);
    }

    // ------------------------------------------------------------------ historique et recherche

    public virtual async Task<List<HistoriqueDto>> Historique(long eleId, CancellationToken ct) =>
        (await db.Historique.AsNoTracking().Where(h => h.HpeEleId == eleId).OrderByDescending(h => h.HpeDate).ThenByDescending(h => h.HpeId).Take(500).ToListAsync(ct))
        .Select(h => new HistoriqueDto(h.HpeId, h.HpeDate, h.HpeAuteur, h.HpeCommentaire, h.HpeAvant?.RootElement.Clone(), h.HpeApres.RootElement.Clone())).ToList();

    /// <summary>Recherche d'éléments (code ou libellé, sans accent ni casse) : composition des ouvrages, appel dans les documents.</summary>
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
            q = q.Where(x => EF.Functions.ILike(EF.Functions.Unaccent(x.e.EleCode + " " + (x.e.EleLibelle ?? "")), EF.Functions.Unaccent(motif)));
        }
        return (await q.OrderBy(x => x.e.EleCode).Take(50).ToListAsync(ct))
            .Select(x => new ElementRechercheDto(x.e.EleId, x.BibCode, x.e.EleCode, x.e.EleType, x.e.EleLibelle, x.e.EleLibelleHtml, x.e.EleUntStock,
                x.e.ElePa, x.e.ElePr, x.e.ElePv, x.e.ElePvNet, x.e.EleCoefFg, x.e.EleCoefBenef)).ToList();
    }
}
