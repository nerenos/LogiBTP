using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Rentabilite.Web;

/// <summary>Contexte du module : aucune entité, requêtes SQL sur les tables du module (et, par la spécialisation, de l'application).</summary>
public class RentabiliteDbContext(DbContextOptions<RentabiliteDbContext> options) : DbContext(options);

/// <summary>Chantier analysé (axes joints à la lecture : affaire, chargé d'affaires).</summary>
public sealed record ChantierRentabilite(int Id, string Code, string? Libelle, int? AffaireId, string? Affaire, string? Charge, string? Statut);

/// <summary>
/// Chantier de la Liste avec ses axes d'origine (affaire, chargé d'affaires) ; <c>Exclu</c> : chantier interne ou
/// d'une affaire de gestion, de matériel, de stock, de dotations ou de SAV, masqué par défaut (Q25) ; <c>Clos</c> :
/// chantier terminé, masqué par défaut.
/// </summary>
public sealed record ChantierListe(int Id, string Code, string? Libelle, int? AffaireId, string? AffaireCode, string? Affaire, long? ChargeId, string? Charge,
    string? Statut, bool Exclu, bool Clos);

/// <summary>Ordre d'exécution d'un chantier de la Liste.</summary>
public sealed record OrdreChantier(int ChaId, long Id, string? Numero, string? Libelle, string? Statut);

/// <summary>Ordre d'exécution d'un chantier (sous-niveau de l'origine).</summary>
public sealed record OrdreRentabilite(long Id, string? Numero, string? Libelle, string? Statut);

/// <summary>Nature et son regroupement (lignes du Détail).</summary>
public sealed record NatureRentabilite(int Id, string Code, string Libelle, string? Groupe, string? GroupeLibelle, int GroupeOrdre);

/// <summary>Pièce source d'un fait, pour la page des faits.</summary>
public sealed record PieceRentabilite(long EntId, string Type, string TypeLibelle, string? Numero, string? Indice, DateOnly Date, string? Statut, bool Annulee, string? Tiers,
    int? TiersId);

/// <summary>
/// Ce que montre une pièce ou une source et ce que ses faits doivent totaliser (rapprochement, § 8) : faits filtrés par
/// source, pièce (vide : toute la source) et indicateur, sur le champ PV ou PA ; <c>Attendu</c> calculé par la
/// spécialisation d'après le total de la pièce (indépendamment des lignes).
/// </summary>
public sealed record LigneRapprochement(string SourceType, long? EntId, string Indicateur, string Champ, decimal Attendu, string Libelle);

/// <summary>Ce que l'utilisateur voit : tous les chantiers ou les siens, les coûts (PA / PR) dans la page des faits, les types de pièces dont le détail est masqué.</summary>
public sealed record PorteeRentabilite(bool Tout, IReadOnlySet<int> Chantiers, bool VoirCouts, IReadOnlySet<string> TypesMasques)
{
    public bool Voit(int chantier) => Tout || Chantiers.Contains(chantier);
}

/// <summary>
/// Méthode patron du module (ANALYSE-MODULE-ANALYSE.md § 12) : l'application fournit les faits d'un chantier, les axes
/// (chantier, ordres, natures), les pièces, la portée de l'utilisateur et le rapprochement. Les requêtes passent par le
/// contexte du module (même connexion et même transaction que l'écriture des faits).
/// </summary>
public abstract class SpecialisationRentabilite
{
    /// <summary>Version des règles de calcul : un calcul d'une version antérieure est refait la nuit suivante (V64).</summary>
    public abstract int VersionRegles { get; }

    /// <summary>Module activé pour la base courante (sinon le planificateur ne traite pas sa file).</summary>
    public virtual Task<bool> ActifAsync(RentabiliteDbContext db, CancellationToken ct) => Task.FromResult(true);

    /// <summary>Tous les faits d'un chantier, calculés à la date du jour (engagé planifié).</summary>
    public abstract Task<List<Fait>> CalculerAsync(RentabiliteDbContext db, int chantier, DateOnly aujourdhui, CancellationToken ct);

    /// <summary>Chantiers recalculés chaque nuit.</summary>
    public abstract Task<List<int>> ChantiersOuvertsAsync(RentabiliteDbContext db, CancellationToken ct);

    /// <summary>Chantiers de la Liste (tous ; le module filtre exclus, clos et portée).</summary>
    public abstract Task<List<ChantierListe>> ChantiersListeAsync(RentabiliteDbContext db, CancellationToken ct);

    /// <summary>Ordres d'exécution de plusieurs chantiers (Liste).</summary>
    public abstract Task<List<OrdreChantier>> OrdresChantiersAsync(RentabiliteDbContext db, int[] chantiers, CancellationToken ct);

    public abstract Task<ChantierRentabilite?> ChantierAsync(RentabiliteDbContext db, int chantier, CancellationToken ct);

    /// <summary>Ordres d'exécution du chantier (ceux sans fait compris).</summary>
    public abstract Task<List<OrdreRentabilite>> OrdresAsync(RentabiliteDbContext db, int chantier, CancellationToken ct);

    public abstract Task<List<NatureRentabilite>> NaturesAsync(RentabiliteDbContext db, CancellationToken ct);

    public abstract Task<Dictionary<long, PieceRentabilite>> PiecesAsync(RentabiliteDbContext db, long[] ids, CancellationToken ct);

    public abstract Task<PorteeRentabilite> PorteeAsync(IServiceProvider services, Utilisateur u, CancellationToken ct);

    public abstract Task<List<LigneRapprochement>> RapprochementAsync(RentabiliteDbContext db, int chantier, CancellationToken ct);

    /// <summary>Règles de contrôle (montant ou nombre anormal dès qu'il n'est pas nul : pointages non valorisés…), comptées dans le Détail.</summary>
    public virtual IReadOnlyList<string> ReglesControle => [];

    /// <summary>Fait qui change avec le jour qui passe (engagé planifié) : exclu des écarts du recalcul de nuit.</summary>
    public virtual bool DependDuJour(Fait f) => false;

    /// <summary>Noms des tiers des saisies prévisionnelles (lot 6).</summary>
    public virtual Task<Dictionary<int, string>> TiersAsync(RentabiliteDbContext db, int[] ids, CancellationToken ct) => Task.FromResult(new Dictionary<int, string>());

    /// <summary>Droit d'écrire une saisie prévisionnelle (action CREER, MODIFIER, SUPPRIMER) ; refus : exception (403).</summary>
    public virtual Task AutoriserPrevisionAsync(IServiceProvider services, Utilisateur u, string action, CancellationToken ct) => Task.CompletedTask;

    /// <summary>Droit d'enregistrer le prévisionnel de facturation (lot 7) ; refus : exception (403).</summary>
    public virtual Task AutoriserFacturationAsync(IServiceProvider services, Utilisateur u, CancellationToken ct) => Task.CompletedTask;
}
