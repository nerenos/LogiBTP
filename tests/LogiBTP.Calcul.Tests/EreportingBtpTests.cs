using LogiBTP.Api.Btp;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// E-reporting (plans/facturation-electronique.md, lot 28 ; Q20) : règles sans base (cible, catégorie TT-81, ventes d'une
/// facture B2C, identifiant étranger, état d'une période) ; sur la base jetable (LOGIBTP_TEST_PG_JETABLE, db/304) et la
/// plateforme simulée : période de démonstration B2C (services et biens) et internationale, transactions et paiements,
/// envoyées en un envoi par sous-flux (UNIQUE) puis en plusieurs envois par jour (PLUSIEURS), acceptées ; correction
/// (transmissions RE) ; rejet de la plateforme puis relance acceptée ; période en cours refusée.
/// </summary>
[Collection(EnvoiFactureBtpTests.CollectionBase)]
public class EreportingBtpTests
{
    // ---------------------------------------------------------------- règles sans base

    [Theory]
    [InlineData("B2C", "FR", true, CiblesEreporting.B2C)]
    [InlineData("B2B", "FR", false, CiblesEreporting.B2C)]
    [InlineData(null, "FR", false, CiblesEreporting.B2C)]
    [InlineData("INTERNATIONAL", "FR", true, CiblesEreporting.International)]
    [InlineData("B2B", "DE", true, CiblesEreporting.International)]
    [InlineData("B2C", "DE", true, CiblesEreporting.B2C)]
    [InlineData("B2B", "FR", true, null)]
    [InlineData(null, null, null, null)]
    [InlineData("B2G", "FR", false, null)]
    public void Cible_particulier_non_assujetti_ou_international(string? type, string? pays, bool? assujetti, string? attendu) =>
        Assert.Equal(attendu, EreportingBtp.Cible(type, pays, assujetti));

    [Theory]
    [InlineData("S1", "S", CategorieTransactions.Services)]
    [InlineData("M1", "S", CategorieTransactions.Services)]
    [InlineData("B1", "S", CategorieTransactions.Biens)]
    [InlineData("B1", "Z", CategorieTransactions.Biens)]
    [InlineData("S1", "O", CategorieTransactions.NonTaxables)]
    [InlineData("B1", "G", CategorieTransactions.NonTaxables)]
    [InlineData("S1", "K", CategorieTransactions.NonTaxables)]
    public void Categorie_des_transactions(string cadre, string categorie, string attendu) =>
        Assert.Equal(attendu, EreportingBtp.CategorieDe(cadre, categorie));

    private static Facture Facture(string type, string cadre, string? exigibilite, params DetailTva[] tva) => new()
    {
        Numero = "F-1", DateEmission = new DateOnly(2026, 9, 3), TypeFacture = type, CadreFacturation = cadre, CodeExigibiliteTva = exigibilite,
        Vendeur = new Partie { RaisonSociale = "V" }, Acheteur = new Partie { RaisonSociale = "A" }, Totaux = new Totaux { TotalLignes = 0, TotalHt = 0, TotalTtc = 0, NetAPayer = 0 },
        DetailsTva = tva,
    };

    private static DetailTva Tva(decimal b, decimal m, string c, decimal t) => new() { Base = b, Montant = m, Categorie = c, Taux = t };

    [Fact]
    public void Ventes_d_une_facture_b2c_par_categorie_et_taux_avoir_en_negatif()
    {
        var v = EreportingBtp.VentesDe(Facture(TypeFacture.Facture, "S1", CodeExigibiliteTva.DatePaiement,
            Tva(150, 30, "S", 20), Tva(100, 10, "S", 10), Tva(40, 0, "O", 0)));
        Assert.Equal(2, v.Count);
        Assert.Equal((CategorieTransactions.Services, (string?)null), (v[0].Categorie, v[0].CodeExigibiliteTva));
        Assert.Equal([new VentilationAgregee(10, 100, 10), new VentilationAgregee(20, 150, 30)], v[0].Ventilation);
        Assert.Equal(CategorieTransactions.NonTaxables, v[1].Categorie);

        var avoir = Assert.Single(EreportingBtp.VentesDe(Facture(TypeFacture.Avoir, "B1", CodeExigibiliteTva.DateFacture, Tva(80, 16, "S", 20))));
        Assert.Equal((CategorieTransactions.Biens, CodeExigibiliteTva.DateFacture), (avoir.Categorie, avoir.CodeExigibiliteTva));
        Assert.Equal([new VentilationAgregee(20, -80, -16)], avoir.Ventilation);
    }

