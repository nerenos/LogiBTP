using LogiBTP.Socle.Web;

namespace LogiBTP.Ged.Web;

/// <summary>
/// Point de spécialisation du module GED (classe mère). L'application la dérive pour le répertoire de stockage, la
/// taille maximale d'un dépôt, les droits (visibilité par élément lié, purge, suppression au coffre-fort) et ses
/// contrôles de dépôt. Par défaut : tout le monde voit et dépose, seul un administrateur purge ou supprime au coffre.
/// </summary>
public class SpecialisationGed
{
    /// <summary>Répertoire des contenus (un fichier par empreinte SHA-256).</summary>
    public virtual string RepertoireStockage => Path.Combine(AppContext.BaseDirectory, "stockage-ged");

    /// <summary>Taille maximale d'un fichier déposé.</summary>
    public virtual long TailleMaxDepot => 200L * 1024 * 1024;

    /// <summary>Documents visibles de l'utilisateur (ex. documents RH réservés à un profil) : par défaut tous.</summary>
    public virtual IQueryable<DocumentGed> Visibles(IQueryable<DocumentGed> documents, Utilisateur u) => documents;

    public virtual bool PeutDeposer(Utilisateur u, string? typeElement, string? idElement) => true;

    public virtual bool PeutModifier(Utilisateur u, DocumentGed d) => true;

    /// <summary>Suppression définitive d'un document masqué (jamais au coffre-fort, la base l'interdit aussi).</summary>
    public virtual bool PeutPurger(Utilisateur u) => u.EstAdmin;

    /// <summary>Masquage d'un document du coffre-fort.</summary>
    public virtual bool PeutSupprimerCoffre(Utilisateur u) => u.EstAdmin;

    /// <summary>Contrôles métier d'un dépôt (catégorie obligatoire, élément lié existant…) : lever une ExceptionMetier.</summary>
    public virtual void ControlerDepot(MetaDepot meta, string nomFichier, long taille, Utilisateur u) { }
}
