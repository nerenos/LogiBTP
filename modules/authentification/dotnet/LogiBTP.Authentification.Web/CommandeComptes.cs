using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace LogiBTP.Authentification.Web;

/// <summary>
/// Commande serveur de secours (A9) : <c>comptes creer-admin &lt;pseudo&gt;</c> (premier administrateur d'une base neuve,
/// sans personne liée), <c>comptes reinitialiser &lt;pseudo&gt;</c> (mot de passe provisoire, déverrouillé, sessions
/// fermées), <c>comptes deverrouiller &lt;pseudo&gt;</c>, <c>comptes liste</c> ; option <c>--societe &lt;code&gt;</c> (sans : base
/// principale). Le mot de passe provisoire n'est affiché qu'une fois, à recopier ; il est à changer à la première connexion.
/// </summary>
public static class CommandeComptes
{
    public static async Task<int> ExecuterAsync(string[] args, IServiceProvider services, TextWriter sortie)
    {
        var options = args.Select((a, i) => (a, i)).Where(x => x.a.StartsWith("--", StringComparison.Ordinal)).ToDictionary(x => x.a[2..], x => x.i + 1 < args.Length ? args[x.i + 1] : "");
        var positionnels = args.Where((a, i) => !a.StartsWith("--", StringComparison.Ordinal) && (i == 0 || !args[i - 1].StartsWith("--", StringComparison.Ordinal))).ToList();
        var action = positionnels.FirstOrDefault();
        var pseudo = ReglesCompte.Normaliser(positionnels.ElementAtOrDefault(1));
        var societes = services.GetRequiredService<IOptions<OptionsSocietes>>().Value.Societes().ToList();
        var code = options.GetValueOrDefault("societe");
        var societe = string.IsNullOrEmpty(code) ? societes.FirstOrDefault(s => s.Principale) : societes.FirstOrDefault(s => string.Equals(s.Code, code, StringComparison.OrdinalIgnoreCase));
        if (societe is null)
        {
            await sortie.WriteLineAsync($"Société inconnue : {code}");
            return 2;
        }
        await using var portee = services.CreerPorteeSociete(societe);
        var db = portee.ServiceProvider.GetRequiredService<AuthDbContext>();
        var service = portee.ServiceProvider.GetRequiredService<ServiceAuthentification>();
        var console = new ServiceAuthentification.Origine("console", "commande comptes");
        switch (action)
        {
            case "liste":
                foreach (var c in await db.Comptes.AsNoTracking().OrderBy(c => c.CptCode).ToListAsync())
                {
                    var e = ReglesCompte.Etat(c.AEvaluer(), DateTimeOffset.UtcNow);
                    await sortie.WriteLineAsync($"{c.CptCode,-30} {c.CptType,-9} {c.CptProfil,-8} {e.Etat,-18} {c.CptLibelle}");
                }
                return 0;
            case "creer-admin":
            {
                var p = await service.ParametresAsync(default);
                var erreurs = ReglesCompte.ControlerPseudo(pseudo, p.PseudosReserves);
                if (erreurs.Count > 0)
                {
                    await sortie.WriteLineAsync(string.Join(" · ", erreurs.Select(x => ReglesCompte.Messages[x])));
                    return 2;
                }
                if (await db.Comptes.AnyAsync(c => c.CptCode.ToLower() == pseudo))
                {
                    await sortie.WriteLineAsync($"Le compte {pseudo} existe : utilisez « comptes reinitialiser {pseudo} »");
                    return 2;
                }
                var mdp = HachageMotDePasse.Provisoire();
                db.Comptes.Add(new Compte
                {
                    CptCode = pseudo, CptType = "PERSONNE", CptLibelle = options.GetValueOrDefault("libelle") ?? "Administrateur de l'installation",
                    CptHash = HachageMotDePasse.Hacher(mdp), CptMdpProvisoire = true, CptProfil = Profils.Admin, CptCreePar = "console",
                });
                await service.JournaliserAsync(pseudo, "COMPTE", "création de l'administrateur de l'installation", console, "console", default);
                await sortie.WriteLineAsync($"Compte administrateur {pseudo} créé ({societe.Libelle}). Mot de passe provisoire, à changer à la première connexion : {mdp}");
                return 0;
            }
            case "reinitialiser":
            case "deverrouiller":
            {
                var c = await db.Comptes.FirstOrDefaultAsync(x => x.CptCode.ToLower() == pseudo && x.CptType == "PERSONNE");
                if (c is null)
                {
                    await sortie.WriteLineAsync($"Compte inconnu : {pseudo}");
                    return 2;
                }
                c.CptEchecs = 0;
                c.CptVerrouilleJusquAu = null;
                c.CptMajPar = "console";
                c.CptMajLe = DateTimeOffset.UtcNow;
                string? mdp = null;
                if (action == "reinitialiser")
                {
                    mdp = HachageMotDePasse.Provisoire();
                    c.CptHash = HachageMotDePasse.Hacher(mdp);
                    c.CptMdpProvisoire = true;
                    await db.Sessions.Where(x => x.SesCptId == c.CptId && x.SesFermeeLe == null).ExecuteUpdateAsync(x => x.SetProperty(y => y.SesFermeeLe, DateTimeOffset.UtcNow));
                    await ServiceAuthentification.RevoquerJetonsAsync(db, c.CptId, default);
                }
                await service.JournaliserAsync(c.CptCode, action == "reinitialiser" ? "MDP_REINITIALISE" : "DEVERROUILLAGE", "commande serveur", console, "console", default);
                await sortie.WriteLineAsync(mdp is null ? $"Compte {c.CptCode} déverrouillé." : $"Compte {c.CptCode} réinitialisé. Mot de passe provisoire, à changer à la première connexion : {mdp}");
                return 0;
            }
            default:
                await sortie.WriteLineAsync("Usage : comptes creer-admin <pseudo> [--libelle \"…\"] | reinitialiser <pseudo> | deverrouiller <pseudo> | liste   [--societe <code>]");
                return 1;
        }
    }
}
