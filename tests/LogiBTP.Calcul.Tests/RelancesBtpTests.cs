using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Reglements.Web;
using LogiBTP.Relances;
using LogiBTP.Relances.Web;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Pièces en attente du module Relances (plans/relances.md, lot 4) : devis envoyés seulement s'ils sont valables, non
/// expirés, non transformés ; factures à reste échu (module Règlements ou échéances du document tant que le statut
/// n'est pas PAYE) ; tiers payeur ; chargé de l'affaire, sinon du client ; portée par chargé.
/// </summary>
public class RelancesBtpTests
{
    private static readonly DateOnly Jour = new(2026, 11, 8);

    private static SpecialisationRelanceBtp.LignePiece Facture(long id, decimal net = 1200m, List<SpecialisationRelanceBtp.EcheanceDocument>? echeances = null) =>
        new(id, RolesRelance.Facture, null, $"F{id}", Jour.AddDays(-60), Jour.AddDays(-60), 7, "Client", 3, "Chargé", net, echeances);

    private static EcheanceDto Ouverte(long id, long piece, DateOnly? date, decimal montant, decimal reste, string nature = "NORMALE", decimal exigible = 0) =>
        new(id, piece, $"F{piece}", "Facture", 7, "Client", "E", date, montant, nature, null, montant - reste, reste, reste == 0, Jour.AddDays(-60), 0, exigible);

    [Fact]
    public void Sans_reglements_les_echeances_du_document_sont_dues_en_entier()
    {
        var p = SpecialisationRelanceBtp.Construire([Facture(1, echeances: [new(11, Jour.AddDays(-30), 1000m, "NORMALE"), new(12, null, 200m, "RETENUE")])], null);
        var e = Assert.Single(p).Echeances!;
        Assert.Equal([new EcheanceRelance(11, Jour.AddDays(-30), 1000m), new EcheanceRelance(12, null, 200m, true)], e);
    }

    [Fact]
    public void Sans_reglements_ni_echeance_le_net_a_payer_est_du_a_la_date_de_la_piece()
    {
        var e = Assert.Single(SpecialisationRelanceBtp.Construire([Facture(2, 500m)], null)).Echeances!;
        Assert.Equal([new EcheanceRelance(-2, Jour.AddDays(-60), 500m)], e);
    }

    [Fact]
    public void Avec_reglements_le_reste_est_celui_du_module_et_une_facture_soldee_sort()
    {
        var ouvertes = new Dictionary<long, List<EcheanceDto>> { [1] = [Ouverte(11, 1, Jour.AddDays(-30), 1000m, 400m)] };
        var p = SpecialisationRelanceBtp.Construire([Facture(1), Facture(2)], ouvertes);
        var f = Assert.Single(p);
        Assert.Equal(1, f.Id);
        Assert.Equal([new EcheanceRelance(11, Jour.AddDays(-30), 400m)], f.Echeances!);
    }

    [Fact]
    public void Retenue_cautionnee_exigible_a_la_date_de_la_piece_le_reste_a_la_liberation()
    {
        var ouvertes = new Dictionary<long, List<EcheanceDto>> { [1] = [Ouverte(12, 1, Jour.AddDays(300), 200m, 200m, "RETENUE", 150m)] };
        var e = Assert.Single(SpecialisationRelanceBtp.Construire([Facture(1)], ouvertes)).Echeances!;
        Assert.Equal([new EcheanceRelance(12, Jour.AddDays(-60), 150m), new EcheanceRelance(12, Jour.AddDays(300), 50m, true)], e);
    }

    [Fact]
    public void Devis_depart_a_l_envoi_et_montant_ttc()
    {
        var l = new SpecialisationRelanceBtp.LignePiece(5, RolesRelance.Devis, 50, "D5", Jour.AddDays(-40), Jour.AddDays(-20), 7, "Client", null, null, 3600m, []);
        var p = Assert.Single(SpecialisationRelanceBtp.Construire([l], null));
        Assert.Equal((NatureRelance.Devis, Jour.AddDays(-20), 3600m, 50L), (p.Nature, p.Depart!.Value, p.Montant, p.GroupeId!.Value));
    }

    /// <summary>
    /// Base LOGIBTP_TEST_PG (db/283 chargé) : devis expiré, remplacé, annulé, transformé ou rejeté absents ; facture
    /// payée absente sans Règlements, relancée chez son payeur ; chargé de l'affaire, sinon du client ; portée SOI.
    /// Transaction annulée.
    /// </summary>
    [Fact]
    public async Task Pieces_en_attente_lues_dans_la_base()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        if (string.IsNullOrEmpty(connexion)) return;
        await using var c = new NpgsqlConnection(connexion);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        async Task<object?> Scalaire(string sql, params (string, object)[] p)
        {
            await using var k = new NpgsqlCommand(sql, c, tx);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            return await k.ExecuteScalarAsync();
        }
        async Task<long> Id(string sql, params (string, object)[] p) => Convert.ToInt64(await Scalaire(sql, p));
        async Task<int?> Statut(string type, string code) => await Scalaire("""
            SELECT s.std_id FROM statut_document s JOIN type_document t ON t.tyd_id = s.std_tyd_id WHERE t.tyd_code = @t AND s.std_code = @c ORDER BY s.std_id LIMIT 1
            """, ("t", type), ("c", code)) is int i ? i : null;

