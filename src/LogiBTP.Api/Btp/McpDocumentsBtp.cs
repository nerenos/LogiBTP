using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Bibliotheque.Web;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Mcp.Web;
using LogiBTP.Socle;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Outils d'écriture des devis pour les agents IA (module MCP, lot 7 ; ANALYSE-MODULE-MCP.md § 7.1 ;
/// plans/mcp-audit-routes.md, points du lot 7). Chaque outil enchaîne des routes /api existantes avec le jeton délégué
/// (droits de l'agent, unité d'écriture, recalcul du serveur) ; aucune règle de calcul ici :
/// <list type="bullet">
/// <item><c>creer_devis</c> : copie d'un devis (<c>POST /api/documents/{id}/copie</c>) ou création avec contenu depuis un modèle
/// de saisie (<c>POST /api/documents/avec-contenu</c>), tiers désigné (outil <c>designer_tiers</c>), objet, opérations de lignes ;
/// copie vers un autre tiers que celui du devis source : création avec le contenu du devis (le tiers d'une copie est figé) ;</item>
/// <item><c>modifier_lignes</c> : verrou pris (refus si la pièce est ouverte, même par le délégant), document lu, opérations
/// (<see cref="OperationsLignesBtp"/>), <c>PUT</c> complet avec l'empreinte de version lue (409 si modifiée entre-temps),
/// verrou rendu ; statut, numéro, indice et verrouillage contrôlés inchangés ;</item>
/// <item><c>transformer</c> : devis → commande client (brouillon) seulement, jamais une règle avec un type intermédiaire
/// validé d'office (devis → facture) ;</item>
/// <item><c>lire_document</c> : pièce lue ; garde-fou COUTS actif : prix et montants d'une pièce d'achat ou de
/// sous-traitance retirés (son prix est un coût).</item>
/// </list>
/// Réponse : identifiant, numéro, statut, version, totaux recalculés par le serveur, avertissements, lignes résumées ;
/// le module ajoute l'adresse absolue de la pièce.
/// </summary>
public static class McpDocumentsBtp
{
    public const string RouteDocument = "/api/documents/{id}";
    public const string RouteVerrou = "/api/documents/{id}/verrou";
    public const string RouteCopie = "/api/documents/{id}/copie";
    public const string RouteAvecContenu = "/api/documents/avec-contenu";
    public const string RouteTransformer = "/api/documents/{id}/transformer";
    public const string RouteAvertissements = "/api/documents/{id}/avertissements";
    public const string RouteDefinition = "/api/types-document/{code}/definition";
    public const string RouteTypes = "/api/types-document";
    public const string RouteModeles = "/api/modeles-document";
    public const string RouteElement = "/api/bibliotheque/elements/{id}";

    /// <summary>Nœuds de droits des outils (type exact : le classement ne dépend pas d'un droit sur un autre type).</summary>
    public static readonly string NoeudDevis = FamillesDocument.NoeudDroits(FamillesDocument.Vente, TypesDocument.VDevis);
    public static readonly string NoeudCommande = FamillesDocument.NoeudDroits(FamillesDocument.Vente, TypesDocument.VCommande);

    private static readonly JsonSerializerOptions Json = OperationsLignesBtp.Json;

    /// <summary>Réponse d'erreur d'une route intermédiaire : rendue telle quelle à l'agent.</summary>
    internal sealed class EchecAppel(ReponseInterne reponse) : Exception($"HTTP {reponse.Statut}")
    {
        public ReponseInterne Reponse { get; } = reponse;
    }

    internal static string Chemin(string gabarit, object valeur, string? requete = null) =>
        gabarit.Replace("{id}", Uri.EscapeDataString(Convert.ToString(valeur, System.Globalization.CultureInfo.InvariantCulture)!))
            .Replace("{code}", Uri.EscapeDataString(Convert.ToString(valeur, System.Globalization.CultureInfo.InvariantCulture)!)) + (requete is null ? "" : "?" + requete);

    internal static async Task<JsonNode?> AppelAsync(ExecutionOutil x, string methode, string chemin, JsonNode? corps, CancellationToken ct)
    {
        var r = await x.EnvoyerAsync(methode, chemin, corps, ct);
        if (r.Statut >= 400) throw new EchecAppel(r);
        return string.IsNullOrWhiteSpace(r.Corps) ? null : JsonNode.Parse(r.Corps);
    }

