using LogiBTP.Socle;

namespace LogiBTP.Documents.Web;

/// <summary>
/// Point de spécialisation des services du module Document (classe mère). Le cœur, ou un autre module,
/// la dérive pour brancher son moteur de calcul, ses compléments (métrés, variables…) et ses champs d'entête.
/// Par défaut : document générique, moteur <see cref="MoteurDocument{TDoc, TLigne}"/>, sans complément.
/// </summary>
public class SpecialisationDocument<TDoc, TLigne, TComplet>
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
    where TComplet : DocumentComplet<TDoc, TLigne>, new()
{
    public virtual string VersionMoteur => MoteurDocument<TDoc, TLigne>.Version;

    public virtual ComparateurCalcul Comparateur { get; } = new();

    // ------------------------------------------------------------------ calcul

    public virtual EntreeDocument<TDoc, TLigne> CreerEntree(TComplet saisie, List<TauxTva> tauxTva, OptionsCalcul options) => new()
    {
        Document = saisie.Document, Lignes = saisie.Lignes, TauxTva = tauxTva, Options = options,
    };

    public virtual ResultatDocument<TDoc, TLigne> Calculer(EntreeDocument<TDoc, TLigne> entree) =>
        MoteurDocument<TDoc, TLigne>.Calculer(entree);

    /// <summary>Document complet à persister ou à renvoyer à partir d'un résultat de calcul.</summary>
    public virtual TComplet VersComplet(ResultatDocument<TDoc, TLigne> r) => new() { Document = r.Document, Lignes = r.Lignes, Tva = r.Tva };

    // ------------------------------------------------------------------ entête

    /// <summary>Copie des champs d'entête saisis propres à la spécialisation (mode de calcul…).</summary>
    public virtual void CopierEnteteSaisie(TDoc cible, TDoc saisie) { }

    // ------------------------------------------------------------------ persistance des compléments

    /// <summary>Chargement des compléments du document (métrés, variables…).</summary>
    public virtual Task ChargerComplements(DocumentDbContext<TDoc, TLigne> db, TComplet complet, IReadOnlyCollection<long> lignes, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>Préparation d'une ligne avant écriture (références vers des compléments pas encore créés…).</summary>
    public virtual void PreparerLigneAEcrire(TLigne copie) { }

    /// <summary>Écriture des compléments après celle des lignes ; renseigne les correspondances d'ID.</summary>
    public virtual Task EcrireComplements(DocumentDbContext<TDoc, TLigne> db, long entId, TComplet resultat, Correspondances corr, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>Renumérotation temporaire des compléments lors d'une copie (ID de lignes déjà remplacés).</summary>
    public virtual void RenumeroterComplements(TComplet complet, IReadOnlyDictionary<long, long> lignes, ref long prochain) { }

    /// <summary>Filtrage des compléments lors d'une transformation partielle (lignes conservées).</summary>
    public virtual void FiltrerComplements(TComplet complet, ISet<long> lignes) { }

    // ------------------------------------------------------------------ transformations

    /// <summary>Ligne calculée par le moteur (écart d'arrondi…), exclue du suivi des reliquats.</summary>
    public virtual bool EstLigneCalculee(TLigne l) => false;

    /// <summary>Ligne de prix recopiée avec la quantité transformée (quantité saisie forcée, perte neutralisée…).</summary>
    public virtual void AjusterLigneTransformee(TLigne l) { }
}
