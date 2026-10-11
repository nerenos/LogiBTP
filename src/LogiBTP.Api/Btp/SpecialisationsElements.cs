using System.Globalization;
using LogiBTP.Fiches;
using LogiBTP.Fiches.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Listes;
using LogiBTP.Listes.Web;
using LogiBTP.Socle.Web;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Fiches du cœur (salarié, matériel) : contrôles métier, répliques de FicheSalarie.validerMetier et
/// FicheMateriel.validerMetier (client/src/app/fiches/fiches.js).
/// </summary>
public sealed class SpecialisationFicheBtp : SpecialisationFiche
{
    private static string? Date(object? v) => v?.ToString() is { Length: >= 10 } s ? s[..10] : null;
    private static string Aujourdhui => DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public override IEnumerable<ErreurChamp> ValiderMetier(string type, IReadOnlyDictionary<string, object?> v, IReadOnlyDictionary<string, object?> proprietes)
    {
        switch (type)
        {
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
