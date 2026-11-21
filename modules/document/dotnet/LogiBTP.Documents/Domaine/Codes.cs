namespace LogiBTP.Documents;

// Codes du module Document, répliqués dans modules/document/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Familles de documents : ventes, achats, stock, exécution, sous-traitance (achats de sous-traitance).</summary>
public static class FamillesDocument
{
    public const string Vente = "V";
    public const string Achat = "A";
    public const string Stock = "S";
    public const string Execution = "E";
    public const string SousTraitance = "T";

    public static readonly string[] Toutes = [Vente, Achat, Stock, Execution, SousTraitance];

    /// <summary>Famille d'achat : achats et sous-traitance (tiers fournisseur, décaissement, comptes d'achat).</summary>
    public static bool EstAchat(string? famille) => famille is Achat or SousTraitance;
    /// <summary>Famille commerciale (échéancier, règlements) : ventes et familles d'achat.</summary>
    public static bool EstCommerciale(string? famille) => famille == Vente || EstAchat(famille);

    /// <summary>Nœud des droits d'une famille (module Droits) : documents/{famille}.</summary>
    public static string NoeudDroits(string famille) => $"documents/{famille}";
    /// <summary>Nœud des droits d'un type de document (module Droits) : documents/{famille}/{code}.</summary>
    public static string NoeudDroits(string famille, string code) => $"documents/{famille}/{code}";
}

/// <summary>
/// Avancement d'un type de document (tyd_avancement) : S situation de travaux (cumul facturable), F facture d'avancement
/// (période), R reprise d'avancement, D situation de production (avancement réel, cumul, ni facturé ni comptable).
/// </summary>
public static class TypesAvancement
{
    public const string Situation = "S";
    public const string Facture = "F";
    public const string Reprise = "R";
    public const string Production = "D";

    /// <summary>Situation de travaux ou de production : document en cumul dont la saisie part de la dernière de même type.</summary>
    public static bool EstSituation(string? avancement) => avancement is Situation or Production;
}

/// <summary>
/// Nature d'un avoir (ent_nature_avoir) : ANNULATION, annulation d'une pièce par un avoir qui la reprend entièrement
/// (avancement compris : il garde les précédents de la pièce annulée) ; AVANCEMENT, facture d'avancement de période négative.
/// </summary>
public static class NaturesAvoir
{
    public const string Annulation = "ANNULATION";
    public const string Avancement = "AVANCEMENT";
}

/// <summary>Statuts de documents connus du code (les autres statuts d'un type sont du paramétrage).</summary>
public static class StatutsDocument
{
    public const string Brouillon = "BROUILLON";
    public const string Valide = "VALIDE";
    public const string Envoye = "ENVOYE";
    public const string Accepte = "ACCEPTE";
    public const string NonRetenu = "NON_RETENU";
    public const string Solde = "SOLDE";
    public const string Annule = "ANNULE";
    public const string Remplace = "REMPLACE";
}

/// <summary>
/// Classe de style d'une ligne (table style_ligne, ent_styles_lignes) : tranche de niveau 1 à 5 (au-delà, TRANCHE_5),
/// section, ouvrage, sous-ouvrage (ouvrage sous un ouvrage), élément, composante (élément sous un ouvrage), texte, sous-total.
/// </summary>
public static class ClassesStyleLigne
{
    public const string Tranche1 = "TRANCHE_1";
    public const string Tranche2 = "TRANCHE_2";
    public const string Tranche3 = "TRANCHE_3";
    public const string Tranche4 = "TRANCHE_4";
    public const string Tranche5 = "TRANCHE_5";
    public const string Section = "SECTION";
    public const string Ouvrage = "OUVRAGE";
    public const string SousOuvrage = "SOUS_OUVRAGE";
    public const string Element = "ELEMENT";
    public const string Composante = "COMPOSANTE";
    public const string Texte = "TEXTE";
    public const string SousTotal = "SOUS_TOTAL";

    public static readonly string[] Toutes = [Tranche1, Tranche2, Tranche3, Tranche4, Tranche5, Section, Ouvrage, SousOuvrage, Element, Composante, Texte, SousTotal];
    public static readonly string[] Tranches = [Tranche1, Tranche2, Tranche3, Tranche4, Tranche5];
}

/// <summary>Taille du texte d'un style de ligne.</summary>
public static class TaillesStyleLigne
{
    public const string Petite = "PETITE";
    public const string Normale = "NORMALE";
    public const string Grande = "GRANDE";

    public static readonly string[] Toutes = [Petite, Normale, Grande];
}

/// <summary>Types d'une zone supplémentaire d'entête, en colonne x_ de document (registre document_zone_entete).</summary>
public static class TypesZoneEntete
{
    public const string Texte = "texte";
    public const string Nombre = "nombre";
    /// <summary>Montant : numeric(18,2).</summary>
    public const string Montant = "montant";
    public const string Date = "date";
    /// <summary>Case à cocher : boolean.</summary>
    public const string CaseACocher = "booleen";
    /// <summary>Liste de valeurs : text, valeurs du registre.</summary>
    public const string Liste = "liste";

    public static readonly string[] Tous = [Texte, Nombre, Montant, Date, CaseACocher, Liste];
}

/// <summary>Portée d'une zone d'entête : tous les documents, une famille, un type de document.</summary>
public static class PorteesZoneEntete
{
    public const string Global = "GLOBAL";
    public const string Famille = "FAMILLE";
    public const string Type = "TYPE";
}

/// <summary>Erreurs de l'administration des zones d'entête (code des erreurs de champ d'une réponse 422 VALIDATION).</summary>
public static class ErreursZoneEntete
{
    public const string NomInvalide = "ZONE_NOM_INVALIDE";
    public const string TypeInvalide = "ZONE_TYPE_INVALIDE";
    public const string LibelleObligatoire = "ZONE_LIBELLE_OBLIGATOIRE";
    public const string Valeurs = "ZONE_VALEURS";
    public const string PorteeInvalide = "ZONE_PORTEE_INVALIDE";
    public const string Existe = "ZONE_EXISTE";
    public const string Inconnue = "ZONE_INCONNUE";
    public const string TableAbsente = "ZONE_TABLE_ABSENTE";
    public const string Obligatoire = "ZONE_OBLIGATOIRE";
    public const string ValeurInvalide = "ZONE_VALEUR_INVALIDE";
}
