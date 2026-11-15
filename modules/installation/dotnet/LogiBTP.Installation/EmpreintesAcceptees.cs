namespace LogiBTP.Installation;

/// <summary>Ancienne empreinte d'un script publié, acceptée comme équivalente à sa version actuelle (raison au fichier).</summary>
public sealed record EmpreinteAcceptee(string Chemin, string Empreinte, string Raison);

/// <summary>
/// Empreintes acceptées (db/installation/empreintes-acceptees.txt) : un script déjà appliqué ne se modifie plus ; quand un
/// script publié doit pourtant être réduit (une partie extraite dans un nouveau script du manifeste, « extrait-de= »),
/// l'ancienne empreinte SHA-256 de son contenu est inscrite ici. Une base dont le journal porte cette empreinte pour ce
/// chemin n'est pas signalée « modifiée » : son journal reçoit la nouvelle empreinte (les scripts extraits de ce script
/// sont inscrits dans la même transaction, sans exécution : leur contenu est déjà dans la base). Une ligne par
/// empreinte : « chemin empreinte-sha256  # raison » ; lignes vides et commentaires (#) ignorés.
/// </summary>
public sealed class EmpreintesAcceptees
{
    public const string CheminRelatif = "db/installation/empreintes-acceptees.txt";

    public static EmpreintesAcceptees Aucune { get; } = new([]);

    public IReadOnlyList<EmpreinteAcceptee> Lignes { get; }

    private EmpreintesAcceptees(IReadOnlyList<EmpreinteAcceptee> lignes) => Lignes = lignes;

    public static EmpreintesAcceptees Lire(string racine)
    {
        var f = Path.Combine(racine, CheminRelatif);
        return File.Exists(f) ? Analyser(File.ReadAllLines(f)) : Aucune;
    }

    public static EmpreintesAcceptees Analyser(IEnumerable<string> lignes)
    {
        var res = new List<EmpreinteAcceptee>();
        var n = 0;
        foreach (var brute in lignes)
        {
            n++;
            var l = brute.Trim();
            if (l.Length == 0 || l.StartsWith('#')) continue;
            var diese = l.IndexOf('#');
            var raison = diese >= 0 ? l[(diese + 1)..].Trim() : "";
            var mots = (diese >= 0 ? l[..diese] : l).Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries);
            if (mots.Length != 2) throw new FormatException($"Empreintes acceptées, ligne {n} : « chemin empreinte  # raison » attendu");
            if (!mots[0].EndsWith(".sql", StringComparison.Ordinal) || mots[0].Contains('\\') || mots[0].Contains(".."))
                throw new FormatException($"Empreintes acceptées, ligne {n} : chemin de script invalide « {mots[0]} »");
            if (mots[1].Length != 64 || !mots[1].All(c => char.IsAsciiHexDigitLower(c)))
                throw new FormatException($"Empreintes acceptées, ligne {n} : empreinte SHA-256 en 64 chiffres hexadécimaux minuscules attendue");
            if (raison.Length == 0) throw new FormatException($"Empreintes acceptées, ligne {n} : la raison (« # … ») est obligatoire");
            res.Add(new EmpreinteAcceptee(mots[0], mots[1], raison));
        }
        return new EmpreintesAcceptees(res);
    }

    /// <summary>Vrai si <paramref name="empreinte"/> est une ancienne empreinte acceptée de <paramref name="chemin"/>.</summary>
    public bool Accepte(string chemin, string empreinte) =>
        Lignes.Any(l => l.Chemin == chemin && string.Equals(l.Empreinte, empreinte, StringComparison.Ordinal));
}
