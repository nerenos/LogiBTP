using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Mcp;
using LogiBTP.Mcp.Web;
using LogiBTP.Socle;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module MCP spécialisé par le cœur (plans/mcp.md, lots 5 et 6) : nœud de gestion « agents », activation par société
/// (<see cref="ModulesFacultatifs.Mcp"/>, db/308), catalogue des outils de lecture (chacun appelle une route /api
/// existante, sous les droits de l'agent : aucune règle dupliquée), nœuds retenus et clés sensibles par garde-fou,
/// contenus libres, adresse absolue de chaque résultat (<see cref="AdressesApp"/>), descriptions du dictionnaire
/// (<c>McpTextes.json</c>, ressource incorporée ; pas de suffixe de culture : il en ferait un assemblage satellite).
/// </summary>
public sealed partial class SpecialisationMcpBtp : SpecialisationMcp
{
    /// <summary>Nœud de droits des routes /api/mcp (gestion des délégations de l'utilisateur).</summary>
    public const string NoeudAgents = "agents";

    /// <summary>Pagination de l'outil « rechercher » (taille d'une page de liste, au plus).</summary>
    public const int TaillePageMax = 200;

    public override string Noeud => NoeudAgents;

    public override string? Module => ModulesFacultatifs.Mcp;

    private static JsonElement Schema(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static readonly JsonElement SchemaRechercher = Schema($$"""
        {"type":"object","required":["vue_id"],"properties":{
          "vue_id":{"type":"integer","description":"Identifiant de la vue de liste enregistrée"},
          "recherche":{"type":"string"},
          "filtres":{"type":"array","items":{"type":"object"},"description":"Filtres ajoutés à ceux de la vue (colonne, operateur, valeur)"},
          "tri":{"type":"array","items":{"type":"object"},"description":"Tri (colonne, sens)"},
          "apres":{"type":"array","items":{"type":["string","null"]},"description":"Curseur : « suite » de la page précédente"},
          "taille":{"type":"integer","minimum":1,"maximum":{{TaillePageMax}} } } }
        """);

    private static readonly JsonElement SchemaId = Schema("""{"type":"object","required":["id"],"properties":{"id":{"type":"integer"}}}""");

    private static readonly JsonElement SchemaBibliotheque = Schema("""
        {"type":"object","required":["recherche"],"properties":{
          "recherche":{"type":"string"},"type":{"type":"string","enum":["ARTICLE","OUVRAGE","ENSEMBLE"]},"bib":{"type":"integer"}}}
        """);

    private static readonly JsonElement SchemaStock = Schema("""
        {"type":"object","required":["lieu"],"properties":{
          "lieu":{"type":"integer"},"date":{"type":"string","format":"date-time"},"zeros":{"type":"boolean"}}}
        """);

    private static readonly JsonElement SchemaVide = Schema("""{"type":"object","properties":{}}""");

    private static readonly JsonElement SchemaTiers = Schema($$"""
        {"type":"object","properties":{
          "recherche":{"type":"string"},"id":{"type":"integer"},"casquette":{"type":"string"},
          "limite":{"type":"integer","minimum":1,"maximum":{{DesignationTiersBtp.LimiteMax}} } } }
        """);

    /// <summary>Opérations de lignes (OperationsLignesBtp) : schéma commun de creer_devis et modifier_lignes.</summary>
    private static readonly string SchemaOperations = $$"""
        {"type":"array","maxItems":{{OperationsLignesBtp.OperationsMax}},"items":{"type":"object","required":["op"],"properties":{
          "op":{"type":"string","enum":[{{string.Join(",", OperationsLignesBtp.Operations.Select(o => $"\"{o}\""))}}]},
          "element_id":{"type":"integer","description":"ajouter : élément de la bibliothèque (article, ouvrage, ensemble)"},
          "quantite":{"type":"number","description":"ajouter : quantité (1 par défaut)"},
          "lig_id":{"type":"integer","description":"quantite, designation, remise, supprimer, deplacer : ligne visée"},
          "valeur":{"type":["number","string"],"description":"quantite : nouvelle quantité ; designation : nouveau libellé (texte)"},
          "pourcentage":{"type":"number","minimum":0,"exclusiveMaximum":100,"description":"remise : remise en %"},
          "parent_id":{"type":"integer","description":"ajouter, deplacer : titre ou section qui reçoit la ligne (à la fin)"},
          "apres_id":{"type":"integer","description":"ajouter, deplacer : placer après cette ligne (même parent)"} } } }
        """;

    private static readonly JsonElement SchemaCreerDevis = Schema($$"""
        {"type":"object","properties":{
          "source_id":{"type":"integer","description":"Devis à copier (ent_id)"},
          "modele":{"type":"string","description":"Code du modèle de saisie (lister_modeles), si pas de devis source"},
          "tiers_id":{"type":"integer","description":"Client désigné par designer_tiers (per_id)"},
          "objet":{"type":"string"},
          "operations":{{SchemaOperations}} } }
        """);

    private static readonly JsonElement SchemaModifierLignes = Schema($$"""
        {"type":"object","required":["id","operations"],"properties":{
          "id":{"type":"integer","description":"Devis brouillon (ent_id)"},
          "version":{"type":"integer","description":"ent_version lue : refus 409 si le devis a changé depuis"},
          "operations":{{SchemaOperations}} } }
        """);

    /// <summary>Routes d'une modification de lignes : verrou (état, prise, libération), lecture, enregistrement, définition du type, élément, avertissements.</summary>
    private static readonly RouteOutil[] RoutesModification =
    [
        new("GET", McpDocumentsBtp.RouteVerrou), new("POST", McpDocumentsBtp.RouteVerrou), new("DELETE", McpDocumentsBtp.RouteVerrou),
        new("GET", McpDocumentsBtp.RouteDocument), new("PUT", McpDocumentsBtp.RouteDocument), new("GET", McpDocumentsBtp.RouteDefinition),
        new("GET", McpDocumentsBtp.RouteElement), new("GET", McpDocumentsBtp.RouteAvertissements), new("POST", McpDocumentsBtp.RouteAvecContenu),
    ];

    /// <summary>Clés de coûts d'un élément de bibliothèque rendu par la recherche (ElementRechercheDto).</summary>
    private static readonly string[] CoutsBibliotheque = ["pa", "pr", "coef_fg", "coef_benef"];

    /// <summary>Clés de valorisation de l'état du stock (EtatStock, LigneEtatStock) : coûts (PMP, dernier PA).</summary>
    private static readonly string[] CoutsStock = ["valeur", "valeur_unitaire", "pmp", "dernier_pa", "prix_inventaire", "valeur_inventaire"];

    public override IReadOnlyList<OutilMcp> Outils { get; } =
    [
        new("rechercher", "mcp_btp.outils.rechercher", SchemaRechercher, "POST", "/api/listes/lot", "listes", ActionsDroits.Consulter, ClasseOutil.Lecture)
        {
            ParametreLimite = "taille", LimiteMax = TaillePageMax, CleListe = "lignes", TypeElement = "liste", CleIdentifiant = "_id",
        },
        // Lot 7 : pièce d'achat sous COUTS, prix et montants retirés (outil composé : type de la pièce lu).
        new("lire_document", "mcp_btp.outils.lire_document", SchemaId, "GET", McpDocumentsBtp.RouteDocument, "documents", ActionsDroits.Consulter, ClasseOutil.Lecture)
        {
            TypeElement = "document", Routes = [new("GET", McpDocumentsBtp.RouteTypes)], Execution = McpDocumentsBtp.LireDocumentAsync,
        },
        new("lire_marche", "mcp_btp.outils.lire_marche", SchemaId, "GET", $"/api/fiches/{TypesFiche.Marche}/{{id}}", $"fiches/{TypesFiche.Marche}",
            ActionsDroits.Consulter, ClasseOutil.Lecture) { TypeElement = $"fiche/{TypesFiche.Marche}", CleIdentifiant = "id" },
        new("lire_chantier", "mcp_btp.outils.lire_chantier", SchemaId, "GET", $"/api/fiches/{TypesFiche.Chantier}/{{id}}", $"fiches/{TypesFiche.Chantier}",
            ActionsDroits.Consulter, ClasseOutil.Lecture) { TypeElement = $"fiche/{TypesFiche.Chantier}", CleIdentifiant = "id" },
        new("rechercher_bibliotheque", "mcp_btp.outils.rechercher_bibliotheque", SchemaBibliotheque, "GET", "/api/bibliotheque/elements", "bibliotheque",
            ActionsDroits.Consulter, ClasseOutil.Lecture)
        {
            TypeElement = TypesFiche.Element, CleIdentifiant = "id",
            ClesSensibles = new Dictionary<string, IReadOnlyList<string>> { [GardeFou.Couts] = CoutsBibliotheque },
        },
        new("lire_stock", "mcp_btp.outils.lire_stock", SchemaStock, "GET", "/api/stock/lieux/{lieu}/etat", "stock", ActionsDroits.Consulter, ClasseOutil.Lecture)
        {
            CleListe = "lignes", TypeElement = "stock", CleIdentifiant = "ele_id",
            ClesSensibles = new Dictionary<string, IReadOnlyList<string>> { [GardeFou.Couts] = CoutsStock },
        },
        new("lister_modeles", "mcp_btp.outils.lister_modeles", SchemaVide, "GET", "/api/modeles-document", "documents", ActionsDroits.Consulter, ClasseOutil.Lecture)
        {
            TypeElement = "modele_document", CleIdentifiant = "code",
        },
        new("designer_tiers", "mcp_btp.outils.designer_tiers", SchemaTiers, "GET", "/api/designation/tiers", "documents", ActionsDroits.Consulter, ClasseOutil.Lecture)
        {
            ParametreLimite = "limite", LimiteMax = DesignationTiersBtp.LimiteMax, TypeElement = $"fiche/{TypesFiche.Personne}", CleIdentifiant = "per_id",
        },
        // Lot 7 : écritures des devis, toujours en brouillon (outils composés, McpDocumentsBtp ; liste blanche = leurs routes d'écriture).
        new("creer_devis", "mcp_btp.outils.creer_devis", SchemaCreerDevis, "POST", McpDocumentsBtp.RouteAvecContenu, McpDocumentsBtp.NoeudDevis,
            ActionsDroits.Creer, ClasseOutil.Brouillon)
        {
            TypeElement = "document", CleIdentifiant = "ent_id", Execution = McpDocumentsBtp.CreerDevisAsync,
            Routes = [new("POST", McpDocumentsBtp.RouteCopie), .. RoutesModification],
        },
        new("modifier_lignes", "mcp_btp.outils.modifier_lignes", SchemaModifierLignes, "PUT", McpDocumentsBtp.RouteDocument, McpDocumentsBtp.NoeudDevis,
            ActionsDroits.Modifier, ClasseOutil.Brouillon)
        {
            TypeElement = "document", CleIdentifiant = "ent_id", Execution = McpDocumentsBtp.ModifierLignesAsync, Routes = RoutesModification,
        },
        new("transformer", "mcp_btp.outils.transformer", SchemaId, "POST", McpDocumentsBtp.RouteTransformer, McpDocumentsBtp.NoeudCommande,
            ActionsDroits.Creer, ClasseOutil.Brouillon)
        {
            TypeElement = "document", CleIdentifiant = "ent_id", Execution = McpDocumentsBtp.TransformerAsync,
            Routes = [new("GET", McpDocumentsBtp.RouteDocument), new("GET", McpDocumentsBtp.RouteDefinition), new("GET", McpDocumentsBtp.RouteAvertissements)],
        },
    ];

    /// <summary>
    /// Nœuds retenus par garde-fou actif (ANALYSE-MODULE-MCP.md § 5.2) : l'agent n'y a aucune action (lecture comprise ;
    /// choix du lot 2 confirmé au lot 6 : les écritures aussi). Un tiers se désigne par <c>designer_tiers</c>.
    /// </summary>
    public override IReadOnlyDictionary<string, IReadOnlyList<string>> NoeudsRetenus { get; } = new Dictionary<string, IReadOnlyList<string>>
    {
        [GardeFou.Tiers] = ["annuaire", $"fiches/{TypesFiche.Personne}", $"fiches/{TypesFiche.Individu}"],
        [GardeFou.Salaries] = [$"fiches/{TypesFiche.Salarie}", "ressources"],
        // Pointage (et sa liste des repas, pointage/repas) : nominatif.
        [GardeFou.Paie] = ["pointage", SpecialisationListeBtp.NoeudRepas],
        [GardeFou.CrmNotes] = ["crm"],
        [GardeFou.Couts] = [SpecialisationRentabiliteBtp.NoeudCouts],
    };

    /// <summary>Données personnelles d'un individu (individu, DDL du module Annuaire) : nom, naissance, commentaire…</summary>
    private static readonly string[] IndividuPersonnel =
        ["ind_civilite", "ind_nom", "ind_prenom", "ind_date_naissance", "ind_commentaire", "ind_proprietes", "ind_utilisateur", "ind_image_ged"];

    /// <summary>Colonnes de la fiche salarié (db/120) hors désignation (sal_id, sal_code, sal_poste, sal_qualification, sal_service, sal_type_mo, sal_actif).</summary>
    private static readonly string[] SalariePersonnel =
    [
        "sal_nom", "sal_prenom", "sal_adresse", "sal_code_postal", "sal_ville", "sal_date_naissance", "sal_num_secu", "sal_email", "sal_email_perso",
        "sal_telephone", "sal_telephone_perso", "sal_contact_nom", "sal_contact_telephone", "sal_note_perso", "sal_commentaire", "sal_proprietes",
        "sal_matricule", "sal_matricule_paie", "sal_date_entree", "sal_date_sortie", "sal_statut", "sal_ind_id", "sal_cha_dotation_id", "sal_agence",
        "sal_agence_per_id", "sal_cal_id", "sal_usage", "sal_heures_mois", "sal_salaire", "sal_cout_horaire", "sal_ppf_id",
    ];

    /// <summary>
    /// Clés retirées de toutes les réponses par garde-fou actif (noms de colonnes du DDL) ; défense en profondeur en plus
    /// des nœuds retenus (un oubli de route ne suffit pas à faire fuir un champ).
    /// </summary>
    public override IReadOnlyDictionary<string, IReadOnlyList<string>> ClesSensibles { get; } = new Dictionary<string, IReadOnlyList<string>>
    {
        // Annuaire (070, 071…) : IBAN / BIC, coordonnées, notes, encours ; individus ; contacts et adresses figés des pièces.
        [GardeFou.Tiers] =
        [
            "per_iban", "per_bic", "per_commentaire", "per_rel_commentaire", "per_cli_encours_max", "per_proprietes",
            "coo_valeur", "coo_ligne1", "coo_ligne2", "coo_ligne3", "coo_code_postal", "coo_ville", "coo_pays",
            "uco_libelle", "rat_commentaire", "ent_contact_client", "ent_contact_payeur", "ent_adresse_facturation", "ent_adresse_livraison",
            .. IndividuPersonnel,
        ],
        [GardeFou.Salaries] = [.. SalariePersonnel, .. IndividuPersonnel],
        [GardeFou.Paie] = ["sal_salaire", "sal_cout_horaire", "sal_heures_mois", "sal_matricule_paie", "sal_ppf_id"],
        // Prix d'achat et de revient, coefficients (lignes de pièces, éléments de bibliothèque, tarifs fournisseurs, coût MO).
        [GardeFou.Couts] =
        [
            "lig_pa", "lig_pr", "lig_montant_pa", "lig_montant_pr", "lig_coef_fg", "lig_coef_benef",
            "ele_pa_fixe", "ele_dernier_pa", "ele_pmp", "ele_pa", "ele_coef_fg", "ele_pr", "ele_coef_benef", "tfo_prix", "sal_cout_horaire",
        ],
    };

    /// <summary>Contenus libres (saisis par un tiers ou recopiés d'un courriel, d'un PDF) : balisés contenu_non_fiable.</summary>
    public override IReadOnlyList<string> ClesNonFiables { get; } = ["proprietes", "ent_proprietes", "lig_proprietes", "commentaire", "ele_commentaire_prix"];

    public override Dictionnaire? Textes { get; } = LireTextes();

    private static Dictionnaire LireTextes()
    {
        using var flux = typeof(SpecialisationMcpBtp).Assembly.GetManifestResourceStream("LogiBTP.Api.Btp.McpTextes.json")
            ?? throw new InvalidOperationException("MCP : dictionnaire McpTextes.json absent de l'assemblage");
        using var lecteur = new StreamReader(flux);
        return Dictionnaire.Lire(lecteur.ReadToEnd());
    }

    [GeneratedRegex("^[VATSE]_")]
    private static partial Regex TypeDocument();

    /// <summary>Types d'élément des listes ouverts par une fiche (ficheDeLigne du client).</summary>
    private static readonly HashSet<string> TypesFicheListe =
        [TypesFiche.Salarie, TypesFiche.Materiel, TypesFiche.Element, TypesFiche.Personne, TypesFiche.Individu,
         TypesFiche.Projet, TypesFiche.Affaire, TypesFiche.Chantier, TypesFiche.Marche];

    private static string? Texte(JsonNode? n) => n is JsonValue v ? (v.TryGetValue<string>(out var s) ? s : v.ToJsonString()) : null;

    /// <summary>Adresse d'un élément d'une ligne de liste (même règle que urlElement du client pour les documents et les fiches).</summary>
    public static string? AdresseElement(string? type, string? id)
    {
        if (string.IsNullOrEmpty(type) || string.IsNullOrEmpty(id)) return null;
        if (TypeDocument().IsMatch(type) && long.TryParse(id, out var ent)) return AdressesApp.UrlDocument(ent);
        if (type == "interim") type = TypesFiche.Salarie;
        return TypesFicheListe.Contains(type) ? AdressesApp.UrlFiche(type, id) : null;
    }

    public override string? Adresse(OutilMcp outil, JsonObject element) => outil.Nom switch
    {
        "rechercher" => AdresseElement(Texte(element["_type"]), Texte(element["_id"])),
        "lire_document" => element["document"]?["ent_id"] is { } ent && long.TryParse(Texte(ent), out var id) ? AdressesApp.UrlDocument(id) : null,
        "creer_devis" or "modifier_lignes" or "transformer" => long.TryParse(Texte(element["ent_id"]), out var p) && p > 0 ? AdressesApp.UrlDocument(p) : null,
        "lire_marche" => Texte(element["id"]) is { Length: > 0 } m ? AdressesApp.UrlFiche(TypesFiche.Marche, m) : null,
        "lire_chantier" => Texte(element["id"]) is { Length: > 0 } c ? AdressesApp.UrlFiche(TypesFiche.Chantier, c) : null,
        "rechercher_bibliotheque" => Texte(element["id"]) is { Length: > 0 } e ? AdressesApp.UrlFiche(TypesFiche.Element, e) : null,
        "lire_stock" => Texte(element["ele_id"]) is { Length: > 0 } a ? AdressesApp.UrlFiche(TypesFiche.Element, a) : null,
        "designer_tiers" => Texte(element["per_id"]) is { Length: > 0 } p ? AdressesApp.UrlFiche(TypesFiche.Personne, p) : null,
        _ => null,
    };
}
