using System.Globalization;
using System.Text.Json;
using LogiBTP.Annuaire;
using LogiBTP.Annuaire.Web;
using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Fiches;
using LogiBTP.Fiches.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Listes;
using LogiBTP.Listes.Web;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Fiches du cœur (salarié, matériel, élément de bibliothèque, personne et individu de l'annuaire) : contrôles métier,
/// répliques de validerMetier (client/src/app/fiches/fiches.js, fiche-annuaire.js) ; prix des éléments recalculés avant
/// écriture ; champs gérés de l'annuaire (coordonnées, rattachements, liens) délégués à ServiceAnnuaire.
/// </summary>
public sealed class SpecialisationFicheBtp(IServiceScopeFactory scopes) : SpecialisationFiche
{
    private static readonly LogiBTP.Documents.Web.NettoyageHtml Html = new();

    /// <summary>Champs des fiches de la structure qui désignent un individu de notre structure (code du champ, libellé).</summary>
    private static readonly Dictionary<string, (string Champ, string Libelle)[]> ChampsIndividuStructure = new()
    {
        [TypesFiche.Chantier] = [("conducteur_ind_id", "Conducteur de travaux"), ("charge_ind_id", "Chargé d'affaires"), ("chef_ind_id", "Chef d'équipe")],
        [TypesFiche.Projet] = [("responsable_ind_id", "Responsable"), ("metreur_ind_id", "Métreur")],
    };

    /// <summary>Champs HTML des fiches (libellé d'un élément de bibliothèque…) : même liste blanche que les libellés des documents.</summary>
    public override string NettoyerHtml(string html) => Html.Nettoyer(html) ?? "";

    private static bool Annuaire(string type) => type is TypesFiche.Personne or TypesFiche.Individu;

    public override async Task AvantEcritureAsync(string type, bool creation, string? id, Dictionary<string, string?> aEcrire,
        IReadOnlyDictionary<string, object?> valeurs, IReadOnlyDictionary<string, object?> proprietes, Utilisateur u, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        // État d'utilisation (db/228) : « actif » suit l'usage saisi (en sommeil = inactif ; le trigger fait de même en base).
        if (aEcrire.ContainsKey("usage") && valeurs.ContainsKey("actif"))
        {
            var actif = Convert.ToString(valeurs.GetValueOrDefault("usage"), System.Globalization.CultureInfo.InvariantCulture) != "S";
            aEcrire["actif"] = actif ? "true" : "false";
            valeurs = new Dictionary<string, object?>(valeurs) { ["actif"] = actif };
        }
        if (type == TypesFiche.Element)
        {
            await ElementsBibliotheque.AvantEcriture(scope.ServiceProvider, id, aEcrire, valeurs, proprietes, u, ct);
            return;
        }
        if (type == TypesFiche.Salarie) await SalariesAnnuaire.Synchroniser(scope.ServiceProvider, valeurs, ct);
        // Conducteur de travaux, chargé d'affaires, chef d'équipe d'un chantier, responsable et métreur d'un projet (lot 6) :
        // individus de notre structure (rattachés à notre société ou à un niveau inférieur).
        if (ChampsIndividuStructure.TryGetValue(type, out var champsIndividus))
        {
            foreach (var (champ, libelle) in champsIndividus)
            {
                if (ValidationFiche.Nombre(valeurs.GetValueOrDefault(champ)) is { } individu
                    && !await IndividusStructure.EstDeLaStructureAsync(scope.ServiceProvider.GetRequiredService<LogiBtpContext>(), (long)individu, ct))
                {
                    throw ExceptionMetier.Invalide(champ == "conducteur_ind_id" ? "CONDUCTEUR_STRUCTURE" : "INDIVIDU_STRUCTURE",
                        $"{libelle} : un individu de notre société (ou de l'une de ses agences)");
                }
            }
        }
        if (type == TypesFiche.Personne)
        {
            // Identifiants enregistrés sans espaces ; pays en majuscules (comme FichePersonne.enregistrer).
            foreach (var k in new[] { "siren", "siret", "tva_intra", "iban", "bic" })
                if (aEcrire.TryGetValue(k, out var v) && v is not null) aEcrire[k] = Identifiants.Compacter(v);
            if (aEcrire.TryGetValue("pays", out var p) && p is not null) aEcrire["pays"] = p.Trim().ToUpperInvariant();
            await scope.ServiceProvider.GetRequiredService<ServiceAnnuaire>().ControlerPersonne(id is null ? null : long.Parse(id),
                Vrai(valeurs.GetValueOrDefault("societe_base")), valeurs.GetValueOrDefault("siret")?.ToString(),
                ValidationFiche.Nombre(valeurs.GetValueOrDefault("parent_id")) is { } parent ? (long)parent : null, ct);
        }
        await base.AvantEcritureAsync(type, creation, id, aEcrire, valeurs, proprietes, u, ct);
    }

    /// <summary>
    /// Chrono d'un marché ({PARENT}) : code de son chantier sans le préfixe du chrono des chantiers (CH-2026-002 →
    /// 2026-002, d'où M-2026-002-1).
    /// </summary>
    public override async Task<string?> CodeParentChronoAsync(string type, string champ, string valeur, CancellationToken ct)
    {
        if (type != TypesFiche.Marche || champ != "cha_id" || !long.TryParse(valeur, NumberStyles.None, CultureInfo.InvariantCulture, out var cha)) return null;
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<LogiBtpContext>();
        var l = await db.Database.SqlQuery<ParentChrono>($"""
            SELECT c.cha_code AS code, coalesce(p.chf_prefixe, t.tyf_definition -> 'chrono' ->> 'prefixe') AS prefixe
            FROM chantier c CROSS JOIN type_fiche t
            LEFT JOIN chrono_fiche p ON p.chf_type = t.tyf_code AND p.chf_variante = ''
            WHERE c.cha_id = {cha} AND t.tyf_code = 'chantier'
            """).FirstOrDefaultAsync(ct);
        if (l?.Code is not { } code) return null;
        return !string.IsNullOrEmpty(l.Prefixe) && code.StartsWith(l.Prefixe, StringComparison.Ordinal) && code.Length > l.Prefixe.Length ? code[l.Prefixe.Length..] : code;
    }

    private sealed record ParentChrono(string? Code, string? Prefixe);

    public override async Task AvantSuppressionAsync(string type, string id, Utilisateur u, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        await SuppressionFiches.Controler(scope.ServiceProvider.GetRequiredService<LogiBtpContext>(), type, id, ct);
    }

    private static bool Vrai(object? v) => v is true || (v is string s && s == "true") || (v is JsonElement e && e.ValueKind == JsonValueKind.True);

    public override async Task<IReadOnlyDictionary<string, object?>> LireGeresAsync(string type, string id, Utilisateur u, CancellationToken ct)
    {
        if (Intervenants.Gere(type))
        {
            using var s = scopes.CreateScope();
            return new Dictionary<string, object?> { ["intervenants"] = await Intervenants.Lire(s.ServiceProvider.GetRequiredService<LogiBtpContext>(), type, long.Parse(id), ct) };
        }
        if (!Annuaire(type)) return await base.LireGeresAsync(type, id, u, ct);
        using var scope = scopes.CreateScope();
        var geres = new Dictionary<string, object?>(await scope.ServiceProvider.GetRequiredService<ServiceAnnuaire>().LireGeres(type, long.Parse(id), ct));
        // Fiche individu : salarié lié (module salariés du cœur).
        if (type == TypesFiche.Individu) geres["salarie"] = await SalariesAnnuaire.Salarie(scope.ServiceProvider, long.Parse(id), ct);
        return geres;
    }

    public override async Task ValiderGeresAsync(string type, string? id, IReadOnlyDictionary<string, JsonElement> geres, IReadOnlyDictionary<string, object?> valeurs, Utilisateur u, CancellationToken ct)
    {
        if (Intervenants.Gere(type) && geres.TryGetValue("intervenants", out var itv))
        {
            using var s = scopes.CreateScope();
            await Intervenants.Valider(s.ServiceProvider.GetRequiredService<LogiBtpContext>(), Intervenants.Lus(itv), 'S', ct);
            return;
        }
        if (!Annuaire(type) || geres.Count == 0) return;
        using var scope = scopes.CreateScope();
        await scope.ServiceProvider.GetRequiredService<ServiceAnnuaire>().ValiderGeres(type, id is null ? null : long.Parse(id), geres, ct);
    }

    public override async Task EcrireGeresAsync(string type, string id, bool creation, IReadOnlyDictionary<string, JsonElement> geres, IReadOnlyDictionary<string, object?> valeurs, Utilisateur u, CancellationToken ct)
    {
        if (Intervenants.Gere(type))
        {
            if (!geres.TryGetValue("intervenants", out var itv)) return;
            using var s = scopes.CreateScope();
            await Intervenants.Ecrire(s.ServiceProvider.GetRequiredService<LogiBtpContext>(), type, long.Parse(id), Intervenants.Lus(itv), ct);
            return;
        }
        if (!Annuaire(type)) { await base.EcrireGeresAsync(type, id, creation, geres, valeurs, u, ct); return; }
        using var scope = scopes.CreateScope();
        await scope.ServiceProvider.GetRequiredService<ServiceAnnuaire>().EcrireGeres(type, long.Parse(id), geres, u, ct);
    }

    private static string? Date(object? v) => v?.ToString() is { Length: >= 10 } s ? s[..10] : null;
    private static string Aujourdhui => DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public override IEnumerable<ErreurChamp> ValiderMetier(string type, IReadOnlyDictionary<string, object?> v, IReadOnlyDictionary<string, object?> proprietes)
    {
        switch (type)
        {
            case TypesFiche.Personne:
                string? T(string k) => v.GetValueOrDefault(k)?.ToString();
                foreach (var e in Identifiants.Erreurs(new(T("pays"), T("siren"), T("siret"), T("tva_intra"), T("iban"), T("bic")))) yield return new(e.Champ, "METIER", e.Message);
                break;
            case TypesFiche.Salarie:
                var entree = Date(v.GetValueOrDefault("date_entree"));
                var naissance = Date(v.GetValueOrDefault("date_naissance"));
                if (entree is not null && string.CompareOrdinal(entree, Aujourdhui) > 0) yield return new("date_entree", "METIER", "Date d'entrée dans le futur");
                if (naissance is not null)
                {
                    if (DateTime.Parse(naissance, CultureInfo.InvariantCulture).AddYears(15) > DateTime.Today) yield return new("date_naissance", "METIER", "Âge inférieur à 15 ans");
                    if (entree is not null && string.CompareOrdinal(naissance, entree) >= 0) yield return new("date_naissance", "METIER", "Naissance postérieure à l'entrée");
                }
                break;
            case TypesFiche.Materiel:
                if (ValidationFiche.Nombre(v.GetValueOrDefault("heures_utilisation")) is < 0) yield return new("heures_utilisation", "METIER", "Nombre d'heures négatif");
                var achat = Date(v.GetValueOrDefault("date_achat"));
                if (achat is not null && string.CompareOrdinal(achat, Aujourdhui) > 0) yield return new("date_achat", "METIER", "Date d'achat dans le futur");
                if (v.GetValueOrDefault("etat") as string == "CHANTIER" && string.IsNullOrWhiteSpace(v.GetValueOrDefault("chantier") as string))
                    yield return new("chantier", "METIER", "Chantier à préciser pour un matériel en chantier");
                break;
        }
    }
}

/// <summary>
/// Listes du cœur : une saisie dans une liste est refusée si la fiche de la ligne est en cours de modification par
/// quelqu'un (le verrou de la fiche protège aussi les saisies rapides).
/// </summary>
public sealed class SpecialisationListeBtp(IServiceScopeFactory scopes) : SpecialisationListe
{
    private static readonly Dictionary<string, string> FicheParSource = new() { ["salaries"] = TypesFiche.Salarie, ["materiels"] = TypesFiche.Materiel };

    /// <summary>Fiche dont les champs confidentiels sont masqués dans la liste de chaque source (RGPD).</summary>
    private static readonly Dictionary<string, string> FicheRgpd = new()
    {
        ["salaries"] = TypesFiche.Salarie, ["materiels"] = TypesFiche.Materiel, ["personnes"] = TypesFiche.Personne, ["individus"] = TypesFiche.Individu, ["elements"] = TypesFiche.Element,
        ["projets"] = TypesFiche.Projet, ["affaires"] = TypesFiche.Affaire, ["chantiers"] = TypesFiche.Chantier, ["marches"] = TypesFiche.Marche, ["marches_st"] = TypesFiche.Marche,
    };

    private sealed record TypeElement(string Code, string? Famille);

    /// <summary>
    /// Droits du module Droits appliqués aux listes : lignes des types de documents (documents/{famille}/{code}) et des
    /// types de fiches (fiches/{type}) que l'utilisateur ne peut pas consulter écartées ; champs confidentiels de la fiche
    /// de la source masqués sans le droit RGPD de la fiche (jamais lus, cherchés, triés ni filtrés).
    /// </summary>
    public override async Task<RestrictionListe> RestrictionAsync(SourceResolue source, Utilisateur u, CancellationToken ct)
    {
        var services = SpecialisationBtp.Http?.HttpContext?.RequestServices;
        if (services?.GetService<IDroits>() is not { } droits) return RestrictionListe.Aucune;
        var db = services.GetRequiredService<LogiBtpContext>();
        var types = await db.Database.SqlQueryRaw<TypeElement>("""
            SELECT tyd_code AS "Code", tyd_famille::text AS "Famille" FROM type_document
            UNION ALL SELECT tyf_code, NULL FROM type_fiche
            """).ToListAsync(ct);
        var refuses = new List<string>();
        foreach (var t in types)
        {
            var noeud = t.Famille is null ? $"fiches/{t.Code}" : FamillesDocument.NoeudDroits(t.Famille, t.Code);
            if (!await droits.AutoriseAsync(u, noeud, ActionsDroits.Consulter, ct)) refuses.Add(t.Code);
        }
        var masquees = new HashSet<string>(StringComparer.Ordinal);
        if (source.Code is not null && FicheRgpd.TryGetValue(source.Code, out var fiche) && !await droits.AutoriseAsync(u, $"fiches/{fiche}", ActionsDroits.Rgpd, ct))
        {
            var type = await services.GetRequiredService<ServiceFiche>().Type(fiche, ct);
            var colonnes = source.Colonnes.Select(c => c.Code).ToHashSet(StringComparer.Ordinal);
            masquees.UnionWith(type.Definition.Champs.Concat(type.Supplementaires).Where(c => c.Confidentiel).Select(c => c.Code).Where(colonnes.Contains));
        }
        return new RestrictionListe(refuses, masquees);
    }

    public override async Task ValiderModification(SourceResolue source, string id, IReadOnlyDictionary<string, string?> valeurs, Utilisateur u, CancellationToken ct)
    {
        if (source.Code is null || !FicheParSource.TryGetValue(source.Code, out var type)) return;
        using var scope = scopes.CreateScope();
        var verrou = await scope.ServiceProvider.GetRequiredService<ServiceFiche>().Verrou(type, id, null, ct);
        if (verrou is not null)
        {
            throw ExceptionMetier.Conflit(ErreursFiche.FicheEnModification, $"Fiche en cours de modification par {verrou.Utilisateur} : saisie impossible pour l'instant", verrou);
        }
    }
}

/// <summary>
/// GED du cœur : répertoire de stockage et taille maximale lus dans la configuration (section Ged). Un chemin relatif
/// est pris depuis le répertoire de l'application.
/// </summary>
public sealed class SpecialisationGedBtp(IConfiguration configuration, IHostEnvironment environnement) : SpecialisationGed
{
    public override string RepertoireStockage =>
        Path.Combine(environnement.ContentRootPath, configuration["Ged:Repertoire"] ?? "stockage-ged");

    public override long TailleMaxDepot => (configuration.GetValue<long?>("Ged:TailleMaxDepotMo") ?? 200) * 1024 * 1024;
}
