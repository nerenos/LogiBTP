using LogiBTP.FactureElectronique.Web.Connecteurs;

namespace LogiBTP.FactureElectronique.Web;

/// <summary>
/// Contrôle des paramètres du module avant l'enregistrement (miroir de <c>controlerParametres</c> de
/// <c>js/ui/modeles.js</c>, jeu partagé <c>tests/cas/02_parametres.json</c>) : champs en défaut, dans l'ordre du
/// formulaire ; vide = paramètres valables. Toute règle modifiée l'est dans les deux.
/// </summary>
public static class ReglesParametresFe
{
    public const int FrequenceMin = 1;
    public const int FrequenceMax = 1440;
    public const int DelaiMin = 5;
    public const int DelaiMax = 600;

    /// <summary>Message de chaque champ en défaut (réponse PARAMETRE_INVALIDE du serveur).</summary>
    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["connecteur"] = "Connecteur inconnu",
        ["adresse_flux"] = "Adresse du Flow Service invalide ou absente (obligatoire pour le connecteur AFNOR)",
        ["adresse_annuaire"] = "Adresse du Directory Service invalide",
        ["connexion_oauth"] = "Connexion OAuth obligatoire pour le connecteur AFNOR",
        ["organisation"] = $"Organisation de {ConnecteurPlateforme.LongueurIdentifiant} caractères au plus",
        ["syntaxe"] = "Syntaxe inconnue",
        ["profil"] = "Profil inconnu",
        ["frequence_releve"] = $"Fréquence de relève de {FrequenceMin} à {FrequenceMax} minutes",
        ["delai_secondes"] = $"Délai d'attente de {DelaiMin} à {DelaiMax} secondes",
        ["decoupage_ereporting"] = "Découpage de l'e-reporting inconnu",
    };

    public static List<string> Controler(ParametresFeDto d, IReadOnlyCollection<string> connecteurs)
    {
        var champs = new List<string>();
        var afnor = d.Connecteur == ConnecteurFe.Afnor;
        if (!connecteurs.Contains(d.Connecteur)) champs.Add("connecteur");
        if (!AdresseValable(d.AdresseFlux) || (afnor && string.IsNullOrWhiteSpace(d.AdresseFlux))) champs.Add("adresse_flux");
        if (!AdresseValable(d.AdresseAnnuaire)) champs.Add("adresse_annuaire");
        if (afnor && d.ConnexionOauth is null) champs.Add("connexion_oauth");
        if (d.Organisation is { } o && o.Trim().Length > ConnecteurPlateforme.LongueurIdentifiant) champs.Add("organisation");
        if (d.Syntaxe is not (Syntaxe.Cii or Syntaxe.Ubl or Syntaxe.FacturX)) champs.Add("syntaxe");
        if (d.Profil is not (ProfilFacture.Basic or ProfilFacture.En16931 or ProfilFacture.ExtendedCtcFr)) champs.Add("profil");
        if (d.FrequenceReleve is < FrequenceMin or > FrequenceMax) champs.Add("frequence_releve");
        if (d.DelaiSecondes is < DelaiMin or > DelaiMax) champs.Add("delai_secondes");
        if (d.DecoupageEreporting is not (DecoupageEreporting.Unique or DecoupageEreporting.Plusieurs)) champs.Add("decoupage_ereporting");
        return champs;
    }

    /// <summary>Adresse vide, ou absolue en http(s) sans espace.</summary>
    public static bool AdresseValable(string? a)
    {
        if (string.IsNullOrWhiteSpace(a)) return true;
        var t = a.Trim();
        return !t.Any(char.IsWhiteSpace) && Uri.TryCreate(t, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http" && uri.Host.Length > 0;
    }
}
