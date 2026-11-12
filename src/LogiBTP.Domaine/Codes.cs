namespace LogiBTP.Domaine;

// Codes du cœur, répliqués dans client/src/app/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Types de fiches du cœur (type d'élément de la GED, du CRM et du planning).</summary>
public static class TypesFiche
{
    public const string Salarie = "salarie";
    public const string Materiel = "materiel";
    public const string Element = "element";
    public const string Personne = "personne";
    public const string Individu = "individu";
    public const string Projet = "projet";
    public const string Affaire = "affaire";
    public const string Chantier = "chantier";
    public const string Marche = "marche";
}

/// <summary>Types de documents connus du code (les autres types sont du paramétrage).</summary>
public static class TypesDocument
{
    public const string VDevis = "V_DEVIS";
    public const string VCommande = "V_COMMANDE";
    public const string VReception = "V_RECEPTION";
    public const string VRetour = "V_RETOUR";
    public const string VSituation = "V_SITUATION";
    public const string VProduction = "V_PRODUCTION";
    public const string VFacture = "V_FACTURE";
    public const string VFactureAvt = "V_FACTURE_AVT";
    public const string VRepriseAvt = "V_REPRISE_AVT";
    public const string VAvoir = "V_AVOIR";
    public const string VDemandeAcompte = "V_DEMANDE_ACOMPTE";
    public const string ACommande = "A_COMMANDE";
    public const string AReception = "A_RECEPTION";
    public const string ARetour = "A_RETOUR";
    public const string AFacture = "A_FACTURE";
    public const string AFactureAvt = "A_FACTURE_AVT";
    public const string AAvoir = "A_AVOIR";
    public const string TAo = "T_AO";
    public const string TCommande = "T_COMMANDE";
    public const string TFactureAvt = "T_FACTURE_AVT";
    public const string EOe = "E_OE";
    public const string EPo = "E_PO";
    public const string EDap = "E_DAP";
    public const string ESav = "E_SAV";
    public const string EOst = "E_OST";
    public const string EDac = "E_DAC";
    public const string EEnt = "E_ENT";
    public const string SEntree = "S_ENTREE";
    public const string SSortie = "S_SORTIE";
    public const string STransfert = "S_TRANSFERT";
    public const string SReservation = "S_RESERVATION";
    public const string SInventaire = "S_INVENTAIRE";

    /// <summary>Commandes qui reçoivent un accusé de réception (ARC).</summary>
    public static readonly string[] Arc = [ACommande, TCommande];
    /// <summary>Documents d'où l'on sous-traite (assistant « Sous-traiter »).</summary>
    public static readonly string[] SousTraitables = [VCommande, VDevis, EOst, EDac];
}

/// <summary>Types de postes de pied d'un marché (marche_poste).</summary>
public static class TypesPosteMarche
{
    public const string PaiementDirect = "PAIEMENT_DIRECT";
    public const string Prorata = "PRORATA";
    public const string Remise = "REMISE";
    public const string Autre = "AUTRE";

    public static readonly string[] Tous = [PaiementDirect, Prorata, Remise, Autre];
}

/// <summary>Types de ressources affectées (planning, affectations du matériel).</summary>
public static class TypesRessource
{
    public const string Salarie = "SALARIE";
    public const string Interim = "INTERIM";
    public const string SousTraitant = "SOUS_TRAITANT";
    public const string Materiel = "MATERIEL";
}

/// <summary>Codes des avertissements de gestion du cœur à la validation d'une pièce (non bloquants).</summary>
public static class AvertissementsGestion
{
    public const string TvaNonAutoliquee = "TVA_NON_AUTOLIQUEE";
}

