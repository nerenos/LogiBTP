using System.Text.RegularExpressions;

namespace LogiBTP.Installation;

/// <summary>
/// Version « majeur.mineur » d'un module (ANALYSE-VERSIONNEMENT-SCHEMA.md § 7.1). Comparaison numérique (1.9 avant 1.10),
/// jamais alphabétique.
/// </summary>
public readonly partial record struct VersionModule(int Majeur, int Mineur) : IComparable<VersionModule>
{
    /// <summary>Version du socle de départ de chaque module.</summary>
    public static readonly VersionModule Socle = new(1, 0);

    [GeneratedRegex(@"^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$")]
    private static partial Regex Forme();

    public static bool TryAnalyser(string? texte, out VersionModule version)
    {
        version = default;
        if (texte is null || Forme().Match(texte) is not { Success: true } m) return false;
        version = new VersionModule(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value));
        return true;
    }

    public static VersionModule Analyser(string? texte) =>
        TryAnalyser(texte, out var v) ? v : throw new FormatException($"Version de module invalide : « {texte} » (attendu : majeur.mineur, ex. 1.10)");

    public int CompareTo(VersionModule autre) => Majeur != autre.Majeur ? Majeur.CompareTo(autre.Majeur) : Mineur.CompareTo(autre.Mineur);

    public static bool operator <(VersionModule a, VersionModule b) => a.CompareTo(b) < 0;
    public static bool operator >(VersionModule a, VersionModule b) => a.CompareTo(b) > 0;
    public static bool operator <=(VersionModule a, VersionModule b) => a.CompareTo(b) <= 0;
    public static bool operator >=(VersionModule a, VersionModule b) => a.CompareTo(b) >= 0;

    public override string ToString() => $"{Majeur}.{Mineur}";
}
