using LogiBTP.Api.Btp;
using LogiBTP.Domaine;
using LogiBTP.Editions;
using LogiBTP.Editions.Web;
using LogiBTP.Ged;
using LogiBTP.Ged.Web;
using LogiBTP.Mail.Web;
using LogiBTP.Reglements.Web;
using LogiBTP.Relances;
using LogiBTP.Relances.Web;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using MimeKit;
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

    /// <summary>
    /// Base LOGIBTP_TEST_PG (db/283 et db/287 chargés) : un devis envoyé il y a 40 jours est dû au niveau 2 ; la relance notée
    /// (Q22 b) l'inscrit au journal : colonne derniere_relance de v_liste_documents renseignée, plus rien de dû ce jour-là,
    /// niveau 3 dû 20 jours plus tard (le niveau avance). Transaction annulée.
    /// </summary>
    [Fact]
    public async Task Relance_notee_renseigne_la_colonne_et_fait_avancer_le_niveau()
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
        if (await Scalaire("SELECT 1 FROM information_schema.columns WHERE table_name = 'v_liste_documents' AND column_name = 'derniere_relance'") is null) return;
        var devis = await Id("SELECT tyd_id FROM type_document WHERE tyd_code = 'V_DEVIS'");
        if (await Scalaire("SELECT s.std_id FROM statut_document s JOIN type_document t ON t.tyd_id = s.std_tyd_id WHERE t.tyd_code = 'V_DEVIS' AND s.std_code = 'ENVOYE' ORDER BY s.std_id LIMIT 1") is not int envoye) return;
        await Scalaire("DELETE FROM relance_regle");
        var tiers = await Id("INSERT INTO personne (per_niv_code, per_raison_sociale) VALUES ('SOCIETE', 'Relance notee') RETURNING per_id");
        var piece = await Id("""
            INSERT INTO document (ent_tyd_id, ent_std_id, ent_numero, ent_date, ent_cree_par, ent_verrouille, ent_is_reference, ent_tiers_id,
              ent_envoye_le, ent_total_ttc, ent_net_a_payer)
            VALUES (@t, @s, 'DEV-NOTEE', @d, 'test', true, true, @tiers, @env, 1200, 1100) RETURNING ent_id
            """, ("t", devis), ("s", envoye), ("d", Jour.AddDays(-50)), ("tiers", tiers), ("env", new DateTime(2026, 9, 29, 10, 0, 0, DateTimeKind.Utc)));
        await Scalaire("UPDATE document SET ent_groupe_id = ent_id WHERE ent_id = @i", ("i", piece));
        Task<object?> Derniere() => Scalaire("SELECT derniere_relance FROM v_liste_documents WHERE id = @i", ("i", piece));
        Assert.True(await Derniere() is DBNull);

        var options = new DbContextOptionsBuilder<RelanceDbContext>().UseNpgsql(c).UseSnakeCaseNamingConvention().Options;
        await using var db = new RelanceDbContext(options);
        await db.Database.UseTransactionAsync(tx);
        var u = new Utilisateur("test", "UTILISATEUR");
        async Task<int?> Niveau(DateOnly jour) =>
            (await new ServiceRelance(db, new SpecialisationAuJour(jour)).Dues(jour, u, default)).SelectMany(g => g.Pieces).FirstOrDefault(x => x.Id == piece)?.Niveau;
        Assert.Equal(2, await Niveau(Jour));

        var notee = await new ServiceRelance(db, new SpecialisationAuJour(Jour)).Noter(new RelanceNotee(piece, ModeRelance.Courriel, Jour, "Appel du client"), u, default);
        Assert.Equal(2, notee.Niveau);
        Assert.Equal(EtatRelance.Envoyee, notee.Etat);
        Assert.Equal(Jour, (DateOnly)(await Derniere())!);
        Assert.Null(await Niveau(Jour));
        Assert.Equal(3, await Niveau(Jour.AddDays(20)));
        await tx.RollbackAsync();
    }

    /// <summary>Faux transport : aucun courriel ne part (la file n'est pas traitée par le test).</summary>
    private sealed class SansTransport : ITransportMail
    {
        public Task EnvoyerAsync(ServeurMail smtp, AuthMail auth, MimeMessage message, CancellationToken ct) => Task.CompletedTask;
        public Task CopierEnvoyesAsync(ServeurMail imap, AuthMail auth, MimeMessage message, CancellationToken ct) => Task.CompletedTask;
        public Task TesterAsync(ServeurMail? smtp, AuthMail? a, ServeurMail? imap, AuthMail? b, CancellationToken ct) => Task.CompletedTask;
        public Task<List<ResultatReleve>> ReleverAsync(ServeurMail imap, AuthMail auth, IReadOnlyList<DossierARelever> dossiers, DateTimeOffset depuis, long tailleMax,
            bool marquerLus, int max, CancellationToken ct) => Task.FromResult(new List<ResultatReleve>());
        public Task ApresRattachementAsync(ServeurMail imap, AuthMail auth, string dossier, uint uid, string action, string? cible, CancellationToken ct) => Task.CompletedTask;
    }

    /// <summary>Pièces jointes « ged:&lt;id&gt; » acceptées telles quelles (la GED n'est pas lue).</summary>
    private sealed class MailSansGed : SpecialisationMail
    {
        public override Task<List<PieceInfo>> PiecesAsync(IReadOnlyList<string> references, Utilisateur u, CancellationToken ct) =>
            Task.FromResult(references.Select(r => new PieceInfo(r, $"{r[4..]}.pdf", "application/pdf", 10)).ToList());
    }

    /// <summary>
    /// Envoi du cœur (SpecialisationRelanceBtp.CourrielAsync, NoterAsync) à une date fixe, pièce jointe = « ged:&lt;pièce&gt; »,
    /// note du CRM écrite en SQL dans la transaction du test (ServiceCrm ouvre sa propre transaction).
    /// </summary>
    private sealed class SpecialisationEnvoi(DateOnly jour, ServiceEnvoiMail mail) : SpecialisationRelance
    {
        public List<long> Notes { get; } = [];

        public override Task<List<PieceEnAttente>> PiecesEnAttenteAsync(RelanceDbContext db, FiltrePieces filtre, CancellationToken ct) =>
            SpecialisationRelanceBtp.PiecesAsync(db, filtre, jour, null, ct);

        public override async Task<LogiBTP.Relances.Web.ResultatEnvoi> EnvoyerCourrielAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct)
        {
            var attente = await PiecesEnAttenteAsync(db, new FiltrePieces(Pieces: envoi.Pieces.Select(p => p.PieceId).ToList()), ct);
            return await SpecialisationRelanceBtp.CourrielAsync(db, envoi, attente, mail, (p, _) => Task.FromResult<string?>($"ged:{p.Id}"), ct)
                ?? new LogiBTP.Relances.Web.ResultatEnvoi(EtatRelance.Envoyee, Mode: ModeRelance.Courrier);
        }

        public override async Task ApresEnvoiAsync(RelanceDbContext db, IReadOnlyList<RelanceDto> relances, CancellationToken ct) =>
            Notes.AddRange(await SpecialisationRelanceBtp.NoterAsync(db, relances, async (n, u, c) =>
            {
                var id = (await db.Database.SqlQueryRaw<long>("""
                    INSERT INTO crm_note (not_nature, not_etat, not_tno_id, not_objet, not_message_html, not_cree_par) VALUES (@n, @e, @t, @o, @h, @u) RETURNING not_id AS "Value"
                    """, new NpgsqlParameter("n", n.Nature), new NpgsqlParameter("e", n.Etat), new NpgsqlParameter("t", (object?)n.TnoId ?? DBNull.Value),
                    new NpgsqlParameter("o", n.Objet), new NpgsqlParameter("h", n.MessageHtml), new NpgsqlParameter("u", u.Code)).ToListAsync(c))[0];
                foreach (var l in n.Liens!)
                    await db.Database.ExecuteSqlRawAsync("INSERT INTO crm_note_lien (nli_not_id, nli_type_element, nli_id_element, nli_principal) VALUES (@n, @t, @i, @p)",
                        [new NpgsqlParameter("n", id), new NpgsqlParameter("t", l.TypeElement), new NpgsqlParameter("i", l.IdElement), new NpgsqlParameter("p", l.Principal)], c);
                return id;
            }, ct));
    }

    /// <summary>
    /// Base LOGIBTP_TEST_PG (db/283 à 285, Mail et CRM chargés) : validation d'un lot de relances (règle par défaut, devis
    /// envoyés il y a 40 jours : niveau 2). Tiers à contact figé (deux devis, un groupe) et tiers à contact de relance :
    /// un courriel par groupe dans la file du Mail (priorité basse, lot du Mail, modèle DEVIS_2, pièces jointes, liens aux
    /// pièces) ; tiers sans adresse : bascule en COURRIER ; journal ENVOYEE ; note RELANCE par groupe liée aux pièces et
    /// au courriel ; indicateur « Devis à relancer » remis à zéro (jours_envoye de v_liste_documents). Transaction annulée.
    /// </summary>
    [Fact]
    public async Task Validation_d_un_lot_met_les_courriels_en_file_et_pose_la_note()
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
        if (await Scalaire("SELECT 1 FROM mail_modele WHERE mmo_code = 'RELANCE_DEVIS_2'") is null) return;
        var devis = await Id("SELECT tyd_id FROM type_document WHERE tyd_code = 'V_DEVIS'");
        if (await Scalaire("SELECT s.std_id FROM statut_document s JOIN type_document t ON t.tyd_id = s.std_tyd_id WHERE t.tyd_code = 'V_DEVIS' AND s.std_code = 'ENVOYE' ORDER BY s.std_id LIMIT 1") is not int envoye) return;
        await Scalaire("DELETE FROM relance_regle");
        await Scalaire("UPDATE mail_compte SET mco_actif = false");

        async Task<long> Tiers(string nom) => await Id("INSERT INTO personne (per_niv_code, per_raison_sociale) VALUES ('SOCIETE', @n) RETURNING per_id", ("n", nom));
        async Task<long> Devis(long tiers, string numero, string? contact = null)
        {
            var d = await Id("""
                INSERT INTO document (ent_tyd_id, ent_std_id, ent_numero, ent_date, ent_cree_par, ent_verrouille, ent_is_reference, ent_tiers_id,
                  ent_envoye_le, ent_total_ttc, ent_net_a_payer, ent_contact_client)
                VALUES (@t, @s, @n, @d, 'test', true, true, @tiers, @env, 1200, 1100, @c::jsonb) RETURNING ent_id
                """, ("t", devis), ("s", envoye), ("n", numero), ("d", Jour.AddDays(-50)), ("tiers", tiers),
                ("env", new DateTime(2026, 9, 29, 10, 0, 0, DateTimeKind.Utc)), ("c", (object?)contact ?? DBNull.Value));
            await Scalaire("UPDATE document SET ent_groupe_id = ent_id WHERE ent_id = @i", ("i", d));
            return d;
        }
        var fige = await Tiers("Relance figé");
        var d1 = await Devis(fige, "DRM1", $$"""{"contact":{"nom":"M. Figé"},"per_id":{{fige}},"raison_sociale":"Relance figé","email":"achats@fige.fr"}""");
        var d2 = await Devis(fige, "DRM2");
        var relance = await Tiers("Relance contact");
        var ind = await Id("INSERT INTO individu (ind_nom, ind_prenom) VALUES ('Compta', 'Claire') RETURNING ind_id");
        await Scalaire("INSERT INTO rattachement (rat_ind_id, rat_per_id) VALUES (@i, @p)", ("i", ind), ("p", relance));
        var coo = await Id("INSERT INTO coordonnee (coo_nature, coo_valeur) VALUES ('EMAIL', 'compta@contact.fr') RETURNING coo_id");
        await Scalaire("INSERT INTO usage_coordonnee (uco_coo_id, uco_ind_id) VALUES (@c, @i)", ("c", coo), ("i", ind));
        await Scalaire("UPDATE personne SET per_rel_contact_ind_id = @i, per_rel_commentaire = 'Payer par virement' WHERE per_id = @p", ("i", ind), ("p", relance));
        var d3 = await Devis(relance, "DRM3", $$"""{"per_id":{{relance}},"email":"autre@contact.fr"}""");
        var muet = await Tiers("Relance sans adresse");
        var d4 = await Devis(muet, "DRM4");
        var mesPieces = new[] { d1, d2, d3, d4 };

        var options = new DbContextOptionsBuilder<RelanceDbContext>().UseNpgsql(c).UseSnakeCaseNamingConvention().Options;
        await using var db = new RelanceDbContext(options);
        await db.Database.UseTransactionAsync(tx);
        await using var mailDb = new MailDbContext(new DbContextOptionsBuilder<MailDbContext>().UseNpgsql(c).UseSnakeCaseNamingConvention().Options);
        await mailDb.Database.UseTransactionAsync(tx);
        var transport = new SansTransport();
        var specialisationMail = new MailSansGed();
        var nettoyage = new NettoyageHtmlMail();
        var comptes = new ServiceComptesMail(mailDb, new Chiffrement("chaine-de-test"), transport, specialisationMail, nettoyage, NullLogger<ServiceComptesMail>.Instance, TimeProvider.System);
        var reception = new ServiceReceptionMail(mailDb, comptes, transport, specialisationMail, nettoyage, NullLogger<ServiceReceptionMail>.Instance, TimeProvider.System);
        var mail = new ServiceEnvoiMail(mailDb, comptes, reception, transport, specialisationMail, nettoyage, NullLogger<ServiceEnvoiMail>.Instance, TimeProvider.System);
        var code = $"R{Guid.NewGuid():N}"[..16].ToUpperInvariant();
        var admin = new Utilisateur("admin.test", Profils.Admin);
        await comptes.CreerAsync(admin, new SaisieCompte(code, $"{code.ToLowerInvariant()}@exemple.fr", null, true, false, "MOT_DE_PASSE", null,
            new ServeurMail("smtp.exemple.fr", 465, "SSL", null, "secret"), null, null, null, "AUTRE", null, false, null, true, $"Relances {code}"), default);

        var specialisation = new SpecialisationEnvoi(Jour, mail);
        var service = new ServiceRelance(db, specialisation);
        var lot = await service.Preparer(new DemandePreparation(Jour), admin, default);
        Assert.NotNull(lot);
        var groupes = lot!.Groupes.Where(g => g.Relances.Any(r => mesPieces.Contains(r.PieceId))).ToList();
        Assert.Equal(3, groupes.Count);
        Assert.All(groupes, g => Assert.Equal((ModeRelance.Courriel, 2), (g.Mode, g.Niveau)));
        var resultat = await service.Valider(lot.Id, new ValidationLot(groupes.Select(g => new GroupeValide(g.Groupe)).ToList()), admin, default);
        Assert.Empty(resultat.Echecs);

        var journal = await db.Relances.AsNoTracking().Where(r => mesPieces.Contains(r.RelEntId)).ToDictionaryAsync(r => r.RelEntId);
        Assert.All(journal.Values, r => Assert.Equal(EtatRelance.Envoyee, r.RelEtat));
        Assert.Equal(ModeRelance.Courrier, journal[d4].RelMode);
        Assert.Null(journal[d4].RelCourrielId);
        Assert.Equal(journal[d1].RelCourrielId, journal[d2].RelCourrielId);

        // Un courriel par groupe en file, priorité basse, dans le lot du Mail du lot de relances, avec ses pièces et ses liens.
        var messages = await mailDb.Messages.AsNoTracking().Where(m => m.MmeId == journal[d1].RelCourrielId || m.MmeId == journal[d3].RelCourrielId)
            .ToDictionaryAsync(m => m.MmeId);
        Assert.Equal(2, messages.Count);
        Assert.All(messages.Values, m => Assert.Equal(("A_ENVOYER", "BASSE", SpecialisationRelanceBtp.Usage), (m.MmeEtat, m.MmePriorite, m.MmeUsage)));
        Assert.Single(messages.Values.Select(m => m.MmeMloId).Distinct());
        Assert.Equal(2, (await mailDb.Lots.AsNoTracking().FirstAsync(l => l.MloId == messages.Values.First().MmeMloId)).MloMessages);
        var m1 = messages[journal[d1].RelCourrielId!.Value];
        Assert.StartsWith("Relance – notre proposition", m1.MmeObjet);
        Assert.Contains("DRM1", m1.MmeObjet);
        Assert.Contains("<table>", m1.MmeCorpsHtml);
        Assert.Contains("M. Figé", m1.MmeCorpsHtml);
        Assert.Equal(["achats@fige.fr"], await mailDb.Destinataires.AsNoTracking().Where(x => x.MdeMmeId == m1.MmeId).Select(x => x.MdeAdresse).ToListAsync());
        Assert.Equal([$"ged:{d1}", $"ged:{d2}"], await mailDb.Pieces.AsNoTracking().Where(x => x.MpiMmeId == m1.MmeId).OrderBy(x => x.MpiId).Select(x => x.MpiReference).ToListAsync());
        Assert.Equal(["compta@contact.fr"], await mailDb.Destinataires.AsNoTracking().Where(x => x.MdeMmeId == journal[d3].RelCourrielId).Select(x => x.MdeAdresse).ToListAsync());
        var liens = await mailDb.Liens.AsNoTracking().Where(l => l.MliMmeId == m1.MmeId).Select(l => l.MliTypeElement + ":" + l.MliIdElement).ToListAsync();
        Assert.Contains($"personne:{fige}", liens);
        Assert.Contains($"document:{d1}", liens);
        Assert.Contains($"document:{d2}", liens);

        // Notes RELANCE : une par groupe, liées aux pièces (groupe d'indices), au tiers et au courriel ; « Devis à relancer » remis à zéro.
        Assert.Equal(3, specialisation.Notes.Count);
        Assert.Equal(3L, Convert.ToInt64(await Scalaire("""
            SELECT count(*) FROM crm_note n JOIN crm_type_note t ON t.tno_id = n.not_tno_id AND t.tno_code = 'RELANCE' WHERE n.not_id = ANY(@n)
            """, ("n", specialisation.Notes.ToArray()))));
        Assert.NotNull(await Scalaire("SELECT 1 FROM crm_note_lien WHERE nli_type_element = 'document' AND nli_id_element = @i", ("i", d2.ToString())));
        Assert.NotNull(await Scalaire("""
            SELECT 1 FROM mail_lien k JOIN crm_note_lien l ON l.nli_not_id::text = k.mli_id_element
            WHERE k.mli_type_element = 'crm_note' AND k.mli_mme_id = @m AND l.nli_type_element = 'document' AND l.nli_id_element = @d
            """, ("m", m1.MmeId), ("d", d1.ToString())));
        Assert.NotNull(await Scalaire("SELECT 1 FROM crm_note WHERE not_id = ANY(@n) AND not_message_html LIKE '%Payer par virement%'", ("n", specialisation.Notes.ToArray())));
        foreach (var d in mesPieces)
            Assert.Equal(0, Convert.ToInt32(await Scalaire("SELECT jours_envoye FROM v_liste_documents WHERE id = @i", ("i", d))));
        await tx.RollbackAsync();
    }

    // ----- Lettres et recommandés (lot 7) -----

    [Theory]
    [InlineData("FACTURE", 3, 3, "MISE_EN_DEMEURE")]
    [InlineData("FACTURE", 4, 3, "MISE_EN_DEMEURE")]
    [InlineData("FACTURE", 2, 3, "RELANCE_2")]
    [InlineData("FACTURE", 1, 3, "RELANCE_1")]
    [InlineData("DEVIS", 3, 3, "RELANCE_2")]
    [InlineData("DEVIS", 1, 3, "RELANCE_1")]
    public void Modele_par_defaut_de_la_lettre(string nature, int niveau, int dernier, string attendu) =>
        Assert.Equal(attendu, SpecialisationRelanceBtp.ModeleParDefaut(nature, niveau, dernier));

    [Fact]
    public void Identifiant_d_une_lettre()
    {
        Assert.Equal("3,7,12", SourceRelanceEdition.Identifiant([12, 3, 7, 3]));
        Assert.Equal([3L, 7L], SourceRelanceEdition.Relances("3, 7"));
        Assert.Empty(SourceRelanceEdition.Relances("3,x"));
        Assert.Empty(SourceRelanceEdition.Relances(""));
    }

    /// <summary>Lettres du cœur : PDF produit par le vrai module Édition (Jint), dépôt GED remplacé (ServiceGed ouvre sa transaction).</summary>
    private sealed class SpecialisationLettres(DateOnly jour, IServiceProvider services, Func<SpecialisationRelanceBtp.LettreARanger, CancellationToken, Task<long>> ranger)
        : SpecialisationRelance
    {
        public override Task<List<PieceEnAttente>> PiecesEnAttenteAsync(RelanceDbContext db, FiltrePieces filtre, CancellationToken ct) =>
            SpecialisationRelanceBtp.PiecesAsync(db, filtre, jour, null, ct);

        public override Task<LogiBTP.Relances.Web.ResultatEnvoi> EnvoyerCourrierAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct) =>
            SpecialisationRelanceBtp.LettreAsync(db, envoi, SpecialisationRelanceBtp.ProduireLettre(services, envoi), ranger, ct);

        public override Task<LogiBTP.Relances.Web.ResultatEnvoi> EnvoyerRecommandeAsync(RelanceDbContext db, EnvoiRelance envoi, CancellationToken ct) =>
            SpecialisationRelanceBtp.LettreAsync(db, envoi, SpecialisationRelanceBtp.ProduireLettre(services, envoi), ranger, ct);
    }

    /// <summary>
    /// Base LOGIBTP_TEST_PG (db/283 à 286 et db/191 rejoué : modèles RELANCE_1, RELANCE_2, MISE_EN_DEMEURE) : règle des
    /// factures 15 j courrier puis 30 j recommandé, des devis 15 j courrier. Deux devis d'un tiers (un groupe, niveau 1) :
    /// lettre RELANCE_1 produite en PDF par le moteur du serveur, sans alerte, rangée en GED de chaque devis (catégorie
    /// relance, groupe d'indices), journal ENVOYEE avec le document GED. Facture échue depuis 40 jours (niveau 2, dernier) :
    /// MISE_EN_DEMEURE en recommandé, données citant les mentions sans calcul, ATTENTE_NUMERO, puis ENVOYEE après la
    /// saisie du numéro. Transaction annulée.
    /// </summary>
    [Fact]
    public async Task Validation_en_courrier_range_la_lettre_en_ged_et_le_recommande_attend_son_numero()
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
        if (await Scalaire("SELECT 1 FROM modele_edition WHERE med_code = 'MISE_EN_DEMEURE' AND med_source = 'relance'") is null) return;
        async Task<int?> Statut(string type, string code) => await Scalaire("""
            SELECT s.std_id FROM statut_document s JOIN type_document t ON t.tyd_id = s.std_tyd_id WHERE t.tyd_code = @t AND s.std_code = @c ORDER BY s.std_id LIMIT 1
            """, ("t", type), ("c", code)) is int i ? i : null;
        if (await Statut("V_DEVIS", "ENVOYE") is not int envoye || await Statut("V_FACTURE", "VALIDE") is not int valide) return;
        var devis = await Id("SELECT tyd_id FROM type_document WHERE tyd_code = 'V_DEVIS'");
        var facture = await Id("SELECT tyd_id FROM type_document WHERE tyd_code = 'V_FACTURE'");
        await Scalaire("DELETE FROM relance_regle");
        await Scalaire("""
            INSERT INTO relance_regle (rrg_nature, rrg_niveaux, rrg_modifie_par) VALUES
              ('FACTURE', '[{"rang":1,"delai":15,"mode":"COURRIER"},{"rang":2,"delai":30,"mode":"RECOMMANDE"}]', 'test'),
              ('DEVIS', '[{"rang":1,"delai":15,"mode":"COURRIER"}]', 'test')
            """);

        async Task<long> Tiers(string nom) => await Id("INSERT INTO personne (per_niv_code, per_raison_sociale) VALUES ('SOCIETE', @n) RETURNING per_id", ("n", nom));
        async Task<long> Piece(long type, int statut, long tiers, string numero, DateOnly date)
        {
            var d = await Id("""
                INSERT INTO document (ent_tyd_id, ent_std_id, ent_numero, ent_date, ent_cree_par, ent_verrouille, ent_is_reference, ent_tiers_id,
                  ent_envoye_le, ent_total_ttc, ent_net_a_payer)
                VALUES (@t, @s, @n, @d, 'test', true, true, @tiers, @env, 1200, 1100) RETURNING ent_id
                """, ("t", type), ("s", statut), ("n", numero), ("d", date), ("tiers", tiers), ("env", date.ToDateTime(new TimeOnly(10, 0), DateTimeKind.Utc)));
            await Scalaire("UPDATE document SET ent_groupe_id = ent_id WHERE ent_id = @i", ("i", d));
            return d;
        }
        var prospect = await Tiers("Lettre prospect");
        var d1 = await Piece(devis, envoye, prospect, "DLT1", Jour.AddDays(-20));
        var d2 = await Piece(devis, envoye, prospect, "DLT2", Jour.AddDays(-20));
        var mauvais = await Tiers("Lettre mauvais payeur");
        var f1 = await Piece(facture, valide, mauvais, "FLT1", Jour.AddDays(-70));
        await Scalaire("INSERT INTO document_echeance (ech_ent_id, ech_rang, ech_montant, ech_date) VALUES (@e, 1, 1100, @d)", ("e", f1), ("d", Jour.AddDays(-40)));
        var mesPieces = new[] { d1, d2, f1 };

        DbContextOptions<T> Options<T>() where T : DbContext => new DbContextOptionsBuilder<T>().UseNpgsql(c).UseSnakeCaseNamingConvention().Options;
        await using var db = new RelanceDbContext(Options<RelanceDbContext>());
        await db.Database.UseTransactionAsync(tx);
        await using var logi = new LogiBtpContext(Options<LogiBtpContext>());
        await logi.Database.UseTransactionAsync(tx);
        await using var editionDb = new EditionDbContext(Options<EditionDbContext>());
        await editionDb.Database.UseTransactionAsync(tx);
        await using var gedDb = new GedDbContext(Options<GedDbContext>());
        await gedDb.Database.UseTransactionAsync(tx);
        using var pool = new PoolMoteursEdition(1);
        var specialisationEdition = new SpecialisationEditionBtp();
        var sc = new ServiceCollection();
        sc.AddSingleton(logi).AddSingleton(editionDb).AddSingleton(gedDb).AddSingleton(pool).AddSingleton<SpecialisationEdition>(specialisationEdition)
            .AddSingleton(new ServiceEdition(editionDb, specialisationEdition, pool))
            .AddSingleton(new ServiceGed(gedDb, new SpecialisationGed(), new StockageGed(Path.Combine(Path.GetTempPath(), "logibtp-relances-" + Guid.NewGuid().ToString("N")))));
        await using var services = sc.BuildServiceProvider();

        // Dépôt GED : document de la pièce inséré dans la transaction du test (trigger : élément existant).
        var rangees = new List<SpecialisationRelanceBtp.LettreARanger>();
        async Task<long> Ranger(SpecialisationRelanceBtp.LettreARanger l, CancellationToken ct)
        {
            rangees.Add(l);
            return await Id("""
                INSERT INTO document_ged (dge_titre, dge_categorie, dge_type_element, dge_id_element, dge_cree_par, dge_resume)
                VALUES (@t, @c, @y, @e, 'test', @r) RETURNING dge_id
                """, ("t", l.Titre), ("c", CategoriesGed.Relance), ("y", l.TypeElement), ("e", l.IdElement), ("r", l.Resume));
        }

        var admin = new Utilisateur("admin.test", Profils.Admin);
        var service = new ServiceRelance(db, new SpecialisationLettres(Jour, services, Ranger));
        var lot = await service.Preparer(new DemandePreparation(Jour), admin, default);
        Assert.NotNull(lot);
        var groupes = lot!.Groupes.Where(g => g.Relances.Any(r => mesPieces.Contains(r.PieceId))).ToList();
        Assert.Equal(2, groupes.Count);
        var gDevis = groupes.Single(g => g.TiersId == prospect);
        var gFacture = groupes.Single(g => g.TiersId == mauvais);
        Assert.Equal((ModeRelance.Courrier, 1, 2), (gDevis.Mode, gDevis.Niveau, gDevis.Relances.Count));
        Assert.Equal((ModeRelance.Recommande, 2), (gFacture.Mode, gFacture.Niveau));

        // Données de la mise en demeure : recommandé, montant relancé, échéance échue, mentions de la société (sans calcul).
        var donnees = await SourceRelanceEdition.Lire(services, new DemandeEdition(SourceRelanceEdition.Source,
            SourceRelanceEdition.Identifiant(gFacture.Relances.Select(r => r.Id)), Parametres: new() { ["mode"] = System.Text.Json.JsonSerializer.SerializeToElement(ModeRelance.Recommande) }), default);
        Assert.NotNull(donnees);
        Assert.True(donnees!["relance"]!["recommande"]!.GetValue<bool>());
        Assert.Equal(1100m, donnees["relance"]!["montant"]!.GetValue<decimal>());
        Assert.Equal(Jour.AddDays(-40).ToString("yyyy-MM-dd"), donnees["pieces"]![0]!["echeance"]!.GetValue<string>());
        Assert.Equal("Lettre mauvais payeur", donnees["tiers"]!["nom"]!.GetValue<string>());
        Assert.IsType<System.Text.Json.Nodes.JsonObject>(donnees["societe"]!["mentions"]);

        var resultat = await service.Valider(lot.Id, new ValidationLot([new GroupeValide(gDevis.Groupe), new GroupeValide(gFacture.Groupe)]), admin, default);
        Assert.Empty(resultat.Echecs);

        // Une lettre par groupe, rangée en GED de chaque pièce ; PDF réel du moteur, sans alerte.
        Assert.Equal(3, rangees.Count);
        Assert.All(rangees, l => Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(l.Lettre.Pdf, 0, 4)));
        Assert.All(rangees, l => Assert.Equal("[]", l.Lettre.Alertes));
        Assert.Equal([$"V_DEVIS:{d1}:{ModelesEdition.Relance1}", $"V_DEVIS:{d2}:{ModelesEdition.Relance1}", $"V_FACTURE:{f1}:{ModelesEdition.MiseEnDemeure}"],
            rangees.Select(l => $"{l.TypeElement}:{l.IdElement}:{l.Modele}").Order());
        Assert.Same(rangees[0].Lettre, rangees.First(l => l.IdElement == d2.ToString()).Lettre);
        Assert.Equal(2L, Convert.ToInt64(await Scalaire("SELECT count(*) FROM document_ged WHERE dge_categorie = 'relance' AND dge_type_element = 'V_DEVIS' AND dge_id_element = ANY(@e)",
            ("e", new[] { d1.ToString(), d2.ToString() }))));

        var journal = await db.Relances.AsNoTracking().Where(r => mesPieces.Contains(r.RelEntId)).ToDictionaryAsync(r => r.RelEntId);
        Assert.Equal((EtatRelance.Envoyee, ModeRelance.Courrier), (journal[d1].RelEtat, journal[d1].RelMode));
        Assert.NotNull(journal[d1].RelGedId);
        Assert.Equal(EtatRelance.AttenteNumero, journal[f1].RelEtat);
        Assert.NotNull(journal[f1].RelGedId);
        Assert.Null(journal[f1].RelRecommande);

        // Saisie du numéro du recommandé : la lettre passe ENVOYEE.
        var lettre = await service.SaisirNumero(journal[f1].RelId, new NumeroRecommande(" 1A 234 567 8901 2 "), admin, default);
        Assert.Equal((EtatRelance.Envoyee, "1A 234 567 8901 2"), (Assert.Single(lettre).Etat, lettre[0].Recommande));
        Assert.Equal(EtatRelance.Envoyee, (await db.Relances.AsNoTracking().FirstAsync(r => r.RelId == journal[f1].RelId)).RelEtat);
        await tx.RollbackAsync();
    }
}
