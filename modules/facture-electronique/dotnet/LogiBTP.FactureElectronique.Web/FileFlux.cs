using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.FactureElectronique.Web;

/// <summary>Résultat d'un passage de la file : flux déposés, repris plus tard, en erreur.</summary>
public sealed record ResultatFile(int Deposes, int Reprises, int Erreurs);

/// <summary>
/// File des flux à émettre de la base courante : chaque flux A_ENVOYER dû est pris sous verrou de ligne
/// (FOR UPDATE SKIP LOCKED : deux passages simultanés ne déposent jamais le même flux), déposé par le connecteur de la
/// société depuis son original, puis ENVOYE (étape DEPOT). Échec reprenable (délai, 429, 5xx, plateforme injoignable) :
/// reprises après 1, 5, 15 puis 60 minutes comme le Mail (étape REPRISE), puis ERREUR ; échec définitif : ERREUR (étape
/// ERREUR, signalement). Une transaction par flux.
/// </summary>
public sealed class FileFlux(ServiceFactureElectronique service)
{
    /// <summary>Délais des reprises, en minutes (même suite que <c>ReglesEnvoi.Reprises</c> du module Mail).</summary>
    public static readonly int[] Reprises = [1, 5, 15, 60];

    /// <summary>Prochain essai après <paramref name="essais"/> échecs ; null : plus de reprise.</summary>
    public static DateTimeOffset? ProchainEssai(int essais, DateTimeOffset maintenant) =>
        essais >= 1 && essais <= Reprises.Length ? maintenant.AddMinutes(Reprises[essais - 1]) : null;

    public async Task<ResultatFile> TraiterAsync(int maximum, CancellationToken ct)
    {
        var db = service.Db;
        var p = await service.ParametreAsync(ct);
        int deposes = 0, reprises = 0, erreurs = 0;
        for (var i = 0; i < maximum; i++)
        {
            var maintenant = service.Maintenant;
            await using var tx = await db.Unite().CommencerAsync(ct);
            var f = (await db.Flux.FromSqlInterpolated($"""
                SELECT * FROM fe_flux
                 WHERE ffl_etat = 'A_ENVOYER' AND ffl_sens = 'Out' AND (ffl_prochain_essai IS NULL OR ffl_prochain_essai <= {maintenant})
                 ORDER BY ffl_prochain_essai NULLS FIRST, ffl_id
                 LIMIT 1 FOR UPDATE SKIP LOCKED
                """).ToListAsync(ct)).FirstOrDefault();
            if (f is null) break;
            var original = await db.Fichiers.AsNoTracking().FirstOrDefaultAsync(x => x.FfiFflId == f.FflId && x.FfiDocument == TypeDocumentFlux.Original, ct);
            if (original is null)
            {
                f.FflEssais++;
                await Abandon(f, ErreurFe.RessourceIntrouvable, "Original du flux absent", null, null, ct);
                erreurs++;
            }
            else
            {
                switch (await DeposerAsync(f, original, p, ct))
                {
                    case EtatFlux.Envoye: deposes++; break;
                    case EtatFlux.AEnvoyer: reprises++; break;
                    default: erreurs++; break;
                }
            }
            await tx.CommitAsync(ct);
            service.Db.ChangeTracker.Clear();
        }
        return new ResultatFile(deposes, reprises, erreurs);
    }

    private async Task<string> DeposerAsync(FluxFe f, FichierFe original, ParametreFe p, CancellationToken ct)
    {
        var db = service.Db;
        f.FflEssais++;
        ConnecteurPlateforme connecteur;
        FluxDepose depose;
        try
        {
            // Le flux part par le connecteur de sa création (un changement de connecteur ne déroute pas un flux en file).
            connecteur = service.Connecteur(f.FflConnecteur == p.FpaConnecteur ? p : new ParametreFe { FpaConnecteur = f.FflConnecteur });
            depose = await connecteur.DeposerAsync(new FluxADeposer(original.FfiContenu, f.FflNom, f.FflSyntaxe)
            {
                Profil = f.FflProfil, RegleTraitement = f.FflRegle, IdentifiantSuivi = f.FflIdSuivi,
            }, ct);
        }
        catch (ExceptionConnecteur e)
        {
            return await Echec(f, e.Code, e.Message, e.Reessayable, e.StatutHttp, e.RequestId, ct);
        }
        catch (Exception e) when (e is not OperationCanceledException and not ExceptionMetier and not PostgresException)
        {
            return await Echec(f, ErreurFe.ErreurPlateforme, e.Message, true, null, null, ct);
        }
        var avant = f.FflEtat;
        f.FflIdFlux = depose.IdFlux;
        f.FflDeposeLe = depose.DeposeLe;
        f.FflEtat = EtatFlux.Envoye;
        f.FflAccuse = EtatAccuse.EnAttente;
        f.FflProchainEssai = null;
        f.FflDerniereErreur = null;
        f.FflModifieLe = service.Maintenant;
        if (depose.Profil is not null && f.FflProfil is null) f.FflProfil = depose.Profil;
        await db.SaveChangesAsync(ct);
        await JournalFe.AjouterAsync(db, EtapeFe.Du(f, EvenementFe.Depot, ActeurFe.Systeme) with
        {
            EtatAvant = avant, EtatApres = f.FflEtat,
            Detail = new { id_flux = depose.IdFlux, essai = f.FflEssais, connecteur = connecteur.Code, manuel = !connecteur.TransmetAutomatiquement, depose_le = depose.DeposeLe },
        }, ct);
        return f.FflEtat;
    }