        var devis = await Id("SELECT tyd_id FROM type_document WHERE tyd_code = 'V_DEVIS'");
        var facture = await Id("SELECT tyd_id FROM type_document WHERE tyd_code = 'V_FACTURE'");
        var commande = await Id("SELECT tyd_id FROM type_document WHERE tyd_code = 'V_COMMANDE'");
        if (await Statut("V_DEVIS", "ENVOYE") is not int envoye || await Statut("V_DEVIS", "REMPLACE") is not int remplace
            || await Statut("V_DEVIS", "ANNULE") is not int annule || await Statut("V_FACTURE", "VALIDE") is not int valide
            || await Statut("V_FACTURE", "PAYE") is not int paye || await Statut("V_COMMANDE", "VALIDE") is not int cmdValide) return;

        var utilisateur = $"test.relance.{Guid.NewGuid():N}";
        var charge = await Id("INSERT INTO individu (ind_nom, ind_prenom, ind_utilisateur) VALUES ('Chargé', 'Test', @u) RETURNING ind_id", ("u", utilisateur));
        var autre = await Id("INSERT INTO individu (ind_nom) VALUES ('Autre') RETURNING ind_id");
        var client = await Id("INSERT INTO personne (per_niv_code, per_raison_sociale, per_cli_charge_ind_id) VALUES ('SOCIETE', 'Client relance', @i) RETURNING per_id", ("i", autre));
        var payeur = await Id("INSERT INTO personne (per_niv_code, per_raison_sociale) VALUES ('SOCIETE', 'Payeur relance') RETURNING per_id");
        var affaire = await Id("INSERT INTO affaire (aff_code, aff_libelle, aff_responsable_ind_id) VALUES (@c, 'Affaire relance', @i) RETURNING aff_id",
            ("c", $"AFR{Random.Shared.Next(100000, 999999)}"), ("i", charge));

        async Task<long> Piece(long type, int statut, string numero, bool verrouille = true, bool reference = true, DateOnly? validite = null,
            bool affaireOui = true, string? intervenants = null, bool rejete = false)
        {
            var id = await Id("""
                INSERT INTO document (ent_tyd_id, ent_std_id, ent_numero, ent_date, ent_cree_par, ent_verrouille, ent_is_reference, ent_tiers_id,
                  ent_date_validite, ent_affaire_id, ent_envoye_le, ent_total_ttc, ent_net_a_payer, ent_intervenants, ent_rejete_le)
                VALUES (@t, @s, @n, @d, 'test', @v, @r, @tiers, @val, @aff, @env, 1200, 1100, @int::jsonb, @rej) RETURNING ent_id
                """, ("t", type), ("s", statut), ("n", numero), ("d", Jour.AddDays(-50)), ("v", verrouille), ("r", reference), ("tiers", client),
                ("val", (object?)validite ?? DBNull.Value), ("aff", affaireOui ? affaire : DBNull.Value), ("env", new DateTime(2026, 9, 29, 10, 0, 0, DateTimeKind.Utc)),
                ("int", (object?)intervenants ?? DBNull.Value), ("rej", rejete ? DateTime.UtcNow : DBNull.Value));
            await Scalaire("UPDATE document SET ent_groupe_id = ent_id WHERE ent_id = @i", ("i", id));
            return id;
        }

        var dValable = await Piece(devis, envoye, "DR1", validite: Jour.AddDays(10));
        var dExpire = await Piece(devis, envoye, "DR2", validite: Jour.AddDays(-1));
        var dRemplace = await Piece(devis, remplace, "DR3");
        var dAnnule = await Piece(devis, annule, "DR4");
        var dTransforme = await Piece(devis, envoye, "DR5");
        var dRejete = await Piece(devis, envoye, "DR6", rejete: true);
        var dSansAffaire = await Piece(devis, envoye, "DR7", affaireOui: false);
        var dBrouillon = await Piece(devis, envoye, "DR8", verrouille: false);
        var cmd = await Piece(commande, cmdValide, "CR1");
        await Scalaire("INSERT INTO document_lien (lie_source_ent_id, lie_cible_ent_id, lie_type) VALUES (@s, @c, 'TRANSFORMATION')", ("s", dTransforme), ("c", cmd));
        var fPayeur = await Piece(facture, valide, "FR1", intervenants: $$"""[{"fonction":"PAYEUR","per_id":{{payeur}}}]""");
        await Scalaire("INSERT INTO document_echeance (ech_ent_id, ech_rang, ech_montant, ech_date) VALUES (@e, 1, 1100, @d)", ("e", fPayeur), ("d", Jour.AddDays(-20)));
        var fPayee = await Piece(facture, paye, "FR2");

