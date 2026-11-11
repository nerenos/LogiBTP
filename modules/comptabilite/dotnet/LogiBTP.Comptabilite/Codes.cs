namespace LogiBTP.Comptabilite;

// Codes du module Comptabilité, répliqués dans modules/comptabilite/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Catégories de TVA de la norme EN 16931.</summary>
public static class CategorieEn16931
{
    public const string Standard = "S";
    public const string Exoneree = "E";
    public const string Autoliquidation = "AE";
    public const string Intracommunautaire = "K";
    public const string Export = "G";
    public const string HorsChamp = "O";
    public const string TauxZero = "Z";

    public static readonly string[] Toutes = [Standard, Exoneree, Autoliquidation, Intracommunautaire, Export, HorsChamp, TauxZero];
}

/// <summary>Motifs d'exonération (liste VATEX) proposés par défaut.</summary>
public static class Vatex
{
    public const string Autoliquidation = "VATEX-FR-AE";
    public const string Exoneration = "VATEX-EU-132";
}

/// <summary>Comportements de TVA des moteurs de calcul.</summary>
public static class ComportementTva
{
    public const string Normale = "N";
    public const string Autoliquidation = "A";
    public const string Intracommunautaire = "I";
    public const string Exoneree = "E";
}
