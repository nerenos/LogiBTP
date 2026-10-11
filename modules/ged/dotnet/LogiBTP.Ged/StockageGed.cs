using System.Security.Cryptography;

namespace LogiBTP.Ged;

public sealed record ContenuStocke(string Empreinte, long Taille, string Chemin);

/// <summary>
/// Stockage des contenus sur le serveur, rangés par empreinte SHA-256 (ab/cd/abcd…) : un dépôt identique partage le
/// fichier existant. L'écriture passe par un fichier temporaire haché au fil de l'eau puis renommé.
/// </summary>
public class StockageGed(string racine)
{
    public string Racine { get; } = Path.GetFullPath(racine);

    public static string CheminRelatif(string empreinte) => Path.Combine(empreinte[..2], empreinte[2..4], empreinte);

    private string Complet(string chemin)
    {
        var complet = Path.GetFullPath(Path.Combine(Racine, chemin));
        if (!complet.StartsWith(Racine + Path.DirectorySeparatorChar, StringComparison.Ordinal)) throw new ArgumentException("Chemin hors du stockage", nameof(chemin));
        return complet;
    }

    public virtual async Task<ContenuStocke> Enregistrer(Stream source, CancellationToken ct = default)
    {
        var temporaires = Path.Combine(Racine, "tmp");
        Directory.CreateDirectory(temporaires);
        var temporaire = Path.Combine(temporaires, Guid.NewGuid().ToString("N"));
        string empreinte;
        long taille;
        try
        {
            using var hachage = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using (var cible = new FileStream(temporaire, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                var tampon = new byte[81920];
                int lus;
                while ((lus = await source.ReadAsync(tampon, ct)) > 0)
                {
                    hachage.AppendData(tampon, 0, lus);
                    await cible.WriteAsync(tampon.AsMemory(0, lus), ct);
                }
                taille = cible.Length;
            }
            empreinte = Convert.ToHexStringLower(hachage.GetHashAndReset());
            var chemin = CheminRelatif(empreinte);
            var final = Complet(chemin);
            if (File.Exists(final)) File.Delete(temporaire);
            else
            {
                Directory.CreateDirectory(Path.GetDirectoryName(final)!);
                try { File.Move(temporaire, final); }
                catch (IOException) when (File.Exists(final)) { File.Delete(temporaire); } // même contenu déposé en parallèle
                File.SetAttributes(final, FileAttributes.ReadOnly);
            }
            return new(empreinte, taille, chemin);
        }
        catch
        {
            if (File.Exists(temporaire)) File.Delete(temporaire);
            throw;
        }
    }

    public virtual Stream Ouvrir(string chemin) =>
        new FileStream(Complet(chemin), FileMode.Open, FileAccess.Read, FileShare.Read, 81920, useAsync: true);

    public virtual bool Existe(string chemin) => File.Exists(Complet(chemin));

    /// <summary>Empreinte recalculée depuis le disque (vérification d'intégrité).</summary>
    public virtual async Task<string?> Recalculer(string chemin, CancellationToken ct = default)
    {
        if (!Existe(chemin)) return null;
        await using var f = Ouvrir(chemin);
        return await ChaineCoffre.Sha256(f, ct);
    }

    public virtual void Supprimer(string chemin)
    {
        var complet = Complet(chemin);
        if (!File.Exists(complet)) return;
        File.SetAttributes(complet, FileAttributes.Normal);
        File.Delete(complet);
    }
}
