using LogiBTP.Socle.Web;

namespace LogiBTP.Relances.Web;

/// <summary>
/// Pièce de l'application en attente de paiement ou de réponse : identifiant et groupe d'indices (le journal d'un
/// indice vaut pour les autres), nature, tiers et chargé (identifiants et noms), départ et montant (devis), échéances
/// (facture), arrêt (annulée, remplacée, transformée, expirée…), numéro affiché.
/// </summary>
public sealed record PieceEnAttente(
    long Id,
    string Nature,
    long TiersId,
    long? ChargeId = null,
    DateOnly? Depart = null,
    decimal Montant = 0,
    IReadOnlyList<EcheanceRelance>? Echeances = null,
    bool Arretee = false,
    long? GroupeId = null,
    string? Numero = null,
    string? Tiers = null,
    string? Charge = null);

/// <summary>Filtre des pièces en attente : tiers, identifiants de pièces.</summary>
public sealed record FiltrePieces(long? TiersId = null, IReadOnlyCollection<long>? Pieces = null);

/// <summary>Surcharge d'un tiers (lot 5 du cœur) : règle propre, « ne pas relancer », mode préféré (Q6, Q21).</summary>
public sealed record SurchargeTiers(RegleRelance? Regle = null, bool NePasRelancer = false, string? ModePrefere = null);

/// <summary>Portée d'un utilisateur (Q9) : tout, ou les pièces des chargés listés (une pièce sans chargé : portée TOUT seule).</summary>
public sealed record PorteeRelance(bool Tout, IReadOnlyCollection<long> Charges)
{
    public static readonly PorteeRelance Toutes = new(true, []);

    public bool Couvre(long? charge) => Tout || (charge is long c && Charges.Contains(c));
}

/// <summary>Pièce d'un envoi : relance du journal, pièce, niveau propre, jours de retard, montant relancé.</summary>
public sealed record PieceEnvoi(long RelanceId, long PieceId, int Niveau, int Jours, decimal Montant);

/// <summary>
/// Envoi d'une relance groupée (tiers, chargé, nature, mode) : niveau le plus élevé et ses modèles, pièces, commentaire,
/// auteur et date de l'envoi.
/// </summary>
public sealed record EnvoiRelance(long LotId, int Groupe, long TiersId, long? ChargeId, string Nature, string Mode, int Niveau,
    long? ModeleCourriel, long? ModeleEdition, IReadOnlyList<PieceEnvoi> Pieces, string? Commentaire, Utilisateur Auteur, DateOnly Date);

/// <summary>
/// Résultat d'un envoi : état (ENVOYEE, ou ATTENTE_NUMERO pour un recommandé), courriel mis en file, document rangé en
/// GED, mode réellement employé (bascule du courriel en courrier, Q21 ; null : inchangé).
/// </summary>
public sealed record ResultatEnvoi(string Etat, long? CourrielId = null, long? GedId = null, string? Mode = null);

/// <summary>
/// Spécialisation du module Relances (méthode patron) : l'application fournit ses pièces en attente, les surcharges de
/// ses tiers, la portée de l'utilisateur et l'envoi par mode. Sans spécialisation : aucune pièce ; un envoi est
/// seulement inscrit au journal (recommandé : en attente de son numéro).
/// </summary>
public class SpecialisationRelance
{
    public virtual Task<List<PieceEnAttente>> PiecesEnAttenteAsync(RelanceDbContext db, FiltrePieces filtre, CancellationToken ct) =>
        Task.FromResult(new List<PieceEnAttente>());

    /// <summary>Surcharges des tiers listés (absent : règle de la nature).</summary>
    public virtual Task<Dictionary<long, SurchargeTiers>> RegleDuTiersAsync(RelanceDbContext db, IReadOnlyCollection<long> tiers, CancellationToken ct) =>
        Task.FromResult(new Dictionary<long, SurchargeTiers>());

    /// <summary>Portée de l'utilisateur sur les pièces (par chargé) ; TOUT par défaut.</summary>
    public virtual Task<PorteeRelance> PorteeAsync(RelanceDbContext db, Utilisateur utilisateur, CancellationToken ct) =>
        Task.FromResult(PorteeRelance.Toutes);

    /// <summary>Envoi d'une relance groupée selon son mode ; une exception laisse le groupe proposé (échec signalé).</summary>
    public virtual Task<ResultatEnvoi> EnvoyerAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct) => envoi.Mode switch
    {
        ModeRelance.Courriel => EnvoyerCourrielAsync(db, envoi, ct),
        ModeRelance.Courrier => EnvoyerCourrierAsync(db, envoi, ct),
        ModeRelance.Recommande => EnvoyerRecommandeAsync(db, envoi, ct),
        ModeRelance.Tache => CreerTacheAsync(db, envoi, ct),
        _ => throw ExceptionMetier.Invalide(ErreurRelance.Mode, $"Mode de relance {envoi.Mode} inconnu"),
    };

    public virtual Task<ResultatEnvoi> EnvoyerCourrielAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct) =>
        Task.FromResult(new ResultatEnvoi(EtatRelance.Envoyee));

    public virtual Task<ResultatEnvoi> EnvoyerCourrierAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct) =>
        Task.FromResult(new ResultatEnvoi(EtatRelance.Envoyee));

    /// <summary>Lettre recommandée : en attente de son numéro jusqu'à la saisie (Q12).</summary>
    public virtual Task<ResultatEnvoi> EnvoyerRecommandeAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct) =>
        Task.FromResult(new ResultatEnvoi(EtatRelance.AttenteNumero));

    /// <summary>Tâche d'appel du CRM (devis seulement, Q16).</summary>
    public virtual Task<ResultatEnvoi> CreerTacheAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct) =>
        Task.FromResult(new ResultatEnvoi(EtatRelance.Envoyee));

    /// <summary>Après l'inscription au journal des relances faites (envoi validé, relance notée) : note du CRM, indicateurs…</summary>
    public virtual Task ApresEnvoiAsync(RelanceDbContext db, IReadOnlyList<RelanceDto> relances, CancellationToken ct) => Task.CompletedTask;

    /// <summary>Seuil sous lequel une échéance est soldée ; 0 par défaut.</summary>
    public virtual decimal Seuil => 0;
}
