namespace LogiBTP.Crm;

/// <summary>Demande à contrôler : objet, état, motif (sans suite), élément créé (projet), montant estimé.</summary>
public sealed record DemandeAControler(string? Objet, string? Etat, string? Motif = null, string? CibleType = null, string? CibleId = null, decimal? MontantEstime = null);

/// <summary>
/// Demandes du CRM (demandes.js côté client, jeu modules/crm/tests/cas/03_demandes.json) : pré-dossier de veille,
/// VEILLE → A_ETUDIER → EN_COURS → TRANSFORMEE (projet) ou SANS_SUITE (motif).
/// </summary>
public static class ReglesDemande
{
    public static readonly string[] Etats = ["VEILLE", "A_ETUDIER", "EN_COURS", "TRANSFORMEE", "SANS_SUITE"];
    public static readonly string[] Motifs = ["PERDUE", "NON_RETENUE", "ABANDONNEE"];
    public static readonly string[] EtatsClos = ["TRANSFORMEE", "SANS_SUITE"];

    /// <summary>Codes d'erreur, dans l'ordre de controlerDemande.</summary>
    public static List<string> Controler(DemandeAControler d)
    {
        var erreurs = new List<string>();
        if (string.IsNullOrWhiteSpace(d.Objet) || d.Objet.Trim().Length > 200) erreurs.Add("DEMANDE_OBJET");
        if (!Etats.Contains(d.Etat)) erreurs.Add("DEMANDE_ETAT");
        var motif = !string.IsNullOrWhiteSpace(d.Motif);
        if ((d.Etat == "SANS_SUITE") != motif || (motif && !Motifs.Contains(d.Motif))) erreurs.Add("DEMANDE_MOTIF");
        if ((d.Etat == "TRANSFORMEE") != (!string.IsNullOrWhiteSpace(d.CibleType) && !string.IsNullOrWhiteSpace(d.CibleId))) erreurs.Add("DEMANDE_CIBLE");
        if (d.MontantEstime is < 0) erreurs.Add("DEMANDE_MONTANT");
        return erreurs;
    }

    public static readonly Dictionary<string, string> Messages = new()
    {
        ["DEMANDE_OBJET"] = "Objet obligatoire (200 caractères au plus)",
        ["DEMANDE_ETAT"] = "État inconnu",
        ["DEMANDE_MOTIF"] = "Une demande sans suite a un motif (perdue, non retenue, abandonnée), et seulement elle",
        ["DEMANDE_CIBLE"] = "Une demande transformée désigne le projet créé, et seulement elle",
        ["DEMANDE_MONTANT"] = "Le montant estimé est positif",
    };
}
