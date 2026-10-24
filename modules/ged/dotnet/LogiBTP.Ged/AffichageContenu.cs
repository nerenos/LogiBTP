namespace LogiBTP.Ged;

public sealed record ReponseContenu(bool EnLigne, string TypeMime);

/// <summary>
/// Affichage d'un contenu servi par la GED. Le type MIME vient du dépôt (donc de l'utilisateur ou d'un courriel reçu) :
/// seuls les formats qui n'exécutent pas de script s'affichent dans le navigateur (PDF, images matricielles, texte
/// brut) ; tout le reste (HTML, SVG, XML…) est téléchargé. La réponse porte aussi `nosniff` et la CSP `sandbox`
/// (ServiceGed.Contenu) : même ouvert dans un onglet, un contenu ne s'exécute jamais dans l'origine de l'application.
/// </summary>
public static class AffichageContenu
{
    public const string Defaut = "application/octet-stream";

    private static readonly HashSet<string> EnLigneAutorises =
        ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "text/plain"];

    /// <summary>Type MIME sans paramètres, en minuscules ; vide ou absent → application/octet-stream.</summary>
    public static string Normaliser(string? typeMime)
    {
        var t = (typeMime ?? "").Split(';')[0].Trim().ToLowerInvariant();
        return t.Length == 0 ? Defaut : t;
    }

    public static ReponseContenu Reponse(string? typeMime, bool telecharger)
    {
        var t = Normaliser(typeMime);
        return new(!telecharger && EnLigneAutorises.Contains(t), t);
    }
}
