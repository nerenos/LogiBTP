using LogiBTP.Domaine;
using LogiBTP.Api.Reprise;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Installation;
using LogiBTP.Socle.Testing;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Reprise MDE / OptimBTP de bout en bout (plan reprise-mde-optim, lot 2) : base LogiBTP neuve montée par le manifeste
/// (sans démonstration), bases sources fictives de tests/reprise. Variables : LOGIBTP_TEST_PG_ADMIN (création de bases),
/// LOGIBTP_TEST_MSSQL, LOGIBTP_TEST_MARIADB ; ignorés sans elles.
/// </summary>
public class RepriseBaseTests
{
    private static readonly string? Admin = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_ADMIN");

    private static string? Source(string source) => Environment.GetEnvironmentVariable(
        source == SourceReprise.Mde ? "LOGIBTP_TEST_MSSQL" : "LOGIBTP_TEST_MARIADB");

    /// <summary>Base LogiBTP neuve (manifeste sans démonstration), supprimée à la fin.</summary>
    private sealed class BaseNeuve : IAsyncDisposable
    {
        public required string Nom { get; init; }
        public required string Connexion { get; init; }

        public static async Task<BaseNeuve> CreerAsync(string admin)
        {
            var nom = "reprise_" + Guid.NewGuid().ToString("N")[..12];
            await using (var c = new NpgsqlConnection(admin))
            {
                await c.OpenAsync();
                await using var cmd = new NpgsqlCommand($"CREATE DATABASE {nom}", c); // nom généré, jamais saisi
                await cmd.ExecuteNonQueryAsync();
            }
            var chaine = new NpgsqlConnectionStringBuilder(admin) { Database = nom, Pooling = false }.ConnectionString;
            var racine = CasPartages.RacineDepot();
            var manifeste = ManifesteScripts.Lire(racine);
            await new BaseDonnees(TextWriter.Null).AppliquerAsync(chaine, racine, manifeste.Retenus(false), acceptees: EmpreintesAcceptees.Lire(racine));
            return new BaseNeuve { Nom = nom, Connexion = chaine };
        }

        public async Task<long> CompterAsync(string sql)
        {
            await using var c = new NpgsqlConnection(Connexion);
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand(sql, c);
            return Convert.ToInt64(await cmd.ExecuteScalarAsync());
        }

        public async Task<string?> TexteAsync(string sql)
        {
            await using var c = new NpgsqlConnection(Connexion);
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand(sql, c);
            return Convert.ToString(await cmd.ExecuteScalarAsync());
        }

        public async ValueTask DisposeAsync()
        {
            NpgsqlConnection.ClearAllPools();
            await using var c = new NpgsqlConnection(Admin);
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS {Nom} WITH (FORCE)", c);
            await cmd.ExecuteNonQueryAsync();
        }
    }

    [Fact]
    public async Task Base_neuve_vide_cibles_lues_et_correspondances_par_defaut_valides()
    {
        if (Admin is null) return;
        await using var b = await BaseNeuve.CreerAsync(Admin);
        await using var c = new NpgsqlConnection(b.Connexion);
        await c.OpenAsync();
        Assert.True(await BaseCibleReprise.EstVideAsync(c, null, default));
        var cibles = await CiblesReprise.LireAsync(c, null, default);
        Assert.Contains("A_DEVIS", cibles[CorrespondancesReprise.Listes.TypeDocument]);
        Assert.Contains("SOUS_TOTAL", cibles[CorrespondancesReprise.Listes.TypeLigne]);
        Assert.Contains("salarie", cibles[CorrespondancesReprise.Listes.TypeFiche]);
        foreach (var source in new[] { SourceReprise.Mde, SourceReprise.Optim })
        {
            var erreurs = CorrespondancesReprise.ParDefaut(source).Valider(CorrespondancesReprise.TablesAttendues(source), cibles, source);
            Assert.True(erreurs.Count == 0, string.Join("\n", erreurs.Select(e => $"{e.Code} {e.Emplacement} {e.Valeur}")));
        }

        // Une donnée métier : la base n'est plus une cible de reprise.
        await using (var cmd = new NpgsqlCommand(
            "INSERT INTO personne (per_niv_code, per_raison_sociale) SELECT niv_code, 'ESSAI' FROM niveau_personne LIMIT 1", c))
            await cmd.ExecuteNonQueryAsync();
        Assert.False(await BaseCibleReprise.EstVideAsync(c, null, default));
        var refus = await Assert.ThrowsAsync<RepriseRefuseeException>(() => RepriseBase.ExecuterAsync(new DemandeReprise
        {
            Source = SourceReprise.Optim, ConnexionSource = "Server=invalide", ConnexionCible = b.Connexion,
        }, default));
        Assert.Equal(ErreurReprise.BaseNonVide, refus.Code);
        // Option VOLUME de MDE : surface ou volume seulement.
        var option = await Assert.ThrowsAsync<RepriseRefuseeException>(() => RepriseBase.ExecuterAsync(new DemandeReprise
        {
            Source = SourceReprise.Mde, ConnexionSource = "Server=invalide", ConnexionCible = b.Connexion, VolumeMde = "CUBE",
        }, default));
        Assert.Equal(ErreurReprise.OptionInvalide, option.Code);
    }

    [Theory]
    [InlineData(SourceReprise.Mde)]
    [InlineData(SourceReprise.Optim)]
    public async Task Simulation_puis_reprise_reelle_sur_une_base_neuve(string source)
    {
        if (Admin is null || Source(source) is not { } connexion) return;
        await using var b = await BaseNeuve.CreerAsync(Admin);
        var demande = new DemandeReprise
        {
            Source = source, ConnexionSource = connexion, ConnexionCible = b.Connexion,
            Societes = source == SourceReprise.Optim ? ["1", "2"] : [], Auteur = "test",
            StockageGed = Path.Combine(Path.GetTempPath(), "reprise-ged-" + Guid.NewGuid().ToString("N")),
        };
        var simulation = await RepriseBase.ExecuterAsync(demande, default);
        // Simulation : rien sur le disque.
        Assert.False(Directory.Exists(demande.StockageGed));
        Assert.True(simulation.Rapport.Etat == EtatReprise.Terminee, string.Join("\n", simulation.Rapport.Anomalies.Select(x => $"{x.Niveau} {x.Code} {x.Emplacement} {x.Message}")));
        Assert.True(simulation.Rapport.Simulation);
        Assert.True(simulation.Rapport.TablesSource.Count > 150);
        Assert.Equal(3, simulation.Rapport.TablesSource[source == SourceReprise.Mde ? "PMECLIENT" : "ref_societe"]);
        Assert.Contains("Tables de la base source", simulation.Rapport.EnMarkdown());
        Assert.DoesNotContain(simulation.Rapport.Anomalies, a => a.Niveau == NiveauAnomalie.Bloquant);
        Assert.Equal(0L, await b.CompterAsync("SELECT count(*) FROM personne"));

        var reelle = await RepriseBase.ExecuterAsync(demande with { Simulation = false }, default);
        Assert.Equal(EtatReprise.Terminee, reelle.Rapport.Etat);
        Assert.Equal(2L, await b.CompterAsync("SELECT count(*) FROM import_reprise"));
        Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM import_reprise WHERE irp_simulation AND irp_etat = 'TERMINEE'"));
        await VerifierReferentielsAsync(b, source, reelle.Rapport);
        await VerifierChampsAsync(b, source, reelle.Rapport);
        await VerifierAnnuaireAsync(b, source, reelle.Rapport);
        await VerifierRessourcesAsync(b, source, reelle.Rapport);
        await VerifierBibliothequeAsync(b, source, reelle.Rapport);
        await VerifierStructureAsync(b, source, reelle.Rapport);
        await VerifierPiecesVenteAsync(b, source, reelle.Rapport);
        await VerifierAvancementAsync(b, source, reelle.Rapport);
        await VerifierAchatsAsync(b, source, reelle.Rapport);
        await VerifierReglementsAsync(b, source, reelle.Rapport);
        await VerifierExploitationAsync(b, source, reelle.Rapport);
        await VerifierStockAsync(b, source, reelle.Rapport);
        await VerifierGedAsync(b, source, reelle.Rapport, demande.StockageGed!);

        // Correspondances fournies invalides : refus avant toute lecture.
        var refus = await Assert.ThrowsAsync<RepriseRefuseeException>(() => RepriseBase.ExecuterAsync(
            demande with { Correspondances = $$"""{ "source": "{{source}}", "version": 1, "tables": {} }""" }, default));
        Assert.Equal(ErreurReprise.CorrespondancesInvalides, refus.Code);
    }

