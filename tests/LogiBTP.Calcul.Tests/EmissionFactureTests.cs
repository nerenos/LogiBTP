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
/// Pièces de vente de démonstration → facture électronique (lot 22, Btp/EmissionFactureBtp.cs), jeu tests/emission-fe/02_pieces.json :
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
            DeduitAcompte = c["deduit_acompte"]?.GetValue<bool>() ?? false, Mentions = mentions,
        })!;
        var p = J["paiement"]!;
        return new EntreeFactureBtp
        {
            Document = d, Lignes = r.Lignes, Tva = r.Tva, Taux = taux, Parametres = parametres,
            Vendeur = Partie(J["vendeur"]!), Acheteur = c["sans_acheteur"]?.GetValue<bool>() == true ? null : Partie(J["acheteur"]!),
            AdresseLivraison = Adresse(c["livraison"]?["adresse"]), NomLivraison = Texte(c["livraison"]?["nom"]),
            ConditionsPaiement = Texte(p["conditions"]), Echeance = Date(c["echeance"]), ModeReglement = Texte(p["mode"]),
            Iban = c["sans_iban"]?.GetValue<bool>() == true ? null : Texte(p["iban"]), Bic = Texte(p["bic"]),
            Origines = (c["origines"]?.AsArray() ?? []).Select(o => new AnterieureEmissionFe(Texte(o!["numero"]), Date(o["date"]))).ToList(),
            Acomptes = (c["acomptes"]?.AsObject() ?? []).ToDictionary(x => x.Key, x => (AnterieureEmissionFe?)new AnterieureEmissionFe(Texte(x.Value!["numero"]), Date(x.Value["date"]))),
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

        // Sommes : la facture reprend les totaux du moteur (HT, TVA, TTC).
        Assert.Equal(e.Document.EntTotalHt, f.Totaux.TotalHt);
        Assert.Equal(e.Document.EntTotalTva, f.Totaux.TotalTva);
        Assert.Equal(e.Document.EntTotalTtc, f.Totaux.TotalTtc);
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
    }

    [Fact]
    public void Facture_ouvrage_option_et_pied()
    {
        var f = EmissionFactureBtp.Construire(Entree(Piece("FACTURE"))).Facture;
        // Ouvrage facturé seul (ses composantes non), option hors total exclue ; remise de pied répartie par taux ; retenue hors facture.
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
}
