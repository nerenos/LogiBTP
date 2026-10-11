using LogiBTP.Listes;
using LogiBTP.Socle.Web;

namespace LogiBTP.Listes.Web;

/// <summary>
/// Point de spécialisation du module Liste (classe mère) : droits sur les vues, requête manuelle, limites
/// d'exécution, construction des requêtes. Les droits et groupes d'utilisateurs seront affinés plus tard :
/// par défaut, une vue est visible par son propriétaire, son groupe (partage G) ou tous (partage T),
/// modifiable par son propriétaire et le profil ADMIN.
/// </summary>
public class SpecialisationListe
{
    /// <summary>Délai maximal d'une requête de liste (statement_timeout).</summary>
    public virtual int DelaiRequeteMs => 10000;

    public virtual int TailleLotMax => 1000;

    public virtual int IdsMax => 1000;

    public virtual bool PeutVoir(VueListe v, Utilisateur u) =>
        u.EstAdmin || v.VliProprietaire == u.Code || v.VliPartage == "T" || (v.VliPartage == "G" && v.VliGroupe is not null && v.VliGroupe == u.Groupe);

    public virtual bool PeutModifier(VueListe v, Utilisateur u) => u.EstAdmin || v.VliProprietaire == u.Code;

    /// <summary>Saisie ou exécution d'une requête manuelle non enregistrée (SELECT encadré) : profil ADMIN.</summary>
    public virtual bool PeutSaisirRequete(Utilisateur u) => u.EstAdmin;

    public virtual ConstructeurRequete Constructeur(SourceResolue source, DefinitionVue definition, DemandeListe demande) =>
        new(source, definition, demande);
}
