using System.Text.Json;
using LogiBTP.Crm;
using LogiBTP.Domaine.Ressources;
using LogiBTP.Notifications.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Rappels du CRM devenus visibles (règle <see cref="ReglesRappel"/> : couleur selon les seuils de la société) : une
/// notification par rappel et par couleur (le passage à l'orange puis au rouge notifie de nouveau), au responsable
/// désigné par le rappel (individu → identifiant de connexion) ou, sans individu, à son auteur. Module CRM actif seulement.
/// </summary>
public sealed class SourceRappelsCrm(LogiBtpContext db, ModulesSociete modules) : ISourceNotifications
{
    public string Code => "crm-rappels";
    public TimeSpan Periode => TimeSpan.FromMinutes(1);
    public IReadOnlyList<TypeNotification> Types { get; } = [new("crm", "RAPPEL", "Rappels des notes et tâches du suivi")];

    private sealed record Ligne(long RapId, string RapType, DateTimeOffset? RapQuand, int? RapDelaiJours, long NotId, string NotEtat,
        DateTimeOffset? NotEcheance, string NotObjet, string? Utilisateur);

    public async Task<IEnumerable<NouvelleNotification>> ProduireAsync(IServiceProvider portee, DateTimeOffset maintenant, CancellationToken ct)
    {
        if (!await modules.EstActifAsync("crm", ct)) return [];
        // Pas d'accolades dans le SQL brut d'EF (lues comme paramètres) : valeur absente traitée ici.
        var seuilsJson = await db.Database.SqlQueryRaw<string>("SELECT cpa_valeur::text AS \"Value\" FROM crm_parametre WHERE cpa_cle = 'seuils_rappel'").FirstOrDefaultAsync(ct);
        var seuils = seuilsJson is null ? new SeuilsRappel() : JsonSerializer.Deserialize<SeuilsRappel>(seuilsJson, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new SeuilsRappel();
        var lignes = await db.Database.SqlQueryRaw<Ligne>("""
            SELECT r.rap_id, r.rap_type, r.rap_quand, r.rap_delai_jours, n.not_id, n.not_etat, n.not_echeance, n.not_objet,
                   coalesce(i.ind_utilisateur, r.rap_cree_par) AS utilisateur
            FROM crm_rappel r JOIN crm_note n ON n.not_id = r.rap_not_id LEFT JOIN individu i ON i.ind_id = r.rap_ind_id
            WHERE r.rap_traite_le IS NULL AND n.not_archivee_le IS NULL AND n.not_etat NOT IN ('TERMINE', 'MEMO', 'ANNULEE')
            """).ToListAsync(ct);
        var res = new List<NouvelleNotification>();
        foreach (var l in lignes)
        {
            var e = ReglesRappel.Etat(new RappelAEvaluer(l.RapType, l.RapQuand, l.RapDelaiJours), l.NotEtat, l.NotEcheance, seuils, maintenant);
            if (!e.Actif || !e.Visible || l.Utilisateur is null) continue;
            res.Add(new NouvelleNotification(l.Utilisateur, "crm", "RAPPEL", $"Rappel : {l.NotObjet}",
                l.NotEcheance is { } ech ? $"Échéance le {ech.ToLocalTime():dd/MM/yyyy HH:mm}" : null,
                e.Couleur switch { "ROUGE" => "URGENT", "ORANGE" => "ATTENTION", _ => "INFO" }, $"/crm/note/{l.NotId}", "crm_note", l.NotId.ToString(),
                $"crm-rappel:{l.RapId}:{e.Couleur}"));
        }
        return res;
    }
}

/// <summary>
/// Habilitations des salariés actifs et des matériels expirées ou à renouveler dans les 30 jours (la dernière par type et
/// élément) : une synthèse par jour au responsable du service de la ressource (service principal du salarié, service du
/// matériel), et aux administrateurs pour les ressources sans responsable.
/// </summary>
public sealed class SourceHabilitations(LogiBtpContext db) : ISourceNotifications
{
    public string Code => "ressources-habilitations";
    public TimeSpan Periode => TimeSpan.FromHours(6);
    public IReadOnlyList<TypeNotification> Types { get; } = [new("ressources", "HABILITATION", "Habilitations expirées ou à renouveler")];

