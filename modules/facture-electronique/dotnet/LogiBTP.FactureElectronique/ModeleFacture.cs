namespace LogiBTP.FactureElectronique;

// Modèle sémantique d'une facture électronique (EN16931, groupes BG et termes BT utiles à LogiBTP, extensions françaises
// EXT-FR-FE du profil EXTENDED-CTC-FR, annexe A XP Z12-012 V1.4). Indépendant de la syntaxe : les lecteurs CII et UBL
// (lots 2 et 3) le remplissent, les écrivains (lots 16 et 17) le sérialisent. Codes : voir Codes.cs. Montants en décimal
// (2 décimales, BR-FR-DEC), quantités 4, prix unitaires 6.

/// <summary>Facture électronique (BG-0).</summary>
public sealed record Facture
{
    /// <summary>BT-1 : numéro de facture (≤ 35 caractères, BR-FR-01/02).</summary>
    public required string Numero { get; init; }
    /// <summary>BT-2 : date d'émission.</summary>
    public required DateOnly DateEmission { get; init; }
    /// <summary>BT-3 : type de facture (<see cref="TypeFacture"/>).</summary>
    public required string TypeFacture { get; init; }
    /// <summary>BT-5 : devise de la facture.</summary>
    public string Devise { get; init; } = "EUR";
    /// <summary>BT-6 : devise de comptabilisation de la TVA, si différente.</summary>
    public string? DeviseTva { get; init; }
    /// <summary>BT-7 : date d'exigibilité de la TVA.</summary>
    public DateOnly? DateExigibiliteTva { get; init; }
    /// <summary>BT-8 : code de date d'exigibilité de la TVA (TVA sur les débits, BR-FR-MAP-03).</summary>
    public string? CodeExigibiliteTva { get; init; }
    /// <summary>BT-9 : date d'échéance (date de versement d'un acompte, BR-FR-CO-06).</summary>
    public DateOnly? DateEcheance { get; init; }
    /// <summary>BT-23 : cadre de facturation (<see cref="CadreFacturation"/>, BR-FR-08).</summary>
    public required string CadreFacturation { get; init; }
    /// <summary>BT-24 : profil (<see cref="ProfilFacture"/>).</summary>
    public string Profil { get; init; } = ProfilFacture.En16931;

    /// <summary>Références de l'acheteur et du contrat (BT-10 à BT-19).</summary>
    public ReferencesFacture References { get; init; } = new();
    /// <summary>BT-20 : conditions de paiement.</summary>
    public string? ConditionsPaiement { get; init; }
    /// <summary>BG-1 : notes (PMT, PMD, AAB, BAR… : <see cref="CodeNote"/>).</summary>
    public IReadOnlyList<NoteFacture> Notes { get; init; } = [];
    /// <summary>BG-3 : factures antérieures (avoir, rectificative, définitive après acompte).</summary>
    public IReadOnlyList<FactureAnterieure> FacturesAnterieures { get; init; } = [];

    /// <summary>BG-4 : vendeur.</summary>
    public required Partie Vendeur { get; init; }
    /// <summary>BG-7 : acheteur.</summary>
    public required Partie Acheteur { get; init; }
    /// <summary>BG-10 : bénéficiaire du paiement, si différent du vendeur (affacturage).</summary>
    public Partie? Beneficiaire { get; init; }
    /// <summary>BG-11 : représentant fiscal du vendeur.</summary>
    public Partie? RepresentantFiscal { get; init; }
    /// <summary>EXT-FR-FE-BG-02 : payeur de la facture (maître d'ouvrage d'un sous-traitant en paiement direct, cadre S5).</summary>
    public Partie? Payeur { get; init; }
    /// <summary>EXT-FR-FE-BG-01 : agent de l'acheteur (tiers valideur, maître d'œuvre).</summary>
    public Partie? AgentAcheteur { get; init; }
    /// <summary>EXT-FR-FE-BG-03 : agent du vendeur.</summary>
    public Partie? AgentVendeur { get; init; }

