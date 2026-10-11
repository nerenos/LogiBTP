using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace LogiBTP.Ged;

/// <summary>Entrée du journal du coffre-fort (table coffre_ged).</summary>
public sealed record EntreeCoffre(
    string EmpreintePrecedente, string EmpreinteDocument, DateTimeOffset Horodatage, long Document, long Version,
    string Utilisateur, string? Motif, string EmpreinteEntree = "");

public sealed record RuptureChaine(int Index, string Raison);

public sealed record ResultatChaine(bool Ok, int Entrees, RuptureChaine? Rupture);

/// <summary>
/// Journal chaîné du coffre-fort : même calcul que coffre.js (jeu partagé modules/ged/tests/cas/01_coffre.json).
/// Texte d'une entrée : précédente|document|horodatage ISO UTC à la milliseconde|n° document|n° version|utilisateur|motif ;
/// son SHA-256 est l'empreinte de l'entrée, reprise comme « précédente » par l'entrée suivante.
/// </summary>
public static class ChaineCoffre
{
    public static readonly string EmpreinteOrigine = new('0', 64);

    public static string Sha256(string texte) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(texte)));

    public static string Sha256(byte[] octets) => Convert.ToHexStringLower(SHA256.HashData(octets));

    public static async Task<string> Sha256(Stream flux, CancellationToken ct = default) =>
        Convert.ToHexStringLower(await SHA256.HashDataAsync(flux, ct));

    /// <summary>Horodatage ramené à la milliseconde (la base garde la microseconde : l'empreinte doit rester recalculable).</summary>
    public static DateTimeOffset Tronquer(DateTimeOffset d) =>
        new DateTimeOffset(d.UtcTicks - d.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);

    /// <summary>ISO 8601 UTC à la milliseconde, comme Date.toISOString() : 2026-10-11T09:56:33.516Z.</summary>
    public static string Horodatage(DateTimeOffset d) =>
        d.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    public static string Texte(EntreeCoffre e) => string.Join('|',
        e.EmpreintePrecedente, e.EmpreinteDocument, Horodatage(e.Horodatage),
        e.Document.ToString(CultureInfo.InvariantCulture), e.Version.ToString(CultureInfo.InvariantCulture), e.Utilisateur, e.Motif ?? "");

    public static string Empreinte(EntreeCoffre e) => Sha256(Texte(e));

    /// <summary>Nouvelle entrée chaînée à la précédente (null = première entrée du journal).</summary>
    public static EntreeCoffre Chainer(EntreeCoffre? precedente, string empreinteDocument, DateTimeOffset horodatage, long document, long version,
        string utilisateur, string? motif)
    {
        var e = new EntreeCoffre(precedente?.EmpreinteEntree ?? EmpreinteOrigine, empreinteDocument, Tronquer(horodatage), document, version, utilisateur, motif);
        return e with { EmpreinteEntree = Empreinte(e) };
    }

    /// <summary>Vérification du journal dans l'ordre : chaînage puis empreinte de chaque entrée.</summary>
    public static ResultatChaine Verifier(IReadOnlyList<EntreeCoffre> entrees)
    {
        var precedente = EmpreinteOrigine;
        for (var i = 0; i < entrees.Count; i++)
        {
            var e = entrees[i];
            if (e.EmpreintePrecedente != precedente) return new(false, entrees.Count, new(i, "Chaînage rompu"));
            if (Empreinte(e) != e.EmpreinteEntree) return new(false, entrees.Count, new(i, "Entrée modifiée"));
            precedente = e.EmpreinteEntree;
        }
        return new(true, entrees.Count, null);
    }
}
