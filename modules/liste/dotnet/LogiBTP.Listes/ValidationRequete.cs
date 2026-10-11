using System.Text;
using System.Text.RegularExpressions;

namespace LogiBTP.Listes;

/// <summary>
/// Contrôle d'une requête manuelle (profil ADMIN) : une seule instruction SELECT (ou WITH … SELECT), sans mot-clé
/// d'écriture. Ce n'est qu'une première barrière : la requête est toujours exécutée en sous-requête, dans une
/// transaction en lecture seule et avec un délai maximal, ce qui interdit toute écriture même déguisée.
/// </summary>
public static partial class ValidationRequete
{
    public const int LongueurMax = 20000;

    [GeneratedRegex(@"^\s*(\(\s*)*(select|with)\b", RegexOptions.IgnoreCase)]
    private static partial Regex Debut();

    [GeneratedRegex(@"\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|do|vacuum|analyze|cluster|reindex|lock|set|reset|listen|notify|unlisten|prepare|execute|deallocate|discard|refresh|comment|security|import|load)\b", RegexOptions.IgnoreCase)]
    private static partial Regex Interdits();

    /// <summary>Requête nettoyée (espaces et points-virgules finaux retirés), ou ErreurListe.</summary>
    public static string Valider(string? requete)
    {
        var s = (requete ?? "").Trim();
        while (s.EndsWith(';')) s = s[..^1].TrimEnd();
        if (s.Length == 0) throw new ErreurListe("REQUETE_VIDE", "Requête vide");
        if (s.Length > LongueurMax) throw new ErreurListe("REQUETE_LONGUE", $"Requête limitée à {LongueurMax} caractères");
        var code = SansTextes(s);
        if (code.Contains(';')) throw new ErreurListe("REQUETE_MULTIPLE", "Une seule instruction est autorisée");
        if (!Debut().IsMatch(code)) throw new ErreurListe("REQUETE_SELECT", "La requête doit commencer par SELECT ou WITH");
        var m = Interdits().Match(code);
        if (m.Success) throw new ErreurListe("REQUETE_INTERDITE", $"Mot-clé interdit dans une requête de liste : {m.Value.ToUpperInvariant()}");
        return s;
    }

    /// <summary>Code SQL sans chaînes, identifiants entre guillemets ni commentaires (remplacés par des espaces).</summary>
    public static string SansTextes(string sql)
    {
        var sb = new StringBuilder(sql.Length);
        var i = 0;
        while (i < sql.Length)
        {
            var c = sql[i];
            if (c is '\'' or '"')
            {
                var fin = i + 1;
                while (fin < sql.Length)
                {
                    if (sql[fin] == c)
                    {
                        if (fin + 1 < sql.Length && sql[fin + 1] == c) { fin += 2; continue; }
                        break;
                    }
                    fin++;
                }
                if (fin >= sql.Length) throw new ErreurListe("REQUETE_SYNTAXE", "Chaîne ou identifiant non terminé");
                sb.Append(' ', fin - i + 1);
                i = fin + 1;
            }
            else if (c == '-' && i + 1 < sql.Length && sql[i + 1] == '-')
            {
                var fin = sql.IndexOf('\n', i);
                if (fin < 0) fin = sql.Length;
                sb.Append(' ', fin - i);
                i = fin;
            }
            else if (c == '/' && i + 1 < sql.Length && sql[i + 1] == '*')
            {
                var fin = sql.IndexOf("*/", i + 2, StringComparison.Ordinal);
                if (fin < 0) throw new ErreurListe("REQUETE_SYNTAXE", "Commentaire non terminé");
                sb.Append(' ', fin + 2 - i);
                i = fin + 2;
            }
            else if (c == '$' && DollarQuote(sql, i) is { } balise)
            {
                // Chaîne $balise$…$balise$ : interdite (corps de fonction, contournement des contrôles).
                throw new ErreurListe("REQUETE_INTERDITE", $"Chaîne {balise} non autorisée");
            }
            else
            {
                sb.Append(c);
                i++;
            }
        }
        return sb.ToString();
    }

    private static string? DollarQuote(string sql, int i)
    {
        var fin = sql.IndexOf('$', i + 1);
        if (fin < 0) return null;
        var interieur = sql[(i + 1)..fin];
        var valide = interieur.Length == 0
            || (!char.IsDigit(interieur[0]) && interieur.All(ch => char.IsLetterOrDigit(ch) || ch == '_'));
        return valide ? sql[i..(fin + 1)] : null;
    }
}