    /// <summary>BG-13 : livraison (BR-FR-14).</summary>
    public Livraison? Livraison { get; init; }
    /// <summary>BG-14 : période de facturation (BR-FR-CO-17, situations de travaux).</summary>
    public Periode? Periode { get; init; }
    /// <summary>BG-16 : instructions de paiement.</summary>
    public IReadOnlyList<MoyenPaiement> MoyensPaiement { get; init; } = [];
    /// <summary>BG-20 et BG-21 : remises et charges au niveau du document.</summary>
    public IReadOnlyList<RemiseCharge> RemisesCharges { get; init; } = [];
    /// <summary>BG-22 : totaux.</summary>
    public required Totaux Totaux { get; init; }
    /// <summary>BG-23 : ventilation de la TVA.</summary>
    public IReadOnlyList<DetailTva> DetailsTva { get; init; } = [];
    /// <summary>BG-24 : pièces jointes (BR-FR-17/18).</summary>
    public IReadOnlyList<PieceJointe> PiecesJointes { get; init; } = [];
    /// <summary>BG-25 : lignes.</summary>
    public IReadOnlyList<LigneFacture> Lignes { get; init; } = [];
}

/// <summary>Références de la facture (BT-10 à BT-19).</summary>
public sealed record ReferencesFacture
{
    /// <summary>BT-10 : référence de l'acheteur (code service, engagement B2G).</summary>
    public string? Acheteur { get; init; }
    /// <summary>BT-11 : référence du projet (chantier).</summary>
    public string? Projet { get; init; }
    /// <summary>BT-12 : référence du contrat (marché).</summary>
    public string? Contrat { get; init; }
    /// <summary>BT-13 : référence du bon de commande.</summary>
    public string? Commande { get; init; }
    /// <summary>BT-14 : référence de la commande client chez le vendeur.</summary>
    public string? CommandeVendeur { get; init; }
    /// <summary>BT-15 : référence de l'avis de réception.</summary>
    public string? Reception { get; init; }
    /// <summary>BT-16 : référence de l'avis d'expédition (bon de livraison).</summary>
    public string? Expedition { get; init; }
    /// <summary>BT-17 : référence de l'appel d'offres ou du lot.</summary>
    public string? AppelOffres { get; init; }
    /// <summary>BT-18 : identifiant de l'objet facturé.</summary>
    public string? Objet { get; init; }
    /// <summary>BT-19 : référence comptable de l'acheteur.</summary>
    public string? Comptable { get; init; }
}

/// <summary>BG-1 : note (BT-21 code sujet, BT-22 texte).</summary>
public sealed record NoteFacture(string? CodeSujet, string Texte);

/// <summary>BG-3 : facture antérieure (BT-25 numéro, BT-26 date, EXT-FR-FE-02 type).</summary>
public sealed record FactureAnterieure(string Numero, DateOnly? Date = null, string? Type = null);

/// <summary>Partie (vendeur BG-4, acheteur BG-7, bénéficiaire BG-10, payeur EXT-FR-FE-BG-02…).</summary>
public sealed record Partie
{
    /// <summary>BT-27, BT-44 : raison sociale.</summary>
    public required string RaisonSociale { get; init; }
    /// <summary>BT-28, BT-45 : appellation commerciale.</summary>
    public string? NomCommercial { get; init; }
    /// <summary>BT-29, BT-46 : identifiants (SIRET schéma 0009, identifiant privé…).</summary>
    public IReadOnlyList<Identifiant> Identifiants { get; init; } = [];
    /// <summary>BT-30, BT-47 : SIREN (schéma 0002, BR-FR-10/11).</summary>
    public string? Siren { get; init; }
    /// <summary>BT-31, BT-48 : numéro de TVA intracommunautaire.</summary>
    public string? NumeroTva { get; init; }
    /// <summary>BT-32 : identifiant fiscal du vendeur.</summary>
    public string? IdentifiantFiscal { get; init; }
    /// <summary>BT-34, BT-49 : adresse électronique (schéma 0225, ≤ 125 caractères, BR-FR-12/13).</summary>
    public Identifiant? AdresseElectronique { get; init; }
    /// <summary>BG-5, BG-8 : adresse postale.</summary>
    public AdressePostale? Adresse { get; init; }
    /// <summary>BG-6, BG-9 : contact.</summary>
    public Contact? Contact { get; init; }
}

