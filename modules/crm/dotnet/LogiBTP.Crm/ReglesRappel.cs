namespace LogiBTP.Crm;

/// <summary>Rappel à contrôler ou à évaluer : type DATE ou AVANT, date, délai en jours, traité le.</summary>
public sealed record RappelAEvaluer(string? Type, DateTimeOffset? Quand = null, int? DelaiJours = null, DateTimeOffset? TraiteLe = null);

/// <summary>Seuils globaux des couleurs des rappels, en jours avant l'échéance.</summary>
public sealed record SeuilsRappel(decimal Orange = 7, decimal Rouge = 1);

/// <summary>État d'un rappel : actif, visible (liste et widget), couleur VERT / ORANGE / ROUGE, référence (date ou échéance).</summary>
public sealed record EtatRappel(bool Actif, bool Visible, string? Couleur, DateTimeOffset? Reference);

/// <summary>
/// Rappels des notes (rappels.js côté client, jeu modules/crm/tests/cas/02_rappels.json) : un rappel DATE est vert
/// avant sa date, rouge ensuite ; un rappel AVANT prend sa couleur des seuils selon le temps restant jusqu'à l'échéance
/// et paraît dans la liste à partir de l'échéance moins son délai (par défaut le seuil orange). Note close ou rappel
/// traité : inactif.
/// </summary>
public static class ReglesRappel
{
    public static readonly string[] Types = ["DATE", "AVANT"];

    /// <summary>Codes d'erreur, dans l'ordre de controlerRappel.</summary>
    public static List<string> Controler(RappelAEvaluer r, string? etatNote, DateTimeOffset? echeance)
    {
        var erreurs = new List<string>();
        if (!Types.Contains(r.Type)) erreurs.Add("RAPPEL_TYPE");
        if (r.Type == "DATE" && r.Quand is null) erreurs.Add("RAPPEL_DATE");
        if (r.Type == "AVANT")
        {
            if (r.DelaiJours is < 0) erreurs.Add("RAPPEL_DELAI");
            if (echeance is null) erreurs.Add("RAPPEL_ECHEANCE");
        }
        if (ReglesNote.EtatsClos.Contains(etatNote)) erreurs.Add("RAPPEL_CLOS");
        return erreurs;
    }

    public static readonly Dictionary<string, string> Messages = new()
    {
        ["RAPPEL_TYPE"] = "Type de rappel inconnu (à date ou avant l'échéance)",
        ["RAPPEL_DATE"] = "Un rappel à date a une date et une heure",
        ["RAPPEL_DELAI"] = "Le délai avant l'échéance est un nombre entier de jours",
        ["RAPPEL_ECHEANCE"] = "Un rappel avant l'échéance demande une échéance sur la note",
        ["RAPPEL_CLOS"] = "Une note terminée, pour mémo ou annulée ne porte pas de rappel",
    };

    public static EtatRappel Etat(RappelAEvaluer r, string? etatNote, DateTimeOffset? echeance, SeuilsRappel seuils, DateTimeOffset maintenant)
    {
        var inactif = new EtatRappel(false, false, null, null);
        if (r.TraiteLe is not null || ReglesNote.EtatsClos.Contains(etatNote)) return inactif;
        if (r.Type == "DATE")
        {
            return r.Quand is DateTimeOffset q ? new EtatRappel(true, true, maintenant < q ? "VERT" : "ROUGE", q) : inactif;
        }
        if (r.Type != "AVANT" || echeance is not DateTimeOffset e) return inactif;
        var reste = (decimal)(e - maintenant).TotalMilliseconds;
        const decimal jour = 86400000m;
        var delai = r.DelaiJours is int d ? d : seuils.Orange;
        var couleur = reste <= seuils.Rouge * jour ? "ROUGE" : reste <= seuils.Orange * jour ? "ORANGE" : "VERT";
        return new EtatRappel(true, reste <= delai * jour, couleur, e);
    }
}
