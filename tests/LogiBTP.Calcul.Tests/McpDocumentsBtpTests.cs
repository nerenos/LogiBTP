using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Api.Btp;
using LogiBTP.Bibliotheque.Web;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Mcp;
using LogiBTP.Mcp.Web;
using LogiBTP.Metres;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Outils d'écriture des devis pour les agents IA (plans/mcp.md, lot 7) sans base : opérations de lignes, enchaînement des
/// routes (verrou, version, entête inchangée), cibles de transformation, liste blanche exacte, prix des achats sous COUTS.
/// </summary>
public class McpDocumentsBtpTests
{
    private static readonly SpecialisationMcpBtp Specialisation = new();
    private static readonly JsonSerializerOptions Json = OperationsLignesBtp.Json;
    private static readonly List<TauxTva> Taux = [new() { TtvId = 7, TtvCode = "N10" }, new() { TtvId = 8, TtvCode = "N20", TtvDefaut = true }];

    private static DocumentLigneBtp L(long id, long? parent, short type, int ordre, int? tva = null) =>
        new() { LigId = id, LigEntId = 10, LigParentId = parent, LigTylId = type, LigOrdre = ordre, LigTvaId = tva, LigQte = TL.EstChiffree(new DocumentLigne { LigTylId = type }) ? 1 : null };

    /// <summary>Devis : titre 1 (élément 2 métré, ouvrage 3 et sa composante 4), titre 5 (TVA 7), pied 9.</summary>
    private static DocumentCompletBtp Devis()
    {
        var d = new DocumentCompletBtp
        {
            Document = new DocumentBtp { EntId = 10, EntTydId = 1, EntStdId = 1, EntVersion = 3, EntNumero = "DV-1" },
            Lignes = [L(1, null, TL.Titre, 1), L(2, 1, TL.Element, 1, 8), L(3, 1, TL.Ouvrage, 2, 8), L(4, 3, TL.Element, 1), L(5, null, TL.Titre, 2, 7), L(9, null, TL.PiedHt, 3)],
            Metres = [new Metre { MtrId = 50, MtrLigId = 2 }],
            Variables = [new VariableDefinition { VarId = 60, VarEntId = 10, VarMtrId = 50, VarNom = "L" }],
        };
        d.Lignes[1].LigQteSource = "M";
        d.Lignes[1].LigMtrId = 50;
        return d;
    }