        var options = new DbContextOptionsBuilder<RelanceDbContext>().UseNpgsql(c).Options;
        await using var db = new RelanceDbContext(options);
        await db.Database.UseTransactionAsync(tx);
        var ids = new[] { dValable, dExpire, dRemplace, dAnnule, dTransforme, dRejete, dSansAffaire, dBrouillon, fPayeur, fPayee };
        var pieces = await SpecialisationRelanceBtp.PiecesAsync(db, new FiltrePieces(Pieces: ids), Jour, null, default);

        Assert.Equal([dValable, dSansAffaire, fPayeur], pieces.Select(p => p.Id).Order());
        var v = pieces.Single(p => p.Id == dValable);
        Assert.Equal((client, charge, new DateOnly(2026, 9, 29), 1200m, dValable), (v.TiersId, v.ChargeId!.Value, v.Depart!.Value, v.Montant, v.GroupeId!.Value));
        Assert.Equal("Test Chargé", v.Charge);
        Assert.Equal(autre, pieces.Single(p => p.Id == dSansAffaire).ChargeId);
        var f = pieces.Single(p => p.Id == fPayeur);
        Assert.Equal((payeur, "Payeur relance"), (f.TiersId, f.Tiers));
        Assert.Equal(1100m, Assert.Single(f.Echeances!).Reste);

        // Filtre par tiers : celui relancé (le payeur de la facture).
        var duPayeur = await SpecialisationRelanceBtp.PiecesAsync(db, new FiltrePieces(payeur, ids), Jour, null, default);
        Assert.Equal([fPayeur], duPayeur.Select(p => p.Id));

        // Avec le module Règlements : facture payée gardée par le SQL, absente faute d'échéance ouverte.
        var avec = await SpecialisationRelanceBtp.PiecesAsync(db, new FiltrePieces(Pieces: ids), Jour,
            (p, _) => Task.FromResult(new List<EcheanceDto> { Ouverte(1, fPayeur, Jour.AddDays(-20), 1100m, 300m) }), default);
        Assert.Equal(300m, Assert.Single(avec.Single(p => p.Id == fPayeur).Echeances!).Reste);
        Assert.DoesNotContain(avec, p => p.Id == fPayee);

