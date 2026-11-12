using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Api.Btp;
using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.Socle;
using LogiBTP.Socle.Testing;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Pièces de vente de démonstration → facture électronique (lots 22 et 23 : situations en période ou en cumul, pied BTP ; Btp/EmissionFactureBtp.cs), jeu tests/emission-fe/02_pieces.json :
/// calcul par MoteurDevisBtp, paramètres d'émission (lot 21), construction, complétude sans écart, CII et UBL écrits, relus au même
/// modèle et égaux aux références tests/emission-fe/ecrits/ (régénérées par LOGIBTP_REGENERER_EMISSION=1), contrôlées aux schematrons
/// par client/test/emission-facture.test.js.
/// </summary>
public class EmissionFactureTests
{
    private static readonly JsonObject J = CasPartages.Lire(CasPartages.Chemin("tests", "emission-fe", "02_pieces.json"));
    private static readonly JsonSerializerOptions Comparaison = new(ReglesCompletude.Json) { Converters = { new DecimalNormalise() } };

    private sealed class DecimalNormalise : System.Text.Json.Serialization.JsonConverter<decimal>
    {
        public override decimal Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => reader.GetDecimal();
        public override void Write(Utf8JsonWriter writer, decimal value, JsonSerializerOptions options) => writer.WriteRawValue(EcritureCii.Nombre(value));
    }

    private static string? Texte(JsonNode? n) => n?.GetValue<string>();
    private static DateOnly? Date(JsonNode? n) => n is null ? null : DateOnly.Parse(n.GetValue<string>());

    private static AdressePostale? Adresse(JsonNode? a) => a is null ? null
        : new AdressePostale(Texte(a["ligne1"]), null, null, Texte(a["localite"]), Texte(a["code_postal"]), null, Texte(a["code_pays"]) ?? "FR");

    private static PartieEmissionFe Partie(JsonNode p) => new()
    {
        RaisonSociale = Texte(p["raison_sociale"])!, Siren = Texte(p["siren"]), Siret = Texte(p["siret"]), NumeroTva = Texte(p["numero_tva"]),
        AdresseFe = Texte(p["adresse_fe"]), TypeFe = Texte(p["type_fe"]), Adresse = Adresse(p["adresse"]),
        CodeService = Texte(p["code_service"]), EngagementObligatoire = p["engagement"]?.GetValue<bool>() ?? false,
        Contact = p["contact"] is { } c ? new Contact(Texte(c["nom"]), Texte(c["telephone"]), Texte(c["courriel"])) : null,
    };

    private static JsonNode Piece(string nom) => J["pieces"]!.AsArray().First(x => Texte(x!["nom"]) == nom)!;

    public static TheoryData<string> Noms()
    {
        var d = new TheoryData<string>();
        foreach (var c in J["pieces"]!.AsArray()) d.Add(Texte(c!["nom"])!);
        return d;
    }

    /// <summary>Pièce calculée par le moteur, numérotée et datée, puis entrée de la construction.</summary>
    public static EntreeFactureBtp Entree(JsonNode c)
    {
        var taux = J["taux"]!.AsArray().Select(t => new TauxEmissionFe(t!["id"]!.GetValue<int>(), t["taux"]!.GetValue<decimal>(), Texte(t["comportement"])!,
            Texte(t["categorie"]), Texte(t["vatex"]), Texte(t["mention"]))).ToDictionary(t => t.Id);
        var entree = c["entree"]!.DeepClone().AsObject();
        entree["taux_tva"] = new JsonArray(taux.Values.Select(t => (JsonNode)new JsonObject
        {
            ["ttv_id"] = t.Id, ["ttv_code"] = $"T{t.Id}", ["ttv_libelle"] = $"T{t.Id}", ["ttv_taux"] = t.Taux, ["ttv_categorie"] = t.Comportement,
            ["ttv_mention"] = t.Mention,
        }).ToArray());
        var r = MoteurDevisBtp.Calculer(entree.Deserialize<EntreeCalcul>(JsonCalcul.Options)!);
        var d = r.Document;
        d.EntNumero = Texte(c["numero"]);
        d.EntDate = Date(c["date"])!.Value;
        d.EntReferenceExterne = Texte(c["reference"]);
        var m = J["mentions"]!;
        var mentions = c["sans_mentions"]?.GetValue<bool>() == true ? new MentionsEmissionFe()
            : new MentionsEmissionFe(Texte(m["indemnite"]), Texte(m["penalites"]), Texte(m["escompte"]), m["tva_debits"]!.GetValue<bool>());
        var parametres = EmissionFeBtp.Parametres(new EntreeEmissionFe
        {
            TypeFacture = Texte(c["type_facture"]), TypeOrigine = Texte(c["type_origine"]), Lignes = r.Lignes,
            NaturesFe = J["natures_fe"]!.AsObject().ToDictionary(x => int.Parse(x.Key), x => x.Value!.GetValue<string>()),
            DeduitAcompte = c["deduit_acompte"]?.GetValue<bool>() ?? false, Mentions = mentions, Role = Texte(c["role"]),
        })!;
        var p = J["paiement"]!;
        return new EntreeFactureBtp
        {
            Document = d, Lignes = r.Lignes, Tva = r.Tva, Taux = taux, Parametres = parametres,
            Vendeur = Partie(J["vendeur"]!), Acheteur = c["sans_acheteur"]?.GetValue<bool>() == true ? null : Partie(c["acheteur"] ?? J["acheteur"]!),
            Payeur = c["payeur"] is { } py ? Partie(py) : null,
            PiecesJointes = (c["pieces_jointes"]?.AsArray() ?? []).Select(x => new PieceJointe(Texte(x!["reference"])!, TypePieceJointe.RecapitulatifCotraitance, null,
                Encoding.UTF8.GetBytes(Texte(x["texte"])!), Texte(x["type_mime"]), Texte(x["nom_fichier"]))).ToList(),
            AdresseLivraison = Adresse(c["livraison"]?["adresse"]), NomLivraison = Texte(c["livraison"]?["nom"]),
            ConditionsPaiement = Texte(p["conditions"]), Echeance = Date(c["echeance"]), ModeReglement = Texte(p["mode"]),
            Iban = c["sans_iban"]?.GetValue<bool>() == true ? null : Texte(p["iban"]), Bic = Texte(p["bic"]),
            Origines = (c["origines"]?.AsArray() ?? []).Select(o => new AnterieureEmissionFe(Texte(o!["numero"]), Date(o["date"]))).ToList(),
            Acomptes = (c["acomptes"]?.AsObject() ?? []).ToDictionary(x => x.Key, x => (AnterieureEmissionFe?)new AnterieureEmissionFe(Texte(x.Value!["numero"]), Date(x.Value["date"]))),
            Chantier = Texte(c["chantier"]), Marche = Texte(c["marche"]), Projet = Texte(c["projet"]), DebutPeriode = Date(c["debut_periode"]),
        };
    }

