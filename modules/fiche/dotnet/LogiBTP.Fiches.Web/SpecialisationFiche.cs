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
}
