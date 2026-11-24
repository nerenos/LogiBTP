using LogiBTP.Ged;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Exécution de reprise lancée depuis l'écran, suivie en mémoire pendant qu'elle tourne en tâche de fond : étape et domaine
/// en cours, éléments faits sur le total, puis numéro et état de l'exécution enregistrée (rapport lu par
/// <c>GET /api/reprise/executions/{id}</c>) ou erreur (code <see cref="ErreurReprise"/> et message).
/// </summary>
public sealed class TacheReprise
{
    private readonly object verrou = new();
    private AvancementReprise avancement = new(EtapeReprise.Preparation, null, 0, 0);

    public required string Id { get; init; }
    public required string Source { get; init; }
    public required bool Simulation { get; init; }
    public string? Auteur { get; init; }
    public DateTimeOffset Debut { get; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? Fin { get; private set; }
    public string Etat { get; private set; } = EtatReprise.EnCours;
    public long? RepriseId { get; private set; }
    public string? Erreur { get; private set; }
    public string? Message { get; private set; }
    internal CancellationTokenSource Arret { get; } = new();

    public bool EnCours { get { lock (verrou) return Etat == EtatReprise.EnCours; } }

    internal void Avancer(AvancementReprise a) { lock (verrou) avancement = a; }

    internal void Terminer(ResultatReprise r)
    {
        lock (verrou) { RepriseId = r.RepriseId; Etat = r.Rapport.Etat; Fin = DateTimeOffset.UtcNow; }
    }

    internal void Echouer(string code, string message)
    {
        lock (verrou) { Erreur = code; Message = message; Etat = EtatReprise.Echec; Fin = DateTimeOffset.UtcNow; }
    }

    /// <summary>État renvoyé à l'écran (instantané cohérent).</summary>
    public object Instantane()
    {
        lock (verrou)
            return new
            {
                id = Id, source = Source, simulation = Simulation, auteur = Auteur, debut = Debut, fin = Fin, etat = Etat,
                etape = avancement.Etape, element = avancement.Element, faits = avancement.Faits, total = avancement.Total,
                arret_demande = Arret.IsCancellationRequested, reprise_id = RepriseId, erreur = Erreur, message = Message,
            };
    }
}

/// <summary>
/// Reprises de l'écran en tâche de fond (une seule à la fois par base) : la requête HTTP rend la main aussitôt, l'écran
/// interroge l'avancement. Une reprise sur une grosse base dure bien plus longtemps qu'une requête ne peut rester ouverte
/// sans risque (navigateur, proxy, mise en veille) ; elle tournait dans la requête et s'annulait avec elle (annulation de
/// la requête → transaction annulée, aucun rapport). Mémoire du processus : une seule instance de l'API, comme le
/// Diffuseur ; la dernière tâche de chaque base est gardée jusqu'à la suivante (ou au redémarrage de l'API).
/// </summary>
public sealed class TachesReprise(IServiceProvider services, IHostApplicationLifetime vie, ILogger<TachesReprise> journal)
{
    private readonly object verrou = new();
    private readonly Dictionary<string, TacheReprise> parBase = new(StringComparer.Ordinal);

    /// <summary>Dernière tâche de la base de la société (en cours ou terminée), null si aucune depuis le démarrage.</summary>
    public TacheReprise? Derniere(SocieteCourante societe)
    {
        lock (verrou) return parBase.GetValueOrDefault(societe.Connexion);
    }

    /// <summary>Lance la reprise en tâche de fond dans la base de la société ; refus 409 si une autre y tourne déjà.</summary>
    public TacheReprise Lancer(SocieteCourante societe, DemandeReprise demande)
    {
        var tache = new TacheReprise { Id = Guid.NewGuid().ToString("N"), Source = demande.Source, Simulation = demande.Simulation, Auteur = demande.Auteur };
        lock (verrou)
        {
            if (parBase.TryGetValue(societe.Connexion, out var actuelle) && actuelle.EnCours)
                throw ExceptionMetier.Conflit(ErreurReprise.EnCours, "Une reprise est déjà en cours pour cette base");
            parBase[societe.Connexion] = tache;
        }
        _ = Task.Run(() => ExecuterAsync(societe, demande, tache));
        return tache;
    }

    /// <summary>Demande l'arrêt de la tâche en cours de la base (transaction annulée, rien d'écrit) ; false s'il n'y en a pas.</summary>
    public bool Arreter(SocieteCourante societe)
    {
        var tache = Derniere(societe);
        if (tache is null || !tache.EnCours) return false;
        tache.Arret.Cancel();
        return true;
    }

    private async Task ExecuterAsync(SocieteCourante societe, DemandeReprise demande, TacheReprise tache)
    {
        using var arret = CancellationTokenSource.CreateLinkedTokenSource(tache.Arret.Token, vie.ApplicationStopping);
        try
        {
            await using var portee = services.CreerPorteeSociete(societe);
            var unite = portee.ServiceProvider.GetRequiredService<UniteEcriture>();
            var stockage = portee.ServiceProvider.GetRequiredService<StockageGed>();
            var r = await RepriseBase.ExecuterAsync(demande with { StockageGed = stockage.Racine, Avancement = tache.Avancer }, unite, arret.Token);
            tache.Terminer(r);
            journal.LogInformation("Reprise {Source} ({Base}) : exécution {Id} {Etat}", demande.Source, societe.Base, r.RepriseId, r.Rapport.Etat);
        }
        catch (OperationCanceledException)
        {
            tache.Echouer(ErreurReprise.Interrompue, "Reprise interrompue : rien n'a été écrit dans la base");
            journal.LogWarning("Reprise {Source} ({Base}) interrompue", demande.Source, societe.Base);
        }
        catch (RepriseRefuseeException e)
        {
            tache.Echouer(e.Code, e.Message);
        }
        catch (ArgumentException e)
        {
            // Chaîne de connexion de la source illisible : message masqué (la chaîne peut contenir un mot de passe).
            tache.Echouer(ErreurReprise.SourceIncompatible, Masquage.Texte(e.Message) ?? e.GetType().Name);
        }
        catch (Exception e)
        {
            journal.LogError(e, "Reprise {Source} ({Base}) en erreur", demande.Source, societe.Base);
            tache.Echouer(ErreurReprise.Erreur, Masquage.Texte(e.Message) ?? e.GetType().Name);
        }
    }
}
