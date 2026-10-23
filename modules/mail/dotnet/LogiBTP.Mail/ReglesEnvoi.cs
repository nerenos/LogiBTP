namespace LogiBTP.Mail;

/// <summary>
/// Limitations d'envoi d'un compte (analyse Mail § 6.3) : débit, taille d'un message, quotas horaire et journalier en
/// destinataires (A, CC et CCI comptés), messages par heure vers un même domaine, nouveaux destinataires par jour.
/// </summary>
public sealed record Limites(int MessagesParMinute, int DestinatairesParMessage, int DestinatairesParHeure, int DestinatairesParJour,
    int MessagesParHeureParDomaine, int NouveauxParJour)
{
    /// <summary>
    /// Défauts par hébergeur (valeurs prudentes, à vérifier à chaque mise en place : les quotas des hébergeurs changent) :
    /// Gmail grand public (500 destinataires par jour), Exchange hébergé OVH, autre.
    /// </summary>
    public static Limites Defaut(string? hebergeur) => hebergeur switch
    {
        "GMAIL" => new(20, 100, 150, 500, 50, 100),
        "OVH" => new(30, 100, 300, 2000, 60, 200),
        _ => new(20, 50, 200, 1000, 60, 200),
    };

    /// <summary>Limites saisies complétées par les défauts de l'hébergeur (valeur absente ou nulle : défaut).</summary>
    public static Limites Completer(string? hebergeur, Limites? saisies)
    {
        var d = Defaut(hebergeur);
        if (saisies is null) return d;
        static int V(int s, int defaut) => s > 0 ? s : defaut;
        return new(V(saisies.MessagesParMinute, d.MessagesParMinute), V(saisies.DestinatairesParMessage, d.DestinatairesParMessage),
            V(saisies.DestinatairesParHeure, d.DestinatairesParHeure), V(saisies.DestinatairesParJour, d.DestinatairesParJour),
            V(saisies.MessagesParHeureParDomaine, d.MessagesParHeureParDomaine), V(saisies.NouveauxParJour, d.NouveauxParJour));
    }
}

/// <summary>Envoi passé d'un compte (journal des envois réussis) : instant, destinataires, nouveaux destinataires, domaines.</summary>
public sealed record EnvoiPasse(DateTimeOffset Le, int Destinataires, int Nouveaux, IReadOnlyList<string> Domaines);

/// <summary>Message à envoyer : destinataires (A, CC, CCI), nouveaux destinataires, domaines, priorité (HAUTE, NORMALE, BASSE).</summary>
public sealed record MessageAEnvoyer(int Destinataires, int Nouveaux, IReadOnlyList<string> Domaines, string Priorite);

/// <summary>Instant d'envoi possible et cause de l'attente (null : tout de suite).</summary>
public sealed record Creneau(DateTimeOffset Quand, string? Cause)
{
    public bool Immediat(DateTimeOffset maintenant) => Quand <= maintenant;
}

/// <summary>Estimation d'un envoi : départ du premier message, fin du dernier, durée.</summary>
public sealed record Estimation(DateTimeOffset Depart, DateTimeOffset Fin, string? Cause)
{
    public TimeSpan Duree => Fin - Depart;
}

/// <summary>Genre d'une erreur SMTP : décide de la suite (nouvel essai, erreur définitive, compte suspendu ou à vérifier).</summary>
public enum GenreErreur { Temporaire, Definitive, Authentification, Blocage }

/// <summary>
/// Règles pures de l'envoi : créneau d'un message selon les limitations et le journal (une limite atteinte met en
/// attente, n'échoue jamais ; les envois en nombre — priorité BASSE — laissent une réserve du quota journalier aux
/// priorités haute et normale), estimation d'un lot, lissage, reprises espacées, classement des erreurs SMTP.
/// </summary>
public static class ReglesEnvoi
{
    public const string Haute = "HAUTE";
    public const string Normale = "NORMALE";
    public const string Basse = "BASSE";

    /// <summary>Délais des nouveaux essais après une erreur temporaire (minutes) ; au-delà : erreur définitive.</summary>
    public static readonly int[] Reprises = [1, 5, 15, 60];

