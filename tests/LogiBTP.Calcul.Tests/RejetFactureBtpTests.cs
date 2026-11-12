using LogiBTP.Api.Btp;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Relances;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Rejet, refus et litige d'une facture émise (plans/facturation-electronique.md, lot 25 ; Q14, Q17) : règles sans base
/// (proposition, transmission, état de l'avoir, suite d'un statut sur la relance) ; sur la base jetable
/// (LOGIBTP_TEST_PG_JETABLE, manifeste chargé avec db/301) et la plateforme simulée : Rejetée → avoir interne proposé sans
/// changement de la pièce, confirmé → avoir ANNULATION daté du jour déposé pour archivage seul (ARCHIVEONLY, ArchiveOnly),
/// nouvelle facture en brouillon, étape AVOIR_INTERNE ; Refusée d'une pièce transférée en comptabilité → avoir non déposé,
/// pièce restée transférée ; En litige → relance suspendue, levée à Approuvée.
/// </summary>
[Collection(EnvoiFactureBtpTests.CollectionBase)]
public class RejetFactureBtpTests
{
    [Theory]
    [InlineData(StatutCdv.Rejetee, true, false, true)]
    [InlineData(StatutCdv.Refusee, true, false, true)]
    [InlineData(StatutCdv.Refusee, false, false, false)]
    [InlineData(StatutCdv.Rejetee, true, true, false)]
    [InlineData(StatutCdv.EnLitige, true, false, false)]
    [InlineData(StatutCdv.MiseADisposition, true, false, false)]
    [InlineData(null, true, false, false)]
    public void Avoir_interne_propose_sur_Rejetee_ou_Refusee_validee_non_annulee(string? statut, bool valable, bool deja, bool attendu) =>
        Assert.Equal(attendu, RejetFactureBtp.Proposee(statut, valable, deja));

    [Fact]
    public void Transmission_etat_de_l_avoir_et_suite_sur_la_relance()
    {
        Assert.Equal(TransmissionsAvoirInterneFe.ArchivageSeul, RejetFactureBtp.Transmission(null));
        Assert.Equal(TransmissionsAvoirInterneFe.Aucune, RejetFactureBtp.Transmission(TransmissionsAvoirInterneFe.Aucune));
        Assert.Null(RejetFactureBtp.Transmission("AUTRE"));
        Assert.Equal((EtatsEmissionFe.AEmettre, (string?)null), RejetFactureBtp.EtatAvoir(TransmissionsAvoirInterneFe.ArchivageSeul));
        Assert.Equal((EtatsEmissionFe.HorsFlux, MotifsEmissionFe.AvoirInterne), RejetFactureBtp.EtatAvoir(TransmissionsAvoirInterneFe.Aucune));
        Assert.Equal(RejetFactureBtp.SuiteRelance.Suspendre, RejetFactureBtp.SuiteDuStatut(StatutCdv.EnLitige));
        Assert.Equal(RejetFactureBtp.SuiteRelance.Lever, RejetFactureBtp.SuiteDuStatut(StatutCdv.Approuvee));
        Assert.Equal(RejetFactureBtp.SuiteRelance.Aucune, RejetFactureBtp.SuiteDuStatut(StatutCdv.Refusee));
    }

    /// <summary>Horloge de la plateforme simulée avancée par le test (un statut programmé par minute).</summary>
    private sealed class Horloge : TimeProvider
    {
        public DateTimeOffset Maintenant { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Maintenant;
    }

    private static OptionsPlateformeSimulee Simulation(params StatutProgramme[] statuts) => new()
    {
        DelaiAccuse = TimeSpan.Zero, IntervalleStatuts = TimeSpan.FromMinutes(1), Statuts = statuts,
    };

    private static string Motif(string statut, string emetteur, bool b2g = false) => ReglesCycleVie.MotifsAutorises(statut, emetteur, b2g)[0];

    private sealed class Base(string connexion) : IAsyncDisposable
    {
        private readonly NpgsqlConnection c = new(connexion);
        public readonly Utilisateur Admin = new("admin.test", Profils.Admin);

        public async Task<object?> Scalaire(string sql, params (string, object)[] p)
        {
            if (c.State != System.Data.ConnectionState.Open) await c.OpenAsync();
            await using var k = new NpgsqlCommand(sql, c);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            var r = await k.ExecuteScalarAsync();
            return r is DBNull ? null : r;
        }