    internal static async Task<T> LireAsync<T>(ExecutionOutil x, string chemin, CancellationToken ct) =>
        (await AppelAsync(x, "GET", chemin, null, ct)).Deserialize<T>(Json) ?? throw new EchecAppel(new ReponseInterne(404, ""));

    private static ReponseInterne Erreur(ErreurOutilMcp e)
    {
        var o = new JsonObject { ["code"] = e.Code, ["message"] = e.Message };
        if (e.Details is not null) o["details"] = e.Details.DeepClone();
        return new ReponseInterne(e.Statut, o.ToJsonString());
    }

    /// <summary>Exécution commune : refus de l'outil (422, 409) et échecs des routes rendus à l'agent.</summary>
    internal static async Task<ReponseInterne> Executer(Func<Task<JsonObject>> f)
    {
        try
        {
            return new ReponseInterne(200, (await f()).ToJsonString());
        }
        catch (ErreurOutilMcp e) { return Erreur(e); }
        catch (EchecAppel e) { return e.Reponse; }
    }

    private static ErreurOutilMcp TypeNonPermis(string message) => new(422, ErreursMcpBtp.TypeNonPermis, message);

    // ------------------------------------------------------------------ creer_devis

    public static Task<ReponseInterne> CreerDevisAsync(ExecutionOutil x, CancellationToken ct) => Executer(async () =>
    {
        var a = x.Arguments;
        var source = OperationsLignesBtp.Entier(a.GetValueOrDefault("source_id"));
        var modele = OperationsLignesBtp.Texte(a.GetValueOrDefault("modele"))?.Trim();
        if (source is not null && !string.IsNullOrEmpty(modele))
            throw new ErreurOutilMcp(422, ErreursMcpBtp.Source, "Un devis source ou un modèle, pas les deux");
        var tiers = OperationsLignesBtp.Entier(a.GetValueOrDefault("tiers_id"));
        var objet = OperationsLignesBtp.Texte(a.GetValueOrDefault("objet"))?.Trim();
        var operations = a.GetValueOrDefault("operations") as JsonArray;
        var definition = await LireAsync<DefinitionType>(x, Chemin(RouteDefinition, TypesDocument.VDevis), ct);

        if (source is long s)
        {
            var origine = await LireAsync<DocumentCompletBtp>(x, Chemin(RouteDocument, s), ct);
            if (origine.Document.EntTydId != definition.Type.TydId) throw TypeNonPermis($"Le document {s} n'est pas un devis");
            // Le tiers d'une copie est figé (lignes d'origine) : vers un autre tiers, création avec le contenu du devis.
            // Les opérations désignent les lignes du devis source (lire_document) : traduites vers les lignes créées.
            if (tiers is long t && origine.Document.EntTiersId is long ancien && ancien != t)
            {
                var contenu = Contenu(origine, t, objet, out var correspondance);
                return await CreerAvecContenuAsync(x, definition, contenu, Traduire(operations, correspondance), ct, copieDe: s);
            }
            var copie = await AppelAsync(x, "POST", Chemin(RouteCopie, s), new JsonObject(), ct);
            var id = copie?["document"]?["ent_id"]?.GetValue<long>() ?? throw new EchecAppel(new ReponseInterne(500, ""));
            if (tiers is null && string.IsNullOrEmpty(objet) && (operations is null || operations.Count == 0))
                return await ResumeAsync(x, copie.Deserialize<DocumentCompletBtp>(Json)!, null, definition, ct, copieDe: s);
            return await ModifierAsync(x, id, null, operations, definition, ct, d =>
            {
                if (tiers is long nt) d.Document.EntTiersId = nt;
                if (!string.IsNullOrEmpty(objet)) d.Document.EntObjet = objet;
            }, copieDe: s, correspondance: d => d.Lignes.Where(l => l.LigOrigineId is not null).ToDictionary(l => l.LigOrigineId!.Value, l => l.LigId));
        }

        if (!string.IsNullOrEmpty(modele) && !definition.Modeles.Any(m => m.Code == modele))
            throw new ErreurOutilMcp(422, ErreursMcpBtp.Modele, $"Modèle de saisie inconnu : {modele}");
        var vide = new DocumentCompletBtp
        {
            Document = new DocumentBtp
            {
                EntTydId = definition.Type.TydId, EntTiersId = tiers, EntObjet = objet, EntModele = string.IsNullOrEmpty(modele) ? null : modele,
                EntDate = DateOnly.FromDateTime(DateTime.Today), EntValiditeJours = definition.Type.TydValiditeJours,
                EntTexteIntroHtml = definition.Type.TydTexteIntroHtml, EntTexteFinHtml = definition.Type.TydTexteFinHtml,
                EntNumFormat = JsonDocument.Parse("""{"separateur":".","niveaux":[{"style":"1"}]}"""),
                EntProprietes = JsonDocument.Parse("{}"), EntEtiquettes = JsonDocument.Parse("[]"),
            },
        };
        return await CreerAvecContenuAsync(x, definition, vide, operations, ct);
    });