/// <summary>Modules facultatifs d'une société (module_societe) : <c>EstActifAsync</c>, <c>ExigeModule</c>.</summary>
public static class ModulesFacultatifs
{
    public const string Crm = "crm";
    public const string Execution = "execution";
    public const string FactureElectronique = "facture_electronique";
    public const string Planning = "planning";
    public const string Pointage = "pointage";
    public const string Reglement = "reglement";
    public const string Relance = "relance";
    public const string Rentabilite = "rentabilite";
    public const string Sav = "sav";
    public const string SousTraitance = "sous_traitance";
    public const string Stock = "stock";
}

/// <summary>
/// Statuts du cycle des documents propres au cœur (statut_document, db/179) ; ceux du module Document : StatutsDocument.
/// </summary>
public static class StatutsDocumentBtp
{
    public const string Facturation = "FACTURATION";
    public const string Facture = "FACTURE";
}

/// <summary>
/// Rôle d'un type de pièce dans le module Rentabilité (rentabilite_role_type, db/258 ; règles de Btp/RentabiliteBtp.cs).
/// </summary>
public static class RolesRentabilite
{
    public const string CommandeVente = "COMMANDE_VENTE";
    public const string FactureVente = "FACTURE_VENTE";
    public const string FactureAcompte = "FACTURE_ACOMPTE";
    public const string AvoirVente = "AVOIR_VENTE";
    public const string OrdreExecution = "ORDRE_EXECUTION";
    public const string CommandeAchat = "COMMANDE_ACHAT";
    public const string ReceptionAchat = "RECEPTION_ACHAT";
    public const string RetourAchat = "RETOUR_ACHAT";
    public const string FactureAchat = "FACTURE_ACHAT";
    public const string AvoirAchat = "AVOIR_ACHAT";
    public const string CommandeSt = "COMMANDE_ST";
    public const string FactureSt = "FACTURE_ST";
    public const string AvoirSt = "AVOIR_ST";
    public const string ReservationStock = "RESERVATION_STOCK";
    public const string MouvementStock = "MOUVEMENT_STOCK";
    public const string RecuAcompte = "RECU_ACOMPTE";
    public const string Production = "PRODUCTION";
}

/// <summary>
/// Rôle d'un type de pièce dans le module Relances (type_document.tyd_role_relance, db/283) : pièces relancées par
/// Btp/SpecialisationRelanceBtp.cs ; mêmes valeurs que NatureRelance du module ; type sans rôle : jamais relancé.
/// </summary>
public static class RolesRelance
{
    public const string Devis = "DEVIS";
    public const string Facture = "FACTURE";
}

/// <summary>
/// Modèles d'édition connus du code (client/src/app/editions/modeles.js → db/191). Un modèle interne (rapport de
/// contrôle) n'est jamais retenu comme dernier modèle imprimé du document.
/// </summary>
public static class ModelesEdition
{
    public const string FraisAnnexes = "FRAIS_ANNEXES";
    public const string FicheDotation = "FICHE_DOTATION";
    // Lettres de relance (source « relance », plans/relances.md lot 7) ; MISE_EN_DEMEURE : dernier niveau des factures.
    public const string Relance1 = "RELANCE_1";
    public const string Relance2 = "RELANCE_2";
    public const string MiseEnDemeure = "MISE_EN_DEMEURE";
}

/// <summary>Catégories de la GED posées par le serveur (dge_categorie).</summary>
public static class CategoriesGed
{
    public const string Edition = "edition";
    public const string RessourceEdition = "ressource_edition";
    public const string Mail = "mail";
    public const string PvReception = "pv_reception";
    public const string BonSav = "bon_sav";
    public const string Photo = "photo";
    public const string Dotation = "dotation";
    public const string Relance = "relance";
    public const string FactureElectronique = "facture_electronique";
    /// <summary>Récapitulatif de cotraitance joint à la facture émise d'un cotraitant (db/303, lot 27).</summary>
    public const string RecapitulatifCotraitance = "recapitulatif_cotraitance";
}