/// <summary>Identifiant et son schéma (ISO 6523 : 0002 SIREN, 0009 SIRET, 0224 code de routage, 0225 adresse…).</summary>
public sealed record Identifiant(string Valeur, string? Schema = null);

/// <summary>Adresse postale (BT-35 à BT-40 et équivalents).</summary>
public sealed record AdressePostale(
    string? Ligne1, string? Ligne2, string? Ligne3, string? Localite, string? CodePostal, string? Subdivision, string CodePays);

/// <summary>Contact (BT-41 à BT-43 et équivalents).</summary>
public sealed record Contact(string? Nom, string? Telephone, string? Courriel);

/// <summary>BG-13 : livraison (BT-70 nom du lieu, BT-71 identifiant, BT-72 date, BG-15 adresse).</summary>
public sealed record Livraison(string? Nom, Identifiant? Lieu, DateOnly? Date, AdressePostale? Adresse);

/// <summary>Période de facturation (BG-14 : BT-73, BT-74 ; BG-26 : BT-134, BT-135).</summary>
public sealed record Periode(DateOnly? Debut, DateOnly? Fin);

/// <summary>BG-16 : moyen de paiement (BT-81 code, BT-83 référence, BG-17 virement : BT-84 IBAN, BT-86 BIC).</summary>
public sealed record MoyenPaiement(string Code, string? Reference = null, string? Iban = null, string? Bic = null, string? Titulaire = null);

/// <summary>BG-20 (remise) ou BG-21 (charge) du document, BG-27 ou BG-28 d'une ligne.</summary>
public sealed record RemiseCharge
{
    /// <summary>Charge (vrai) ou remise (faux).</summary>
    public required bool Charge { get; init; }
    /// <summary>BT-92, BT-99, BT-136, BT-141 : montant hors TVA.</summary>
    public required decimal Montant { get; init; }
    /// <summary>BT-93, BT-100 : assiette.</summary>
    public decimal? Assiette { get; init; }
    /// <summary>BT-94, BT-101 : pourcentage.</summary>
    public decimal? Pourcentage { get; init; }
    /// <summary>BT-95, BT-102 : catégorie de TVA (<see cref="CategorieTva"/>), document seulement.</summary>
    public string? CategorieTva { get; init; }
    /// <summary>BT-96, BT-103 : taux de TVA, document seulement.</summary>
    public decimal? TauxTva { get; init; }
    /// <summary>BT-97, BT-104 : motif.</summary>
    public string? Motif { get; init; }
    /// <summary>BT-98, BT-105 : code de motif.</summary>
    public string? CodeMotif { get; init; }
}

/// <summary>BG-22 : totaux du document.</summary>
public sealed record Totaux
{
    /// <summary>BT-106 : somme des montants nets des lignes.</summary>
    public required decimal TotalLignes { get; init; }
    /// <summary>BT-107 : somme des remises du document.</summary>
    public decimal? TotalRemises { get; init; }
    /// <summary>BT-108 : somme des charges du document.</summary>
    public decimal? TotalCharges { get; init; }
    /// <summary>BT-109 : total hors TVA.</summary>
    public required decimal TotalHt { get; init; }
    /// <summary>BT-110 : total de la TVA.</summary>
    public decimal? TotalTva { get; init; }
    /// <summary>BT-111 : total de la TVA dans la devise de comptabilisation.</summary>
    public decimal? TotalTvaComptable { get; init; }
    /// <summary>BT-112 : total TTC.</summary>
    public required decimal TotalTtc { get; init; }
    /// <summary>BT-113 : montant déjà payé (acomptes déduits).</summary>
    public decimal? DejaPaye { get; init; }
    /// <summary>BT-114 : arrondi.</summary>
    public decimal? Arrondi { get; init; }
    /// <summary>BT-115 : net à payer.</summary>
    public required decimal NetAPayer { get; init; }
}