    /// <summary>Clés des opérations qui désignent une ligne.</summary>
    private static readonly string[] ClesLigne = ["lig_id", "parent_id", "apres_id"];

    /// <summary>
    /// Opérations dont les lignes désignées (lig_id, parent_id, apres_id) sont traduites par la correspondance (ligne du devis
    /// source → ligne créée) ; une ligne absente de la correspondance est désignée par 0 (refusée : ligne inconnue).
    /// </summary>
    public static JsonArray? Traduire(JsonArray? operations, IReadOnlyDictionary<long, long> correspondance)
    {
        if (operations is null) return null;
        var copie = operations.DeepClone().AsArray();
        foreach (var o in copie.OfType<JsonObject>())
            foreach (var cle in ClesLigne)
                if (OperationsLignesBtp.Entier(o[cle]) is long id) o[cle] = correspondance.TryGetValue(id, out var n) ? n : 0;
        return copie;
    }

    /// <summary>Contenu d'un devis source repris pour un autre tiers : nouveaux ID temporaires, sans lien d'origine ni coordonnées de l'ancien tiers.</summary>
    public static DocumentCompletBtp Contenu(DocumentCompletBtp source, long tiers, string? objet) => Contenu(source, tiers, objet, out _);

    /// <summary>Idem, avec la correspondance ligne source → ligne temporaire.</summary>
    public static DocumentCompletBtp Contenu(DocumentCompletBtp source, long tiers, string? objet, out IReadOnlyDictionary<long, long> correspondance)
    {
        var d = JsonSerializer.Deserialize<DocumentCompletBtp>(JsonSerializer.Serialize(source, Json), Json)!;
        long n = 0;
        var lig = d.Lignes.ToDictionary(l => l.LigId, _ => --n);
        correspondance = new Dictionary<long, long>(lig);
        long? Map(long? id) => id is long v && lig.TryGetValue(v, out var r) ? r : null;
        foreach (var l in d.Lignes)
        {
            l.LigId = lig[l.LigId];
            l.LigOrigineId = null;
            l.LigParentId = Map(l.LigParentId);
            l.LigStDepuisId = Map(l.LigStDepuisId);
            l.LigVarianteDeId = Map(l.LigVarianteDeId);
            l.LigPiedBaseId = Map(l.LigPiedBaseId);
        }
        new SpecialisationBtp().RenumeroterComplements(d, lig, ref n);
        var e = d.Document;
        e.EntId = 0;
        e.EntVersion = 1;
        e.EntTiersId = tiers;
        if (!string.IsNullOrEmpty(objet)) e.EntObjet = objet;
        e.EntContactClient = null;
        e.EntContactPayeur = null;
        e.EntAdresseFacturation = null;
        e.EntAdresseLivraison = null;
        e.EntDate = DateOnly.FromDateTime(DateTime.Today);
        d.Tva = [];
        d.Echeances = [];
        return d;
    }

