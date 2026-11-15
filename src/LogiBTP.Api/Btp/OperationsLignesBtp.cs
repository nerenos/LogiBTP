using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Bibliotheque;
using LogiBTP.Bibliotheque.Web;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Metres;
using LogiBTP.Socle;

namespace LogiBTP.Api.Btp;

/// <summary>Refus d'un outil d'agent : statut HTTP, code (<see cref="ErreursMcpBtp"/>), message et détails.</summary>
public sealed class ErreurOutilMcp(int statut, string code, string message, JsonNode? details = null) : Exception(message)
{
    public int Statut { get; } = statut;
    public string Code { get; } = code;
    public JsonNode? Details { get; } = details;
}

/// <summary>
/// Opérations de lignes d'un agent IA sur un devis lu (module MCP, lot 7 ; ANALYSE-MODULE-MCP.md § 7.1) : ajouter un
/// élément de la bibliothèque (article, ouvrage avec sa composition, ensemble), changer une quantité, une désignation, une
/// remise, supprimer une ligne (et son sous-arbre), déplacer une ligne ou un chapitre. Aucune règle de calcul : le serveur
/// recalcule à l'enregistrement (moteur C#). Mêmes valeurs posées que l'appel de la bibliothèque du client
/// (<c>client/src/app/bibliotheque/appel.js</c> : <c>valeursArticle</c>, <c>contenuOuvrage</c>, <c>contenuEnsemble</c>) et que
/// le contexte d'insertion (<c>appliquerContexte</c>, <c>tauxParDefaut</c>) ; seules les lignes changent, jamais l'entête.
/// </summary>
public static class OperationsLignesBtp
{
    public const string Ajouter = "ajouter";
    public const string Quantite = "quantite";
    public const string Designation = "designation";
    public const string Remise = "remise";
    public const string Supprimer = "supprimer";
    public const string Deplacer = "deplacer";

    /// <summary>Opérations reconnues (ordre du schéma de l'outil).</summary>
    public static readonly string[] Operations = [Ajouter, Quantite, Designation, Remise, Supprimer, Deplacer];

    /// <summary>Nombre d'opérations par appel, au plus.</summary>
    public const int OperationsMax = 100;

    /// <summary>Longueur d'une désignation saisie par l'agent, au plus.</summary>
    public const int DesignationMax = 2000;

    private const string TypeOuvrage = "OUVRAGE";
    private const string TypeEnsemble = "ENSEMBLE";
    private static readonly string[] TypesRefuses = ["POSTE_PIED", "TEXTE"];

    /// <summary>Données de l'application des opérations : éléments de bibliothèque lus, taux de TVA du type.</summary>
    public sealed record Contexte(IReadOnlyDictionary<long, ElementDetailDto> Elements, IReadOnlyList<TauxTva> Taux);

