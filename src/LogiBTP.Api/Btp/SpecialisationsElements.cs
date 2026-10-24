using System.Globalization;
using System.Text.Json;
using LogiBTP.Annuaire;
using LogiBTP.Annuaire.Web;
using LogiBTP.Fiches;
using LogiBTP.Fiches.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Listes;
using LogiBTP.Listes.Web;
using LogiBTP.Socle.Web;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Fiches du cœur (salarié, matériel, élément de bibliothèque, personne et individu de l'annuaire) : contrôles métier,
/// répliques de validerMetier (client/src/app/fiches/fiches.js, fiche-annuaire.js) ; prix des éléments recalculés avant
/// écriture ; champs gérés de l'annuaire (coordonnées, rattachements, liens) délégués à ServiceAnnuaire.
/// </summary>
public sealed class SpecialisationFicheBtp(IServiceScopeFactory scopes) : SpecialisationFiche
{
    private static bool Annuaire(string type) => type is "personne" or "individu";

    public override async Task AvantEcritureAsync(string type, bool creation, string? id, Dictionary<string, string?> aEcrire,
        IReadOnlyDictionary<string, object?> valeurs, IReadOnlyDictionary<string, object?> proprietes, Utilisateur u, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        if (type == "element")
        {
            await ElementsBibliotheque.AvantEcriture(scope.ServiceProvider, id, aEcrire, valeurs, proprietes, u, ct);
            return;
        }
        if (type == "salarie") await SalariesAnnuaire.Synchroniser(scope.ServiceProvider, valeurs, ct);
        // Conducteur de travaux d'un chantier : individu de notre structure (rattaché à notre société ou à un niveau inférieur).
        if (type == "chantier" && ValidationFiche.Nombre(valeurs.GetValueOrDefault("conducteur_ind_id")) is { } conducteur
            && !await IndividusStructure.EstDeLaStructureAsync(scope.ServiceProvider.GetRequiredService<LogiBtpContext>(), (long)conducteur, ct))
        {
            throw ExceptionMetier.Invalide("CONDUCTEUR_STRUCTURE", "Le conducteur de travaux doit être un individu de notre société (ou de l'une de ses agences)");
        }
        if (type == "personne")
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
        if (type == "individu") geres["salarie"] = await SalariesAnnuaire.Salarie(scope.ServiceProvider, long.Parse(id), ct);
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
            case "personne":
                string? T(string k) => v.GetValueOrDefault(k)?.ToString();
                foreach (var e in Identifiants.Erreurs(new(T("pays"), T("siren"), T("siret"), T("tva_intra"), T("iban"), T("bic")))) yield return new(e.Champ, "METIER", e.Message);
                break;
            case "salarie":
                var entree = Date(v.GetValueOrDefault("date_entree"));
                var naissance = Date(v.GetValueOrDefault("date_naissance"));
                if (entree is not null && string.CompareOrdinal(entree, Aujourdhui) > 0) yield return new("date_entree", "METIER", "Date d'entrée dans le futur");
                if (naissance is not null)
                {
                    if (DateTime.Parse(naissance, CultureInfo.InvariantCulture).AddYears(15) > DateTime.Today) yield return new("date_naissance", "METIER", "Âge inférieur à 15 ans");
                    if (entree is not null && string.CompareOrdinal(naissance, entree) >= 0) yield return new("date_naissance", "METIER", "Naissance postérieure à l'entrée");
                }
                break;
            case "materiel":
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
    private static readonly Dictionary<string, string> FicheParSource = new() { ["salaries"] = "salarie", ["materiels"] = "materiel" };

    public override async Task ValiderModification(SourceResolue source, string id, IReadOnlyDictionary<string, string?> valeurs, Utilisateur u, CancellationToken ct)
    {
        if (source.Code is null || !FicheParSource.TryGetValue(source.Code, out var type)) return;
        using var scope = scopes.CreateScope();
        var verrou = await scope.ServiceProvider.GetRequiredService<ServiceFiche>().Verrou(type, id, null, ct);
        if (verrou is not null)
        {
            throw ExceptionMetier.Conflit("FICHE_EN_MODIFICATION", $"Fiche en cours de modification par {verrou.Utilisateur} : saisie impossible pour l'instant", verrou);
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
