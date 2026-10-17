namespace LogiBTP.Reglements.Web;

/// <summary>
/// Échéance d'une pièce de l'application (facture, avoir…) : identifiant, pièce, tiers, sens E (à encaisser) ou D (à
/// payer), date (nulle : retenue non libérée), montant signé, nature NORMALE / RETENUE, objet (marché…).
/// </summary>
public sealed record EcheanceSource(long Id, long PieceId, string? Piece, string Type, long TiersId, string? Tiers, string Sens,
    DateOnly? Date, decimal Montant, string Nature, long? ObjetId);

/// <summary>Filtre des échéances : tiers, sens, identifiants d'échéances ou de pièces, objet (marché).</summary>
public sealed record FiltreEcheances(long? TiersId = null, string? Sens = null, IReadOnlyCollection<long>? Ids = null,
    IReadOnlyCollection<long>? Pieces = null, long? ObjetId = null);

/// <summary>Tiers ayant des échéances : identifiant, nom, sens.</summary>
public sealed record TiersReglement(long Id, string Nom, string Sens);

/// <summary>
/// Spécialisation du module Règlements (méthode patron) : l'application fournit ses échéances et ses tiers ; sans
/// spécialisation, aucune échéance (le module reste utilisable pour saisir des règlements non pointés).
/// </summary>
public class SpecialisationReglement
{
    public virtual Task<List<EcheanceSource>> EcheancesAsync(ReglementDbContext db, FiltreEcheances filtre, CancellationToken ct) =>
        Task.FromResult(new List<EcheanceSource>());

    public virtual Task<List<TiersReglement>> TiersAsync(ReglementDbContext db, CancellationToken ct) =>
        Task.FromResult(new List<TiersReglement>());

    /// <summary>
    /// Après un changement de pointages (règlement ou caution enregistré ou supprimé) : échéances touchées, pour que
    /// l'application mette à jour l'état de paiement de leurs pièces (statuts PAYE_PARTIEL, PAYE).
    /// </summary>
    public virtual Task ApresPointageAsync(ReglementDbContext db, IReadOnlyCollection<long> echeances, CancellationToken ct) => Task.CompletedTask;

    /// <summary>Seuil d'écart sous lequel une échéance est réglée (centimes) ; 0 par défaut.</summary>
    public virtual decimal Seuil => 0;
}
