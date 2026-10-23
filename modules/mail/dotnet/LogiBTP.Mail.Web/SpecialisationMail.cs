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
}

public sealed class SpecialisationMailDefaut : SpecialisationMail;