    private sealed record Ligne(string Code, DateOnly? ObtenueLe, DateOnly? ValideJusquAu, int? DureeMois, string? Responsable);

    public async Task<IEnumerable<NouvelleNotification>> ProduireAsync(IServiceProvider portee, DateTimeOffset maintenant, CancellationToken ct)
    {
        var lignes = await db.Database.SqlQueryRaw<Ligne>("""
            WITH derniere AS (
                SELECT DISTINCT ON (h.hab_type_element, h.hab_id_element, h.hab_tha_code) h.*
                FROM habilitation h ORDER BY h.hab_type_element, h.hab_id_element, h.hab_tha_code, h.hab_obtenue_le DESC NULLS LAST, h.hab_id DESC)
            SELECT d.hab_tha_code AS code, d.hab_obtenue_le AS obtenue_le, d.hab_valide_jusqu_au AS valide_jusqu_au, t.tha_duree_mois AS duree_mois,
                   CASE d.hab_type_element
                     WHEN 'salarie' THEN (SELECT r.ind_utilisateur FROM salarie s JOIN service_membre m ON m.sme_ind_id = s.sal_ind_id AND m.sme_principal
                                          JOIN service sv ON sv.srv_id = m.sme_srv_id JOIN individu r ON r.ind_id = sv.srv_responsable_id WHERE s.sal_id = d.hab_id_element)
                     ELSE (SELECT r.ind_utilisateur FROM materiel mt JOIN service sv ON sv.srv_id = mt.mat_srv_id JOIN individu r ON r.ind_id = sv.srv_responsable_id
                           WHERE mt.mat_id = d.hab_id_element) END AS responsable
            FROM derniere d JOIN type_habilitation t ON t.tha_code = d.hab_tha_code
            WHERE (d.hab_type_element = 'salarie' AND EXISTS (SELECT 1 FROM salarie s WHERE s.sal_id = d.hab_id_element AND s.sal_actif))
               OR (d.hab_type_element = 'materiel' AND EXISTS (SELECT 1 FROM materiel m WHERE m.mat_id = d.hab_id_element AND m.mat_etat <> 'REBUT'))
            """).ToListAsync(ct);
        var aujourdhui = DateOnly.FromDateTime(maintenant.LocalDateTime);
        var alertes = lignes.Select(l => (l.Responsable, Etat: ReglesRessources.Etat(new HabilitationEvaluee(l.Code, l.ObtenueLe, l.ValideJusquAu), l.DureeMois, aujourdhui, 30).Etat))
            .Where(x => x.Etat is "EXPIREE" or "A_RENOUVELER").ToList();
        if (alertes.Count == 0) return [];
        var admins = await db.Database.SqlQueryRaw<string>("SELECT cpt_code AS \"Value\" FROM compte WHERE cpt_type = 'PERSONNE' AND cpt_actif AND cpt_profil = 'ADMIN'").ToListAsync(ct);
        var parDestinataire = alertes.SelectMany(a => a.Responsable is { } r ? [(Dest: r, a.Etat)] : admins.Select(x => (Dest: x, a.Etat)))
            .GroupBy(x => x.Dest.ToLowerInvariant());
        return parDestinataire.Select(g =>
        {
            var expirees = g.Count(x => x.Etat == "EXPIREE");
            var aRenouveler = g.Count() - expirees;
            return new NouvelleNotification(g.First().Dest, "ressources", "HABILITATION",
                $"Habilitations : {expirees} expirée(s), {aRenouveler} à renouveler dans les 30 jours",
                "CACES, visites médicales, contrôles des matériels…", expirees > 0 ? "ATTENTION" : "INFO", "/ressources/habilitations?jours=30",
                null, null, $"habilitations:{aujourdhui:yyyy-MM-dd}");
        }).ToList();
    }
}

/// <summary>
/// Étapes des ordres (module Exécution, E45 ; toutes les heures, module actif) : étape en retard (date prévue dépassée
/// sans validation) à la ressource principale (salarié), sinon au responsable de l'ordre, sinon au responsable du service ;
/// contrôle du N+1 attendu depuis plus de deux jours au responsable du service porteur (ou de son parent).
/// </summary>
public sealed class SourceEtapesExecution(LogiBtpContext db) : ISourceNotifications
{
    public string Code => "execution-etapes";
    public TimeSpan Periode => TimeSpan.FromHours(1);
    public IReadOnlyList<TypeNotification> Types { get; } =
        [new("execution", "ETAPE_RETARD", "Étapes d'ordres en retard"), new("execution", "ETAPE_CONTROLE", "Contrôles du N+1 en attente")];

