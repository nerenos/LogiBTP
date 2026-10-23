using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using MailKit;
using MailKit.Net.Imap;
using MailKit.Net.Smtp;
using MailKit.Search;
using MailKit.Security;
using MimeKit;

namespace LogiBTP.Mail.Web;

/// <summary>Authentification à un serveur : mot de passe, ou jeton OAuth 2.0 (SASL XOAUTH2) avec le compte connecté.</summary>
public sealed record AuthMail(string Identifiant, string? MotDePasse, string? JetonOAuth);

/// <summary>Erreur d'un serveur de messagerie : code SMTP (null : réseau, délai) et réponse.</summary>
public sealed class ErreurEnvoi(int? code, string message, Exception? interne = null) : Exception(message, interne)
{
    public int? Code { get; } = code;
}

/// <summary>Courriel à construire : expéditeur, réponse, destinataires, objet, corps HTML, pièces, en-têtes du fil.</summary>
public sealed record CourrielAConstruire(IdentiteCompte Expediteur, IdentiteCompte? RepondreA, IReadOnlyList<DestinataireSaisi> A,
    IReadOnlyList<DestinataireSaisi> Cc, IReadOnlyList<DestinataireSaisi> Cci, string Objet, string CorpsHtml, IReadOnlyList<PieceContenu> Pieces,
    string MessageId, string? InReplyTo, string? References, DateTimeOffset Date);

/// <summary>Dossier IMAP à relever : rôle (RECEPTION, A_TRAITER), état de synchronisation (UIDVALIDITY, dernier UID relevé).</summary>
public sealed record DossierARelever(string Nom, string Role, uint? UidValidity, uint DernierUid);

/// <summary>Courriel relevé : UID, drapeau « à suivre », contenu .eml (en-têtes seuls au-delà de la taille maximale).</summary>
public sealed record CourrielReleve(string Dossier, string Role, uint Uid, bool Drapeau, byte[] Eml, bool Tronque);

/// <summary>Résultat d'un dossier : nouvel état de synchronisation, courriels, erreur (dossier introuvable…).</summary>
public sealed record ResultatReleve(string Dossier, uint? UidValidity, uint DernierUid, List<CourrielReleve> Courriels, string? Erreur);

/// <summary>Échanges avec les serveurs (remplacé dans les tests).</summary>
public interface ITransportMail
{
    Task EnvoyerAsync(ServeurMail smtp, AuthMail auth, MimeMessage message, CancellationToken ct);
    Task CopierEnvoyesAsync(ServeurMail imap, AuthMail auth, MimeMessage message, CancellationToken ct);
    Task TesterAsync(ServeurMail? smtp, AuthMail? authSmtp, ServeurMail? imap, AuthMail? authImap, CancellationToken ct);

    /// <summary>
    /// Relève des dossiers : UID supérieurs au dernier relevé (UIDVALIDITY changé : depuis la date donnée), au plus
    /// <paramref name="max"/> par dossier ; marqués lus si demandé, jamais supprimés ni déplacés.
    /// </summary>
    Task<List<ResultatReleve>> ReleverAsync(ServeurMail imap, AuthMail auth, IReadOnlyList<DossierARelever> dossiers, DateTimeOffset depuis, long tailleMax,
        bool marquerLus, int max, CancellationToken ct);

    /// <summary>Après un rattachement (option du compte) : DEPLACER vers un dossier (créé au besoin) ou RETIRER_DRAPEAU.</summary>
    Task ApresRattachementAsync(ServeurMail imap, AuthMail auth, string dossier, uint uid, string action, string? cible, CancellationToken ct);
}

/// <summary>Construction MIME d'un courriel (texte et HTML, pièces jointes, Message-ID maîtrisé).</summary>
public static class ConstructionMail
{
    public static string NouveauMessageId(string adresseExpediteur)
    {
        var domaine = Adresses.Domaine(adresseExpediteur);
        return $"{Guid.NewGuid():N}.logibtp@{(domaine.Length == 0 ? "logibtp.local" : domaine)}";
    }