    private static void Comparer(string fichier, byte[] xml)
    {
        var reference = CasPartages.Chemin("tests", "emission-fe", "ecrits", fichier);
        if (Environment.GetEnvironmentVariable("LOGIBTP_REGENERER_EMISSION") == "1")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(reference)!);
            File.WriteAllBytes(reference, xml);
        }
        Assert.True(File.Exists(reference), $"référence absente : {reference} (LOGIBTP_REGENERER_EMISSION=1)");
        Assert.Equal(File.ReadAllText(reference), Encoding.UTF8.GetString(xml));
    }

    [Theory]
    [MemberData(nameof(Noms))]
    public void Piece_de_demonstration_construite_controlee_et_ecrite(string nom)
    {
        var c = Piece(nom);
        var e = Entree(c);
        var construite = EmissionFactureBtp.Construire(e);
        var f = construite.Facture;
        var controle = EmissionFactureBtp.Controler(e);
        Assert.Equal((c["attendu_emission"]?.AsArray() ?? []).Select(x => Texte(x)).ToList(), construite.Ecarts.Select(x => (string?)x.Regle).ToList());
        Assert.Equal((c["attendu_completude"]?.AsArray() ?? []).Select(x => Texte(x)).ToList(), controle.Completude.Select(x => (string?)x.Regle).ToList());
        if (c["attendu_emission"] is not null) return;

        // Sommes : la facture reprend les totaux du moteur (HT, TVA, TTC) ; situation en cumul : ceux de la période attendus.
        var t = c["attendu_totaux"];
        Assert.Equal(t is null ? e.Document.EntTotalHt : t["ht"]!.GetValue<decimal>(), f.Totaux.TotalHt);
        Assert.Equal(t is null ? e.Document.EntTotalTva : t["tva"]!.GetValue<decimal>(), f.Totaux.TotalTva);
        Assert.Equal(t is null ? e.Document.EntTotalTtc : t["ttc"]!.GetValue<decimal>(), f.Totaux.TotalTtc);
        Assert.True(controle.Bloquant);

        var cii = EcritureCii.Ecrire(f);
        var ubl = EcritureUbl.Ecrire(f);
        var attendu = JsonSerializer.Serialize(f, Comparaison);
        Assert.Equal(attendu, JsonSerializer.Serialize(LectureCii.Lire(cii) with { Specification = null }, Comparaison));
        Assert.Equal(attendu, JsonSerializer.Serialize(LectureUbl.Lire(ubl) with { Specification = null }, Comparaison));
        Comparer($"{nom}_CII.xml", cii);
        Comparer($"{nom}_UBL.xml", ubl);
    }

    [Fact]
    public void Types_et_cadres_des_pieces()
    {
        string Cadre(string n) { var f = EmissionFactureBtp.Construire(Entree(Piece(n))).Facture; return $"{f.TypeFacture} {f.CadreFacturation}"; }
        Assert.Equal("380 S1", Cadre("FACTURE"));
        Assert.Equal("381 S1", Cadre("AVOIR"));
        Assert.Equal("386 S1", Cadre("ACOMPTE"));
        Assert.Equal("380 M4", Cadre("DEFINITIVE"));
        Assert.Equal("503 S1", Cadre("AVOIR_ACOMPTE"));
        // Lot 27 : cadre attendu de chaque pièce qui le précise (B2G, cotraitant, sous-traitant, déjà payée).
        foreach (var p in J["pieces"]!.AsArray().Where(x => x!["cadre"] is not null))
        {
            Assert.Equal(Texte(p!["cadre"]), EmissionFactureBtp.Construire(Entree(p)).Facture.CadreFacturation);
        }
    }

    [Fact]
    public void B2g_code_service_engagement_et_regle_de_depot()
    {
        var e = Entree(Piece("B2G"));
        var f = EmissionFactureBtp.Construire(e).Facture;
        Assert.Equal(("SERVICES-TECHNIQUES", "ENG-2026-004512"), (f.References.Acheteur, f.References.Commande));
        Assert.Contains(f.Acheteur.Identifiants, i => i.Valeur == "21690000100015" && i.Schema == SchemaIdentifiant.Siret);
        Assert.Contains(f.Notes, n => n.CodeSujet == CodeNote.Traitement && n.Texte == Traitement.B2B);
        Assert.True(EmissionFactureBtp.Controler(e).Bloquant);
        Assert.Equal(RegleTraitement.B2G, EnvoiFactureBtp.RegleDepot(false, e.Acheteur?.TypeFe));
        Assert.Null(EnvoiFactureBtp.RegleDepot(false, "B2B"));
        Assert.Equal(RegleTraitement.ArchivageSeul, EnvoiFactureBtp.RegleDepot(true, "B2G"));
        // Sans engagement exigé : bloquant ; sans code service : avertissement ; sans SIRET : bloquant.
        var sans = EmissionFactureBtp.Construire(Entree(Piece("B2G_SANS_ENGAGEMENT"))).Ecarts;
        Assert.Equal([NiveauCompletude.Avertissement, NiveauCompletude.Bloquant], sans.Select(x => x.Niveau).ToList());
        var sansSiret = EmissionFactureBtp.Construire(e with { Acheteur = e.Acheteur! with { Siret = null } }).Ecarts;
        Assert.Equal(EcartsEmissionFe.SiretAbsent, Assert.Single(sansSiret).Regle);
    }

    [Fact]
    public void Cotraitance_et_sous_traitance_emises()
    {
        var co = EmissionFactureBtp.Construire(Entree(Piece("COTRAITANCE"))).Facture;
        var pj = Assert.Single(co.PiecesJointes);
        Assert.Equal((TypePieceJointe.RecapitulatifCotraitance, "text/csv"), (pj.Description, pj.TypeMime));
        Assert.Equal(ProfilFacture.En16931, co.Profil);
        var sans = EmissionFactureBtp.Construire(Entree(Piece("COTRAITANCE_SANS_RECAPITULATIF"))).Ecarts;
        Assert.Equal(NiveauCompletude.Avertissement, Assert.Single(sans).Niveau);
        var st = EmissionFactureBtp.Construire(Entree(Piece("SOUS_TRAITANCE"))).Facture;
        Assert.Equal((CadreFacturation.S5, ProfilFacture.ExtendedCtcFr, "SCI LES TILLEULS"), (st.CadreFacturation, st.Profil, st.Payeur?.RaisonSociale));
        Assert.All(st.DetailsTva, t => Assert.Equal(LogiBTP.FactureElectronique.CategorieTva.Autoliquidation, t.Categorie));
        // Payeur seulement pour un sous-traitant : ignoré pour un titulaire.
        var titulaire = Entree(Piece("SOUS_TRAITANCE"));
        titulaire = titulaire with { Parametres = titulaire.Parametres with { Situation = SituationsCadreFe.Depot, Cadre = CadreFacturation.M1 } };
        Assert.Null(EmissionFactureBtp.Construire(titulaire).Facture.Payeur);
    }

    [Fact]
    public void Deja_payee_par_acompte_de_tresorerie()
    {
        var f = EmissionFactureBtp.Construire(Entree(Piece("DEJA_PAYEE"))).Facture;
        Assert.Equal((CadreFacturation.S2, 1200m, 0m), (f.CadreFacturation, f.Totaux.DejaPaye!.Value, f.Totaux.NetAPayer));
        Assert.Equal(new DateOnly(2026, 11, 12), f.DateEcheance);
    }

    [Fact]
    public void Facture_ouvrage_option_et_pied()
    {
        var f = EmissionFactureBtp.Construire(Entree(Piece("FACTURE"))).Facture;
        // Ouvrage facturé seul (ses composantes non), option hors total exclue ; remise de pied répartie par taux ; retenue hors facture (note ABU, BT-20).
        Assert.Equal(["Dalle béton armé", "Isolation des combles"], f.Lignes.Select(l => l.Nom).ToList());
        Assert.Equal(["MTK", "MTK"], f.Lignes.Select(l => l.Unite).ToList());
        Assert.All(f.RemisesCharges, r => { Assert.False(r.Charge); Assert.Equal("Remise commerciale", r.Motif); });
        Assert.Equal(2, f.RemisesCharges.Count);
        Assert.Equal(f.Totaux.TotalTtc, f.Totaux.NetAPayer);
        Assert.Equal("Chantier Les Tilleuls", f.Livraison?.Nom);
        Assert.Equal("CMD-4512", f.References.Commande);
        Assert.Equal(new MoyenPaiement(MoyenPaiementFe.Virement, "F-2026-0101", "FR7630006000011234567890189", "AGRIFRPP"), f.MoyensPaiement.Single());
        Assert.Contains(f.Notes, n => n.CodeSujet == CodeNote.Traitement && n.Texte == Traitement.B2B);
    }

    [Fact]
    public void Definitive_et_avoirs_references()
    {
        var def = EmissionFactureBtp.Construire(Entree(Piece("DEFINITIVE"))).Facture;
        Assert.Equal([new FactureAnterieure("FA-2026-0003", new DateOnly(2026, 10, 5))], def.FacturesAnterieures);
        var reprises = def.Lignes.Where(l => l.MontantNet < 0).ToList();
        Assert.Equal(2, reprises.Count);
        Assert.All(reprises, l => { Assert.Equal(-1, l.Quantite); Assert.True(l.PrixNet > 0); });
        Assert.Equal(-2000m, reprises.Sum(l => l.MontantNet));
        Assert.Empty(def.RemisesCharges);
        var avoir = EmissionFactureBtp.Construire(Entree(Piece("AVOIR"))).Facture;
        Assert.Equal("F-2026-0101", avoir.FacturesAnterieures.Single().Numero);
        Assert.Null(avoir.DateEcheance);
        Assert.True(avoir.Totaux.TotalHt > 0);
    }

    [Fact]
    public void Situation_en_periode_pied_btp_et_references()
    {
        var e = Entree(Piece("SITUATION_PERIODE"));
        var f = EmissionFactureBtp.Construire(e).Facture;
        Assert.Equal("380 S1", $"{f.TypeFacture} {f.CadreFacturation}");
        // Ligne de période nulle (réseaux) omise ; montants et quantités de la période.
        Assert.Equal(["Terrassement en pleine masse", "Semelles de fondation", "Isolation des combles"], f.Lignes.Select(l => l.Nom).ToList());
        Assert.Equal([500m, 462.96m, 333.33m], f.Lignes.Select(l => l.MontantNet).ToList());
        Assert.Equal([20m, 3m], f.Lignes.Take(2).Select(l => l.Quantite).ToList());
        // Compte prorata HT (avancement global) : remise du document par taux, motif = libellé du poste.
        Assert.All(f.RemisesCharges, r => { Assert.False(r.Charge); Assert.Equal("Compte prorata", r.Motif); });
        Assert.Equal(e.Lignes.Single(l => l.LigId == 5).LigMontantHt, -f.RemisesCharges.Sum(r => r.Montant));
        // Retenue et paiement direct hors facture : total porté, conditions de paiement, retenue en note ABU.
        Assert.Equal(f.Totaux.TotalTtc, f.Totaux.NetAPayer);
        Assert.Null(f.Totaux.DejaPaye);
        var retenue = e.Lignes.Single(l => l.LigId == 8).LigMontantHt!.Value;
        var note = Assert.Single(f.Notes, n => n.CodeSujet == CodeNote.Reserve);
        Assert.Equal($"Retenue de garantie (5 %) : {retenue:0.00} EUR".Replace(',', '.'), note.Texte);
        Assert.Equal($"30 jours fin de mois ; {note.Texte} ; Paiement direct – Électricité Martin : -300.00 EUR", f.ConditionsPaiement);
        Assert.Equal(e.Document.EntNetAPayer, f.Totaux.TotalTtc + retenue - 300m);
        // Période BG-14 et références du chantier, du marché et du projet.
        Assert.Equal(new Periode(new DateOnly(2026, 10, 31), new DateOnly(2026, 11, 30)), f.Periode);
        Assert.Equal(("CH-2026-002", "M-2026-002-1", "P-2026-014", "CH-2026-002"), (f.References.Projet, f.References.Contrat, f.References.AppelOffres, f.References.Objet));
    }

    [Fact]
    public void Situation_en_cumul_emise_en_periode()
    {
        var e = Entree(Piece("SITUATION_CUMUL"));
        var periode = EmissionFactureBtp.Construire(Entree(Piece("SITUATION_PERIODE"))).Facture;
        var f = EmissionFactureBtp.Construire(e).Facture;
        Assert.Equal("C", e.Document.EntAvtPresentation);
        // Mêmes lignes de période que la facture d'avancement, quel que soit le cumul porté par la pièce.
        Assert.Equal(periode.Lignes.Select(l => (l.Nom, l.MontantNet, l.Quantite)), f.Lignes.Select(l => (l.Nom, l.MontantNet, l.Quantite)));
        Assert.True(e.Document.EntTotalHt > f.Totaux.TotalHt);
        // TVA de chaque taux recalculée sur la base de la période (BR-CO-17 exact), sommes BR-CO sans écart.
        Assert.All(f.DetailsTva, t => Assert.Equal(ArrondiCalcul.Arrondir(t.Base * t.Taux!.Value / 100m, 2), t.Montant));
        Assert.Empty(ReglesCompletude.Controler(f, true));
        // Remise de pied en % sans avancement répartie par taux en plus du compte prorata.
        Assert.Contains(f.RemisesCharges, r => r.Motif == "Compte prorata ; Remise de fin de chantier");
        Assert.Equal(new Periode(new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 30)), f.Periode);
        Assert.Single(f.Notes, n => n.CodeSujet == CodeNote.Reserve);
    }

    [Fact]
    public void Autoliquidation_categorie_AE_taux_zero()
    {
        var f = EmissionFactureBtp.Construire(Entree(Piece("AUTOLIQUIDATION"))).Facture;
        var t = f.DetailsTva.Single();
        Assert.Equal((LogiBTP.FactureElectronique.CategorieTva.Autoliquidation, 0m, 0m, "VATEX-FR-AE"), (t.Categorie, t.Taux!.Value, t.Montant, t.CodeExoneration));
        Assert.Equal(f.Totaux.TotalHt, f.Totaux.TotalTtc);
    }

    [Fact]
    public void Avoir_saisi_en_negatif_ecrit_en_positif()
    {
        var e = Entree(Piece("AVOIR"));
        foreach (var l in e.Lignes) { l.LigMontantHt = -l.LigMontantHt; }
        foreach (var t in e.Tva) { t.TvaBaseHt = -t.TvaBaseHt; t.TvaMontantNet = -t.TvaMontantNet; }
        e.Document.EntTotalHt = -e.Document.EntTotalHt;
        var f = EmissionFactureBtp.Construire(e).Facture;
        Assert.True(f.Totaux.TotalHt > 0);
        Assert.All(f.Lignes, l => Assert.True(l.Quantite > 0 && l.MontantNet > 0));
    }

    [Fact]
    public void Niveau_selon_le_tiers()
    {
        Assert.True(EmissionFactureBtp.Bloquant(new PartieEmissionFe { RaisonSociale = "x", TypeFe = "B2G" }));
        Assert.True(EmissionFactureBtp.Bloquant(new PartieEmissionFe { RaisonSociale = "x" }));
        Assert.False(EmissionFactureBtp.Bloquant(new PartieEmissionFe { RaisonSociale = "x", TypeFe = "B2C" }));
        Assert.False(EmissionFactureBtp.Bloquant(null));
        Assert.Equal(Traitement.B2C, EmissionFactureBtp.TraitementDe("B2C"));
        Assert.Equal(Traitement.B2BInt, EmissionFactureBtp.TraitementDe("INTERNATIONAL"));
    }

    /// <summary>
    /// Base jetable (LOGIBTP_TEST_PG_JETABLE, manifeste chargé) : facture de vente validée insérée dans une transaction annulée,
    /// lue par EmissionFactureBtp (société de la base, client, taux, condition et mode de règlement), contrôlée et écrite.
    /// </summary>
    [Fact]
    public async Task Piece_de_la_base_lue_controlee_et_ecrite()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_JETABLE");
        if (string.IsNullOrEmpty(connexion)) return;
        await using var c = new NpgsqlConnection(connexion);
        await c.OpenAsync();
        await using (var k = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE column_name = 'tyd_fe_type_facture')", c))
        {
            if (await k.ExecuteScalarAsync() is not true) return;
        }
        await using var tx = await c.BeginTransactionAsync();
        long id;
        await using (var k = new NpgsqlCommand("""
            WITH d AS (INSERT INTO document (ent_tyd_id, ent_numero, ent_date, ent_std_id, ent_tiers_id, ent_cree_par, ent_total_ht, ent_total_tva,
                                             ent_total_ttc, ent_net_a_payer, ent_verrouille, ent_cpa_code, ent_mode_reglement)
                SELECT t.tyd_id, 'F-LOT22-1', DATE '2026-11-11', (SELECT std_id FROM statut_document ORDER BY std_id LIMIT 1),
                       (SELECT per_id FROM personne WHERE NOT per_societe_base AND per_siren IS NOT NULL ORDER BY per_id LIMIT 1), 'test',
                       150, 30, 180, 180, TRUE, '30J', 'CHEQUE'
                FROM type_document t WHERE t.tyd_code = 'V_FACTURE' RETURNING ent_id),
            l AS (INSERT INTO document_ligne (lig_ent_id, lig_ordre, lig_tyl_id, lig_libelle_html, lig_libelle_brut, lig_qte, lig_qte_vendue, lig_pv,
                                              lig_pv_remise, lig_montant_ht, lig_tva_id, lig_taux_tva, lig_type_prix, lig_unt_code)
                SELECT ent_id, 1, 3, 'Travaux', 'Travaux', 3, 3, 50, 50, 150, 1, 20, 'V', 'h' FROM d RETURNING lig_ent_id),
            t AS (INSERT INTO document_tva (tva_ent_id, tva_ttv_id, tva_code, tva_taux, tva_categorie, tva_base_ht, tva_montant, tva_montant_annulation, tva_montant_net)
                SELECT DISTINCT lig_ent_id, 1, 'T20', 20, 'N', 150, 30, 0, 30 FROM l RETURNING tva_ent_id)
            SELECT tva_ent_id FROM t
            """, c, tx))
        {
            id = (long)(await k.ExecuteScalarAsync())!;
        }
        var options = new DbContextOptionsBuilder<LogiBtpContext>().UseNpgsql(c).UseSnakeCaseNamingConvention().Options;
        await using var db = new LogiBtpContext(options);
        await db.Database.UseTransactionAsync(tx);
        // Référentiel du lot 21 (alias en snake_case, sans accolade : SqlQueryRaw du contexte en convention snake_case).
        Assert.Equal(TypeFacture.Facture, (await EmissionFeDonneesBtp.ReferentielAsync(db, default)).Types[TypesDocument.VFacture]);
        var controle = await EmissionFactureBtp.ControleAsync(db, id, default);
        Assert.True(controle.Applicable);
        Assert.Equal(TypeFacture.Facture, controle.TypeFacture);
        Assert.DoesNotContain(controle.Emission, e => e.Regle is EcartsEmissionFe.TiersAbsent or EcartsEmissionFe.SocieteAbsente or EcartsEmissionFe.TvaAbsente);
        var e = (await EmissionFactureBtp.EntreeAsync(db, id, default))!;
        var f = EmissionFactureBtp.Construire(e).Facture;
        Assert.Equal(("F-LOT22-1", 150m, 180m, "HUR"), (f.Numero, f.Totaux.TotalHt, f.Totaux.TotalTtc, f.Lignes.Single().Unite));
        Assert.Equal(MoyenPaiementFe.Cheque, f.MoyensPaiement.Single().Code);
        Assert.NotNull(f.ConditionsPaiement);
        var (xml, nom) = await EmissionFactureBtp.XmlAsync(db, id, Syntaxe.Ubl, default);
        Assert.Equal("F-LOT22-1_UBL.xml", nom);
        Assert.Equal(f.Numero, LectureUbl.Lire(xml).Numero);
        await tx.RollbackAsync();
    }

    /// <summary>
    /// Base jetable : deux factures d'avancement d'un marché de la démonstration (situations 1 et 2, transaction annulée) ;
    /// la seconde porte les codes du chantier, du marché et du projet, et sa période part du lendemain de la première.
    /// </summary>
    [Fact]
    public async Task Situation_de_la_base_references_et_periode()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_JETABLE");
        if (string.IsNullOrEmpty(connexion)) return;
        await using var c = new NpgsqlConnection(connexion);
        await c.OpenAsync();
        await using (var k = new NpgsqlCommand("""
            SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE column_name = 'tyd_fe_type_facture')
               AND EXISTS (SELECT 1 FROM marche m JOIN chantier h ON h.cha_id = m.mar_cha_id)
            """, c))
        {
            if (await k.ExecuteScalarAsync() is not true) return;
        }
        await using var tx = await c.BeginTransactionAsync();
        long id;
        string chantier, marche;
        string? projet;
        await using (var k = new NpgsqlCommand("""
            WITH m AS (SELECT m.mar_id, m.mar_code, h.cha_code, p.prj_code FROM marche m JOIN chantier h ON h.cha_id = m.mar_cha_id
                       LEFT JOIN projet p ON p.prj_id = h.cha_prj_id ORDER BY (p.prj_id IS NULL), m.mar_id LIMIT 1),
            d AS (INSERT INTO document (ent_tyd_id, ent_numero, ent_date, ent_std_id, ent_tiers_id, ent_cree_par, ent_total_ht, ent_total_tva,
                                       ent_total_ttc, ent_net_a_payer, ent_verrouille, ent_marche_id, ent_avt_presentation, ent_rang_avancement)
                SELECT t.tyd_id, v.numero, v.date, (SELECT std_id FROM statut_document ORDER BY std_id LIMIT 1),
                       (SELECT per_id FROM personne WHERE NOT per_societe_base AND per_siren IS NOT NULL ORDER BY per_id LIMIT 1), 'test',
                       100, 20, 120, 120, TRUE, m.mar_id, 'P', v.rang
                FROM type_document t, m, (VALUES ('F-LOT23-1', DATE '2026-10-31', 1), ('F-LOT23-2', DATE '2026-11-30', 2)) AS v(numero, date, rang)
                WHERE t.tyd_code = 'V_FACTURE_AVT' RETURNING ent_id, ent_rang_avancement)
            SELECT (SELECT ent_id FROM d WHERE ent_rang_avancement = 2), m.cha_code, m.mar_code, m.prj_code FROM m
            """, c, tx))
        await using (var r = await k.ExecuteReaderAsync())
        {
            Assert.True(await r.ReadAsync());
            id = r.GetInt64(0);
            chantier = r.GetString(1);
            marche = r.GetString(2);
            projet = r.IsDBNull(3) ? null : r.GetString(3);
        }
        var options = new DbContextOptionsBuilder<LogiBtpContext>().UseNpgsql(c).UseSnakeCaseNamingConvention().Options;
        await using var db = new LogiBtpContext(options);
        await db.Database.UseTransactionAsync(tx);
        var e = (await EmissionFactureBtp.EntreeAsync(db, id, default))!;
        Assert.Equal((chantier, marche, projet, new DateOnly(2026, 11, 1)), (e.Chantier, e.Marche, e.Projet, e.DebutPeriode));
        var f = EmissionFactureBtp.Construire(e).Facture;
        Assert.Equal(new Periode(new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 30)), f.Periode);
        Assert.Equal((chantier, marche), (f.References.Projet, f.References.Contrat));
        await tx.RollbackAsync();
    }

    /// <summary>
    /// Base jetable (lot 27, db/303 chargé) : marché de vente où nous sommes cotraitant avec un récapitulatif en GED (contenu sur
    /// un stockage temporaire) → S6 et pièce jointe embarquée ; même marché passé en sous-traitance avec un intervenant PAYEUR →
    /// S5, payeur et EXTENDED-CTC-FR ; client B2G exigeant l'engagement, sans référence externe → ENGAGEMENT_ABSENT bloquant.
    /// </summary>
    [Fact]
    public async Task Cotraitance_sous_traitance_et_b2g_de_la_base()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_JETABLE");
        if (string.IsNullOrEmpty(connexion)) return;
        await using var c = new NpgsqlConnection(connexion);
        await c.OpenAsync();
        await using (var k = new NpgsqlCommand("""
            SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE column_name = 'mar_fe_role') AND EXISTS (SELECT 1 FROM chantier)
            """, c))
        {
            if (await k.ExecuteScalarAsync() is not true) return;
        }
        var racine = Directory.CreateTempSubdirectory("logibtp-lot27-").FullName;
        try
        {
            var recap = Encoding.UTF8.GetBytes("membre;montant_ht\nBTP DEMO;24000.00\n");
            var empreinte = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(recap));
            var chemin = LogiBTP.Ged.StockageGed.CheminRelatif(empreinte);
            Directory.CreateDirectory(Path.Combine(racine, Path.GetDirectoryName(chemin)!));
            await File.WriteAllBytesAsync(Path.Combine(racine, chemin), recap);

            await using var tx = await c.BeginTransactionAsync();
            long id, client, payeur;
            await using (var k = new NpgsqlCommand("""
                WITH t AS (SELECT per_id FROM personne WHERE NOT per_societe_base AND per_siren IS NOT NULL ORDER BY per_id LIMIT 2),
                m AS (INSERT INTO marche (mar_code, mar_libelle, mar_cha_id, mar_tiers_id, mar_sens, mar_fe_role)
                      SELECT 'M-LOT27-1', 'Groupement', (SELECT cha_id FROM chantier ORDER BY cha_id LIMIT 1), (SELECT min(per_id) FROM t), 'V', 'COTRAITANT'
                      RETURNING mar_id, mar_tiers_id),
                d AS (INSERT INTO document (ent_tyd_id, ent_numero, ent_date, ent_std_id, ent_tiers_id, ent_cree_par, ent_total_ht, ent_total_tva,
                                           ent_total_ttc, ent_net_a_payer, ent_verrouille, ent_marche_id, ent_mode_reglement)
                      SELECT y.tyd_id, 'F-LOT27-1', DATE '2026-11-12', (SELECT std_id FROM statut_document ORDER BY std_id LIMIT 1),
                             m.mar_tiers_id, 'test', 150, 30, 180, 180, TRUE, m.mar_id, 'CHEQUE'
                      FROM type_document y, m WHERE y.tyd_code = 'V_FACTURE' RETURNING ent_id),
                l AS (INSERT INTO document_ligne (lig_ent_id, lig_ordre, lig_tyl_id, lig_libelle_html, lig_libelle_brut, lig_qte, lig_qte_vendue, lig_pv,
                                                  lig_pv_remise, lig_montant_ht, lig_tva_id, lig_taux_tva, lig_type_prix, lig_unt_code)
                      SELECT ent_id, 1, 3, 'Travaux', 'Travaux', 3, 3, 50, 50, 150, 1, 20, 'V', 'h' FROM d RETURNING lig_ent_id),
                v AS (INSERT INTO document_tva (tva_ent_id, tva_ttv_id, tva_code, tva_taux, tva_categorie, tva_base_ht, tva_montant, tva_montant_annulation, tva_montant_net)
                      SELECT DISTINCT lig_ent_id, 1, 'T20', 20, 'N', 150, 30, 0, 30 FROM l RETURNING tva_ent_id),
                i AS (INSERT INTO intervenant (itv_mar_id, itv_fin_code, itv_per_id) SELECT m.mar_id, 'PAYEUR', (SELECT max(per_id) FROM t) FROM m RETURNING itv_per_id)
                SELECT (SELECT tva_ent_id FROM v), (SELECT mar_tiers_id FROM m), (SELECT itv_per_id FROM i)
                """, c, tx))
            await using (var r = await k.ExecuteReaderAsync())
            {
                Assert.True(await r.ReadAsync());
                (id, client, payeur) = (r.GetInt64(0), r.GetInt64(1), r.GetInt64(2));
            }
            await using (var k = new NpgsqlCommand("""
                INSERT INTO contenu_ged (cge_empreinte, cge_taille, cge_chemin) VALUES (@e, @t, @c) ON CONFLICT DO NOTHING;
                WITH g AS (INSERT INTO document_ged (dge_titre, dge_categorie, dge_type_element, dge_id_element, dge_cree_par)
                           SELECT 'Récapitulatif', 'recapitulatif_cotraitance', 'marche', ent_marche_id::text, 'test' FROM document WHERE ent_id = @id
                           RETURNING dge_id)
                INSERT INTO version_ged (vge_document, vge_numero, vge_genre, vge_empreinte, vge_nom_fichier, vge_type_mime, vge_taille, vge_auteur)
                SELECT dge_id, 1, 'edition', @e, 'recapitulatif.csv', 'text/csv', @t, 'test' FROM g;
                """, c, tx))
            {
                k.Parameters.AddWithValue("e", empreinte);
                k.Parameters.AddWithValue("t", (long)recap.Length);
                k.Parameters.AddWithValue("c", chemin);
                k.Parameters.AddWithValue("id", id);
                await k.ExecuteNonQueryAsync();
            }
            var options = new DbContextOptionsBuilder<LogiBtpContext>().UseNpgsql(c).UseSnakeCaseNamingConvention().Options;
            await using var db = new LogiBtpContext(options);
            await db.Database.UseTransactionAsync(tx);

            // Cotraitant : S6, récapitulatif embarqué depuis le stockage ; sans stockage (bandeau) : référence seule.
            var e = (await EmissionFactureBtp.EntreeAsync(db, id, default, new LogiBTP.Ged.StockageGed(racine)))!;
            var f = EmissionFactureBtp.Construire(e).Facture;
            Assert.Equal(CadreFacturation.S6, f.CadreFacturation);
            var pj = Assert.Single(f.PiecesJointes);
            Assert.Equal((TypePieceJointe.RecapitulatifCotraitance, "recapitulatif.csv"), (pj.Description, pj.NomFichier));
            Assert.Equal(recap, pj.Contenu);
            Assert.Null(Assert.Single((await EmissionFactureBtp.EntreeAsync(db, id, default))!.PiecesJointes).Contenu);
            Assert.DoesNotContain(EmissionFactureBtp.Construire(e).Ecarts, x => x.Regle == EcartsEmissionFe.RecapitulatifAbsent);
            Assert.Equal(f.Numero, LectureCii.Lire(EcritureCii.Ecrire(f)).Numero);

            // Sous-traitant : S5, payeur = intervenant PAYEUR du marché, profil EXTENDED-CTC-FR.
            await db.Database.ExecuteSqlRawAsync("UPDATE marche SET mar_fe_role = 'SOUS_TRAITANT' WHERE mar_code = 'M-LOT27-1'");
            f = EmissionFactureBtp.Construire((await EmissionFactureBtp.EntreeAsync(db, id, default))!).Facture;
            Assert.Equal((CadreFacturation.S5, ProfilFacture.ExtendedCtcFr), (f.CadreFacturation, f.Profil));
            Assert.NotNull(f.Payeur);
            Assert.Empty(f.PiecesJointes);

            // Titulaire d'une structure publique exigeant l'engagement : bloquant sans référence externe.
            await db.Database.ExecuteSqlRawAsync("UPDATE marche SET mar_fe_role = NULL WHERE mar_code = 'M-LOT27-1'");
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE personne SET per_fe_type = 'B2G', per_fe_engagement = TRUE, per_fe_code_service = 'SERVICE-1' WHERE per_id = {0}", client);
            var controle = await EmissionFactureBtp.ControleAsync(db, id, default);
            Assert.Equal(CadreFacturation.S1, controle.Cadre);
            Assert.Contains(controle.Emission, x => x.Regle == EcartsEmissionFe.EngagementAbsent && x.Niveau == NiveauCompletude.Bloquant);
            await db.Database.ExecuteSqlRawAsync("UPDATE document SET ent_reference_externe = 'ENG-42' WHERE ent_id = {0}", id);
            e = (await EmissionFactureBtp.EntreeAsync(db, id, default))!;
            f = EmissionFactureBtp.Construire(e).Facture;
            Assert.DoesNotContain(EmissionFactureBtp.Construire(e).Ecarts, x => x.Regle == EcartsEmissionFe.EngagementAbsent);
            Assert.Equal(("SERVICE-1", "ENG-42"), (f.References.Acheteur, f.References.Commande));
            Assert.Equal(RegleTraitement.B2G, EnvoiFactureBtp.RegleDepot(false, e.Acheteur?.TypeFe));
            Assert.NotEqual(client, payeur);
            await tx.RollbackAsync();
        }
        finally
        {
            Directory.Delete(racine, true);
        }
    }
}
