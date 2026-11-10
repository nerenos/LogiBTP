using System.Globalization;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Ged.Web;
using LogiBTP.Notifications.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module Facturation électronique spécialisé par le cœur (plans/facturation-electronique.md, lot 11) : activation par
/// société (module_societe « facture_electronique », db/295, la tâche de fond saute une base où il est désactivé),
/// fichiers des flux rattachés à une pièce rangés dans la GED de la pièce (type et groupe d'indices, catégorie
/// facture_electronique ; stockage de la GED sous le nom de la base) et relus depuis elle, signaux publiés dans le centre
/// de notifications (facture reçue, rejet, refus, litige, erreur de la file : niveau et activation par société dans
/// facture_electronique_signal) aux comptes qui consultent le nœud « facture_electronique ». Le jeton de la plateforme
/// vient de l'<c>IFournisseurJeton</c> du module OAuth (fabrique des connecteurs par portée). Création de la pièce
/// reçue en brouillon et rattachements (lot 12) : <see cref="ReceptionFactureBtp"/> ; fichiers d'un flux reçu rangés à
/// l'étape RECEPTION et au coffre, original noté dans document_origine. Spécialisation par portée : services de la
/// requête ou de la portée de la base.
/// </summary>
public sealed class SpecialisationFactureElectroniqueBtp(IServiceProvider services, ILogger<SpecialisationFactureElectroniqueBtp> journal)
    : SpecialisationFactureElectronique
{
    /// <summary>Nœud des droits : Consulter (tableau des flux, chronologies), Modifier (tentative, dépôt et import manuels, relève).</summary>
    public const string Noeud = "facture_electronique";

    /// <summary>Module des notifications publiées.</summary>
    public const string ModuleNotification = "facture_electronique";

    /// <summary>Compte de service des dépôts et lectures de la GED faits par le module (file, relève).</summary>
    private static readonly Utilisateur Service = new("facture_electronique", Profils.Admin);

    /// <summary>Types publiés directement (préférences de notification).</summary>
    public static readonly TypeNotification[] Types =
    [
        new(ModuleNotification, SignauxFe.Recue, "Factures électroniques reçues à traiter"),
        new(ModuleNotification, SignauxFe.Rejet, "Factures électroniques rejetées"),
        new(ModuleNotification, SignauxFe.Refus, "Factures électroniques refusées"),
        new(ModuleNotification, SignauxFe.Litige, "Factures électroniques en litige"),
        new(ModuleNotification, SignauxFe.ErreurFile, "Erreurs de la file des factures électroniques"),
    ];

    /// <summary>Niveau par défaut d'un signal (table facture_electronique_signal absente ou sans ligne).</summary>
    public static string NiveauParDefaut(string signal) => signal switch
    {
        SignauxFe.Rejet or SignauxFe.Refus => NiveauNotification.Urgent,
        SignauxFe.Litige or SignauxFe.ErreurFile => NiveauNotification.Attention,
        _ => NiveauNotification.Info,
    };

    public override async Task<bool> ActifAsync(CancellationToken ct) =>
        await services.GetRequiredService<ModulesSociete>().EstActifAsync(ModulesFacultatifs.FactureElectronique, ct);

    // ----- Réception (lot 12) -----

    private ReceptionFactureBtp Reception => new(services, journal, Service);

    /// <summary>Pièce en brouillon d'une facture reçue (A_FACTURE ou T_FACTURE_AVT), doublon refusé, ou null (reste à traiter).</summary>
    public override Task<PieceRecueFe?> CreerPieceRecueAsync(FactureRecueFe recue, CancellationToken ct) => Reception.CreerAsync(recue, ct);

    // ----- GED -----

    private sealed record PieceGed(string Type, long Groupe, string? Numero);

    /// <summary>Pièce d'un flux rattaché à un document du cœur (type d'élément DOCUMENT), sinon null.</summary>
    public static long? PieceDu(FluxFe flux) =>
        flux.FflTypeElement == TypesElementFe.Document && long.TryParse(flux.FflIdElement, NumberStyles.None, CultureInfo.InvariantCulture, out var id) ? id : null;

    /// <summary>
    /// Fichier d'un flux rattaché à une pièce : rangé dans la GED de la pièce (catégorie facture_electronique,
    /// confidentialité interne) ; flux sans pièce : gardé par le module seul (null). Une GED indisponible ne bloque ni la
    /// file ni la relève : le fichier reste dans fe_fichier, l'incident est journalisé.
    /// </summary>
    public override async Task<long?> RangerAsync(FluxFe flux, string document, FichierFlux fichier, CancellationToken ct)
    {
        if (PieceDu(flux) is not long ent) return null;
        try
        {
            var db = services.GetRequiredService<LogiBtpContext>();
            var piece = (await db.Database.SqlQueryRaw<PieceGed>("""
                SELECT t.tyd_code AS "Type", coalesce(d.ent_groupe_id, d.ent_id) AS "Groupe", d.ent_numero AS "Numero"
                FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE d.ent_id = @e
                """, new NpgsqlParameter("e", ent)).ToListAsync(ct)).FirstOrDefault();
            if (piece is null) return null;
            var nom = fichier.Nom ?? flux.FflNom;
            var titre = $"Facture électronique {flux.FflNumero ?? piece.Numero ?? flux.FflNom} ({document})";
            var resume = $"Flux {flux.FflId} ({flux.FflSens}, {flux.FflSyntaxe}), document {document}";
            // Facture reçue (Q21) : étape RECEPTION, au coffre ; l'original devient le fichier source de document_origine.
            if (flux.FflSens == SensFlux.Entrant)
            {
                var id = await Reception.DeposerAsync(piece.Type, piece.Groupe, nom, fichier.Contenu, fichier.TypeMime, titre, resume, ct);
                if (id is long g && document == TypeDocumentFlux.Original)
                {
                    await db.Database.ExecuteSqlRawAsync("UPDATE document_origine SET dor_fichier_id = @g WHERE dor_ent_id = @e AND dor_fichier_id IS NULL",
                        [new NpgsqlParameter("g", g), new NpgsqlParameter("e", ent)], ct);
                }
                return id;
            }
            await using var contenu = new MemoryStream(fichier.Contenu);
            var formulaire = new FormFile(contenu, 0, fichier.Contenu.Length, "fichier", nom)
            {
                Headers = new HeaderDictionary(), ContentType = fichier.TypeMime ?? "application/octet-stream",
            };
            var depot = await services.GetRequiredService<ServiceGed>().DeposerFichier(formulaire, new MetaDepot
            {
                Titre = titre, Categorie = CategoriesGed.FactureElectronique,
                TypeElement = piece.Type, IdElement = piece.Groupe.ToString(CultureInfo.InvariantCulture), Auteur = Service.Code,
                Confidentialite = NiveauConfidentialite.Interne, Resume = resume,
                MotsCles = ["facture_electronique", document.ToLowerInvariant()],
            }, Service, ct);
            return depot.Id;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            journal.LogWarning("Facturation électronique : fichier {Document} du flux {Flux} non rangé en GED ({Erreur})", document, flux.FflId, Masquage.Texte(e.Message));
            return null;
        }
    }

    public override async Task<FichierFlux?> LireFichierAsync(long gedId, CancellationToken ct)
    {
        try
        {
            return await services.GetRequiredService<ServiceGed>().LireContenu(gedId, Service, ct) is { } c ? new FichierFlux(c.Octets, c.NomFichier, c.TypeMime) : null;
        }
        catch (ExceptionMetier)
        {
            return null;
        }
    }

    // ----- Signaux -----

    /// <summary>Signal d'un signalement du module : facture reçue, accusé en erreur (rejet), erreur de la file ; sinon null.</summary>
    public static string? SignalDe(SignalementFe s) => s.Evenement switch
    {
        EvenementFe.Reception => SignauxFe.Recue,
        EvenementFe.Accuse when s.Etat == EtatFlux.Erreur => SignauxFe.Rejet,
        EvenementFe.Erreur => SignauxFe.ErreurFile,
        _ => null,
    };

    /// <summary>Signal d'un statut reçu : Rejetée (213), Refusée (210), En litige (207) ; sinon null.</summary>
    public static string? SignalDuStatut(string code) => code switch
    {
        StatutCdv.Rejetee => SignauxFe.Rejet,
        StatutCdv.Refusee => SignauxFe.Refus,
        StatutCdv.EnLitige => SignauxFe.Litige,
        _ => null,
    };

    /// <summary>Adresse ouverte par la notification : la pièce rattachée, sinon le flux dans la page du module.</summary>
    public static string Url(FluxFe? flux) => flux is not null && PieceDu(flux) is long ent ? $"/document/{ent}" : flux is null ? "/facture-electronique" : $"/facture-electronique?flux={flux.FflId}";

    /// <summary>Titre et texte d'un signal (serveur, comme les autres notifications).</summary>
    public static (string Titre, string? Texte) Libelle(string signal, string? numero, string? code, string? message)
    {
        var n = string.IsNullOrWhiteSpace(numero) ? "" : $" {numero}";
        var detail = string.Join(" : ", new[] { code, message }.Where(x => !string.IsNullOrWhiteSpace(x)));
        return signal switch
        {
            SignauxFe.Recue => ($"Facture électronique reçue{n}", "Facture reçue de la plateforme, à rattacher ou à saisir"),
            SignauxFe.Recue + PieceCreee => ($"Facture électronique reçue{n}", "Pièce créée en brouillon : à vérifier puis à valider"),
            SignauxFe.Rejet => ($"Facture électronique{n} rejetée", detail.Length == 0 ? null : detail),
            SignauxFe.Refus => ($"Facture électronique{n} refusée par le client", detail.Length == 0 ? null : detail),
            SignauxFe.Litige => ($"Facture électronique{n} en litige", detail.Length == 0 ? null : detail),
            _ => ($"Facture électronique{n} : erreur de la file", detail.Length == 0 ? null : detail),
        };
    }

    /// <summary>Suffixe du libellé d'une facture reçue rattachée à sa pièce (brouillon à vérifier).</summary>
    private const string PieceCreee = ":piece";

    public override Task SignalerAsync(SignalementFe s, CancellationToken ct) =>
        SignalDe(s) is { } signal
            ? PublierAsync(signal, s.Flux, s.Flux.FflNumero, s.Code, s.Message, $"fe:{signal}:{s.Flux.FflId}:{s.Flux.FflEssais}", ct,
                signal == SignauxFe.Recue && PieceDu(s.Flux) is not null ? signal + PieceCreee : signal)
            : Task.CompletedTask;

    public override Task StatutRecuAsync(StatutSignaleFe s, CancellationToken ct) =>
        SignalDuStatut(s.Statut.FstCode) is { } signal
            ? PublierAsync(signal, s.Facture, s.Statut.FstNumeroFacture, s.Statut.FstCode, s.Statut.FstMotif, $"fe:{signal}:statut:{s.Statut.FstId}", ct)
            : Task.CompletedTask;

    private sealed record ReglageSignal(string Niveau, bool Actif);

    private sealed record LigneCompte(string Code, string Profil);

    private async Task PublierAsync(string signal, FluxFe? flux, string? numero, string? code, string? message, string cle, CancellationToken ct,
        string? libelle = null)
    {
        try
        {
            var db = services.GetRequiredService<LogiBtpContext>();
            var reglage = await ReglageAsync(db, signal, ct);
            if (!reglage.Actif) return;
            var (titre, texte) = Libelle(libelle ?? signal, numero, code, message);
            var destinataires = await DestinatairesAsync(db, services.GetService<IDroits>(), ct);
            await services.GetRequiredService<ServiceNotification>().PublierAsync(destinataires.Select(d => new NouvelleNotification(d, ModuleNotification, signal,
                titre, texte, reglage.Niveau, Url(flux), flux is null ? null : TypesElementFe.Flux, flux?.FflId.ToString(CultureInfo.InvariantCulture), cle)), ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Une notification manquée ne doit jamais faire échouer la file ni la relève.
            journal.LogWarning("Facturation électronique : signal {Signal} non publié ({Erreur})", signal, Masquage.Texte(e.Message));
        }
    }

    private static async Task<ReglageSignal> ReglageAsync(LogiBtpContext db, string signal, CancellationToken ct)
    {
        try
        {
            return (await db.Database.SqlQueryRaw<ReglageSignal>(
                "SELECT fsi_niveau AS \"Niveau\", fsi_actif AS \"Actif\" FROM facture_electronique_signal WHERE fsi_code = @c",
                new NpgsqlParameter("c", signal)).ToListAsync(ct)).FirstOrDefault() ?? new(NiveauParDefaut(signal), true);
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UndefinedTable)
        {
            return new(NiveauParDefaut(signal), true);
        }
    }

    /// <summary>Comptes de personnes actifs et valides qui consultent le nœud ; sans module Droits : administrateurs.</summary>
    public static async Task<List<string>> DestinatairesAsync(DbContext db, IDroits? droits, CancellationToken ct)
    {
        var comptes = await db.Database.SqlQueryRaw<LigneCompte>("""
            SELECT cpt_code AS "Code", cpt_profil AS "Profil" FROM compte
            WHERE cpt_type = 'PERSONNE' AND cpt_actif AND (cpt_valide_jusqu_au IS NULL OR cpt_valide_jusqu_au >= current_date)
            ORDER BY cpt_code
            """).ToListAsync(ct);
        var res = new List<string>();
        foreach (var c in comptes)
        {
            var u = new Utilisateur(c.Code, c.Profil);
            if (droits is null ? u.EstAdmin : await droits.AutoriseAsync(u, Noeud, ActionsDroits.Consulter, ct)) res.Add(u.Code);
        }
        return res;
    }
}
