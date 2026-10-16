using System.Globalization;
using System.Text;

namespace LogiBTP.Metres.Script;

/// <summary>
/// Jeton du langage de script : nb (nombre), ch (chaîne), ref ({{…}} ou variable de portée), id, mc (mot-clé),
/// op (opérateur), nl (fin d'instruction), fin (fin du texte). Ligne et colonne à partir de 1, positions dans le texte.
/// </summary>
public sealed record Jeton(string Genre, string? Texte, decimal Nombre, string? Normalise, int Debut, int Fin, int Ligne, int Colonne);

/// <summary>Erreur d'analyse ou d'exécution d'un script, positionnée.</summary>
public sealed record ErreurScript(string Code, string Message, int Ligne, int Colonne);

/// <summary>Lexeur du langage de script des métrés (réplique de script/lexeur.js).</summary>
public static class Lexeur
{
    /// <summary>Mots réservés (forme normalisée) ; « est », « un », les types et « à » ne le sont qu'en contexte.</summary>
    public static readonly HashSet<string> MotsCles =
    [
        "si", "alors", "sinon", "sinonsi", "fin", "pour", "renvoyer", "sortir", "continuer",
        "et", "ou", "pas", "modulo", "vrai", "faux", "local",
    ];

    private static readonly string[] OperateursDoubles = ["<>", "<=", ">=", "+=", "-=", "*=", "/=", "++", "--"];
    private const string OperateursSimples = "+-*/();=<>";
    private static readonly Dictionary<char, string> Unicode = new()
    {
        ['×'] = "*", ['÷'] = "/", ['−'] = "-", ['≤'] = "<=", ['≥'] = ">=", ['≠'] = "<>",
    };

    // Une fin de ligne est ignorée après ces jetons (l'instruction continue) ou avant ceux de Suite.
    private static readonly HashSet<string> ContinueApres =
        ["+", "-", "*", "/", "=", "<>", "<", "<=", ">", ">=", ";", "(", "+=", "-=", "*=", "/=", "et", "ou", "modulo", "pas"];
    private static readonly HashSet<string> Suite = ["+", "-", "*", "/", "<>", "<", "<=", ">", ">=", "et", "ou", "modulo"];

    // Lettres accentuées et lettre de base (table explicite, identique côté JS : pas de normalisation Unicode,
    // indisponible en mode de globalisation invariante).
    private const string Accentuees = "àáâãäåāăąçćĉċčďèéêëēĕėęěĝğġģĥìíîïĩīĭįıĵķĺļľñńņňŉòóôõöōŏőŕŗřśŝşšţťùúûüũūŭůűųŵýÿŷźżž";
    private const string Bases = "aaaaaaaaacccccdeeeeeeeeegggghiiiiiiiiijklllnnnnnoooooooorrrssssttuuuuuuuuuuwyyyzzz";

    /// <summary>Forme normalisée d'un mot : minuscules sans accents (mots-clés, types, fonctions).</summary>
    public static string Normaliser(string mot)
    {
        var sb = new StringBuilder(mot.Length);
        foreach (var c in mot.ToLowerInvariant())
        {
            var k = Accentuees.IndexOf(c);
            sb.Append(k < 0 ? c : Bases[k]);
        }
        return sb.ToString();
    }

    private static bool EstLettre(char c) => c == '_' || CharUnicodeInfo.GetUnicodeCategory(c) is UnicodeCategory.UppercaseLetter
        or UnicodeCategory.LowercaseLetter or UnicodeCategory.TitlecaseLetter or UnicodeCategory.ModifierLetter or UnicodeCategory.OtherLetter;

    private static bool EstSuiteId(char c) => EstLettre(c) || CharUnicodeInfo.GetUnicodeCategory(c) is UnicodeCategory.DecimalDigitNumber
        or UnicodeCategory.LetterNumber or UnicodeCategory.OtherNumber;

    private static bool EstChiffre(string s, int i) => i < s.Length && s[i] >= '0' && s[i] <= '9';

