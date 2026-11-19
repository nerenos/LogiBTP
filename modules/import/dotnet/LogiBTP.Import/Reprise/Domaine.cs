using LogiBTP.Socle.Donnees;

namespace LogiBTP.Import.Reprise;

/// <summary>
/// Un domaine de la reprise (référentiels, annuaire, bibliothèque, pièces…), spécialisé par le cœur : il lit la source
/// par <see cref="ContexteReprise.Lecteur"/> et écrit dans la base cible par l'unité d'écriture du contexte (SQL constant
/// paramétré ou services du cœur branchés sur la même connexion). Il inscrit chaque ligne reprise au registre et
/// renseigne le rapport. Il ne valide ni n'annule jamais la transaction : le moteur s'en charge.
/// </summary>
public interface IDomaineReprise
{
    /// <summary>Code du domaine (unique dans une reprise).</summary>
    string Code { get; }

    /// <summary>Codes des domaines à exécuter avant celui-ci.</summary>
    IReadOnlyList<string> Dependances { get; }

    Task ExecuterAsync(ContexteReprise contexte, CancellationToken ct);
}

/// <summary>Paramètres d'une exécution de la reprise.</summary>
public sealed record OptionsReprise
{
    /// <summary>Logiciel source (<see cref="SourceReprise"/>), égal à celui du lecteur et du fichier de correspondances.</summary>
    public required string Source { get; init; }

    /// <summary>Sociétés source reprises dans la base (OPTIM : établissements d'un même SIRET, R1) ; vide pour MDE.</summary>
    public IReadOnlyList<string> Societes { get; init; } = [];

    /// <summary>Simulation : toute la chaîne dans une transaction annulée à la fin, seul le rapport est enregistré.</summary>
    public bool Simulation { get; init; } = true;

    public string? Auteur { get; init; }

    /// <summary>Date de la reprise (valeurs forcées, inventaire d'ouverture) : aujourd'hui par défaut.</summary>
    public DateOnly DateReprise { get; init; } = DateOnly.FromDateTime(DateTime.Today);

    /// <summary>Décimales des quantités des lignes de pièces reprises (null : celles de la quantité source, 2 à 6).</summary>
    public short? DecimalesQte { get; init; }

    /// <summary>Décimales des prix unitaires des lignes de pièces reprises (null : 6, prix de la source exact).</summary>
    public short? DecimalesPrix { get; init; }
}

/// <summary>Ce qu'un domaine reçoit : source, correspondances, registre, rapport et unité d'écriture de la base cible.</summary>
public sealed class ContexteReprise
{
    public required OptionsReprise Options { get; init; }
    public required ILecteurSource Lecteur { get; init; }
    public required FichierCorrespondances Correspondances { get; init; }
    public required UniteEcriture Unite { get; init; }
    public RegistreCorrespondances Registre { get; } = new();
    public required RapportReprise Rapport { get; init; }

    /// <summary>Identifiant de l'exécution dans <c>import_reprise</c>.</summary>
    public long RepriseId { get; internal set; }

    /// <summary>Fusions retenues (<c>import_fusion</c>) : par table source, clé fusionnée → clé conservée.</summary>
    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> Fusions { get; internal set; } =
        new Dictionary<string, IReadOnlyDictionary<string, string>>();

    /// <summary>Clé conservée d'une ligne source (elle-même si elle n'est pas fusionnée dans une autre).</summary>
    public string CleConservee(string tableSource, string cle) =>
        Fusions.TryGetValue(tableSource, out var t) && t.TryGetValue(cle.TrimEnd(), out var conservee) ? conservee : cle.TrimEnd();

    /// <summary>
    /// Table de correspondance du fichier, appliquée à une valeur source : entrée trouvée (cible ou ignorée, notée au
    /// rapport), ou null avec une anomalie (valeur sans correspondance, avertissement).
    /// </summary>
    public EntreeCorrespondance? Correspondre(string table, string? valeur, string emplacement)
    {
        var t = Correspondances.Tables.TryGetValue(table, out var x) ? x
            : throw new KeyNotFoundException($"Table de correspondance absente : {table}");
        var e = t.Trouver(valeur);
        if (e is null)
        {
            Rapport.Signaler(NiveauAnomalie.Avertissement, ErreurCorrespondance.SansCible, emplacement,
                $"{table} : valeur « {valeur} » sans correspondance");
            return null;
        }
        Rapport.Appliquer(table, e.Source, e.Ignorer ? $"ignoré : {e.Motif}" : e.Cible!);
        return e;
    }
}
