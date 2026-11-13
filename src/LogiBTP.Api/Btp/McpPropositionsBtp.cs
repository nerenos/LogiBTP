using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Annuaire.Web;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Mail.Web;
using LogiBTP.Mcp.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using LogiBTP.Stock;
using LogiBTP.Stock.Web;
using Microsoft.EntityFrameworkCore;
using static LogiBTP.Api.Btp.McpDocumentsBtp;

namespace LogiBTP.Api.Btp;

/// <summary>
/// File des propositions des agents, côté cœur (plans/mcp.md, lot 10 ; ANALYSE-MODULE-MCP.md § 10.1).
/// <list type="bullet">
/// <item><b>Outils de proposition</b> (agent, jeton délégué, lectures seules) : <c>proposer_validation</c>, <c>proposer_envoi</c>,
/// <c>proposer_tiers</c>, et <c>proposer_ventilation</c> avec <c>deposer</c> ; chacun lit la cible et dépose une proposition
/// (action, nœud et droit exigés de l'humain, contenu, avertissements) sans rien exécuter.</item>
/// <item><b>Exécuteurs</b> (humain qui accepte, sa session et ses droits, dans la transaction du module) : <c>valider_piece</c>
/// (validation existante : droit VALIDER du type, montants de validation, version), <c>appliquer_ventilation</c>
/// (transformations existantes E_DAP → S_RESERVATION par dépôt, S_DEMANDE pour la part attendue d'une commande en cours,
/// A_COMMANDE par fournisseur, et commandes de réappro par dépôt et fournisseur : tout en brouillon, comme les routes),
/// <c>envoyer_document</c> (envoi par courriel existant, préparé comme le bouton « Envoyer »), <c>creer_tiers_provisoire</c>
/// (fiche provisoire de l'annuaire).</item>
/// </list>
/// </summary>
public static class McpPropositionsBtp
{
    public const string ValiderPiece = "valider_piece";
    public const string AppliquerVentilation = "appliquer_ventilation";
    public const string EnvoyerDocument = "envoyer_document";
    public const string CreerTiersProvisoire = "creer_tiers_provisoire";

    public const string RouteDesignation = "/api/designation/tiers";

    /// <summary>Nœud et droit exigés pour appliquer une ventilation : gestion du stock (réservations, réappros), comme PeutGererAsync.</summary>
    public const string NoeudStock = "stock";

    private const string TypeDocumentElement = "document";
    private const string TypePersonne = "personne";

    // ------------------------------------------------------------------ lectures communes des outils

    private sealed record TypeLu(int TydId, string TydCode, string? TydFamille, string? TydLibelle);

    private static async Task<(DocumentCompletBtp Doc, TypeLu Type)> LireCibleAsync(ExecutionOutil x, long id, CancellationToken ct)
    {
        var doc = await LireAsync<DocumentCompletBtp>(x, Chemin(RouteDocument, id), ct);
        var types = await LireAsync<List<TypeLu>>(x, RouteTypes, ct);
        var type = types.FirstOrDefault(t => t.TydId == doc.Document.EntTydId)
            ?? throw new ErreurOutilMcp(422, ErreursMcpBtp.TypeNonPermis, $"Type du document {id} inconnu");
        return (doc, type);
    }

    private static string Noeud(TypeLu t) => FamillesDocument.NoeudDroits(t.TydFamille ?? "", t.TydCode);

    private static int? Jours(ExecutionOutil x) => OperationsLignesBtp.Entier(x.Arguments.GetValueOrDefault("jours")) is long j ? (int)Math.Clamp(j, 1, 365) : null;

    private static string Designation(DocumentBtp d, TypeLu t) => $"{t.TydLibelle ?? t.TydCode} {d.EntNumero ?? "#" + d.EntId.ToString(CultureInfo.InvariantCulture)}";

    // ------------------------------------------------------------------ outils

