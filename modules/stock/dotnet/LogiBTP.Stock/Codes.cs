namespace LogiBTP.Stock;

// Codes du module Stock, répliqués dans js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Suivi d'un article géré en stock (S24.1) : aucun, par lot (numéro de lot, de coulée), par numéro de série.</summary>
public static class SuiviArticle
{
    public const string Aucun = "AUCUN";
    public const string Lot = "LOT";
    public const string Serie = "SERIE";

    public static readonly string[] Tous = [Aucun, Lot, Serie];
}

/// <summary>Unité de la durée théorique de péremption d'un article périssable (S24.7) : jours ou mois.</summary>
public static class UniteDuree
{
    public const string Jours = "J";
    public const string Mois = "M";
}
