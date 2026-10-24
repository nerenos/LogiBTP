using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace LogiBTP.Installation;

/// <summary>
/// Chiffrement des fichiers de sauvegarde (ANALYSE-MODULE-INSTALLATION.md § 7.1, § 10.9 de l'analyse des droits) par la
/// clé des données (LOGIBTP_CLE_CHIFFREMENT) : AES-256-GCM par blocs de 1 Mo (fichiers de toute taille sans tout
/// charger), clé propre à chaque fichier dérivée par HKDF d'un sel aléatoire, numéro du bloc et marque du dernier bloc
/// authentifiés (ni bloc déplacé ni fichier tronqué ne passent). Format : « LOGIBTP-SAUVEGARDE-1 » | sel (16) |
/// préfixe du nonce (8) | blocs [longueur (4) | chiffré | étiquette (16)].
/// </summary>
public static class ChiffrementSauvegarde
{
    public const string Extension = ".chiffre";
    private static readonly byte[] Entete = Encoding.ASCII.GetBytes("LOGIBTP-SAUVEGARDE-1");
    private const int Bloc = 1 << 20;

    private static byte[] Cle(string cleDonnees, byte[] sel) =>
        HKDF.DeriveKey(HashAlgorithmName.SHA256, Encoding.UTF8.GetBytes(cleDonnees), 32, sel, Encoding.ASCII.GetBytes("logibtp-sauvegarde"));

    private static void Nonce(Span<byte> nonce, ReadOnlySpan<byte> prefixe, uint numero)
    {
        prefixe.CopyTo(nonce);
        BinaryPrimitives.WriteUInt32BigEndian(nonce[8..], numero);
    }

    private static byte[] Aad(uint numero, bool dernier)
    {
        var a = new byte[5];
        BinaryPrimitives.WriteUInt32BigEndian(a, numero);
        a[4] = dernier ? (byte)1 : (byte)0;
        return a;
    }

    public static void Chiffrer(Stream entree, Stream sortie, string cleDonnees)
    {
        if (string.IsNullOrEmpty(cleDonnees)) throw new InvalidOperationException("Clé des données absente : chiffrement impossible");
        var sel = RandomNumberGenerator.GetBytes(16);
        var prefixe = RandomNumberGenerator.GetBytes(8);
        sortie.Write(Entete);
        sortie.Write(sel);
        sortie.Write(prefixe);
        using var aes = new AesGcm(Cle(cleDonnees, sel), 16);
        var tampon = new byte[Bloc];
        var suivant = new byte[Bloc];
        var lu = Lire(entree, tampon);
        Span<byte> nonce = stackalloc byte[12];
        var etiquette = new byte[16];
        var longueur = new byte[4];
        for (uint n = 0; ; n++)
        {
            var luSuivant = lu == Bloc ? Lire(entree, suivant) : 0;
            var dernier = luSuivant == 0;
            var chiffre = new byte[lu];
            Nonce(nonce, prefixe, n);
            aes.Encrypt(nonce, tampon.AsSpan(0, lu), chiffre, etiquette, Aad(n, dernier));
            BinaryPrimitives.WriteInt32BigEndian(longueur, lu);
            sortie.Write(longueur);
            sortie.Write(chiffre);
            sortie.Write(etiquette);
            if (dernier) return;
            (tampon, suivant) = (suivant, tampon);
            lu = luSuivant;
        }
    }

    public static void Dechiffrer(Stream entree, Stream sortie, string cleDonnees)
    {
        var entete = new byte[Entete.Length];
        if (Lire(entree, entete) != entete.Length || !entete.AsSpan().SequenceEqual(Entete)) throw new InvalidOperationException("Fichier de sauvegarde chiffré illisible (entête)");
        var sel = new byte[16];
        var prefixe = new byte[8];
        if (Lire(entree, sel) != 16 || Lire(entree, prefixe) != 8) throw new InvalidOperationException("Fichier de sauvegarde chiffré tronqué");
        using var aes = new AesGcm(Cle(cleDonnees, sel), 16);
        Span<byte> nonce = stackalloc byte[12];
        var longueur = new byte[4];
        var etiquette = new byte[16];
        for (uint n = 0; ; n++)
        {
            if (Lire(entree, longueur) != 4) throw new InvalidOperationException("Fichier de sauvegarde chiffré tronqué");
            var l = BinaryPrimitives.ReadInt32BigEndian(longueur);
            if (l is < 0 or > Bloc) throw new InvalidOperationException("Fichier de sauvegarde chiffré altéré");
            var chiffre = new byte[l];
            if (Lire(entree, chiffre) != l || Lire(entree, etiquette) != 16) throw new InvalidOperationException("Fichier de sauvegarde chiffré tronqué");
            var clair = new byte[l];
            Nonce(nonce, prefixe, n);
            // Dernier bloc : seul celui qui est suivi de la fin du fichier ; marque vérifiée par l'étiquette.
            var dernier = entree.Position == entree.Length;
            try { aes.Decrypt(nonce, chiffre, etiquette, clair, Aad(n, dernier)); }
            catch (AuthenticationTagMismatchException) { throw new InvalidOperationException("Sauvegarde altérée, tronquée ou chiffrée par une autre clé des données"); }
            sortie.Write(clair);
            if (dernier) return;
        }
    }

    /// <summary>Chiffre chaque fichier du dossier (hors fichiers déjà chiffrés) en « nom.chiffre » et supprime le clair.</summary>
    public static int ChiffrerDossier(string dossier, string cleDonnees)
    {
        var n = 0;
        foreach (var f in Directory.GetFiles(dossier).Where(f => !f.EndsWith(Extension, StringComparison.Ordinal)))
        {
            using (var e = File.OpenRead(f))
            using (var s = File.Create(f + Extension)) Chiffrer(e, s, cleDonnees);
            File.Delete(f);
            n++;
        }
        return n;
    }

    /// <summary>Déchiffre chaque « nom.chiffre » du dossier en « nom » et supprime le chiffré.</summary>
    public static int DechiffrerDossier(string dossier, string cleDonnees) => DechiffrerDossier(dossier, [cleDonnees]);

    /// <summary>Même chose, par la première clé qui convient (clé courante puis clés précédentes à une rotation).</summary>
    public static int DechiffrerDossier(string dossier, IReadOnlyList<string> cles)
    {
        var n = 0;
        foreach (var f in Directory.GetFiles(dossier, "*" + Extension))
        {
            var clair = f[..^Extension.Length];
            InvalidOperationException? erreur = null;
            foreach (var cle in cles)
            {
                try
                {
                    using (var e = File.OpenRead(f))
                    using (var s = File.Create(clair)) Dechiffrer(e, s, cle);
                    erreur = null;
                    break;
                }
                catch (InvalidOperationException ex) { erreur = ex; }
            }
            if (erreur is not null)
            {
                File.Delete(clair);
                throw erreur;
            }
            File.Delete(f);
            n++;
        }
        return n;
    }

    private static int Lire(Stream s, byte[] tampon)
    {
        var total = 0;
        while (total < tampon.Length)
        {
            var n = s.Read(tampon, total, tampon.Length - total);
            if (n == 0) break;
            total += n;
        }
        return total;
    }
}
