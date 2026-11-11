using LogiBTP.Api.Btp;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Statut Encaissée (212) d'une facture émise (plans/facturation-electronique.md, lot 26 ; Q15, XP Z12-014 cas 26 et 34),
/// sur la base jetable (LOGIBTP_TEST_PG_JETABLE, manifeste chargé avec db/302) et la plateforme simulée : facture de
/// services à deux taux (180 TTC à 20 %, 110 TTC à 10 %) en situation de travaux, échéance nette et retenue de garantie ;
/// versement partiel, solde, puis retenue libérée → trois CDAR dont les montants par taux font le TTC de chaque taux ;
/// règlement supprimé après l'envoi → annulation d'encaissement (CDAR négatif) ; proposition écartée ; facture de biens
/// jamais proposée.
/// </summary>
[Collection(EnvoiFactureBtpTests.CollectionBase)]
public class StatutEncaisseeBtpTests
{
    private sealed class Horloge : TimeProvider
    {
        public DateTimeOffset Maintenant { get; set; } = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Maintenant;
    }

    private static string? Connexion()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_JETABLE");
        return string.IsNullOrEmpty(connexion) ? null : connexion;
    }

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
            await Scalaire("UPDATE personne SET per_fe_type = 'B2B', per_fe_dans_annuaire = TRUE, per_fe_format = 'CII' WHERE per_id = @p", ("p", client));
            return client;
        }

        /// <summary>Facture à deux taux validée et émise ; nature des lignes : services (S) ou biens (B, ent_fe_nature).</summary>
        public async Task<(long Ent, long Flux)> EmettreAsync(ServiceProvider services, long tiers, string objet, string nature)
        {
            var ent = (long)(await Scalaire("""
                WITH d AS (INSERT INTO document (ent_tyd_id, ent_date, ent_std_id, ent_tiers_id, ent_cree_par, ent_total_ht, ent_total_tva,
                                                 ent_total_ttc, ent_net_a_payer, ent_cpa_code, ent_mode_reglement, ent_objet, ent_fe_nature)
                    SELECT t.tyd_id, current_date, (SELECT std_id FROM statut_document WHERE std_code = 'BROUILLON' AND std_tyd_id = t.tyd_id),
                           @tiers, 'test', 250, 40, 290, 290, '30J', 'CHEQUE', @objet, @nature
                    FROM type_document t WHERE t.tyd_code = 'V_FACTURE' RETURNING ent_id),
                l AS (INSERT INTO document_ligne (lig_ent_id, lig_ordre, lig_tyl_id, lig_libelle_html, lig_libelle_brut, lig_qte, lig_qte_vendue, lig_pv,
                                                  lig_pv_remise, lig_montant_ht, lig_tva_id, lig_taux_tva, lig_type_prix, lig_unt_code, lig_pv_fixe, lig_nat_id)
                    SELECT ent_id, v.ordre, 3, v.lib, v.lib, 1, 1, v.ht, v.ht, v.ht, v.tva, v.taux, 'V', 'u', TRUE, (SELECT nat_id FROM nature_element ORDER BY nat_id LIMIT 1)
                    FROM d, (VALUES (1, 'Travaux', 150, 1, 20), (2, 'Rénovation', 100, 2, 10)) AS v(ordre, lib, ht, tva, taux) RETURNING lig_ent_id),
                t AS (INSERT INTO document_tva (tva_ent_id, tva_ttv_id, tva_code, tva_taux, tva_categorie, tva_base_ht, tva_montant, tva_montant_annulation, tva_montant_net)
                    SELECT DISTINCT d.ent_id, v.ttv, v.code, v.taux, 'N', v.base, v.tva, 0, v.tva FROM d,
                           (VALUES (1, 'T20', 20, 150, 30), (2, 'T10', 10, 100, 10)) AS v(ttv, code, taux, base, tva) RETURNING tva_ent_id)
                SELECT DISTINCT tva_ent_id FROM t
                """, ("tiers", tiers), ("objet", objet), ("nature", nature)))!;
            using var scope = services.CreateScope();
            var documents = scope.ServiceProvider.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
            var version = (int)(await Scalaire("SELECT ent_version FROM document WHERE ent_id = @e", ("e", ent)))!;
            await documents.Valider(ent, new DemandeVersion { EntVersion = version }, Admin, default);
            await EnvoiFactureBtp.TraiterAsync(scope.ServiceProvider, 10, default);
            var etat = await EnvoiFactureBtp.EtatAsync(scope.ServiceProvider.GetRequiredService<LogiBtpContext>(), ent, default);
            Assert.True(etat.Erreur is null, etat.Erreur);
            Assert.Equal(EtatsEmissionFe.Emise, etat.Etat);
            return (ent, etat.FluxId!.Value);
        }

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

        /// <summary>Règlement reçu du tiers pointé sur une échéance ; identifiant du règlement.</summary>
        public async Task<long> ReglerAsync(long tiers, long echeance, decimal montant) =>
            (long)(await Scalaire("""
                WITH r AS (INSERT INTO reglement (reg_tiers_id, reg_sens, reg_date, reg_mode, reg_montant, reg_cree_par)
                           VALUES (@t, 'E', current_date, 'VIREMENT', @m, 'test') RETURNING reg_id),
                     p AS (INSERT INTO pointage (poi_reg_id, poi_echeance_id, poi_montant) SELECT reg_id, @e, @m FROM r RETURNING poi_reg_id)
                SELECT poi_reg_id FROM p
                """, ("t", tiers), ("e", echeance), ("m", montant)))!;

        /// <summary>Montants par taux du CDAR envoyé pour un règlement (lu dans l'original du flux du CDAR).</summary>
        public async Task<Dictionary<decimal, decimal>> CdarAsync(long ent, long reg, decimal montant)
        {
            var flux = (long)(await Scalaire("""
                SELECT dfn_flux_id FROM document_fe_encaissement WHERE dfn_ent_id = @e AND dfn_reg_id = @r AND dfn_montant = @m AND dfn_etat = 'ENVOYE'
                """, ("e", ent), ("r", reg), ("m", montant)))!;
            var contenu = (byte[])(await Scalaire("SELECT ffi_contenu FROM fe_fichier WHERE ffi_ffl_id = @f AND ffi_document = 'Original'", ("f", flux)))!;
            var lu = Assert.Single(Cdar.StatutsLus(Cdar.Lire(contenu), SensFacture.Emise));
            Assert.Equal(StatutCdv.Encaissee, lu.Statut);
            Assert.Equal(EmetteurStatut.Vendeur, lu.Emetteur);
            return lu.Encaissements.ToDictionary(x => x.TauxTva, x => x.Montant);
        }
    }

    private static async Task<List<PropositionEncaisseeFe>> ListeAsync(ServiceProvider services, long ent)
    {
        using var scope = services.CreateScope();
        return await StatutEncaisseeBtp.ProposerAsync(scope.ServiceProvider, ent, default);
    }

    private static async Task<ResultatEncaisseeFe> ValiderAsync(ServiceProvider services, Base b, IEnumerable<PropositionEncaisseeFe> p, bool ecarter = false)
    {
        using var scope = services.CreateScope();
        return await StatutEncaisseeBtp.ValiderAsync(scope.ServiceProvider,
            new DemandeEncaisseeFe(p.Select(x => new ChoixEncaisseeFe(x.Cle, x.Montant)).ToList(), ecarter), b.Admin, default);
    }

    private static Dictionary<decimal, decimal> Taux(PropositionEncaisseeFe p) => p.Encaissements.ToDictionary(x => x.Taux, x => x.Montant);

    [Fact]
    public async Task Versements_partiels_et_retenue_d_une_situation_puis_annulation_d_encaissement()
    {
        if (Connexion() is not { } connexion) return;
        await using var b = new Base(connexion);
        if (await b.Scalaire("SELECT to_regclass('document_fe_encaissement')::text") is null) return;
        var horloge = new Horloge();
        await using var services = EnvoiFactureBtpTests.Services(connexion, new OptionsPlateformeSimulee
        {
            DelaiAccuse = TimeSpan.Zero, IntervalleStatuts = TimeSpan.FromMinutes(1), Statuts = [new(StatutCdv.Deposee, EmetteurStatut.PaE)],
        }, horloge);
        var client = await b.PreparerAsync(services);
        var (ent, _) = await b.EmettreAsync(services, client, "Essai lot 26 encaissée", NaturesFe.Services);
        // Situation : échéance nette (95 %) et retenue de garantie (5 %) libérée plus tard.
        await b.Scalaire("DELETE FROM document_echeance WHERE ech_ent_id = @e", ("e", ent));
        var nette = (long)(await b.Scalaire("INSERT INTO document_echeance (ech_ent_id, ech_rang, ech_date, ech_montant, ech_nature) VALUES (@e, 1, current_date + 30, 275.50, 'NORMALE') RETURNING ech_id", ("e", ent)))!;
        var retenue = (long)(await b.Scalaire("INSERT INTO document_echeance (ech_ent_id, ech_rang, ech_date, ech_montant, ech_nature) VALUES (@e, 2, current_date + 365, 14.50, 'RETENUE') RETURNING ech_id", ("e", ent)))!;

        // Avant Déposée : rien de posable, rien de proposé.
        var a = await b.ReglerAsync(client, nette, 100m);
        Assert.Empty(await ListeAsync(services, ent));
        await Base.ReleverAsync(services, horloge, 2);

        // Versement partiel : 100 réparti au prorata du TTC de chaque taux.
        var p1 = Assert.Single(await ListeAsync(services, ent));
        Assert.Equal((a, nette, 100m, false), (p1.RegId, p1.EchId, p1.Montant, p1.Annulation));
        Assert.Equal(new Dictionary<decimal, decimal> { [20m] = 62.07m, [10m] = 37.93m }, Taux(p1));
        Assert.Equal((1, 0), ((await ValiderAsync(services, b, [p1])).Envoyes, 0));
        Assert.Equal(new Dictionary<decimal, decimal> { [20m] = 62.07m, [10m] = 37.93m }, await b.CdarAsync(ent, a, 100m));
        Assert.Empty(await ListeAsync(services, ent));

        // Solde de l'échéance nette et retenue libérée : deux statuts, le total fait le TTC de chaque taux.
        var s = await b.ReglerAsync(client, nette, 175.50m);
        var r = await b.ReglerAsync(client, retenue, 14.50m);
        var liste = await ListeAsync(services, ent);
        Assert.Equal([(s, nette, 175.50m), (r, retenue, 14.50m)], liste.Select(x => (x.RegId, x.EchId, x.Montant)).ToList());
        var resultat = await ValiderAsync(services, b, liste);
        Assert.Equal((2, 0, 0, 0), (resultat.Envoyes, resultat.Ecartes, resultat.Perimees.Count, resultat.Erreurs.Count));
        var cdarSolde = await b.CdarAsync(ent, s, 175.50m);
        var cdarRetenue = await b.CdarAsync(ent, r, 14.50m);
        Assert.Equal(new Dictionary<decimal, decimal> { [20m] = 108.93m, [10m] = 66.57m }, cdarSolde);
        Assert.Equal(new Dictionary<decimal, decimal> { [20m] = 9.00m, [10m] = 5.50m }, cdarRetenue);
        Assert.Equal(180m, 62.07m + cdarSolde[20m] + cdarRetenue[20m]);
        Assert.Equal(110m, 37.93m + cdarSolde[10m] + cdarRetenue[10m]);

        // Proposition périmée : montant changé depuis la lecture.
        await b.Scalaire("DELETE FROM reglement WHERE reg_id = @r", ("r", s));
        var annulation = Assert.Single(await ListeAsync(services, ent));
        var perimee = await ValiderAsync(services, b, [annulation with { Montant = 1m }]);
        Assert.Equal([annulation.Cle], perimee.Perimees);

        // Règlement supprimé après l'envoi (cas 34) : annulation d'encaissement, CDAR négatif.
        Assert.Equal((s, -175.50m, true, true), (annulation.RegId, annulation.Montant, annulation.Annulation, annulation.ReglementSupprime));
        Assert.Equal(new Dictionary<decimal, decimal> { [20m] = -108.93m, [10m] = -66.57m }, Taux(annulation));
        Assert.Equal(1, (await ValiderAsync(services, b, [annulation])).Envoyes);
        Assert.Equal(new Dictionary<decimal, decimal> { [20m] = -108.93m, [10m] = -66.57m }, await b.CdarAsync(ent, s, -175.50m));

        // Nouveau règlement écarté : rien d'envoyé, plus proposé.
        var e = await b.ReglerAsync(client, nette, 175.50m);
        var ecartee = Assert.Single(await ListeAsync(services, ent));
        Assert.Equal((0, 1), ((await ValiderAsync(services, b, [ecartee], ecarter: true)) is var x ? (x.Envoyes, x.Ecartes) : default));
        Assert.Equal(EtatsEncaissementFe.Ecarte, await b.Scalaire("SELECT dfn_etat FROM document_fe_encaissement WHERE dfn_reg_id = @r", ("r", e)));
        Assert.Empty(await ListeAsync(services, ent));
        Assert.Equal(4L, await b.Scalaire("SELECT count(*) FROM fe_statut s JOIN document_fe_encaissement n ON n.dfn_fst_id = s.fst_id WHERE n.dfn_ent_id = @e AND s.fst_code = '212'", ("e", ent)));
    }

    [Fact]
    public async Task Facture_de_biens_jamais_proposee()
    {
        if (Connexion() is not { } connexion) return;
        await using var b = new Base(connexion);
        if (await b.Scalaire("SELECT to_regclass('document_fe_encaissement')::text") is null) return;
        var horloge = new Horloge();
        await using var services = EnvoiFactureBtpTests.Services(connexion, new OptionsPlateformeSimulee
        {
            DelaiAccuse = TimeSpan.Zero, IntervalleStatuts = TimeSpan.FromMinutes(1), Statuts = [new(StatutCdv.Deposee, EmetteurStatut.PaE)],
        }, horloge);
        var client = await b.PreparerAsync(services);
        var (ent, _) = await b.EmettreAsync(services, client, "Essai lot 26 biens", NaturesFe.Biens);
        await Base.ReleverAsync(services, horloge, 2);
        var echeance = (long)(await b.Scalaire("SELECT ech_id FROM document_echeance WHERE ech_ent_id = @e ORDER BY ech_rang LIMIT 1", ("e", ent)))!;
        await b.ReglerAsync(client, echeance, 50m);
        Assert.Empty(await ListeAsync(services, ent));
        Assert.Equal("B1", await b.Scalaire("SELECT dfe_cadre FROM document_fe_emission WHERE dfe_ent_id = @e", ("e", ent)));
    }
}
