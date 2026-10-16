using System.Globalization;

namespace LogiBTP.Ged;

/// <summary>Règle de rétention et d'archivage (table regle_retention_ged).</summary>
public sealed record RegleRetentionGed(int Id, string Libelle, string? Categorie, string? TypeElement, int? DureeActiveMois,
    int? DureeConservationMois, string ActionFin = "REVOIR", int Priorite = 100, bool Actif = true);

/// <summary>Document vu par la rétention : catégorie, type d'élément lié, date du document, date de dépôt.</summary>
public sealed record DocumentRetention(string? Categorie, string? TypeElement, DateOnly? DateDocument, DateTimeOffset CreeLe);

public sealed record EcheancesRetention(int? Regle, DateOnly Base, DateOnly? ArchiverLe, DateOnly? FinLe, string? ActionFin, string Statut);

/// <summary>
/// Rétention et archivage : même règle que retention.js (jeu partagé modules/ged/tests/cas/04_retention.json).
/// Règle la plus précise (catégorie et type, catégorie seule, type seul, aucun), puis plus petite priorité, puis plus
/// petit id ; échéances en mois depuis la date du document (à défaut, date UTC du dépôt), fin de mois ramenée.
/// </summary>
public static class RegleRetention
{
    public const string Actif = "ACTIF";
    public const string AArchiver = "A_ARCHIVER";
    public const string FinConservation = "FIN_CONSERVATION";

    private static int Precision(RegleRetentionGed r) => (string.IsNullOrEmpty(r.Categorie) ? 0 : 2) + (string.IsNullOrEmpty(r.TypeElement) ? 0 : 1);

    public static RegleRetentionGed? Applicable(DocumentRetention d, IEnumerable<RegleRetentionGed> regles) =>
        regles.Where(r => r.Actif && (string.IsNullOrEmpty(r.Categorie) || r.Categorie == d.Categorie)
                && (string.IsNullOrEmpty(r.TypeElement) || r.TypeElement == d.TypeElement))
            .OrderByDescending(Precision).ThenBy(r => r.Priorite).ThenBy(r => r.Id).FirstOrDefault();

    /// <summary>Date + n mois, jour ramené au dernier jour du mois d'arrivée (comme ajouterMois en JS).</summary>
    public static DateOnly AjouterMois(DateOnly date, int mois) => date.AddMonths(mois);

    public static EcheancesRetention Echeances(DocumentRetention d, IEnumerable<RegleRetentionGed> regles, DateOnly aujourdhui)
    {
        var r = Applicable(d, regles);
        var origine = d.DateDocument ?? DateOnly.FromDateTime(d.CreeLe.UtcDateTime);
        DateOnly? archiver = r?.DureeActiveMois is { } a ? AjouterMois(origine, a) : null;
        DateOnly? fin = r?.DureeConservationMois is { } c ? AjouterMois(origine, c) : null;
        var statut = fin is { } f && aujourdhui >= f ? FinConservation : archiver is { } x && aujourdhui >= x ? AArchiver : Actif;
        return new EcheancesRetention(r?.Id, origine, archiver, fin, r?.ActionFin, statut);
    }

    public static string Iso(DateOnly? d) => d?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "";
}
