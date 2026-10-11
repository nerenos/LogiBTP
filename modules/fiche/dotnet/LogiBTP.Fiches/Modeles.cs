using System.Text.Json;

namespace LogiBTP.Fiches;

/// <summary>Définition d'un type de fiche (type_fiche.tyf_definition) : titre, sections et champs du programme.</summary>
public sealed class DefinitionFiche
{
    public string Libelle { get; set; } = "";
    /// <summary>Modèle de titre : « [prenom] [nom] ».</summary>
    public string? Titre { get; set; }
    public string? SousTitre { get; set; }
    public List<SectionFiche> Sections { get; set; } = [];
    public List<ChampFiche> Champs { get; set; } = [];
}

/// <summary>Onglet de fiche : groupes de champs (cadres titrés), ou champs à plat (un seul groupe).</summary>
public sealed class SectionFiche
{
    public string Code { get; set; } = "";
    public string Titre { get; set; } = "";
    public List<string>? Champs { get; set; }
    public List<GroupeChamps>? Groupes { get; set; }
}

public sealed class GroupeChamps
{
    public string? Titre { get; set; }
    public List<string> Champs { get; set; } = [];
    /// <summary>« plein » : groupe sur toute la largeur (notes…).</summary>
    public string? Largeur { get; set; }
}

/// <summary>
/// Champ d'une fiche : du programme (colonne de la table) ou supplémentaire (clé de la colonne JSONB du type).
/// Type : texte, zone, nombre, booleen, date, liste. Format : email, telephone, code_postal, 999.99, regex:…
/// </summary>
public sealed class ChampFiche
{
    public string Code { get; set; } = "";
    public string Libelle { get; set; } = "";
    /// <summary>Colonne de la table (champs du programme uniquement).</summary>
    public string? Colonne { get; set; }
    public string Type { get; set; } = "texte";
    public string? Format { get; set; }
    public int? Longueur { get; set; }
    /// <summary>Obligatoire pour le programme.</summary>
    public bool Obligatoire { get; set; }
    /// <summary>Rendu obligatoire par le paramétrage utilisateur.</summary>
    public bool ObligatoireParametre { get; set; }
    public bool Confidentiel { get; set; }
    public bool LectureSeule { get; set; }
    /// <summary>« creation » : saisissable à la création et à la copie seulement (identifiant…).</summary>
    public string? Saisie { get; set; }
    public bool NonCopie { get; set; }
    public List<OptionChamp>? Options { get; set; }
    public string? Aide { get; set; }
    public string? Largeur { get; set; }
    public JsonElement? Defaut { get; set; }
    public int Ordre { get; set; }
    public bool Actif { get; set; } = true;
}

public sealed class OptionChamp
{
    public string Valeur { get; set; } = "";
    public string? Libelle { get; set; }
}

/// <summary>Erreur de saisie d'un champ (code stable : OBLIGATOIRE, LONGUEUR, FORMAT…).</summary>
public sealed record ErreurChamp(string Champ, string Code, string Message, bool Supplementaire = false);

/// <summary>Type de fiche prêt à l'emploi : table, clé, colonne JSONB, définition complétée par le paramétrage.</summary>
public sealed record TypeFicheResolu(string Code, string Table, string Cle, string? ColonneProprietes, DefinitionFiche Definition,
    IReadOnlyList<ChampFiche> Supplementaires, IReadOnlyDictionary<string, string> TypesColonnes);

/// <summary>Erreur de définition ou de requête : traduite en réponse 422 par la couche web.</summary>
public sealed class ErreurFiche(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