        public ValueTask DisposeAsync() => c.DisposeAsync();

        /// <summary>Plateforme simulée active ; flux restés des passages précédents traités ; client B2B de la démonstration.</summary>
        public async Task<long> PreparerAsync(ServiceProvider services)
        {
            await Scalaire("UPDATE module_societe SET mod_actif = TRUE WHERE mod_code = 'facture_electronique'");
            await Scalaire("UPDATE facture_electronique_emission_option SET feo_automatique = TRUE");
            using (var scope = services.CreateScope())
            {
                var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
                var p = await fe.Parametres(default);
                await fe.EnregistrerParametres(p with { Connecteur = ConnecteurFe.Simule, Actif = true, AdresseFlux = null, ConnexionOauth = null, StatutsNonEnvoyes = [] }, Admin, default);
                await new FileFlux(fe).TraiterAsync(100, default);
                await new ReleveFlux(fe).ReleverAsync(true, null, default);
            }
            await Scalaire("UPDATE document_fe_emission SET dfe_etat = 'DIFFEREE' WHERE dfe_etat = 'A_EMETTRE'");
            var client = (long)(await Scalaire("""
                SELECT per_id FROM personne WHERE NOT per_societe_base AND per_siren ~ '^[0-9]{9}$' AND per_pays = 'FR' AND per_niv_code = 'SOCIETE'
                  AND per_siren <> (SELECT per_siren FROM personne WHERE per_societe_base LIMIT 1) ORDER BY per_id LIMIT 1
                """))!;
            await Scalaire("UPDATE personne SET per_fe_type = 'B2B', per_fe_dans_annuaire = TRUE, per_fe_format = 'FACTURX' WHERE per_id = @p", ("p", client));
            return client;
        }

        /// <summary>Facture du client validée, émise (tâche de fond), déposée et acquittée sur la plateforme simulée.</summary>
        public async Task<(long Ent, long Flux)> EmettreAsync(ServiceProvider services, long tiers, string objet)
        {
            var ent = (long)(await Scalaire("""
                WITH d AS (INSERT INTO document (ent_tyd_id, ent_date, ent_std_id, ent_tiers_id, ent_cree_par, ent_total_ht, ent_total_tva,
                                                 ent_total_ttc, ent_net_a_payer, ent_cpa_code, ent_mode_reglement, ent_objet)
                    SELECT t.tyd_id, current_date, (SELECT std_id FROM statut_document WHERE std_code = 'BROUILLON' AND std_tyd_id = t.tyd_id),
                           @tiers, 'test', 150, 30, 180, 180, '30J', 'CHEQUE', @objet
                    FROM type_document t WHERE t.tyd_code = 'V_FACTURE' RETURNING ent_id),
                l AS (INSERT INTO document_ligne (lig_ent_id, lig_ordre, lig_tyl_id, lig_libelle_html, lig_libelle_brut, lig_qte, lig_qte_vendue, lig_pv,
                                                  lig_pv_remise, lig_montant_ht, lig_tva_id, lig_taux_tva, lig_type_prix, lig_unt_code, lig_pv_fixe, lig_nat_id)
                    SELECT ent_id, 1, 3, 'Travaux', 'Travaux', 3, 3, 50, 50, 150, 1, 20, 'V', 'h', TRUE, (SELECT nat_id FROM nature_element ORDER BY nat_id LIMIT 1) FROM d RETURNING lig_ent_id),
                t AS (INSERT INTO document_tva (tva_ent_id, tva_ttv_id, tva_code, tva_taux, tva_categorie, tva_base_ht, tva_montant, tva_montant_annulation, tva_montant_net)
                    SELECT DISTINCT lig_ent_id, 1, 'T20', 20, 'N', 150, 30, 0, 30 FROM l RETURNING tva_ent_id)
                SELECT tva_ent_id FROM t
                """, ("tiers", tiers), ("objet", objet)))!;
            using (var scope = services.CreateScope())
            {
                var documents = scope.ServiceProvider.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
                var version = (int)(await Scalaire("SELECT ent_version FROM document WHERE ent_id = @e", ("e", ent)))!;
                await documents.Valider(ent, new DemandeVersion { EntVersion = version }, Admin, default);
                await EnvoiFactureBtp.TraiterAsync(scope.ServiceProvider, 10, default);
                var etat = await EnvoiFactureBtp.EtatAsync(scope.ServiceProvider.GetRequiredService<LogiBtpContext>(), ent, default);
                Assert.True(etat.Erreur is null, etat.Erreur);
                Assert.Equal(EtatsEmissionFe.Emise, etat.Etat);
                return (ent, etat.FluxId!.Value);
            }
        }