    public static MimeMessage Construire(CourrielAConstruire c)
    {
        var m = new MimeMessage { Subject = c.Objet, MessageId = c.MessageId, Date = c.Date };
        m.From.Add(new MailboxAddress(c.Expediteur.NomAffiche ?? "", c.Expediteur.Adresse));
        if (c.RepondreA is not null) m.ReplyTo.Add(new MailboxAddress(c.RepondreA.NomAffiche ?? "", c.RepondreA.Adresse));
        foreach (var d in c.A) m.To.Add(new MailboxAddress(d.Nom ?? "", d.Adresse));
        foreach (var d in c.Cc) m.Cc.Add(new MailboxAddress(d.Nom ?? "", d.Adresse));
        foreach (var d in c.Cci) m.Bcc.Add(new MailboxAddress(d.Nom ?? "", d.Adresse));
        if (!string.IsNullOrEmpty(c.InReplyTo)) m.InReplyTo = c.InReplyTo;
        foreach (var r in (c.References ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries)) m.References.Add(r);
        var corps = new BodyBuilder
        {
            HtmlBody = $"<!doctype html><html><head><meta charset=\"utf-8\"></head><body>{c.CorpsHtml}</body></html>",
            TextBody = Texte(c.CorpsHtml),
        };
        foreach (var p in c.Pieces) corps.Attachments.Add(p.Nom, p.Octets, ContentType.Parse(string.IsNullOrEmpty(p.Type) ? "application/octet-stream" : p.Type));
        m.Body = corps.ToMessageBody();
        return m;
    }

    /// <summary>Texte brut d'un corps HTML (partie texte du courriel, extraits) : sauts de ligne des blocs, balises retirées, entités décodées.</summary>
    public static string Texte(string html)
    {
        var t = Regex.Replace(html ?? "", @"<(script|style)[^>]*>.*?</\1>", "", RegexOptions.Singleline | RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"<br\s*/?>|</(p|div|li|tr|h[1-6])>", "\n", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, "<[^>]+>", "");
        t = WebUtility.HtmlDecode(t);
        return Regex.Replace(t, @"\n{3,}", "\n\n").Trim();
    }

    /// <summary>Courriel au format .eml (sans les destinataires en copie cachée, comme le reçoivent les destinataires).</summary>
    public static byte[] Octets(MimeMessage m, bool avecCopieCachee = false)
    {
        var copie = avecCopieCachee ? m : CloneSansCci(m);
        using var flux = new MemoryStream();
        copie.WriteTo(flux);
        return flux.ToArray();
    }

    private static MimeMessage CloneSansCci(MimeMessage m)
    {
        using var flux = new MemoryStream();
        m.WriteTo(flux);
        flux.Position = 0;
        var c = MimeMessage.Load(flux);
        c.Bcc.Clear();
        return c;
    }
}

/// <summary>Transport MailKit : SMTP (SSL ou STARTTLS obligatoire), IMAP pour la copie dans « Envoyés » et le test.</summary>
public sealed class TransportMailKit : ITransportMail
{
    private static readonly TimeSpan Delai = TimeSpan.FromSeconds(60);

    public static SecureSocketOptions Securite(string securite) => securite switch
    {
        "SSL" => SecureSocketOptions.SslOnConnect,
        "STARTTLS" => SecureSocketOptions.StartTls,
        _ => throw new ErreurEnvoi(null, "Connexion non chiffrée refusée : SSL ou STARTTLS obligatoire"),
    };

    public async Task EnvoyerAsync(ServeurMail smtp, AuthMail auth, MimeMessage message, CancellationToken ct)
    {
        using var client = new SmtpClient { Timeout = (int)Delai.TotalMilliseconds };
        await Executer(async () =>
        {
            await client.ConnectAsync(smtp.Hote, smtp.Port, Securite(smtp.Securite), ct);
            await Authentifier(client, auth, ct);
            await client.SendAsync(message, ct);
            await client.DisconnectAsync(true, ct);
        });
    }