    private static async Task<JsonObject> CreerAvecContenuAsync(ExecutionOutil x, DefinitionType definition, DocumentCompletBtp contenu, JsonArray? operations,
        CancellationToken ct, long? copieDe = null)
    {
        await AppliquerAsync(x, contenu, operations, definition, ct);
        var e = contenu.Document;
        var creation = new JsonObject
        {
            ["ent_tyd_id"] = definition.Type.TydId, ["ent_tiers_id"] = e.EntTiersId, ["ent_objet"] = e.EntObjet, ["ent_validite_jours"] = e.EntValiditeJours,
        };
        var corps = new JsonObject { ["creation"] = creation, ["contenu"] = JsonSerializer.SerializeToNode(contenu, Json) };
        var reponse = await AppelAsync(x, "POST", RouteAvecContenu, corps, ct);
        var cree = reponse?["document"].Deserialize<DocumentCompletBtp>(Json) ?? throw new EchecAppel(new ReponseInterne(500, ""));
        return await ResumeAsync(x, cree, reponse as JsonObject, definition, ct, copieDe);
    }

    private static async Task AppliquerAsync(ExecutionOutil x, DocumentCompletBtp d, JsonArray? operations, DefinitionType definition, CancellationToken ct)
    {
        if (operations is null || operations.Count == 0) return;
        var elements = new Dictionary<long, ElementDetailDto>();
        foreach (var id in OperationsLignesBtp.ElementsDemandes(operations))
            elements[id] = await LireAsync<ElementDetailDto>(x, Chemin(RouteElement, id), ct);
        OperationsLignesBtp.Appliquer(d, operations, new OperationsLignesBtp.Contexte(elements, definition.TauxTva));
    }

    // ------------------------------------------------------------------ modifier_lignes

    public static Task<ReponseInterne> ModifierLignesAsync(ExecutionOutil x, CancellationToken ct) => Executer(async () =>
    {
        var id = OperationsLignesBtp.Entier(x.Arguments.GetValueOrDefault("id")) ?? throw new ErreurOutilMcp(422, ErreursMcpBtp.Operation, "Devis attendu (id)");
        var version = OperationsLignesBtp.Entier(x.Arguments.GetValueOrDefault("version"));
        var definition = await LireAsync<DefinitionType>(x, Chemin(RouteDefinition, TypesDocument.VDevis), ct);
        return await ModifierAsync(x, id, version is long v ? (int)v : null, x.Arguments.GetValueOrDefault("operations") as JsonArray, definition, ct);
    });

    /// <summary>
    /// Verrou (refus si la pièce est ouverte en modification, même par le délégant), lecture, opérations, PUT complet avec la
    /// version lue, contrôle de l'entête, verrou rendu.
    /// </summary>
    internal static async Task<JsonObject> ModifierAsync(ExecutionOutil x, long id, int? version, JsonArray? operations, DefinitionType definition,
        CancellationToken ct, Action<DocumentCompletBtp>? entete = null, long? copieDe = null,
        Func<DocumentCompletBtp, IReadOnlyDictionary<long, long>>? correspondance = null)
    {
        if (await AppelAsync(x, "GET", Chemin(RouteVerrou, id), null, ct) is JsonObject ouvert)
            throw new ErreurOutilMcp(409, ErreursMcpBtp.Verrou, $"Document ouvert en modification par {OperationsLignesBtp.Texte(ouvert["utilisateur"])}", ouvert.DeepClone());
        var jeton = Guid.NewGuid();
        var pris = await AppelAsync(x, "POST", Chemin(RouteVerrou, id), new JsonObject { ["jeton"] = jeton.ToString() }, ct);
        if (pris?["ok"]?.GetValue<bool>() != true)
            throw new ErreurOutilMcp(409, ErreursMcpBtp.Verrou, "Document ouvert en modification par un autre utilisateur", pris?["verrou"]?.DeepClone());
        try
        {
            var lu = await LireAsync<DocumentCompletBtp>(x, Chemin(RouteDocument, id), ct);
            if (lu.Document.EntTydId != definition.Type.TydId) throw TypeNonPermis($"Le document {id} n'est pas du type {definition.Type.TydCode}");
            if (version is int v && v != lu.Document.EntVersion)
            {
                throw new ErreurOutilMcp(409, ErreursMcpBtp.Version, "Le document a été modifié depuis votre lecture : relisez-le",
                    new JsonObject { ["version_lue"] = v, ["version_serveur"] = lu.Document.EntVersion });
            }
            var avant = (lu.Document.EntStdId, lu.Document.EntVerrouille, lu.Document.EntNumero, lu.Document.EntIndice);
            entete?.Invoke(lu);
            await AppliquerAsync(x, lu, correspondance is null ? operations : Traduire(operations, correspondance(lu)), definition, ct);
            var reponse = await AppelAsync(x, "PUT", Chemin(RouteDocument, id), JsonSerializer.SerializeToNode(lu, Json), ct);
            var enregistre = reponse?["document"].Deserialize<DocumentCompletBtp>(Json) ?? throw new EchecAppel(new ReponseInterne(500, ""));
            var apres = (enregistre.Document.EntStdId, enregistre.Document.EntVerrouille, enregistre.Document.EntNumero, enregistre.Document.EntIndice);
            if (apres != avant) throw new ErreurOutilMcp(409, ErreursMcpBtp.EnteteModifiee, "Statut, numéro, indice ou verrouillage changés par l'enregistrement");
            return await ResumeAsync(x, enregistre, reponse as JsonObject, definition, ct, copieDe);
        }
        finally
        {
            await x.EnvoyerAsync("DELETE", Chemin(RouteVerrou, id, "jeton=" + jeton), null, CancellationToken.None);
        }
    }

