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

    public virtual ConstructeurFiche Constructeur(TypeFicheResolu type) => new(type);
}
