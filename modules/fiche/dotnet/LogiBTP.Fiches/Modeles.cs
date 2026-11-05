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
    /// <summary>Chrono du code (code prévisionnel à la création, compteur, contrôle « déjà utilisé ») ; null : code libre.</summary>
    public ChronoDefinition? Chrono { get; set; }
}

/// <summary>
/// Chrono du code d'un type de fiche (format par défaut, remplacé par le paramétrage chrono_fiche) : champ du code,
/// préfixe, format (ChronoFiche), remise à zéro ; portée (champ qui sépare compteurs et unicité : bibliothèque d'un
/// élément) ; parent (champ qui désigne la fiche parente du jeton {PARENT}) ; variante (champ dont la valeur choisit
/// un préfixe et un paramétrage propres : sens d'un marché).
/// </summary>
public sealed class ChronoDefinition
{
    public string Champ { get; set; } = "code";
    public string? Prefixe { get; set; }
    public string? Format { get; set; }
    public string Raz { get; set; } = "J";
    public string? Portee { get; set; }
    public string? Parent { get; set; }
    public string? Variante { get; set; }
    public List<VarianteChrono>? Variantes { get; set; }
}

/// <summary>Variante d'un chrono : valeur du champ de variante, libellé, préfixe par défaut.</summary>
public sealed class VarianteChrono
{
    public string Valeur { get; set; } = "";
    public string? Libelle { get; set; }
    public string? Prefixe { get; set; }
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
    /// <summary>Code facultatif (la fiche spécialisée peut masquer un groupe selon les valeurs).</summary>
    public string? Code { get; set; }
    public string? Titre { get; set; }
    public List<string> Champs { get; set; } = [];
    /// <summary>LargeursGroupe : « plein » = groupe sur toute la largeur (notes…) ; absente = une colonne.</summary>
    public string? Largeur { get; set; }
    /// <summary>DispositionsGroupe : « grille » (défaut) ou « flex » (champs à la suite, à la largeur de leur contenu).</summary>
    public string? Disposition { get; set; }
}

/// <summary>
/// Champ d'une fiche : du programme (colonne de la table) ou supplémentaire (clé de la colonne JSONB du type).
/// Type : texte, zone, html, json, nombre, booleen, date, liste, motdepasse (chiffré en base, jamais envoyé sans demande).
/// Format : email, telephone, code_postal, 999.99, regex:…
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
    /// <summary>Rendu confidentiel (RGPD) par le paramétrage utilisateur.</summary>
    public bool ConfidentielParametre { get; set; }
    public bool LectureSeule { get; set; }
    /// <summary>« creation » : saisissable à la création et à la copie seulement (identifiant…).</summary>
    public string? Saisie { get; set; }
    public bool NonCopie { get; set; }
    public List<OptionChamp>? Options { get; set; }
    /// <summary>Liste : requête SQL (SELECT valeur, libelle…) exécutée en lecture seule à la place des options saisies.</summary>
    public string? Requete { get; set; }
    public string? Aide { get; set; }
    /// <summary>Exemple de saisie affiché en indication dans le champ vide (« AA-123-AA », « 06 12 34 56 78 »).</summary>
    public string? Exemple { get; set; }
    public string? Largeur { get; set; }
    public JsonElement? Defaut { get; set; }
    /// <summary>Référentiel affiché en liste déroulante par la fiche spécialisée (bibliothèque, famille, nature…).</summary>
    public string? Reference { get; set; }
    /// <summary>
    /// Champ géré par la spécialisation, hors de la table (sans colonne) : données liées lues et écrites par
    /// SpecialisationFiche.LireGeresAsync / EcrireGeresAsync (coordonnées partagées, contacts…), type json.
    /// </summary>
    public bool Gere { get; set; }
    public int Ordre { get; set; }
    public bool Actif { get; set; } = true;
    /// <summary>Champ supplémentaire : onglet de la définition où il s'affiche (sinon Informations complémentaires).</summary>
    public string? Section { get; set; }
    /// <summary>Champ supplémentaire : cadre titré qui le regroupe avec d'autres.</summary>
    public string? Groupe { get; set; }

    [System.Text.Json.Serialization.JsonIgnore]
    public bool EstSecret => Type == "motdepasse";
}

public sealed class OptionChamp
{
    public string Valeur { get; set; } = "";
    public string? Libelle { get; set; }
}

/// <summary>
/// Indicateur du bandeau de synthèse d'une fiche : code, libellé, valeur affichée, niveau (null, ok, attention, erreur),
/// adresse facultative (clic).
/// </summary>
public sealed record IndicateurFiche(string Code, string Libelle, string Valeur, string? Niveau = null, string? Url = null);

/// <summary>Compteur d'un onglet de la fiche : nombre d'éléments, alerte (élément en défaut).</summary>
public sealed record CompteOnglet(int Nombre, bool Alerte = false);

/// <summary>Synthèse d'une fiche (SpecialisationFiche.SyntheseAsync) : indicateurs du bandeau, compteurs des onglets par code.</summary>
public sealed record SyntheseFiche(IReadOnlyList<IndicateurFiche> Indicateurs, IReadOnlyDictionary<string, CompteOnglet> Onglets);

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