        /// <summary>Dépôt puis relèves : une minute de plus à chaque relève (un statut programmé par minute).</summary>
        public static async Task ReleverAsync(ServiceProvider services, Horloge horloge, int fois)
        {
            using var scope = services.CreateScope();
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            await new FileFlux(fe).TraiterAsync(100, default);
            for (var i = 0; i < fois; i++)
            {
                await new ReleveFlux(fe).ReleverAsync(true, null, default);
                horloge.Maintenant += TimeSpan.FromMinutes(1);
            }
            await new ReleveFlux(fe).ReleverAsync(true, null, default);
        }

        public async Task<EtatEnvoiFe> EtatAsync(ServiceProvider services, long ent)
        {
            using var scope = services.CreateScope();
            return await EnvoiFactureBtp.EtatAsync(scope.ServiceProvider.GetRequiredService<LogiBtpContext>(), ent, default);
        }

        public async Task<string?> StatutDocument(long ent) =>
            (string?)await Scalaire("SELECT s.std_code FROM document d JOIN statut_document s ON s.std_id = d.ent_std_id WHERE d.ent_id = @e", ("e", ent));
    }

    private static string? Connexion()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_JETABLE");
        return string.IsNullOrEmpty(connexion) ? null : connexion;
    }

    private static async Task<bool> SchemaAsync(Base b) =>
        await b.Scalaire("SELECT to_regclass('document_fe_annulation')::text") is not null;

    [Fact]
    public async Task Rejetee_avoir_interne_propose_puis_depose_pour_archivage_seul_et_nouvelle_facture()
    {
        if (Connexion() is not { } connexion) return;
        await using var b = new Base(connexion);
        if (!await SchemaAsync(b)) return;
        var horloge = new Horloge();
        await using var services = EnvoiFactureBtpTests.Services(connexion, Simulation(
            new(StatutCdv.Deposee, EmetteurStatut.PaE),
            new(StatutCdv.Rejetee, EmetteurStatut.PaE, Motif(StatutCdv.Rejetee, EmetteurStatut.PaE))), horloge);
        var client = await b.PreparerAsync(services);
        var (ent, flux) = await b.EmettreAsync(services, client, "Essai lot 25 rejet");
        await Base.ReleverAsync(services, horloge, 3);

        // Rejetée : proposition seulement, la pièce garde son statut (aucun changement sans l'utilisateur).
        var etat = await b.EtatAsync(services, ent);
        Assert.Equal(StatutCdv.Rejetee, etat.Statut);
        Assert.True(etat.Annulation is { Proposee: true, Statut: StatutCdv.Rejetee }, etat.Annulation?.ToString());
        Assert.Equal("ENVOYE", await b.StatutDocument(ent));
        Assert.Null(await b.Scalaire("SELECT dfa_avoir_ent_id FROM document_fe_annulation WHERE dfa_ent_id = @e", ("e", ent)));

        // Confirmée : avoir ANNULATION daté du jour, les deux pièces annulées, nouvelle facture en brouillon (lien COPIE).
        EtatEnvoiFe apres;
        using (var scope = services.CreateScope())
            apres = await RejetFactureBtp.AnnulerAsync(scope.ServiceProvider, ent, new DemandeAnnulationFe(null), b.Admin, default);
        var a = apres.Annulation!;
        Assert.False(a.Proposee);
        Assert.Equal(TransmissionsAvoirInterneFe.ArchivageSeul, a.Transmission);
        var avoir = a.AvoirId!.Value;
        Assert.Equal("ANNULE", await b.StatutDocument(ent));
        Assert.Equal("ANNULE", await b.StatutDocument(avoir));
        Assert.Equal("ANNULATION", await b.Scalaire("SELECT lie_type FROM document_lien WHERE lie_source_ent_id = @e AND lie_cible_ent_id = @a", ("e", ent), ("a", avoir)));
        Assert.Equal(DateOnly.FromDateTime(DateTime.Today), await b.Scalaire("SELECT ent_date FROM document WHERE ent_id = @a", ("a", avoir)));
        Assert.Equal("BROUILLON", await b.StatutDocument(a.CopieId!.Value));
        Assert.Equal("COPIE", await b.Scalaire("SELECT lie_type FROM document_lien WHERE lie_source_ent_id = @e AND lie_cible_ent_id = @c", ("e", ent), ("c", a.CopieId!.Value)));
        Assert.False(apres.Emettable);

        // L'avoir part pour archivage seul : note BAR ARCHIVEONLY, règle ArchiveOnly ; état de l'avoir : facture annulée.
        Assert.Equal(EtatsEmissionFe.AEmettre, await b.Scalaire("SELECT dfe_etat FROM document_fe_emission WHERE dfe_ent_id = @a", ("a", avoir)));
        using (var scope = services.CreateScope()) await EnvoiFactureBtp.TraiterAsync(scope.ServiceProvider, 10, default);
        var etatAvoir = await b.EtatAsync(services, avoir);
        Assert.True(etatAvoir.Erreur is null, etatAvoir.Erreur);
        Assert.Equal(EtatsEmissionFe.Emise, etatAvoir.Etat);
        Assert.True(etatAvoir.Annulation is { EstAvoir: true } && etatAvoir.Annulation.FactureId == ent);
        var fluxAvoir = etatAvoir.FluxId!.Value;
        Assert.Equal(RegleTraitement.ArchivageSeul, await b.Scalaire("SELECT ffl_regle FROM fe_flux WHERE ffl_id = @f", ("f", fluxAvoir)));
        var contenu = (byte[])(await b.Scalaire("SELECT ffi_contenu FROM fe_fichier WHERE ffi_ffl_id = @f AND ffi_document = 'Original'", ("f", fluxAvoir)))!;
        var lue = Lecture.Lire(contenu).Facture;
        Assert.Contains(lue.Notes, n => n.CodeSujet == CodeNote.Traitement && n.Texte == Traitement.ArchivageSeul);
        Assert.NotNull(lue.FacturesAnterieures);
        Assert.NotEmpty(lue.FacturesAnterieures!);

        // Étape AVOIR_INTERNE de l'utilisateur sur la chronologie de la facture ; une seconde demande est refusée.
        using (var scope = services.CreateScope())
        {
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            var chronologie = await fe.Chronologie(null, TypesElementFe.Document, ent.ToString(), default);
            Assert.Contains(chronologie, e => e.Type == EvenementFe.AvoirInterne && e.Acteur == ActeurFe.Utilisateur && e.FluxId == flux);
            var refus = await Assert.ThrowsAsync<ExceptionMetier>(() => RejetFactureBtp.AnnulerAsync(scope.ServiceProvider, ent, new DemandeAnnulationFe(null), b.Admin, default));
            Assert.Equal(ErreursEmissionFe.AnnulationImpossible, refus.Code);
        }
    }