    [Theory]
    [InlineData("DE", null, "DE 123456789", "DE123456789", SchemaIdentifiant.UeHorsFrance)]
    [InlineData("CH", "CHE-123.456.789", "CHE123", "CHE-123.456.789", SchemaIdentifiant.HorsUe)]
    [InlineData("US", "1234567890123456789012", null, "123456789012345678", SchemaIdentifiant.HorsUe)]
    [InlineData("BE", null, null, null, null)]
    public void Identifiant_d_une_entreprise_etrangere(string pays, string? identifiant, string? tva, string? valeur, string? schema)
    {
        var id = EreportingBtp.IdentifiantEtranger(pays, identifiant, tva);
        Assert.Equal((valeur, schema), (id?.Valeur, id?.Schema));
    }

    [Theory]
    [InlineData(false, new string?[0], EtatsPeriodeEreporting.Preparee)]
    [InlineData(true, new[] { EtatFlux.AEnvoyer, EtatFlux.Acquitte }, EtatsPeriodeEreporting.Envoyee)]
    [InlineData(true, new[] { EtatFlux.Acquitte, EtatFlux.Acquitte }, EtatsPeriodeEreporting.Acceptee)]
    [InlineData(true, new[] { EtatFlux.Acquitte, EtatFlux.Erreur }, EtatsPeriodeEreporting.Rejetee)]
    [InlineData(true, new[] { EtatFlux.Abandonne }, EtatsPeriodeEreporting.Rejetee)]
    public void Etat_d_une_periode_lu_des_flux(bool envoyee, string?[] flux, string attendu) =>
        Assert.Equal(attendu, EreportingBtp.Etat(envoyee, flux));

    [Fact]
    public void Envoi_possible_periode_terminee_sans_ecart()
    {
        var fin = new DateOnly(2026, 9, 30);
        Assert.True(EreportingBtp.Envoyable(EtatsPeriodeEreporting.Preparee, fin, fin.AddDays(1), 0, 2));
        Assert.False(EreportingBtp.Envoyable(EtatsPeriodeEreporting.Preparee, fin, fin, 0, 2));
        Assert.False(EreportingBtp.Envoyable(EtatsPeriodeEreporting.Preparee, fin, fin.AddDays(1), 1, 2));
        Assert.False(EreportingBtp.Envoyable(EtatsPeriodeEreporting.Preparee, fin, fin.AddDays(1), 0, 0));
        Assert.False(EreportingBtp.Envoyable(EtatsPeriodeEreporting.Envoyee, fin, fin.AddDays(1), 0, 2));
        Assert.Equal(("X-1", "X-1-E2"), (EreportingBtp.IdSuivi("X-1", 1), EreportingBtp.IdSuivi("X-1", 2)));
    }

    // ---------------------------------------------------------------- base jetable et plateforme simulée

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