    /// <summary>
    /// proposer_validation : pièce non validée, lue avec sa version et ses avertissements de validation ; proposition
    /// « valider_piece » au nœud du type (droit VALIDER), jamais exécutée par l'agent. La réponse ne rend pas les montants
    /// (garde-fou COUTS sur une pièce d'achat) : l'humain les voit dans la proposition.
    /// </summary>
    public static Task<ReponseInterne> ProposerValidationAsync(ExecutionOutil x, CancellationToken ct) => Executer(async () =>
    {
        var id = OperationsLignesBtp.Entier(x.Arguments.GetValueOrDefault("id")) ?? throw new ErreurOutilMcp(422, ErreursMcpBtp.Operation, "Document attendu (id)");
        var (doc, type) = await LireCibleAsync(x, id, ct);
        var d = doc.Document;
        if (d.EntVerrouille) throw new ErreurOutilMcp(409, ErreursMcpBtp.DejaValide, $"{Designation(d, type)} est déjà validé(e)");
        var avertissements = new JsonArray();
        var gestion = await x.EnvoyerAsync("GET", Chemin(RouteAvertissements, id, "action=" + ActionsDroits.Valider), null, ct);
        if (gestion.Statut < 400 && !string.IsNullOrWhiteSpace(gestion.Corps) && JsonNode.Parse(gestion.Corps) is JsonArray g)
            foreach (var m in g) avertissements.Add(m?.DeepClone());
        var commentaire = OperationsLignesBtp.Texte(x.Arguments.GetValueOrDefault("commentaire"))?.Trim();
        x.Proposer(new PropositionPreparee(ValiderPiece, Noeud(type), ActionsDroits.Valider, $"Valider {Designation(d, type)}",
            new JsonObject
            {
                ["ent_id"] = d.EntId, ["ent_version"] = d.EntVersion, ["type"] = type.TydCode, ["ent_numero"] = d.EntNumero, ["ent_tiers_id"] = d.EntTiersId,
                ["ent_objet"] = d.EntObjet, ["ent_total_ht"] = d.EntTotalHt, ["ent_total_ttc"] = d.EntTotalTtc, ["commentaire"] = commentaire,
            }, TypeDocumentElement, d.EntId.ToString(CultureInfo.InvariantCulture), avertissements, Jours: Jours(x)));
        return new JsonObject
        {
            ["ent_id"] = d.EntId, ["ent_numero"] = d.EntNumero, ["type"] = type.TydCode, ["ent_version"] = d.EntVersion, ["avertissements"] = avertissements.DeepClone(),
        };
    });

    /// <summary>
    /// proposer_envoi : envoi par courriel d'une pièce (effet externe : garde-fou ENVOI) ; destinataires donnés par l'agent
    /// (adresses) ou, sans eux, ceux proposés par défaut pour la pièce ; objet et message facultatifs (sinon le modèle de
    /// l'usage). Proposition « envoyer_document » au nœud du type ; l'humain qui accepte doit aussi pouvoir envoyer un courriel.
    /// </summary>
    public static Task<ReponseInterne> ProposerEnvoiAsync(ExecutionOutil x, CancellationToken ct) => Executer(async () =>
    {
        var id = OperationsLignesBtp.Entier(x.Arguments.GetValueOrDefault("id")) ?? throw new ErreurOutilMcp(422, ErreursMcpBtp.Operation, "Document attendu (id)");
        var (doc, type) = await LireCibleAsync(x, id, ct);
        var d = doc.Document;
        var destinataires = new JsonArray([.. (x.Arguments.GetValueOrDefault("destinataires") as JsonArray ?? [])
            .Select(OperationsLignesBtp.Texte).Select(a => a?.Trim()).Where(a => !string.IsNullOrEmpty(a)).Distinct().Take(20).Select(a => (JsonNode?)a)]);
        var avertissements = new JsonArray();
        if (!d.EntVerrouille) avertissements.Add(new JsonObject { ["code"] = "BROUILLON", ["message"] = "Pièce non validée" });
        x.Proposer(new PropositionPreparee(EnvoyerDocument, Noeud(type), ActionsDroits.Consulter, $"Envoyer {Designation(d, type)}",
            new JsonObject
            {
                ["ent_id"] = d.EntId, ["type"] = type.TydCode, ["ent_numero"] = d.EntNumero, ["destinataires"] = destinataires,
                ["objet"] = OperationsLignesBtp.Texte(x.Arguments.GetValueOrDefault("objet"))?.Trim(),
                ["message"] = OperationsLignesBtp.Texte(x.Arguments.GetValueOrDefault("message"))?.Trim(),
            }, TypeDocumentElement, d.EntId.ToString(CultureInfo.InvariantCulture), avertissements, Envoi: true, Jours: Jours(x)));
        return new JsonObject { ["ent_id"] = d.EntId, ["ent_numero"] = d.EntNumero, ["type"] = type.TydCode, ["avertissements"] = avertissements.DeepClone() };
    });

