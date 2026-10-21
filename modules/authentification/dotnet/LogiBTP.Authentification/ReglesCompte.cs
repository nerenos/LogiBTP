using System.Text.RegularExpressions;

namespace LogiBTP.Authentification;

/// <summary>Politique de mot de passe de la société (parametre_authentification, clé mot_de_passe).</summary>
public sealed record PolitiqueMotDePasse(int LongueurMin = 12, IReadOnlyList<string>? Courants = null);

/// <summary>Compte évalué par <see cref="ReglesCompte.Etat"/> (colonnes de compte utiles à l'état).</summary>
public sealed record CompteAEvaluer(string Type, bool Actif, bool AMotDePasse, bool MdpProvisoire = false,
    DateOnly? ValideJusquAu = null, DateTimeOffset? VerrouilleJusquAu = null);

/// <summary>État d'un compte et possibilité d'ouvrir une session avec un mot de passe juste.</summary>
public sealed record EtatCompte(string Etat, bool Connexion);

/// <summary>Ce que l'application dit de la personne liée à un compte (spécialisation).</summary>
public sealed record PersonneAutorisee(bool Autorisee, bool FinObligatoire, IReadOnlyList<string> ProfilsInterdits);

/// <summary>
/// Règles des comptes, répliquées dans regles.js (jeux modules/authentification/tests/cas) : pseudo, mot de passe,
/// état d'un compte, contrôle d'un compte saisi pour sa personne liée.
/// </summary>
public static partial class ReglesCompte
{
    public const int PseudoMin = 3;
    public const int PseudoMax = 50;
    public const int MotDePasseMax = 128;

    [GeneratedRegex("^[a-z0-9][a-z0-9._-]*$")]
    private static partial Regex FormatPseudo();

    /// <summary>Pseudo comparé et enregistré en minuscules, sans espaces autour.</summary>
    public static string Normaliser(string? code) => (code ?? "").Trim().ToLowerInvariant();

    private static int Longueur(string s) => s.EnumerateRunes().Count();

    /// <summary>Contrôle d'un pseudo de compte de personne : codes d'erreur triés (vide = valide).</summary>
    public static List<string> ControlerPseudo(string? code, IEnumerable<string>? reserves = null)
    {
        var c = Normaliser(code);
        if (c.Length == 0) return ["PSEUDO_VIDE"];
        var erreurs = new List<string>();
        if (Longueur(c) < PseudoMin || Longueur(c) > PseudoMax) erreurs.Add("PSEUDO_LONGUEUR");
        if (!FormatPseudo().IsMatch(c)) erreurs.Add("PSEUDO_FORMAT");
        if ((reserves ?? []).Any(r => Normaliser(r) == c)) erreurs.Add("PSEUDO_RESERVE");
        erreurs.Sort(StringComparer.Ordinal);
        return erreurs;
    }

    /// <summary>Contrôle d'un nouveau mot de passe selon la politique de la société ; le pseudo ne doit pas y figurer.</summary>
    public static List<string> ControlerMotDePasse(string? mdp, PolitiqueMotDePasse? politique = null, string? pseudo = null)
    {
        var m = mdp ?? "";
        if (m.Length == 0) return ["MDP_VIDE"];
        politique ??= new PolitiqueMotDePasse();
        var erreurs = new List<string>();
        if (Longueur(m) < politique.LongueurMin) erreurs.Add("MDP_COURT");
        if (Longueur(m) > MotDePasseMax) erreurs.Add("MDP_LONG");
        var bas = m.ToLowerInvariant();
        if ((politique.Courants ?? []).Any(c => c.ToLowerInvariant() == bas)) erreurs.Add("MDP_COURANT");
        var p = Normaliser(pseudo);
        if (p.Length >= PseudoMin && bas.Contains(p, StringComparison.Ordinal)) erreurs.Add("MDP_PSEUDO");
        erreurs.Sort(StringComparer.Ordinal);
        return erreurs;
    }

    /// <summary>
    /// État d'un compte à un instant ; ordre : service, désactivé, expiré (le lendemain de la fin de validité, jour UTC),
    /// sans mot de passe, verrouillé, provisoire.
    /// </summary>
    public static EtatCompte Etat(CompteAEvaluer c, DateTimeOffset maintenant)
    {
        var etat = c switch
        {
            { Type: "SERVICE" } => "SERVICE",
            { Actif: false } => "INACTIF",
            { ValideJusquAu: DateOnly fin } when fin < DateOnly.FromDateTime(maintenant.UtcDateTime) => "EXPIRE",
            { AMotDePasse: false } => "SANS_MOT_DE_PASSE",
            { VerrouilleJusquAu: DateTimeOffset v } when v > maintenant => "VERROUILLE",
            { MdpProvisoire: true } => "A_CHANGER",
            _ => "ACTIF",
        };
        return new EtatCompte(etat, etat is "ACTIF" or "A_CHANGER");
    }

    /// <summary>
    /// Contrôle d'un compte de personne saisi par un administrateur : profil connu et permis, fin de validité obligatoire
    /// si la personne l'exige (intérimaire), pas passée. Sans personne : administrateur de l'installation.
    /// </summary>
    public static List<string> ControlerCompte(string profil, DateOnly? valideJusquAu, PersonneAutorisee? personne,
        IReadOnlyCollection<string> profils, DateOnly aujourdhui)
    {
        var erreurs = new List<string>();
        if (personne is { Autorisee: false }) erreurs.Add("PERSONNE_NON_AUTORISEE");
        if (!profils.Contains(profil)) erreurs.Add("PROFIL_INCONNU");
        else if (personne?.ProfilsInterdits.Contains(profil) == true) erreurs.Add("PROFIL_INTERDIT");
        if (valideJusquAu is null && personne is { FinObligatoire: true }) erreurs.Add("VALIDITE_OBLIGATOIRE");
        if (valideJusquAu is DateOnly v && v < aujourdhui) erreurs.Add("VALIDITE_PASSEE");
        erreurs.Sort(StringComparer.Ordinal);
        return erreurs;
    }

    /// <summary>Libellés des codes d'erreur (mêmes textes que MESSAGES_AUTH).</summary>
    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["PSEUDO_VIDE"] = "Identifiant obligatoire",
        ["PSEUDO_LONGUEUR"] = $"Identifiant de {PseudoMin} à {PseudoMax} caractères",
        ["PSEUDO_FORMAT"] = "Identifiant : lettres minuscules sans accents, chiffres, point, tiret ou souligné ; commence par une lettre ou un chiffre",
        ["PSEUDO_RESERVE"] = "Identifiant réservé : choisissez-en un autre",
        ["MDP_VIDE"] = "Mot de passe obligatoire",
        ["MDP_COURT"] = "Mot de passe trop court",
        ["MDP_LONG"] = $"Mot de passe de {MotDePasseMax} caractères au plus",
        ["MDP_COURANT"] = "Mot de passe trop courant : choisissez-en un autre",
        ["MDP_PSEUDO"] = "Le mot de passe ne doit pas contenir l'identifiant",
        ["PERSONNE_NON_AUTORISEE"] = "Cette personne ne peut pas avoir de compte (salarié ou intérimaire actif seulement)",
        ["PROFIL_INCONNU"] = "Profil inconnu",
        ["PROFIL_INTERDIT"] = "Profil interdit pour cette personne",
        ["VALIDITE_OBLIGATOIRE"] = "Date de fin de validité obligatoire (fin de mission)",
        ["VALIDITE_PASSEE"] = "Date de fin de validité déjà passée",
    };
}
