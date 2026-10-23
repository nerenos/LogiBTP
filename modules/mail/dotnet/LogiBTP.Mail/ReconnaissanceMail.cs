using System.Text;
using System.Text.RegularExpressions;

namespace LogiBTP.Mail;

/// <summary>Élément de l'application (type, identifiant).</summary>
public sealed record ElementCible(string Type, string Id);

/// <summary>Candidat fourni par l'application : élément dont le numéro ou une référence peut figurer dans le courriel, tiers de l'élément.</summary>
public sealed record Candidat(string Type, string Id, string? Numero, IReadOnlyList<string> References, long? TiersId);

/// <summary>Règle de reconnaissance : nature, mots cherchés dans des zones (objet, texte, pieces ; aucune = toutes), expéditeur par suffixe, action, ordre.</summary>
public sealed record RegleReconnaissance(string Code, string Nature, IReadOnlyList<string> Mots, IReadOnlyList<string> Dans, string? Expediteur, string? Service,
    string Action, int Ordre);

/// <summary>Courriel à reconnaître et ce que l'application en sait (fil, candidats, tiers de l'expéditeur).</summary>
public sealed record EntreeReconnaissance(string Objet, string Texte, IReadOnlyList<string> Pieces, string TextePieces, string De, IReadOnlyList<ElementCible> Fil,
    IReadOnlyList<Candidat> Candidats, IReadOnlyList<long> ExpediteurTiers, IReadOnlyList<ElementCible> Tiers, bool Automatique);

public sealed record Proposition(string Type, string Id, int Score, IReadOnlyList<string> Indices);

public sealed record ResultatReconnaissance(string? Nature, string? Regle, string? Service, string Decision, IReadOnlyList<Proposition> Retenus,
    IReadOnlyList<Proposition> Propositions, bool Alerte);

/// <summary>
/// Reconnaissance d'un courriel reçu, répliquée avec reconnaissance.js (jeu tests/cas/01_reconnaissance.json) : nature
/// par la première règle applicable, score des candidats (numéro dans l'objet 70, dans le texte ou le nom d'une pièce
/// 60, dans le texte des pièces 50 ; référence 40 ; expéditeur = tiers 20 ; plafond 100 ; fil 100 ; tiers 50),
/// décision IGNORE / RATTACHE / PROPOSE / A_RAPPROCHER, alerte.
/// </summary>
public static partial class ReconnaissanceMail
{
    public static readonly IReadOnlyDictionary<string, int> Scores = new Dictionary<string, int>
    {
        ["NUMERO_OBJET"] = 70, ["NUMERO_TEXTE"] = 60, ["NUMERO_PIECE"] = 60, ["NUMERO_PIECE_TEXTE"] = 50, ["REFERENCE"] = 40, ["EXPEDITEUR"] = 20, ["FIL"] = 100, ["TIERS"] = 50,
    };

    public static readonly string[] Zones = ["objet", "texte", "pieces"];
    public static readonly string[] Actions = ["ALERTER", "RATTACHER", "IGNORER"];
    public static readonly string[] Natures = ["ARC", "REPONSE_DEVIS", "FACTURE_FOURNISSEUR", "BL", "RELANCE", "AUTRE"];

    private static readonly Dictionary<char, string> Accents = new()
    {
        ['à'] = "a", ['â'] = "a", ['ä'] = "a", ['á'] = "a", ['ã'] = "a", ['å'] = "a", ['ç'] = "c", ['é'] = "e", ['è'] = "e", ['ê'] = "e", ['ë'] = "e",
        ['î'] = "i", ['ï'] = "i", ['í'] = "i", ['ì'] = "i", ['ñ'] = "n", ['ô'] = "o", ['ö'] = "o", ['ó'] = "o", ['ò'] = "o", ['õ'] = "o", ['ù'] = "u",
        ['û'] = "u", ['ü'] = "u", ['ú'] = "u", ['ÿ'] = "y", ['œ'] = "oe", ['æ'] = "ae", ['’'] = "'",
    };

    [GeneratedRegex(@"\s+")]
    private static partial Regex Espaces();

    /// <summary>Minuscules, accents retirés, espaces resserrés.</summary>
    public static string Normaliser(string? texte)
    {
        var sb = new StringBuilder();
        foreach (var c in (texte ?? "").ToLowerInvariant()) sb.Append(Accents.TryGetValue(c, out var r) ? r : c);
        return Espaces().Replace(sb.ToString(), " ").Trim();
    }

    private static bool Alnum(string t, int i) => i >= 0 && i < t.Length && (t[i] is >= 'a' and <= 'z' || char.IsAsciiDigit(t[i]));