    private static JsonElement J(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static ElementDetailDto Element(long id, string type, string? composition = null, string? uniteVente = "M2") =>
        new(id, 1, "GEN", $"E{id}", type, "<p>Garde-corps</p>", "Garde-corps", null, 4, "U", null, uniteVente, J("""[{"unite":"M2","formule":"2"}]"""),
            new Dictionary<string, decimal?> { ["hauteur"] = 2500m, ["poids"] = 12m }, 10m, 1.1m, 11m, 1.2m, 20m, false, 1m, 13.2m,
            composition is null ? null : J(composition), true);

    private const string CompositionOuvrage = """
        {"lignes":[{"lig_id":1,"lig_parent_id":null,"lig_tyl_id":2,"lig_libelle_html":"x","lig_origine_id":77},
                   {"lig_id":2,"lig_parent_id":1,"lig_tyl_id":3,"lig_qte":3,"lig_tva_id":7,"lig_mtr_id":5,"lig_numerotation":"1.1"}],
         "metres":[{"mtr_id":5,"mtr_lig_id":2}],"variables":[{"var_id":9,"var_lig_id":2,"var_nom":"L"}]}
        """;

    private static readonly Dictionary<long, ElementDetailDto> Elements = new()
    {
        [100] = Element(100, "ARTICLE"),
        [200] = Element(200, "OUVRAGE", CompositionOuvrage),
        [300] = Element(300, "TEXTE"),
    };

    private static void Appliquer(DocumentCompletBtp d, string operations) =>
        OperationsLignesBtp.Appliquer(d, JsonNode.Parse(operations)!.AsArray(), new OperationsLignesBtp.Contexte(Elements, Taux));

    private static List<long> Enfants(DocumentCompletBtp d, long? parent) =>
        d.Lignes.Where(l => l.LigParentId == parent).OrderBy(l => l.LigOrdre).Select(l => l.LigId).ToList();

    [Fact]
    public void Operations_de_lignes_appliquees_au_document_lu()
    {
        var d = Devis();
        Appliquer(d, """
            [{"op":"ajouter","element_id":100,"quantite":4,"apres_id":2},
             {"op":"ajouter","element_id":200,"parent_id":5},
             {"op":"quantite","lig_id":3,"valeur":"5.5"},
             {"op":"designation","lig_id":3,"valeur":"Garde-corps <acier>"},
             {"op":"remise","lig_id":3,"pourcentage":5},
             {"op":"deplacer","lig_id":1,"apres_id":5},
             {"op":"supprimer","lig_id":2}]
            """);
        // Article : unité de vente, PA converti (ratio 2), coefficients, lien, données techniques en mètres, taux par défaut.
        var a = d.Lignes.Single(l => l.LigArtId == 100);
        Assert.True(a.LigId < 0);
        Assert.Equal((long?)1, a.LigParentId);
        Assert.Equal(TL.Element, a.LigTylId);
        Assert.Equal(4m, a.LigQte);
        Assert.Equal("M2", a.LigUntCode);
        Assert.Equal(20m, a.LigPa);
        Assert.Equal(1.1m, a.LigCoefFg);
        Assert.Equal(2.5m, a.LigHauteur);
        Assert.Equal("E100", a.LigCode);
        Assert.Equal(8, a.LigTvaId);
        Assert.Equal(100, a.LigProprietes!.RootElement.GetProperty("element").GetProperty("id").GetInt64());
        // Ouvrage : composition renumérotée (ID temporaires, sans origine), taux du titre, composantes sans taux, métré et variable suivis.
        var o = d.Lignes.Single(l => l.LigArtId == 200);
        Assert.Equal((long?)5, o.LigParentId);
        Assert.Equal(TL.Ouvrage, o.LigTylId);
        Assert.Equal(7, o.LigTvaId);
        Assert.Null(o.LigOrigineId);
        var c = d.Lignes.Single(l => l.LigParentId == o.LigId);
        Assert.True(c.LigId < 0);
        Assert.Null(c.LigTvaId);
        Assert.Null(c.LigNumerotation);
        Assert.Equal(c.LigId, d.Metres.Single(m => m.MtrId == c.LigMtrId).MtrLigId);
        Assert.Contains(d.Variables, v => v.VarLigId == c.LigId && v.VarEntId == 10 && v.VarId < 0);
        // Quantité, désignation (texte échappé), remise en coefficient.
        var ouvrage = d.Lignes.Single(l => l.LigId == 3);
        Assert.Equal(5.5m, ouvrage.LigQte);
        Assert.Equal("Garde-corps &lt;acier&gt;", ouvrage.LigLibelleHtml);
        Assert.Equal(0.95m, ouvrage.LigCoefRemise);
        // Chapitre déplacé après le titre 5, avant le pied ; ligne 2 supprimée avec son métré et sa variable.
        Assert.Equal([5L, 1L, 9L], Enfants(d, null));
        Assert.Equal([a.LigId, 3L], Enfants(d, 1));
        Assert.DoesNotContain(d.Lignes, l => l.LigId == 2);
        Assert.DoesNotContain(d.Metres, m => m.MtrId == 50);
        Assert.DoesNotContain(d.Variables, v => v.VarId == 60);
        // Entête jamais touché.
        Assert.Equal(("DV-1", 1, 3), (d.Document.EntNumero, d.Document.EntStdId, d.Document.EntVersion));
    }

    [Fact]
    public void Ajout_par_defaut_a_la_fin_du_corps_avant_le_pied()
    {
        var d = Devis();
        Appliquer(d, """[{"op":"ajouter","element_id":100}]""");
        var a = d.Lignes.Single(l => l.LigArtId == 100);
        Assert.Equal([1L, 5L, a.LigId, 9L], Enfants(d, null));
        Assert.Equal(1m, a.LigQte);
    }

    [Theory]
    [InlineData("""{"op":"quantite","lig_id":1,"valeur":2}""", ErreursMcpBtp.Ligne)]
    [InlineData("""{"op":"quantite","lig_id":2}""", ErreursMcpBtp.Operation)]
    [InlineData("""{"op":"remise","lig_id":2,"pourcentage":100}""", ErreursMcpBtp.Operation)]
    [InlineData("""{"op":"designation","lig_id":2,"valeur":" "}""", ErreursMcpBtp.Operation)]
    [InlineData("""{"op":"supprimer","lig_id":42}""", ErreursMcpBtp.Ligne)]
    [InlineData("""{"op":"deplacer","lig_id":4,"parent_id":5}""", ErreursMcpBtp.Ligne)]
    [InlineData("""{"op":"deplacer","lig_id":1,"apres_id":2}""", ErreursMcpBtp.Ligne)]
    [InlineData("""{"op":"deplacer","lig_id":9,"parent_id":5}""", ErreursMcpBtp.Ligne)]
    [InlineData("""{"op":"deplacer","lig_id":2}""", ErreursMcpBtp.Operation)]
    [InlineData("""{"op":"ajouter","element_id":100,"parent_id":3}""", ErreursMcpBtp.Ligne)]
    [InlineData("""{"op":"ajouter","element_id":100,"apres_id":4}""", ErreursMcpBtp.Ligne)]
    [InlineData("""{"op":"ajouter","element_id":300}""", ErreursMcpBtp.Element)]
    [InlineData("""{"op":"ajouter","element_id":999}""", ErreursMcpBtp.Element)]
    [InlineData("""{"op":"valider"}""", ErreursMcpBtp.Operation)]
    public void Operation_invalide_refusee(string operation, string code)
    {
        var e = Assert.Throws<ErreurOutilMcp>(() => Appliquer(Devis(), $"[{operation}]"));
        Assert.Equal(code, e.Code);
        Assert.Equal(422, e.Statut);
    }

    // ------------------------------------------------------------------ enchaînement des routes (serveur simulé)

    /// <summary>Serveur simulé : réponses par « MÉTHODE chemin » (sans requête), appels et corps notés.</summary>
    private sealed class Serveur
    {
        public readonly Dictionary<string, Func<string?, ReponseInterne>> Routes = [];
        public readonly List<(string Methode, string Chemin, string? Corps)> Appels = [];

        public ExecutionOutil Execution(string outil, string arguments, params string[] gardesFous) =>
            new(Specialisation.Outil(outil)!, ServiceMcp.Declares(Specialisation.Outil(outil)!, JsonNode.Parse(arguments)!.AsObject()
                .ToDictionary(kv => kv.Key, kv => kv.Value?.DeepClone())), gardesFous, (m, chemin, corps, _) =>
            {
                Appels.Add((m, chemin, corps));
                var cle = $"{m} {chemin.Split('?')[0]}";
                return Task.FromResult(Routes.TryGetValue(cle, out var f) ? f(corps) : new ReponseInterne(404, """{"code":"INTROUVABLE"}"""));
            });

        public void Json(string cle, object? valeur) => Routes[cle] = _ => new ReponseInterne(200, JsonSerializer.Serialize(valeur, OperationsLignesBtp.Json));
    }

    private static DefinitionType Definition(int tyd, string code, int? intermediaire = null) => new()
    {
        Type = new TypeDocument { TydId = tyd, TydCode = code, TydFamille = FamillesDocument.Vente },
        Statuts = [new StatutDocument { StdId = 1, StdTydId = tyd, StdCode = StatutsDocument.Brouillon }],
        TauxTva = Taux,
        Transformations = [new TransformationAutorisee { TraSourceTydId = 1, TraCibleTydId = 2, TraIntermediaireTydId = intermediaire }],
        Modeles = [new ModeleDto("COMPLET", "Complet")],
    };

    private static Serveur ServeurDevis(Func<DocumentCompletBtp, DocumentCompletBtp>? enregistrer = null)
    {
        var s = new Serveur();
        s.Json("GET /api/types-document/V_DEVIS/definition", Definition(1, TypesDocument.VDevis));
        s.Json("GET /api/types-document/V_COMMANDE/definition", Definition(2, TypesDocument.VCommande));
        s.Json("GET /api/documents/10", Devis());
        s.Routes["GET /api/documents/10/verrou"] = _ => new ReponseInterne(200, "null");
        s.Json("POST /api/documents/10/verrou", new { ok = true });
        s.Routes["DELETE /api/documents/10/verrou"] = _ => new ReponseInterne(204, "");
        s.Json("GET /api/documents/10/avertissements", new[] { new { code = "MONTANT_NUL" } });
        s.Json("GET /api/bibliotheque/elements/100", Elements[100]);
        s.Routes["PUT /api/documents/10"] = corps =>
        {
            var d = JsonSerializer.Deserialize<DocumentCompletBtp>(corps!, OperationsLignesBtp.Json)!;
            d.Document.EntTotalHt = 123.45m;
            d.Document.EntVersion++;
            return new ReponseInterne(200, JsonSerializer.Serialize(new { document = enregistrer?.Invoke(d) ?? d, avertissements = new[] { new { code = "SANS_PRIX" } } }, OperationsLignesBtp.Json));
        };
        return s;
    }

    [Fact]
    public async Task Modifier_lignes_verrou_lecture_put_avec_la_version_lue_puis_verrou_rendu()
    {
        var s = ServeurDevis();
        var r = await McpDocumentsBtp.ModifierLignesAsync(s.Execution("modifier_lignes",
            """{"id":10,"version":3,"operations":[{"op":"ajouter","element_id":100}],"ent_std_id":9,"statut":"VALIDE"}"""), default);
        Assert.Equal(200, r.Statut);
        Assert.Equal(["GET /api/types-document/V_DEVIS/definition", "GET /api/documents/10/verrou", "POST /api/documents/10/verrou", "GET /api/documents/10",
            "GET /api/bibliotheque/elements/100", "PUT /api/documents/10", "GET /api/documents/10/avertissements", "DELETE /api/documents/10/verrou"],
            s.Appels.Select(a => $"{a.Methode} {a.Chemin.Split('?')[0]}"));
        // PUT : version lue, entête du document lu (statut d'origine), ligne ajoutée.
        var put = JsonNode.Parse(s.Appels.Single(a => a.Methode == "PUT").Corps!)!;
        Assert.Equal(3, put["document"]!["ent_version"]!.GetValue<int>());
        Assert.Equal(1, put["document"]!["ent_std_id"]!.GetValue<int>());
        Assert.Contains(put["lignes"]!.AsArray(), l => l!["lig_art_id"]?.GetValue<long>() == 100);
        // Verrou rendu avec le jeton pris.
        var jeton = JsonNode.Parse(s.Appels.Single(a => a.Methode == "POST").Corps!)!["jeton"]!.GetValue<string>();
        Assert.EndsWith("jeton=" + jeton, s.Appels.Last().Chemin);
        // Réponse : totaux du serveur, statut, avertissements de l'enregistrement et de gestion, lignes.
        var o = JsonNode.Parse(r.Corps)!;
        Assert.Equal(123.45m, o["ent_total_ht"]!.GetValue<decimal>());
        Assert.Equal(StatutsDocument.Brouillon, o["statut"]!.GetValue<string>());
        Assert.Equal(["SANS_PRIX", "MONTANT_NUL"], o["avertissements"]!.AsArray().Select(x => x!["code"]!.GetValue<string>()));
        Assert.Equal(7, o["lignes"]!.AsArray().Count);
        Assert.Equal("/document/10", Specialisation.Adresse(Specialisation.Outil("modifier_lignes")!, o.AsObject()));
    }

    [Fact]
    public async Task Version_depassee_409_sans_enregistrement_verrou_rendu()
    {
        var s = ServeurDevis();
        var r = await McpDocumentsBtp.ModifierLignesAsync(s.Execution("modifier_lignes", """{"id":10,"version":2,"operations":[]}"""), default);
        Assert.Equal(409, r.Statut);
        Assert.Equal(ErreursMcpBtp.Version, JsonNode.Parse(r.Corps)!["code"]!.GetValue<string>());
        Assert.DoesNotContain(s.Appels, a => a.Methode == "PUT");
        Assert.Equal("DELETE", s.Appels.Last().Methode);
    }

    [Fact]
    public async Task Document_ouvert_meme_par_le_delegant_refuse_sans_prendre_le_verrou()
    {
        var s = ServeurDevis();
        s.Json("GET /api/documents/10/verrou", new { utilisateur = "marie", meme_utilisateur = true });
        var r = await McpDocumentsBtp.ModifierLignesAsync(s.Execution("modifier_lignes", """{"id":10,"operations":[]}"""), default);
        Assert.Equal(409, r.Statut);
        Assert.Equal(ErreursMcpBtp.Verrou, JsonNode.Parse(r.Corps)!["code"]!.GetValue<string>());
        Assert.DoesNotContain(s.Appels, a => a.Methode is "POST" or "PUT" or "DELETE");
    }

    [Fact]
    public async Task Entete_changee_par_l_enregistrement_signalee()
    {
        var s = ServeurDevis(d => { d.Document.EntStdId = 4; d.Document.EntVerrouille = true; return d; });
        var r = await McpDocumentsBtp.ModifierLignesAsync(s.Execution("modifier_lignes", """{"id":10,"operations":[]}"""), default);
        Assert.Equal(ErreursMcpBtp.EnteteModifiee, JsonNode.Parse(r.Corps)!["code"]!.GetValue<string>());
        Assert.Equal("DELETE", s.Appels.Last().Methode);
    }

    [Fact]
    public async Task Pas_de_devis_pas_de_modification()
    {
        var s = ServeurDevis();
        var autre = Devis();
        autre.Document.EntTydId = 5;
        s.Json("GET /api/documents/10", autre);
        var r = await McpDocumentsBtp.ModifierLignesAsync(s.Execution("modifier_lignes", """{"id":10,"operations":[]}"""), default);
        Assert.Equal(ErreursMcpBtp.TypeNonPermis, JsonNode.Parse(r.Corps)!["code"]!.GetValue<string>());
        Assert.DoesNotContain(s.Appels, a => a.Methode == "PUT");
    }

    [Fact]
    public async Task Creer_depuis_un_modele_avec_contenu_en_une_fois()
    {
        var s = ServeurDevis();
        s.Routes["POST /api/documents/avec-contenu"] = corps =>
        {
            var c = JsonNode.Parse(corps!)!;
            var d = c["contenu"].Deserialize<DocumentCompletBtp>(OperationsLignesBtp.Json)!;
            d.Document.EntId = 11;
            d.Document.EntStdId = 1;
            return new ReponseInterne(200, JsonSerializer.Serialize(new { document = d }, OperationsLignesBtp.Json));
        };
        var r = await McpDocumentsBtp.CreerDevisAsync(s.Execution("creer_devis",
            """{"modele":"COMPLET","tiers_id":82,"objet":"Garde-corps","operations":[{"op":"ajouter","element_id":100,"quantite":24}]}"""), default);
        Assert.Equal(200, r.Statut);
        var corps = JsonNode.Parse(s.Appels.Single(a => a.Chemin == McpDocumentsBtp.RouteAvecContenu).Corps!)!;
        Assert.Equal(1, corps["creation"]!["ent_tyd_id"]!.GetValue<int>());
        Assert.Equal(82, corps["creation"]!["ent_tiers_id"]!.GetValue<long>());
        Assert.Equal("COMPLET", corps["contenu"]!["document"]!["ent_modele"]!.GetValue<string>());
        Assert.Equal(24m, corps["contenu"]!["lignes"]![0]!["lig_qte"]!.GetValue<decimal>());
        Assert.Equal(11, JsonNode.Parse(r.Corps)!["ent_id"]!.GetValue<long>());

        var inconnu = await McpDocumentsBtp.CreerDevisAsync(s.Execution("creer_devis", """{"modele":"AUTRE"}"""), default);
        Assert.Equal(ErreursMcpBtp.Modele, JsonNode.Parse(inconnu.Corps)!["code"]!.GetValue<string>());
        var deux = await McpDocumentsBtp.CreerDevisAsync(s.Execution("creer_devis", """{"modele":"COMPLET","source_id":10}"""), default);
        Assert.Equal(ErreursMcpBtp.Source, JsonNode.Parse(deux.Corps)!["code"]!.GetValue<string>());
    }

    [Fact]
    public void Copie_vers_un_autre_tiers_sans_origine_ni_coordonnees()
    {
        var source = Devis();
        source.Document.EntTiersId = 5;
        source.Document.EntContactClient = JsonDocument.Parse("""{"nom":"X"}""");
        source.Lignes.ForEach(l => l.LigOrigineId = 999);
        var c = McpDocumentsBtp.Contenu(source, 82, "Nouvel objet");
        Assert.Equal((long?)82, c.Document.EntTiersId);
        Assert.Null(c.Document.EntContactClient);
        Assert.Equal(0, c.Document.EntId);
        Assert.All(c.Lignes, l => { Assert.True(l.LigId < 0); Assert.Null(l.LigOrigineId); });
        var composante = c.Lignes.Single(l => l.LigTylId == TL.Element && c.Lignes.Any(p => p.LigId == l.LigParentId && p.LigTylId == TL.Ouvrage));
        Assert.True(composante.LigParentId < 0);
        Assert.Equal(c.Lignes.Single(l => l.LigMtrId is not null).LigId, c.Metres.Single().MtrLigId);
        // Le document source n'est pas modifié.
        Assert.Equal(5, source.Document.EntTiersId);
    }

    [Fact]
    public async Task Transformer_devis_en_commande_seulement_sans_intermediaire()
    {
        var s = ServeurDevis();
        s.Routes["POST /api/documents/10/transformer"] = corps =>
        {
            var d = Devis();
            d.Document.EntId = 12;
            d.Document.EntTydId = JsonNode.Parse(corps!)!["cible_tyd_id"]!.GetValue<int>();
            return new ReponseInterne(200, JsonSerializer.Serialize(d, OperationsLignesBtp.Json));
        };
        var r = await McpDocumentsBtp.TransformerAsync(s.Execution("transformer", """{"id":10,"cible_tyd_id":9}"""), default);
        Assert.Equal(200, r.Statut);
        Assert.Equal(2, JsonNode.Parse(s.Appels.Single(a => a.Methode == "POST").Corps!)!["cible_tyd_id"]!.GetValue<int>());
        Assert.Equal(TypesDocument.VCommande, JsonNode.Parse(r.Corps)!["type"]!.GetValue<string>());

        // Règle avec un type intermédiaire (validé d'office) : refusée sans appel.
        var t = ServeurDevis();
        t.Json("GET /api/types-document/V_DEVIS/definition", Definition(1, TypesDocument.VDevis, intermediaire: 2));
        var refus = await McpDocumentsBtp.TransformerAsync(t.Execution("transformer", """{"id":10}"""), default);
        Assert.Equal(ErreursMcpBtp.TypeNonPermis, JsonNode.Parse(refus.Corps)!["code"]!.GetValue<string>());
        Assert.DoesNotContain(t.Appels, a => a.Methode == "POST");
    }

    [Fact]
    public async Task Prix_d_une_piece_d_achat_retires_sous_couts()
    {
        var s = new Serveur();
        s.Routes["GET /api/documents/20"] = _ => new ReponseInterne(200, """
            {"document":{"ent_id":20,"ent_tyd_id":33,"ent_total_ht":100,"ent_net_a_payer":120,"ent_objet":"Acier"},
             "lignes":[{"lig_id":1,"lig_qte":2,"lig_pv":50,"lig_pv_remise":50,"lig_montant_ht":100,"lig_coef_remise":1,"lig_libelle_html":"Tube"}],
             "tva":[{"tva_montant":20}]}
            """);
        s.Routes["GET /api/types-document"] = _ => new ReponseInterne(200, """[{"tyd_id":1,"tyd_famille":"V"},{"tyd_id":33,"tyd_famille":"A"}]""");
        var r = await McpDocumentsBtp.LireDocumentAsync(s.Execution("lire_document", """{"id":20}""", GardeFou.Couts), default);
        var o = JsonNode.Parse(r.Corps)!;
        Assert.Null(o["document"]!["ent_total_ht"]);
        Assert.Null(o["document"]!["ent_net_a_payer"]);
        Assert.Null(o["lignes"]![0]!["lig_pv"]);
        Assert.Null(o["lignes"]![0]!["lig_montant_ht"]);
        Assert.Null(o["tva"]);
        Assert.Equal(2, o["lignes"]![0]!["lig_qte"]!.GetValue<int>());
        Assert.Equal("Acier", o["document"]!["ent_objet"]!.GetValue<string>());
        Assert.Contains("lig_pv", o["couts_masques"]!.AsArray().Select(x => x!.GetValue<string>()));

        // Garde-fou levé, ou pièce de vente : inchangée (et le type n'est lu qu'au besoin).
        var leve = await McpDocumentsBtp.LireDocumentAsync(s.Execution("lire_document", """{"id":20}"""), default);
        Assert.Equal(100, JsonNode.Parse(leve.Corps)!["document"]!["ent_total_ht"]!.GetValue<int>());
        Assert.False(McpDocumentsBtp.ClePrix("lig_coef_remise"));
        Assert.False(McpDocumentsBtp.ClePrix("lig_qte"));
        Assert.True(McpDocumentsBtp.ClePrix("lig_pied_valeur"));
    }

    // ------------------------------------------------------------------ catalogue et liste blanche

    [Fact]
    public void Outils_d_ecriture_brouillon_et_liste_blanche_exacte()
    {
        var ecriture = Specialisation.Outils.Where(o => o.Classe != ClasseOutil.Lecture).ToList();
        Assert.Equal(["creer_devis", "modifier_lignes", "transformer"], ecriture.Select(o => o.Nom));
        Assert.All(ecriture, o => Assert.Equal(ClasseOutil.Brouillon, o.Classe));
        Assert.Equal([McpDocumentsBtp.NoeudDevis, McpDocumentsBtp.NoeudDevis, McpDocumentsBtp.NoeudCommande], ecriture.Select(o => o.Noeud));
        Assert.Equal([ActionsDroits.Creer, ActionsDroits.Modifier, ActionsDroits.Creer], ecriture.Select(o => o.Action));
        // Liste blanche du plafond : exactement ces routes d'écriture (ni valider, ni envoyer, ni numéro, ni verrou forcé…).
        Assert.Equal(
            ["DELETE /api/documents/{id}/verrou", "POST /api/documents/avec-contenu", "POST /api/documents/{id}/copie", "POST /api/documents/{id}/transformer",
             "POST /api/documents/{id}/verrou", "PUT /api/documents/{id}"],
            PlafondMcp.RoutesEcriture(Specialisation).Select(r => $"{r.Methode} {r.Gabarit}").Order(StringComparer.Ordinal));
        var plafond = new PlafondAgent("D1", ModelePlafond.Preparation, new Dictionary<string, IReadOnlyList<string>>(), PorteesDroits.Tout, [],
            PlafondMcp.RoutesEcriture(Specialisation), []);
        Assert.True(LogiBTP.Droits.Web.AgentsDroits.RoutePermise(plafond, "PUT", "/api/documents/{id:long}"));
        foreach (var interdite in new[] { "valider", "envoyer", "valider-tiers", "devalider", "rejeter", "numero", "reference", "indices" })
            Assert.False(LogiBTP.Droits.Web.AgentsDroits.RoutePermise(plafond, "POST", $"/api/documents/{{id:long}}/{interdite}"));
        Assert.False(LogiBTP.Droits.Web.AgentsDroits.RoutePermise(plafond, "DELETE", "/api/documents/{id:long}/verrou/force"));
        Assert.False(LogiBTP.Droits.Web.AgentsDroits.RoutePermise(plafond, "DELETE", "/api/documents/{id:long}"));
        Assert.False(LogiBTP.Droits.Web.AgentsDroits.RoutePermise(plafond, "POST", "/api/documents/plusieurs"));
        // Chaque route déclarée est rattachée aux droits ; descriptions et arguments déclarés (jamais de statut ni d'entête libre).
        var routes = new SpecialisationDroitsBtp().Routes;
        foreach (var o in ecriture)
        {
            foreach (var r in o.ToutesRoutes) Assert.NotNull(LogiBTP.Droits.Web.RoutesDroits.Trouver(routes, r.Route));
            Assert.NotEqual(o.Description, Specialisation.Texte(o.Description));
            var proprietes = o.Schema.GetProperty("properties").EnumerateObject().Select(p => p.Name).ToList();
            Assert.DoesNotContain(proprietes, p => p.StartsWith("ent_", StringComparison.Ordinal) || p == "statut");
        }
    }

    [Fact]
    public async Task Route_non_declaree_refusee_a_l_outil_compose()
    {
        var s = ServeurDevis();
        var x = s.Execution("modifier_lignes", """{"id":10}""");
        await Assert.ThrowsAsync<RouteNonDeclareeException>(() => x.EnvoyerAsync("POST", "/api/documents/10/valider", new JsonObject(), default));
        await Assert.ThrowsAsync<RouteNonDeclareeException>(() => x.EnvoyerAsync("DELETE", "/api/documents/10/verrou/force", null, default));
        Assert.Empty(s.Appels);
    }
}