/// <summary>
/// Type d'élément du cœur rattaché à un flux de facturation électronique (fe_flux.ffl_type_element, plans/
/// facturation-electronique.md lot 11) : DOCUMENT = pièce (identifiant ent_id) ; onglet Chronologie de la page document.
/// </summary>
public static class TypesElementFe
{
    public const string Document = "DOCUMENT";
    /// <summary>Ligne de la liste « Factures reçues à traiter » sans pièce (db/296) : flux reçu, ouvert dans la page du module.</summary>
    public const string Flux = "fe_flux";
    /// <summary>Période d'e-reporting (ereporting_periode, db/304, lot 28) : chronologie des envois du flux 10.</summary>
    public const string PeriodeEreporting = "EREPORTING";
}

/// <summary>Étapes des versions de la GED employées par le cœur (modules/ged : VALIDATION, ENVOI, RECEPTION…).</summary>
public static class EtapesGed
{
    public const string Reception = "RECEPTION";
    public const string Envoi = "ENVOI";
}

/// <summary>Avertissement d'émission lié à l'annuaire des plateformes (lot 20) : tiers absent de l'annuaire ou jamais vérifié.</summary>
public static class AvertissementAnnuaireFe
{
    public const string HorsAnnuaire = "HORS_ANNUAIRE";
    public const string NonVerifie = "NON_VERIFIE";
}

/// <summary>Plateforme de réception inscrite sur la fiche d'un tiers depuis l'annuaire (lot 20) : plateforme agréée ou PPF.</summary>
public static class PlateformeAnnuaireFe
{
    public const string Pa = "PA";
    public const string Ppf = "PPF";
}

/// <summary>Nature d'une pièce émise en facture électronique (lot 21, Q8) : lettre du cadre BT-23 (biens, services, mixte).</summary>
public static class NaturesFe
{
    public const string Biens = "B";
    public const string Services = "S";
    public const string Mixte = "M";
}

/// <summary>
/// Situation de la pièce émise qui fixe le chiffre du cadre BT-23 (lot 21) : dépôt simple (1), déjà payée (2), définitive
/// après acompte (4), émise comme sous-traitant (5) ou cotraitant (6).
/// </summary>
public static class SituationsCadreFe
{
    public const string Depot = "DEPOT";
    public const string DejaPayee = "DEJA_PAYEE";
    public const string DefinitiveApresAcompte = "DEFINITIVE_APRES_ACOMPTE";
    public const string SousTraitant = "SOUS_TRAITANT";
    public const string Cotraitant = "COTRAITANT";
}

/// <summary>
/// Écarts de l'émission d'une pièce de vente en facture électronique (lot 22, Btp/EmissionFactureBtp.cs), en plus de la
/// complétude du module : société ou tiers sans fiche, adresse postale, taux de TVA de ligne, IBAN d'un virement, conditions
/// de paiement, facture d'acompte déduite ou facture d'origine d'un avoir introuvable ; numéro provisoire (brouillon).
/// </summary>
public static class EcartsEmissionFe
{
    public const string NumeroProvisoire = "NUMERO_PROVISOIRE";
    public const string SocieteAbsente = "SOCIETE_ABSENTE";
    public const string TiersAbsent = "TIERS_ABSENT";
    public const string AdresseAbsente = "ADRESSE_ABSENTE";
    public const string TvaAbsente = "TVA_ABSENTE";
    public const string IbanAbsent = "IBAN_ABSENT";
    public const string PaiementAbsent = "PAIEMENT_ABSENT";
    public const string AcompteAbsent = "ACOMPTE_ABSENT";
    public const string OrigineAbsente = "ORIGINE_ABSENTE";
    /// <summary>B2G (lot 27) : numéro d'engagement (BT-13, référence externe) exigé par le tiers (per_fe_engagement).</summary>
    public const string EngagementAbsent = "ENGAGEMENT_ABSENT";
    /// <summary>B2G : code service (BT-10, per_fe_code_service) vide (avertissement : exigé par certaines structures publiques).</summary>
    public const string CodeServiceAbsent = "CODE_SERVICE_ABSENT";
    /// <summary>B2G : SIRET de la structure publique (BT-46, schéma 0009) vide.</summary>
    public const string SiretAbsent = "SIRET_ABSENT";
    /// <summary>Cotraitance (cadre S6) : aucun récapitulatif de cotraitance en GED de la pièce ni du marché (avertissement).</summary>
    public const string RecapitulatifAbsent = "RECAPITULATIF_ABSENT";
}