    private sealed record Ligne(long OreId, long EntId, string? Numero, string Libelle, DateOnly? PrevuLe, DateOnly? ValideLe, string Genre, string? Destinataire);

    public async Task<IEnumerable<NouvelleNotification>> ProduireAsync(IServiceProvider portee, DateTimeOffset maintenant, CancellationToken ct)
    {
        var aujourdhui = DateOnly.FromDateTime(maintenant.LocalDateTime);
        var lignes = await db.Database.SqlQueryRaw<Ligne>("""
            WITH ordres AS (
                SELECT d.ent_id, d.ent_numero, d.ent_srv_id, d.ent_responsable_id, d.ent_ressource
                FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
                WHERE t.tyd_famille = 'E' AND f_module_actif('execution') AND d.ent_is_reference AND s.std_code NOT IN ('ANNULE', 'REMPLACE', 'SOLDE')
                  AND coalesce(d.ent_exe_etat, '') <> 'TERMINE'),
            responsable AS (
                SELECT s.srv_id, (SELECT i.ind_utilisateur FROM individu i WHERE i.ind_id = coalesce(s.srv_responsable_id, p.srv_responsable_id)) AS code
                FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id)
            SELECT e.ore_id, o.ent_id, o.ent_numero AS numero, e.ore_libelle AS libelle, e.ore_prevu_le AS prevu_le, e.ore_valide_le AS valide_le, 'RETARD' AS genre,
                   coalesce((SELECT i.ind_utilisateur FROM salarie sa JOIN individu i ON i.ind_id = sa.sal_ind_id
                              WHERE coalesce(e.ore_ressource, o.ent_ressource) ->> 'type' = 'SALARIE' AND sa.sal_id::text = coalesce(e.ore_ressource, o.ent_ressource) ->> 'id'),
                            (SELECT i.ind_utilisateur FROM individu i WHERE i.ind_id = o.ent_responsable_id),
                            (SELECT r.code FROM responsable r WHERE r.srv_id = o.ent_srv_id)) AS destinataire
            FROM exe_ordre_etape e JOIN ordres o ON o.ent_id = e.ore_ordre_id
            WHERE e.ore_valide_le IS NULL AND e.ore_prevu_le < @j
            UNION ALL
            SELECT e.ore_id, o.ent_id, o.ent_numero, e.ore_libelle, e.ore_prevu_le, e.ore_valide_le, 'CONTROLE',
                   (SELECT r.code FROM responsable r WHERE r.srv_id = o.ent_srv_id)
            FROM exe_ordre_etape e JOIN ordres o ON o.ent_id = e.ore_ordre_id
            WHERE e.ore_controle AND e.ore_valide_le IS NOT NULL AND e.ore_controle_le IS NULL AND e.ore_valide_le <= @j - 2
            """, new Npgsql.NpgsqlParameter("j", aujourdhui)).ToListAsync(ct);
        if (lignes.Count == 0) return [];
        var admins = await db.Database.SqlQueryRaw<string>("SELECT cpt_code AS \"Value\" FROM compte WHERE cpt_type = 'PERSONNE' AND cpt_actif AND cpt_profil = 'ADMIN'").ToListAsync(ct);
        return lignes.SelectMany(l => (l.Destinataire is { } d ? [d] : admins).Select(dest => l.Genre == "RETARD"
            ? new NouvelleNotification(dest, "execution", "ETAPE_RETARD", $"Ordre {l.Numero ?? l.EntId.ToString()} : « {l.Libelle} » en retard",
                $"Prévue le {l.PrevuLe:dd/MM/yyyy}, pas encore validée", "ATTENTION", $"/document/{l.EntId}", null, null, $"exe-retard:{l.OreId}:{l.PrevuLe:yyyy-MM-dd}")
            : new NouvelleNotification(dest, "execution", "ETAPE_CONTROLE", $"Ordre {l.Numero ?? l.EntId.ToString()} : contrôle de « {l.Libelle} » attendu",
                $"Étape validée le {l.ValideLe:dd/MM/yyyy}", "INFO", $"/document/{l.EntId}", null, null, $"exe-controle:{l.OreId}"))).ToList();
    }
}

/// <summary>
/// Pièces des sous-traitants (module Sous-traitance, § 5.3 ; une fois par jour, module actif) : pour chaque marché de
/// sous-traitance en cours, pièces à échéance ou en défaut (manquantes, expirées) ; une synthèse par jour aux membres du
/// service des achats (code ACHAT), sinon aux administrateurs.
/// </summary>
public sealed class SourcePiecesSousTraitance(LogiBtpContext db) : ISourceNotifications
{
    public string Code => "sous-traitance-pieces";
    public TimeSpan Periode => TimeSpan.FromHours(6);
    public IReadOnlyList<TypeNotification> Types { get; } = [new("sous_traitance", "PIECES", "Pièces des sous-traitants à fournir ou à renouveler")];

