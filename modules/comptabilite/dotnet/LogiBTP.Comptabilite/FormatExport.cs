using System.Globalization;
using System.Text;

namespace LogiBTP.Comptabilite;

/// <summary>
/// Modèle d'un fichier d'écritures : séparateur, séparateur décimal, encodage, ligne d'en-tête, format des dates, colonnes
/// (codes de <see cref="FormatExport.Colonnes"/>), longueur maximale des libellés.
/// </summary>
public sealed record ModeleExport(string Code, string Libelle, string Separateur, string Decimale, string Encodage, bool Entete, string FormatDate,
    List<string> Colonnes, int? LongueurLibelle);

/// <summary>Écriture des lignes d'écritures en fichier CSV selon un modèle (Sage 100 par défaut : import paramétrable).</summary>
public static class FormatExport
{
    /// <summary>Colonnes disponibles et leur titre.</summary>
    public static readonly IReadOnlyDictionary<string, string> Colonnes = new Dictionary<string, string>
    {
        ["JOURNAL"] = "Journal", ["DATE"] = "Date", ["PIECE"] = "Pièce", ["REFERENCE"] = "Référence", ["COMPTE"] = "Compte général",
        ["AUXILIAIRE"] = "Compte tiers", ["LIBELLE"] = "Libellé", ["ECHEANCE"] = "Échéance", ["DEBIT"] = "Débit", ["CREDIT"] = "Crédit",
        ["SENS"] = "Sens", ["MONTANT"] = "Montant", ["ANALYTIQUE"] = "Section analytique",
    };

    /// <summary>
    /// Modèle Sage 100 (format d'import paramétrable, à reproduire dans Sage : point-virgule, virgule décimale, ANSI, dates
    /// JJMMAA, sens D / C et montant, libellé de 35 caractères).
    /// </summary>
    public static readonly ModeleExport Sage100 = new("SAGE100", "Sage 100 (import paramétrable)", ";", ",", "windows-1252", false, "ddMMyy",
        ["JOURNAL", "DATE", "PIECE", "COMPTE", "AUXILIAIRE", "REFERENCE", "LIBELLE", "ECHEANCE", "SENS", "MONTANT", "ANALYTIQUE"], 35);

    /// <summary>CSV générique : en-tête, débit et crédit en colonnes, dates JJ/MM/AAAA, UTF-8.</summary>
    public static readonly ModeleExport Generique = new("CSV", "CSV générique", ";", ",", "utf-8", true, "dd/MM/yyyy",
        ["JOURNAL", "DATE", "PIECE", "REFERENCE", "COMPTE", "AUXILIAIRE", "LIBELLE", "ECHEANCE", "DEBIT", "CREDIT", "ANALYTIQUE"], null);

    public static IReadOnlyList<ModeleExport> Modeles => [Sage100, Generique];

    /// <summary>Contrôle d'un modèle : message d'erreur ou null.</summary>
    public static string? Controler(ModeleExport m)
    {
        if (string.IsNullOrEmpty(m.Separateur) || m.Separateur.Length > 1) return "Séparateur d'un caractère";
        if (m.Decimale is not ("," or ".") || m.Decimale == m.Separateur) return "Séparateur décimal : virgule ou point, différent du séparateur";
        if (m.Colonnes.Count == 0 || m.Colonnes.Any(c => !Colonnes.ContainsKey(c))) return "Colonnes inconnues ou absentes";
        try { Encodage(m); } catch (ArgumentException) { return $"Encodage inconnu : {m.Encodage}"; }
        try { _ = DateTime.Today.ToString(m.FormatDate, CultureInfo.InvariantCulture); } catch (FormatException) { return "Format de date invalide"; }
        return null;
    }

    public static Encoding Encodage(ModeleExport m)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        return m.Encodage.Equals("utf-8", StringComparison.OrdinalIgnoreCase) ? new UTF8Encoding(false) : Encoding.GetEncoding(m.Encodage);
    }

    private static string Montant(decimal v, ModeleExport m) => v.ToString("0.00", CultureInfo.InvariantCulture).Replace(".", m.Decimale);

    private static string Champ(string? v, ModeleExport m)
    {
        var s = (v ?? "").Replace("\r", " ").Replace("\n", " ");
        return s.Contains(m.Separateur) || s.Contains('"') ? $"\"{s.Replace("\"", "\"\"")}\"" : s;
    }

    /// <summary>Texte du fichier (lignes séparées par CRLF).</summary>
    public static string Texte(IEnumerable<LigneEcriture> lignes, ModeleExport m)
    {
        var sb = new StringBuilder();
        if (m.Entete) sb.Append(string.Join(m.Separateur, m.Colonnes.Select(c => Champ(Colonnes[c], m)))).Append("\r\n");
        foreach (var l in lignes)
        {
            var libelle = m.LongueurLibelle is int n && l.Libelle.Length > n ? l.Libelle[..n] : l.Libelle;
            var valeurs = m.Colonnes.Select(c => c switch
            {
                "JOURNAL" => l.Journal,
                "DATE" => l.Date.ToString(m.FormatDate, CultureInfo.InvariantCulture),
                "PIECE" => l.Piece,
                "REFERENCE" => l.Reference,
                "COMPTE" => l.Compte,
                "AUXILIAIRE" => l.Auxiliaire,
                "LIBELLE" => libelle,
                "ECHEANCE" => l.Echeance?.ToString(m.FormatDate, CultureInfo.InvariantCulture),
                "DEBIT" => l.Debit == 0 ? "" : Montant(l.Debit, m),
                "CREDIT" => l.Credit == 0 ? "" : Montant(l.Credit, m),
                "SENS" => l.Debit != 0 ? "D" : "C",
                "MONTANT" => Montant(l.Debit != 0 ? l.Debit : l.Credit, m),
                "ANALYTIQUE" => l.Analytique,
                _ => "",
            });
            sb.Append(string.Join(m.Separateur, valeurs.Select(v => Champ(v, m)))).Append("\r\n");
        }
        return sb.ToString();
    }

    public static byte[] Fichier(IEnumerable<LigneEcriture> lignes, ModeleExport m) => Encodage(m).GetBytes(Texte(lignes, m));
}