        public async Task PreparerAsync(ServiceProvider services, string decoupage)
        {
            await Scalaire("UPDATE module_societe SET mod_actif = TRUE WHERE mod_code = 'facture_electronique'");
            await Scalaire("UPDATE facture_electronique_emission_option SET feo_automatique = TRUE");
            await Scalaire("UPDATE facture_electronique_ereporting_option SET ero_regime = 'SIMPLIFIE', ero_matricule = '9998'");
            using var scope = services.CreateScope();
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            var p = await fe.Parametres(default);
            await fe.EnregistrerParametres(p with
            {
                Connecteur = ConnecteurFe.Simule, Actif = true, AdresseFlux = null, ConnexionOauth = null, StatutsNonEnvoyes = [], DecoupageEreporting = decoupage,
            }, Admin, default);
            await new FileFlux(fe).TraiterAsync(100, default);
            await new ReleveFlux(fe).ReleverAsync(true, null, default);
        }

        /// <summary>Mois passé sans pièce valable (base jetable rejouée) : début du mois.</summary>
        public async Task<DateOnly> MoisLibreAsync()
        {
            var hasard = new Random();
            for (var i = 0; i < 50; i++)
            {
                var debut = new DateOnly(2001 + hasard.Next(0, 20), 1 + hasard.Next(0, 12), 1);
                var n = (long)(await Scalaire("""
                    SELECT count(*) FROM document d JOIN v_document_valable v ON v.ent_id = d.ent_id WHERE d.ent_date BETWEEN @d AND (@d + interval '1 month' - interval '1 day')::date
                    """, ("d", debut)))!;
                if (n == 0)
                {
                    await Scalaire("DELETE FROM ereporting_periode WHERE erp_debut = @d", ("d", debut));
                    return debut;
                }
            }
            throw new InvalidOperationException("Aucun mois libre");
        }

        public async Task<long> TiersAsync(string nom, string type, string pays, string? tva) =>
            (long)(await Scalaire("""
                INSERT INTO personne (per_raison_sociale, per_niv_code, per_pays, per_fe_type, per_tva_intra, per_assujetti_tva)
                VALUES (@n, @niv, @p, @t, @v, @a) RETURNING per_id
                """, ("n", nom), ("niv", type == "B2C" ? "PARTICULIER" : "SOCIETE"), ("p", pays), ("t", type), ("v", (object?)tva ?? DBNull.Value), ("a", type != "B2C")))!;

        /// <summary>Facture à deux taux (150 HT à 20 %, 100 HT à 10 %) validée aujourd'hui puis datée du jour voulu ; nature des lignes S ou B.</summary>
        public async Task<long> FactureAsync(ServiceProvider services, long tiers, DateOnly date, string nature, string libelle = "Travaux")
        {
            var ent = (long)(await Scalaire("""
                WITH d AS (INSERT INTO document (ent_tyd_id, ent_date, ent_std_id, ent_tiers_id, ent_cree_par, ent_total_ht, ent_total_tva,
                                                 ent_total_ttc, ent_net_a_payer, ent_cpa_code, ent_mode_reglement, ent_objet, ent_fe_nature)
                    SELECT t.tyd_id, current_date, (SELECT std_id FROM statut_document WHERE std_code = 'BROUILLON' AND std_tyd_id = t.tyd_id),
                           @tiers, 'test', 250, 40, 290, 290, '30J', 'CHEQUE', 'Essai lot 28 e-reporting', @nature
                    FROM type_document t WHERE t.tyd_code = 'V_FACTURE' RETURNING ent_id),
                l AS (INSERT INTO document_ligne (lig_ent_id, lig_ordre, lig_tyl_id, lig_libelle_html, lig_libelle_brut, lig_qte, lig_qte_vendue, lig_pv,
                                                  lig_pv_remise, lig_montant_ht, lig_tva_id, lig_taux_tva, lig_type_prix, lig_unt_code, lig_pv_fixe, lig_nat_id)
                    SELECT ent_id, v.ordre, 3, v.lib, v.lib, 1, 1, v.ht, v.ht, v.ht, v.tva, v.taux, 'V', 'u', TRUE, (SELECT nat_id FROM nature_element ORDER BY nat_id LIMIT 1)
                    FROM d, (VALUES (1, @libelle, 150, 1, 20), (2, 'Rénovation', 100, 2, 10)) AS v(ordre, lib, ht, tva, taux) RETURNING lig_ent_id),
                t AS (INSERT INTO document_tva (tva_ent_id, tva_ttv_id, tva_code, tva_taux, tva_categorie, tva_base_ht, tva_montant, tva_montant_annulation, tva_montant_net)
                    SELECT DISTINCT d.ent_id, v.ttv, v.code, v.taux, 'N', v.base, v.tva, 0, v.tva FROM d,
                           (VALUES (1, 'T20', 20, 150, 30), (2, 'T10', 10, 100, 10)) AS v(ttv, code, taux, base, tva) RETURNING tva_ent_id)
                SELECT DISTINCT tva_ent_id FROM t
                """, ("tiers", tiers), ("nature", nature), ("libelle", libelle)))!;
            using var scope = services.CreateScope();
            var documents = scope.ServiceProvider.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
            var version = (int)(await Scalaire("SELECT ent_version FROM document WHERE ent_id = @e", ("e", ent)))!;
            await documents.Valider(ent, new DemandeVersion { EntVersion = version }, Admin, default);
            await Scalaire("UPDATE document SET ent_date = @d WHERE ent_id = @e", ("d", date), ("e", ent));
            return ent;
        }

