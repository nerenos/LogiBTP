using System.Linq.Expressions;
using LogiBTP.Socle.Web;

namespace LogiBTP.Ged.Web;

/// <summary>
/// Confidentialité et restrictions d'accès : même règle que acces.js (jeu partagé modules/ged/tests/cas/06_acces.json).
/// L'auteur du dépôt et les accès listés (profils, utilisateurs) voient toujours le document ; SECRET : personne d'autre ;
/// CONFIDENTIEL : en plus les administrateurs ; PUBLIC / INTERNE : tout le monde, sauf accès listés (alors ces accès et
/// les administrateurs). Le filtre s'applique à toutes les lectures du service (Visibles).
/// </summary>
public static class AccesGed
{
    public const string Public = "PUBLIC";
    public const string Interne = "INTERNE";
    public const string Confidentiel = "CONFIDENTIEL";
    public const string Secret = "SECRET";

    public static readonly string[] Niveaux = [Public, Interne, Confidentiel, Secret];

    /// <summary>Filtre traduisible en SQL (tableaux PostgreSQL : = ANY, cardinality).</summary>
    public static Expression<Func<DocumentGed, bool>> Filtre(Utilisateur u)
    {
        var code = u.Code;
        var profil = u.Profil;
        var admin = u.EstAdmin;
        return d => d.DgeCreePar == code || d.DgeAccesProfils.Contains(profil) || d.DgeAccesUtilisateurs.Contains(code)
            || (d.DgeConfidentialite != Secret && (admin
                || (d.DgeConfidentialite != Confidentiel && d.DgeAccesProfils.Length == 0 && d.DgeAccesUtilisateurs.Length == 0)));
    }

    /// <summary>Même règle sur des valeurs (documents de l'archive).</summary>
    public static bool Autorise(string creePar, string? confidentialite, string[] profils, string[] utilisateurs, Utilisateur u)
    {
        if (creePar == u.Code || profils.Contains(u.Profil) || utilisateurs.Contains(u.Code)) return true;
        var niveau = confidentialite ?? Interne;
        if (niveau == Secret) return false;
        if (u.EstAdmin) return true;
        return niveau != Confidentiel && profils.Length == 0 && utilisateurs.Length == 0;
    }

    /// <summary>Changer la confidentialité ou les accès : auteur du dépôt ou administrateur.</summary>
    public static bool PeutChanger(string creePar, Utilisateur u) => u.EstAdmin || creePar == u.Code;
}