    /// <summary>
    /// proposer_tiers : tiers provisoire (raison sociale, SIRET, casquette) ; les tiers de nom proche (désignation) sont
    /// rendus en avertissements. Proposition « creer_tiers_provisoire » au nœud de l'annuaire (droit CREER) : refusée tant
    /// que le garde-fou TIERS retient l'annuaire pour la délégation.
    /// </summary>
    public static Task<ReponseInterne> ProposerTiersAsync(ExecutionOutil x, CancellationToken ct) => Executer(async () =>
    {
        var raison = OperationsLignesBtp.Texte(x.Arguments.GetValueOrDefault("raison_sociale"))?.Trim();
        if (string.IsNullOrEmpty(raison)) throw new ErreurOutilMcp(422, ErreursMcpBtp.Operation, "Raison sociale attendue");
        var siret = OperationsLignesBtp.Texte(x.Arguments.GetValueOrDefault("siret"))?.Trim();
        var casquette = OperationsLignesBtp.Texte(x.Arguments.GetValueOrDefault("casquette"))?.Trim().ToUpperInvariant();
        var proches = await AppelAsync(x, "GET", RouteDesignation + "?recherche=" + Uri.EscapeDataString(raison) + "&limite=5", null, ct) as JsonArray ?? [];
        var avertissements = new JsonArray([.. proches.Select(p => (JsonNode?)new JsonObject { ["code"] = "TIERS_PROCHE", ["tiers"] = p?.DeepClone() })]);
        x.Proposer(new PropositionPreparee(CreerTiersProvisoire, "annuaire", ActionsDroits.Creer, $"Créer le tiers provisoire {raison}",
            new JsonObject
            {
                ["raison_sociale"] = raison, ["siret"] = string.IsNullOrEmpty(siret) ? null : siret,
                ["casquettes"] = string.IsNullOrEmpty(casquette) ? new JsonArray() : new JsonArray(casquette), ["confirme"] = false,
            }, TypePersonne, null, avertissements, Jours: Jours(x)));
        return new JsonObject { ["raison_sociale"] = raison, ["proches"] = proches.DeepClone() };
    });