    // ------------------------------------------------------------------ transformer

    public static Task<ReponseInterne> TransformerAsync(ExecutionOutil x, CancellationToken ct) => Executer(async () =>
    {
        var id = OperationsLignesBtp.Entier(x.Arguments.GetValueOrDefault("id")) ?? throw new ErreurOutilMcp(422, ErreursMcpBtp.Operation, "Devis attendu (id)");
        var devis = await LireAsync<DefinitionType>(x, Chemin(RouteDefinition, TypesDocument.VDevis), ct);
        var commande = await LireAsync<DefinitionType>(x, Chemin(RouteDefinition, TypesDocument.VCommande), ct);
        var source = await LireAsync<DocumentCompletBtp>(x, Chemin(RouteDocument, id), ct);
        if (source.Document.EntTydId != devis.Type.TydId) throw TypeNonPermis($"Le document {id} n'est pas un devis");
        // Seule cible permise : la commande, sans type intermédiaire (un intermédiaire serait validé d'office).
        var regle = devis.Transformations.FirstOrDefault(t => t.TraSourceTydId == devis.Type.TydId && t.TraCibleTydId == commande.Type.TydId);
        if (regle is null || regle.TraIntermediaireTydId is not null) throw TypeNonPermis("Transformation devis → commande non permise sans validation");
        var cible = await AppelAsync(x, "POST", Chemin(RouteTransformer, id), new JsonObject { ["cible_tyd_id"] = commande.Type.TydId }, ct);
        var cree = cible.Deserialize<DocumentCompletBtp>(Json) ?? throw new EchecAppel(new ReponseInterne(500, ""));
        return await ResumeAsync(x, cree, null, commande, ct);
    });

    // ------------------------------------------------------------------ lire_document

    /// <summary>Jetons de clés de prix et de montants (pièce d'achat sous COUTS) : « lig_pv », « ent_total_ht », « tva_montant »…</summary>
    private static readonly HashSet<string> JetonsPrix = ["pv", "pu", "pa", "pr", "montant", "total", "prix", "valeur", "base", "payer", "recu", "net"];

    /// <summary>Clé d'un prix ou d'un montant (pièce d'achat : c'est un coût).</summary>
    public static bool ClePrix(string cle) => cle.Split('_').Skip(1).Any(JetonsPrix.Contains);

    /// <summary>Pièce d'achat ou de sous-traitance sous COUTS : prix et montants retirés à toute profondeur ; clés retirées rendues.</summary>
    public static SortedSet<string> MasquerPrix(JsonNode? n)
    {
        var retirees = new SortedSet<string>(StringComparer.Ordinal);
        void Parcourir(JsonNode? x)
        {
            switch (x)
            {
                case JsonObject o:
                    foreach (var k in o.Select(kv => kv.Key).ToList())
                    {
                        if (ClePrix(k) || k == "tva" || k == "echeances") { o.Remove(k); retirees.Add(k); }
                        else Parcourir(o[k]);
                    }
                    break;
                case JsonArray a:
                    foreach (var e in a) Parcourir(e);
                    break;
            }
        }
        Parcourir(n);
        return retirees;
    }