    public async Task<IEnumerable<NouvelleNotification>> ProduireAsync(IServiceProvider portee, DateTimeOffset maintenant, CancellationToken ct)
    {
        if (!await portee.GetRequiredService<ModulesSociete>().EstActifAsync("sous_traitance", ct)) return [];
        var marches = await db.Database.SqlQueryRaw<int>("SELECT mar_id AS \"Value\" FROM marche WHERE mar_sens = 'ST' AND mar_statut = 'EN_COURS'").ToListAsync(ct);
        if (marches.Count == 0) return [];
        var service = portee.GetRequiredService<LogiBTP.SousTraitance.Web.ServiceSousTraitance>();
        int defaut = 0, echeance = 0, concernes = 0;
        foreach (var m in marches)
        {
            var c = await service.ConformiteMarcheAsync(m, ct);
            var d = c.Pieces.Count(p => p.Etat is "MANQUANTE" or "EXPIREE" && p.Obligatoire);
            if (d + c.AEcheance.Count > 0) concernes++;
            (defaut, echeance) = (defaut + d, echeance + c.AEcheance.Count);
        }
        if (concernes == 0) return [];
        var destinataires = await db.Database.SqlQueryRaw<string>("""
            SELECT DISTINCT i.ind_utilisateur AS "Value" FROM service s JOIN service_membre m ON m.sme_srv_id = s.srv_id JOIN individu i ON i.ind_id = m.sme_ind_id
            WHERE s.srv_code = 'ACHAT' AND i.ind_utilisateur IS NOT NULL
            """).ToListAsync(ct);
        if (destinataires.Count == 0)
        {
            destinataires = await db.Database.SqlQueryRaw<string>("SELECT cpt_code AS \"Value\" FROM compte WHERE cpt_type = 'PERSONNE' AND cpt_actif AND cpt_profil = 'ADMIN'").ToListAsync(ct);
        }
        var jour = DateOnly.FromDateTime(maintenant.LocalDateTime);
        return destinataires.Select(dest => new NouvelleNotification(dest, "sous_traitance", "PIECES",
            $"Sous-traitance : {defaut} pièce(s) manquante(s) ou expirée(s), {echeance} à renouveler",
            $"{concernes} marché(s) de sous-traitance concerné(s)", defaut > 0 ? "ATTENTION" : "INFO", "/liste/marches_st?vue=1203", null, null,
            $"st-pieces:{jour:yyyy-MM-dd}")).ToList();
    }
}

/// <summary>
/// Demandes de paiement direct ou de délégation à accepter (ST16) : toutes les heures, une notification par demande non
/// traitée à trois jours de son échéance (réception + 15 jours) ou en retard, au conducteur de travaux du chantier du
/// marché (son compte), sinon aux membres du service Chantier, sinon Achat, sinon aux administrateurs ; clé par demande et
/// par jour.
/// </summary>
public sealed class SourcePaiementsDirects(LogiBtpContext db) : ISourceNotifications
{
    public string Code => "sous-traitance-paiements";
    public TimeSpan Periode => TimeSpan.FromHours(1);
    public IReadOnlyList<TypeNotification> Types { get; } = [new("sous_traitance", "PAIEMENT", "Demandes de paiement des sous-traitants à accepter")];

