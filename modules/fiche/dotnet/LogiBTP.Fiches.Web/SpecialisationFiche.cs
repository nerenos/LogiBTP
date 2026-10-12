using LogiBTP.Fiches;
using LogiBTP.Socle.Web;

namespace LogiBTP.Fiches.Web;

/// <summary>
/// Point de spécialisation du module Fiche (classe mère). L'application la dérive pour ses règles métier par type
/// (contrôles, valeurs dérivées), ses droits et la durée du verrou. Par défaut : droits de droit_fiche par profil.
/// </summary>
public class SpecialisationFiche
{
    /// <summary>Un verrou non renouvelé pendant cette durée est libre (poste fermé, réseau coupé…).</summary>
    public virtual TimeSpan ExpirationVerrou => TimeSpan.FromMinutes(2);

    public virtual int DelaiRequeteMs => 10000;

    /// <summary>Droits accordés en plus de ceux du profil (ex. propriétaire de la fiche) : par défaut aucun.</summary>
    public virtual DroitsFiche DroitsSupplementaires(string type, Utilisateur u) => new(false, false, false, false);

    /// <summary>Contrôles métier de la fiche complète avant écriture : [{ champ, code, message }].</summary>
    public virtual IEnumerable<ErreurChamp> ValiderMetier(string type, IReadOnlyDictionary<string, object?> valeurs, IReadOnlyDictionary<string, object?> proprietes) => [];

    /// <summary>Valeurs modifiées juste avant l'écriture (valeurs calculées, normalisation…).</summary>
    public virtual void AvantEcriture(string type, bool creation, Dictionary<string, string?> valeurs, Utilisateur u) { }

    /// <summary>
    /// Avant écriture, avec la ligne complète après modification (valeurs et champs supplémentaires) : valeurs calculées
    /// qui demandent des données (prix d'un élément selon ses tarifs…). aEcrire reçoit les colonnes à écrire en plus.
    /// Par défaut : AvantEcriture.
    /// </summary>
    public virtual Task AvantEcritureAsync(string type, bool creation, string? id, Dictionary<string, string?> aEcrire,
        IReadOnlyDictionary<string, object?> valeurs, IReadOnlyDictionary<string, object?> proprietes, Utilisateur u, CancellationToken ct)
    {
        AvantEcriture(type, creation, aEcrire, u);
        return Task.CompletedTask;
    }

    public virtual ConstructeurFiche Constructeur(TypeFicheResolu type) => new(type);

    /// <summary>Valeurs des champs gérés (ChampFiche.Gere) d'une fiche : code du champ → valeur (objet, tableau…).</summary>
    public virtual Task<IReadOnlyDictionary<string, object?>> LireGeresAsync(string type, string id, Utilisateur u, CancellationToken ct) =>
        Task.FromResult<IReadOnlyDictionary<string, object?>>(new Dictionary<string, object?>());

    /// <summary>
    /// Contrôle des champs gérés saisis, avant toute écriture (id null à la création) : lève une ExceptionMetier
    /// (VALIDATION, CHOIX_REQUIS, conflit…) pour refuser l'enregistrement.
    /// </summary>
    public virtual Task ValiderGeresAsync(string type, string? id, IReadOnlyDictionary<string, System.Text.Json.JsonElement> geres,
        IReadOnlyDictionary<string, object?> valeurs, Utilisateur u, CancellationToken ct) => Task.CompletedTask;

    /// <summary>Écriture des champs gérés saisis, après celle de la ligne (id de la fiche créée à la création).</summary>
    public virtual Task EcrireGeresAsync(string type, string id, bool creation, IReadOnlyDictionary<string, System.Text.Json.JsonElement> geres,
        IReadOnlyDictionary<string, object?> valeurs, Utilisateur u, CancellationToken ct) =>
        geres.Count == 0 ? Task.CompletedTask : throw ExceptionMetier.Invalide("CHAMP", $"Champs gérés non pris en charge : {string.Join(", ", geres.Keys)}");
}