    /// <summary>Le mot (ou l'expression) figure en entier dans le texte, sans casse ni accents.</summary>
    public static bool ContientMot(string? texte, string? mot)
    {
        var t = Normaliser(texte);
        var m = Normaliser(mot);
        if (m.Length == 0) return false;
        for (var i = t.IndexOf(m, StringComparison.Ordinal); i >= 0; i = t.IndexOf(m, i + 1, StringComparison.Ordinal))
        {
            if (!Alnum(t, i - 1) && !Alnum(t, i + m.Length)) return true;
        }
        return false;
    }

    /// <summary>Première règle (ordre, puis code) qui s'applique.</summary>
    public static RegleReconnaissance? RegleApplicable(EntreeReconnaissance e, IEnumerable<RegleReconnaissance> regles)
    {
        var zones = new Dictionary<string, string> { ["objet"] = e.Objet, ["texte"] = e.Texte, ["pieces"] = string.Join(' ', e.Pieces) };
        return regles.OrderBy(r => r.Ordre).ThenBy(r => r.Code, StringComparer.Ordinal).FirstOrDefault(r =>
        {
            if (!string.IsNullOrEmpty(r.Expediteur) && !Normaliser(e.De).EndsWith(Normaliser(r.Expediteur), StringComparison.Ordinal)) return false;
            if (r.Mots.Count == 0) return !string.IsNullOrEmpty(r.Expediteur);
            var dans = r.Dans.Count > 0 ? r.Dans : Zones;
            return r.Mots.Any(m => dans.Any(z => ContientMot(zones.GetValueOrDefault(z, ""), m)));
        });
    }

    private static Proposition? Scorer(EntreeReconnaissance e, Candidat c)
    {
        var indices = new List<string>();
        if (!string.IsNullOrEmpty(c.Numero))
        {
            if (ContientMot(e.Objet, c.Numero)) indices.Add("NUMERO_OBJET");
            else if (ContientMot(e.Texte, c.Numero)) indices.Add("NUMERO_TEXTE");
            else if (e.Pieces.Any(p => ContientMot(p, c.Numero))) indices.Add("NUMERO_PIECE");
            else if (ContientMot(e.TextePieces, c.Numero)) indices.Add("NUMERO_PIECE_TEXTE");
        }
        string[] textes = [e.Objet, e.Texte, e.TextePieces];
        if (c.References.Any(r => !string.IsNullOrEmpty(r) && r.Length >= 4 && textes.Any(t => ContientMot(t, r)))) indices.Add("REFERENCE");
        if (indices.Count == 0) return null;
        if (c.TiersId is long t && e.ExpediteurTiers.Contains(t)) indices.Add("EXPEDITEUR");
        return new Proposition(c.Type, c.Id, Math.Min(100, indices.Sum(i => Scores[i])), indices);
    }

    /// <summary>Identifiants comparés comme des nombres s'ils le sont tous deux (même ordre que localeCompare numérique).</summary>
    private static int ComparerId(string a, string b) =>
        long.TryParse(a, out var x) && long.TryParse(b, out var y) ? x.CompareTo(y) : string.CompareOrdinal(a, b);

    public static ResultatReconnaissance Reconnaitre(EntreeReconnaissance e, IReadOnlyList<RegleReconnaissance> regles, int seuilHaut = 80, int seuilBas = 40)
    {
        var regle = RegleApplicable(e, regles);
        var props = new List<Proposition>();
        void Ajouter(Proposition p)
        {
            var i = props.FindIndex(x => x.Type == p.Type && x.Id == p.Id);
            if (i < 0) props.Add(p);
            else if (p.Score > props[i].Score) props[i] = p;
        }
        foreach (var f in e.Fil) Ajouter(new Proposition(f.Type, f.Id, Scores["FIL"], ["FIL"]));
        foreach (var c in e.Candidats)
        {
            if (Scorer(e, c) is { } p) Ajouter(p);
        }
        foreach (var t in e.Tiers)
        {
            if (!props.Any(x => x.Type == t.Type && x.Id == t.Id)) props.Add(new Proposition(t.Type, t.Id, Scores["TIERS"], ["TIERS"]));
        }
        props.Sort((a, b) => b.Score != a.Score ? b.Score.CompareTo(a.Score) : a.Type != b.Type ? string.CompareOrdinal(a.Type, b.Type) : ComparerId(a.Id, b.Id));
        var action = regle?.Action ?? "ALERTER";
        var decision = "A_RAPPROCHER";
        List<Proposition> retenus = [];
        var hauts = props.Where(p => p.Score >= seuilHaut).ToList();
        if (action == "IGNORER") decision = "IGNORE";
        else if (e.Fil.Count > 0) { decision = "RATTACHE"; retenus = props.Where(p => p.Indices.Contains("FIL")).ToList(); }
        else if (hauts.Count == 1) { decision = "RATTACHE"; retenus = hauts; }
        else if (props.Any(p => p.Score >= seuilBas)) decision = "PROPOSE";
        return new ResultatReconnaissance(regle?.Nature, regle?.Code, regle?.Service, decision, retenus, props,
            decision == "RATTACHE" && !e.Automatique && action == "ALERTER");
    }
}
