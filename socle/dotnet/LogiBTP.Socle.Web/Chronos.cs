namespace LogiBTP.Socle.Web;

/// <summary>
/// Contrat du chrono des codes de fiches (implémenté par le module Fiche) pour les créations faites hors de la fiche
/// (tiers provisoire, projet créé depuis une demande…) : code suivant du type, attribué tout de suite (le compteur
/// avance). Sans implémentation enregistrée, le module garde sa propre règle.
/// </summary>
public interface IChronosFiches
{
    /// <summary>Code attribué au type de fiche selon les valeurs de la fiche à créer (portée, parent…) ; null sans chrono.</summary>
    Task<string?> AttribuerAsync(string type, IReadOnlyDictionary<string, object?> valeurs, CancellationToken ct);
}