    /// <summary>
    /// proposer_ventilation : ventilation calculée par la route existante (aucune écriture) ; avec <c>deposer</c>, proposition
    /// « appliquer_ventilation » (nœud stock, droit MODIFIER) de son contenu, que l'humain peut corriger avant d'accepter.
    /// </summary>
    public static Task<ReponseInterne> ProposerVentilationAsync(ExecutionOutil x, CancellationToken ct) => Executer(async () =>
    {
        var id = OperationsLignesBtp.Entier(x.Arguments.GetValueOrDefault("id")) ?? throw new ErreurOutilMcp(422, ErreursMcpBtp.Operation, "Demande attendue (id)");
        var proche = x.Arguments.GetValueOrDefault("proche_mini") is JsonValue pv && pv.TryGetValue<decimal>(out var pm)
            ? "proche_mini=" + pm.ToString(CultureInfo.InvariantCulture) : null;
        var v = await AppelAsync(x, "GET", Chemin(McpExecutionBtp.RouteVentilation, id, proche), null, ct) as JsonObject
            ?? throw new EchecAppel(new ReponseInterne(500, ""));
        if (x.Arguments.GetValueOrDefault("deposer") is JsonValue dv && dv.TryGetValue<bool>(out var deposer) && deposer)
        {
            var contenu = ContenuVentilation(v);
            if (ControlerVentilation(contenu).Count > 0 || Vide(contenu))
                throw new ErreurOutilMcp(422, ErreursMcpBtp.VentilationVide, "Rien à créer pour cette demande (ni part, ni réappro)", contenu.DeepClone());
            var avertissements = new JsonArray([.. (v["sans_conversion"] as JsonArray ?? []).Select(s => (JsonNode?)s?.DeepClone())]);
            x.Proposer(new PropositionPreparee(AppliquerVentilation, NoeudStock, ActionsDroits.Modifier,
                $"Appliquer la ventilation de la demande {v["ent_numero"]?.ToString() ?? "#" + id.ToString(CultureInfo.InvariantCulture)}",
                contenu, TypeDocumentElement, id.ToString(CultureInfo.InvariantCulture), avertissements, Jours: Jours(x)));
        }
        return v;
    });

    // ------------------------------------------------------------------ contenu d'une ventilation

    private static JsonObject Garder(JsonNode? n, params string[] cles)
    {
        var o = new JsonObject();
        if (n is JsonObject s) foreach (var c in cles) o[c] = s[c]?.DeepClone();
        return o;
    }

    /// <summary>Contenu de la proposition : parts par besoin et réappros par dépôt et fournisseur (identifiants et quantités, sans libellés).</summary>
    public static JsonObject ContenuVentilation(JsonObject v) => new()
    {
        ["ent_id"] = v["ent_id"]?.DeepClone(), ["ent_numero"] = v["ent_numero"]?.DeepClone(),
        ["besoins"] = new JsonArray([.. (v["besoins"] as JsonArray ?? []).Select(b =>
        {
            var o = Garder(b, "lig_id", "ele_id", "code", "quantite");
            o["parts"] = new JsonArray([.. (b?["parts"] as JsonArray ?? []).Select(p => (JsonNode?)Garder(p, "nature", "depot_id", "commande_id", "fournisseur_id", "quantite"))]);
            return (JsonNode?)o;
        })]),
        ["reappros"] = new JsonArray([.. (v["reappros"] as JsonArray ?? []).Select(r =>
        {
            var o = Garder(r, "depot_id");
            o["fournisseurs"] = new JsonArray([.. (r?["fournisseurs"] as JsonArray ?? []).Select(f =>
            {
                var fo = Garder(f, "fournisseur_id");
                fo["lignes"] = new JsonArray([.. (f?["lignes"] as JsonArray ?? []).Select(l => (JsonNode?)Garder(l, "ele_id", "code", "motif", "quantite", "unites_achat"))]);
                return (JsonNode?)fo;
            })]);
            return (JsonNode?)o;
        })]),
    };

    private static bool Vide(JsonObject c) =>
        !(c["besoins"] as JsonArray ?? []).Any(b => (b?["parts"] as JsonArray ?? []).Any(p => Decimal(p?["quantite"]) > 0))
        && !(c["reappros"] as JsonArray ?? []).Any(r => (r?["fournisseurs"] as JsonArray ?? []).Any(f => (f?["lignes"] as JsonArray ?? []).Any(l => Decimal(l?["unites_achat"]) > 0)));

    private static decimal? Decimal(JsonNode? n) => n is JsonValue v && v.TryGetValue<decimal>(out var d) ? d : null;

    private static readonly string[] Natures = [NaturePartAppro.Stock, NaturePartAppro.Commande, NaturePartAppro.Achat];

