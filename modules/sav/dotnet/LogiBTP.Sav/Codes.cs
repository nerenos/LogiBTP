namespace LogiBTP.Sav;

// Codes du module SAV, répliqués dans js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>État d'un équipement installé : en place, retiré (retour, dépose), remplacé par un autre équipement.</summary>
public static class EtatEquipement
{
    public const string Installe = "INSTALLE";
    public const string Retire = "RETIRE";
    public const string Remplace = "REMPLACE";

    public static readonly string[] Tous = [Installe, Retire, Remplace];
}

/// <summary>Origine d'un équipement : créé par un mouvement de stock (application), ou saisi à la main.</summary>
public static class OrigineEquipement
{
    public const string Mouvement = "MOUVEMENT";
    public const string Manuel = "MANUEL";
}

/// <summary>État de la garantie d'un équipement à une date : sans garantie connue, en cours, échue.</summary>
public static class EtatGarantie
{
    public const string Sans = "SANS";
    public const string EnCours = "EN_COURS";
    public const string Echue = "ECHUE";
}