        // Portée : SOI = pièces dont on est le chargé ; TOUT ; refusée.
        var soi = await SpecialisationRelanceBtp.PorteeAsync(db, utilisateur, "SOI", default);
        Assert.True(soi.Couvre(charge) && !soi.Couvre(autre) && !soi.Couvre(null));
        Assert.True((await SpecialisationRelanceBtp.PorteeAsync(db, utilisateur, "TOUT", default)).Couvre(null));
        Assert.False((await SpecialisationRelanceBtp.PorteeAsync(db, utilisateur, null, default)).Couvre(charge));
        await tx.RollbackAsync();
    }

    /// <summary>Spécialisation du cœur à une date fixe (les devis expirent par rapport à elle).</summary>
    private sealed class SpecialisationAuJour(DateOnly jour) : SpecialisationRelance
    {
        public override Task<List<PieceEnAttente>> PiecesEnAttenteAsync(RelanceDbContext db, FiltrePieces filtre, CancellationToken ct) =>
            SpecialisationRelanceBtp.PiecesAsync(db, filtre, jour, null, ct);

        public override Task<Dictionary<long, SurchargeTiers>> RegleDuTiersAsync(RelanceDbContext db, IReadOnlyCollection<long> tiers, CancellationToken ct) =>
            SpecialisationRelanceBtp.SurchargesAsync(db, tiers, ct);
    }

    [Fact]
    public void Regle_propre_invalide_ou_absente_est_ignoree()
    {
        Assert.Null(SpecialisationRelanceBtp.LireRegle(null));
        Assert.Null(SpecialisationRelanceBtp.LireRegle("pas du json"));
        Assert.Null(SpecialisationRelanceBtp.LireRegle("""{"niveaux":[]}"""));
        Assert.Null(SpecialisationRelanceBtp.LireRegle("""{"niveaux":[{"rang":1,"delai":30,"mode":"INCONNU"}]}"""));
        var r = SpecialisationRelanceBtp.LireRegle("""{"niveaux":[{"rang":1,"delai":30,"mode":"COURRIER"},{"rang":2,"delai":45,"mode":"RECOMMANDE"}],"repeter":false,"intervalle":null}""");
        Assert.Equal([new NiveauRelance(1, 30, "COURRIER"), new NiveauRelance(2, 45, "RECOMMANDE")], r!.Niveaux);
    }

    /// <summary>
    /// Base LOGIBTP_TEST_PG (db/283 et db/284 chargés) : un tiers « ne pas relancer » sort de la liste de travail ; une
    /// règle propre change le niveau dû (40 jours depuis l'envoi : niveau 2 de la règle par défaut, niveau 1 d'une règle
    /// propre à 30 jours et mode préféré) ; un tiers sans surcharge garde la règle de la nature. Transaction annulée.
    /// </summary>
    [Fact]
    public async Task Surcharge_du_tiers_lue_dans_la_base()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG");
        if (string.IsNullOrEmpty(connexion)) return;
        await using var c = new NpgsqlConnection(connexion);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        async Task<object?> Scalaire(string sql, params (string, object)[] p)
        {
            await using var k = new NpgsqlCommand(sql, c, tx);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            return await k.ExecuteScalarAsync();
        }
        async Task<long> Id(string sql, params (string, object)[] p) => Convert.ToInt64(await Scalaire(sql, p));
        if (await Scalaire("SELECT 1 FROM information_schema.columns WHERE table_name = 'personne' AND column_name = 'per_rel_regle'") is null) return;
        var devis = await Id("SELECT tyd_id FROM type_document WHERE tyd_code = 'V_DEVIS'");
        if (await Scalaire("SELECT s.std_id FROM statut_document s JOIN type_document t ON t.tyd_id = s.std_tyd_id WHERE t.tyd_code = 'V_DEVIS' AND s.std_code = 'ENVOYE' ORDER BY s.std_id LIMIT 1") is not int envoye) return;
        await Scalaire("DELETE FROM relance_regle");

        async Task<long> Tiers(string nom, string? regle = null, bool ne = false, string? mode = null)
        {
            var t = await Id("""
                INSERT INTO personne (per_niv_code, per_raison_sociale, per_rel_regle, per_rel_ne_pas_relancer, per_rel_mode)
                VALUES ('SOCIETE', @n, @r::jsonb, @ne, @m) RETURNING per_id
                """, ("n", nom), ("r", (object?)regle ?? DBNull.Value), ("ne", ne), ("m", (object?)mode ?? DBNull.Value));
            var d = await Id("""
                INSERT INTO document (ent_tyd_id, ent_std_id, ent_numero, ent_date, ent_cree_par, ent_verrouille, ent_is_reference, ent_tiers_id,
                  ent_envoye_le, ent_total_ttc, ent_net_a_payer)
                VALUES (@t, @s, @n, @d, 'test', true, true, @tiers, @env, 1200, 1100) RETURNING ent_id
                """, ("t", devis), ("s", envoye), ("n", nom), ("d", Jour.AddDays(-50)), ("tiers", t), ("env", new DateTime(2026, 9, 29, 10, 0, 0, DateTimeKind.Utc)));
            await Scalaire("UPDATE document SET ent_groupe_id = ent_id WHERE ent_id = @i", ("i", d));
            return t;
        }
        var normal = await Tiers("Surcharge normal");
        var exclu = await Tiers("Surcharge exclu", ne: true);
        var propre = await Tiers("Surcharge propre", """{"niveaux":[{"rang":1,"delai":30,"mode":"COURRIER"}],"repeter":false,"intervalle":null}""", mode: "COURRIER");
        var invalide = await Tiers("Surcharge invalide", """{"niveaux":[]}""");

        var options = new DbContextOptionsBuilder<RelanceDbContext>().UseNpgsql(c).UseSnakeCaseNamingConvention().Options;
        await using var db = new RelanceDbContext(options);
        await db.Database.UseTransactionAsync(tx);
        var specialisation = new SpecialisationAuJour(Jour);
        var surcharges = await specialisation.RegleDuTiersAsync(db, [normal, exclu, propre, invalide], default);
        Assert.DoesNotContain(normal, surcharges.Keys);
        Assert.True(surcharges[exclu].NePasRelancer);
        Assert.Null(surcharges[invalide].Regle);
        Assert.Equal("COURRIER", surcharges[propre].ModePrefere);

        var dues = await new ServiceRelance(db, specialisation).Dues(Jour, new Utilisateur("test", "UTILISATEUR"), default);
        var mesTiers = new[] { normal, exclu, propre, invalide };
        var niveaux = dues.Where(g => mesTiers.Contains(g.TiersId)).ToDictionary(g => g.TiersId, g => g.Niveau);
        Assert.DoesNotContain(exclu, niveaux.Keys);
        Assert.Equal(2, niveaux[normal]);
        Assert.Equal(2, niveaux[invalide]);
        Assert.Equal(1, niveaux[propre]);
        await tx.RollbackAsync();
    }
}