/// <summary>
/// État de l'émission d'une pièce de vente en facture électronique (lot 24, document_fe_emission.dfe_etat, db/300) : à
/// émettre (tâche de fond), envoyer plus tard ou émission manuelle (bouton « Émettre »), émise (flux en file), échec de la
/// production, hors flux 2 (tiers particulier, international ou absent de l'annuaire : envoi habituel).
/// </summary>
public static class EtatsEmissionFe
{
    public const string AEmettre = "A_EMETTRE";
    public const string Differee = "DIFFEREE";
    public const string Emise = "EMISE";
    public const string Echec = "ECHEC";
    public const string HorsFlux = "HORS_FLUX";
}

/// <summary>Motif d'une pièce hors flux 2 ou d'un échec de l'émission (document_fe_emission.dfe_motif, lot 24).</summary>
public static class MotifsEmissionFe
{
    public const string B2C = "B2C";
    public const string International = "INTERNATIONAL";
    public const string HorsAnnuaire = "HORS_ANNUAIRE";
    public const string Incomplete = "INCOMPLETE";
    public const string Production = "PRODUCTION";
    /// <summary>Avoir interne d'annulation d'une facture rejetée ou refusée, non déposé (lot 25).</summary>
    public const string AvoirInterne = "AVOIR_INTERNE";
}

/// <summary>
/// Transmission de l'avoir interne d'annulation d'une facture émise rejetée (213) ou refusée (210), choisie par
/// l'utilisateur (lot 25, Q14) : déposé pour archivage seul (note BAR ARCHIVEONLY, règle ArchiveOnly), ou non déposé.
/// </summary>
public static class TransmissionsAvoirInterneFe
{
    public const string ArchivageSeul = "ARCHIVAGE_SEUL";
    public const string Aucune = "AUCUNE";
}

/// <summary>
/// Pastille « Facture électronique » d'une pièce (colonne statut_fe de v_liste_documents, db/300) hors statuts du cycle de
/// vie : flux en file ou déposé sans statut, flux en erreur ou échec de l'émission.
/// </summary>
public static class PastillesEmissionFe
{
    public const string AEmettre = "A_EMETTRE";
    public const string Differee = "DIFFEREE";
    public const string EnFile = "EN_FILE";
    public const string Erreur = "ERREUR";
    public const string HorsFlux = "HORS_FLUX";
}

/// <summary>Erreurs de l'émission d'une pièce (validation refusée, bouton « Émettre »), lot 24.</summary>
/// <summary>
/// Encaissement déclaré d'une facture émise (document_fe_encaissement, db/302, lot 26) : statut Encaissée (212) envoyé à
/// la plateforme, ou écarté par l'utilisateur depuis la liste à valider (rien d'envoyé).
/// </summary>
public static class EtatsEncaissementFe
{
    public const string Envoye = "ENVOYE";
    public const string Ecarte = "ECARTE";
}

/// <summary>Nature d'une période d'e-reporting (ereporting_periode.erp_nature, db/304, lot 28) : transactions (10.1, 10.3) ou paiements (10.2, 10.4).</summary>
public static class NaturesPeriodeEreporting
{
    public const string Transactions = "TRANSACTIONS";
    public const string Paiements = "PAIEMENTS";
}

