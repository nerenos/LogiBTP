using LogiBTP.Socle.Web;

namespace LogiBTP.Mail.Web;

/// <summary>
/// Points d'accroche du module Mail (méthode patron), implémentés par l'application : usages connus, description d'un
/// élément d'où part un envoi (variables des modèles, destinataires et pièces proposés), pièces jointes (références
/// « ged:&lt;id&gt; »…), conséquences d'un envoi (GED, statut, suivi), adresses et destinataires des signaux. Le module ne
/// connaît ni la GED, ni les documents, ni le CRM, ni les notifications.
/// </summary>
public abstract class SpecialisationMail
{
    /// <summary>Usages proposés dans le paramétrage (alias par usage).</summary>
    public virtual IReadOnlyList<UsageConnu> Usages { get; } =
    [
        new("NOTIFICATION", "Notifications"), new("AUTHENTIFICATION", "Connexion (mot de passe oublié…)"), new("DOCUMENT_VENTE", "Pièces de vente"),
        new("DOCUMENT_ACHAT", "Pièces d'achat"), new("RELANCE", "Relances"), new("SAV", "SAV"), new("PAIE", "Paie et pointage"), new("CRM", "Suivi (CRM)"),
        new("GENERAL", "Autres envois"),
    ];

    public virtual Task<ElementMail?> DecrireAsync(string type, string id, Utilisateur u, CancellationToken ct) => Task.FromResult<ElementMail?>(null);

    /// <summary>Informations des pièces choisies (droit de lecture de l'utilisateur contrôlé) ; inconnue : absente.</summary>
    public virtual Task<List<PieceInfo>> PiecesAsync(IReadOnlyList<string> references, Utilisateur u, CancellationToken ct) => Task.FromResult(new List<PieceInfo>());

    /// <summary>Contenu d'une pièce au moment de l'envoi (tâche de fond).</summary>
    public virtual Task<PieceContenu?> LirePieceAsync(string reference, CancellationToken ct) => Task.FromResult<PieceContenu?>(null);

    /// <summary>Après un envoi réussi : courriel rangé (renvoie l'identifiant du document GED), statut, suivi.</summary>
    public virtual Task<long?> ApresEnvoiAsync(CourrielEnvoye c, CancellationToken ct) => Task.FromResult<long?>(null);

    /// <summary>Adresse de courriel d'un utilisateur (copie à soi).</summary>
    public virtual Task<string?> CourrielUtilisateurAsync(string utilisateur, CancellationToken ct) => Task.FromResult<string?>(null);

    public virtual Task<IReadOnlyList<string>> AdministrateursAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<string>>([]);

    public virtual Task SignalerAsync(SignalMail s, IReadOnlyList<string> destinataires, CancellationToken ct) => Task.CompletedTask;

    // --- Réception (lot 3) ---

    /// <summary>Codes des services de l'utilisateur (boîtes visibles : services du compte de messagerie).</summary>
    public virtual Task<IReadOnlyList<string>> ServicesAsync(string utilisateur, CancellationToken ct) => Task.FromResult<IReadOnlyList<string>>([]);

    /// <summary>Courriel reçu rangé par l'application (GED de la boîte : élément mail_compte) ; pièces jointes en références.</summary>
    public virtual Task<DepotRecu> RecevoirAsync(CourrielRecu c, CancellationToken ct) => Task.FromResult(new DepotRecu(null, []));

    /// <summary>Types d'éléments proposés au rattachement manuel.</summary>
    public virtual IReadOnlyList<TypeRattachement> TypesRattachement { get; } = [];

    /// <summary>Élément désigné par un code ou un numéro saisi (null : introuvable).</summary>
    public virtual Task<ElementTrouve?> ResoudreElementAsync(string type, string code, Utilisateur u, CancellationToken ct) => Task.FromResult<ElementTrouve?>(null);

    /// <summary>Libellé et page d'un élément rattaché (liste des liens).</summary>
    public virtual Task<ElementTrouve?> DecrireElementAsync(string type, string id, CancellationToken ct) => Task.FromResult<ElementTrouve?>(null);

    /// <summary>Courriel reçu rattaché à un élément : rangé avec lui (GED), suivi (CRM), alerte éventuelle.</summary>
    public virtual Task RattacherAsync(MessageRattache m, ElementTrouve element, CancellationToken ct) => Task.CompletedTask;

    /// <summary>Courriels ignorés ou purgés : leurs documents de la GED sont retirés (masqués).</summary>
    public virtual Task PurgerAsync(IReadOnlyList<long> documents, CancellationToken ct) => Task.CompletedTask;

    /// <summary>Adresse signalée non remise dans l'annuaire (proposé par l'alerte d'un avis de non-remise) ; renvoie les coordonnées marquées.</summary>
    public virtual Task<int> MarquerAdresseAsync(string adresse, string motif, Utilisateur u, CancellationToken ct) => Task.FromResult(0);
}

public sealed class SpecialisationMailDefaut : SpecialisationMail;