    /// <summary>Options JSON de l'API (noms snake_case, décimaux acceptés en chaîne).</summary>
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString,
    };

    private static ErreurOutilMcp Refus(string code, string message, int? index = null, long? ligne = null)
    {
        var details = new JsonObject();
        if (index is int i) details["operation"] = i;
        if (ligne is long l) details["lig_id"] = l;
        return new ErreurOutilMcp(422, code, message, details);
    }

    /// <summary>Identifiants des éléments de bibliothèque à lire avant d'appliquer les opérations.</summary>
    public static IReadOnlyList<long> ElementsDemandes(JsonArray? operations) =>
        (operations ?? []).OfType<JsonObject>().Where(o => Texte(o["op"]) == Ajouter).Select(o => Entier(o["element_id"])).OfType<long>().Distinct().ToList();

    /// <summary>
    /// Applique les opérations, dans l'ordre, au document lu (modifié sur place). Refus (422) à la première opération
    /// invalide : rien n'est enregistré.
    /// </summary>
    public static void Appliquer(DocumentCompletBtp d, JsonArray? operations, Contexte c)
    {
        var ops = operations ?? [];
        if (ops.Count > OperationsMax) throw Refus(ErreursMcpBtp.Operation, $"Au plus {OperationsMax} opérations par appel");
        var prochain = Math.Min(0, d.Lignes.Select(l => l.LigId).Concat(d.Metres.Select(m => m.MtrId)).Concat(d.Variables.Select(v => v.VarId))
            .DefaultIfEmpty(0).Min()) - 1;
        for (var i = 0; i < ops.Count; i++)
        {
            if (ops[i] is not JsonObject o) throw Refus(ErreursMcpBtp.Operation, "Opération attendue sous forme d'objet", i);
            switch (Texte(o["op"]))
            {
                case Ajouter: AjouterElement(d, o, c, i, ref prochain); break;
                case Quantite:
                {
                    var l = LigneChiffree(d, o, i);
                    l.LigQte = Nombre(o["valeur"]) ?? throw Refus(ErreursMcpBtp.Operation, "Quantité attendue (valeur)", i);
                    // Quantité saisie : elle ne suit plus le métré (apresModification du client).
                    if (l.LigQteSource == "M") l.LigQteSource = "S";
                    break;
                }
                case Designation:
                {
                    var l = Ligne(d, o, i);
                    var t = Texte(o["valeur"])?.Trim();
                    if (string.IsNullOrEmpty(t) || t.Length > DesignationMax) throw Refus(ErreursMcpBtp.Operation, $"Désignation attendue (1 à {DesignationMax} caractères)", i);
                    l.LigLibelleHtml = WebUtility.HtmlEncode(t);
                    break;
                }
                case Remise:
                {
                    var l = LigneChiffree(d, o, i);
                    var p = Nombre(o["pourcentage"]);
                    if (p is not decimal pc || pc < 0 || pc >= 100) throw Refus(ErreursMcpBtp.Operation, "Remise en % attendue (pourcentage, de 0 à moins de 100)", i);
                    // Seul le coefficient est enregistré (saisie en % convertie).
                    l.LigCoefRemise = ArrondiCalcul.Arr6(1 - pc / 100);
                    break;
                }
                case Supprimer: SupprimerLigne(d, Ligne(d, o, i).LigId); break;
                case Deplacer: DeplacerLigne(d, o, c, i); break;
                default: throw Refus(ErreursMcpBtp.Operation, $"Opération inconnue (attendue : {string.Join(", ", Operations)})", i);
            }
        }
    }

    // ------------------------------------------------------------------ lignes

    private static DocumentLigneBtp Ligne(DocumentCompletBtp d, JsonObject o, int i)
    {
        var id = Entier(o["lig_id"]) ?? throw Refus(ErreursMcpBtp.Operation, "Ligne attendue (lig_id)", i);
        return d.Lignes.FirstOrDefault(l => l.LigId == id) ?? throw Refus(ErreursMcpBtp.Ligne, $"Ligne {id} absente du document", i, id);
    }

    private static DocumentLigneBtp LigneChiffree(DocumentCompletBtp d, JsonObject o, int i)
    {
        var l = Ligne(d, o, i);
        if (!TL.EstChiffree(l)) throw Refus(ErreursMcpBtp.Ligne, $"La ligne {l.LigId} n'est ni un élément ni un ouvrage", i, l.LigId);
        return l;
    }

    private static Dictionary<long, DocumentLigneBtp> Index(DocumentCompletBtp d) => d.Lignes.ToDictionary(l => l.LigId);

    private static IEnumerable<DocumentLigneBtp> Ancetres(Dictionary<long, DocumentLigneBtp> index, long? parent)
    {
        for (var p = parent; p is long id && index.TryGetValue(id, out var l); p = l.LigParentId) yield return l;
    }

    private static HashSet<long> SousArbre(DocumentCompletBtp d, long racine)
    {
        var ids = new HashSet<long> { racine };
        for (var ajout = true; ajout;)
        {
            ajout = false;
            foreach (var l in d.Lignes)
                if (l.LigParentId is long p && ids.Contains(p) && ids.Add(l.LigId)) ajout = true;
        }
        return ids;
    }

    /// <summary>Taux d'une ligne de prix hors ouvrage : titre le plus proche porteur d'un taux, sinon taux du document, sinon taux par défaut.</summary>
    public static int? TauxParDefaut(DocumentCompletBtp d, long? parent, IReadOnlyList<TauxTva> taux)
    {
        var titre = Ancetres(Index(d), parent).FirstOrDefault(t => t.LigTylId == TL.Titre && t.LigTvaId is not null)?.LigTvaId;
        if (titre is not null) return titre;
        if (d.Document.EntTvaId is int e && taux.Any(t => t.TtvId == e)) return e;
        return (taux.FirstOrDefault(t => t.TtvDefaut) ?? taux.FirstOrDefault())?.TtvId;
    }

    /// <summary>
    /// Parent et rang d'insertion : après la ligne <c>apres_id</c> (même parent), dans la tranche <c>parent_id</c> (avant
    /// ses lignes de pied), sinon à la fin du corps (dernière section s'il y en a, avant le pied). Parent : titre ou section.
    /// </summary>
    private static (long? Parent, long? Apres) Position(DocumentCompletBtp d, JsonObject o, int i)
    {
        var index = Index(d);
        if (Entier(o["apres_id"]) is long apres)
        {
            if (!index.TryGetValue(apres, out var a)) throw Refus(ErreursMcpBtp.Ligne, $"Ligne {apres} absente du document", i, apres);
            if (a.LigParentId is long p && !TL.EstTranche(index[p])) throw Refus(ErreursMcpBtp.Ligne, $"La ligne {apres} est une composante d'ouvrage", i, apres);
            return (a.LigParentId, apres);
        }
        if (Entier(o["parent_id"]) is long parent)
        {
            if (!index.TryGetValue(parent, out var t)) throw Refus(ErreursMcpBtp.Ligne, $"Ligne {parent} absente du document", i, parent);
            if (!TL.EstTranche(t)) throw Refus(ErreursMcpBtp.Ligne, $"La ligne {parent} n'est ni un titre ni une section", i, parent);
            return (parent, null);
        }
        var section = Freres(d, null).LastOrDefault(l => l.LigTylId == TL.Section);
        return (section?.LigId, null);
    }

    private static List<DocumentLigneBtp> Freres(DocumentCompletBtp d, long? parent) =>
        d.Lignes.Where(l => l.LigParentId == parent).OrderBy(l => l.LigOrdre).ThenBy(l => l.LigId).ToList();

    /// <summary>Place la ligne parmi ses nouveaux frères (après <paramref name="apres"/>, sinon avant le pied) ; ordres renumérotés.</summary>
    private static void Placer(DocumentCompletBtp d, DocumentLigneBtp ligne, long? parent, long? apres)
    {
        var ancien = ligne.LigParentId;
        ligne.LigParentId = parent;
        var freres = Freres(d, parent).Where(l => l.LigId != ligne.LigId).ToList();
        var rang = apres is long a ? freres.FindIndex(l => l.LigId == a) + 1 : freres.FindIndex(TL.EstPied) is var p and >= 0 ? p : freres.Count;
        freres.Insert(rang, ligne);
        for (var k = 0; k < freres.Count; k++) freres[k].LigOrdre = k + 1;
        if (ancien != parent)
        {
            var restes = Freres(d, ancien);
            for (var k = 0; k < restes.Count; k++) restes[k].LigOrdre = k + 1;
        }
    }

    /// <summary>Contexte d'une ligne posée hors ouvrage (appliquerContexte du client) : type de prix et impression de la tranche, taux de TVA.</summary>
    private static void Contextualiser(DocumentCompletBtp d, DocumentLigneBtp l, IReadOnlyList<TauxTva> taux)
    {
        var index = Index(d);
        if (l.LigParentId is long p && index.TryGetValue(p, out var parent))
        {
            if (parent.LigTypePrix != "V")
                foreach (var x in SousArbre(d, l.LigId)) index[x].LigTypePrix = parent.LigTypePrix;
            if (parent.LigIsNonEditee)
                foreach (var x in SousArbre(d, l.LigId)) index[x].LigIsNonEditee = true;
        }
        if (TL.EstChiffree(l))
        {
            l.LigTvaId ??= TauxParDefaut(d, l.LigParentId, taux);
            l.LigTauxTva = null;
            foreach (var x in SousArbre(d, l.LigId).Where(x => x != l.LigId).Select(x => index[x]).Where(TL.EstChiffree))
            {
                x.LigTvaId = null;
                x.LigTauxTva = null;
            }
        }
        else if (TL.EstTranche(l))
        {
            // Tranche insérée (ensemble) : ses lignes de prix hors ouvrage sans taux prennent le taux par défaut.
            foreach (var x in SousArbre(d, l.LigId).Where(x => x != l.LigId).Select(x => index[x]))
            {
                if (!TL.EstChiffree(x) || x.LigTvaId is not null || Ancetres(index, x.LigParentId).Any(a => a.LigTylId == TL.Ouvrage)) continue;
                x.LigTvaId = TauxParDefaut(d, x.LigParentId, taux);
            }
        }
    }

    private static void SupprimerLigne(DocumentCompletBtp d, long id)
    {
        var ids = SousArbre(d, id);
        var parent = d.Lignes.First(l => l.LigId == id).LigParentId;
        d.Lignes.RemoveAll(l => ids.Contains(l.LigId));
        foreach (var l in d.Lignes)
        {
            if (l.LigVarianteDeId is long v && ids.Contains(v)) l.LigVarianteDeId = null;
            if (l.LigStDepuisId is long s && ids.Contains(s)) l.LigStDepuisId = null;
            if (l.LigPiedBaseId is long b && ids.Contains(b)) l.LigPiedBaseId = null;
        }
        // Compléments qui suivent les lignes : métrés, variables, clés de ventilation des frais annexes.
        var metres = d.Metres.Where(m => ids.Contains(m.MtrLigId)).Select(m => m.MtrId).ToHashSet();
        d.Metres.RemoveAll(m => metres.Contains(m.MtrId));
        d.Variables.RemoveAll(v => v.VarLigId is long l && ids.Contains(l) || v.VarMtrId is long m && metres.Contains(m));
        d.Ventilations.RemoveAll(v => v.VfrSourceLigId is long s && ids.Contains(s) || v.VfrLigId is long l && ids.Contains(l));
        d.VentilationsLignes.RemoveAll(v => ids.Contains(v.VflSourceLigId) || ids.Contains(v.VflLigId));
        var restes = Freres(d, parent);
        for (var k = 0; k < restes.Count; k++) restes[k].LigOrdre = k + 1;
    }

    private static void DeplacerLigne(DocumentCompletBtp d, JsonObject o, Contexte c, int i)
    {
        var l = Ligne(d, o, i);
        var index = Index(d);
        if (TL.EstPied(l) || l.LigTylId == TL.Section) throw Refus(ErreursMcpBtp.Ligne, $"La ligne {l.LigId} ne se déplace pas (pied ou section)", i, l.LigId);
        if (l.LigParentId is long p && !TL.EstTranche(index[p])) throw Refus(ErreursMcpBtp.Ligne, $"La ligne {l.LigId} est une composante d'ouvrage", i, l.LigId);
        if (Entier(o["apres_id"]) is null && Entier(o["parent_id"]) is null) throw Refus(ErreursMcpBtp.Operation, "Destination attendue (apres_id ou parent_id)", i);
        var (parent, apres) = Position(d, o, i);
        var sousArbre = SousArbre(d, l.LigId);
        if (parent is long x && sousArbre.Contains(x) || apres is long a && sousArbre.Contains(a))
            throw Refus(ErreursMcpBtp.Ligne, $"La ligne {l.LigId} ne se déplace pas dans son propre contenu", i, l.LigId);
        Placer(d, l, parent, apres);
        Contextualiser(d, l, c.Taux);
    }

    // ------------------------------------------------------------------ bibliothèque

    private static void AjouterElement(DocumentCompletBtp d, JsonObject o, Contexte c, int i, ref long prochain)
    {
        var id = Entier(o["element_id"]) ?? throw Refus(ErreursMcpBtp.Operation, "Élément de bibliothèque attendu (element_id)", i);
        if (!c.Elements.TryGetValue(id, out var e)) throw Refus(ErreursMcpBtp.Element, $"Élément {id} introuvable", i);
        if (TypesRefuses.Contains(e.Type) || !e.Actif) throw Refus(ErreursMcpBtp.Element, $"Élément {e.Code} : type {e.Type} non inséré par un agent, ou élément inactif", i);
        var quantite = Nombre(o["quantite"]) ?? 1m;
        var (parent, apres) = Position(d, o, i);
        var bibDocument = d.Document.EntBibId is null || d.Document.EntBibId == e.BibId ? e.BibCode : null;
        DocumentLigneBtp racine;
        if (e.Type is TypeOuvrage or TypeEnsemble)
        {
            racine = Composition(d, e, e.Type == TypeOuvrage ? TL.Ouvrage : TL.Titre, i, ref prochain);
            racine.LigCode = CalculElement.CodeAppel(e.BibCode, e.Code, bibDocument);
            racine.LigArtId = e.Id;
            racine.LigNatId = e.NatId;
            racine.LigProprietes = Proprietes(racine.LigProprietes, Lien(e, e.Type == TypeOuvrage ? e.UniteStock : null, null));
            if (e.Type == TypeOuvrage)
            {
                Techniques(racine, e);
                racine.LigLibelleHtml = e.LibelleHtml;
                racine.LigUntCode = e.UniteStock;
                racine.LigQte = quantite;
                racine.LigCoefFg = ArrondiCalcul.Arr6(e.CoefFg);
                racine.LigCoefBenef = ArrondiCalcul.Arr6(e.CoefBenef);
                racine.LigCoefRemise = ArrondiCalcul.Arr6(e.CoefRemise);
                // PV fixe de l'ouvrage de la bibliothèque : imposé à la ligne (sinon, prix de la composition).
                racine.LigPvFixe = e.PvFixe;
                if (e.PvFixe) racine.LigPv = e.Pv is decimal pv ? ArrondiCalcul.Arr6(pv) : null;
            }
            else if (string.IsNullOrEmpty(racine.LigLibelleHtml)) racine.LigLibelleHtml = e.LibelleHtml;
        }
        else
        {
            var (unite, ratio) = UniteLigne(e);
            racine = new DocumentLigneBtp
            {
                LigId = prochain--, LigEntId = d.Document.EntId, LigTylId = TL.Element, LigQte = quantite, LigUntCode = unite,
                LigPa = e.Pa is decimal pa ? ArrondiCalcul.Arr6(pa * ratio) : null,
                LigCoefFg = ArrondiCalcul.Arr6(e.CoefFg), LigCoefBenef = ArrondiCalcul.Arr6(e.CoefBenef), LigCoefRemise = ArrondiCalcul.Arr6(e.CoefRemise),
                LigPvFixe = e.PvFixe, LigPv = e.PvFixe && e.Pv is decimal pv ? ArrondiCalcul.Arr6(pv * ratio) : null,
                LigCode = CalculElement.CodeAppel(e.BibCode, e.Code, bibDocument), LigArtId = e.Id, LigNatId = e.NatId, LigLibelleHtml = e.LibelleHtml,
                LigProprietes = Proprietes(null, Lien(e, unite, ratio)),
            };
            Techniques(racine, e);
            d.Lignes.Add(racine);
        }
        Placer(d, racine, parent, apres);
        Contextualiser(d, racine, c.Taux);
    }

    /// <summary>
    /// Composition d'un ouvrage (racine OUVRAGE) ou d'un ensemble (racine TITRE) ajoutée au document avec de nouveaux ID
    /// temporaires (négatifs) : lignes, métrés et variables ; références internes renumérotées, externes retirées.
    /// </summary>
    private static DocumentLigneBtp Composition(DocumentCompletBtp d, ElementDetailDto e, short typeRacine, int i, ref long prochain)
    {
        var c = e.Composition is { ValueKind: JsonValueKind.Object } x ? x : default;
        List<T> Liste<T>(string cle) => c.ValueKind == JsonValueKind.Object && c.TryGetProperty(cle, out var v) && v.ValueKind == JsonValueKind.Array
            ? v.Deserialize<List<T>>(Json) ?? [] : [];
        var lignes = Liste<DocumentLigneBtp>("lignes");
        var metres = Liste<Metre>("metres");
        var variables = Liste<VariableDefinition>("variables");
        var source = lignes.FirstOrDefault(l => l.LigParentId is null && l.LigTylId == typeRacine)
            ?? throw Refus(ErreursMcpBtp.Element, $"Élément {e.Code} sans composition", i);
        var lig = new Dictionary<long, long>();
        foreach (var l in lignes) lig[l.LigId] = prochain--;
        var mtr = new Dictionary<long, long>();
        foreach (var m in metres) mtr[m.MtrId] = prochain--;
        static long? Map(Dictionary<long, long> t, long? id) => id is long v && t.TryGetValue(v, out var r) ? r : null;
        var racine = lig[source.LigId];
        foreach (var l in lignes)
        {
            l.LigId = lig[l.LigId];
            l.LigEntId = d.Document.EntId;
            l.LigParentId = Map(lig, l.LigParentId);
            l.LigStDepuisId = Map(lig, l.LigStDepuisId);
            l.LigVarianteDeId = Map(lig, l.LigVarianteDeId);
            l.LigPiedBaseId = Map(lig, l.LigPiedBaseId);
            l.LigOrigineId = null;
            l.LigMtrId = Map(mtr, l.LigMtrId);
            if (!l.LigNumManuelle) l.LigNumerotation = null;
        }
        foreach (var m in metres)
        {
            m.MtrId = mtr[m.MtrId];
            m.MtrLigId = lig.TryGetValue(m.MtrLigId, out var ml) ? ml : racine;
        }
        foreach (var v in variables)
        {
            v.VarId = prochain--;
            v.VarEntId = d.Document.EntId;
            v.VarLigId = Map(lig, v.VarLigId);
            v.VarMtrId = Map(mtr, v.VarMtrId);
        }
        d.Lignes.AddRange(lignes);
        d.Metres.AddRange(metres);
        d.Variables.AddRange(variables);
        return lignes.First(l => l.LigId == racine);
    }

    /// <summary>Unité de la ligne d'un article (unité de vente, sinon de stock) et quantité en unité de stock pour 1 unité.</summary>
    public static (string Unite, decimal Ratio) UniteLigne(ElementDetailDto e)
    {
        var unite = string.IsNullOrEmpty(e.UniteVente) ? e.UniteStock : e.UniteVente;
        try
        {
            return (unite, CalculElement.Ratio(unite, Entree(e)));
        }
        catch (ErreurCalcul)
        {
            return (e.UniteStock, 1m);
        }
    }

    private static EntreeElement Entree(ElementDetailDto e) => new()
    {
        UniteStock = e.UniteStock,
        Unites = e.Unites.ValueKind == JsonValueKind.Array ? e.Unites.Deserialize<List<UniteElement>>(Json) ?? [] : [],
        Donnees = e.Donnees ?? [],
    };

    /// <summary>Données techniques de l'élément recopiées sur la ligne : dimensions converties de mm en mètres.</summary>
    private static void Techniques(DocumentLigneBtp l, ElementDetailDto e)
    {
        decimal? Lire(string cle) => e.Donnees is not null && e.Donnees.TryGetValue(cle, out var v) ? v : null;
        decimal? Metres(string cle) => Lire(cle) is decimal v ? ArrondiCalcul.Arr6(v / 1000) : null;
        l.LigPoids = Lire("poids") is decimal p ? ArrondiCalcul.Arr6(p) : null;
        l.LigSurface = Lire("surface") is decimal s ? ArrondiCalcul.Arr6(s) : null;
        l.LigVolume = Lire("volume") is decimal v ? ArrondiCalcul.Arr6(v) : null;
        l.LigHauteur = Metres("hauteur");
        l.LigLargeur = Metres("largeur");
        l.LigEpaisseur = Metres("epaisseur");
        l.LigLongueur = Metres("longueur");
    }

    /// <summary>Lien d'une ligne vers l'élément de la bibliothèque (lig_proprietes.element).</summary>
    private static JsonObject Lien(ElementDetailDto e, string? unite, decimal? ratio)
    {
        var o = new JsonObject { ["id"] = e.Id, ["bib"] = e.BibCode, ["code"] = e.Code, ["type"] = e.Type };
        if (unite is not null) o["unite"] = unite;
        if (ratio is decimal r) o["ratio"] = r.ToString(CultureInfo.InvariantCulture);
        return o;
    }

    private static JsonDocument Proprietes(JsonDocument? existantes, JsonObject element)
    {
        var o = existantes is not null && JsonNode.Parse(existantes.RootElement.GetRawText()) is JsonObject x ? x : new JsonObject();
        o["element"] = element;
        return JsonDocument.Parse(o.ToJsonString());
    }

    // ------------------------------------------------------------------ arguments

    public static string? Texte(JsonNode? n) => n is JsonValue v ? (v.TryGetValue<string>(out var s) ? s : v.ToJsonString()) : null;

    public static long? Entier(JsonNode? n) => n is JsonValue v
        ? v.TryGetValue<long>(out var l) ? l
        : v.TryGetValue<decimal>(out var m) && m == decimal.Truncate(m) ? (long)m
        : v.TryGetValue<string>(out var s) && long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var p) ? p : null
        : null;

    public static decimal? Nombre(JsonNode? n) => n is JsonValue v
        ? v.TryGetValue<decimal>(out var m) ? m
        : v.TryGetValue<string>(out var s) && decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var p) ? p : null
        : null;
}
