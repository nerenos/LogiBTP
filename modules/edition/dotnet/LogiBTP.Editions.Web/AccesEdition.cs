using LogiBTP.Socle.Web;

namespace LogiBTP.Editions.Web;

/// <summary>
/// Accès à un modèle d'édition (Q18, § 3.12) : mêmes niveaux que la confidentialité de la GED, sans auteur.
/// SECRET : profils listés seulement ; CONFIDENTIEL : profils listés et administrateurs ; PUBLIC, INTERNE : tout le
/// monde, sauf si des profils sont listés (alors ces profils et les administrateurs). Point d'accroche que le futur
/// module des droits remplacera (méthode virtuelle de la spécialisation).
/// </summary>
public static class AccesEdition
{
    public static bool Autorise(string niveau, IReadOnlyCollection<string> profils, Utilisateur u)
    {
        if (profils.Contains(u.Profil)) return true;
        if (niveau == "SECRET") return false;
        if (u.EstAdmin) return true;
        return niveau != "CONFIDENTIEL" && profils.Count == 0;
    }
}
