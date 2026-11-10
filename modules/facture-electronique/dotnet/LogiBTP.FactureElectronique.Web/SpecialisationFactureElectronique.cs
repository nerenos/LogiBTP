using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle.Web;

namespace LogiBTP.FactureElectronique.Web;

/// <summary>Élément de l'application lié à un flux (pièce, fiche…) : type et identifiant, sans clé vers le cœur.</summary>
public sealed record ElementFe(string Type, string Id);

/// <summary>Facture reçue d'une plateforme ou importée : flux enregistré, modèle lu (null si illisible), syntaxe lue.</summary>
public sealed record FactureRecueFe(FluxFe Flux, Facture? Facture, string? Syntaxe);

/// <summary>
/// Réponse de l'application à une facture reçue (lot 12) : pièce créée (<see cref="Element"/>, <see cref="Detail"/>
/// inscrit au journal à l'étape PIECE_CREEE), ou création refusée (<see cref="Refus"/> : code d'<see cref="ErreurFe"/>,
/// <see cref="ErreurFe.FactureEnDouble"/> pour un doublon, message, élément déjà enregistré dans <see cref="Element"/>) : étape
/// DOUBLON, la facture reste à traiter. <see cref="Statuts"/> (lot 13) : statuts que la société pose dès le rattachement
/// de la pièce créée (Prise en charge), dans la transaction de la réception, après l'étape RATTACHEMENT.
/// </summary>
public sealed record PieceRecueFe(ElementFe? Element, object? Detail = null, string? Refus = null, string? Message = null)
{
    public IReadOnlyList<StatutAPoser> Statuts { get; init; } = [];

    public static PieceRecueFe Creee(ElementFe element, object? detail = null) => new(element, detail);
    public static PieceRecueFe Refusee(string code, string message, ElementFe? existant = null, object? detail = null) => new(existant, detail, code, message);
}

/// <summary>
/// Statut reçu ou posé, signalé à l'application : statut enregistré, flux de la facture (null : facture inconnue),
/// statut affiché avant et après (<see cref="ReglesCycleVie.StatutAffiche"/>).
/// </summary>
public sealed record StatutSignaleFe(StatutFe Statut, FluxFe? Facture, string? AfficheAvant, string? AfficheApres);

/// <summary>
/// Signalement à l'application (notification) : étape (<see cref="EvenementFe"/>), flux, état atteint, code d'erreur
/// (<see cref="ErreurFe"/> ou motif de l'accusé), message masqué.
/// </summary>
public sealed record SignalementFe(string Evenement, FluxFe Flux, string Etat, string? Code = null, string? Message = null);

/// <summary>
/// Spécialisation du module Facturation électronique (méthode patron) : l'application rattache un flux reçu à ses
/// éléments, crée la pièce d'une facture reçue, est avertie des statuts reçus et posés, range les fichiers en GED,
/// reçoit les signalements et contrôle les droits. Le module ne modifie jamais une pièce de l'application : il signale,
/// l'application décide. Sans spécialisation : aucun rattachement, rien en GED (fichiers gardés dans fe_fichier),
/// aucun signalement, toujours actif, paramétrage réservé à l'administrateur ou au droit de modifier les paramètres.
/// </summary>
public class SpecialisationFactureElectronique
{
    /// <summary>
    /// Module actif pour la société de la portée (activation par l'application) ; faux : la tâche de fond ne traite ni la
    /// file ni la relève de cette base. Par défaut : actif.
    /// </summary>
    public virtual Task<bool> ActifAsync(CancellationToken ct) => Task.FromResult(true);

    /// <summary>Élément existant auquel rattacher une facture reçue (pièce déjà saisie…) ; null : aucun.</summary>
    public virtual Task<ElementFe?> ElementDuFluxAsync(FactureRecueFe recue, CancellationToken ct) => Task.FromResult<ElementFe?>(null);

    /// <summary>
    /// Création de la pièce d'une facture reçue (brouillon, jamais validée : lot 12), ou refus (doublon) ; null : la
    /// facture reste à traiter sans pièce.
    /// </summary>
    public virtual Task<PieceRecueFe?> CreerPieceRecueAsync(FactureRecueFe recue, CancellationToken ct) => Task.FromResult<PieceRecueFe?>(null);

    /// <summary>Statut reçu de la plateforme (l'application décide de ses suites : litige, avoir, relance…).</summary>
    public virtual Task StatutRecuAsync(StatutSignaleFe statut, CancellationToken ct) => Task.CompletedTask;

    /// <summary>Statut posé par la société, enregistré (et son CDAR mis en file s'il est fourni).</summary>
    public virtual Task StatutPoseAsync(StatutSignaleFe statut, CancellationToken ct) => Task.CompletedTask;

    /// <summary>Rangement d'un fichier de flux en GED (original, converti, lisible, CDAR) ; identifiant du document, ou null.</summary>
    public virtual Task<long?> RangerAsync(FluxFe flux, string document, FichierFlux fichier, CancellationToken ct) => Task.FromResult<long?>(null);

    /// <summary>Fichier d'un document de la GED quand il n'est pas gardé par le module ; null : introuvable.</summary>
    public virtual Task<FichierFlux?> LireFichierAsync(long gedId, CancellationToken ct) => Task.FromResult<FichierFlux?>(null);

    /// <summary>Signalement (erreur d'un dépôt, refus de la plateforme, facture reçue…) : notification de l'application.</summary>
    public virtual Task SignalerAsync(SignalementFe signalement, CancellationToken ct) => Task.CompletedTask;

    /// <summary>Droit de modifier les paramètres du module (403 sinon).</summary>
    public virtual void ExigerParametrage(Utilisateur u) => u.ExigerParametres();

    /// <summary>
    /// Droit d'agir sur un flux (nouvelle tentative, dépôt et import manuels : <c>ActionsDroits.Modifier</c>) ; par
    /// défaut tout utilisateur admis sur la route (droits du nœud rattaché par l'application).
    /// </summary>
    public virtual void Exiger(Utilisateur u, string action) { }
}
