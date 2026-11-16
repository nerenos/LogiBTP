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
        };
        var simulation = await RepriseBase.ExecuterAsync(demande, default);
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

        // Correspondances fournies invalides : refus avant toute lecture.
        var refus = await Assert.ThrowsAsync<RepriseRefuseeException>(() => RepriseBase.ExecuterAsync(
            demande with { Correspondances = $$"""{ "source": "{{source}}", "version": 1, "tables": {} }""" }, default));
        Assert.Equal(ErreurReprise.CorrespondancesInvalides, refus.Code);
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
        Assert.Equal(source == SourceReprise.Mde ? 6L : 5L, await b.CompterAsync("SELECT count(*) FROM personne WHERE NOT per_societe_base AND per_parent_id IS NULL"));
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
            // Conditions : comptant et 30 jours fin de mois rapprochées, trois fois et LCR le 10 créées.
            Assert.Equal("COMPTANT", r.Correspondances["condition_paiement"]["CHQ"]);
            Assert.Equal("30JFM", r.Correspondances["condition_paiement"]["V30"]);
            Assert.Equal(1L, await b.CompterAsync("""SELECT count(*) FROM condition_paiement WHERE cpa_code = '3X' AND jsonb_array_length(cpa_lignes) = 3"""));
            Assert.Equal(1L, await b.CompterAsync("""SELECT count(*) FROM condition_paiement WHERE cpa_code = 'L10' AND cpa_lignes @> '[{"base":"JOUR","jour":10,"delai":30}]'"""));
            Assert.Equal("LCR", r.Correspondances["mode_paiement"]["L"]);
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
            Assert.Equal(1, r.Volumes.Single(v => v.Table == "PMECLIENT.RTCFIELD").Lues);
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
            Assert.Equal(7L, await b.CompterAsync("SELECT count(*) FROM personne WHERE NOT per_societe_base"));
            Assert.Contains(r.Doublons, d => d.Critere == "SIRET" && d.Valeur == "77788899900015" && d.Fiches.Count == 2);
            Assert.Equal(1L, await b.CompterAsync("""
                SELECT count(*) FROM personne WHERE per_code = 'C001' AND per_niv_code = 'PARTICULIER' AND per_casquettes = '["CLIENT"]'
                  AND per_cli_compte = 'CMARTIN' AND per_cli_collectif = '411000' AND per_cli_mode_reglement = 'CHEQUE'
                  AND per_cli_delai_paiement = 'COMPTANT' AND x_zone_sup_01 = 'VIP'
                """));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'S001' AND per_casquettes = '[\"SOUS_TRAITANT\"]'"));
            Assert.Equal(1L, await b.CompterAsync("SELECT count(*) FROM personne WHERE per_code = 'A001' AND per_casquettes = '[\"ARCHITECTE\"]'"));
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