    /// <summary>Contrôle d'un contenu de ventilation (corrigé par l'humain) : structure, natures, quantités positives, dépôt d'une part STOCK.</summary>
    public static IReadOnlyList<string> ControlerVentilation(JsonNode? contenu)
    {
        bool Ok()
        {
            if (contenu is not JsonObject c || c["besoins"] is not JsonArray besoins || c["reappros"] is not JsonArray reappros) return false;
            foreach (var b in besoins)
            {
                if (OperationsLignesBtp.Entier(b?["lig_id"]) is null || b?["parts"] is not JsonArray parts) return false;
                foreach (var p in parts)
                {
                    var nature = OperationsLignesBtp.Texte(p?["nature"]);
                    if (nature is null || !Natures.Contains(nature) || Decimal(p?["quantite"]) is not decimal q || q < 0) return false;
                    if (nature == NaturePartAppro.Stock && OperationsLignesBtp.Entier(p?["depot_id"]) is null) return false;
                }
            }
            foreach (var r in reappros)
            {
                if (OperationsLignesBtp.Entier(r?["depot_id"]) is null || r?["fournisseurs"] is not JsonArray fs) return false;
                foreach (var f in fs)
                {
                    if (f?["lignes"] is not JsonArray ls) return false;
                    if (ls.Any(l => OperationsLignesBtp.Entier(l?["ele_id"]) is null || Decimal(l?["unites_achat"]) is not decimal u || u < 0)) return false;
                }
            }
            return true;
        }
        return Ok() ? [] : [Mcp.ErreurMcp.McpContenuInvalide];
    }

    // ------------------------------------------------------------------ exécuteurs (humain)

    private static long Cible(ExecutionProposition x) =>
        long.TryParse(x.CibleId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id) ? id : throw ExceptionMetier.Introuvable("Cible de la proposition");

    /// <summary>valider_piece : validation existante (DocumentService.Valider) sous l'identité de l'humain : droit VALIDER du type, montants, version lue.</summary>
    public static async Task<JsonObject> ValiderAsync(ExecutionProposition x, CancellationToken ct)
    {
        var id = Cible(x);
        var documents = x.Services.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
        var version = OperationsLignesBtp.Entier(x.Contenu["ent_version"]) is long v ? (int)v : (await documents.Charger(id, ct)).Document.EntVersion;
        var r = await documents.Valider(id, new DemandeVersion { EntVersion = version }, x.Humain, ct);
        var d = (r.Document ?? await documents.Charger(id, ct)).Document;
        return new JsonObject
        {
            ["identifiants"] = new JsonArray(d.EntId), ["ent_id"] = d.EntId, ["ent_numero"] = d.EntNumero, ["ent_verrouille"] = d.EntVerrouille,
            ["adresse"] = AdressesApp.UrlDocument(d.EntId),
        };
    }