    [Fact]
    public async Task Refusee_d_une_piece_transferee_avoir_du_jour_non_depose()
    {
        if (Connexion() is not { } connexion) return;
        await using var b = new Base(connexion);
        if (!await SchemaAsync(b)) return;
        var horloge = new Horloge();
        await using var services = EnvoiFactureBtpTests.Services(connexion, Simulation(
            new(StatutCdv.Deposee, EmetteurStatut.PaE), new(StatutCdv.Recue, EmetteurStatut.PaR),
            new(StatutCdv.Refusee, EmetteurStatut.Acheteur, Motif(StatutCdv.Refusee, EmetteurStatut.Acheteur))), horloge);
        var client = await b.PreparerAsync(services);
        var (ent, _) = await b.EmettreAsync(services, client, "Essai lot 25 refus");
        // Pièce transférée en comptabilité et datée du mois précédent.
        await b.Scalaire("UPDATE document SET ent_etat_compta = 'T', ent_date = current_date - 40 WHERE ent_id = @e", ("e", ent));
        await Base.ReleverAsync(services, horloge, 4);
        var etat = await b.EtatAsync(services, ent);
        Assert.True(etat.Annulation is { Proposee: true, Statut: StatutCdv.Refusee }, etat.Annulation?.ToString());

        // Transmission inconnue refusée ; non déposé : avoir hors flux (AVOIR_INTERNE), daté du jour, pièce restée transférée.
        using (var scope = services.CreateScope())
        {
            var e = await Assert.ThrowsAsync<ExceptionMetier>(() => RejetFactureBtp.AnnulerAsync(scope.ServiceProvider, ent, new DemandeAnnulationFe("AUTRE"), b.Admin, default));
            Assert.Equal(ErreursEmissionFe.AnnulationImpossible, e.Code);
        }
        EtatEnvoiFe apres;
        using (var scope = services.CreateScope())
            apres = await RejetFactureBtp.AnnulerAsync(scope.ServiceProvider, ent, new DemandeAnnulationFe(TransmissionsAvoirInterneFe.Aucune), b.Admin, default);
        var avoir = apres.Annulation!.AvoirId!.Value;
        Assert.Equal(DateOnly.FromDateTime(DateTime.Today), await b.Scalaire("SELECT ent_date FROM document WHERE ent_id = @a", ("a", avoir)));
        Assert.Equal("T", await b.Scalaire("SELECT ent_etat_compta FROM document WHERE ent_id = @e", ("e", ent)));
        Assert.Null(await b.Scalaire("SELECT ent_etat_compta FROM document WHERE ent_id = @c", ("c", apres.Annulation.CopieId!.Value)));
        var etatAvoir = await b.EtatAsync(services, avoir);
        Assert.Equal((EtatsEmissionFe.HorsFlux, MotifsEmissionFe.AvoirInterne, (long?)null, false),
            (etatAvoir.Etat, etatAvoir.Motif, etatAvoir.FluxId, etatAvoir.Emettable));
        using (var scope = services.CreateScope()) await EnvoiFactureBtp.TraiterAsync(scope.ServiceProvider, 10, default);
        Assert.Null((await b.EtatAsync(services, avoir)).FluxId);
    }

