namespace LogiBTP.Authentification.Web;

/// <summary>Profil proposé pour un compte (le module complet des droits viendra ensuite : A2, un profil par compte).</summary>
public sealed record ProfilCompte(string Code, string Libelle);

/// <summary>
/// Personne liée à un compte, décrite par l'application : libellé, statut (salarié CDI, intérimaire…), droit d'avoir
/// un compte, fin de validité obligatoire (fin de mission) ou proposée, profils interdits (un intérimaire n'est pas ADMIN).
/// </summary>
public sealed record PersonneCompte(string Type, string Id, string Libelle, bool Autorisee, bool FinObligatoire,
    IReadOnlyList<string> ProfilsInterdits, string? Statut = null, DateOnly? FinProposee = null, string? Motif = null)
{
    public PersonneAutorisee Regle => new(Autorisee, FinObligatoire, ProfilsInterdits);
}

/// <summary>
/// Spécialisation du module par l'application (méthode patron) : qui peut avoir un compte (personne liée par
/// type et identifiant), répercussion d'un compte écrit (identifiant de connexion recopié sur la personne).
/// </summary>
public abstract class SpecialisationAuthentification
{
    /// <summary>Profils attribuables (codes déjà employés par les droits de l'application).</summary>
    public virtual IReadOnlyList<ProfilCompte> Profils { get; } = [new("ADMIN", "Administrateur"), new("SAISIE", "Saisie")];

    /// <summary>Profil d'un nouveau compte (A5).</summary>
    public virtual string ProfilParDefaut => "SAISIE";

    /// <summary>Personne liée (null : inconnue). Relue à chaque ouverture de session et quand la session est revérifiée.</summary>
    public abstract Task<PersonneCompte?> PersonneAsync(AuthDbContext db, string type, string id, CancellationToken ct);

    /// <summary>Personnes pouvant recevoir un compte, pour la recherche de l'écran des comptes.</summary>
    public virtual Task<List<PersonneCompte>> RechercherPersonnesAsync(AuthDbContext db, string texte, CancellationToken ct) => Task.FromResult(new List<PersonneCompte>());

    /// <summary>Après l'écriture d'un compte (création, changement de pseudo, désactivation), dans la même transaction.</summary>
    public virtual Task ApresEcritureAsync(AuthDbContext db, Compte compte, string? ancienCode, CancellationToken ct) => Task.CompletedTask;
}