    public static async Task<ReponseInterne> LireDocumentAsync(ExecutionOutil x, CancellationToken ct)
    {
        var id = OperationsLignesBtp.Entier(x.Arguments.GetValueOrDefault("id"));
        if (id is null) return Erreur(new ErreurOutilMcp(422, ErreursMcpBtp.Operation, "Document attendu (id)"));
        var r = await x.EnvoyerAsync("GET", Chemin(RouteDocument, id), null, ct);
        if (r.Statut >= 400 || !x.GardesFous.Contains(GardeFou.Couts)) return r;
        var doc = JsonNode.Parse(r.Corps);
        var tyd = doc?["document"]?["ent_tyd_id"]?.GetValue<int>();
        var types = await x.EnvoyerAsync("GET", RouteTypes, null, ct);
        if (types.Statut >= 400) return types;
        var famille = JsonNode.Parse(types.Corps)?.AsArray().OfType<JsonObject>()
            .FirstOrDefault(t => t["tyd_id"]?.GetValue<int>() == tyd)?["tyd_famille"]?.GetValue<string>();
        if (!FamillesDocument.EstAchat(famille)) return r;
        var retirees = MasquerPrix(doc);
        if (doc is JsonObject o) o["couts_masques"] = new JsonArray([.. retirees.Select(c => (JsonNode?)c)]);
        return new ReponseInterne(r.Statut, doc!.ToJsonString());
    }

    // ------------------------------------------------------------------ réponse

    /// <summary>
    /// Résumé rendu à l'agent : pièce (identifiant, numéro, type, statut, version, tiers, objet), totaux recalculés par le
    /// serveur, avertissements (enregistrement et contrôles avant validation), lignes résumées (pour les opérations suivantes).
    /// </summary>
    internal static async Task<JsonObject> ResumeAsync(ExecutionOutil x, DocumentCompletBtp d, JsonObject? enregistrement, DefinitionType definition,
        CancellationToken ct, long? copieDe = null)
    {
        var e = d.Document;
        var avertissements = new JsonArray();
        foreach (var m in (enregistrement?["avertissements"] as JsonArray ?? [])) avertissements.Add(m?.DeepClone());
        var gestion = await x.EnvoyerAsync("GET", Chemin(RouteAvertissements, e.EntId, "action=" + ActionsDroits.Valider), null, ct);
        if (gestion.Statut < 400 && !string.IsNullOrWhiteSpace(gestion.Corps) && JsonNode.Parse(gestion.Corps) is JsonArray g)
            foreach (var m in g) avertissements.Add(m?.DeepClone());
        var o = new JsonObject
        {
            ["ent_id"] = e.EntId, ["ent_numero"] = e.EntNumero, ["type"] = definition.Type.TydCode,
            ["statut"] = definition.Statuts.FirstOrDefault(s => s.StdId == e.EntStdId)?.StdCode, ["ent_version"] = e.EntVersion,
            ["ent_verrouille"] = e.EntVerrouille, ["ent_tiers_id"] = e.EntTiersId, ["ent_objet"] = e.EntObjet, ["ent_modele"] = e.EntModele,
            ["ent_total_ht"] = e.EntTotalHt, ["ent_total_tva"] = e.EntTotalTva, ["ent_total_ttc"] = e.EntTotalTtc, ["ent_net_a_payer"] = e.EntNetAPayer,
            ["avertissements"] = avertissements,
            ["erreurs"] = (enregistrement?["erreurs"] as JsonArray)?.DeepClone() ?? new JsonArray(),
            ["lignes"] = new JsonArray([.. d.Lignes.OrderBy(l => l.LigChemin, StringComparer.Ordinal).ThenBy(l => l.LigOrdre).Select(l => (JsonNode?)new JsonObject
            {
                ["lig_id"] = l.LigId, ["lig_parent_id"] = l.LigParentId, ["lig_tyl_id"] = l.LigTylId, ["lig_numerotation"] = l.LigNumerotation,
                ["lig_code"] = l.LigCode, ["lig_libelle"] = l.LigLibelleBrut ?? l.LigLibelleAffiche ?? l.LigLibelleHtml, ["lig_qte"] = l.LigQte,
                ["lig_unt_code"] = l.LigUntCode, ["lig_pv"] = l.LigPv, ["lig_coef_remise"] = l.LigCoefRemise, ["lig_montant_ht"] = l.LigMontantHt,
            })]),
        };
        if (copieDe is long c) o["copie_de"] = c;
        return o;
    }
}
