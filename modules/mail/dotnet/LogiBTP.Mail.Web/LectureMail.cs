using System.Net;
using MimeKit;

namespace LogiBTP.Mail.Web;

public sealed record AdresseLue(string Adresse, string? Nom);
public sealed record PieceLue(string Nom, string Type, byte[] Octets);

/// <summary>Destinataire non remis d'un avis de non-remise (DSN, RFC 3464) : adresse, statut (5.1.1…), diagnostic du serveur.</summary>
public sealed record NonRemise(string Adresse, string? Statut, string? Diagnostic);

/// <summary>Courriel reçu lu : en-têtes du fil, adresses, objet, corps, pièces, courriel automatique, avis de non-remise.</summary>
public sealed record CourrielLu(string? MessageId, string? InReplyTo, IReadOnlyList<string> References, AdresseLue? De, IReadOnlyList<AdresseLue> A,
    IReadOnlyList<AdresseLue> Cc, string Objet, DateTimeOffset? Date, string CorpsHtml, string Texte, IReadOnlyList<PieceLue> Pieces, bool Automatique,
    string? OriginalMessageId, IReadOnlyList<NonRemise> NonRemises)
{
    public bool EstAvisDeNonRemise => NonRemises.Count > 0;
}

/// <summary>
/// Lecture d'un courriel (.eml) par MimeKit : corps HTML (ou texte mis en HTML), pièces jointes décodées, courriel
/// automatique (Auto-Submitted, X-Autoreply, Precedence, avis de non-remise), avis de non-remise (destinataires en
/// échec, Message-ID du courriel d'origine).
/// </summary>
public static class LectureMail
{
    public static CourrielLu Lire(byte[] eml)
    {
        using var flux = new MemoryStream(eml);
        var m = MimeMessage.Load(flux);
        var de = m.From.Mailboxes.FirstOrDefault() is { } f ? new AdresseLue(f.Address, Vide(f.Name)) : null;
        static List<AdresseLue> Liste(InternetAddressList l) => l.Mailboxes.Select(x => new AdresseLue(x.Address, Vide(x.Name))).ToList();
        var html = m.HtmlBody ?? (m.TextBody is { } t ? $"<p>{WebUtility.HtmlEncode(t).Replace("\r\n", "\n").Replace("\n", "<br>")}</p>" : "");
        var pieces = new List<PieceLue>();
        foreach (var p in m.Attachments.OfType<MimePart>())
        {
            using var o = new MemoryStream();
            p.Content?.DecodeTo(o);
            pieces.Add(new PieceLue(p.FileName ?? "piece", p.ContentType.MimeType, o.ToArray()));
        }
        var (originale, nonRemises) = AvisDeNonRemise(m);
        var auto = nonRemises.Count > 0 || Entete(m, "Auto-Submitted") is { } a && !a.Equals("no", StringComparison.OrdinalIgnoreCase)
            || Entete(m, "X-Autoreply") is not null || Entete(m, "X-Autorespond") is not null
            || Entete(m, "Precedence") is "auto_reply" or "bulk" or "junk";
        return new CourrielLu(Vide(m.MessageId), Vide(m.InReplyTo), m.References.ToList(), de, Liste(m.To), Liste(m.Cc), m.Subject ?? "",
            m.Date == DateTimeOffset.MinValue ? null : m.Date.ToUniversalTime(), html, ConstructionMail.Texte(html), pieces, auto, originale, nonRemises);
    }

    /// <summary>Avis de non-remise (multipart/report ; report-type=delivery-status) : Message-ID d'origine et destinataires en échec.</summary>
    private static (string? Originale, List<NonRemise> NonRemises) AvisDeNonRemise(MimeMessage m)
    {
        if (m.Body is not MultipartReport rapport || !string.Equals(rapport.ReportType, "delivery-status", StringComparison.OrdinalIgnoreCase)) return (null, []);
        var res = new List<NonRemise>();
        string? originale = null;
        foreach (var partie in rapport)
        {
            if (partie is MessageDeliveryStatus statut)
            {
                foreach (var groupe in statut.StatusGroups.Skip(1))
                {
                    if (!string.Equals(groupe["Action"]?.Trim(), "failed", StringComparison.OrdinalIgnoreCase)) continue;
                    var destinataire = (groupe["Final-Recipient"] ?? groupe["Original-Recipient"] ?? "").Split(';').Last().Trim();
                    if (destinataire.Length > 0) res.Add(new NonRemise(destinataire, Vide(groupe["Status"]), Vide(groupe["Diagnostic-Code"]?.Split(';').Last())));
                }
            }
            else if (partie is MessagePart mp && mp.Message is { } origine)
            {
                originale = Vide(origine.MessageId);
            }
            else if (partie is MimePart texte && texte.ContentType.IsMimeType("text", "rfc822-headers") && texte.Content is { } contenu)
            {
                using var o = new MemoryStream();
                contenu.DecodeTo(o);
                o.Position = 0;
                originale = Vide(HeaderList.Load(o)[HeaderId.MessageId]?.Trim('<', '>', ' '));
            }
        }
        return (originale ?? Vide(m.InReplyTo), res);
    }

    private static string? Entete(MimeMessage m, string nom) => m.Headers[nom] is { } v ? v.Trim().ToLowerInvariant() : null;

    private static string? Vide(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>Courriel de remplacement (en-têtes seuls) d'un message trop gros : corps explicatif, sans pièces.</summary>
    public static byte[] EnTetesSeuls(HeaderList entetes, long taille)
    {
        var m = new MimeMessage();
        m.Headers.Clear();
        foreach (var h in entetes.Where(h => h.Id is not (HeaderId.ContentType or HeaderId.ContentTransferEncoding or HeaderId.MimeVersion))) m.Headers.Add(h);
        m.Body = new TextPart("plain") { Text = $"Courriel de {taille / 1024 / 1024} Mo non relevé en entier (taille maximale dépassée) : le consulter dans la messagerie." };
        using var o = new MemoryStream();
        m.WriteTo(o);
        return o.ToArray();
    }
}