    private sealed record Demande(long Id, int MarcheId, string? Marche, string? Tiers, string? Facture, string? Conducteur);

    public async Task<IEnumerable<NouvelleNotification>> ProduireAsync(IServiceProvider portee, DateTimeOffset maintenant, CancellationToken ct)
    {
        if (!await portee.GetRequiredService<ModulesSociete>().EstActifAsync("sous_traitance", ct)) return [];
        var demandes = await portee.GetRequiredService<LogiBTP.SousTraitance.Web.ServicePaiementDirect>().AEcheanceAsync(ct);
        if (demandes.Count == 0) return [];
        var infos = (await db.Database.SqlQueryRaw<Demande>("""
            SELECT p.spd_id AS id, p.spd_marche_id AS marche_id, m.mar_code AS marche, t.per_raison_sociale AS tiers, coalesce(d.ent_reference_externe, d.ent_numero) AS facture,
                   i.ind_utilisateur AS conducteur
            FROM stt_paiement_direct p JOIN marche m ON m.mar_id = p.spd_marche_id JOIN document d ON d.ent_id = p.spd_facture_id
            LEFT JOIN personne t ON t.per_id = d.ent_tiers_id LEFT JOIN chantier c ON c.cha_id = m.mar_cha_id
            LEFT JOIN individu i ON i.ind_id = c.cha_conducteur_ind_id
            WHERE p.spd_etat = 'RECUE'
            """).ToListAsync(ct)).ToDictionary(x => x.Id);
        var destinataires = await db.Database.SqlQueryRaw<string>("""
            SELECT DISTINCT i.ind_utilisateur AS "Value" FROM service s JOIN service_membre m ON m.sme_srv_id = s.srv_id JOIN individu i ON i.ind_id = m.sme_ind_id
            WHERE s.srv_code = (SELECT srv_code FROM service WHERE srv_code IN ('CHANTIER', 'ACHAT') AND EXISTS (SELECT 1 FROM service_membre x WHERE x.sme_srv_id = srv_id)
                                ORDER BY srv_code = 'CHANTIER' DESC LIMIT 1)
              AND i.ind_utilisateur IS NOT NULL
            """).ToListAsync(ct);
        if (destinataires.Count == 0)
        {
            destinataires = await db.Database.SqlQueryRaw<string>("SELECT cpt_code AS \"Value\" FROM compte WHERE cpt_type = 'PERSONNE' AND cpt_actif AND cpt_profil = 'ADMIN'").ToListAsync(ct);
        }
        var jour = DateOnly.FromDateTime(maintenant.LocalDateTime);
        return (from d in demandes
                where infos.ContainsKey(d.Id)
                let i = infos[d.Id]
                from dest in i.Conducteur is { } cond ? [cond] : destinataires
                select new NouvelleNotification(dest, "sous_traitance", "PAIEMENT",
                    d.Delai.Depasse ? $"Demande de paiement en retard : {i.Tiers}" : $"Demande de paiement à accepter avant le {d.Delai.Echeance:dd/MM/yyyy} : {i.Tiers}",
                    $"Facture {i.Facture}, marché {i.Marche}", d.Delai.Depasse ? "ATTENTION" : "INFO", $"/fiche/marche/{i.MarcheId}", null, null,
                    $"st-paiement:{d.Id}:{jour:yyyy-MM-dd}")).ToList();
    }
}

/// <summary>
/// Module Stock, lot 5 (S17, S18, S27) : toutes les heures, saisies de stock de la borne à valider (une notification par
/// pièce aux magasiniers — membres d'un service LOGISTIQUE — et au responsable du service du salarié, sinon aux
/// administrateurs) ; une fois par jour, EPI et outillage dotés à renouveler dans les 30 jours (synthèse par salarié au
/// responsable de son service, sinon aux administrateurs).
/// </summary>
public sealed class SourceStockBtp(LogiBtpContext db) : ISourceNotifications
{
    public string Code => "stock";
    public TimeSpan Periode => TimeSpan.FromHours(1);
    public IReadOnlyList<TypeNotification> Types { get; } =
        [new("stock", "A_VALIDER", "Sorties et retours saisis à la borne, à valider"), new("stock", "RENOUVELER", "EPI et outillage dotés à renouveler")];

