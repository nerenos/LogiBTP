using System.Globalization;
using LogiBTP.Domaine;
using LogiBTP.Domaine.Ressources;
using LogiBTP.Fiches;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Synthèse des fiches du cœur (analyse d'ergonomie du 31/10/2026, F1 et F2) : indicateurs du bandeau et compteurs des
/// onglets, lus en une fois par <c>GET /api/fiches/{type}/{id}/synthese</c>. Salarié : contrat, heures du mois et de la
/// semaine (pointages retenus), congés en attente, habilitations, matériel affecté, compte ; matériel : affecté à,
/// compteurs, prochain entretien, contrôles, coût du mois ; marché et chantier : montant, facturé, reste.
/// </summary>
public static class SynthesesFiches
{
    // Le serveur tourne sans globalisation : format français construit à la main (espace fine insécable, virgule).
    private static readonly NumberFormatInfo Fr = new() { NumberGroupSeparator = "\u202f", NumberDecimalSeparator = ",", PercentGroupSeparator = "\u202f",
        PercentDecimalSeparator = ",", PercentPositivePattern = 0, PercentNegativePattern = 0 };

    private sealed record HabilitationSql(string Code, DateOnly? ObtenueLe, DateOnly? ValideJusquAu, int? DureeMois);
    private sealed record SalarieSql(string? Statut, int MinutesMois, int MinutesSemaine, int CongesAttente, int Materiels, int Missions,
        bool? CompteActif, int Pieces);
    private sealed record MaterielSql(string Mode, string? Affecte, int Heures, int? Kilometres, string Compteurs, decimal? CoutMois,
        int Affectations, int Evenements, int Etats, int Pieces);
    private sealed record MarcheSql(decimal? Montant, decimal? Facture, decimal? Reste, int Avenants, int Pieces);
    private sealed record ChantierSql(decimal? Montant, decimal? Facture, int Marches, int Pieces);

    private static string Heures(int minutes) => minutes % 60 == 0 ? $"{minutes / 60} h" : $"{minutes / 60} h {minutes % 60:00}";
    private static string Euros(decimal? v) => v is null ? "—" : v.Value.ToString("#,##0 €", Fr);
    private static string Nombre(decimal v) => v.ToString("#,##0", Fr);

    /// <summary>Pièces jointes (GED) non supprimées d'une fiche.</summary>
    private const string SqlPieces = "(SELECT count(*) FROM document_ged g WHERE g.dge_type_element = @t AND g.dge_id_element = @i::text AND NOT g.dge_supprime)::int";

    public static async Task<SyntheseFiche?> CalculerAsync(LogiBtpContext db, string type, string id, CancellationToken ct)
    {
        if (!int.TryParse(id, NumberStyles.None, CultureInfo.InvariantCulture, out var n)) return null;
        return type switch
        {
            TypesFiche.Salarie => await SalarieAsync(db, n, ct),
            TypesFiche.Materiel => await MaterielAsync(db, n, ct),
            TypesFiche.Marche => await MarcheAsync(db, n, ct),
            TypesFiche.Chantier => await ChantierAsync(db, n, ct),
            _ => null,
        };
    }

    /// <summary>Habilitations (dernière par type) d'un salarié ou d'un matériel : à jour, à renouveler, expirées.</summary>
    private static async Task<(int Total, int Alertes, int Expirees)> HabilitationsAsync(LogiBtpContext db, string element, int id, CancellationToken ct)
    {
        var l = await db.Database.SqlQueryRaw<HabilitationSql>("""
            SELECT DISTINCT ON (h.hab_tha_code) h.hab_tha_code AS code, h.hab_obtenue_le AS obtenue_le, h.hab_valide_jusqu_au AS valide_jusqu_au, t.tha_duree_mois AS duree_mois
            FROM habilitation h JOIN type_habilitation t ON t.tha_code = h.hab_tha_code
            WHERE h.hab_type_element = @e AND h.hab_id_element = @i
            ORDER BY h.hab_tha_code, h.hab_obtenue_le DESC NULLS LAST, h.hab_id DESC
            """, new NpgsqlParameter("e", element), new NpgsqlParameter("i", id)).ToListAsync(ct);
        var aujourdhui = DateOnly.FromDateTime(DateTime.Today);
        var etats = l.Select(h => ReglesRessources.Etat(new HabilitationEvaluee(h.Code, h.ObtenueLe, h.ValideJusquAu), h.DureeMois, aujourdhui).Etat).ToList();
        return (l.Count, etats.Count(e => e is "EXPIREE" or "A_RENOUVELER"), etats.Count(e => e == "EXPIREE"));
    }

    private static async Task<SyntheseFiche?> SalarieAsync(LogiBtpContext db, int id, CancellationToken ct)
    {
        var s = (await db.Database.SqlQueryRaw<SalarieSql>($"""
            SELECT s.sal_statut AS statut,
                   coalesce((SELECT sum(p.minutes) FROM v_pointages_retenus p WHERE p.sal_id = s.sal_id AND p.date_pointage >= date_trunc('month', current_date)
                             AND p.date_pointage <= current_date), 0)::int AS minutes_mois,
                   coalesce((SELECT sum(p.minutes) FROM v_pointages_retenus p WHERE p.sal_id = s.sal_id AND p.date_pointage >= date_trunc('week', current_date)
                             AND p.date_pointage <= current_date), 0)::int AS minutes_semaine,
                   (SELECT count(*) FROM poi_conge c WHERE c.pco_sal_id = s.sal_id AND c.pco_etat = 'DEMANDE')::int AS conges_attente,
                   (SELECT count(*) FROM materiel_affectation a WHERE a.maf_type IN ('SALARIE', 'INTERIM') AND a.maf_ressource = s.sal_id::text
                      AND a.maf_du <= current_date AND (a.maf_au IS NULL OR a.maf_au >= current_date))::int AS materiels,
                   (SELECT count(*) FROM mission_interim m WHERE m.mis_sal_id = s.sal_id)::int AS missions,
                   (SELECT c.cpt_actif FROM compte c WHERE c.cpt_type_element = 'individu' AND c.cpt_id_element = s.sal_ind_id::text LIMIT 1) AS compte_actif,
                   {SqlPieces} AS pieces
            FROM salarie s WHERE s.sal_id = @i
            """, new NpgsqlParameter("i", id), new NpgsqlParameter("t", TypesFiche.Salarie)).ToListAsync(ct)).FirstOrDefault();
        if (s is null) return null;
        var (habilitations, alertes, expirees) = await HabilitationsAsync(db, "salarie", id, ct);
        var indicateurs = new List<IndicateurFiche>
        {
            new("heures_mois", "Heures du mois", Heures(s.MinutesMois)),
            new("heures_semaine", "Heures de la semaine", Heures(s.MinutesSemaine)),
        };
        if (s.CongesAttente > 0) indicateurs.Add(new("conges", "Congés en attente", s.CongesAttente.ToString(Fr), "attention", "/pointage/conges"));
        indicateurs.Add(new("habilitations", "Habilitations", alertes == 0 ? (habilitations == 0 ? "aucune" : "à jour") : $"{alertes} à revoir",
            expirees > 0 ? "erreur" : alertes > 0 ? "attention" : habilitations > 0 ? "ok" : null));
        if (s.Materiels > 0) indicateurs.Add(new("materiel", "Matériel affecté", s.Materiels.ToString(Fr)));
        indicateurs.Add(new("compte", "Compte de connexion", s.CompteActif switch { true => "actif", false => "désactivé", null => "aucun" },
            s.CompteActif == false ? "attention" : null));
        return new SyntheseFiche(indicateurs, new Dictionary<string, CompteOnglet>
        {
            ["habilitations"] = new(habilitations, alertes > 0),
            ["missions"] = new(s.Missions),
            ["materiel-affecte"] = new(s.Materiels),
            ["pieces"] = new(s.Pieces),
        });
    }

    private static async Task<SyntheseFiche?> MaterielAsync(LogiBtpContext db, int id, CancellationToken ct)
    {
        var m = (await db.Database.SqlQueryRaw<MaterielSql>($"""
            SELECT m.mat_mode AS mode, m.mat_heures AS heures, m.mat_kilometres AS kilometres, m.mat_compteurs AS compteurs,
                   (SELECT r.libelle FROM materiel_affectation a JOIN v_ressource r ON r.id = a.maf_ressource
                      AND (r.type = a.maf_type OR r.type IN ('SALARIE', 'INTERIM') AND a.maf_type IN ('SALARIE', 'INTERIM'))
                    WHERE a.maf_mat_id = m.mat_id AND a.maf_du <= current_date AND (a.maf_au IS NULL OR a.maf_au >= current_date) LIMIT 1) AS affecte,
                   (SELECT sum(c.montant) FROM v_cout_chantier c WHERE c.chantier_id = m.mat_cha_id AND c.mois = date_trunc('month', current_date)::date) AS cout_mois,
                   (SELECT count(*) FROM materiel_affectation a WHERE a.maf_mat_id = m.mat_id)::int AS affectations,
                   (SELECT count(*) FROM materiel_evenement e WHERE e.mev_mat_id = m.mat_id)::int AS evenements,
                   (SELECT count(*) FROM materiel_etat e WHERE e.met_mat_id = m.mat_id)::int AS etats,
                   {SqlPieces} AS pieces
            FROM materiel m WHERE m.mat_id = @i
            """, new NpgsqlParameter("i", id), new NpgsqlParameter("t", TypesFiche.Materiel)).ToListAsync(ct)).FirstOrDefault();
        if (m is null) return null;
        var (controles, alertes, expirees) = await HabilitationsAsync(db, "materiel", id, ct);
        var echeances = await PlansEntretien.CalculerAsync(db, id, DateOnly.FromDateTime(DateTime.Today), ct);
        var indicateurs = new List<IndicateurFiche> { new("affecte", "Affecté à", m.Affecte ?? "—") };
        var unites = ReglesCompteurs.UnitesCompteurs(m.Compteurs);
        var compteurs = new[] { unites.Contains("H") ? $"{Nombre(m.Heures)} h" : null, unites.Contains("KM") && m.Kilometres is { } km ? $"{Nombre(km)} km" : null }
            .Where(x => x is not null).ToList();
        if (compteurs.Count > 0) indicateurs.Add(new("compteurs", "Compteurs", string.Join(" · ", compteurs)));
        if (echeances.Count > 0)
        {
            var retard = echeances.Count(e => e.Echeance.Etat == "EN_RETARD");
            var prochaine = echeances.Where(e => e.Echeance.Date is not null).OrderBy(e => e.Echeance.Date).FirstOrDefault();
            indicateurs.Add(new("entretien", "Entretien", retard > 0 ? $"{retard} en retard"
                : prochaine is null ? "à jour" : $"{prochaine.Libelle ?? prochaine.Code} le {prochaine.Echeance.Date:dd/MM/yyyy}",
                retard > 0 ? "erreur" : echeances.Any(e => e.Echeance.Etat == "A_PREVOIR") ? "attention" : "ok"));
        }
        if (controles > 0)
            indicateurs.Add(new("controles", "Contrôles", alertes == 0 ? "à jour" : $"{alertes} à revoir", expirees > 0 ? "erreur" : alertes > 0 ? "attention" : "ok"));
        if (m.CoutMois is { } cout) indicateurs.Add(new("cout_mois", "Coût du mois", Euros(cout)));
        return new SyntheseFiche(indicateurs, new Dictionary<string, CompteOnglet>
        {
            ["habilitations"] = new(controles, alertes > 0),
            ["affectations"] = new(m.Affectations),
            ["compteurs"] = new(m.Evenements, echeances.Any(e => e.Echeance.Etat == "EN_RETARD")),
            ["historique"] = new(m.Etats),
            ["pieces"] = new(m.Pieces),
        });
    }

    private static async Task<SyntheseFiche?> MarcheAsync(LogiBtpContext db, int id, CancellationToken ct)
    {
        var m = (await db.Database.SqlQueryRaw<MarcheSql>($"""
            SELECT v.montant_ht AS montant, v.facture_ht AS facture, v.reste_a_facturer AS reste, coalesce(v.nb_avenants, 0)::int AS avenants, {SqlPieces} AS pieces
            FROM v_liste_marches v WHERE v.id = @i
            """, new NpgsqlParameter("i", id), new NpgsqlParameter("t", TypesFiche.Marche)).ToListAsync(ct)).FirstOrDefault();
        if (m is null) return null;
        var avancement = m.Montant is > 0 && m.Facture is { } f ? $" ({Math.Round(f / m.Montant.Value * 100, MidpointRounding.AwayFromZero).ToString("0", Fr)} %)" : "";
        return new SyntheseFiche(
        [
            new("montant", "Montant HT", Euros(m.Montant)),
            new("facture", "Facturé HT", Euros(m.Facture) + avancement),
            new("reste", "Reste à facturer", Euros(m.Reste), m.Reste is < 0 ? "erreur" : null),
            new("avenants", "Avenants", m.Avenants.ToString(Fr)),
        ], new Dictionary<string, CompteOnglet> { ["pieces"] = new(m.Pieces) });
    }

    private static async Task<SyntheseFiche?> ChantierAsync(LogiBtpContext db, int id, CancellationToken ct)
    {
        var c = (await db.Database.SqlQueryRaw<ChantierSql>($"""
            SELECT v.montant_marches AS montant, v.facture_ht AS facture, coalesce(v.nb_marches, 0)::int AS marches, {SqlPieces} AS pieces
            FROM v_liste_chantiers v WHERE v.id = @i
            """, new NpgsqlParameter("i", id), new NpgsqlParameter("t", TypesFiche.Chantier)).ToListAsync(ct)).FirstOrDefault();
        if (c is null) return null;
        return new SyntheseFiche(
        [
            new("marches", "Marchés", c.Marches.ToString(Fr)),
            new("montant", "Montant des marchés HT", Euros(c.Montant)),
            new("facture", "Facturé HT", Euros(c.Facture)),
            new("reste", "Reste à facturer", Euros(c.Montant is null ? null : c.Montant - (c.Facture ?? 0))),
        ], new Dictionary<string, CompteOnglet> { ["pieces"] = new(c.Pieces) });
    }
}
