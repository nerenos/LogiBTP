namespace LogiBTP.Rentabilite;

/// <summary>
/// Une donnée élémentaire (ligne de pièce, pointage, tâche, mouvement) : indicateur, date, chantier, ordre, nature,
/// montants PA / PR / PV et référence de sa source (ANALYSE-MODULE-ANALYSE.md § 3). Les montants sont gardés à six
/// décimales (échelle de la colonne) : <see cref="Normaliser"/> avant toute comparaison avec des faits relus.
/// </summary>
public sealed record Fait(
    int ChaId,
    long? OrdreId,
    int? MarId,
    string Indicateur,
    string Composante,
    DateOnly Date,
    int? NatId,
    decimal? Qte,
    string? Unite,
    decimal MontantPa,
    decimal MontantPr,
    decimal MontantPv,
    decimal? Heures,
    string SourceType,
    string? TypePiece,
    long? EntId,
    long? LigId,
    long? SourceId,
    string Regle,
    string? Libelle)
{
    private static decimal R(decimal v) => decimal.Round(v, 6, MidpointRounding.AwayFromZero) + 0.000000m;
    private static decimal? R(decimal? v) => v is { } x ? R(x) : null;

    /// <summary>Montants et quantités à l'échelle de la base (six décimales, zéros de fin uniformes).</summary>
    public Fait Normaliser() => this with
    {
        Qte = R(Qte), MontantPa = R(MontantPa), MontantPr = R(MontantPr), MontantPv = R(MontantPv), Heures = R(Heures),
        Unite = string.IsNullOrWhiteSpace(Unite) ? null : Unite, Libelle = string.IsNullOrWhiteSpace(Libelle) ? null : Libelle,
    };

    /// <summary>Identité d'un fait (source et rôle), sans ses valeurs : sert à reconnaître un fait modifié.</summary>
    public string Cle => $"{SourceType}|{EntId}|{LigId}|{SourceId}|{Indicateur}|{Composante}|{Regle}";
}
