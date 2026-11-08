namespace LogiBTP.Listes;

// Codes du module Liste, répliqués dans modules/liste/js/src/codes.js (parité vérifiée par CodesTests.cs).

/// <summary>Codes d'erreur testés par l'interface.</summary>
public static class ErreursListe
{
    public const string LigneModifiee = "LIGNE_MODIFIEE";
    public const string RequeteHorsLigne = "REQUETE_HORS_LIGNE";
    public const string PeriodeInconnue = "PERIODE_INCONNUE";
    public const string PeriodeNombre = "PERIODE_NOMBRE";
    public const string PeriodeColonne = "PERIODE_COLONNE";
}

/// <summary>Périodes glissantes des filtres de date (bornes calculées à la date d'exécution : Periodes.cs).</summary>
public static class PeriodesListe
{
    public const string AujourdHui = "aujourd_hui";
    public const string Hier = "hier";
    public const string SemaineEnCours = "semaine_en_cours";
    public const string SemainePrecedente = "semaine_precedente";
    public const string MoisEnCours = "mois_en_cours";
    public const string MoisPrecedent = "mois_precedent";
    public const string TrimestreEnCours = "trimestre_en_cours";
    public const string AnneeEnCours = "annee_en_cours";
    public const string AnneePrecedente = "annee_precedente";
    public const string ExerciceEnCours = "exercice_en_cours";
    public const string DerniersJours = "derniers_jours";
    public const string DerniersMois = "derniers_mois";
    public const string ProchainsJours = "prochains_jours";
}

/// <summary>Périodes qui demandent un nombre x (parité : PERIODE_AVEC_NOMBRE de codes.js).</summary>
public static class PeriodesAvecNombre
{
    public static readonly string[] Codes = [PeriodesListe.DerniersJours, PeriodesListe.DerniersMois, PeriodesListe.ProchainsJours];
}
