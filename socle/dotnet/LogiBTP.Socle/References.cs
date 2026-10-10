using System.Text.RegularExpressions;

namespace LogiBTP.Socle;

public abstract record Reference;

/// <summary>Variable de calcul : $$ document, $ titre, @@ ouvrage, @ ligne.</summary>
public sealed record ReferenceVariable(string Portee, string Nom) : Reference;

/// <summary>Donnée : colonne, table.colonne ou table[id].colonne.</summary>
public sealed record ReferenceDonnee(string? Table, string? Id, string Colonne) : Reference;

public static partial class References
{
    [GeneratedRegex(@"^(\$\$|\$|@@|@)([\p{L}_][\p{L}\p{N}_]*)\z")]
    private static partial Regex ReVariable();

    [GeneratedRegex(@"^(?:([A-Za-z_][A-Za-z0-9_]*)(?:\[([0-9]+)\])?\.)?([A-Za-z_][A-Za-z0-9_]*)\z")]
    private static partial Regex ReDonnee();

    public static Reference Analyser(string texte)
    {
        var t = texte.Trim();
        var m = ReVariable().Match(t);
        if (m.Success) return new ReferenceVariable(m.Groups[1].Value, m.Groups[2].Value);
        m = ReDonnee().Match(t);
        if (m.Success)
        {
            return new ReferenceDonnee(
                m.Groups[1].Success ? m.Groups[1].Value.ToLowerInvariant() : null,
                m.Groups[2].Success ? m.Groups[2].Value : null,
                m.Groups[3].Value.ToLowerInvariant());
        }
        throw new ErreurCalcul("REFERENCE_INVALIDE", $"Référence invalide {{{{{t}}}}}");
    }

    public static ReferenceVariable AnalyserCible(string? texte)
    {
        var m = ReVariable().Match((texte ?? "").Trim());
        if (!m.Success) throw new ErreurCalcul("REFERENCE_INVALIDE", $"Variable cible invalide « {texte} »");
        return new ReferenceVariable(m.Groups[1].Value, m.Groups[2].Value);
    }
}