    private sealed record SaisieSql(long EntId, string? Numero, string? Nom, int? Salarie);
    private sealed record SalarieSql(int Id, string Nom, int? Service);

    private Task<List<string>> ChefsAsync(int salarie, CancellationToken ct) =>
        db.Database.SqlQuery<string>($"""
            SELECT DISTINCT i.ind_utilisateur AS "Value" FROM salarie s JOIN service_membre m ON m.sme_ind_id = s.sal_ind_id AND m.sme_principal
            JOIN service v ON v.srv_id = m.sme_srv_id LEFT JOIN service p ON p.srv_id = v.srv_parent_id
            JOIN individu i ON i.ind_id IN (v.srv_responsable_id, p.srv_responsable_id)
            WHERE s.sal_id = {salarie} AND i.ind_utilisateur IS NOT NULL
            """).ToListAsync(ct);

    private Task<List<string>> AdministrateursAsync(CancellationToken ct) =>
        db.Database.SqlQueryRaw<string>("SELECT cpt_code AS \"Value\" FROM compte WHERE cpt_type = 'PERSONNE' AND cpt_actif AND cpt_profil = 'ADMIN'").ToListAsync(ct);

    public async Task<IEnumerable<NouvelleNotification>> ProduireAsync(IServiceProvider portee, DateTimeOffset maintenant, CancellationToken ct)
    {
        if (!await portee.GetRequiredService<ModulesSociete>().EstActifAsync("stock", ct)) return [];
        var r = new List<NouvelleNotification>();
        var magasiniers = await db.Database.SqlQueryRaw<string>("""
            SELECT DISTINCT i.ind_utilisateur AS "Value" FROM service s JOIN service_membre m ON m.sme_srv_id = s.srv_id JOIN individu i ON i.ind_id = m.sme_ind_id
            WHERE s.srv_nature = 'LOGISTIQUE' AND i.ind_utilisateur IS NOT NULL
            """).ToListAsync(ct);
        var saisies = await db.Database.SqlQueryRaw<SaisieSql>("""
            SELECT d.ent_id, d.ent_numero AS numero, s.sal_prenom || ' ' || s.sal_nom AS nom, d.ent_stk_salarie_id AS salarie
            FROM document d LEFT JOIN salarie s ON s.sal_id = d.ent_stk_salarie_id WHERE d.ent_stk_a_valider
            """).ToListAsync(ct);
        foreach (var x in saisies)
        {
            var dest = magasiniers.Union(x.Salarie is { } sa ? await ChefsAsync(sa, ct) : []).Distinct().ToList();
            if (dest.Count == 0) dest = await AdministrateursAsync(ct);
            r.AddRange(dest.Select(d => new NouvelleNotification(d, "stock", "A_VALIDER", $"Stock : saisie à la borne à valider ({x.Numero})",
                $"{x.Nom ?? "Salarié"} : sortie ou retour comptés dans le stock, à accepter ou refuser", "INFO", "/stock/a-valider", null, null, $"stock-a-valider:{x.EntId}")));
        }
        // Renouvellements : une fois par jour (clé datée), articles dont la date de renouvellement tombe dans les 30 jours.
        var jour = DateOnly.FromDateTime(maintenant.LocalDateTime);
        var aRenouveler = (await MagasinBtp.RenouvellementsAsync(db, null, ct)).Where(x => x.Renouveler is { } d && d <= jour.AddDays(30)).ToList();
        foreach (var g in aRenouveler.GroupBy(x => x.Salarie))
        {
            var nom = (await db.Database.SqlQuery<string>($"SELECT sal_prenom || ' ' || sal_nom AS \"Value\" FROM salarie WHERE sal_id = {g.Key}").ToListAsync(ct)).FirstOrDefault() ?? "Salarié";
            var dest = await ChefsAsync(g.Key, ct);
            if (dest.Count == 0) dest = await AdministrateursAsync(ct);
            var echus = g.Count(x => x.Renouveler <= jour);
            r.AddRange(dest.Select(d => new NouvelleNotification(d, "stock", "RENOUVELER", $"Dotations : {g.Count()} article(s) à renouveler pour {nom}",
                echus > 0 ? $"{echus} déjà échu(s)" : "Dans les 30 jours", echus > 0 ? "ATTENTION" : "INFO", $"/fiche/salarie/{g.Key}", null, null,
                $"stock-renouveler:{g.Key}:{jour:yyyy-MM-dd}")));
        }
        return r;
    }
}

/// <summary>
/// Certificat de l'installation (module Installation, § 5.3 ; toutes les 6 h) : 30 jours avant son échéance, puis chaque
/// jour, notification aux comptes ADMIN de chaque base ; le renouvellement automatique (tâche planifiée) a lieu 60 jours
/// avant pour l'autorité LogiBTP : un rappel signale qu'il a échoué, ou qu'un certificat importé est à renouveler.
/// </summary>
public sealed class SourceCertificat(LogiBtpContext db, LogiBTP.Installation.Web.CertificatServeur certificat) : ISourceNotifications
{
    public string Code => "installation-certificat";
    public TimeSpan Periode => TimeSpan.FromHours(6);
    public IReadOnlyList<TypeNotification> Types { get; } = [new("installation", "CERTIFICAT", "Certificat HTTPS à renouveler")];