        public async Task ReglerAsync(long tiers, long ent, DateOnly date, decimal montant) =>
            await Scalaire("""
                WITH r AS (INSERT INTO reglement (reg_tiers_id, reg_sens, reg_date, reg_mode, reg_montant, reg_cree_par)
                           VALUES (@t, 'E', @d, 'VIREMENT', @m, 'test') RETURNING reg_id)
                INSERT INTO pointage (poi_reg_id, poi_echeance_id, poi_montant)
                SELECT reg_id, (SELECT ech_id FROM document_echeance WHERE ech_ent_id = @e ORDER BY ech_rang LIMIT 1), @m FROM r
                """, ("t", tiers), ("d", date), ("m", montant), ("e", ent));
    }

    private static async Task<T> Portee<T>(ServiceProvider services, Func<IServiceProvider, Task<T>> f)
    {
        using var scope = services.CreateScope();
        return await f(scope.ServiceProvider);
    }

    /// <summary>Dépôt des flux en file puis relève des accusés.</summary>
    private static async Task DeposerAsync(ServiceProvider services)
    {
        using var scope = services.CreateScope();
        var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
        await new FileFlux(fe).TraiterAsync(100, default);
        await new ReleveFlux(fe).ReleverAsync(true, null, default);
    }

    private static Task<PeriodeEreportingDto> PreparerAsync(ServiceProvider services, Base b, string nature, DateOnly jour) =>
        Portee(services, sp => EreportingBtp.PreparerAsync(sp, new DemandePreparationEreporting(nature, jour), b.Admin, default));

    private static async Task<PeriodeEreportingDto> EnvoyerAsync(ServiceProvider services, Base b, PeriodeEreportingDto p)
    {
        Assert.True(p.Envoyable, string.Join(" ; ", p.Ecarts.Select(e => $"{e.SousFlux} {e.Regle} {e.Donnee}")));
        var envoyee = await Portee(services, sp => EreportingBtp.EnvoyerAsync(sp, p.Id, b.Admin, default));
        Assert.Equal(EtatsPeriodeEreporting.Envoyee, envoyee.Etat);
        Assert.All(envoyee.Envois, e => Assert.NotNull(e.FluxId));
        await DeposerAsync(services);
        return await Portee(services, sp => EreportingBtp.PeriodeAsync(sp, p.Id, false, default));
    }

    private static async Task<string> XmlAsync(Base b, long envoi) =>
        System.Text.Encoding.UTF8.GetString((byte[])(await b.Scalaire("SELECT ere_contenu FROM ereporting_envoi WHERE ere_id = @e", ("e", envoi)))!);

    [Fact]
    public async Task Periodes_b2c_et_internationale_envoyees_en_un_envoi_par_sous_flux_puis_corrigees()
    {
        if (Connexion() is not { } connexion) return;
        await using var b = new Base(connexion);
        if (await b.Scalaire("SELECT to_regclass('ereporting_periode')::text") is null) return;
        await using var services = EnvoiFactureBtpTests.Services(connexion, new OptionsPlateformeSimulee { DelaiAccuse = TimeSpan.Zero });
        await b.PreparerAsync(services, DecoupageEreporting.Unique);
        var mois = await b.MoisLibreAsync();
        var particulier = await b.TiersAsync("Particulier lot 28", "B2C", "FR", null);
        var etranger = await b.TiersAsync("Kunde GmbH lot 28", "INTERNATIONAL", "DE", "DE123456789");
        var f1 = await b.FactureAsync(services, particulier, mois.AddDays(2), NaturesFe.Services);
        await b.FactureAsync(services, particulier, mois.AddDays(4), NaturesFe.Biens);
        var f3 = await b.FactureAsync(services, etranger, mois.AddDays(4), NaturesFe.Services);
        await b.ReglerAsync(particulier, f1, mois.AddDays(7), 100m);
        await b.ReglerAsync(etranger, f3, mois.AddDays(8), 290m);

        // Transactions : 10.1 (la facture internationale) et 10.3 (deux jours de ventes B2C) en un envoi chacun.
        var t = await PreparerAsync(services, b, NaturesPeriodeEreporting.Transactions, mois.AddDays(10));
        Assert.Equal((mois, mois.AddMonths(1).AddDays(-1), 0, EtatsPeriodeEreporting.Preparee), (t.Debut, t.Fin, t.Correction, t.Etat));
        Assert.Empty(t.Ecarts);
        Assert.Equal((2, 1, 750m, 120m), (t.Resume.VentesB2C, t.Resume.FacturesInternationales, t.Resume.TotalHt, t.Resume.TotalTva));
        Assert.Equal([(SousFluxEreporting.TransactionsUnitaires, 1), (SousFluxEreporting.TransactionsAgregees, 2)],
            t.Envois.Select(e => (e.SousFlux, e.Elements)).ToList());
        Assert.All(t.Envois, e => Assert.Equal(TypeTransmission.Initiale, e.Type));
        Assert.Equal(TypeFlux.TransactionsAgregees, t.Envois[1].TypeFlux);
        var agrege = await XmlAsync(b, t.Envois[1].Id);
        Assert.Contains("TPS1", agrege);
        Assert.Contains("TLB1", agrege);
        Assert.Contains("DE123456789", await XmlAsync(b, t.Envois[0].Id));
        // Préparée de nouveau : remplacée, même contenu.
        t = await PreparerAsync(services, b, NaturesPeriodeEreporting.Transactions, mois);
        Assert.Equal(2, t.Envois.Count);
        t = await EnvoyerAsync(services, b, t);
        Assert.Equal(EtatsPeriodeEreporting.Acceptee, t.Etat);
        Assert.True(t.Corrigeable);
        await Assert.ThrowsAsync<ExceptionMetier>(() => PreparerAsync(services, b, NaturesPeriodeEreporting.Transactions, mois));
        var chronologie = await Portee(services, sp => sp.GetRequiredService<ServiceFactureElectronique>()
            .Chronologie(null, TypesElementFe.PeriodeEreporting, t.Id.ToString(System.Globalization.CultureInfo.InvariantCulture), default));
        Assert.Contains(chronologie, e => e.Type == EvenementFe.Production);
        // Archivage (lot 29, Q21) : chaque transmission envoyée rangée en GED de la période (élément EREPORTING, db/305),
        // catégorie facture_electronique (rétention de 10 ans), étape ENVOI, au coffre.
        var idPeriode = t.Id.ToString(System.Globalization.CultureInfo.InvariantCulture);
        foreach (var e in t.Envois)
        {
            var ged = (long)(await b.Scalaire("SELECT ffl_ged_original_id FROM fe_flux WHERE ffl_id = @f", ("f", e.FluxId!.Value)))!;
            Assert.Equal((TypesElementFe.PeriodeEreporting, idPeriode, CategoriesGed.FactureElectronique, true),
                ((string)(await b.Scalaire("SELECT dge_type_element FROM document_ged WHERE dge_id = @g", ("g", ged)))!,
                 (string)(await b.Scalaire("SELECT dge_id_element FROM document_ged WHERE dge_id = @g", ("g", ged)))!,
                 (string)(await b.Scalaire("SELECT dge_categorie FROM document_ged WHERE dge_id = @g", ("g", ged)))!,
                 (bool)(await b.Scalaire("SELECT dge_coffre FROM document_ged WHERE dge_id = @g", ("g", ged)))!));
            Assert.Equal(EtapesGed.Envoi, await b.Scalaire("SELECT vge_etape FROM version_ged WHERE vge_document = @g ORDER BY vge_numero DESC LIMIT 1", ("g", ged)));
        }
        Assert.Equal(120, await b.Scalaire("SELECT rrg_duree_conservation_mois FROM regle_retention_ged WHERE rrg_categorie = @c ORDER BY rrg_id LIMIT 1",
            ("c", CategoriesGed.FactureElectronique)));

        // Paiements : 10.2 (encaissement de la facture internationale) et 10.4 (encaissement B2C), répartis par taux.
        var p = await PreparerAsync(services, b, NaturesPeriodeEreporting.Paiements, mois);
        Assert.Empty(p.Ecarts);
        Assert.Equal((1, 1, 390m), (p.Resume.EncaissementsB2C, p.Resume.EncaissementsInternationaux, p.Resume.TotalEncaisse));
        Assert.Equal([SousFluxEreporting.PaiementsUnitaires, SousFluxEreporting.PaiementsAgreges], p.Envois.Select(e => e.SousFlux).ToList());
        Assert.Contains("62.07", await XmlAsync(b, p.Envois[1].Id));
        p = await EnvoyerAsync(services, b, p);
        Assert.Equal(EtatsPeriodeEreporting.Acceptee, p.Etat);

        // Correction : transmissions rectificatives (RE) de la même période, identifiants « -RE1 ».
        var c = await Portee(services, sp => EreportingBtp.CorrigerAsync(sp, t.Id, b.Admin, default));
        Assert.Equal((1, EtatsPeriodeEreporting.Preparee), (c.Correction, c.Etat));
        Assert.All(c.Envois.Where(e => e.Correction == 1), e => Assert.Equal((TypeTransmission.Rectificative, true), (e.Type, e.Identifiant.EndsWith("-RE1", StringComparison.Ordinal))));
        c = await EnvoyerAsync(services, b, c);
        Assert.Equal(EtatsPeriodeEreporting.Acceptee, c.Etat);
        Assert.Equal(4, (await Portee(services, sp => EreportingBtp.PeriodeAsync(sp, t.Id, true, default))).Envois.Count);
    }

    [Fact]
    public async Task Periode_envoyee_en_plusieurs_envois_par_jour_rejet_puis_relance()
    {
        if (Connexion() is not { } connexion) return;
        await using var b = new Base(connexion);
        if (await b.Scalaire("SELECT to_regclass('ereporting_periode')::text") is null) return;
        await using var services = EnvoiFactureBtpTests.Services(connexion, new OptionsPlateformeSimulee { DelaiAccuse = TimeSpan.Zero });
        await b.PreparerAsync(services, DecoupageEreporting.Plusieurs);
        try
        {
            var mois = await b.MoisLibreAsync();
            var particulier = await b.TiersAsync("Particulier lot 28 bis", "B2C", "FR", null);
            var etranger = await b.TiersAsync("Client Suisse lot 28", "INTERNATIONAL", "CH", "CHE123456789");
            var f1 = await b.FactureAsync(services, particulier, mois.AddDays(2), NaturesFe.Services);
            var f2 = await b.FactureAsync(services, particulier, mois.AddDays(5), NaturesFe.Services);
            var f3 = await b.FactureAsync(services, etranger, mois.AddDays(5), NaturesFe.Services, "Travaux REJET");
            await b.ReglerAsync(particulier, f2, mois.AddDays(6), 50m);
            await b.ReglerAsync(particulier, f1, mois.AddDays(9), 50m);

            // Transactions : 10.1 (un jour) et 10.3 en un envoi par jour de vente.
            var t = await PreparerAsync(services, b, NaturesPeriodeEreporting.Transactions, mois);
            Assert.Equal([(SousFluxEreporting.TransactionsUnitaires, mois.AddDays(5)), (SousFluxEreporting.TransactionsAgregees, mois.AddDays(2)),
                (SousFluxEreporting.TransactionsAgregees, mois.AddDays(5))], t.Envois.Select(e => (e.SousFlux, e.Jour!.Value)).ToList());
            Assert.Equal(["001", "001", "002"], t.Envois.Select(e => e.Identifiant[^3..]).ToList());

            // Le marqueur de la plateforme simulée dans la facture internationale : 10.1 refusé, période rejetée.
            t = await EnvoyerAsync(services, b, t);
            Assert.Equal((EtatsPeriodeEreporting.Rejetee, true), (t.Etat, t.Relancable));
            var x = await Assert.ThrowsAsync<ExceptionMetier>(() => Portee(services, sp => EreportingBtp.CorrigerAsync(sp, t.Id, b.Admin, default)));
            Assert.Equal(ErreursEreporting.Etat, x.Code);

            // Libellé corrigé, relance : essai 2 de la transmission initiale, accepté.
            await b.Scalaire("UPDATE document_ligne SET lig_libelle_brut = 'Travaux', lig_libelle_html = 'Travaux' WHERE lig_ent_id = @e", ("e", f3));
            var r = await Portee(services, sp => EreportingBtp.RelancerAsync(sp, t.Id, b.Admin, default));
            Assert.Equal((0, 2, EtatsPeriodeEreporting.Preparee), (r.Correction, r.Essai, r.Etat));
            r = await EnvoyerAsync(services, b, r);
            Assert.Equal(EtatsPeriodeEreporting.Acceptee, r.Etat);
            Assert.Equal(3, r.Envois.Count);

            // Paiements B2C : 10.4 en un envoi par jour d'encaissement.
            var p = await PreparerAsync(services, b, NaturesPeriodeEreporting.Paiements, mois);
            Assert.Equal([mois.AddDays(6), mois.AddDays(9)], p.Envois.Select(e => e.Jour!.Value).ToList());
            p = await EnvoyerAsync(services, b, p);
            Assert.Equal(EtatsPeriodeEreporting.Acceptee, p.Etat);

            // Période en cours : envoi refusé.
            await b.Scalaire("DELETE FROM ereporting_periode WHERE erp_debut = date_trunc('month', current_date)::date");
            var enCours = await PreparerAsync(services, b, NaturesPeriodeEreporting.Paiements, DateOnly.FromDateTime(DateTime.Today));
            Assert.False(enCours.Envoyable);
            var refus = await Assert.ThrowsAsync<ExceptionMetier>(() => Portee(services, sp => EreportingBtp.EnvoyerAsync(sp, enCours.Id, b.Admin, default)));
            Assert.Equal(ErreursEreporting.PeriodeEnCours, refus.Code);
            await b.Scalaire("DELETE FROM ereporting_periode WHERE erp_id = @p", ("p", enCours.Id));
        }
        finally
        {
            using var scope = services.CreateScope();
            var fe = scope.ServiceProvider.GetRequiredService<ServiceFactureElectronique>();
            await fe.EnregistrerParametres(await fe.Parametres(default) with { DecoupageEreporting = DecoupageEreporting.Unique }, b.Admin, default);
        }
    }
}