    /// <summary>Instant du prochain essai après <paramref name="tentatives"/> échecs temporaires (null : abandon).</summary>
    public static DateTimeOffset? ProchainEssai(int tentatives, DateTimeOffset maintenant) =>
        tentatives >= 1 && tentatives <= Reprises.Length ? maintenant.AddMinutes(Reprises[tentatives - 1]) : null;

    /// <summary>Écart minimal entre deux messages d'un lot (lissage) : le débit par minute réparti sur la minute.</summary>
    public static TimeSpan Lissage(Limites l) => TimeSpan.FromSeconds(60.0 / Math.Max(1, l.MessagesParMinute));

    /// <summary>
    /// Premier instant, à partir de <paramref name="maintenant"/>, où le message respecte toutes les limitations du compte
    /// compte tenu des envois passés (fenêtres glissantes d'une minute, d'une heure, d'un jour). Un message plus gros que
    /// la limite elle-même part dès que la fenêtre est vide.
    /// </summary>
    public static Creneau Calculer(Limites l, IReadOnlyList<EnvoiPasse> passes, MessageAEnvoyer m, DateTimeOffset maintenant, int reservePct)
    {
        var jour = m.Priorite == Basse ? (int)Math.Floor(l.DestinatairesParJour * (100 - Math.Clamp(reservePct, 0, 100)) / 100.0) : l.DestinatairesParJour;
        var t = maintenant;
        string? cause = null;
        for (var i = 0; i < 20; i++)
        {
            var avant = t;
            Pousser(ref t, ref cause, Attente(passes.Select(p => (p.Le, 1)), TimeSpan.FromMinutes(1), l.MessagesParMinute, 1, t), "débit par minute");
            Pousser(ref t, ref cause, Attente(passes.Select(p => (p.Le, p.Destinataires)), TimeSpan.FromHours(1), l.DestinatairesParHeure, m.Destinataires, t), "quota horaire");
            Pousser(ref t, ref cause, Attente(passes.Select(p => (p.Le, p.Destinataires)), TimeSpan.FromDays(1), jour, m.Destinataires, t),
                m.Priorite == Basse ? "quota journalier (réserve des envois prioritaires)" : "quota journalier");
            Pousser(ref t, ref cause, Attente(passes.Select(p => (p.Le, p.Nouveaux)), TimeSpan.FromDays(1), l.NouveauxParJour, m.Nouveaux, t), "nouveaux destinataires du jour");
            foreach (var d in m.Domaines.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                Pousser(ref t, ref cause, Attente(passes.Where(p => p.Domaines.Contains(d, StringComparer.OrdinalIgnoreCase)).Select(p => (p.Le, 1)),
                    TimeSpan.FromHours(1), l.MessagesParHeureParDomaine, 1, t), $"messages par heure vers {d}");
            }
            if (t == avant) break;
        }
        return new Creneau(t, t > maintenant ? cause : null);
    }

    private static void Pousser(ref DateTimeOffset t, ref string? cause, DateTimeOffset quand, string pourquoi)
    {
        if (quand <= t) return;
        t = quand;
        cause = pourquoi;
    }

    /// <summary>
    /// Premier instant ≥ t où la somme des poids dans la fenêtre (t − fenêtre, t] plus le besoin tient dans la capacité :
    /// les envois les plus anciens sortent de la fenêtre un à un.
    /// </summary>
    public static DateTimeOffset Attente(IEnumerable<(DateTimeOffset Le, int Poids)> passes, TimeSpan fenetre, int capacite, int besoin, DateTimeOffset t)
    {
        if (capacite <= 0) return t;
        var dans = passes.Where(p => p.Le > t - fenetre && p.Le <= t).OrderBy(p => p.Le).ToList();
        var somme = dans.Sum(p => p.Poids);
        if (somme + besoin <= capacite || somme == 0) return t;
        foreach (var p in dans)
        {
            somme -= p.Poids;
            if (somme + besoin <= capacite || somme == 0) return p.Le + fenetre;
        }
        return t;
    }

