namespace LogiBTP.Bibliotheque;

// Codes du module Bibliothèque, répliqués dans modules/bibliotheque/js/src/codes.js (parité vérifiée par BibliothequeTests.cs).

/// <summary>Type de gestion d'un élément (ele_gestion).</summary>
public static class GestionElement
{
    public const string Stock = "STOCK";
    public const string Achat = "ACHAT";
    public const string SousTraitance = "SOUS_TRAITANCE";
    public const string NonGere = "NON_GERE";
}

/// <summary>Genre d'un poste de pied (ele_pied_genre, recopié dans lig_proprietes.genre_poste).</summary>
public static class GenrePoste
{
    public const string Remise = "REMISE";
    public const string Prorata = "PRORATA";
    public const string Acompte = "ACOMPTE";
    public const string PaiementDirect = "PAIEMENT_DIRECT";
    public const string Retenue = "RETENUE";
    public const string Autre = "AUTRE";
}
