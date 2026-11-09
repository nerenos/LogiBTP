namespace LogiBTP.FactureElectronique.Formats;

// Modèle d'un message de cycle de vie CDAR D22B (flux 6, onglet « CDV FE - CDAR » de l'annexe A XP Z12-012 V1.4), lu ou
// écrit par Cdar.cs. Les termes MDT-* et MDG-* sont ceux de l'annexe. Listes jamais nulles (vides si absentes).

/// <summary>Échec de la lecture ou de l'écriture d'un CDAR : code <see cref="ErreurFe"/> et détails (codes du contrôle, termes).</summary>
public sealed class ExceptionCdar(string code, string message, IReadOnlyList<string>? details = null) : Exception(message)
{
    /// <summary>Code d'erreur (<see cref="ErreurFe"/>).</summary>
    public string Code { get; } = code;

    /// <summary>Détails : codes d'erreur du contrôle du statut, messages XSD ou terme en cause.</summary>
    public IReadOnlyList<string> Details { get; } = details ?? [];
}

/// <summary>
/// Partie du message (MDG-9 expéditeur, MDG-16 émetteur du statut, MDG-23 destinataire) : rôle UNCL 3035
/// (<see cref="RoleCdar"/>), identifiant global et son schéma (SIREN 0002, matricule de plateforme 0238), raison sociale,
/// adresse électronique (MDT-73, schéma 0225 ou absent).
/// </summary>
public sealed record PartieCdar(
    string? Role, string? Identifiant = null, string? SchemaIdentifiant = null, string? RaisonSociale = null,
    string? AdresseElectronique = null, string? SchemaAdresse = null);

/// <summary>
/// Caractéristique d'un détail de statut (MDG-43) : nature MDT-207 (<see cref="CaracteristiqueCdv"/>), terme visé
/// (MDT-206, ex. BT-152), indicateur de modification (MDT-209), nom, emplacement XPath, valeur texte, montant et devise,
/// date (format 102), pourcentage.
/// </summary>
public sealed record CaracteristiqueCdar(
    string? Type, string? Identifiant = null, bool? Modifiee = null, string? Nom = null, string? Emplacement = null,
    string? Valeur = null, decimal? Montant = null, string? Devise = null, DateOnly? Date = null, decimal? Pourcentage = null);

/// <summary>Note d'un détail de statut (MDG-39) : contenu et sujet (UNTDID 4451).</summary>
public sealed record NoteCdar(string? Contenu, string? Sujet = null);

/// <summary>
/// Détail de statut (MDG-37) : motif (MDT-113, <see cref="MotifStatut"/>) et libellé, action attendue (MDT-121,
/// <see cref="ActionCdv"/>) et libellé, notes, caractéristiques. Le numéro de séquence MDT-124-2 est l'ordre de la liste.
/// </summary>
public sealed record DetailStatutCdar(
    string? Motif, string? LibelleMotif, string? Action, string? LibelleAction, IReadOnlyList<NoteCdar> Notes,
    IReadOnlyList<CaracteristiqueCdar> Caracteristiques);

/// <summary>Pièce jointe du document référencé (MDT-96 : nom de fichier, type MIME, contenu en base 64).</summary>
public sealed record PieceJointeCdar(string NomFichier, string TypeMime, byte[] Contenu);

/// <summary>
/// Statut d'une facture référencée (MDG-32) : numéro BT-1 (MDT-87), code UNTDID 1373 (MDT-88, informatif), type BT-3
/// (MDT-91), date de réception de la facture (MDT-95), pièces jointes, type de référence (MDT-97), date BT-2 (MDT-100),
/// statut (MDT-105, <see cref="StatutCdv"/>) et libellé (MDT-106), vendeur (MDT-129 et son schéma), détails.
/// </summary>
public sealed record StatutFactureCdar(
    string Numero, string? CodeUntdid, string? TypeFacture, DateTime? DateReception, IReadOnlyList<PieceJointeCdar> PiecesJointes,
    string? TypeReference, DateOnly? DateFacture, string Statut, string? LibelleStatut, string? IdentifiantVendeur,
    string? SchemaVendeur, IReadOnlyList<DetailStatutCdar> Details);

/// <summary>
/// Bloc de réponse (MDB-03) : plusieurs factures (MDT-74), phase (MDT-77, <see cref="TypeAccuseCdar"/>), date-heure du
/// statut (MDT-78), statuts des factures référencées.
/// </summary>
public sealed record AccuseCdar(bool Multiple, string? TypeAccuse, DateTime? DateStatut, IReadOnlyList<StatutFactureCdar> Statuts);

