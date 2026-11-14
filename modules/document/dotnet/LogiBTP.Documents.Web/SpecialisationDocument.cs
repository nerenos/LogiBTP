using LogiBTP.Socle;
using LogiBTP.Socle.Web;

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

    /// <summary>Déverrouillage manuel d'un document resté verrouillé par un autre utilisateur : par défaut administrateur.</summary>
    public virtual bool PeutDeverrouiller(LogiBTP.Socle.Web.Utilisateur u) => u.EstAdmin;

    public virtual ComparateurCalcul Comparateur { get; } = new();

    /// <summary>Catalogue des règles des documents : celles du module, plus celles de la spécialisation.</summary>
    public virtual IEnumerable<DefinitionRegle> Regles => CatalogueRegles.Module;

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

    /// <summary>Copie des champs d'entête saisis, avec le type du document (règles par famille) ; par défaut la copie simple.</summary>
    public virtual void CopierEnteteSaisie(TDoc cible, TDoc saisie, TypeDocument type) => CopierEnteteSaisie(cible, saisie);

    /// <summary>Contrôles de saisie de la spécialisation exigés à la validation (un brouillon incomplet s'enregistre).</summary>
    public virtual void ControlerValidation(EntreeDocument<TDoc, TLigne> entree, List<MessageCalcul> erreurs) { }

    /// <summary>Résultat calculé à la validation, avant son enregistrement (compléments figés…).</summary>
    public virtual void PreparerValidation(ResultatDocument<TDoc, TLigne> r) { }

    /// <summary>
    /// Contrôles de validation qui lisent la base (rattachements, documents liés…), après ceux de la saisie ; le type
    /// donne le code du document (commande, facture…).
    /// </summary>
    /// <summary>
    /// Avertissements de gestion du cœur (non bloquants) avant une action (VALIDER, TRANSFORMER) : règles résolues du type
    /// fournies (remise, marge, encours…).
    /// </summary>
    public virtual Task AvertissementsAsync(DocumentDbContext<TDoc, TLigne> db, TComplet document, TypeDocument type,
        IReadOnlyDictionary<string, System.Text.Json.Nodes.JsonNode?> regles, string action, List<MessageCalcul> avertissements, CancellationToken ct) =>
        Task.CompletedTask;

    public virtual Task ControlerValidationAsync(DocumentDbContext<TDoc, TLigne> db, TComplet document, TypeDocument type, List<MessageCalcul> erreurs, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>
    /// Saisie complétée avant le calcul de la validation (lignes système : postes de pied d'un marché…) ; nouvelles
    /// lignes en identifiants négatifs.
    /// </summary>
    public virtual Task CompleterValidationAsync(DocumentDbContext<TDoc, TLigne> db, TComplet saisie, TypeDocument type, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>
    /// Dévalidation : données de la spécialisation reportées de l'ancienne version sur la nouvelle (marché, déductions,
    /// acomptes…) ; lignes : ancienne → nouvelle.
    /// </summary>
    public virtual Task ReporterVersionAsync(DocumentDbContext<TDoc, TLigne> db, long ancien, long nouveau, IReadOnlyDictionary<long, long> lignes, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>
    /// Validation refusée pour un montant au-delà de la limite du profil (module Droits) : demande de validation à
    /// transmettre (tâche du CRM…), hors de la transaction de la validation.
    /// </summary>
    public virtual Task MontantDepasseAsync(DocumentDbContext<TDoc, TLigne> db, TComplet document, TypeDocument type, Utilisateur u,
        DepassementValidation depassement, CancellationToken ct) => Task.CompletedTask;

    /// <summary>
    /// Après le recalcul des quantités des liens de transformation d'un document enregistré (quantité de la ligne cible) :
    /// conversion dans l'unité de la ligne source quand l'unité a changé (le module ne connaît pas les conversions).
    /// </summary>
    public virtual Task ApresRecalculLiensAsync(DocumentDbContext<TDoc, TLigne> db, long entId, CancellationToken ct) => Task.CompletedTask;

    /// <summary>
    /// Après l'écriture d'une ligne de l'historique (document_historique), dans la transaction de l'appelant : origine de
    /// l'utilisateur de la requête (agent IA <see cref="Utilisateur.Agent"/>…) recopiée par le cœur dans ses colonnes
    /// d'origine. Par défaut : rien.
    /// </summary>
    public virtual Task ApresHistoriqueAsync(DocumentDbContext<TDoc, TLigne> db, DocumentHistorique historique, Utilisateur u, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>Après l'enregistrement de la validation, dans sa transaction (suivi d'un marché…).</summary>
    public virtual Task ApresValidationAsync(DocumentDbContext<TDoc, TLigne> db, long entId, TypeDocument type, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>
    /// Condition et mode de règlement du tiers du document (échéancier : document, sinon tiers, sinon la condition par
    /// défaut) ; null sans tiers ou sans annuaire.
    /// </summary>
    public virtual Task<ReglementTiers?> ReglementTiersAsync(DocumentDbContext<TDoc, TLigne> db, TDoc document, CancellationToken ct) =>
        Task.FromResult<ReglementTiers?>(null);

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

    /// <summary>
    /// Contrôle propre à la spécialisation avant une transformation (lève une ExceptionMetier pour la refuser) ;
    /// depuisPlusieurs : création depuis plusieurs documents (marché, facture de plusieurs BL…).
    /// </summary>
    public virtual void ControlerTransformation(TComplet source, TypeDocument typeSource, TypeDocument typeCible, bool depuisPlusieurs) { }

    /// <summary>
    /// Entête du document créé par une transformation (copie de l'entête de la source, types source et cible) : tiers ou
    /// rattachements qui n'ont pas de sens pour la cible (ordre client transformé en commande fournisseur…).
    /// </summary>
    public virtual void PreparerEnteteTransformee(TDoc cible, TypeDocument typeSource, TypeDocument typeCible) { }

    /// <summary>Entête d'un document créé depuis plusieurs sources (il part de la première) : rattachements communs…</summary>
    public virtual void PreparerEntetePlusieurs(TDoc cible, IReadOnlyList<TDoc> sources) { }

    /// <summary>Contenu repris d'une source d'un document à plusieurs sources (identifiants temporaires), types source et cible.</summary>
    public virtual void PreparerContenuSource(TComplet contenu, TDoc source, TypeDocument typeSource, TypeDocument typeCible) { }

    /// <summary>Ajoute à un contenu les compléments d'un autre (métrés, variables… ; identifiants temporaires distincts).</summary>
    public virtual void FusionnerComplements(TComplet cible, TComplet ajout) { }
}

/// <summary>Montant de validation dépassé : motif (PIECE, CUMUL), HT de la pièce, cumul antérieur de la période, limite.</summary>
public sealed record DepassementValidation(string Motif, decimal Montant, decimal Cumul, LimiteValidation Limite);