/// <summary>
/// État affiché d'une période d'e-reporting (lot 28) : préparée (pas envoyée), envoyée (flux en file ou déposé), acceptée
/// (accusés Ok de tous les envois), rejetée (un envoi en erreur).
/// </summary>
public static class EtatsPeriodeEreporting
{
    public const string Preparee = "PREPAREE";
    public const string Envoyee = "ENVOYEE";
    public const string Acceptee = "ACCEPTEE";
    public const string Rejetee = "REJETEE";
}

/// <summary>Ventes retenues par l'e-reporting (lot 28) : particulier ou non-assujetti (10.3, 10.4), international (10.1, 10.2).</summary>
public static class CiblesEreporting
{
    public const string B2C = "B2C";
    public const string International = "INTERNATIONAL";
}

/// <summary>Erreurs de l'e-reporting (lot 28).</summary>
public static class ErreursEreporting
{
    /// <summary>SIREN de la société ou matricule de la plateforme absent, régime inconnu.</summary>
    public const string Parametres = "EREPORTING_PARAMETRES";
    /// <summary>Envoi d'une période pas encore terminée.</summary>
    public const string PeriodeEnCours = "EREPORTING_PERIODE_EN_COURS";
    /// <summary>Préparation d'une période déjà envoyée (passer par la correction) ou envoi d'une période déjà envoyée.</summary>
    public const string DejaEnvoyee = "EREPORTING_DEJA_ENVOYEE";
    /// <summary>Correction ou relance d'une période jamais envoyée, relance d'une période non rejetée.</summary>
    public const string Etat = "EREPORTING_ETAT";
    /// <summary>Écarts du contrôle avant l'envoi (règles du schematron Flux10).</summary>
    public const string Ecarts = "EREPORTING_ECARTS";
    /// <summary>Aucune donnée à transmettre sur la période.</summary>
    public const string Vide = "EREPORTING_VIDE";
}

public static class ErreursEmissionFe
{
    public const string Incomplete = "FE_INCOMPLETE";
    public const string DejaEmise = "FE_DEJA_EMISE";
    public const string NonEmettable = "FE_NON_EMETTABLE";
    /// <summary>Avoir interne refusé : statut non rejeté ni refusé, pièce déjà annulée, pièces d'avancement suivantes (lot 25).</summary>
    public const string AnnulationImpossible = "FE_ANNULATION_IMPOSSIBLE";
}

/// <summary>
/// Signaux de notification de la facturation électronique (db/295 : facture_electronique_signal, niveau et activation
/// par société) : facture reçue, rejet (accusé en erreur ou statut 213), refus (210), litige (207), erreur de la file.
/// Types de notification du module « facture_electronique ».
/// </summary>
public static class SignauxFe
{
    public const string Recue = "RECUE";
    public const string Rejet = "REJET";
    public const string Refus = "REFUS";
    public const string Litige = "LITIGE";
    public const string ErreurFile = "ERREUR_FILE";
    /// <summary>Demande de paiement direct (statut 224) reçue d'un sous-traitant (lot 15, db/297).</summary>
    public const string PaiementDirect = "PAIEMENT_DIRECT";
}

/// <summary>Garantie de paiement d'un marché de sous-traitance (marche.mar_garantie) qui ouvre une demande de paiement (module Sous-traitance, 092b).</summary>
public static class GarantiesMarche
{
    public const string PaiementDirect = "PAIEMENT_DIRECT";
    public const string Delegation = "DELEGATION";
}

/// <summary>Erreurs du terrain testées par l'interface (client/src/app/codes.js : ERREUR_TERRAIN).</summary>
public static class ErreursTerrain
{
    /// <summary>Numéro d'ordre saisi sans réseau, inconnu à l'envoi (plan terrain-suites, lot 10).</summary>
    public const string OrdreInconnu = "ORDRE_INCONNU";
}

/// <summary>États d'une réserve suivie d'une réception de pose (client/src/app/codes.js : ETAT_RESERVE ; db/290).</summary>
public static class EtatsReserve
{
    public const string Ouverte = "OUVERTE";
    public const string Levee = "LEVEE";
}