    /// <summary>
    /// envoyer_document : préparation et mise en file du module Mail (comme le bouton « Envoyer » de la pièce) sous l'identité
    /// de l'humain, qui doit avoir le droit d'envoyer un courriel ; message de l'agent repris en texte (jamais en HTML).
    /// </summary>
    public static async Task<JsonObject> EnvoyerAsync(ExecutionProposition x, CancellationToken ct)
    {
        var id = Cible(x);
        if (x.Services.GetService<IDroits>() is { } droits && !await droits.AutoriseAsync(x.Humain, "mail", ActionsDroits.Creer, ct))
            throw ExceptionMetier.AccesRefuse(ActionsDroits.Creer);
        var mail = x.Services.GetRequiredService<ServiceEnvoiMail>();
        var id2 = id.ToString(CultureInfo.InvariantCulture);
        var brouillon = await mail.PreparerAsync(x.Humain, TypeDocumentElement, id2, null, ct);
        var donnes = (x.Contenu["destinataires"] as JsonArray ?? []).Select(OperationsLignesBtp.Texte).Where(a => !string.IsNullOrWhiteSpace(a))
            .Select(a => new DestinataireSaisi(a!.Trim())).ToList();
        var a = donnes.Count > 0 ? donnes
            : brouillon.Destinataires.Where(d => d.ParDefaut).Select(d => new DestinataireSaisi(d.Adresse, d.Nom, d.PerId, d.IndId)).ToList();
        if (a.Count == 0) throw ExceptionMetier.Invalide(ErreursMcpBtp.Destinataire, "Aucun destinataire pour cet envoi");
        var objet = OperationsLignesBtp.Texte(x.Contenu["objet"]) is { Length: > 0 } o ? o : brouillon.Objet;
        var corps = OperationsLignesBtp.Texte(x.Contenu["message"]) is { Length: > 0 } m
            ? "<p>" + WebUtility.HtmlEncode(m).Replace("\n", "<br>") + "</p>" + brouillon.CorpsHtml : brouillon.CorpsHtml;
        // Sans compte d'envoi, PreparerAsync a déjà refusé (MAIL_NON_CONFIGURE) : un expéditeur existe.
        var alias = brouillon.AliasId ?? brouillon.Expediteurs[0].Id;
        var r = await mail.EnvoyerAsync(x.Humain, new DemandeEnvoi(alias, a, null, null, objet, corps,
            [.. brouillon.Pieces.Where(p => p.Cochee).Select(p => p.Reference)], TypeDocumentElement, id2, brouillon.Element?.Usage), ct);
        return new JsonObject
        {
            ["identifiants"] = new JsonArray(id), ["ent_id"] = id, ["messages"] = new JsonArray([.. r.Messages.Select(n => (JsonNode?)n)]), ["etat"] = r.Etat,
        };
    }

    /// <summary>creer_tiers_provisoire : fiche provisoire de l'annuaire (doublons de SIRET refusés, de nom signalés sauf confirmation de l'humain).</summary>
    public static async Task<JsonObject> CreerTiersAsync(ExecutionProposition x, CancellationToken ct)
    {
        var annuaire = x.Services.GetRequiredService<ServiceAnnuaire>();
        var cree = await annuaire.CreerProvisoire(new SaisieProvisoire
        {
            RaisonSociale = OperationsLignesBtp.Texte(x.Contenu["raison_sociale"]),
            Siret = OperationsLignesBtp.Texte(x.Contenu["siret"]),
            Casquettes = (x.Contenu["casquettes"] as JsonArray ?? []).Select(OperationsLignesBtp.Texte).OfType<string>().ToList() is { Count: > 0 } c ? c : null,
            Confirme = x.Contenu["confirme"] is JsonValue v && v.TryGetValue<bool>(out var b) && b,
        }, x.Humain, ct);
        return new JsonObject
        {
            ["identifiants"] = new JsonArray(cree.Id), ["per_id"] = cree.Id, ["code"] = cree.Code, ["adresse"] = AdressesApp.UrlFiche(TypesFiche.Personne, cree.Id),
        };
    }

    private sealed record LigneDemandeSql(long LigId, decimal Qte);

