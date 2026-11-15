using System.Text.Json;
using System.Text.RegularExpressions;

namespace LogiBTP.Fiches;

/// <summary>
/// Champs supplémentaires en colonnes « x_ » des tables des fiches (plan versionnement-schema, lot 7) : contrôle des
/// demandes avant l'appel des fonctions SQL fiche_champ_creer / fiche_champ_retirer (qui refont les mêmes contrôles :
/// ce sont elles qui protègent la base), type du champ de fiche correspondant.
/// </summary>
public static partial class ChampsSupplementaires
{
    public const int LongueurLibelle = 100;
    public const int LongueurValeur = 200;
    /// <summary>Format d'un montant (numeric(18,2)) : seize chiffres et deux décimales.</summary>
    public const string FormatMontant = "9999999999999999.99";

    [GeneratedRegex(@"^x_[a-z][a-z0-9_]{0,40}\z")]
    private static partial Regex NomSur();

    public static readonly IReadOnlyList<string> Types =
        [TypesChampSupplementaire.Texte, TypesChampSupplementaire.Nombre, TypesChampSupplementaire.Montant,
         TypesChampSupplementaire.Date, TypesChampSupplementaire.CaseACocher, TypesChampSupplementaire.Liste];

    public static bool NomValide(string? colonne) => colonne is not null && NomSur().IsMatch(colonne);

    /// <summary>Type SQL de la colonne créée ; null si le type n'est pas permis.</summary>
    public static string? TypeSql(string? type) => type switch
    {
        TypesChampSupplementaire.Texte or TypesChampSupplementaire.Liste => "text",
        TypesChampSupplementaire.Nombre => "numeric",
        TypesChampSupplementaire.Montant => "numeric(18,2)",
        TypesChampSupplementaire.Date => "date",
        TypesChampSupplementaire.CaseACocher => "boolean",
        _ => null,
    };

    /// <summary>Valeurs d'une liste : au moins une, sans doublon, valeur non vide (le libellé vaut la valeur à défaut).</summary>
    public static List<ErreurChamp> ValiderValeurs(IReadOnlyList<OptionChamp>? valeurs, string colonne)
    {
        var erreurs = new List<ErreurChamp>();
        if (valeurs is null || valeurs.Count == 0)
        {
            erreurs.Add(new ErreurChamp(colonne, ErreursChampSupplementaire.Valeurs, "Une liste demande au moins une valeur"));
            return erreurs;
        }
        var vues = new HashSet<string>(StringComparer.Ordinal);
        foreach (var v in valeurs)
        {
            if (string.IsNullOrWhiteSpace(v.Valeur) || v.Valeur.Length > LongueurValeur)
                erreurs.Add(new ErreurChamp(colonne, ErreursChampSupplementaire.Valeurs, $"Valeur de liste vide ou trop longue ({LongueurValeur} caractères au plus)"));
            else if (!vues.Add(v.Valeur)) erreurs.Add(new ErreurChamp(colonne, ErreursChampSupplementaire.Valeurs, $"Valeur de liste en double : {v.Valeur}"));
        }
        return erreurs;
    }

    /// <summary>Libellé : obligatoire, 100 caractères au plus.</summary>
    public static ErreurChamp? ValiderLibelle(string? libelle, string colonne) =>
        string.IsNullOrWhiteSpace(libelle) ? new ErreurChamp(colonne, ErreursChampSupplementaire.LibelleObligatoire, "Libellé obligatoire")
        : libelle.Trim().Length > LongueurLibelle ? new ErreurChamp(colonne, ErreursChampSupplementaire.LibelleObligatoire, $"Libellé trop long ({LongueurLibelle} caractères au plus)")
        : null;

    /// <summary>Erreurs d'une demande de création (hors table ouverte, contrôlée avec la base).</summary>
    public static List<ErreurChamp> ValiderCreation(string? colonne, string? type, string? libelle, IReadOnlyList<OptionChamp>? valeurs)
    {
        var erreurs = new List<ErreurChamp>();
        var champ = colonne ?? "";
        if (!NomValide(colonne))
            erreurs.Add(new ErreurChamp(champ, ErreursChampSupplementaire.NomInvalide, "Nom de colonne invalide : « x_ », puis minuscules, chiffres et _ (41 caractères au plus)"));
        if (TypeSql(type) is null) erreurs.Add(new ErreurChamp(champ, ErreursChampSupplementaire.TypeInvalide, $"Type de champ non permis : {type}"));
        if (ValiderLibelle(libelle, champ) is { } e) erreurs.Add(e);
        if (type == TypesChampSupplementaire.Liste) erreurs.AddRange(ValiderValeurs(valeurs, champ));
        return erreurs;
    }

    /// <summary>
    /// Champ de fiche d'une ligne du registre : même code et même colonne (« x_… »), type de saisie du champ de fiche
    /// (le montant est un nombre à deux décimales), valeurs de la liste. Sans section ni groupe : onglet par défaut.
    /// </summary>
    public static ChampFiche VersChamp(string colonne, string type, string libelle, int ordre, List<OptionChamp>? valeurs) => new()
    {
        Code = colonne, Colonne = colonne, Libelle = libelle, Ordre = ordre, ColonneSupplementaire = true,
        Type = type == TypesChampSupplementaire.Montant ? TypesChampSupplementaire.Nombre : type,
        Format = type == TypesChampSupplementaire.Montant ? FormatMontant : null,
        Options = type == TypesChampSupplementaire.Liste ? valeurs ?? [] : null,
    };

    /// <summary>Valeurs de liste lues du registre (JSONB), tableau vide si absent ou illisible.</summary>
    public static List<OptionChamp> LireValeurs(JsonDocument? json)
    {
        if (json is null) return [];
        try
        {
            return json.Deserialize<List<OptionChamp>>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
