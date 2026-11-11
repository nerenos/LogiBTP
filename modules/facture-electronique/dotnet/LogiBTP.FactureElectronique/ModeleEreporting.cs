namespace LogiBTP.FactureElectronique;

// Modèle de l'e-reporting (flux 10, plans/facturation-electronique.md, lot 19) : termes TT / TG de l'annexe A XP Z12-012
// V1.4 (onglet « E-REPORTING - Flux 10 ») et XSD ereporting / report / transaction / payment du paquet FNFE 1.4.0.04.
// Montants en decimal ; dates en DateOnly (écrites AAAAMMJJ). Écriture : Formats/EcritureFlux10.cs ; règles :
// ReglesEreporting.cs (agrégation, période, découpage en envois, contrôle avant envoi).

/// <summary>
/// TB-0 : transmission d'e-reporting. Un seul rapport par transmission (G6.29) : <see cref="Transactions"/> (10.1 et 10.3)
/// ou <see cref="Paiements"/> (10.2 et 10.4).
/// </summary>
public sealed record TransmissionEreporting
{
    /// <summary>TT-1 : identifiant (≤ 50 caractères, G1.104), unique par période et par déclarant (G8.05).</summary>
    public required string Id { get; init; }
    /// <summary>TT-2 : nom du flux.</summary>
    public string? Nom { get; init; }
    /// <summary>TT-3 : date et heure de création (écrite AAAAMMJJHHMMSS).</summary>
    public required DateTime Horodatage { get; init; }
    /// <summary>TT-4 : <see cref="TypeTransmission"/>.</summary>
    public string Type { get; init; } = TypeTransmission.Initiale;
    /// <summary>TG-3 : émetteur, la plateforme agréée (schéma 0238, rôle WK : G6.22, G7.51).</summary>
    public required PartieTransmission Emetteur { get; init; }
    /// <summary>TG-5 : déclarant, la société (SIREN 0002, rôle SE pour ses ventes, BY pour ses acquisitions : G6.26, G7.52).</summary>
    public required PartieTransmission Declarant { get; init; }
    /// <summary>TB-2 : transactions (10.1 unitaires, 10.3 agrégées).</summary>
    public RapportTransactions? Transactions { get; init; }
    /// <summary>TB-3 : paiements (10.2 unitaires, 10.4 agrégés).</summary>
    public RapportPaiements? Paiements { get; init; }
}

/// <summary>TG-3 / TG-5 : émetteur ou déclarant (TT-7/8 ou TT-12/13 identifiant et schéma, TT-9/14 nom, TT-10/15 rôle, TT-11/16 adresse).</summary>
public sealed record PartieTransmission(string Identifiant, string Schema, string Nom, string Role, string? AdresseElectronique = null);

/// <summary>TG-7 / TG-33 : période de la transmission (TT-17/18, TT-89/90 ; fin après le début, G6.25).</summary>
public sealed record PeriodeEreporting(DateOnly Debut, DateOnly Fin)
{
    public bool Contient(DateOnly d) => d >= Debut && d <= Fin;
}

/// <summary>TB-2 : transactions de la période.</summary>
public sealed record RapportTransactions
{
    public required PeriodeEreporting Periode { get; init; }
    /// <summary>TG-8 : factures (flux 10.1).</summary>
    public IReadOnlyList<TransactionUnitaire> Factures { get; init; } = [];
    /// <summary>TG-31 : transactions agrégées (flux 10.3).</summary>
    public IReadOnlyList<TransactionsAgregees> Agregats { get; init; } = [];
}