    [Fact]
    public async Task En_litige_relance_suspendue_puis_levee_a_Approuvee()
    {
        if (Connexion() is not { } connexion) return;
        await using var b = new Base(connexion);
        if (!await SchemaAsync(b) || await b.Scalaire("SELECT to_regclass('relance_suspension')::text") is null) return;
        var horloge = new Horloge();
        await using var services = EnvoiFactureBtpTests.Services(connexion, Simulation(
            new(StatutCdv.Deposee, EmetteurStatut.PaE),
            new(StatutCdv.EnLitige, EmetteurStatut.Acheteur, Motif(StatutCdv.EnLitige, EmetteurStatut.Acheteur)),
            new(StatutCdv.Approuvee, EmetteurStatut.Acheteur)), horloge);
        var client = await b.PreparerAsync(services);
        var (ent, _) = await b.EmettreAsync(services, client, "Essai lot 25 litige");
        async Task<long> Suspensions() => (long)(await b.Scalaire(
            "SELECT count(*) FROM relance_suspension WHERE rsu_ent_id = @e AND rsu_motif = @m AND rsu_cree_par = @a",
            ("e", ent), ("m", MotifSuspension.Litige), ("a", RejetFactureBtp.AuteurSuspension)))!;

        // Déposée puis En litige : relance suspendue sans fin ; la pièce garde son statut, aucun avoir proposé.
        await Base.ReleverAsync(services, horloge, 2);
        Assert.Equal(StatutCdv.EnLitige, (await b.EtatAsync(services, ent)).Statut);
        Assert.Equal(1L, await Suspensions());
        Assert.Equal(new DateOnly(9999, 12, 31), await b.Scalaire("SELECT rsu_jusqu_au FROM relance_suspension WHERE rsu_ent_id = @e", ("e", ent)));
        Assert.Equal("ENVOYE", await b.StatutDocument(ent));
        Assert.False((await b.EtatAsync(services, ent)).Annulation!.Proposee);
        // Un second litige ne double pas la suspension ; une suspension saisie par l'utilisateur n'est jamais levée.
        using (var scope = services.CreateScope())
            await RejetFactureBtp.RelanceAsync(scope.ServiceProvider.GetRequiredService<LogiBtpContext>(), ent, StatutCdv.EnLitige, null, default);
        Assert.Equal(1L, await Suspensions());
        await b.Scalaire("INSERT INTO relance_suspension (rsu_ent_id, rsu_jusqu_au, rsu_motif, rsu_cree_par) VALUES (@e, current_date + 30, 'PROMESSE', 'admin.test')", ("e", ent));

        // Approuvée : suspension du litige levée, celle de l'utilisateur gardée.
        await Base.ReleverAsync(services, horloge, 1);
        Assert.Equal(0L, await Suspensions());
        Assert.Equal(1L, await b.Scalaire("SELECT count(*) FROM relance_suspension WHERE rsu_ent_id = @e", ("e", ent)));
    }
}
