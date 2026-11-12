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
