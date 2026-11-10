using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.FactureElectronique.Web;

/// <summary>Résultat de la relève d'un sens : faite ou non (pas encore due), flux lus, nouveaux ou mis à jour, curseur gardé, erreur.</summary>
public sealed record ReleveSens(string Sens, bool Faite, int Lus, int Nouveaux, string? Curseur, string? Erreur);

/// <summary>
/// Relève des flux de la plateforme par curseur (Q11 : pas d'abonnement), un curseur par sens dans fe_releve. Entrants :
/// factures et statuts CDAR téléchargés puis enregistrés (<see cref="ServiceFactureElectronique.EnregistrerEntrantAsync"/>) ;
/// sortants : accusés des flux déposés. Idempotente : un flux déjà connu (connecteur + flowId) n'est jamais repris deux
/// fois, un accusé déjà appliqué ne change rien. Un échec arrête la relève du sens sans avancer son curseur.
/// </summary>
public sealed class ReleveFlux(ServiceFactureElectronique service)
{
    private static readonly string[] SensReleves = [SensFlux.Entrant, SensFlux.Sortant];

    /// <param name="forcer">Relève immédiate (sinon : seulement si la fréquence des paramètres est écoulée).</param>
    /// <param name="limite">Taille des pages demandées (défaut du connecteur).</param>
    public async Task<List<ReleveSens>> ReleverAsync(bool forcer, int? limite, CancellationToken ct)
    {
        var db = service.Db;
        var p = await service.ParametreAsync(ct);
        var resultat = new List<ReleveSens>();
        foreach (var sens in SensReleves)
        {
            var r = await db.Releves.FirstOrDefaultAsync(x => x.FreSens == sens, ct);
            if (r is null)
            {
                db.Releves.Add(r = new ReleveFe { FreSens = sens });
                await db.SaveChangesAsync(ct);
            }
            var maintenant = service.Maintenant;
            if (!forcer && r.FreDerniereReleve is DateTimeOffset d && maintenant - d < TimeSpan.FromMinutes(p.FpaFrequenceReleve))
            {
                resultat.Add(new ReleveSens(sens, false, 0, 0, r.FreCurseur, null));
                continue;
            }
            r.FreDerniereReleve = maintenant;
            try
            {
                var connecteur = service.Connecteur(p);
                var (flux, curseur) = await connecteur.RechercherToutAsync(new CriteresFlux { Sens = [sens] }, r.FreCurseur, limite, ct);
                var nouveaux = 0;
                foreach (var f in flux)
                    if (sens == SensFlux.Entrant ? await EntrantAsync(connecteur, f, curseur ?? r.FreCurseur, ct) : await SortantAsync(connecteur.Code, f, ct))
                        nouveaux++;
                r = await db.Releves.FirstAsync(x => x.FreSens == sens, ct);
                if (curseur is not null) r.FreCurseur = curseur;
                r.FreDernierSucces = service.Maintenant;
                r.FreDerniereErreur = null;
                r.FreNombre += nouveaux;
                r.FreDerniereReleve = maintenant;
                await db.SaveChangesAsync(ct);
                resultat.Add(new ReleveSens(sens, true, flux.Count, nouveaux, r.FreCurseur, null));
            }
            catch (ExceptionMetier e)
            {
                db.ChangeTracker.Clear();
                r = await db.Releves.FirstAsync(x => x.FreSens == sens, ct);
                r.FreDerniereReleve = maintenant;
                r.FreDerniereErreur = Masquage.Texte($"{e.Code} : {e.Message}");
                await db.SaveChangesAsync(ct);
                resultat.Add(new ReleveSens(sens, true, 0, 0, r.FreCurseur, e.Code));
            }
        }
        return resultat;
    }

    private async Task<bool> EntrantAsync(ConnecteurPlateforme connecteur, Flux f, string? curseur, CancellationToken ct)
    {
        if (await service.Db.Flux.AnyAsync(x => x.FflConnecteur == connecteur.Code && x.FflIdFlux == f.IdFlux, ct)) return false;
        var original = await connecteur.TelechargerAsync(f.IdFlux, TypeDocumentFlux.Original, ct);
        await service.EnregistrerEntrantAsync(connecteur.Code, f, original, curseur, EvenementFe.Reception, ActeurFe.Plateforme, null, ct);
        service.Db.ChangeTracker.Clear();
        return true;
    }

    private async Task<bool> SortantAsync(string connecteur, Flux f, CancellationToken ct)
    {
        var local = await service.Db.Flux.FirstOrDefaultAsync(x => x.FflConnecteur == connecteur && x.FflIdFlux == f.IdFlux, ct);
        if (local is null) return false;
        await using var tx = await service.Db.Database.BeginTransactionAsync(ct);
        var change = await service.AppliquerAccuseAsync(local, f, ActeurFe.Plateforme, null, ct);
        await tx.CommitAsync(ct);
        service.Db.ChangeTracker.Clear();
        return change;
    }
}