/// <summary>TG-8 : transaction unitaire (facture B2B internationale), données extraites de la facture (BT → TT).</summary>
public sealed record TransactionUnitaire
{
    /// <summary>TT-19 (BT-1, ≤ 35 caractères, G1.05).</summary>
    public required string Numero { get; init; }
    /// <summary>TT-20 (BT-2).</summary>
    public required DateOnly Date { get; init; }
    /// <summary>TT-21 (BT-3, G1.01).</summary>
    public required string Type { get; init; }
    /// <summary>TT-22 (BT-5).</summary>
    public string Devise { get; init; } = "EUR";
    /// <summary>TT-201 (BT-9).</summary>
    public DateOnly? Echeance { get; init; }
    /// <summary>TT-24 (BT-8, <see cref="CodeExigibiliteTva"/>).</summary>
    public string? CodeExigibiliteTva { get; init; }
    /// <summary>TG-9 : notes (TT-26 sujet, TT-27 texte).</summary>
    public IReadOnlyList<NoteFacture> Notes { get; init; } = [];
    /// <summary>TT-28 (BT-23, G1.02).</summary>
    public required string Cadre { get; init; }
    /// <summary>TG-11 : factures antérieures (TT-30, TT-31).</summary>
    public IReadOnlyList<FactureAnterieure> FacturesAnterieures { get; init; } = [];
    /// <summary>TG-12 : vendeur.</summary>
    public required EntrepriseEreporting Vendeur { get; init; }
    /// <summary>TG-14 : acheteur (identifiant obligatoire en B2B international, G6.28).</summary>
    public EntrepriseEreporting? Acheteur { get; init; }
    /// <summary>TT-122 : numéro de TVA du représentant fiscal du vendeur (BT-63).</summary>
    public string? TvaRepresentantFiscal { get; init; }
    /// <summary>TG-17 : livraisons (TT-41 date, TG-19 adresse).</summary>
    public IReadOnlyList<LivraisonEreporting> Livraisons { get; init; } = [];
    /// <summary>TG-18 : période de facturation.</summary>
    public Periode? Periode { get; init; }
    /// <summary>TG-20 / TG-21 : remises et charges du document.</summary>
    public IReadOnlyList<RemiseChargeEreporting> RemisesCharges { get; init; } = [];
    /// <summary>TT-51 (BT-109).</summary>
    public decimal? TotalHt { get; init; }
    /// <summary>TT-52 (BT-110 ou BT-111 en euros).</summary>
    public required decimal TotalTva { get; init; }
    /// <summary>TT-202 : devise du total de TVA (euros, G6.23).</summary>
    public string DeviseTva { get; init; } = "EUR";
    /// <summary>TG-23 : ventilation de la TVA (TT-54 à TT-59), au moins une.</summary>
    public IReadOnlyList<DetailTva> Ventilation { get; init; } = [];
    /// <summary>TG-24 : lignes.</summary>
    public IReadOnlyList<LigneEreporting> Lignes { get; init; } = [];
}

/// <summary>TG-12 / TG-14 : entreprise (TT-33/36 identifiant et schéma G2.19, TT-34/38 numéro de TVA, TT-35/39 pays).</summary>
public sealed record EntrepriseEreporting(Identifiant? Identifiant, string? NumeroTva = null, string? CodePays = null);

/// <summary>TG-17 : livraison (TT-41 date, TG-19 adresse TT-103 à TT-108, TT-44).</summary>
public sealed record LivraisonEreporting(DateOnly? Date, AdressePostale? Adresse);

/// <summary>TG-20 (remise) / TG-21 (charge) : montant, catégorie et taux de TVA.</summary>
public sealed record RemiseChargeEreporting(bool Charge, decimal? Montant, string? CategorieTva = null, decimal? TauxTva = null);

/// <summary>TG-24 : ligne de facture.</summary>
public sealed record LigneEreporting
{
    /// <summary>TT-61 : notes de ligne.</summary>
    public IReadOnlyList<NoteFacture> Notes { get; init; } = [];
    /// <summary>TT-62, TT-63.</summary>
    public decimal? Quantite { get; init; }
    public string? Unite { get; init; }
    /// <summary>TG-40 : facture antérieure de la ligne (TT-300, TT-301).</summary>
    public FactureAnterieureLigne? FactureAnterieure { get; init; }
    /// <summary>TG-25 : période de la ligne.</summary>
    public Periode? Periode { get; init; }
    /// <summary>TG-26 / TG-27 : remises et charges de la ligne (montant seul).</summary>
    public IReadOnlyList<RemiseChargeEreporting> RemisesCharges { get; init; } = [];
    /// <summary>TT-69 prix net, TT-70 rabais, TT-71 prix brut.</summary>
    public decimal? PrixNet { get; init; }
    public decimal? Rabais { get; init; }
    public decimal? PrixBrut { get; init; }
    /// <summary>TT-76 : nom de l'article.</summary>
    public string? Nom { get; init; }
}

/// <summary>TG-31 : transactions B2C agrégées d'un jour, d'une catégorie et d'une option de TVA (flux 10.3).</summary>
public sealed record TransactionsAgregees
{
    /// <summary>TT-77.</summary>
    public required DateOnly Date { get; init; }
    /// <summary>TT-78.</summary>
    public string Devise { get; init; } = "EUR";
    /// <summary>TT-80 : option de paiement de la TVA (débits).</summary>
    public string? CodeExigibiliteTva { get; init; }
    /// <summary>TT-81 : <see cref="CategorieTransactions"/>.</summary>
    public required string Categorie { get; init; }
    /// <summary>TT-82.</summary>
    public required decimal TotalHt { get; init; }
    /// <summary>TT-83.</summary>
    public required decimal TotalTva { get; init; }
    /// <summary>TT-85 : nombre de transactions.</summary>
    public int? Nombre { get; init; }
    /// <summary>TG-32 : répartition par taux (TT-86 à TT-88), au moins une.</summary>
    public IReadOnlyList<VentilationAgregee> Ventilation { get; init; } = [];
}

