namespace LogiBTP.Crm;

/// <summary>Note à contrôler : champs lus par <see cref="ReglesNote.Controler"/>.</summary>
public sealed record NoteAControler(string? Nature, string? Etat, string? Objet, long? ResponsableId = null, int? SrvId = null,
    DateTimeOffset? Echeance = null, IReadOnlyCollection<long>? Destinataires = null, long? ParentId = null,
    bool Prive = false, bool Rgpd = false, bool DansFil = false);

/// <summary>
/// Notes du CRM (notes.js côté client, jeu modules/crm/tests/cas/01_note.json) : une tâche a un responsable ou un
/// service et une échéance ; un message a un destinataire (sauf une réponse) ; une note privée ou RGPD n'est pas dans
/// le fil d'actualité.
/// </summary>
public static class ReglesNote
{
    public static readonly string[] Natures = ["ACTION", "MESSAGE", "TACHE"];
    public static readonly string[] Etats = ["A_FAIRE", "EN_COURS", "TERMINE", "MEMO", "ANNULEE"];
    public static readonly string[] EtatsClos = ["TERMINE", "MEMO", "ANNULEE"];
    public const int LongueurObjet = 200;

    /// <summary>Codes d'erreur, dans l'ordre de controlerNote.</summary>
    public static List<string> Controler(NoteAControler n)
    {
        var erreurs = new List<string>();
        if (!Natures.Contains(n.Nature)) erreurs.Add("NOTE_NATURE");
        if (!Etats.Contains(n.Etat)) erreurs.Add("NOTE_ETAT");
        if (string.IsNullOrWhiteSpace(n.Objet) || n.Objet.Trim().Length > LongueurObjet) erreurs.Add("NOTE_OBJET");
        if (n.Nature == "TACHE")
        {
            if (n.ResponsableId is null && n.SrvId is null) erreurs.Add("NOTE_RESPONSABLE");
            if (n.Echeance is null) erreurs.Add("NOTE_ECHEANCE");
        }
        if (n.Nature == "MESSAGE" && n.ParentId is null && (n.Destinataires?.Count ?? 0) == 0) erreurs.Add("NOTE_DESTINATAIRE");
        if (n.DansFil && n.Prive) erreurs.Add("NOTE_PRIVEE_FIL");
        if (n.DansFil && n.Rgpd) erreurs.Add("NOTE_RGPD_FIL");
        return erreurs;
    }

    public static readonly Dictionary<string, string> Messages = new()
    {
        ["NOTE_NATURE"] = "Nature inconnue (action, message ou tâche)",
        ["NOTE_ETAT"] = "État inconnu",
        ["NOTE_OBJET"] = $"Objet obligatoire ({LongueurObjet} caractères au plus)",
        ["NOTE_RESPONSABLE"] = "Une tâche a un responsable, ou un service qui la prendra",
        ["NOTE_ECHEANCE"] = "Une tâche a une échéance",
        ["NOTE_DESTINATAIRE"] = "Un message a au moins un destinataire",
        ["NOTE_PRIVEE_FIL"] = "Une note privée ne paraît pas dans le fil d'actualité",
        ["NOTE_RGPD_FIL"] = "Une note de données personnelles ne paraît pas dans le fil d'actualité",
    };
}