/// <summary>
/// Message CDAR : processus (MDT-2, <see cref="ProcessusCdv"/>, absent pour le PPF), profil (MDT-3,
/// <see cref="ProfilCdv"/>), identifiant et nom du message (MDT-4, MDT-5), date-heure de création (MDT-8), expéditeur,
/// émetteur du statut, destinataires, blocs de réponse.
/// </summary>
public sealed record MessageCdar(
    string? Processus, string? Profil, string Identifiant, string? Nom, DateTime DateCreation, PartieCdar? Expediteur,
    PartieCdar? Emetteur, IReadOnlyList<PartieCdar> Destinataires, IReadOnlyList<AccuseCdar> Accuses);

/// <summary>Facture visée par un statut à écrire : numéro BT-1, type BT-3, date BT-2, SIREN du vendeur, date de réception (Déposée ou Reçue).</summary>
public sealed record FactureReferencee(string Numero, string? TypeFacture, DateOnly? Date, string? SirenVendeur, DateTime? DateReception = null);

/// <summary>Montant encaissé TTC d'un taux de TVA (Encaissée, BR-FR-CDV-14), ou payé (lecture).</summary>
public sealed record MontantEncaisse(decimal Montant, decimal TauxTva, string? Devise);

/// <summary>
/// Statut à écrire en CDAR. <see cref="Sens"/> (<see cref="SensFacture"/>), <see cref="Historique"/> et
/// <see cref="Emetteur"/> (<see cref="EmetteurStatut"/>) servent au contrôle par <see cref="ReglesCycleVie"/> ;
/// <see cref="Auteur"/> est la partie qui pose le statut (rôle déduit de l'émetteur s'il est vide) ;
/// <see cref="Destinataires"/> : le PPF est ajouté pour un statut obligatoire (<see cref="StatutCdv.ObligatoiresPpf"/>) ;
/// sans autre destinataire, le message est celui du PPF (profil einvoicingF2).
/// </summary>
public sealed record StatutAEcrire(
    string Sens, string Statut, string Emetteur, FactureReferencee Facture, PartieCdar Auteur, IReadOnlyList<PartieCdar> Destinataires,
    DateTime DateStatut, DateTime DateCreation)
{
    /// <summary>Statuts déjà posés, dans l'ordre chronologique (contrôle de l'enchaînement).</summary>
    public IReadOnlyList<string>? Historique { get; init; }
    public string? Motif { get; init; }
    public string? LibelleMotif { get; init; }
    public string? Action { get; init; }
    public string? LibelleAction { get; init; }
    public string? LibelleStatut { get; init; }
    public IReadOnlyList<NoteCdar> Notes { get; init; } = [];
    /// <summary>Encaissée : un montant par taux de TVA (obligatoire).</summary>
    public IReadOnlyList<MontantEncaisse> Encaissements { get; init; } = [];
    /// <summary>Autres caractéristiques (données invalides et attendues d'un litige, montant payé…).</summary>
    public IReadOnlyList<CaracteristiqueCdar> Caracteristiques { get; init; } = [];
    /// <summary>Pièce jointe (Demande de paiement direct : la facture du sous-traitant ; affacturage).</summary>
    public PieceJointeCdar? PieceJointe { get; init; }
    /// <summary>Facture B2G : motifs de refus propres (Chorus Pro).</summary>
    public bool B2g { get; init; }
    public string Processus { get; init; } = ProcessusCdv.Reglemente;
    /// <summary>Identifiant du message (MDT-4, 50 caractères au plus) ; par défaut numéro_statut_date-heure.</summary>
    public string? Identifiant { get; init; }
    /// <summary>Nom du message (MDT-5) ; par défaut l'identifiant.</summary>
    public string? Nom { get; init; }
    /// <summary>Expéditeur (MDG-9) ; par défaut la plateforme (rôle WK seul, comme les exemples FNFE).</summary>
    public PartieCdar? Expediteur { get; init; }
}

/// <summary>
/// Statut lu d'un CDAR, ramené au cycle de vie : facture, statut, émetteur (<see cref="EmetteurStatut"/>, déduit du rôle),
/// motif et action du premier détail qui en porte, date du statut, montants encaissés (MEN) et erreurs du contrôle par
/// <see cref="ReglesCycleVie.Controler"/> (vide : statut admis).
/// </summary>
public sealed record StatutLu(
    string Numero, string Statut, string? Emetteur, string? Motif, string? Action, DateTime? DateStatut,
    IReadOnlyList<MontantEncaisse> Encaissements, IReadOnlyList<string> Erreurs);