/// <summary>TG-32 : base et TVA d'un taux.</summary>
public sealed record VentilationAgregee(decimal Taux, decimal Base, decimal Tva);

/// <summary>TB-3 : paiements de la période.</summary>
public sealed record RapportPaiements
{
    public required PeriodeEreporting Periode { get; init; }
    /// <summary>TG-34 : encaissements par facture (flux 10.2).</summary>
    public IReadOnlyList<PaiementUnitaire> Factures { get; init; } = [];
    /// <summary>TG-37 : encaissements B2C agrégés par jour (flux 10.4).</summary>
    public IReadOnlyList<PaiementsAgreges> Agregats { get; init; } = [];
}

/// <summary>TG-34 : encaissement d'une facture (TT-91 numéro, TT-102 date de la facture, TT-92 date du paiement).</summary>
public sealed record PaiementUnitaire(string Numero, DateOnly DateFacture, DateOnly DatePaiement, IReadOnlyList<EncaisseParTaux> Montants);

/// <summary>TG-37 : encaissements B2C d'un jour (TT-96).</summary>
public sealed record PaiementsAgreges(DateOnly Date, IReadOnlyList<EncaisseParTaux> Montants);

/// <summary>TG-36 / TG-39 : montant encaissé TTC d'un taux de TVA (TT-93/97 taux, TT-94/98 devise, TT-95/99 montant).</summary>
public sealed record EncaisseParTaux(decimal Taux, decimal Montant, string? Devise = "EUR");

// Données brutes fournies par l'application (lot 28) à ReglesEreporting.

/// <summary>Vente B2C (ou à un non-assujetti) à cumuler : jour, catégorie TT-81, ventilation par taux, option sur les débits.</summary>
public sealed record VenteB2C(DateOnly Date, string Categorie, IReadOnlyList<VentilationAgregee> Ventilation, string Devise = "EUR", string? CodeExigibiliteTva = null);

/// <summary>
/// Encaissement à déclarer : jour, montants TTC par taux ; facture encaissée (numéro et date) pour un encaissement unitaire
/// (10.2), sans facture pour un encaissement B2C cumulé (10.4).
/// </summary>
public sealed record EncaissementEreporting(DateOnly Date, IReadOnlyList<EncaisseParTaux> Montants, string? Facture = null, DateOnly? DateFacture = null);

/// <summary>Données d'une période à transmettre : factures (10.1), ventes B2C (10.3), encaissements des factures (10.2) et B2C (10.4).</summary>
public sealed record DonneesEreporting
{
    /// <summary>Période des transactions (10.1, 10.3).</summary>
    public PeriodeEreporting? PeriodeTransactions { get; init; }
    /// <summary>Période des paiements (10.2, 10.4).</summary>
    public PeriodeEreporting? PeriodePaiements { get; init; }
    public IReadOnlyList<TransactionUnitaire> Factures { get; init; } = [];
    public IReadOnlyList<VenteB2C> Ventes { get; init; } = [];
    public IReadOnlyList<EncaissementEreporting> EncaissementsFactures { get; init; } = [];
    public IReadOnlyList<EncaissementEreporting> EncaissementsB2C { get; init; } = [];
}

/// <summary>
/// Contexte des envois : émetteur (plateforme) et déclarant, horodatage, préfixe des identifiants (à défaut l'identifiant
/// du déclarant), rang de la correction (0 : transmission initiale IN ; n ≥ 1 : n-ième rectificative RE de la période).
/// </summary>
public sealed record ContexteEnvoi(PartieTransmission Emetteur, PartieTransmission Declarant, DateTime Horodatage, string? Prefixe = null, int Correction = 0);

/// <summary>Envoi à déposer : sous-flux, type de flux de l'API XP Z12-013, jour (découpage PLUSIEURS) et transmission.</summary>
public sealed record EnvoiEreporting(string SousFlux, string TypeFlux, DateOnly? Jour, TransmissionEreporting Transmission);

/// <summary>Écart du contrôle avant envoi : règle (<see cref="RegleEreporting"/>), terme TT / TG en cause, rang de l'élément (0 pour l'en-tête).</summary>
public sealed record EcartEreporting(string Regle, string Donnee, int Rang = 0);