    /// <summary>
    /// appliquer_ventilation : sous l'identité de l'humain, par les services des routes existantes (droits, reliquats et
    /// règles des transformations inchangés), toutes les pièces en brouillon :
    /// <list type="bullet">
    /// <item>parts STOCK : une réservation S_RESERVATION par dépôt (transformation de la demande, dépôt d'origine posé) ;</item>
    /// <item>parts COMMANDE (reste attendu d'une commande fournisseur en cours) : une demande de stock S_DEMANDE ;</item>
    /// <item>parts ACHAT : une commande A_COMMANDE par fournisseur (transformation, fournisseur posé comme tiers) ;</item>
    /// <item>réappros : commandes de réapprovisionnement par dépôt et fournisseur (route « commander » du stock).</item>
    /// </list>
    /// Quantités des parts en unité de stock, ramenées à l'unité de la ligne de la demande au prorata du besoin.
    /// </summary>
    public static async Task<JsonObject> AppliquerVentilationAsync(ExecutionProposition x, CancellationToken ct)
    {
        if (ControlerVentilation(x.Contenu).Count > 0) throw ExceptionMetier.Invalide(Mcp.ErreurMcp.McpContenuInvalide, "Contenu de ventilation invalide");
        var dap = Cible(x);
        var sp = x.Services;
        var db = sp.GetRequiredService<LogiBtpContext>();
        if (await TypesDocumentBtp.CodeAsync(db, dap, ct) != TypesDocument.EDap)
            throw ExceptionMetier.Invalide(ErreursMcpBtp.TypeNonPermis, $"Le document {dap} n'est pas une demande d'approvisionnement");
        var transformations = sp.GetRequiredService<TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
        var lignes = (await db.Database.SqlQuery<LigneDemandeSql>($"""
            SELECT lig_id, coalesce(lig_qte, 0) AS qte FROM document_ligne WHERE lig_ent_id = {dap}
            """).ToListAsync(ct)).ToDictionary(l => l.LigId, l => l.Qte);

        // Parts regroupées par pièce cible : (nature, dépôt ou fournisseur) → ligne de la demande → quantité (unité de la ligne).
        var groupes = new Dictionary<(string Nature, long? Cle), Dictionary<long, decimal>>();
        foreach (var b in x.Contenu["besoins"] as JsonArray ?? [])
        {
            var lig = OperationsLignesBtp.Entier(b?["lig_id"])!.Value;
            if (!lignes.TryGetValue(lig, out var qteLigne)) throw ExceptionMetier.Invalide(Mcp.ErreurMcp.McpContenuInvalide, $"Ligne {lig} absente de la demande");
            var besoin = Decimal(b?["quantite"]) ?? 0;
            foreach (var p in b?["parts"] as JsonArray ?? [])
            {
                var q = Decimal(p?["quantite"]) ?? 0;
                if (q <= 0) continue;
                var nature = OperationsLignesBtp.Texte(p?["nature"])!;
                long? cle = nature switch
                {
                    NaturePartAppro.Stock => OperationsLignesBtp.Entier(p?["depot_id"]),
                    NaturePartAppro.Achat => OperationsLignesBtp.Entier(p?["fournisseur_id"]),
                    _ => null,
                };
                var enLigne = besoin > 0 && besoin != qteLigne ? ArrondiCalcul.Arr6(q * qteLigne / besoin) : q;
                var g = groupes.TryGetValue((nature, cle), out var e) ? e : groupes[(nature, cle)] = [];
                g[lig] = g.GetValueOrDefault(lig) + enLigne;
            }
        }

        var identifiants = new JsonArray();
        var reservations = new JsonArray();
        var demandes = new JsonArray();
        var commandes = new JsonArray();
        async Task<long> TransformerAsync(string code, Dictionary<long, decimal> parLigne)
        {
            var cible = await TypesDocumentBtp.IdAsync(db, code, ct);
            var cree = await transformations.Transformer(dap, new DemandeTransformation
            {
                CibleTydId = cible, Lignes = [.. parLigne.Select(kv => new LigneATransformer { LigId = kv.Key, Qte = kv.Value })],
            }, x.Humain, ct);
            identifiants.Add(cree.Document.EntId);
            return cree.Document.EntId;
        }
        foreach (var ((nature, cle), parLigne) in groupes.OrderBy(g => Array.IndexOf(Natures, g.Key.Nature)).ThenBy(g => g.Key.Cle))
        {
            switch (nature)
            {
                case NaturePartAppro.Stock:
                {
                    var id = await TransformerAsync(TypesDocument.SReservation, parLigne);
                    // Dépôt d'où la réservation prend le stock (colonne du cœur, brouillon de la transformation).
                    await db.Database.ExecuteSqlAsync($"UPDATE document SET ent_stk_origine_id = {(int)cle!.Value} WHERE ent_id = {id} AND NOT ent_verrouille", ct);
                    reservations.Add(new JsonObject { ["ent_id"] = id, ["depot_id"] = cle, ["adresse"] = AdressesApp.UrlDocument(id) });
                    break;
                }
                case NaturePartAppro.Commande:
                {
                    var id = await TransformerAsync(TypesDocument.SDemande, parLigne);
                    demandes.Add(new JsonObject { ["ent_id"] = id, ["adresse"] = AdressesApp.UrlDocument(id) });
                    break;
                }
                default:
                {
                    var id = await TransformerAsync(TypesDocument.ACommande, parLigne);
                    // Fournisseur de l'achat comme tiers de la commande (comme une demande de prix copiée pour un autre fournisseur).
                    if (cle is long f)
                        await db.Database.ExecuteSqlAsync($"""
                            UPDATE document SET ent_tiers_id = {f}, ent_contact_client = NULL, ent_contact_payeur = NULL WHERE ent_id = {id} AND NOT ent_verrouille
                            """, ct);
                    commandes.Add(new JsonObject { ["ent_id"] = id, ["fournisseur_id"] = cle, ["adresse"] = AdressesApp.UrlDocument(id) });
                    break;
                }
            }
        }

        // Réappros : une commande par fournisseur et par dépôt (route existante du stock : droit de gestion, brouillons).
        var reappros = new JsonArray();
        var sansFournisseur = new JsonArray();
        var appro = sp.GetRequiredService<ServiceApprovisionnement>();
        foreach (var r in x.Contenu["reappros"] as JsonArray ?? [])
        {
            var depot = OperationsLignesBtp.Entier(r?["depot_id"])!.Value;
            var aCommander = new List<LigneACommander>();
            foreach (var f in r?["fournisseurs"] as JsonArray ?? [])
            {
                var fournisseur = OperationsLignesBtp.Entier(f?["fournisseur_id"]);
                foreach (var l in f?["lignes"] as JsonArray ?? [])
                {
                    var u = Decimal(l?["unites_achat"]) ?? 0;
                    if (u <= 0) continue;
                    var ele = OperationsLignesBtp.Entier(l?["ele_id"])!.Value;
                    if (fournisseur is null) sansFournisseur.Add(new JsonObject { ["depot_id"] = depot, ["ele_id"] = ele });
                    else aCommander.Add(new LigneACommander(ele, u, fournisseur));
                }
            }
            if (aCommander.Count == 0) continue;
            foreach (var c in await appro.CommanderAsync(depot, new CommandeSaisie(aCommander), x.Humain, ct))
            {
                identifiants.Add(c.EntId);
                reappros.Add(new JsonObject
                {
                    ["ent_id"] = c.EntId, ["ent_numero"] = c.Numero, ["depot_id"] = depot, ["fournisseur"] = c.Fournisseur, ["lignes"] = c.Lignes,
                    ["adresse"] = AdressesApp.UrlDocument(c.EntId),
                });
            }
        }
        if (identifiants.Count == 0) throw ExceptionMetier.Invalide(ErreursMcpBtp.VentilationVide, "Rien à créer pour cette demande");
        return new JsonObject
        {
            ["identifiants"] = identifiants, ["ent_id"] = dap, ["reservations"] = reservations, ["demandes_stock"] = demandes, ["commandes"] = commandes,
            ["reappros"] = reappros, ["sans_fournisseur"] = sansFournisseur,
        };
    }

    /// <summary>Exécuteurs déclarés au module MCP.</summary>
    public static IReadOnlyList<ExecuteurProposition> Executeurs { get; } =
    [
        new(ValiderPiece, ValiderAsync) { TypeElement = TypeDocumentElement },
        new(AppliquerVentilation, AppliquerVentilationAsync) { TypeElement = TypeDocumentElement, Controler = ControlerVentilation },
        new(EnvoyerDocument, EnvoyerAsync) { TypeElement = TypeDocumentElement },
        new(CreerTiersProvisoire, CreerTiersAsync) { TypeElement = $"fiche/{TypesFiche.Personne}" },
    ];
}