    public async Task CopierEnvoyesAsync(ServeurMail imap, AuthMail auth, MimeMessage message, CancellationToken ct)
    {
        using var client = new ImapClient { Timeout = (int)Delai.TotalMilliseconds };
        await Executer(async () =>
        {
            await client.ConnectAsync(imap.Hote, imap.Port, Securite(imap.Securite), ct);
            await Authentifier(client, auth, ct);
            var envoyes = (client.Capabilities & (ImapCapabilities.SpecialUse | ImapCapabilities.XList)) != 0 ? client.GetFolder(SpecialFolder.Sent) : null;
            envoyes ??= await client.GetFolderAsync("Sent", ct);
            await envoyes.AppendAsync(new AppendRequest(message, MessageFlags.Seen), ct);
            await client.DisconnectAsync(true, ct);
        });
    }

    public async Task TesterAsync(ServeurMail? smtp, AuthMail? authSmtp, ServeurMail? imap, AuthMail? authImap, CancellationToken ct)
    {
        if (smtp is not null && authSmtp is not null)
        {
            using var client = new SmtpClient { Timeout = (int)Delai.TotalMilliseconds };
            await Executer(async () =>
            {
                await client.ConnectAsync(smtp.Hote, smtp.Port, Securite(smtp.Securite), ct);
                await Authentifier(client, authSmtp, ct);
                await client.DisconnectAsync(true, ct);
            });
        }
        if (imap is not null && authImap is not null)
        {
            using var client = new ImapClient { Timeout = (int)Delai.TotalMilliseconds };
            await Executer(async () =>
            {
                await client.ConnectAsync(imap.Hote, imap.Port, Securite(imap.Securite), ct);
                await Authentifier(client, authImap, ct);
                await client.Inbox.OpenAsync(FolderAccess.ReadOnly, ct);
                await client.DisconnectAsync(true, ct);
            });
        }
    }

    public async Task<List<ResultatReleve>> ReleverAsync(ServeurMail imap, AuthMail auth, IReadOnlyList<DossierARelever> dossiers, DateTimeOffset depuis,
        long tailleMax, bool marquerLus, int max, CancellationToken ct)
    {
        var res = new List<ResultatReleve>();
        using var client = new ImapClient { Timeout = (int)Delai.TotalMilliseconds };
        await Executer(async () =>
        {
            await client.ConnectAsync(imap.Hote, imap.Port, Securite(imap.Securite), ct);
            await Authentifier(client, auth, ct);
            foreach (var d in dossiers)
            {
                try
                {
                    res.Add(await ReleverDossierAsync(client, d, depuis, tailleMax, marquerLus, max, ct));
                }
                catch (Exception e) when (e is FolderNotFoundException or ImapCommandException)
                {
                    res.Add(new ResultatReleve(d.Nom, d.UidValidity, d.DernierUid, [], e.Message));
                }
            }
            await client.DisconnectAsync(true, ct);
        });
        return res;
    }

