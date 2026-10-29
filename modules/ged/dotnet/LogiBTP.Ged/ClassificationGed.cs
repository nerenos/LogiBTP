using System.Text.RegularExpressions;
using LogiBTP.Socle;

namespace LogiBTP.Ged;

/// <summary>Règle de classification automatique (table regle_classification_ged).</summary>
public sealed record RegleClassificationGed(int Id, string Libelle, int Priorite, IReadOnlyList<string> Extensions, IReadOnlyList<string> TypesMime,
    IReadOnlyList<string> Mots, string? Expediteur, string? TypeElement, string? Categorie, string? Confidentialite, IReadOnlyList<string> MotsCles,
    bool Actif = true);

/// <summary>Document à classer : nom et type du fichier, titre, texte extrait, expéditeur d'un mail, type d'élément lié.</summary>
public sealed record DocumentAClasser(string? NomFichier, string? TypeMime, string? Titre, string? Texte, string? Expediteur, string? TypeElement);

public sealed record ResultatClassification(string? Categorie, string? Confidentialite, IReadOnlyList<string> MotsCles, IReadOnlyList<int> Regles);

/// <summary>
/// Classification automatique : même règle que classification.js (jeu partagé modules/ged/tests/cas/05_classification.json).
/// Une règle active s'applique quand tous ses critères renseignés sont remplis (sans critère : jamais) ; catégorie de la
/// première règle applicable (priorité, id), confidentialité la plus stricte, mots-clés cumulés sans doublon.
/// </summary>
public static partial class ClassificationGed
{
    public const int TexteMax = 20000;

    [GeneratedRegex(@"\.([a-z0-9]+)$", RegexOptions.IgnoreCase)]
    private static partial Regex RegexExtension();

    /// <summary>Extension en minuscules, sans le point (comme extension de fichiers.js).</summary>
    public static string Extension(string? nom) => RegexExtension().Match(nom ?? "") is { Success: true } m ? m.Groups[1].Value.ToLowerInvariant() : "";

    /// <summary>Niveau le plus strict de deux confidentialités (null ignoré).</summary>
    public static string? PlusStricte(string? a, string? b) =>
        a is null ? b : b is null ? a : Array.IndexOf(NiveauConfidentialite.Tous, b) > Array.IndexOf(NiveauConfidentialite.Tous, a) ? b : a;

    private static IEnumerable<string> Liste(IReadOnlyList<string>? l) => (l ?? []).Where(x => !string.IsNullOrEmpty(x));

    public static ResultatClassification Classer(DocumentAClasser d, IEnumerable<RegleClassificationGed> regles)
    {
        var ext = Extension(d.NomFichier);
        var mime = (d.TypeMime ?? "").ToLowerInvariant();
        var texte = d.Texte ?? "";
        var corpus = NormalisationGed.Normaliser($"{d.Titre ?? ""} {d.NomFichier ?? ""} {(texte.Length > TexteMax ? texte[..TexteMax] : texte)}");
        var expediteur = NormalisationGed.Normaliser(d.Expediteur);
        string? categorie = null, confidentialite = null;
        var motsCles = new List<string>();
        var appliquees = new List<int>();
        foreach (var r in regles.Where(r => r.Actif).OrderBy(r => r.Priorite).ThenBy(r => r.Id))
        {
            var criteres = new List<bool>();
            if (Liste(r.Extensions).Any()) criteres.Add(Liste(r.Extensions).Any(e => e.ToLowerInvariant() == ext));
            if (Liste(r.TypesMime).Any()) criteres.Add(Liste(r.TypesMime).Any(t => mime.StartsWith(t.ToLowerInvariant(), StringComparison.Ordinal)));
            if (Liste(r.Mots).Any()) criteres.Add(Liste(r.Mots).Any(m => corpus.Contains(NormalisationGed.Normaliser(m), StringComparison.Ordinal)));
            if (!string.IsNullOrEmpty(r.Expediteur)) criteres.Add(expediteur.Contains(NormalisationGed.Normaliser(r.Expediteur), StringComparison.Ordinal));
            if (!string.IsNullOrEmpty(r.TypeElement)) criteres.Add(r.TypeElement == d.TypeElement);
            if (criteres.Count == 0 || !criteres.All(c => c)) continue;
            appliquees.Add(r.Id);
            categorie ??= r.Categorie;
            confidentialite = PlusStricte(confidentialite, r.Confidentialite);
            foreach (var m in Liste(r.MotsCles)) if (!motsCles.Contains(m)) motsCles.Add(m);
        }
        return new ResultatClassification(categorie, confidentialite, motsCles, appliquees);
    }
}