/// <summary>BG-23 : ventilation de la TVA par catégorie et taux.</summary>
public sealed record DetailTva
{
    /// <summary>BT-116 : base.</summary>
    public required decimal Base { get; init; }
    /// <summary>BT-117 : montant de TVA.</summary>
    public required decimal Montant { get; init; }
    /// <summary>BT-118 : catégorie (<see cref="CategorieTva"/>).</summary>
    public required string Categorie { get; init; }
    /// <summary>BT-119 : taux.</summary>
    public decimal? Taux { get; init; }
    /// <summary>BT-120 : motif d'exonération.</summary>
    public string? MotifExoneration { get; init; }
    /// <summary>BT-121 : code de motif d'exonération (VATEX).</summary>
    public string? CodeExoneration { get; init; }
}

/// <summary>BG-24 : pièce jointe (BT-122 référence, BT-123 description : type BR-FR-17, BT-124 lien, BT-125 contenu).</summary>
public sealed record PieceJointe(
    string Reference, string? Description = null, string? Lien = null, byte[]? Contenu = null, string? TypeMime = null, string? NomFichier = null);

/// <summary>BG-25 : ligne de facture.</summary>
public sealed record LigneFacture
{
    /// <summary>BT-126 : identifiant de la ligne.</summary>
    public required string Identifiant { get; init; }
    /// <summary>EXT-FR-FE-162 : identifiant de la ligne parente (sous-ligne).</summary>
    public string? LigneParente { get; init; }
    /// <summary>EXT-FR-FE-163 : sous-type (<see cref="SousTypeLigne"/>).</summary>
    public string? SousType { get; init; }
    /// <summary>BT-127 : note de ligne.</summary>
    public string? Note { get; init; }
    /// <summary>BT-129 : quantité facturée (4 décimales).</summary>
    public required decimal Quantite { get; init; }
    /// <summary>BT-130 : unité (UN/ECE recommandation 20).</summary>
    public required string Unite { get; init; }
    /// <summary>BT-131 : montant net de la ligne.</summary>
    public required decimal MontantNet { get; init; }
    /// <summary>BT-132 : référence de la ligne du bon de commande.</summary>
    public string? LigneCommande { get; init; }
    /// <summary>BT-133 : référence comptable de l'acheteur.</summary>
    public string? ReferenceComptable { get; init; }
    /// <summary>EXT-FR-FE-BG-06 : facture antérieure à la ligne (reprise d'acompte, situation précédente).</summary>
    public FactureAnterieureLigne? FactureAnterieure { get; init; }
    /// <summary>BG-26 : période de la ligne.</summary>
    public Periode? Periode { get; init; }
    /// <summary>BG-27 et BG-28 : remises et charges de la ligne.</summary>
    public IReadOnlyList<RemiseCharge> RemisesCharges { get; init; } = [];
    /// <summary>BT-146 : prix net unitaire (6 décimales).</summary>
    public required decimal PrixNet { get; init; }
    /// <summary>BT-147 : rabais sur le prix.</summary>
    public decimal? Rabais { get; init; }
    /// <summary>BT-148 : prix brut.</summary>
    public decimal? PrixBrut { get; init; }
    /// <summary>BT-149 : quantité de base du prix.</summary>
    public decimal? QuantiteBase { get; init; }
    /// <summary>BT-151 : catégorie de TVA (<see cref="CategorieTva"/>).</summary>
    public string? CategorieTva { get; init; }
    /// <summary>BT-152 : taux de TVA.</summary>
    public decimal? TauxTva { get; init; }
    /// <summary>BT-153 : nom de l'article.</summary>
    public required string Nom { get; init; }
    /// <summary>BT-154 : description.</summary>
    public string? Description { get; init; }
    /// <summary>BT-155 : référence de l'article chez le vendeur.</summary>
    public string? ReferenceVendeur { get; init; }
    /// <summary>BT-156 : référence de l'article chez l'acheteur.</summary>
    public string? ReferenceAcheteur { get; init; }
}

/// <summary>EXT-FR-FE-BG-06 : facture antérieure à la ligne (EXT-FR-FE-136 numéro, 137 type, 138 date, 139 ligne).</summary>
public sealed record FactureAnterieureLigne(string Numero, string? Type = null, DateOnly? Date = null, string? Ligne = null);
