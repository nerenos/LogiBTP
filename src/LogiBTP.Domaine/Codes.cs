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
    public const string VFacture = "V_FACTURE";
    public const string VFactureAvt = "V_FACTURE_AVT";
    public const string VRepriseAvt = "V_REPRISE_AVT";
    public const string VAvoir = "V_AVOIR";
    public const string VDemandeAcompte = "V_DEMANDE_ACOMPTE";
    public const string ACommande = "A_COMMANDE";
    public const string AReception = "A_RECEPTION";
    public const string ARetour = "A_RETOUR";
    public const string AFacture = "A_FACTURE";
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

/// <summary>Modules facultatifs d'une société (module_societe) : <c>EstActifAsync</c>, <c>ExigeModule</c>.</summary>
public static class ModulesFacultatifs
{
    public const string Crm = "crm";
    public const string Execution = "execution";
    public const string Planning = "planning";
    public const string Pointage = "pointage";
    public const string Reglement = "reglement";
    public const string SousTraitance = "sous_traitance";
    public const string Stock = "stock";
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
}