    private async Task<string> Echec(FluxFe f, string code, string message, bool reessayable, int? statutHttp, string? requestId, CancellationToken ct)
    {
        var prochain = reessayable ? ProchainEssai(f.FflEssais, service.Maintenant) : null;
        if (prochain is null)
        {
            await Abandon(f, code, message, statutHttp, requestId, ct);
            return EtatFlux.Erreur;
        }
        service.AjouterErreur(f, code, message, statutHttp: statutHttp, requestId: requestId);
        f.FflProchainEssai = prochain;
        f.FflModifieLe = service.Maintenant;
        await service.Db.SaveChangesAsync(ct);
        await JournalFe.AjouterAsync(service.Db, EtapeFe.Du(f, EvenementFe.Reprise, ActeurFe.Systeme) with
        {
            EtatAvant = f.FflEtat, EtatApres = f.FflEtat,
            Detail = new { code, essai = f.FflEssais, prochain_essai = prochain, statut_http = statutHttp, request_id = requestId },
        }, ct);
        return EtatFlux.AEnvoyer;
    }

    private async Task Abandon(FluxFe f, string code, string message, int? statutHttp, string? requestId, CancellationToken ct)
    {
        var avant = f.FflEtat;
        service.AjouterErreur(f, code, message, statutHttp: statutHttp, requestId: requestId);
        f.FflEtat = EtatFlux.Erreur;
        f.FflProchainEssai = null;
        f.FflModifieLe = service.Maintenant;
        await service.Db.SaveChangesAsync(ct);
        await JournalFe.AjouterAsync(service.Db, EtapeFe.Du(f, EvenementFe.Erreur, ActeurFe.Systeme) with
        {
            EtatAvant = avant, EtatApres = f.FflEtat,
            Detail = new { code, essai = f.FflEssais, statut_http = statutHttp, request_id = requestId },
        }, ct);
        await service.Specialisation.SignalerAsync(new SignalementFe(EvenementFe.Erreur, f, f.FflEtat, code, LogiBTP.Socle.Masquage.Texte(message)), ct);
    }
}

/// <summary>Réglages de la tâche de fond (section « FactureElectronique ») : actif, intervalle en secondes, flux par passage.</summary>
public sealed class OptionsFactureElectronique
{
    public bool Actif { get; set; } = true;
    public int IntervalleSecondes { get; set; } = 15;
    public int FluxParPassage { get; set; } = 20;
}

/// <summary>
/// Tâche de fond : à chaque réveil, pour chaque société dont le module est actif (fe_parametre.fpa_actif), passage de la
/// file (<see cref="FileFlux"/>) puis relève due (<see cref="ReleveFlux"/>). Une base sans le schéma du module est
/// ignorée ; une base en erreur n'empêche pas les suivantes.
/// </summary>
public sealed class PassageFactureElectronique(IServiceProvider services, IOptions<OptionsFactureElectronique> options,
    IOptions<OptionsSocietes> societes, ILogger<PassageFactureElectronique> journal, TimeProvider horloge) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!options.Value.Actif) return;
        try { await Task.Delay(TimeSpan.FromSeconds(20), horloge, ct); } catch (OperationCanceledException) { return; }
        while (!ct.IsCancellationRequested)
        {
            await ExecuterAsync(ct);
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(5, options.Value.IntervalleSecondes)), horloge, ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    public async Task ExecuterAsync(CancellationToken ct)
    {
        foreach (var societe in societes.Value.Societes())
        {
            try
            {
                await using var portee = services.CreerPorteeSociete(societe);
                var sp = portee.ServiceProvider;
                if (!await sp.GetRequiredService<SpecialisationFactureElectronique>().ActifAsync(ct)) continue;
                if (!(await sp.GetRequiredService<ServiceFactureElectronique>().ParametreAsync(ct)).FpaActif) continue;
                await sp.GetRequiredService<FileFlux>().TraiterAsync(options.Value.FluxParPassage, ct);
                await sp.GetRequiredService<ReleveFlux>().ReleverAsync(false, null, ct);
            }
            catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UndefinedTable)
            {
                journal.LogDebug("Facturation électronique : schéma absent de la base {Societe}", societe.Libelle);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                journal.LogWarning("Facturation électronique : passage de la base {Societe} non fait ({Erreur})", societe.Libelle,
                    LogiBTP.Socle.Masquage.Texte(e.Message));
            }
        }
    }
}