    /// <summary>Découpe le texte en jetons ; les erreurs de syntaxe sont ajoutées à <paramref name="erreurs"/>.</summary>
    public static List<Jeton> Decouper(string? texte, List<ErreurScript> erreurs)
    {
        var s = texte ?? "";
        var brut = new List<Jeton>();
        var i = 0;
        var ligne = 1;
        var debutLigne = 0;
        var profondeur = 0;
        void Erreur(int k, string message) => erreurs.Add(new ErreurScript("SYNTAXE", message, ligne, k - debutLigne + 1));
        void Pousser(string genre, string? v, int debut, int fin, decimal nombre = 0, string? n = null) =>
            brut.Add(new Jeton(genre, v, nombre, n, debut, fin, ligne, debut - debutLigne + 1));

        while (i < s.Length)
        {
            var c = s[i];
            if (c == '\n')
            {
                if (profondeur == 0) Pousser("nl", null, i, i + 1);
                i++;
                ligne++;
                debutLigne = i;
                continue;
            }
            if (char.IsWhiteSpace(c)) { i++; continue; }
            if (c == '/' && i + 1 < s.Length && s[i + 1] == '/')
            {
                while (i < s.Length && s[i] != '\n') i++;
                continue;
            }
            if (c == '{' && i + 1 < s.Length && s[i + 1] == '{')
            {
                var fin = s.IndexOf("}}", i + 2, StringComparison.Ordinal);
                var finLigne = s.IndexOf('\n', i);
                if (fin < 0 || (finLigne >= 0 && finLigne < fin))
                {
                    Erreur(i, "Accolades fermantes « }} » attendues");
                    i = finLigne < 0 ? s.Length : finLigne;
                    continue;
                }
                Pousser("ref", s[(i + 2)..fin].Trim(), i, fin + 2);
                i = fin + 2;
                continue;
            }
            if ((c == '$' || c == '@') && i + 1 < s.Length)
            {
                var j = i + (s[i + 1] == c ? 2 : 1);
                if (j < s.Length && EstLettre(s[j]))
                {
                    while (j < s.Length && EstSuiteId(s[j])) j++;
                    Pousser("ref", s[i..j], i, j);
                    i = j;
                    continue;
                }
            }
            if (EstChiffre(s, i))
            {
                var j = i;
                while (EstChiffre(s, j)) j++;
                if (j < s.Length && (s[j] == '.' || s[j] == ',') && EstChiffre(s, j + 1))
                {
                    j++;
                    while (EstChiffre(s, j)) j++;
                }
                if (j < s.Length && EstSuiteId(s[j]))
                {
                    Erreur(j, $"Caractère inattendu « {s[j]} » après un nombre");
                    while (j < s.Length && EstSuiteId(s[j])) j++;
                    i = j;
                    continue;
                }
                if (!decimal.TryParse(s[i..j].Replace(',', '.'), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var v))
                {
                    Erreur(i, "Nombre trop grand");
                    v = 0;
                }
                Pousser("nb", null, i, j, v);
                i = j;
                continue;
            }
            if (c == '"')
            {
                var j = i + 1;
                var v = new StringBuilder();
                var ferme = false;
                while (j < s.Length && s[j] != '\n')
                {
                    if (s[j] == '"')
                    {
                        if (j + 1 < s.Length && s[j + 1] == '"') { v.Append('"'); j += 2; continue; }
                        ferme = true;
                        j++;
                        break;
                    }
                    v.Append(s[j++]);
                }
                // Chaîne non fermée : signalée, mais gardée pour ne pas provoquer d'autres erreurs.
                if (!ferme) Erreur(i, "Guillemet fermant attendu");
                Pousser("ch", v.ToString(), i, j);
                i = j;
                continue;
            }
            if (EstLettre(c))
            {
                var j = i;
                while (j < s.Length && EstSuiteId(s[j])) j++;
                var mot = s[i..j];
                var n = Normaliser(mot);
                Pousser(MotsCles.Contains(n) ? "mc" : "id", mot, i, j, 0, n);
                i = j;
                continue;
            }
            var dbl = i + 1 < s.Length ? s.Substring(i, 2) : "";
            if (OperateursDoubles.Contains(dbl))
            {
                Pousser("op", dbl, i, i + 2);
                i += 2;
                continue;
            }
            var op = Unicode.TryGetValue(c, out var u) ? u : OperateursSimples.Contains(c) ? c.ToString() : null;
            if (op is not null)
            {
                if (op == "(") profondeur++;
                if (op == ")") profondeur = Math.Max(0, profondeur - 1);
                Pousser("op", op, i, i + 1);
                i++;
                continue;
            }
            if (c == ',')
            {
                // Virgule entre deux arguments : signalée, puis lue comme un point-virgule.
                Erreur(i, "Les arguments se séparent par un point-virgule « ; »");
                Pousser("op", ";", i, i + 1);
            }
            else Erreur(i, $"Caractère inattendu « {c} »");
            i++;
        }
        Pousser("fin", null, s.Length, s.Length);

        // Fins de ligne : une seule entre deux instructions, ignorées quand l'instruction continue.
        static string? Cle(Jeton j) => j.Genre == "op" ? j.Texte : j.Genre == "mc" ? j.Normalise : null;
        var jetons = new List<Jeton>();
        for (var k = 0; k < brut.Count; k++)
        {
            var j = brut[k];
            if (j.Genre == "nl")
            {
                var prec = jetons.Count > 0 ? jetons[^1] : null;
                if (prec is null || prec.Genre == "nl" || (Cle(prec) is { } cp && ContinueApres.Contains(cp))) continue;
                var m = k + 1;
                while (brut[m].Genre == "nl") m++;
                if (Cle(brut[m]) is { } cs && Suite.Contains(cs)) continue;
            }
            jetons.Add(j);
        }
        return jetons;
    }
}
