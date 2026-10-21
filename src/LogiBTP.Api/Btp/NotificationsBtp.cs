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
