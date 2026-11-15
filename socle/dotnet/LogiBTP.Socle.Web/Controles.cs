using Microsoft.AspNetCore.Http;

namespace LogiBTP.Socle.Web;

/// <summary>Erreur d'un champ saisi : <c>{ champ, code, message }</c> (codes d'<see cref="ErreursEnregistrement"/> ou du module).</summary>
public sealed record ChampEnErreur(string Champ, string Code, string Message);

/// <summary>
/// Contrôles serveur d'une saisie, format commun à tous les types d'écriture : les erreurs s'accumulent par champ, puis
/// <see cref="Lever"/> refuse l'écriture en 422 VALIDATION, <c>details</c> = liste de <see cref="ChampEnErreur"/>.
/// Champ d'une ligne de table : « rang.champ » (rang à partir de 0) ; le client place chaque message sous son champ.
/// </summary>
public sealed class Controles
{
    private readonly List<ChampEnErreur> erreurs = [];

    public IReadOnlyList<ChampEnErreur> Erreurs => erreurs;
    public bool Valides => erreurs.Count == 0;

    public Controles Ajouter(string champ, string code, string message)
    {
        erreurs.Add(new(champ, code, message));
        return this;
    }

    /// <summary>Erreur ajoutée si <paramref name="refuse"/>.</summary>
    public Controles Si(bool refuse, string champ, string code, string message) => refuse ? Ajouter(champ, code, message) : this;

    /// <summary>Texte non vide (espaces retirés).</summary>
    public Controles Obligatoire(string champ, string? valeur, string libelle) =>
        Si(string.IsNullOrWhiteSpace(valeur), champ, ErreursEnregistrement.Obligatoire, $"{libelle} obligatoire");

    /// <summary>Valeur présente.</summary>
    public Controles Obligatoire<T>(string champ, T? valeur, string libelle) where T : struct =>
        Si(valeur is null, champ, ErreursEnregistrement.Obligatoire, $"{libelle} obligatoire");

    /// <summary>Texte d'au plus <paramref name="max"/> caractères (colonne du DDL).</summary>
    public Controles Longueur(string champ, string? valeur, int max, string libelle) =>
        Si(valeur is not null && valeur.Length > max, champ, ErreursEnregistrement.Longueur, $"{libelle} : {max} caractères au plus");

    /// <summary>Valeur parmi les valeurs admises (null admis : l'obligation se contrôle à part).</summary>
    public Controles Parmi(string champ, string? valeur, IReadOnlyCollection<string> admises, string libelle) =>
        Si(valeur is not null && !admises.Contains(valeur), champ, ErreursEnregistrement.Format, $"{libelle} : valeur « {valeur} » non admise");

    /// <summary>Nombre dans les bornes (incluses ; null admis).</summary>
    public Controles Entre(string champ, decimal? valeur, decimal? min, decimal? max, string libelle) =>
        Si(valeur is decimal v && (v < min || v > max), champ, ErreursEnregistrement.Format, $"{libelle} : valeur hors des bornes");

    /// <summary>Codes uniques dans une table saisie (le premier doublon de chaque code est signalé sur sa ligne).</summary>
    public Controles Uniques<T>(IReadOnlyList<T> lignes, Func<T, string?> cle, string champ, string libelle)
    {
        var vus = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < lignes.Count; i++)
        {
            if (cle(lignes[i])?.Trim() is { Length: > 0 } k && !vus.Add(k))
                Ajouter($"{i}.{champ}", ErreursEnregistrement.Doublon, $"{libelle} « {k} » en double");
        }
        return this;
    }

    /// <summary>Contrôles des lignes d'une table : champs préfixés par le rang de la ligne.</summary>
    public Controles Lignes<T>(IReadOnlyList<T> lignes, Action<Controles, T> controler)
    {
        for (var i = 0; i < lignes.Count; i++)
        {
            var c = new Controles();
            controler(c, lignes[i]);
            foreach (var e in c.erreurs) erreurs.Add(e with { Champ = $"{i}.{e.Champ}" });
        }
        return this;
    }

    /// <summary>Refus 422 VALIDATION s'il y a des erreurs (message : la première).</summary>
    public void Lever()
    {
        if (erreurs.Count > 0) throw Refus(erreurs);
    }

    public static ExceptionMetier Refus(IReadOnlyList<ChampEnErreur> erreurs) =>
        new(StatusCodes.Status422UnprocessableEntity, ErreursEnregistrement.Validation,
            erreurs.Count == 1 ? erreurs[0].Message : $"{erreurs[0].Message} (+{erreurs.Count - 1})", erreurs);

    /// <summary>Refus d'un seul champ.</summary>
    public static ExceptionMetier Refus(string champ, string code, string message) => Refus([new ChampEnErreur(champ, code, message)]);
}