    private static async Task<ResultatReleve> ReleverDossierAsync(ImapClient client, DossierARelever d, DateTimeOffset depuis, long tailleMax, bool marquerLus,
        int max, CancellationToken ct)
    {
        var dossier = await client.GetFolderAsync(d.Nom, ct);
        await dossier.OpenAsync(marquerLus ? FolderAccess.ReadWrite : FolderAccess.ReadOnly, ct);
        var dernier = dossier.UidValidity == d.UidValidity ? d.DernierUid : 0u;
        var requete = dernier > 0 ? SearchQuery.Uids(new UniqueIdRange(new UniqueId(dernier + 1), UniqueId.MaxValue))
            : d.Role == "A_TRAITER" ? SearchQuery.All : SearchQuery.DeliveredAfter(depuis.UtcDateTime.Date);
        var uids = (await dossier.SearchAsync(requete, ct)).Where(u => u.Id > dernier).OrderBy(u => u.Id).Take(max).ToList();
        var courriels = new List<CourrielReleve>();
        if (uids.Count > 0)
        {
            foreach (var s in (await dossier.FetchAsync(uids, MessageSummaryItems.UniqueId | MessageSummaryItems.Size | MessageSummaryItems.Flags, ct)).OrderBy(s => s.UniqueId.Id))
            {
                var taille = (long)(s.Size ?? 0);
                byte[] eml;
                var tronque = taille > tailleMax;
                if (tronque)
                {
                    eml = LectureMail.EnTetesSeuls(await dossier.GetHeadersAsync(s.UniqueId, ct), taille);
                }
                else
                {
                    using var o = new MemoryStream();
                    (await dossier.GetMessageAsync(s.UniqueId, ct)).WriteTo(o);
                    eml = o.ToArray();
                }
                courriels.Add(new CourrielReleve(d.Nom, d.Role, s.UniqueId.Id, s.Flags?.HasFlag(MessageFlags.Flagged) == true, eml, tronque));
                if (marquerLus) await dossier.AddFlagsAsync(s.UniqueId, MessageFlags.Seen, true, ct);
                dernier = Math.Max(dernier, s.UniqueId.Id);
            }
        }
        await dossier.CloseAsync(false, ct);
        return new ResultatReleve(d.Nom, dossier.UidValidity, dernier, courriels, null);
    }

    public async Task ApresRattachementAsync(ServeurMail imap, AuthMail auth, string dossier, uint uid, string action, string? cible, CancellationToken ct)
    {
        using var client = new ImapClient { Timeout = (int)Delai.TotalMilliseconds };
        await Executer(async () =>
        {
            await client.ConnectAsync(imap.Hote, imap.Port, Securite(imap.Securite), ct);
            await Authentifier(client, auth, ct);
            var source = await client.GetFolderAsync(dossier, ct);
            await source.OpenAsync(FolderAccess.ReadWrite, ct);
            if (action == "RETIRER_DRAPEAU")
            {
                await source.RemoveFlagsAsync(new UniqueId(uid), MessageFlags.Flagged, true, ct);
            }
            else if (action == "DEPLACER" && !string.IsNullOrWhiteSpace(cible))
            {
                IMailFolder destination;
                try
                {
                    destination = await client.GetFolderAsync(cible, ct);
                }
                catch (FolderNotFoundException)
                {
                    destination = await (await client.GetFolderAsync(client.PersonalNamespaces[0].Path, ct)).CreateAsync(cible, true, ct);
                }
                await source.MoveToAsync(new UniqueId(uid), destination, ct);
            }
            await client.DisconnectAsync(true, ct);
        });
    }

    private static Task Authentifier(IMailService client, AuthMail auth, CancellationToken ct) => auth.JetonOAuth is { } jeton
        ? client.AuthenticateAsync(new SaslMechanismOAuth2(auth.Identifiant, jeton), ct)
        : client.AuthenticateAsync(auth.Identifiant, auth.MotDePasse ?? "", ct);

    /// <summary>Exceptions de MailKit traduites en <see cref="ErreurEnvoi"/> (code SMTP, ou null pour le réseau).</summary>
    private static async Task Executer(Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (SmtpCommandException e)
        {
            throw new ErreurEnvoi((int)e.StatusCode, e.Message, e);
        }
        catch (AuthenticationException e)
        {
            throw new ErreurEnvoi(535, $"Authentification refusée : {e.Message}", e);
        }
        catch (Exception e) when (e is SmtpProtocolException or ImapProtocolException or ImapCommandException or IOException or SocketException
                                       or SslHandshakeException or TimeoutException or ServiceNotConnectedException or FolderNotFoundException)
        {
            throw new ErreurEnvoi(null, e.Message, e);
        }
    }
}
