namespace LogiBTP.Comptabilite.Web;

/// <summary>
/// Spécialisation par l'application (méthode patron) : taux de TVA (table de l'application, comptes ajoutés par elle),
/// tiers et leurs comptes auxiliaires par type de compte, utilisations d'un compte ou d'une catégorie (suppression).
/// </summary>
public abstract class SpecialisationComptabilite
{
    public abstract Task<List<TauxTvaDto>> TauxAsync(ComptabiliteDbContext db, CancellationToken ct);
    /// <summary>Catégorie, mention, actif et comptes des taux existants (le code et le taux restent ceux de l'application).</summary>
    public abstract Task EnregistrerTauxAsync(ComptabiliteDbContext db, List<TauxTvaDto> taux, CancellationToken ct);
    /// <summary>Tiers pour la liste par compte (une ligne par type de compte de chaque tiers).</summary>
    public abstract Task<List<TiersComptable>> TiersAsync(ComptabiliteDbContext db, CancellationToken ct);
    public abstract Task EnregistrerComptesTiersAsync(ComptabiliteDbContext db, List<CompteTiersSaisi> comptes, CancellationToken ct);
    /// <summary>Usages d'un compte hors du module (lignes, natures, tiers, taux…), décrits pour le message de refus.</summary>
    public abstract Task<List<string>> UtilisationsCompteAsync(ComptabiliteDbContext db, string code, CancellationToken ct);
    /// <summary>Type de compte dont un type hérite son compte auxiliaire faute de compte propre (ex. sous-traitant → fournisseur).</summary>
    public virtual string? TypeHerite(string typeCompte) => null;
    /// <summary>Natures de l'application (clés de ventilation par code).</summary>
    public abstract Task<List<NatureVentilation>> NaturesAsync(ComptabiliteDbContext db, CancellationToken ct);
    /// <summary>Types de documents et leur type comptable (surcharge et effectif).</summary>
    public abstract Task<List<TypeDocumentComptable>> TypesDocumentsAsync(ComptabiliteDbContext db, CancellationToken ct);
    public abstract Task EnregistrerTypesDocumentsAsync(ComptabiliteDbContext db, List<TypeDocumentSaisi> types, CancellationToken ct);
    /// <summary>Pièces comptables à transférer (ou transférées) construites pour la règle d'écriture (lot 3).</summary>
    public abstract Task<List<PieceExportee>> PiecesAsync(ComptabiliteDbContext db, FiltrePieces filtre, CancellationToken ct);
    /// <summary>État comptable des pièces : transférées (T) ou de nouveau à transférer (A).</summary>
    public abstract Task MarquerAsync(ComptabiliteDbContext db, List<long> pieces, bool transferees, CancellationToken ct);
    /// <summary>Taux de TVA rattachés à une catégorie.</summary>
    public abstract Task<int> TauxDeCategorieAsync(ComptabiliteDbContext db, string categorie, CancellationToken ct);
}