    public async Task<IEnumerable<NouvelleNotification>> ProduireAsync(IServiceProvider portee, DateTimeOffset maintenant, CancellationToken ct)
    {
        if (certificat.Fin is not { } fin) return [];
        var jours = (int)Math.Floor((fin - maintenant).TotalDays);
        if (jours > 30) return [];
        var admins = await db.Database.SqlQueryRaw<string>("SELECT cpt_code AS \"Value\" FROM compte WHERE cpt_type = 'PERSONNE' AND cpt_actif AND cpt_profil = 'ADMIN'").ToListAsync(ct);
        var infos = certificat.Dossier.Infos();
        var titre = jours < 0 ? $"Certificat HTTPS expiré depuis le {fin:dd/MM/yyyy}" : $"Certificat HTTPS à renouveler : échéance le {fin:dd/MM/yyyy} ({jours} jour(s))";
        var texte = infos?.Origine switch
        {
            LogiBTP.Installation.OrigineCertificat.LogiBtp => "Le renouvellement automatique a échoué : lancer « installation certificat renouveler » sur le serveur.",
            LogiBTP.Installation.OrigineCertificat.LetsEncrypt => "Le renouvellement Let's Encrypt a échoué : lancer Certificat-LetsEncrypt.ps1 -Renouveler sur le serveur (identifiants DNS, accès internet).",
            _ => $"Certificat émis par {infos?.Emetteur} : le renouveler auprès de son émetteur puis « installation certificat importer ».",
        };
        var aujourdhui = DateOnly.FromDateTime(maintenant.LocalDateTime);
        return admins.Select(a => new NouvelleNotification(a, "installation", "CERTIFICAT", titre, texte, jours < 7 ? "URGENT" : "ATTENTION",
            "/parametres/installation", null, null, $"certificat:{aujourdhui:yyyy-MM-dd}"));
    }
}