    /// <summary>
    /// Estimation d'un envoi de plusieurs messages (lot, ou file d'attente devant lui) : simulation message par message,
    /// lissage compris, à partir du journal du compte.
    /// </summary>
    public static Estimation Estimer(Limites l, IReadOnlyList<EnvoiPasse> passes, IReadOnlyList<MessageAEnvoyer> messages, DateTimeOffset maintenant, int reservePct)
    {
        var c = Simuler(l, passes, messages, maintenant, reservePct);
        return c.Count == 0 ? new Estimation(maintenant, maintenant, null) : new Estimation(c[0].Quand, c[^1].Quand, c.FirstOrDefault(x => x.Cause is not null)?.Cause);
    }

    /// <summary>Créneau de chaque message envoyé dans l'ordre (le précédent compte dans le journal simulé), lissage compris.</summary>
    public static List<Creneau> Simuler(Limites l, IReadOnlyList<EnvoiPasse> passes, IReadOnlyList<MessageAEnvoyer> messages, DateTimeOffset maintenant, int reservePct)
    {
        var simule = passes.ToList();
        var res = new List<Creneau>();
        var t = maintenant;
        var lissage = messages.Count > 1 ? Lissage(l) : TimeSpan.Zero;
        foreach (var m in messages)
        {
            var c = Calculer(l, simule, m, t, reservePct);
            res.Add(c);
            simule.Add(new EnvoiPasse(c.Quand, m.Destinataires, m.Nouveaux, m.Domaines));
            t = c.Quand + lissage;
        }
        return res;
    }

    /// <summary>Part du quota journalier déjà consommée (pourcentage entier).</summary>
    public static int TauxQuotaJour(Limites l, IReadOnlyList<EnvoiPasse> passes, DateTimeOffset maintenant) =>
        l.DestinatairesParJour <= 0 ? 0 : (int)(passes.Where(p => p.Le > maintenant.AddDays(-1)).Sum(p => p.Destinataires) * 100L / l.DestinatairesParJour);

    /// <summary>
    /// Classement d'une réponse d'erreur SMTP (code et texte) : authentification (530, 534, 535), blocage par l'hébergeur
    /// (refus de spam ou de quota : 421, 450, 451, 452, 550 5.7.x, 554 5.7.x, textes « spam », « rate », « limit »…),
    /// temporaire (4xx, sans code : réseau), définitive (autres 5xx : adresse inconnue…).
    /// </summary>
    public static GenreErreur Classer(int? code, string? texte)
    {
        var t = (texte ?? "").ToLowerInvariant();
        if (code is 530 or 534 or 535 || t.Contains("authentication") || t.Contains("5.7.8") || t.Contains("5.7.9")) return GenreErreur.Authentification;
        var blocage = t.Contains("spam") || t.Contains("rate limit") || t.Contains("ratelimit") || t.Contains("too many") || t.Contains("quota")
            || t.Contains("limit exceeded") || t.Contains("blocked") || t.Contains("5.7.1") && t.Contains("policy") || t.Contains("4.7.0") || t.Contains("4.7.28");
        if (blocage || code is 421 && (t.Contains("rate") || t.Contains("limit"))) return GenreErreur.Blocage;
        if (code is null or >= 400 and < 500) return GenreErreur.Temporaire;
        return GenreErreur.Definitive;
    }

    /// <summary>Taux de non-remise (pourcentage) d'un compte sur ses derniers envois : non remis / destinataires.</summary>
    public static int TauxNonRemise(int destinataires, int nonRemis) => destinataires <= 0 ? 0 : (int)(nonRemis * 100L / destinataires);

    /// <summary>Découpe une liste de destinataires en paquets de taille au plus <paramref name="taille"/>.</summary>
    public static List<List<T>> Decouper<T>(IReadOnlyList<T> liste, int taille)
    {
        var res = new List<List<T>>();
        for (var i = 0; i < liste.Count; i += Math.Max(1, taille)) res.Add(liste.Skip(i).Take(Math.Max(1, taille)).ToList());
        return res;
    }
}