    /// <summary>Lot 16 : fichiers déposés une fois par empreinte, documents rattachés à leurs fiches, répertoires, notes du CRM.</summary>
    private static async Task VerifierGedAsync(BaseNeuve b, string source, RapportReprise r, string stockage)
    {
        async Task<long> Compter(string sql) => await b.CompterAsync(sql);
        // Toute version pointe un contenu présent sur le disque, rangé par son empreinte.
        var chemins = new List<string>();
        await using (var c = new NpgsqlConnection(b.Connexion))
        {
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand("SELECT DISTINCT g.cge_chemin FROM version_ged v JOIN contenu_ged g ON g.cge_empreinte = v.vge_empreinte", c);
            await using var lr = await cmd.ExecuteReaderAsync();
            while (await lr.ReadAsync()) chemins.Add(lr.GetString(0));
        }
        Assert.All(chemins, ch => Assert.True(File.Exists(Path.Combine(stockage, ch)), ch));
        Assert.Equal(0L, await Compter("SELECT count(*) FROM document_ged WHERE dge_nb_versions <> 1"));
        async Task<long> Lies(string type, string table, string colonne, string code) => await Compter($"""
            SELECT count(*) FROM document_ged d JOIN {table} x ON d.dge_id_element = x.{colonne}::text WHERE d.dge_type_element = '{type}' AND x.{code}
            """);
        async Task<long> Notes(string nature, string etat) => await Compter($"SELECT count(*) FROM crm_note n JOIN crm_note_lien l ON l.nli_not_id = n.not_id WHERE n.not_nature = '{nature}' AND n.not_etat = '{etat}'");
        if (source == SourceReprise.Mde)
        {
            Assert.Single(chemins);
            Assert.Equal(2L, await Compter("SELECT count(*) FROM document_ged"));
            Assert.Equal(1L, await Lies("element", "element", "ele_id", "ele_code = 'CIM35' AND x.ele_image_ged = d.dge_id"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM individu i JOIN salarie s ON s.sal_ind_id = i.ind_id WHERE s.sal_code = 'SAL01' AND i.ind_image_ged IS NOT NULL"));
            Assert.Equal((2, 2, 1), Volume(r, GedMde.Images));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM crm_note n JOIN crm_note_lien l ON l.nli_not_id = n.not_id JOIN affaire a ON l.nli_id_element = a.aff_id::text WHERE l.nli_type_element = 'affaire' AND a.aff_code = 'AF001' AND n.not_objet = 'Relance architecte' AND n.not_nature = 'ACTION' AND n.not_etat = 'TERMINE'"));
            Assert.Equal(1L, await Notes("ACTION", "A_FAIRE"));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.GedNonReprise && a.Emplacement == "PMEAFFACTION 3");
            Assert.Equal((3, 2, 1), Volume(r, GedMde.Actions));
        }
        else
        {
            Assert.Equal(2, chemins.Count);
            Assert.Equal(4L, await Compter("SELECT count(*) FROM document_ged"));
            Assert.Equal(1L, await Lies("chantier", "chantier", "cha_id", "cha_code = 'C24-001'"));
            Assert.Equal(1L, await Lies("affaire", "affaire", "aff_id", "aff_code = '24-001'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM document_ged WHERE dge_type_element = 'personne'"));
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM document_ged d JOIN repertoire_ged r4 ON r4.rge_id = d.dge_repertoire_id AND r4.rge_nom = '2024'
                JOIN repertoire_ged r3 ON r3.rge_id = r4.rge_parent_id AND r3.rge_nom = 'Archives'
                JOIN repertoire_ged r2 ON r2.rge_id = r3.rge_parent_id AND r2.rge_nom = 'Plans'
                JOIN repertoire_ged r1 ON r1.rge_id = r2.rge_parent_id AND r1.rge_nom = 'Reprise' AND r1.rge_parent_id IS NULL
                WHERE d.dge_type_element IS NULL
                """));
            Assert.Equal(3L, await Compter("SELECT count(*) FROM version_ged WHERE vge_type_mime = 'application/pdf' AND vge_nom_fichier LIKE '%.pdf'"));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.GedNonReprise && a.Emplacement == "ged_document 4");
            Assert.Equal((5, 3, 2), Volume(r, GedOptim.Documents));
            Assert.Equal(1L, await Notes("MESSAGE", "MEMO"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM crm_note WHERE not_nature = 'TACHE' AND not_etat = 'TERMINE' AND not_objet = 'Envoyer le DOE' AND not_echeance IS NOT NULL"));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.GedNonReprise && a.Emplacement == "msg_message_observation 3");
            Assert.Equal((3, 2, 1), Volume(r, GedOptim.Messages));
        }
        Directory.Delete(stockage, recursive: true);
    }

    /// <summary>Lot 14 : inventaire d'ouverture par article et lieu, consommations hors pièce en coût du chantier, heures de matériel.</summary>
    private static async Task VerifierStockAsync(BaseNeuve b, string source, RapportReprise r)
    {
        async Task<decimal> Somme(string sql) => decimal.Parse(await b.TexteAsync(sql) ?? "0", System.Globalization.CultureInfo.InvariantCulture);
        async Task<decimal> Stock(string article, string lieu) => await Somme($"""
            SELECT coalesce(sum(k.cpt_quantite), 0) FROM stk_comptage k JOIN element e ON e.ele_id = k.cpt_ele_id JOIN chantier c ON c.cha_id = k.cpt_lieu_id
            WHERE e.ele_code = '{article}' AND c.cha_code = '{lieu}'
            """);
        async Task<decimal> CoutStock(string chantier, string mois) => await Somme($"""
            SELECT coalesce(sum(v.montant), 0) FROM v_cout_chantier v JOIN chantier c ON c.cha_id = v.chantier_id
            WHERE c.cha_code = '{chantier}' AND v.nature = 'STOCK' AND to_char(v.mois, 'YYYY-MM') = '{mois}'
            """);
        // Comptages valorisés (prix de la source sinon PA de l'article) ; sorties validées, verrouillées, au lieu d'origine posé.
        Assert.Equal(0L, await b.CompterAsync("SELECT count(*) FROM stk_comptage WHERE cpt_prix IS NULL"));
        Assert.Equal(0L, await b.CompterAsync("""
            SELECT count(*) FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            WHERE t.tyd_code = 'S_SORTIE' AND (NOT d.ent_verrouille OR d.ent_stk_origine_id IS NULL)
            """));
        if (source == SourceReprise.Mde)
        {
            Assert.Equal(120.5m, await Stock("CIM35", "INT-DEPOT"));
            Assert.Equal(5m, await Stock("CIM35", "CH003"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM chantier WHERE cha_code = 'CH003' AND cha_stock_tenu"));
            Assert.Equal((5, 3, 2), Volume(r, StockMde.StockReel));
            // Fournitures hors pièce : 50 × 0,21 + 10 × 0,25 (bon de régie) ; le bon de livraison n'est pas repris.
            Assert.Equal(13.00m, await CoutStock("CH001", "2024-03"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE t.tyd_code = 'S_SORTIE'"));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.ConsommationNonReprise && a.Emplacement == "PMECHTSUIVFO 4");
            Assert.Equal((4, 2, 2), Volume(r, StockMde.SuiviFournitures));
            Assert.Equal(390L, await b.CompterAsync("SELECT coalesce(sum(pma_minutes), 0) FROM pointage_materiel WHERE pma_source = 'IMPORT'"));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.ConsommationNonReprise && a.Emplacement == "PMECHTSUIVMAT 2");
        }
        else
        {
            Assert.Equal(12.5m, await Stock("BETON-C25", "ATELIER"));
            Assert.Equal(4m, await Stock("BETON-C25", "INT-DEPOT"));
            Assert.Equal((3, 2, 1), Volume(r, StockOptim.ArticleStock));
            Assert.Equal(285m, await CoutStock("C24-001", "2024-06"));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.ConsommationNonReprise && a.Emplacement == "svc_rapport_conso 3");
            Assert.Equal((3, 1, 2), Volume(r, StockOptim.Consommation));
        }
    }

    /// <summary>Lot 14 : pointages (heures par salarié, chantier et mois égales à la source), variables de paie, absences, planning.</summary>
    private static async Task VerifierExploitationAsync(BaseNeuve b, string source, RapportReprise r)
    {
        async Task<long> Compter(string sql) => await b.CompterAsync(sql);
        async Task<long> Minutes(string salarie, string chantier, string mois) => await Compter($"""
            SELECT coalesce(sum(p.poi_minutes), 0) FROM poi_pointage p JOIN salarie s ON s.sal_id = p.poi_sal_id JOIN chantier c ON c.cha_id = p.poi_cha_id
            WHERE s.sal_code = '{salarie}' AND c.cha_code = '{chantier}' AND to_char(p.poi_date, 'YYYY-MM') = '{mois}'
            """);
        async Task<long> Valeur(string salarie, string date, string rubrique) => await Compter($"""
            SELECT coalesce(sum(v.pva_valeur), 0) FROM poi_valeur v JOIN salarie s ON s.sal_id = v.pva_sal_id
            WHERE s.sal_code = '{salarie}' AND v.pva_date = '{date}' AND v.pva_rubrique = '{rubrique}'
            """);
        async Task<long> Zone(string chantier) => await Compter($"SELECT coalesce(max(z.pzc_zone), 0) FROM poi_zone_chantier z JOIN chantier c ON c.cha_id = z.pzc_cha_id WHERE c.cha_code = '{chantier}'");
        // Tout pointage porte une nature de main-d'œuvre.
        Assert.Equal(0L, await Compter("SELECT count(*) FROM poi_pointage p JOIN nature_element n ON n.nat_id = p.poi_type_mo WHERE n.nat_rgn_code <> 'MO'"));
        if (source == SourceReprise.Mde)
        {
            Assert.Equal(930L, await Minutes("SAL01", "CH001", "2024-03"));
            Assert.Equal(120L, await Minutes("SAL03", "CH003", "2024-03"));
            Assert.Equal(480L, await Minutes("SAL02", "CH001", "2024-04"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM poi_pointage WHERE poi_minutes = 480 AND poi_taux = 48.5 AND poi_cout = 388 AND poi_valorisation = 'IMPORT'"));
            Assert.Equal(1L, await Valeur("SAL01", "2024-03-04", "PANIER"));
            Assert.Equal(3L, await Zone("CH001"));
            // Heures d'équipe sans salarié non reprises ; rubrique inconnue signalée.
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.PointageNonRepris && a.Emplacement == "PMECHTSUIVMOCHT 7");
            Assert.Contains(r.Anomalies, a => a.Code == ErreurCorrespondance.SansCible && a.Message.Contains("XYZ"));
            Assert.Equal((8, 6, 2), Volume(r, ExploitationMde.SuiviMo));
            Assert.Equal(0L, await Compter("SELECT count(*) FROM pla_tache"));
        }
        else
        {
            // Heures normales et supplémentaires en un pointage ; horaires gardés quand ils couvrent la durée ; option en commentaire.
            Assert.Equal(960L, await Minutes("M001", "C24-001", "2024-06"));
            Assert.Equal(450L, await Minutes("M002", "ATELIER", "2024-06"));
            Assert.Equal(0L, await Minutes("M001", "C24-001", "2024-07"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM poi_pointage WHERE poi_debut = 480 AND poi_fin = 960 AND poi_minutes = 480 AND poi_taux = 30 AND poi_commentaire = 'Outillage perso'"));
            Assert.Equal(1L, await Valeur("M001", "2024-06-10", "PANIER"));
            Assert.Equal(1L, await Valeur("M001", "2024-06-11", "GD"));
            Assert.Equal(2L, await Zone("C24-001"));
            // Absences : jours consécutifs regroupés en un congé validé ; nature rapprochée par son code ou créée.
            Assert.Equal(1L, await Compter("SELECT count(*) FROM poi_conge c JOIN salarie s ON s.sal_id = c.pco_sal_id WHERE s.sal_code = 'M002' AND c.pco_nature = 'CP' AND c.pco_du = '2024-06-11' AND c.pco_au = '2024-06-12' AND c.pco_etat = 'VALIDE'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM poi_conge c JOIN poi_nature_absence n ON n.pna_code = c.pco_nature WHERE n.pna_code = 'ENFMAL' AND n.pna_libelle = 'Enfant malade'"));
            // Planning : tâche du chantier (salarié et matériel affectés, article non repris), absence écartée, tâche à venir.
            Assert.Equal(1L, await Compter("SELECT count(*) FROM pla_tache t JOIN chantier c ON c.cha_id = t.tac_id_element::int WHERE t.tac_type_element = 'chantier' AND c.cha_code = 'C24-001' AND t.tac_libelle = 'Coffrage voiles' AND t.tac_etat = 'TERMINEE' AND t.tac_heures = 2880 AND t.tac_fin = '2024-06-15'"));
            Assert.Equal(2L, await Compter("SELECT count(*) FROM pla_affectation a JOIN pla_tache t ON t.tac_id = a.aff_tac_id WHERE t.tac_libelle = 'Coffrage voiles' AND a.aff_res_type IN ('SALARIE', 'MATERIEL')"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM pla_tache t JOIN pla_affectation a ON a.aff_tac_id = t.tac_id WHERE t.tac_libelle = 'Reprise d''enduit' AND t.tac_etat = 'PREVUE' AND a.aff_res_type = 'SALARIE'"));
            Assert.Equal((3, 2, 1), Volume(r, ExploitationOptim.Planification));
            Assert.Equal((6, 6, 0), Volume(r, ExploitationOptim.Rapport));
        }
    }

    /// <summary>Lot 13 : échéanciers, règlements, lettrage, retenues et cautions (soldes égaux à la source).</summary>
    private static async Task VerifierReglementsAsync(BaseNeuve b, string source, RapportReprise r)
    {
        async Task<long> Compter(string sql) => await b.CompterAsync(sql);
        // Reste à payer signé d'une pièce en centimes (avoir négatif) ; retenue de garantie ; état de paiement.
        async Task<long> Reste(string numero, string nature = "NORMALE', 'RETENUE") => await Compter($"""
            SELECT round(100 * coalesce(sum(e.ech_montant * f_signe_reglement(d.ent_id) - coalesce((SELECT sum(poi_montant) FROM pointage WHERE poi_echeance_id = e.ech_id), 0)), 0))::bigint
            FROM document_echeance e JOIN document d ON d.ent_id = e.ech_ent_id WHERE d.ent_numero = '{numero}' AND e.ech_nature IN ('{nature}')
            """);
        async Task<string?> Etat(string numero) => await b.TexteAsync($"SELECT d.ent_etat_paiement || '/' || s.std_code FROM document d JOIN statut_document s ON s.std_id = d.ent_std_id WHERE d.ent_numero = '{numero}'");
        if (source == SourceReprise.Mde)
        {
            // Facture en deux échéances de la source partiellement réglées : un règlement par pièce (cumul MDE), mode MODEREG.
            Assert.Equal(35000L, await Reste("FA000001"));
            Assert.Equal("P/PAYE_PARTIEL", await Etat("FA000001"));
            Assert.Equal(2L, await Compter("SELECT count(*) FROM document_echeance e JOIN document d ON d.ent_id = e.ech_ent_id WHERE d.ent_numero = 'FA000001' AND e.ech_manuel AND e.ech_mode = 'CHEQUE'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM reglement WHERE reg_sens = 'E' AND reg_mode = 'CHEQUE' AND reg_montant = 750 AND reg_date = '2024-05-15' AND reg_reference = 'FA000001'"));
            // Facture sans échéance source : échéancier calculé avec la retenue PMEDOCRETENUE, cumul réglé réparti.
            Assert.Equal(25550L, await Reste("FA000002"));
            Assert.Equal(1778L, await Reste("FA000002", "RETENUE"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM document_echeance e JOIN document d ON d.ent_id = e.ech_ent_id WHERE d.ent_numero = 'FA000002' AND e.ech_nature = 'RETENUE' AND e.ech_date IS NULL AND NOT e.ech_manuel"));
            // Fournisseur soldé (décaissement), sous-traitant ouvert, avoir brouillon sans échéancier.
            Assert.Equal(0L, await Reste("FF000001"));
            Assert.Equal("T/PAYE", await Etat("FF000001"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM reglement WHERE reg_sens = 'D' AND reg_montant = 408"));
            Assert.Equal(48000L, await Reste("FS000001"));
            Assert.Equal(0L, await Compter("SELECT count(*) FROM document_echeance e JOIN document d ON d.ent_id = e.ech_ent_id WHERE d.ent_notre_reference = 'AV000001'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM caution c JOIN personne p ON p.per_id = c.cau_tiers_id WHERE p.per_code = 'C001' AND cau_organisme = 'Banque Populaire' AND cau_montant = 55 AND cau_date_fin = '2025-03-31'"));
            Assert.Equal((4, 3, 1), Volume(r, ReglementsMde.Echeance));
            Assert.Equal((4, 3, 1), Volume(r, ReglementsMde.Document));
            Assert.Equal(3L, await Compter("SELECT count(*) FROM reglement"));
        }
        else
        {
            // Remise de deux règlements de tiers différents (un règlement par tiers) et règlement sans échéance réparti.
            Assert.Equal(0L, await Reste("FAC-0012"));
            Assert.Equal("T/PAYE", await Etat("FAC-0012"));
            Assert.Equal(2L, await Compter("SELECT count(*) FROM reglement WHERE reg_date = '2024-02-15' AND reg_reference = 'Remise 15/02'"));
            // Situation : échéance de la facture de la situation (VSI) et échéance de retenue (VER_VRG_ID), 500 réglés.
            Assert.Equal(23440L, await Reste("FS-0001"));
            Assert.Equal(3672L, await Reste("FS-0001", "RETENUE"));
            Assert.Equal("P/PAYE_PARTIEL", await Etat("FS-0001"));
            // Échéance fournisseur soldée réglée à son montant ; régule (avoir) sans échéance source, ouverte et négative.
            Assert.Equal(0L, await Reste("FN-2024-001"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM reglement WHERE reg_sens = 'D' AND reg_montant = 300 AND reg_date = '2024-07-25'"));
            Assert.Equal(-2400L, await Reste("FN-2024-RG1"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM caution WHERE cau_organisme = 'BNP Paribas' AND cau_montant = 36.72 AND cau_reference = 'CA-2024-1'"));
            Assert.Equal((4, 4, 0), Volume(r, ReglementsOptim.Echeance));
            Assert.Equal((3, 3, 0), Volume(r, ReglementsOptim.Reglement));
            Assert.Equal(4L, await Compter("SELECT count(*) FROM reglement"));
        }
        // Tout pointage reste dans son échéance, du signe de l'échéance.
        Assert.Equal(0L, await Compter("""
            SELECT count(*) FROM document_echeance e JOIN (SELECT poi_echeance_id, sum(poi_montant) AS p FROM pointage GROUP BY 1) x ON x.poi_echeance_id = e.ech_id
            WHERE abs(x.p) > e.ech_montant OR sign(x.p) <> f_signe_reglement(e.ech_ent_id)
            """));
        Assert.DoesNotContain(r.Anomalies, a => a.Code == CodeAnomalie.PointageExcedent);
    }

    /// <summary>Lot 12 : achats et sous-traitance (types, tiers, chantier des lignes, avoirs, liens, avancement de sous-traitance).</summary>
    private static async Task VerifierAchatsAsync(BaseNeuve b, string source, RapportReprise r)
    {
        async Task<long> Compter(string sql) => await b.CompterAsync(sql);
        const string Pieces = "document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id";
        // Coût d'achat valable d'un chantier en centimes (avoirs en déduction), ventilé par les lignes (v_document_chantiers_part).
        async Task<long> Cout(string chantier) => await Compter($"""
            SELECT round(100 * sum(CASE WHEN t.tyd_code = 'A_AVOIR' THEN -1 ELSE 1 END * d.ent_total_ht * p.part))::bigint
            FROM v_document_chantiers_part p JOIN document d ON d.ent_id = p.ent_id JOIN v_document_valable v ON v.ent_id = d.ent_id
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN chantier c ON c.cha_id = p.chantier_id
            WHERE t.tyd_code IN ('A_FACTURE', 'A_AVOIR', 'T_FACTURE_AVT') AND c.cha_code = '{chantier}'
            """);
        Assert.DoesNotContain(r.EcartsArrondi, e => e.Piece.StartsWith("A_") || e.Piece.StartsWith("T_"));
        if (source == SourceReprise.Mde)
        {
            // Commande sur deux chantiers (ligne de texte gardée), facture transférée avec remise, avoir rendu positif.
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} JOIN personne f ON f.per_id = d.ent_tiers_id WHERE ent_numero = 'CF000001' AND t.tyd_code = 'A_COMMANDE' AND s.std_code = 'VALIDE' AND f.per_code = 'F001' AND ent_total_ht = 350 AND ent_total_ttc = 420 AND ent_reference_externe = 'ARC-77'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id JOIN chantier c ON c.cha_id = l.lig_cha_id WHERE d.ent_numero = 'CF000001' AND l.lig_libelle_html = 'Sable' AND c.cha_code = 'CH003'"));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'FF000001' AND t.tyd_code = 'A_FACTURE' AND s.std_code = 'PAYE' AND ent_verrouille AND ent_total_ht = 340 AND ent_total_ttc = 408"));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'AVF00001' AND t.tyd_code = 'A_AVOIR' AND s.std_code = 'BROUILLON' AND ent_total_ht = 50 AND ent_total_ttc = 60"));
            // Sous-traitance : commande et facture (sans lien de lignes : sans suivi d'avancement, signalée).
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} JOIN personne f ON f.per_id = d.ent_tiers_id WHERE ent_numero = 'CS000001' AND t.tyd_code = 'T_COMMANDE' AND f.per_code = 'S001' AND ent_total_ht = 1000"));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'FS000001' AND t.tyd_code = 'T_FACTURE_AVT' AND ent_verrouille AND ent_total_ht = 400"));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.AvancementSansMarche && a.Emplacement == "ENTETEFACTURESSTRAIT 602");
            // Coûts par chantier : remise de la facture sur le chantier de l'entête.
            Assert.Equal(53000L, await Cout("CH001"));
            Assert.Equal(21000L, await Cout("CH003"));
        }
        else
        {
            // Commande, réception à la quantité livrée, facture ventilée (chantier des lignes), régule négative en avoir.
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} JOIN personne f ON f.per_id = d.ent_tiers_id WHERE ent_numero = 'CDE-0001' AND t.tyd_code = 'A_COMMANDE' AND f.per_code = 'FOU-NEGO' AND ent_total_ht = 300"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id WHERE d.ent_numero = 'BL-0001' AND l.lig_libelle_html = 'Acier HA' AND l.lig_qte = 5"));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'FN-2024-001' AND t.tyd_code = 'A_FACTURE' AND ent_verrouille AND ent_total_ht = 250 AND ent_total_ttc = 300"));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'FN-2024-RG1' AND t.tyd_code = 'A_AVOIR' AND ent_verrouille AND ent_total_ht = 20 AND ent_total_ttc = 24"));
            Assert.Equal(3L, await Compter("""
                SELECT count(*) FROM document_lien k JOIN document s ON s.ent_id = k.lie_source_ent_id JOIN document c ON c.ent_id = k.lie_cible_ent_id
                WHERE s.ent_numero IN ('CDE-0001', 'BL-0001') AND c.ent_numero IN ('BL-0001', 'FN-2024-001')
                """));
            // Appro, société écartée et facture d'une situation de sous-traitance écartées.
            Assert.Equal((7, 4, 3), Volume(r, AchatsOptim.Entete));
            Assert.Contains(r.ChampsPerdus, c => c.Table == AchatsOptim.Entete && c.Champ == "FAC_PSS_ID");
            // Sous-traitance : commande (modèle écarté), situations en factures d'avancement de la période, consultation.
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} JOIN personne f ON f.per_id = d.ent_tiers_id WHERE ent_numero = 'ST-24-001' AND t.tyd_code = 'T_COMMANDE' AND f.per_code = 'ST-T69' AND ent_total_ht = 5000"));
            Assert.Equal(0L, await Compter("SELECT count(*) FROM document WHERE ent_numero = 'ST-MODELE'"));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'ST-SIT-1' AND t.tyd_code = 'T_FACTURE_AVT' AND s.std_code = 'ENVOYE' AND ent_avt_presentation = 'P' AND ent_total_ht = 2500"));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'ST-SIT-2' AND s.std_code = 'BROUILLON' AND ent_total_ht = 1500"));
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id
                WHERE d.ent_numero = 'ST-SIT-2' AND l.lig_libelle_html = 'Fouilles' AND l.lig_avt_montant_cumul = 2000 AND l.lig_avt_montant_precedent = 1500
                """));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'ST-24-001-C1' AND t.tyd_code = 'T_AO' AND ent_reference_externe = 'OFF-77' AND ent_total_ht = 5200"));
            Assert.Contains(r.ChampsPerdus, c => c.Table == AchatsOptim.Prestation && c.Champ == "PST_IsPaieDirect");
            // Coûts par chantier égaux à la source : facture ventilée, avoir déduit, situation validée (la seconde est en brouillon).
            Assert.Equal(268000L, await Cout("C24-001"));
            Assert.Equal(5000L, await Cout("ATELIER"));
        }
    }

    /// <summary>Lot 11 : situations (cumul) et factures d'avancement (période), lignes suivant le marché, précédents, liens.</summary>
    private static async Task VerifierAvancementAsync(BaseNeuve b, string source, RapportReprise r)
    {
        async Task<long> Compter(string sql) => await b.CompterAsync(sql);
        const string Pieces = "document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id";
        // Cumul d'une ligne du marché (par son code ou libellé) dans une pièce d'avancement.
        async Task<long> Ligne(string numero, string libelle, string condition) => await Compter($"""
            SELECT count(*) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id
            JOIN document_ligne m ON m.lig_id = l.lig_avt_source_lig_id
            WHERE d.ent_numero = '{numero}' AND l.lig_libelle_html = '{libelle}' AND m.lig_ent_id <> d.ent_id AND {condition}
            """);
        var (sit1, fac, sit2, marche) = source == SourceReprise.Mde
            ? ("ST000001", "FA000002", "ST000002", "MB000001") : ("SIT-0001", "FS-0001", "SIT-0002", "DEV-0005-B");
        var (ht1, ttc1, ht2, ttc2) = source == SourceReprise.Mde ? ("296.25", "355.50", "559.00", "670.80") : ("612", "734.40", "860.40", "1032.48");
        // Situation facturée (cumul), facture d'avancement de la période (verrouillée), situation suivante en brouillon.
        Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = '{sit1}' AND t.tyd_code = 'V_SITUATION' AND s.std_code = 'FACTURE' AND ent_avt_presentation = 'C' AND ent_total_ht = {ht1} AND ent_total_ttc = {ttc1}"));
        Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = '{fac}' AND t.tyd_code = 'V_FACTURE_AVT' AND s.std_code IN ('ENVOYE', 'PAYE_PARTIEL') AND ent_verrouille AND ent_avt_presentation = 'P' AND ent_total_ht = {ht1} AND ent_total_ttc = {ttc1}"));
        Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = '{sit2}' AND s.std_code = 'BROUILLON' AND NOT ent_verrouille AND ent_total_ht = {ht2} AND ent_total_ttc = {ttc2}"));
        // Cumul d'avancement égal à la source, sans écart de reprise sur les pièces d'avancement.
        Assert.DoesNotContain(r.EcartsArrondi, e => e.Piece.StartsWith("V_SITUATION") || e.Piece.StartsWith("V_FACTURE_AVT"));
        Assert.DoesNotContain(r.Anomalies, a => a.Code == CodeAnomalie.AvancementSansMarche && (a.Emplacement.StartsWith("PMEDOC") || a.Emplacement.StartsWith("vte_")));
        // Liens : marché → situations et facture, situation → facture.
        Assert.Equal(4L, await Compter($"""
            SELECT count(*) FROM document_lien k JOIN document s ON s.ent_id = k.lie_source_ent_id JOIN document c ON c.ent_id = k.lie_cible_ent_id
            WHERE k.lie_type = 'TRANSFORMATION' AND (s.ent_numero = '{marche}' AND c.ent_numero IN ('{sit1}', '{fac}', '{sit2}') OR s.ent_numero = '{sit1}' AND c.ent_numero = '{fac}')
            """));
        if (source == SourceReprise.Mde)
        {
            Assert.Equal(1L, await Ligne(sit1, "Mur de 20", "l.lig_avt_mode = 'M' AND l.lig_avt_montant_cumul = 152.50 AND l.lig_avt_pct = 50 AND l.lig_avt_montant_marche = 305"));
            Assert.Equal(1L, await Ligne(fac, "Mur de 20", "l.lig_montant_ht = 152.50 AND l.lig_avt_montant_precedent = 0"));
            // Avancement global à 80 % : toutes les lignes du marché, précédent de la facture.
            Assert.Equal(1L, await Ligne(sit2, "Mur de 20", "l.lig_avt_mode = 'P' AND l.lig_avt_valeur = 80 AND l.lig_avt_montant_cumul = 244 AND l.lig_avt_montant_precedent = 152.50"));
            Assert.Equal(1L, await Ligne(sit2, "Échafaudage", "l.lig_avt_montant_cumul = 120"));
            // Marché MDE : commande de base puis avenant (PMEAFFBASEDOC par NUMORDRE), l'avenant suivi à 80 % lui aussi.
            Assert.Equal(1L, await Ligne(sit2, "Plus-value fenêtre", "l.lig_avt_montant_cumul = 80"));
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM marche m JOIN chantier c ON c.cha_id = m.mar_cha_id
                JOIN marche_document b ON b.mdo_mar_id = m.mar_id AND b.mdo_role = 'BASE' AND b.mdo_rang = 0
                JOIN document db ON db.ent_id = b.mdo_ent_id AND db.ent_numero = 'MB000001' AND m.mar_ent_id = db.ent_id
                JOIN marche_document a ON a.mdo_mar_id = m.mar_id AND a.mdo_role = 'AVENANT' AND a.mdo_rang = 1
                JOIN document da ON da.ent_id = a.mdo_ent_id AND da.ent_numero = 'MB000002'
                WHERE c.cha_code = 'CH001' AND m.mar_sens = 'V' AND m.mar_montant_ht = 698.75
                """));
            Assert.Equal((2, 2, 0), Volume(r, PiecesVenteMde.Situation));
        }
        else
        {
            Assert.Equal(1L, await Ligne(sit1, "Dalle béton", "l.lig_avt_mode = 'M' AND l.lig_avt_montant_cumul = 414 AND l.lig_avt_pct = 50 AND l.lig_avt_montant_marche = 828"));
            Assert.Equal(1L, await Ligne(sit2, "Dalle béton", "l.lig_avt_montant_cumul = 662.40 AND l.lig_avt_montant_precedent = 414"));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM document WHERE ent_numero = '{fac}' AND ent_proprietes = '{{}}'"));
            // Situation désactivée écartée.
            Assert.Equal((3, 2, 1), Volume(r, PiecesVenteOptim.Situation));
        }
    }

    /// <summary>Lot 10 : pièces de vente (versions, statuts, verrouillage, lignes, écart de reprise, numérotation, marché).</summary>
    private static async Task VerifierPiecesVenteAsync(BaseNeuve b, string source, RapportReprise r)
    {
        async Task<long> Compter(string sql) => await b.CompterAsync(sql);
        const string Pieces = """
            document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            """;
        if (source == SourceReprise.Mde)
        {
            // Devis : v1 remplacée, v2 acceptée (référence, verrouillée, indice B), total source gardé par une ligne d'écart.
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'DC000001' AND s.std_code = 'REMPLACE' AND ent_indice = 'A' AND NOT ent_is_reference"));
            Assert.Equal(1L, await Compter($"""
                SELECT count(*) FROM {Pieces} WHERE ent_numero = 'DC000002' AND t.tyd_code = 'V_DEVIS' AND s.std_code = 'VALIDE' AND ent_verrouille
                  AND ent_indice = 'B' AND ent_is_reference AND ent_total_ht = 598.80 AND ent_total_ttc = 718.56
                  AND ent_groupe_id = (SELECT ent_groupe_id FROM document WHERE ent_numero = 'DC000001')
                """));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id WHERE d.ent_numero = 'DC000002' AND l.lig_parent_id IS NULL AND l.lig_libelle_html = '{PiecesReprise.LibelleEcart}' AND l.lig_pv_fixe AND l.lig_montant_ht = 0.05"));
            Assert.Contains(r.EcartsArrondi, x => x.Piece == "V_DEVIS DC000002" && x.Ecart == 0.05m);
            // Ouvrage et ses composantes (quantité relative), récapitulatif non repris.
            Assert.Equal(2L, await Compter("SELECT count(*) FROM document_ligne c JOIN document_ligne o ON o.lig_id = c.lig_parent_id JOIN document d ON d.ent_id = o.lig_ent_id WHERE d.ent_numero = 'DC000002' AND o.lig_code = 'MUR20' AND c.lig_qte_type = 'R'"));
            Assert.Contains(r.ChampsPerdus, c => c.Table == "type_ligne_vente" && c.Champ == "TYPELIG");
            // Unité de ligne en casse différente de PMEUNITEMESURE (« m2 » / « M2 ») : retrouvée.
            Assert.Equal(0L, await Compter("SELECT count(*) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id WHERE d.ent_numero = 'DC000002' AND l.lig_libelle_html LIKE '%Enduit%' AND l.lig_unt_code IS NULL"));
            Assert.True(await Compter("SELECT count(*) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id WHERE d.ent_numero = 'DC000002' AND l.lig_libelle_html LIKE '%Enduit%' AND l.lig_unt_code IS NOT NULL") >= 1);
            // Décimales par défaut de MDE : quantités à 3, prix unitaires à 2 (option de la reprise).
            Assert.Equal(0L, await Compter("SELECT count(*) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id WHERE d.ent_numero = 'DC000002' AND l.lig_tyl_id IN (2, 3) AND l.lig_libelle_html <> 'Écart de reprise' AND (l.lig_precision_qte <> 3 OR l.lig_precision_pv <> 2)"));
            Assert.True(await Compter("SELECT count(*) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id WHERE d.ent_numero = 'DC000002' AND l.lig_precision_qte = 3 AND l.lig_precision_pv = 2") >= 4);
            // Commande hors postes de pied ; facture définitive verrouillée à 10 % ; avoir brouillon sans numéro ; avancement écartée.
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE t.tyd_code = 'V_COMMANDE' AND s.std_code = 'BROUILLON' AND ent_total_ht = 200"));
            Assert.Contains(r.ChampsPerdus, c => c.Table == "PMEDOCCDECLI" && c.Champ == "MTPOSTESHT/MTPOSTESTTC");
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'FA000001' AND s.std_code = 'PAYE_PARTIEL' AND ent_verrouille AND ent_total_ht = 1000 AND ent_total_ttc = 1100"));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE t.tyd_code = 'V_AVOIR' AND ent_numero IS NULL AND ent_notre_reference = 'AV000001' AND NOT ent_verrouille"));
            Assert.Equal((3, 3, 0), Volume(r, "PMEDOCFACCLI"));
            // Marché : commande de base de PMEAFFBASEDOC (validée, verrouillée), plus le devis initial du chantier.
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM marche m JOIN {Pieces} ON d.ent_id = m.mar_ent_id WHERE m.mar_code = 'M-CH001' AND d.ent_numero = 'MB000001' AND t.tyd_code = 'V_COMMANDE' AND s.std_code = 'VALIDE' AND ent_verrouille AND ent_total_ht = 598.75"));
            Assert.Equal((2, 2, 0), Volume(r, PiecesVenteMde.MarcheBase));
            // Commande copie exacte d'une pièce du marché (même numéro) : reprise une seule fois, par le marché.
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.PieceDejaReprise && a.Emplacement == "PMEDOCCDECLI 302");
            Assert.Equal((2, 1, 1), Volume(r, "PMEDOCCDECLI"));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE t.tyd_code = 'V_COMMANDE' AND ent_numero = 'MB000002'"));
            Assert.Equal(2L, await Compter("SELECT cnu_dernier_numero FROM compteur_numero c JOIN type_document t ON t.tyd_id = c.cnu_tyd_id WHERE t.tyd_code = 'V_DEVIS' AND cnu_exercice = 2024"));
            Assert.Equal(8L, await Compter("SELECT count(*) FROM document_origine WHERE dor_type = 'IMPORT' AND dor_format = 'MDE' AND dor_reference LIKE 'PMEDOC%'"));
        }
        else
        {
            // Versions par chrono : indice 1 remplacé, indice 2 accepté (référence, marché).
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'DEV-0005' AND s.std_code = 'REMPLACE' AND NOT ent_is_reference"));
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'DEV-0005-B' AND s.std_code = 'VALIDE' AND ent_is_reference AND ent_total_ht = 1026 AND ent_total_ttc = 1231.20"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id WHERE d.ent_numero = 'DEV-0005-B' AND l.lig_code = 'TREILLIS' AND l.lig_qte = 40 AND l.lig_qte_type = 'A'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id WHERE d.ent_numero = 'DEV-0005-B' AND l.lig_code = 'BETON-C25' AND l.lig_qte_type = 'R'"));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.LigneNonReprise);
            Assert.Equal(1L, await Compter("SELECT count(*) FROM marche m JOIN document d ON d.ent_id = m.mar_ent_id WHERE m.mar_code = 'M-C24-001' AND d.ent_numero = 'DEV-0005-B'"));
            // Facture comptabilisée verrouillée, établissement en propriété ; société écartée et attachement écartés (modèle filtré à la lecture).
            Assert.Equal(1L, await Compter($"SELECT count(*) FROM {Pieces} WHERE ent_numero = 'FAC-0012' AND ent_verrouille AND ent_proprietes->>'etablissement' = 'CONSTRUCTIONS DU RHONE - AGENCE ALPES'"));
            Assert.Equal((6, 4, 2), Volume(r, "vte_doc_entete"));
            Assert.Equal(5L, await Compter("SELECT cnu_dernier_numero FROM compteur_numero c JOIN type_document t ON t.tyd_id = c.cnu_tyd_id WHERE t.tyd_code = 'V_DEVIS' AND cnu_exercice = 2024"));
            Assert.Equal(12L, await Compter("SELECT max(cnu_dernier_numero) FROM compteur_numero c JOIN type_document t ON t.tyd_id = c.cnu_tyd_id WHERE cnu_exercice = 2023"));
            Assert.Equal(6L, await Compter("SELECT count(*) FROM document_origine WHERE dor_format = 'OPTIM' AND dor_reference LIKE 'vte%'"));
        }
        // Totaux de TVA cohérents avec l'en-tête.
        Assert.Equal(0L, await Compter("SELECT count(*) FROM document d WHERE ent_total_tva <> (SELECT coalesce(sum(tva_montant_net), 0) FROM document_tva WHERE tva_ent_id = d.ent_id)"));
    }

    /// <summary>Lot 9 : projets, affaires, chantiers, marchés, intervenants, établissement d'origine, révision.</summary>
    private static async Task VerifierStructureAsync(BaseNeuve b, string source, RapportReprise r)
    {
        async Task<long> Compter(string sql) => await b.CompterAsync(sql);
        if (source == SourceReprise.Mde)
        {
            Assert.Equal(3L, await Compter("SELECT count(*) FROM affaire WHERE aff_code LIKE 'AF%'"));
            // Affaire ouverte : client, chargé d'affaires (individu), commentaire joint ; intervenants client (principal) et architecte.
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM affaire a JOIN personne p ON p.per_id = a.aff_tiers_id
                WHERE a.aff_code = 'AF001' AND p.per_code = 'C001' AND a.aff_statut = 'OUVERTE' AND a.aff_date_ouverture = DATE '2024-01-15'
                  AND a.aff_responsable_ind_id IS NOT NULL AND a.aff_commentaire = E'Construction de 12 logements\nNote affaire'
                """));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM intervenant i JOIN affaire a ON a.aff_id = i.itv_aff_id WHERE a.aff_code = 'AF001' AND i.itv_fin_code = 'CLIENT' AND i.itv_principal"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM intervenant i JOIN affaire a ON a.aff_id = i.itv_aff_id JOIN personne p ON p.per_id = i.itv_per_id WHERE a.aff_code = 'AF001' AND i.itv_fin_code = 'ARCHITECTE' AND p.per_code = 'A001'"));
            // Close par l'état non modifiable, ou par la date de clôture.
            Assert.Equal(1L, await Compter("SELECT count(*) FROM affaire WHERE aff_code = 'AF002' AND aff_statut = 'CLOSE'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM affaire WHERE aff_code = 'AF003' AND aff_statut = 'CLOSE' AND aff_date_cloture = DATE '2024-02-28'"));
            // Chantiers : ouvert (adresse, conducteur, chargé), clos par l'état, terminé par l'état.
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM chantier c JOIN affaire a ON a.aff_id = c.cha_aff_id
                WHERE c.cha_code = 'CH001' AND a.aff_code = 'AF001' AND c.cha_statut = 'OUVERT' AND c.cha_adresse = '12 rue des Tilleuls'
                  AND c.cha_code_postal = '69003' AND c.cha_ville = 'Lyon' AND c.cha_debut_prevu = DATE '2024-02-01'
                  AND c.cha_date_fin_prevue = DATE '2024-12-20' AND c.cha_conducteur_ind_id IS NOT NULL AND c.cha_charge_ind_id IS NOT NULL
                  AND NOT c.cha_interne
                """));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM chantier WHERE cha_code = 'CH002' AND cha_statut = 'CLOS' AND cha_fin_reelle = DATE '2023-09-30'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM chantier WHERE cha_code = 'CH003' AND cha_statut = 'TERMINE' AND cha_conducteur_ind_id IS NULL"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM intervenant i JOIN chantier c ON c.cha_id = i.itv_cha_id WHERE c.cha_code = 'CH001' AND i.itv_fin_code = 'ARCHITECTE'"));
            // Marchés : public (type), signature ; montant = commandes de PMEAFFBASEDOC (base 598.75 + avenant 100) ; soldé avec le
            // chantier clos ; aucun sans montant ni signature.
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM marche m JOIN chantier c ON c.cha_id = m.mar_cha_id
                WHERE m.mar_code = 'M-CH001' AND c.cha_code = 'CH001' AND m.mar_nature = 'U' AND m.mar_sens = 'V' AND m.mar_montant_ht = 698.75
                  AND m.mar_date = DATE '2024-01-20' AND m.mar_statut = 'EN_COURS' AND m.mar_commentaire = 'Appel d''offres'
                """));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM marche WHERE mar_code = 'M-CH002' AND mar_nature = 'P' AND mar_montant_ht = 48000 AND mar_statut = 'SOLDE'"));
            Assert.Equal(2L, await Compter("SELECT count(*) FROM marche"));
            Assert.Equal(0L, await Compter("SELECT count(*) FROM projet"));
        }
        else
        {
            // Projets : statut par le libellé de l'état, maître d'ouvrage repris ou libre, maître d'œuvre ; désactivé écarté.
            Assert.Equal(2L, await Compter("SELECT count(*) FROM projet"));
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM projet p JOIN personne t ON t.per_id = p.prj_tiers_id
                WHERE p.prj_libelle = 'Groupe scolaire Jean Moulin' AND t.per_code = 'CLI-IGL' AND p.prj_statut = 'OBTENU'
                  AND p.prj_date_remise = DATE '2024-03-15' AND p.prj_montant_estime = 2500000 AND p.prj_ville = 'Villeurbanne'
                  AND p.prj_adresse = '100 cours Lafayette' AND p.prj_code_postal = '69003'
                """));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM projet WHERE prj_libelle = 'Gymnase' AND prj_statut = 'PERDU' AND prj_tiers_id IS NULL AND prj_client_libre = 'Mairie de Bron'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM intervenant i JOIN projet p ON p.prj_id = i.itv_prj_id JOIN personne t ON t.per_id = i.itv_per_id WHERE i.itv_fin_code = 'MOE' AND t.per_code = 'ST-T69'"));
            // Affaires des sociétés retenues ; société de la base sans établissement, agence en propriété (R1).
            Assert.Equal(0L, await Compter("SELECT count(*) FROM affaire WHERE aff_code = '24-900'"));
            Assert.Equal((3, 2, 1), Volume(r, "afc_affaire"));
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM affaire WHERE aff_code = '24-001' AND aff_statut = 'OUVERTE' AND aff_date_ouverture = DATE '2024-05-02'
                  AND aff_responsable_ind_id IS NOT NULL AND aff_proprietes = '{}' AND aff_commentaire = E'Réf. IGL 2024/12\nMarché à bons de commande'
                """));
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM affaire WHERE aff_code = '23-045' AND aff_statut = 'CLOSE' AND aff_date_cloture = DATE '2023-12-15'
                  AND aff_proprietes->>'etablissement' = 'CONSTRUCTIONS DU RHONE - AGENCE ALPES'
                """));
            // Chantiers : adresse z_adresse, dates prévues et réelles, conducteur, analytique ; terminé ; interne (Q14).
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM chantier c JOIN affaire a ON a.aff_id = c.cha_aff_id
                WHERE c.cha_code = 'C24-001' AND a.aff_code = '24-001' AND c.cha_statut = 'OUVERT' AND c.cha_adresse = E'8 rue Racine\nBâtiment B'
                  AND c.cha_code_postal = '69100' AND c.cha_ville = 'Villeurbanne' AND c.cha_debut_prevu = DATE '2024-06-01'
                  AND c.cha_debut_reel = DATE '2024-06-10' AND c.cha_date_fin_prevue = DATE '2025-08-31' AND c.cha_conducteur_ind_id IS NOT NULL
                  AND c.cha_code_analytique = 'AN-LYON' AND c.cha_commentaire = 'Accès par la rue Racine' AND NOT c.cha_interne
                """));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM chantier WHERE cha_code = 'C23-045' AND cha_statut = 'TERMINE' AND cha_fin_reelle = DATE '2023-12-15' AND cha_proprietes ? 'etablissement'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM chantier WHERE cha_code = 'ATELIER' AND cha_interne AND cha_aff_id IS NULL"));
            Assert.Equal(0L, await Compter("SELECT count(*) FROM chantier WHERE cha_code = 'C24-900'"));
            // Marchés : public et date de signature de l'affaire, libellé d'édition ; pas de marché pour le chantier interne.
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM marche WHERE mar_code = 'M-C24-001' AND mar_nature = 'U' AND mar_montant_ht = 1250000.25
                  AND mar_date = DATE '2024-05-02' AND mar_libelle = 'GS Jean Moulin GO' AND mar_statut = 'EN_COURS'
                """));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM marche WHERE mar_code = 'M-C23-045' AND mar_nature = 'P'"));
            Assert.Equal(2L, await Compter("SELECT count(*) FROM marche"));
            // Intervenants : fonction par le premier indicateur vrai, sur le chantier cité ; contacts ; affaire écartée.
            Assert.Equal(1L, await Compter("SELECT count(*) FROM intervenant i JOIN chantier c ON c.cha_id = i.itv_cha_id JOIN personne t ON t.per_id = i.itv_per_id WHERE c.cha_code = 'C24-001' AND i.itv_fin_code = 'SOUS_TRAITANT' AND t.per_code = 'ST-T69'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM intervenant i JOIN affaire a ON a.aff_id = i.itv_aff_id JOIN personne t ON t.per_id = i.itv_per_id WHERE a.aff_code = '24-001' AND i.itv_fin_code = 'AUTRE' AND t.per_code = 'FOU-NEGO'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM intervenant i JOIN affaire a ON a.aff_id = i.itv_aff_id WHERE a.aff_code = '24-001' AND i.itv_fin_code = 'CLIENT' AND i.itv_ind_id IS NOT NULL AND i.itv_principal"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM intervenant i JOIN chantier c ON c.cha_id = i.itv_cha_id WHERE c.cha_code = 'C24-001' AND i.itv_ind_id IS NOT NULL"));
            Assert.Equal((4, 3, 1), Volume(r, "afc_affaire_tiers"));
            // Révision : BT 01 rapproché de BT01, ICC créé, valeurs au mois (désactivée écartée), formule en fractions.
            Assert.Equal(1L, await Compter("SELECT count(*) FROM index_prix WHERE ipx_code = 'BT01'"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM index_prix WHERE ipx_code = 'ICC' AND ipx_libelle = 'Indice du coût de la construction' AND ipx_actif"));
            Assert.Equal(1L, await Compter("SELECT count(*) FROM index_valeur v JOIN index_prix i ON i.ipx_id = v.ixv_ipx_id WHERE i.ipx_code = 'BT01' AND v.ixv_mois = DATE '2024-02-01' AND v.ixv_valeur = 130.1 AND v.ixv_source = 'IMPORT'"));
            Assert.Equal(3L, await Compter("SELECT count(*) FROM index_valeur"));
            Assert.Equal(1L, await Compter("""
                SELECT count(*) FROM formule_revision WHERE frv_libelle = 'Révision gros œuvre' AND frv_partie_fixe = 0.125 AND frv_precision = 4
                  AND frv_termes = '[{"index": "BT01", "poids": 0.625}, {"index": "ICC", "poids": 0.25}]'
                """));
        }
    }

    private static (int, int, int) Volume(RapportReprise r, string table) =>
        r.Volumes.Single(x => x.Table == table) is var v ? ((int)v.Lues, (int)v.Ecrites, (int)v.Ecartees) : default;

    /// <summary>Lot 8 : bibliothèques, familles, éléments hors sommeil, PV retrouvés ou imposés, perte, unités, tarifs.</summary>
    private static async Task VerifierBibliothequeAsync(BaseNeuve b, string source, RapportReprise r)
    {
        async Task<long> Element(string code, string condition) =>
            await b.CompterAsync($"SELECT count(*) FROM element e WHERE e.ele_code = '{code}' AND {condition}");
        if (source == SourceReprise.Mde)
        {
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM bibliotheque WHERE bib_code = 'GEN' AND bib_defaut"));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.CodeRenomme && a.Emplacement == "PMEBIBLIO E-1");
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM famille_element f JOIN famille_element p ON p.fam_id = f.fam_parent_id WHERE f.fam_code = 'LIANT' AND p.fam_code = 'MACO'"));
            // Nature sans regroupement connu : créée sans regroupement, signalée ; les autres rapprochées.
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM nature_element WHERE nat_code = 'DSP' AND nat_rgn_code IS NULL"));
            Assert.Contains(r.Anomalies, a => a.Code == ErreurCorrespondance.SansCible && a.Emplacement == "PMENATUREELEMENT 5");
            // Élément en sommeil écarté (Q2).
            Assert.Equal(7L, await b.CompterAsync("SELECT count(*) FROM element"));
            Assert.Equal(0L, await b.CompterAsync("SELECT count(*) FROM element WHERE ele_code = 'VIEUX'"));
            var v = r.Volumes.Single(x => x.Table == "PMEELEMENT");
            Assert.Equal((8, 7, 1), (v.Lues, v.Ecrites, v.Ecartees));
            // Achat au mètre, stock à la barre, vente au kilo : RATIOSTOCK direct (1 ml = 0,082645 barre), RATIOVENTE inversé
            // (1 barre = 141,57 kg, donc 1 kg = 0,007064 barre) ; PV source gardé.
            Assert.Equal(1L, await Element("CHA-C100X4", """
                e.ele_unites @> '[{"formule": "0.082645"}, {"formule": "0.007064"}]' AND e.ele_unt_vente IS NOT NULL AND e.ele_pv = 1 AND NOT e.ele_pv_fixe
                """));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.ConversionBrute && a.Emplacement == "PMEELEMENT CHA-C100X4");
            // Données techniques : m en mm, kg, VOLUME en surface (option par défaut) ; unité renseignée signalée.
            Assert.Equal(1L, await Element("CHA-C100X4", """
                e.ele_longueur = 12100 AND e.ele_largeur = 100 AND e.ele_hauteur = 100 AND e.ele_poids = 141.57 AND e.ele_surface = 4.84 AND e.ele_volume IS NULL
                """));
            Assert.Equal(1L, await Element("CIM35", "e.ele_poids = 1"));
            Assert.Equal(["PMEELEMENTARTTEC CIM35"], r.Anomalies.Where(a => a.Code == CodeAnomalie.UniteTechnique).Select(a => a.Emplacement));
            Assert.Equal((2, 2, 0), Volume(r, BibliothequeMde.Technique));
            // Article géré en stock : RTF en HTML, unités d'achat et de vente converties : rapports bruts, PA et PV source gardés sans imposer le PV, signalé.
            Assert.Equal(1L, await Element("CIM35", """
                e.ele_gestion = 'STOCK' AND e.ele_unt_stock = 'kg' AND e.ele_unt_achat = 'u' AND e.ele_unt_vente = 'kg'
                AND e.ele_unites @> '[{"unite": "u", "formule": "35"}, {"unite": "ens", "formule": "350"}]'
                AND e.ele_pa = 0.2 AND e.ele_pv = 0.2772 AND NOT e.ele_pv_fixe AND e.ele_tva_code = 'T20' AND e.ele_cpt_code = '704000'
                AND e.ele_proprietes = '{"coef_perte": 1.05}' AND e.ele_libelle_html = '<b>Ciment</b> CEM II à la palette'
                AND e.ele_description_html = 'Sac de 35 kg' AND e.x_marque = 'Vicat' AND e.ele_code_barre = '3700000000017'
                AND e.ele_nat_id = (SELECT nat_id FROM nature_element WHERE nat_code = 'MAT')
                AND e.ele_fam_id = (SELECT fam_id FROM famille_element WHERE fam_code = 'LIANT')
                """));
            Assert.Equal(1L, await Element("MOMAC", "NOT e.ele_pv_fixe AND e.ele_pv = 39.6 AND e.ele_unt_stock = 'h'"));
            // Zone supplémentaire « Code barre » : versée dans le champ existant Code-barres (pas de colonne x_), sans
            // écraser le code-barres repris de PMEELEMENT.CODEBARRE (perte notée).
            Assert.Equal(1L, await Element("MOMAC", "e.ele_code_barre = '3700000000024'"));
            Assert.Equal(0L, await b.CompterAsync("SELECT count(*) FROM information_schema.columns WHERE table_name = 'element' AND column_name LIKE 'x_code%'"));
            Assert.Contains(r.ChampsPerdus, c => c.Table == "element" && c.Champ == "ele_code_barre");
            Assert.Equal(1L, await Element("TXT1", "e.ele_type = 'TEXTE' AND e.ele_libelle_html = '<p>Garantie décennale</p><p>Assurance œuvre</p>'"));
            // Ouvrage : PV retrouvé en mode déboursé, perte dans la quantité (Q9), composante en sommeil sans lien.
            Assert.Equal(1L, await Element("MUR20", """
                e.ele_type = 'OUVRAGE' AND NOT e.ele_pv_fixe AND e.ele_pv = 30.475 AND e.ele_pa = 21.2 AND e.ele_composition->>'mode' = 'D'
                AND jsonb_array_length(e.ele_composition->'lignes') = 4
                AND e.ele_composition->'lignes' @> '[{"lig_pa": 0.2, "lig_qte": 20, "lig_coef_perte": 1.05, "lig_proprietes": {"element": {"code": "CIM35", "bib": "GEN"}}}]'
                AND e.ele_composition->'lignes' @> '[{"lig_pa": 2, "lig_proprietes": {}, "lig_libelle_html": "Ancien article"}]'
                """));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.ComposanteHorsBibliotheque && a.Emplacement == "PMEELEMENT MUR20");
            // Ouvrage d'ouvrage repris après sa composante ; PV source non retrouvé : imposé et signalé.
            Assert.Equal(1L, await Element("AMUR", """
                e.ele_pv_fixe AND e.ele_pv = 70 AND e.ele_composition->'lignes' @> '[{"lig_proprietes": {"element": {"code": "MUR20"}}}]'
                """));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.ConversionBrute && a.Emplacement == "PMEELEMENT CIM35");
            Assert.Equal(["PMEELEMENT AMUR"],
                r.Anomalies.Where(a => a.Code == CodeAnomalie.PrixImpose && a.Emplacement!.StartsWith("PMEELEMENT", StringComparison.Ordinal)).Select(a => a.Emplacement).Order(StringComparer.Ordinal));
            // Tarifs fournisseurs : principal (fournisseur principal), prix public remisé, fournisseur repris.
            Assert.Equal(2L, await b.CompterAsync("SELECT count(*) FROM tarif_fournisseur t JOIN element e ON e.ele_id = t.tfo_ele_id WHERE e.ele_code = 'CIM35'"));
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM tarif_fournisseur t JOIN personne p ON p.per_id = t.tfo_tiers_id
                WHERE t.tfo_principal AND p.per_code = 'F001' AND t.tfo_prix = 7 AND t.tfo_prix_public = 10 AND t.tfo_remise1 = 30
                  AND t.tfo_reference = 'CIM-35' AND t.tfo_unt_code = 'u' AND t.tfo_debut = DATE '2026-01-01'
                """));
        }
        else
        {
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM bibliotheque WHERE bib_code = 'GENERALE' AND bib_defaut AND bib_actif"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM bibliotheque WHERE bib_code = 'ANCIENNEBI' AND NOT bib_actif"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM famille_element f JOIN famille_element p ON p.fam_id = f.fam_parent_id WHERE f.fam_code = 'BETON' AND p.fam_code = 'GO'"));
            Assert.Equal(5L, await b.CompterAsync("SELECT count(*) FROM element"));
            var v = r.Volumes.Single(x => x.Table == "bib_article");
            Assert.Equal((6, 5, 1), (v.Lues, v.Ecrites, v.Ecartees));
            // Article : PA = tarif de référence remisé, PV de référence retrouvé par le coefficient, zone supplémentaire.
            Assert.Equal(1L, await Element("BETON-C25", """
                e.ele_gestion = 'ACHAT' AND e.ele_pa = 90 AND abs(e.ele_pv - 120) <= 0.01 AND NOT e.ele_pv_fixe AND e.ele_unt_stock = 'u'
                AND e.ele_unt_achat = 'ens' AND e.ele_unites = '[{"unite": "ens", "formule": "6"}]' AND e.ele_proprietes = '{"coef_perte": 1.05}'
                AND e.x_poids_kg = 25.5 AND e.ele_tva_code = 'T20' AND e.ele_delai_livraison = 3 AND e.ele_description_html = 'Classe XC1'
                AND e.ele_fam_id = (SELECT fam_id FROM famille_element WHERE fam_code = 'BETON')
                """));
            Assert.Equal(1L, await Element("TXT-GARANTIE", "e.ele_type = 'TEXTE'"));
            // Ouvrage : PV retrouvé en mode prix de vente (perte de l'article dans la quantité), composante désactivée sans lien.
            Assert.Equal(1L, await Element("DALLE", """
                e.ele_type = 'OUVRAGE' AND NOT e.ele_pv_fixe AND abs(e.ele_pv - 41.4) <= 0.01 AND e.ele_composition->>'mode' = 'V'
                AND jsonb_array_length(e.ele_composition->'lignes') = 4
                AND e.ele_composition->'lignes' @> '[{"lig_qte": 0.15, "lig_coef_perte": 1.05, "lig_proprietes": {"element": {"code": "BETON-C25"}}}]'
                """));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.ComposanteHorsBibliotheque && a.Emplacement == "bib_article 4");
            // Montant fixe : PV imposé sans anomalie ; quantité fixe (absolue) et perte de la composante.
            Assert.Equal(1L, await Element("FORFAIT-POSE", """
                e.ele_pv_fixe AND e.ele_pv = 150 AND e.ele_composition->'lignes' @> '[{"lig_qte_type": "A", "lig_coef_perte": 1.1, "lig_qte": 2}]'
                """));
            Assert.DoesNotContain(r.Anomalies, a => a.Code == CodeAnomalie.PrixImpose && a.Emplacement!.StartsWith("bib_", StringComparison.Ordinal));
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM tarif_fournisseur t JOIN personne p ON p.per_id = t.tfo_tiers_id
                WHERE t.tfo_principal AND p.per_code = 'FOU-NEGO' AND t.tfo_prix = 90 AND t.tfo_prix_public = 100 AND t.tfo_remise1 = 10 AND t.tfo_unt_code = 'u'
                """));
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM tarif_fournisseur t JOIN personne p ON p.per_id = t.tfo_tiers_id
                WHERE NOT t.tfo_principal AND p.per_code = 'ST-T69' AND t.tfo_prix = 90.25 AND t.tfo_remise1 = 5
                """));
        }
    }

    /// <summary>Lot 6 : doublon fusionné avant la reprise (import_fusion) : une seule fiche, casquettes et comptes cumulés.</summary>
    [Theory]
    [InlineData(SourceReprise.Mde, "COMM_TIERS", "3", "4", "C003")]
    [InlineData(SourceReprise.Optim, "bib_tiers", "12", "13", "FOU-NEGO")]
    public async Task Doublon_fusionne_avant_la_reprise(string source, string table, string conservee, string fusionnee, string code)
    {
        if (Admin is null || Source(source) is not { } connexion) return;
        await using var b = await BaseNeuve.CreerAsync(Admin);
        await b.CompterAsync($$"""
            INSERT INTO import_fusion (ifu_source, ifu_table_source, ifu_cle_conservee, ifu_cles_fusionnees)
            VALUES ('{{source}}', '{{table}}', '{{conservee}}', '["{{fusionnee}}"]') RETURNING 1
            """);
        var reelle = await RepriseBase.ExecuterAsync(new DemandeReprise
        {
            Source = source, ConnexionSource = connexion, ConnexionCible = b.Connexion, Simulation = false,
            Societes = source == SourceReprise.Optim ? ["1", "2"] : [], Auteur = "test",
        }, default);
        Assert.True(reelle.Rapport.Etat == EtatReprise.Terminee, string.Join("\n", reelle.Rapport.Anomalies.Select(x => $"{x.Niveau} {x.Code} {x.Emplacement} {x.Message}")));
        Assert.DoesNotContain(reelle.Rapport.Anomalies, a => a.Code == CodeAnomalie.SiretPris);
        Assert.DoesNotContain(reelle.Rapport.Doublons, d => d.Critere == "SIRET");
        Assert.Equal(1L, await b.CompterAsync($"""
            SELECT count(*) FROM personne WHERE per_code = '{code}' AND per_casquettes @> '["CLIENT", "FOURNISSEUR"]'
              AND per_cli_compte IS NOT NULL AND per_fou_compte IS NOT NULL
            """));
        Assert.Equal(source == SourceReprise.Mde ? 7L : 5L, await b.CompterAsync("SELECT count(*) FROM personne WHERE NOT per_societe_base AND per_parent_id IS NULL"));
    }

    /// <summary>Lot 4 : société de la base, référentiels rapprochés ou créés, paramétrage comptable.</summary>
    private static async Task VerifierReferentielsAsync(BaseNeuve b, string source, RapportReprise r)
    {
        Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_societe_base AND per_niv_code = 'SOCIETE'"));
        // MDE : adresse, téléphone, courriel ; OPTIM : adresse et téléphone du siège.
        Assert.Equal(source == SourceReprise.Mde ? 3L : 2L, await b.CompterAsync("""
            SELECT count(*) FROM usage_coordonnee u JOIN personne p ON p.per_id = u.uco_per_id WHERE p.per_societe_base
            """));
        Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM usage_coordonnee u JOIN coordonnee c ON c.coo_id = u.uco_coo_id JOIN personne p ON p.per_id = u.uco_per_id WHERE p.per_societe_base AND c.coo_nature = 'ADRESSE' AND u.uco_usage = 'SIEGE' AND u.uco_principal AND c.coo_pays = 'FR'"));
        Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.Decimales || source == SourceReprise.Optim);
        if (source == SourceReprise.Mde)
        {
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_societe_base"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_siren = '123456789' AND per_capital = 10000 AND per_naf = '4120A'"));
            // Unités et taux tous rapprochés de l'existant (autoliquidation à 0 % → taux autoliquidé de LogiBTP).
            Assert.Equal("kg", r.Correspondances["unite"]["KG"]);
            Assert.Equal(6L, await b.CompterAsync("SELECT count(*) FROM taux_tva"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM taux_tva WHERE ttv_code = 'T20' AND ttv_cpt_collectee IS NOT NULL"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM compte_comptable WHERE cpt_code = '44571200' AND cpt_type = 'TVA'"));
            // Conditions : comptant et 30 jours fin de mois rapprochées, trois fois, LCR le 10 (net le) et fin de mois le 15 créées.
            Assert.Equal("COMPTANT", r.Correspondances["condition_paiement"]["CHQ"]);
            Assert.Equal("30JFM", r.Correspondances["condition_paiement"]["V30"]);
            Assert.Equal(1L, await b.CompterAsync("""SELECT count(*) FROM condition_paiement WHERE cpa_code = '3X' AND jsonb_array_length(cpa_lignes) = 3"""));
            Assert.Equal(1L, await b.CompterAsync("""SELECT count(*) FROM condition_paiement WHERE cpa_code = 'L10' AND cpa_lignes @> '[{"base":"JOUR","jour":10,"delai":30}]'"""));
            // TYPEP M : fin de mois le 15 (date + 30 jours, fin du mois, puis le 15 suivant).
            Assert.Equal(1L, await b.CompterAsync("""SELECT count(*) FROM condition_paiement WHERE cpa_code = 'FM15' AND cpa_lignes @> '[{"base":"FIN_MOIS_JOUR","jour":15,"delai":30}]'"""));
            // Modes de paiement (PMEMODEPAIEMENT, cités par MODEP) : rapprochés par le libellé, sinon créés.
            Assert.Equal("CHEQUE", r.Correspondances["mode_reglement"]["Chèque"]);
            Assert.Equal("VIREMENT", r.Correspondances["mode_reglement"]["Virement"]);
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM mode_reglement WHERE mre_libelle = 'Lettre de change'"));
            Assert.Equal("M.", r.Correspondances["civilite"]["Monsieur"]);
            // Paramétrage comptable : journaux, collectifs, exigibilité, analytique.
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM type_comptable WHERE tco_code = 'VENTE' AND tco_journal = 'VE'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM collectif_tiers WHERE col_code = 'FOURNISSEUR' AND col_cpt_code = '401000'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM parametre_comptabilite WHERE pcp_cle = 'tva_sur_debits' AND pcp_valeur = 'false'"));
            Assert.Equal(2L, await b.CompterAsync("SELECT jsonb_array_length(pcp_valeur->'grilles') FROM parametre_comptabilite WHERE pcp_cle = 'reprise_analytique'"));
        }
        else
        {
            // Deux établissements d'un même SIREN : la société de tête et son établissement.
            Assert.Equal(2L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_societe_base OR per_parent_id IN (SELECT per_id FROM personne WHERE per_societe_base)"));
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM personne e JOIN personne s ON s.per_id = e.per_parent_id
                WHERE e.per_niv_code = 'ETABLISSEMENT' AND s.per_societe_base AND e.per_siret = '98765432100029' AND s.per_code = 'SOC-CDR'
                """));
            Assert.Equal("ft", r.Correspondances["unite"]["Forf"]);
            Assert.Equal("m2", r.Correspondances["unite"]["m²"]);
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM taux_tva WHERE ttv_taux = 8.5 AND ttv_categorie = 'N'"));
            Assert.Equal(7L, await b.CompterAsync("SELECT count(*) FROM taux_tva"));
            Assert.Equal("CHEQUE", r.Correspondances["mode_reglement"]["CHQ"]);
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM mode_reglement WHERE mre_code = 'TRAITE'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM compte_comptable WHERE cpt_code = '704100'"));
            Assert.Equal(0L, await b.CompterAsync("SELECT count(*) FROM compte_comptable WHERE cpt_code = '704900'"));
            Assert.Equal("Mme", r.Correspondances["civilite"]["MME"]);
            Assert.Contains(r.Anomalies, a => a.Emplacement == "z_parametre 1203");
            Assert.Equal(7, r.Volumes.Single(v => v.Table == "ref_famille_type").Ecrites);
            Assert.Equal("FR", r.Correspondances["pays"]["France"]);
            Assert.Equal(2L, await b.CompterAsync("SELECT jsonb_array_length(pcp_valeur->'etablissements') FROM parametre_comptabilite WHERE pcp_cle = 'reprise_analytique'"));
        }
    }

    /// <summary>Lot 5 : champs supplémentaires créés (colonnes x_ et registre) ; valeurs en attente des fiches (lots 6 à 9).</summary>
    private static async Task VerifierChampsAsync(BaseNeuve b, string source, RapportReprise r)
    {
        if (source == SourceReprise.Mde)
        {
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM fiche_champ_supplementaire WHERE fcs_table = 'personne' AND fcs_colonne = 'x_zone_sup_01' AND fcs_type = 'texte'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM fiche_champ_supplementaire WHERE fcs_table = 'personne' AND fcs_colonne = 'x_code_fournisseur_groupe'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM information_schema.columns WHERE table_name = 'personne' AND column_name = 'x_zone_sup_01'"));
            Assert.Equal(2, r.Volumes.Single(v => v.Table == "PMECLIENT.RTCFIELD").Lues);
            // Liste de choix MDE : valeurs = lettres qui suivent « & », libellés sans « & ».
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM fiche_champ_supplementaire WHERE fcs_table = 'personne' AND fcs_colonne = 'x_type_de_client' AND fcs_type = 'liste'
                  AND fcs_valeurs @> '[{"Valeur": "P", "Libelle": "Public"}, {"Valeur": "R", "Libelle": "Privé"}]'
                """));
            // « Achat bloqué » : usage de la fiche, pas de champ supplémentaire.
            Assert.Equal(0L, await b.CompterAsync("SELECT count(*) FROM fiche_champ_supplementaire WHERE fcs_colonne LIKE 'x_achat%'"));
        }
        else
        {
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM fiche_champ_supplementaire WHERE fcs_table = 'materiel' AND fcs_colonne = 'x_numero_de_parc' AND fcs_type = 'texte'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM fiche_champ_supplementaire WHERE fcs_table = 'materiel' AND fcs_colonne = 'x_date_du_controle_technique' AND fcs_type = 'date'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM fiche_champ_supplementaire WHERE fcs_table = 'element' AND fcs_colonne = 'x_poids_kg' AND fcs_type = 'nombre'"));
            Assert.Equal(3, r.Volumes.Single(v => v.Table == "z_dataspec_data").Lues);
        }
    }

    /// <summary>Lot 6 : tiers, coordonnées, contacts, casquettes, payeurs, doublons proposés.</summary>
    private static async Task VerifierAnnuaireAsync(BaseNeuve b, string source, RapportReprise r)
    {
        // Même SIRET sur deux fiches : le second est retiré (avertissement) et le doublon proposé à la fusion.
        Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.SiretPris);
        if (source == SourceReprise.Mde)
        {
            Assert.Equal(8L, await b.CompterAsync("SELECT count(*) FROM personne WHERE NOT per_societe_base")); // dont l'architecte A002 sans COMM_TIERS
            Assert.Contains(r.Doublons, d => d.Critere == "SIRET" && d.Valeur == "77788899900015" && d.Fiches.Count == 2);
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM personne WHERE per_code = 'C001' AND per_niv_code = 'PARTICULIER' AND per_casquettes = '["CLIENT"]'
                  AND per_cli_compte = 'CMARTIN' AND per_cli_collectif = '411000' AND per_cli_mode_reglement = 'CHEQUE'
                  AND per_cli_delai_paiement = 'COMPTANT' AND x_zone_sup_01 = 'VIP' AND x_type_de_client = 'R' AND per_usage = 'A'
                """));
            // Compte bloqué (COMM_TIERS.COMPTEBLOQUE) et « Achat bloqué » à Oui : « Ne plus utiliser » ; à Non : en service.
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'C002' AND per_usage = 'N' AND per_actif"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'F002' AND per_usage = 'N'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'F001' AND per_usage = 'A'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'S001' AND per_casquettes = '[\"SOUS_TRAITANT\"]'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'A001' AND per_casquettes = '[\"ARCHITECTE\"]'"));
            // Architecte sans fiche COMM_TIERS ni TYPETIERS : rôle de la table, note gardée, pas d'avertissement.
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'A002' AND per_casquettes = '[\"ARCHITECTE\"]' AND per_commentaire = 'Cabinet sans fiche tiers'"));
            Assert.DoesNotContain(r.Anomalies, a => a.Emplacement == "PMEARCHITECTE A002");
            // Interlocuteurs (9) et chargé d'affaires de la société de la base (individu rattaché, relié à son salarié au lot 7).
            Assert.Equal(9L, await b.CompterAsync("SELECT count(*) FROM rattachement r JOIN personne p ON p.per_id = r.rat_per_id WHERE NOT p.per_societe_base"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM individu i JOIN salarie s ON s.sal_ind_id = i.ind_id WHERE i.ind_nom = 'BERNARD' AND i.ind_prenom = 'Luc'"));
            Assert.Equal(9, r.Volumes.Single(v => v.Table == "COMM_TIERSINTERLOC").Ecrites);
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM lien_personne l JOIN personne c ON c.per_id = l.lpe_per_id JOIN personne p ON p.per_id = l.lpe_cible_id
                WHERE l.lpe_tli_code = 'FACTURER_A' AND c.per_code = 'C002' AND p.per_code = 'C003'
                """));
        }
        else
        {
            Assert.Equal(6L, await b.CompterAsync("SELECT count(*) FROM personne WHERE NOT per_societe_base AND per_parent_id IS NULL"));
            Assert.Contains(r.Doublons, d => d.Critere == "SIRET" && d.Valeur == "66677788800013");
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'CLI-IGL' AND per_casquettes = '[\"CLIENT\", \"PROSPECT\"]' AND per_cli_encours_max = 150000.5"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'CLI-DUPONT' AND per_niv_code = 'PARTICULIER'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'FOU-OLD' AND NOT per_actif"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'ST-T69' AND per_iban = 'FR7630006000011234567890189' AND per_bic = 'AGRIFRPP'"));
            Assert.Equal(4L, await b.CompterAsync("SELECT count(*) FROM rattachement r JOIN personne p ON p.per_id = r.rat_per_id WHERE NOT p.per_societe_base AND p.per_parent_id IS NULL"));
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM usage_coordonnee u JOIN coordonnee c ON c.coo_id = u.uco_coo_id JOIN personne p ON p.per_id = u.uco_per_id
                WHERE p.per_code = 'FOU-NEGO' AND c.coo_nature = 'EMAIL' AND u.uco_usage = 'COMMANDE' AND c.coo_valeur = 'cde@negobat.fr'
                """));
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM lien_personne l JOIN personne c ON c.per_id = l.lpe_per_id JOIN personne p ON p.per_id = l.lpe_cible_id
                WHERE l.lpe_tli_code = 'FACTURER_A' AND c.per_code = 'CLI-DUPONT' AND p.per_code = 'CLI-IGL'
                """));
            // Collectifs : comptes 40 / 41 du plan, jamais les comptes auxiliaires des tiers.
            Assert.Equal(0L, await b.CompterAsync("SELECT count(*) FROM compte_comptable WHERE cpt_code = '411IGL' AND cpt_type = 'COLLECTIF'"));
        }
    }

    /// <summary>Lot 7 : salariés, habilitations, équipes, matériels, calendriers, valeurs forcées, utilisateurs.</summary>
    private static async Task VerifierRessourcesAsync(BaseNeuve b, string source, RapportReprise r)
    {
        // Service obligatoire absent des sources : posé par défaut et listé (Q13) ; individu et rattachement à l'agence.
        Assert.Equal(4L, await b.CompterAsync("SELECT count(*) FROM salarie"));
        Assert.Equal(4, r.ValeursForcees.Count(v => v.Fiche == TypesFiche.Salarie && v.Champ == "service"));
        Assert.Equal(4L, await b.CompterAsync("""
            SELECT count(*) FROM salarie s JOIN individu i ON i.ind_id = s.sal_ind_id
            JOIN rattachement r ON r.rat_ind_id = i.ind_id AND r.rat_per_id = s.sal_agence_per_id
            """));
        Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM salarie WHERE NOT sal_actif AND sal_usage = 'S'"));
        Assert.Equal(1L, await b.CompterAsync("""
            SELECT count(*) FROM mission_interim m JOIN salarie s ON s.sal_id = m.mis_sal_id JOIN individu i ON i.ind_id = s.sal_ind_id
            WHERE s.sal_statut = 'INTERIM' AND i.ind_roles = '["INTERIMAIRE"]' AND m.mis_fin = DATE '2026-12-31'
            """));
        if (source == SourceReprise.Mde)
        {
            // Le chargé d'affaires G001 (individu du lot 6) devient le salarié SAL01 : pas de second individu.
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM salarie s JOIN individu i ON i.ind_id = s.sal_ind_id
                WHERE s.sal_code = 'SAL01' AND i.ind_nom = 'BERNARD' AND s.sal_type_mo = 'CADRE' AND s.sal_cout_horaire = 48.5 AND s.sal_salaire = 4200
                """));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM individu WHERE ind_nom = 'BERNARD'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM salarie WHERE sal_code = 'SAL02' AND sal_statut = 'CDD' AND sal_ville = 'VENISSIEUX' AND sal_email = 'a.kaci@exemple.fr'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM equipe e JOIN equipe_composition c ON c.eqc_equ_id = e.equ_id WHERE e.equ_code = 'EQ1' AND c.eqc_type = 'INTERIM'"));
            Assert.Equal(2L, await b.CompterAsync("SELECT count(*) FROM equipe_composition"));
            // Matériels : type rapproché (Mini-pelle), type créé sous sa famille (véhicule), hors service en sommeil, code coupé.
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM materiel WHERE mat_code = 'MP-001' AND mat_famille = 'MINI_PELLE' AND x_numero_de_parc = 'P-07'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM liste_valeur WHERE lva_liste = 'TYPE_MATERIEL' AND lva_libelle = 'Camion benne' AND lva_parent = 'VEHICULES'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM materiel WHERE mat_code = 'VIEUX' AND mat_usage = 'S' AND mat_compteurs = 'KM' AND mat_kilometres = 480000"));
            Assert.Contains(r.Anomalies, a => a.Code == CodeAnomalie.CodeRenomme && a.Emplacement == "PMEMATERIEL CAMION-BENNE-02");
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM materiel_releve WHERE mre_unite = 'KM' AND mre_valeur = 125000"));
        }
        else
        {
            // Salarié d'une société non retenue écarté ; établissement, calendrier, poste par la fonction.
            Assert.Equal(1, r.Volumes.Single(v => v.Table == "ref_salarie").Ecartees);
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM salarie s JOIN personne p ON p.per_id = s.sal_agence_per_id JOIN calendrier c ON c.cal_id = s.sal_cal_id
                WHERE s.sal_code = 'M002' AND p.per_niv_code = 'ETABLISSEMENT' AND c.cal_libelle = 'Horaire chantier 39 h' AND s.sal_poste = 'Maçon'
                """));
            Assert.Equal(10L, await b.CompterAsync("SELECT count(*) FROM calendrier_plage p JOIN calendrier c ON c.cal_id = p.plg_cal_id WHERE c.cal_libelle = 'Horaire chantier 39 h'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM calendrier_plage p JOIN calendrier c ON c.cal_id = p.plg_cal_id WHERE c.cal_libelle = 'Horaire chantier 39 h' AND p.plg_jour = 5 AND p.plg_debut = 780 AND p.plg_fin = 930"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM mission_interim m JOIN personne p ON p.per_id = m.mis_agence_id WHERE p.per_code = 'ST-T69' AND m.mis_debut = DATE '2026-10-01'"));
            // Habilitations : CACES rapproché, échafaudage créé (sans limite), salarié non repris écarté ; visite → contrôle technique.
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM habilitation h JOIN salarie s ON s.sal_id = h.hab_id_element WHERE h.hab_type_element = 'salarie' AND h.hab_tha_code = 'CACES_R482_A' AND s.sal_code = 'M001' AND h.hab_organisme = 'AFPA'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM type_habilitation WHERE tha_code = 'ECHAF' AND tha_duree_mois IS NULL"));
            Assert.Equal(1, r.Volumes.Single(v => v.Table == "ref_salarie_habilitation").Ecartees);
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM habilitation h JOIN materiel m ON m.mat_id = h.hab_id_element WHERE h.hab_type_element = 'materiel' AND h.hab_tha_code = 'CONTROLE_TECHNIQUE' AND m.mat_code = 'VU02' AND h.hab_valide_jusqu_au = DATE '2027-03-15'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM equipe e WHERE e.equ_code = 'EQ-GO' AND e.equ_effectif = 3"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM equipe"));
            // Matériels : type créé sous sa famille, énergie créée, loueur, générique par nombre (type forcé), valeur x_ écrite.
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM materiel m JOIN personne p ON p.per_id = m.mat_loueur_id
                WHERE m.mat_code = 'VU02' AND m.mat_famille = 'UTILITAIRE_DE_CHANTIER' AND m.mat_energie = 'GAZOLE' AND m.mat_kilometres = 45000 AND p.per_code = 'ST-T69'
                """));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM materiel WHERE mat_designation = 'Étais tirant-poussant' AND mat_mode = 'NOMBRE' AND mat_quantite = 12 AND mat_famille = 'DIVERS'"));
            Assert.Contains(r.ValeursForcees, v => v.Fiche == TypesFiche.Materiel && v.Champ == "famille");
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM materiel WHERE mat_code = 'MP01' AND mat_heures = 1250 AND x_numero_de_parc = 'P-0012' AND x_date_du_controle_technique = DATE '2026-03-15'"));
            // Utilisateurs (Q20) : compte lié au salarié, à l'interlocuteur, accès mobile ; compte désactivé absent.
            Assert.Contains(r.Utilisateurs, u => u.Identifiant == "jmartin" && u.FicheType == TypesFiche.Salarie && u.Profil == "Conducteur de travaux");
            Assert.Contains(r.Utilisateurs, u => u.Identifiant == "aleroy" && u.FicheType == TypesFiche.Individu);
            Assert.Contains(r.Utilisateurs, u => u.Identifiant == "SLR-2" && u.FicheType == TypesFiche.Salarie);
            Assert.DoesNotContain(r.Utilisateurs, u => u.Identifiant == "ancien");
        }
    }
}
