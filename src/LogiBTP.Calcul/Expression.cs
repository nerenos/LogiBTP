using System.Globalization;

namespace LogiBTP.Calcul;

/// <summary>
/// Analyseur d'expressions en calcul décimal (expression.js côté client).
///   expr    := terme (('+' | '-') terme)*
///   terme   := facteur (('*' | '/') facteur)*
///   facteur := ('+' | '-') facteur | primaire
///   primaire:= nombre | '(' expr ')' | '{{' référence '}}'
/// </summary>
public static class Expression
{
    private enum Genre { Nombre, Reference, Operateur }

    private readonly record struct Jeton(Genre Genre, char Op, decimal Valeur, string Texte);

    public static decimal Evaluer(string? texte, Func<string, decimal> resoudre)
    {
        var jetons = Decouper(texte ?? "");
        if (jetons.Count == 0) throw new ErreurCalcul("FORMULE_VIDE", "Formule vide");
        var i = 0;

        bool Est(char op) => i < jetons.Count && jetons[i].Genre == Genre.Operateur && jetons[i].Op == op;

        decimal Expr()
        {
            var v = Terme();
            while (Est('+') || Est('-'))
            {
                var op = jetons[i++].Op;
                var d = Terme();
                v = op == '+' ? v + d : v - d;
            }
            return v;
        }

        decimal Terme()
        {
            var v = Facteur();
            while (Est('*') || Est('/'))
            {
                var op = jetons[i++].Op;
                var d = Facteur();
                if (op == '*') v *= d;
                else
                {
                    if (d == 0) throw new ErreurCalcul("DIVISION_ZERO", "Division par zéro");
                    v /= d;
                }
            }
            return v;
        }

        decimal Facteur()
        {
            if (i >= jetons.Count) throw new ErreurCalcul("SYNTAXE", "Expression incomplète");
            if (Est('+')) { i++; return Facteur(); }
            if (Est('-')) { i++; return -Facteur(); }
            return Primaire();
        }

        decimal Primaire()
        {
            if (i >= jetons.Count) throw new ErreurCalcul("SYNTAXE", "Expression incomplète");
            var j = jetons[i++];
            if (j.Genre == Genre.Nombre) return j.Valeur;
            if (j.Genre == Genre.Reference) return resoudre(j.Texte);
            if (j.Op == '(')
            {
                var v = Expr();
                if (!Est(')')) throw new ErreurCalcul("SYNTAXE", "Parenthèse fermante attendue");
                i++;
                return v;
            }
            throw new ErreurCalcul("SYNTAXE", $"Jeton inattendu « {j.Texte} »");
        }

        var resultat = Expr();
        if (i < jetons.Count) throw new ErreurCalcul("SYNTAXE", $"Jeton inattendu « {jetons[i].Texte} »");
        return resultat;
    }

    /// <summary>Références {{...}} d'une formule (aide à la saisie).</summary>
    public static IReadOnlyList<string> References(string? texte) =>
        Decouper(texte ?? "").Where(j => j.Genre == Genre.Reference).Select(j => j.Texte).ToList();

    private static bool EstChiffre(string s, int i) => i < s.Length && s[i] >= '0' && s[i] <= '9';

    private static List<Jeton> Decouper(string s)
    {
        var jetons = new List<Jeton>();
        var i = 0;
        while (i < s.Length)
        {
            var c = s[i];
            if (char.IsWhiteSpace(c)) { i++; continue; }
            if (c == '{' && i + 1 < s.Length && s[i + 1] == '{')
            {
                var fin = s.IndexOf("}}", i + 2, StringComparison.Ordinal);
                if (fin < 0) throw new ErreurCalcul("SYNTAXE", "Accolades fermantes « }} » attendues");
                jetons.Add(new Jeton(Genre.Reference, '\0', 0, s[(i + 2)..fin].Trim()));
                i = fin + 2;
                continue;
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
                var txt = s[i..j];
                var v = decimal.Parse(txt.Replace(',', '.'), NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture);
                jetons.Add(new Jeton(Genre.Nombre, '\0', v, txt));
                i = j;
                continue;
            }
            char? op = c switch
            {
                '+' => '+',
                '-' or '−' => '-',
                '*' or '×' => '*',
                '/' or '÷' => '/',
                '(' => '(',
                ')' => ')',
                _ => null,
            };
            if (op is null) throw new ErreurCalcul("SYNTAXE", $"Caractère inattendu « {c} »");
            jetons.Add(new Jeton(Genre.Operateur, op.Value, 0, c.ToString()));
            i++;
        }
        return jetons;
    }
}
