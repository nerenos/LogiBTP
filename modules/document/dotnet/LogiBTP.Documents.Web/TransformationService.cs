using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Documents.Web;

/// <summary>
/// Transformations partielles (section 15), classe mère générique : tout couple déclaré dans
/// transformation_autorisee est possible, y compris en sautant des étapes. Les liens sont enregistrés entre
/// documents et entre lignes de prix, avec les quantités transformées ; les composantes suivent au prorata.
/// </summary>
public class TransformationService<TDoc, TLigne, TComplet>(
    DocumentDbContext<TDoc, TLigne> db,
    DocumentService<TDoc, TLigne, TComplet> documents,
    RegistreHandlers<TDoc, TLigne> handlers,
    SpecialisationDocument<TDoc, TLigne, TComplet> specialisation)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
    where TComplet : DocumentComplet<TDoc, TLigne>, new()
{
    /// <summary>Étapes facultatives : elles n'ouvrent pas de reliquat bloquant l'archivage.</summary>
    public static readonly HashSet<string> EtapesFacultatives = ["RETOUR", "AVOIR"];

    private static bool EstNegative(string etape) => etape is "RETOUR" or "AVOIR";

    /// <summary>
    /// Transformation d'un document validé. Une transformation directe déclarée avec un type intermédiaire (devis →
    /// facture : commande) crée d'abord ce document, le valide automatiquement et le marque (ent_intermediaire), puis
    /// le transforme en cible ; les options et variantes sont choisies à la première étape.
    /// </summary>
    public async Task<TComplet> Transformer(long sourceId, DemandeTransformation dem, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var typeSourceId = await db.Documents.Where(d => d.EntId == sourceId).Select(d => (int?)d.EntTydId).FirstOrDefaultAsync(ct)
            ?? throw ExceptionMetier.Introuvable($"Document {sourceId}");
        var intermediaire = await db.TransformationsAutorisees.AsNoTracking()
            .Where(t => t.TraSourceTydId == typeSourceId && t.TraCibleTydId == dem.CibleTydId).Select(t => t.TraIntermediaireTydId).FirstOrDefaultAsync(ct);
        long cibleId;
        if (intermediaire is int inter)
        {
            var milieu = await TransformerDans(sourceId, new DemandeTransformation { CibleTydId = inter, Choix = dem.Choix }, u, ct, intermediaire: true);
            await documents.ValiderDans(milieu, u, ct);
            cibleId = await TransformerDans(milieu, new DemandeTransformation { CibleTydId = dem.CibleTydId }, u, ct);
        }
        else
        {
            cibleId = await TransformerDans(sourceId, dem, u, ct);
        }
        await tx.CommitAsync(ct);
        return await documents.Charger(cibleId, ct);
    }

    /// <summary>Source préparée pour une transformation : quantités retenues, lignes gardées, options, étapes.</summary>
    private sealed record Preparation(TComplet Source, TypeDocument TypeSource, TransformationAutorisee Regle, List<string> Etapes,
        Dictionary<long, decimal> Retenues, Dictionary<long, decimal?> Avancements, HashSet<long> Garder, HashSet<long> EnVendu,
        List<UniteOption> Unites, Dictionary<long, bool> Choix, TypeDocument TypeCible,
        Dictionary<long, DocumentService<TDoc, TLigne, TComplet>.Precedent>? Precedents,
        Dictionary<long, DocumentService<TDoc, TLigne, TComplet>.SaisieAvancement>? Situations = null);

    /// <summary>Une transformation, dans la transaction de l'appelant ; renvoie l'identifiant du document créé.</summary>
    private async Task<long> TransformerDans(long sourceId, DemandeTransformation dem, Utilisateur u, CancellationToken ct, bool intermediaire = false)
    {
        var typeCible = await documents.Type(dem.CibleTydId, ct);
        var p = await Preparer(sourceId, typeCible, dem, u, depuisPlusieurs: false, ct)
            ?? throw ExceptionMetier.Invalide("RIEN_A_TRANSFORMER", "Aucune quantité à transformer");
        var numero = typeCible.TydNumerotationContinue ? null : await documents.AttribuerNumero(typeCible, DateOnly.FromDateTime(DateTime.Today), ct);
        var cible = await documents.Dupliquer(p.Source, d => PreparerEntete(d, typeCible, numero, intermediaire), u, ct,
            contenu => PreparerAvancement(Filtrer(contenu, p.Garder, p.Retenues, p.EnVendu), p));
        await EcrireLiens(p, cible.Document.Document.EntId, cible.Document.Lignes, ct);
        return cible.Document.Document.EntId;
    }

    private static void PreparerEntete(TDoc d, TypeDocument typeCible, string? numero, bool intermediaire)
    {
        d.EntTydId = typeCible.TydId;
        d.EntIndice = "A";
        d.EntIsReference = true;
        d.EntGroupeId = null;
        d.EntNumero = numero;
        d.EntDate = DateOnly.FromDateTime(DateTime.Today);
        d.EntIntermediaire = intermediaire;
        // Avancement : situations (travaux, production) et reprise en cumul, facture d'avancement en période.
        d.EntAvtPresentation = typeCible.TydAvancement switch
        {
            TypesAvancement.Facture => "P",
            TypesAvancement.Situation or TypesAvancement.Production or TypesAvancement.Reprise => "C",
            _ => null,
        };
        // Textes d'introduction et de conclusion : ceux de la source, sinon les modèles du type cible.
        if (string.IsNullOrWhiteSpace(d.EntTexteIntroHtml)) d.EntTexteIntroHtml = typeCible.TydTexteIntroHtml;
        if (string.IsNullOrWhiteSpace(d.EntTexteFinHtml)) d.EntTexteFinHtml = typeCible.TydTexteFinHtml;
    }

    /// <summary>
    /// Document d'avancement : chaque ligne de prix suit sa ligne du marché (montant et quantité de la commande, ou repris
    /// d'une situation avec son avancement saisi) ; précédent du dernier document d'avancement ; sans saisie, l'avancement
    /// part du précédent (période nulle) : montant cumulé, ou % pour une ligne sans prix.
    /// </summary>
    private static TComplet PreparerAvancement(TComplet c, Preparation p)
    {
        if (p.TypeCible.TydAvancement is null) return c;
        // Commentaire de la ligne du parent : gardé à part (lig_proprietes.commentaire_parent, affiché en lecture seule),
        // le commentaire de la ligne restant celui du document.
        foreach (var l in c.Lignes.Where(l => l.LigOrigineId is not null && !string.IsNullOrEmpty(l.LigCommentaire)))
        {
            var props = l.LigProprietes is { } pr && pr.RootElement.ValueKind == JsonValueKind.Object
                ? JsonNode.Parse(pr.RootElement.GetRawText())!.AsObject() : new JsonObject();
            if (props["commentaire_parent"] is not null) continue;
            props["commentaire_parent"] = l.LigCommentaire;
            l.LigProprietes = JsonSerializer.SerializeToDocument(props);
            l.LigCommentaire = null;
        }
        var sources = p.Source.Lignes.ToDictionary(l => l.LigId);
        foreach (var l in c.Lignes.Where(l => l.LigOrigineId is long o && p.Retenues.ContainsKey(o)))
        {
            var src = sources[l.LigOrigineId!.Value];
            var cle = src.LigAvtSourceLigId ?? src.LigId;
            var precedent = p.Precedents?.GetValueOrDefault(cle);
            if (src.LigAvtMode is not null)
            {
                l.LigAvtMode = src.LigAvtMode;
                l.LigAvtValeur = src.LigAvtValeur;
                l.LigAvtMontantMarche = src.LigAvtMontantMarche;
                l.LigAvtQteMarche = src.LigAvtQteMarche;
            }
            else
            {
                // Saisie initiale = précédent (période nulle) : en montant (la référence), en % pour une ligne sans prix ;
                // nouvelle situation : la saisie de la dernière situation validée (mode et valeur cumulée).
                var sansPrix = (src.LigMontantHt ?? 0) == 0;
                l.LigAvtMode = sansPrix ? "P" : "M";
                l.LigAvtValeur = sansPrix ? precedent?.Pct ?? 0 : precedent?.Montant ?? 0;
                if (p.Situations?.GetValueOrDefault(cle) is { } sit)
                {
                    l.LigAvtMode = sit.Mode;
                    l.LigAvtValeur = sit.Valeur;
                }
                l.LigAvtMontantMarche = src.LigMontantHt;
                l.LigAvtQteMarche = src.LigQteVendue;
            }
            l.LigAvtSourceLigId = cle;
            DocumentService<TDoc, TLigne, TComplet>.EcrirePrecedent(l, precedent);
        }
        // Postes du pied en montant (remise forfaitaire, port…) : au prorata de l'avancement global, modifiables (Q28, 13.10).
        foreach (var l in c.Lignes.Where(l => l.LigOrigineId is long o && sources.TryGetValue(o, out var s) && EstPosteEnMontant(s)))
        {
            var src = sources[l.LigOrigineId!.Value];
            var cle = src.LigAvtSourceLigId ?? src.LigId;
            l.LigAvtMode = src.LigAvtMode ?? "A";
            l.LigAvtValeur = src.LigAvtValeur;
            if (src.LigAvtMode is null && p.Situations?.GetValueOrDefault(cle) is { } sit)
            {
                l.LigAvtMode = sit.Mode;
                l.LigAvtValeur = sit.Valeur;
            }
            l.LigAvtMontantMarche = src.LigAvtMontantMarche ?? src.LigMontantHt;
            l.LigAvtSourceLigId = cle;
            DocumentService<TDoc, TLigne, TComplet>.EcrirePrecedent(l, p.Precedents?.GetValueOrDefault(cle));
        }
        return c;
    }

    /// <summary>Poste de pied HT ou TTC en montant (pas une ventilation de TVA ni un pourcentage).</summary>
    private static bool EstPosteEnMontant(TLigne l) => l.LigTylId is TL.PiedHt or TL.PiedTtc && (l.LigPiedMode ?? "M") == "M";

    /// <summary>
    /// Préparation d'une source : contrôles, options et variantes, quantités retenues (tout le reliquat, ou les lignes
    /// demandées), lignes gardées. Renvoie null si rien n'est à transformer et que l'appelant l'accepte (plusieurs sources).
    /// </summary>
    private async Task<Preparation?> Preparer(long sourceId, TypeDocument typeCible, DemandeTransformation dem, Utilisateur u, bool depuisPlusieurs,
        CancellationToken ct, bool accepterVide = false)
    {
        var source = await documents.Charger(sourceId, ct);
        var typeSource = await documents.Type(source.Document.EntTydId, ct);
        await documents.VerifierDroit(u, typeSource.TydId, ActionsDroits.Transformer, ct);
        await documents.VerifierDroit(u, typeCible.TydId, ActionsDroits.Creer, ct);
        var regle = await db.TransformationsAutorisees.AsNoTracking()
            .FirstOrDefaultAsync(t => t.TraSourceTydId == typeSource.TydId && t.TraCibleTydId == typeCible.TydId, ct)
            ?? throw ExceptionMetier.Invalide("TRANSFORMATION_INTERDITE", $"Transformation {typeSource.TydCode} → {typeCible.TydCode} non autorisée");
        if (!source.Document.EntVerrouille)
        {
            throw ExceptionMetier.Invalide("SOURCE_NON_VALIDEE", "Seul un document validé peut être transformé");
        }
        specialisation.ControlerTransformation(source, typeSource, typeCible, depuisPlusieurs);

        var suivi = await Suivi(source, ct);
        var parId = source.Lignes.ToDictionary(l => l.LigId);
        var handler = handlers.Pour(typeCible);
        var etapes = new[] { regle.TraEtape }.Concat(regle.TraVautEtapes ?? []).Distinct().ToList();

        // Options et variantes (Q11, Q12) : chaque unité doit être retenue (passe en prix vendu) ou non (non reprise) ;
        // la ligne de base d'une variante peut aussi être écartée. Choix tracés sur le lien des documents.
        var unites = Options.Unites(source.Lignes);
        var choix = dem.Choix.GroupBy(c => c.LigId).ToDictionary(g => g.Key, g => g.Last().Retenue);
        var manquants = unites.Where(x => !choix.ContainsKey(x.LigId)).Select(x => x.LigId).ToList();
        if (manquants.Count > 0)
        {
            throw ExceptionMetier.Invalide("OPTION_NON_TRAITEE", "Chaque option et chaque variante doit être retenue ou non avant la transformation", manquants);
        }
        var unitesRetenues = unites.Where(x => choix[x.LigId]).Select(x => x.LigId).ToHashSet();
        var basesExclues = unites.Where(x => x.BaseId is long b && choix.TryGetValue(b, out var r) && !r).Select(x => x.BaseId!.Value).ToHashSet();
        bool DansUnite(TLigne l, HashSet<long> racines) => racines.Contains(l.LigId) || racines.Any(r => EstDescendant(l, r, parId));
        var enVendu = source.Lignes.Where(l => DansUnite(l, unitesRetenues)).Select(l => l.LigId).ToHashSet();
        var exclues = source.Lignes.Where(l => DansUnite(l, basesExclues)).Select(l => l.LigId).ToHashSet();
        // Lignes de prix des options retenues : reliquat = quantité − déjà transformé à l'étape.
        var prixOptions = enVendu.Select(id => parId[id])
            .Where(l => l.LigTylId is TL.Ouvrage or TL.Element && !specialisation.EstLigneCalculee(l)
                && !(l.LigParentId is long p && parId[p].LigTylId == TL.Ouvrage))
            .Select(l => l.LigId).ToList();
        var dejaOptions = (await db.LignesLien.AsNoTracking().Where(x => prixOptions.Contains(x.LilSourceLigId) && x.LilEtape == regle.TraEtape).ToListAsync(ct))
            .GroupBy(x => x.LilSourceLigId).ToDictionary(g => g.Key, g => g.Sum(x => x.LilQte));
        var eligibles = suivi.Where(s => !exclues.Contains(s.LigId)).Select(s => s.LigId).Concat(prixOptions).ToHashSet();

        var demandes = dem.Lignes.Count > 0
            ? dem.Lignes
            : eligibles.Select(id => new LigneATransformer { LigId = id }).ToList();

        // Tout le reliquat : toutes les lignes de prix sont reprises, celles qui n'ont plus de reste à 0 (structure du
        // parent conservée, lien créé pour suivre une quantité saisie ensuite) ; lignes choisies : seulement celles-ci.
        // Une cible qui couvre plusieurs étapes (facture qui vaut réception) ne reprend que le reste de toutes : une
        // facture directe d'une commande ne refacture pas ce qu'un BL a livré.
        var toutes = dem.Lignes.Count == 0;
        var retenues = new Dictionary<long, decimal>();
        var avancements = new Dictionary<long, decimal?>();
        foreach (var d in demandes)
        {
            if (!parId.TryGetValue(d.LigId, out var src) || !eligibles.Contains(d.LigId))
            {
                throw ExceptionMetier.Invalide("LIGNE_INVALIDE", $"La ligne {d.LigId} n'est pas une ligne de prix du document");
            }
            var suiviLigne = suivi.FirstOrDefault(s => s.LigId == d.LigId);
            var etape = suiviLigne?.Etapes.FirstOrDefault(e => e.Etape == regle.TraEtape);
            var deja = etape?.Transforme ?? dejaOptions.GetValueOrDefault(d.LigId);
            var reliquat = EstNegative(regle.TraEtape)
                ? etape?.Reliquat
                : suiviLigne?.Etapes.Where(e => etapes.Contains(e.Etape)).Select(e => (decimal?)e.Reliquat).Min();
            var qte = handler.QuantiteCible(new LigneTransformee(src, d.Qte ?? reliquat ?? (src.LigQteVendue ?? 0) - deja, d.AvancementPct), deja);
            if (toutes && !EstNegative(regle.TraEtape) && qte < 0) qte = 0;
            if (qte == 0 && !toutes) continue;
            retenues[src.LigId] = qte;
            avancements[src.LigId] = d.AvancementPct;
        }
        // Avancement : toutes les lignes du marché sont reprises, même entièrement facturées (retour en arrière possible).
        if (retenues.Values.All(q => q == 0) && typeCible.TydAvancement is null)
        {
            if (accepterVide) return null;
            throw ExceptionMetier.Invalide("RIEN_A_TRANSFORMER", "Aucune quantité à transformer");
        }

        // Lignes conservées : lignes de prix retenues avec leur sous-arbre, leurs titres ancêtres, les lignes de pied.
        var garder = new HashSet<long>();
        foreach (var id in retenues.Keys)
        {
            for (var x = parId[id]; ; x = parId[x.LigParentId!.Value])
            {
                garder.Add(x.LigId);
                if (x.LigParentId is null) break;
            }
            foreach (var l in source.Lignes.Where(l => EstDescendant(l, id, parId))) garder.Add(l.LigId);
        }
        foreach (var l in source.Lignes.Where(l => l.LigTylId is TL.PiedHt or TL.PiedTtc or TL.Tva))
        {
            for (var x = l; ; x = parId[x.LigParentId!.Value])
            {
                garder.Add(x.LigId);
                if (x.LigParentId is null) break;
            }
        }
        // Frais annexes (type F) et lignes pour mémoire (M) : conservées avec leurs tranches ancêtres, hors total.
        foreach (var l in source.Lignes.Where(l => l.LigTypePrix is "F" or "M" && !exclues.Contains(l.LigId)))
        {
            for (var x = l; ; x = parId[x.LigParentId!.Value])
            {
                garder.Add(x.LigId);
                if (x.LigParentId is null) break;
            }
        }
        // Sous-totaux de pied (racine ou section) et bases des lignes de pied (sous-total désigné par LigPiedBaseId).
        foreach (var l in source.Lignes.Where(l => l.LigTylId == TL.SousTotal
            && (l.LigParentId is null || (parId[l.LigParentId.Value].LigTylId == TL.Section && parId[l.LigParentId.Value].LigParentId is null))))
        {
            garder.Add(l.LigId);
        }
        foreach (var l in source.Lignes.Where(l => garder.Contains(l.LigId) && l.LigPiedBaseId is long)) garder.Add(l.LigPiedBaseId!.Value);

        // Avancement : précédents des lignes du marché (lignes de la commande, ou suivies par la situation source).
        var cles = retenues.Keys.Concat(source.Lignes.Where(EstPosteEnMontant).Select(l => l.LigId))
            .Select(id => parId[id].LigAvtSourceLigId ?? id).Distinct().ToList();
        var precedents = typeCible.TydAvancement is null ? null : await documents.Precedents(cles, null, ct);
        // Nouvelle situation (travaux ou production) : la saisie part de la dernière situation validée du même type.
        var situations = TypesAvancement.EstSituation(typeCible.TydAvancement) ? await documents.DernieresSituations(cles, ct, typeCible.TydAvancement!) : null;
        return new Preparation(source, typeSource, regle, etapes, retenues, avancements, garder, enVendu, unites, choix, typeCible, precedents, situations);
    }

    /// <summary>
    /// Liens de la cible vers sa source : document (choix des options), lignes (étape de la règle et étapes sautées),
    /// retours et avoirs (quantité négative en amont, soldes retirés), remontée à l'origine ; source acceptée.
    /// </summary>
    private async Task EcrireLiens(Preparation p, long cibleId, IEnumerable<TLigne> lignesCible, CancellationToken ct)
    {
        var sourceId = p.Source.Document.EntId;
        db.DocumentsLien.Add(new DocumentLien
        {
            LieSourceEntId = sourceId, LieCibleEntId = cibleId,
            LieChoix = p.Unites.Count == 0 ? null : JsonSerializer.SerializeToDocument(
                p.Choix.Select(kv => new { lig_id = kv.Key, retenue = kv.Value }).OrderBy(c => c.lig_id).ToList()),
        });
        foreach (var lc in lignesCible.Where(l => l.LigOrigineId is long o && p.Retenues.ContainsKey(o)))
        {
            var src = lc.LigOrigineId!.Value;
            var qte = p.Retenues[src];
            foreach (var etape in p.Etapes)
            {
                db.LignesLien.Add(new DocumentLigneLien
                {
                    LilSourceLigId = src,
                    LilCibleLigId = lc.LigId,
                    LilEtape = etape,
                    LilQte = EstNegative(etape) ? -qte : qte,
                    LilMontantHt = lc.LigMontantHt,
                    LilAvancementPct = p.Avancements[src],
                });
            }
            // Retours et avoirs : quantité négative sur l'étape amont, qui rouvre le reliquat du document d'origine ; les
            // soldes demandés par la ligne annulée sont retirés.
            if (EstNegative(p.Regle.TraEtape))
            {
                var amont = await db.LignesLien.AsNoTracking().Where(x => x.LilCibleLigId == src && !EtapesFacultatives.Contains(x.LilEtape)).ToListAsync(ct);
                foreach (var a in amont)
                {
                    db.LignesLien.Add(new DocumentLigneLien { LilSourceLigId = a.LilSourceLigId, LilCibleLigId = lc.LigId, LilEtape = a.LilEtape, LilQte = -qte });
                }
                await db.LignesSolde.Where(x => x.LsoCibleLigId == src).ExecuteDeleteAsync(ct);
            }
            else
            {
                // Remontée jusqu'à l'origine : une facture issue d'un BL est aussi liée, pour son étape, aux lignes dont
                // le BL est issu (commande, demande de prix), dont le reliquat reste ainsi juste.
                var origines = await db.LignesLien.AsNoTracking()
                    .Where(x => x.LilCibleLigId == src && x.LilSourceLigId != src && !EtapesFacultatives.Contains(x.LilEtape) && x.LilQte >= 0)
                    .Select(x => x.LilSourceLigId).Distinct().ToListAsync(ct);
                foreach (var o in origines)
                {
                    foreach (var etape in p.Etapes)
                    {
                        db.LignesLien.Add(new DocumentLigneLien { LilSourceLigId = o, LilCibleLigId = lc.LigId, LilEtape = etape, LilQte = qte, LilMontantHt = lc.LigMontantHt });
                    }
                }
            }
        }
        await db.SaveChangesAsync(ct);

        // Source envoyée transformée : validée par le tiers d'office (P17), statut recalculé ensuite.
        await db.Documents.Where(d => d.EntId == sourceId && d.EntEnvoyeLe != null && d.EntValideTiersLe == null)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.EntValideTiersLe, DateTimeOffset.UtcNow), ct);
        await documents.RecalculerStatuts([sourceId], ct);
    }

    // ------------------------------------------------------------------ plusieurs sources

    /// <summary>
    /// Document créé depuis plusieurs documents (BL d'un marché depuis ses commandes, facture de plusieurs BL…,
    /// CONCEPTION-ACHATS-MARCHES.md Q10, Q20) : chaque source apporte son reliquat dans une section (la sienne, ou une
    /// section créée à son nom) avec son bloc de pied ; le pied global du document les consolide. Une source sans reste
    /// est ignorée. Avec une seule source retenue : document ordinaire (pas de section ajoutée).
    /// </summary>
    public async Task<TComplet> TransformerPlusieurs(DemandeTransformationMultiple dem, Utilisateur u, CancellationToken ct)
    {
        if (dem.Sources.Count == 0) throw ExceptionMetier.Invalide("SOURCES", "Aucun document source");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var typeCible = await documents.Type(dem.CibleTydId, ct);
        var preparations = await PreparerSources(dem.Sources, typeCible, u, ct);
        if (preparations.Count == 0) throw ExceptionMetier.Invalide("RIEN_A_TRANSFORMER", "Aucune quantité à transformer dans ces documents");
        var ids = new Compteur();
        var contenus = await ContenusRegroupes(preparations, preparations.Count > 1, ids, ct);
        var numero = typeCible.TydNumerotationContinue ? null : await documents.AttribuerNumero(typeCible, DateOnly.FromDateTime(DateTime.Today), ct);
        var cible = await documents.Dupliquer(preparations[0].Source, d =>
        {
            PreparerEntete(d, typeCible, numero, intermediaire: false);
            specialisation.PreparerEntetePlusieurs(d, preparations.Select(p => p.Source.Document).ToList());
        }, u, ct, _ => Fusionner(contenus));
        foreach (var p in preparations) await EcrireLiens(p, cible.Document.Document.EntId, cible.Document.Lignes, ct);
        await tx.CommitAsync(ct);
        return await documents.Charger(cible.Document.Document.EntId, ct);
    }

    /// <summary>
    /// Ajoute des documents sources à un document brouillon (facture de plusieurs BL, avenant chargé dans un document du
    /// marché) : le contenu existant et chaque source deviennent des sections dès qu'il y a plusieurs sources.
    /// </summary>
    public async Task<TComplet> AjouterSources(long cibleId, List<long> sources, Utilisateur u, CancellationToken ct)
    {
        if (sources.Count == 0) throw ExceptionMetier.Invalide("SOURCES", "Aucun document source");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var cible = await documents.Charger(cibleId, ct);
        var typeCible = await documents.Type(cible.Document.EntTydId, ct);
        var deja = await db.DocumentsLien.AsNoTracking().Where(l => l.LieCibleEntId == cibleId && l.LieType == "TRANSFORMATION").Select(l => l.LieSourceEntId).ToListAsync(ct);
        var doublons = sources.Where(deja.Contains).ToList();
        if (doublons.Count > 0) throw ExceptionMetier.Invalide("SOURCE_DEJA_REPRISE", "Document déjà repris dans ce document", doublons);
        var preparations = await PreparerSources(sources, typeCible, u, ct);
        if (preparations.Count == 0) throw ExceptionMetier.Invalide("RIEN_A_TRANSFORMER", "Aucune quantité à transformer dans ces documents");
        var enSections = deja.Count + preparations.Count > 1 || (cible.Lignes.Count > 0 && preparations.Count > 0);
        var ids = new Compteur();
        var existant = JsonCalcul.Cloner(cible);
        if (enSections && existant.Lignes.Count > 0)
        {
            var libelle = deja.Count > 0
                ? await LibelleDocument(deja[0], ct)
                : $"{typeCible.TydLibelle} {cible.Document.EntNumero ?? ""}".Trim();
            var code = deja.Count > 0 ? await db.Documents.AsNoTracking().Where(x => x.EntId == deja[0]).Select(x => x.EntNumero).FirstAsync(ct) : null;
            EnSection(existant, libelle, code, ref ids.N);
        }
        // Livraisons d'une commande déjà présente (section regroupée, ou section d'un BL déjà repris de la même commande) :
        // regroupées avec elle ; les autres suivent le cas général.
        var restantes = enSections ? await RegrouperDansExistant(existant, deja, preparations, ids, ct) : preparations;
        var contenus = new List<TComplet> { existant };
        contenus.AddRange(await ContenusRegroupes(restantes, enSections, ids, ct));
        var fusion = Fusionner(contenus);
        fusion.Document = cible.Document;
        await documents.EnregistrerDans(cibleId, fusion, u, ct);
        var apres = await documents.Charger(cibleId, ct);
        foreach (var p in preparations) await EcrireLiens(p, cibleId, apres.Lignes, ct);
        await tx.CommitAsync(ct);
        return await documents.Charger(cibleId, ct);
    }

    // ------------------------------------------------------------------ annulation par avoir

    /// <summary>
    /// Annule une pièce validée par un avoir qui la reprend entièrement (CONCEPTION-ACHATS-MARCHES.md, Q30) : facture →
    /// avoir de son type d'avoir ; avoir d'avancement → avoir d'avoir (extourne). L'avoir, de nature ANNULATION, est validé
    /// d'office ; la pièce et son avoir passent au statut Annulé (hors avancement), reliés par un lien ANNULATION. Dans la
    /// transaction de l'appelant ; renvoie l'identifiant de l'avoir.
    /// </summary>
    public async Task<long> AnnulerParAvoirDans(long entId, Utilisateur u, CancellationToken ct)
    {
        var source = await documents.Charger(entId, ct);
        var type = await documents.Type(source.Document.EntTydId, ct);
        var statut = await db.StatutsDocument.AsNoTracking().FirstAsync(s => s.StdId == source.Document.EntStdId, ct);
        if (!source.Document.EntVerrouille || statut.StdCode == "ANNULE")
        {
            throw ExceptionMetier.Invalide("ANNULATION_IMPOSSIBLE", "Seule une pièce validée et non annulée s'annule par un avoir");
        }
        var avoirTydId = type.TydAvoirTydId
            ?? (source.Document.EntNatureAvoir is not null ? type.TydId
                : throw ExceptionMetier.Invalide("ANNULATION_IMPOSSIBLE", $"Le type {type.TydCode} ne s'annule pas par un avoir"));
        var typeAvoir = await documents.Type(avoirTydId, ct);
        await documents.VerifierDroit(u, typeAvoir.TydId, ActionsDroits.Creer, ct);
        var avoir = await documents.Dupliquer(source, d =>
        {
            d.EntTydId = typeAvoir.TydId;
            d.EntIndice = "A";
            d.EntIsReference = true;
            d.EntGroupeId = null;
            d.EntNumero = null;
            d.EntDate = DateOnly.FromDateTime(DateTime.Today);
            d.EntNatureAvoir = NaturesAvoir.Annulation;
            d.EntEtatCompta = null;
        }, u, ct);
        var avoirId = avoir.Document.Document.EntId;
        db.DocumentsLien.Add(new DocumentLien { LieSourceEntId = entId, LieCibleEntId = avoirId, LieType = "ANNULATION" });
        await db.SaveChangesAsync(ct);
        await documents.ValiderDans(avoirId, u, ct);
        foreach (var (id, tyd) in new[] { (entId, type.TydId), (avoirId, typeAvoir.TydId) })
        {
            var annule = await db.StatutsDocument.AsNoTracking().Where(s => s.StdTydId == tyd && s.StdCode == "ANNULE").Select(s => (int?)s.StdId).FirstOrDefaultAsync(ct)
                ?? throw ExceptionMetier.Invalide("ANNULATION_IMPOSSIBLE", "Statut Annulé absent du type");
            await db.Documents.Where(d => d.EntId == id).ExecuteUpdateAsync(s => s.SetProperty(d => d.EntStdId, annule), ct);
            // Documents d'origine de la pièce annulée : facturation recalculée.
            await documents.RecalculerStatuts(await documents.Origines(id, ct), ct);
        }
        return avoirId;
    }

    /// <summary>Préparation de chaque source (sans choix d'options : les commandes et BL n'en ont plus) ; sources vides écartées.</summary>
    private async Task<List<Preparation>> PreparerSources(List<long> sources, TypeDocument typeCible, Utilisateur u, CancellationToken ct)
    {
        var res = new List<Preparation>();
        foreach (var id in sources.Distinct())
        {
            var p = await Preparer(id, typeCible, new DemandeTransformation { CibleTydId = typeCible.TydId }, u, depuisPlusieurs: true, ct, accepterVide: true);
            if (p is not null) res.Add(p);
        }
        return res;
    }

    /// <summary>Contenu repris d'une source (identifiants temporaires), dans une section à son nom s'il y a plusieurs sources.</summary>
    private TComplet ContenuSource(Preparation p, bool enSection, ref long n)
    {
        var c = documents.RenumeroterTemporaire(JsonCalcul.Cloner(p.Source), ref n);
        c = PreparerAvancement(Filtrer(c, p.Garder, p.Retenues, p.EnVendu), p);
        specialisation.PreparerContenuSource(c, p.Source.Document, p.TypeSource, p.TypeCible);
        if (enSection) EnSection(c, $"{p.TypeSource.TydLibelle} {p.Source.Document.EntNumero ?? ""}{(string.IsNullOrWhiteSpace(p.Source.Document.EntObjet) ? "" : " – " + p.Source.Document.EntObjet)}".Trim(), p.Source.Document.EntNumero, ref n);
        return c;
    }

    /// <summary>Compteur d'identifiants temporaires (négatifs) partagé par les contenus repris.</summary>
    private sealed class Compteur
    {
        public long N;
        public long Suivant() => --N;
    }

    /// <summary>Commande d'origine unique de chaque document (seule source de transformation), sinon absent.</summary>
    private async Task<Dictionary<long, long>> OriginesUniques(IEnumerable<long> documentsIds, CancellationToken ct)
    {
        var liste = documentsIds.Distinct().ToList();
        var liens = await db.DocumentsLien.AsNoTracking().Where(l => liste.Contains(l.LieCibleEntId) && l.LieType == "TRANSFORMATION")
            .Select(l => new { l.LieCibleEntId, l.LieSourceEntId }).ToListAsync(ct);
        return liens.GroupBy(l => l.LieCibleEntId).Where(g => g.Select(x => x.LieSourceEntId).Distinct().Count() == 1)
            .ToDictionary(g => g.Key, g => g.First().LieSourceEntId);
    }

    /// <summary>Libellé de la tranche d'une livraison : type, numéro et date.</summary>
    private static string LibelleLivraison(Preparation p) =>
        $"{p.TypeSource.TydLibelle} {p.Source.Document.EntNumero ?? ""} du {p.Source.Document.EntDate:dd/MM/yyyy}".Replace("  ", " ").Trim();

    /// <summary>Une livraison se regroupe si son contenu n'est pas déjà réparti en plusieurs sections (BL de plusieurs commandes).</summary>
    private static bool Regroupable(TComplet c) => c.Lignes.Count(l => l.LigParentId is null && l.LigTylId == TL.Section) <= 1;

    /// <summary>
    /// Contenus des sources : en sections, les livraisons d'une même commande d'origine (au moins deux) sont regroupées
    /// dans une section de la commande, une tranche par livraison (13.14 a) ; les autres sources gardent leur section.
    /// </summary>
    private async Task<List<TComplet>> ContenusRegroupes(List<Preparation> preparations, bool enSections, Compteur ids, CancellationToken ct)
    {
        var origines = enSections ? await OriginesUniques(preparations.Select(p => p.Source.Document.EntId), ct) : new Dictionary<long, long>();
        var bruts = preparations.Select(p => ContenuSource(p, false, ref ids.N)).ToList();
        long? Cle(int i) => origines.TryGetValue(preparations[i].Source.Document.EntId, out var o) && Regroupable(bruts[i]) ? o : null;
        var res = new List<TComplet>();
        var traites = new HashSet<int>();
        for (var i = 0; i < preparations.Count; i++)
        {
            if (!traites.Add(i)) continue;
            var cle = Cle(i);
            var groupe = cle is null ? new List<int> { i } : Enumerable.Range(i, preparations.Count - i).Where(j => Cle(j) == cle).ToList();
            if (groupe.Count < 2)
            {
                res.Add(enSections ? ContenuSource(preparations[i], true, ref ids.N) : bruts[i]);
                continue;
            }
            foreach (var j in groupe) traites.Add(j);
            var origine = cle!.Value;
            var c = JsonCalcul.Cloner(bruts[i]);
            c.Lignes = RegroupementLivraisons.Regrouper(groupe.Select(j => (bruts[j].Lignes, LibelleLivraison(preparations[j]))).ToList(), origine,
                await LibelleDocument(origine, ct), await db.Documents.AsNoTracking().Where(x => x.EntId == origine).Select(x => x.EntNumero).FirstAsync(ct), ids.Suivant);
            foreach (var j in groupe.Skip(1)) specialisation.FusionnerComplements(c, bruts[j]);
            res.Add(c);
        }
        return res;
    }

    /// <summary>
    /// Ajout de livraisons à un document en sections : une livraison dont la commande d'origine a déjà sa section
    /// regroupée y devient une tranche ; une livraison de la même commande qu'un BL déjà repris (section du BL) est
    /// regroupée avec lui dans une nouvelle section de la commande, à la place de la section du BL. Renvoie les sources
    /// qui restent à ajouter.
    /// </summary>
    private async Task<List<Preparation>> RegrouperDansExistant(TComplet existant, List<long> deja, List<Preparation> preparations, Compteur ids, CancellationToken ct)
    {
        var origines = await OriginesUniques(preparations.Select(p => p.Source.Document.EntId).Concat(deja), ct);
        var numeros = await db.Documents.AsNoTracking().Where(x => deja.Contains(x.EntId)).Select(x => new { x.EntId, x.EntNumero }).ToListAsync(ct);
        var restantes = new List<Preparation>();
        foreach (var groupe in preparations.GroupBy(p => origines.TryGetValue(p.Source.Document.EntId, out var o) ? o : (long?)null))
        {
            if (groupe.Key is not long origine) { restantes.AddRange(groupe); continue; }
            var liste = groupe.Select(p => (Preparation: p, Contenu: ContenuSource(p, false, ref ids.N))).Where(x => Regroupable(x.Contenu)).ToList();
            restantes.AddRange(groupe.Where(p => liste.All(x => x.Preparation != p)));
            if (liste.Count == 0) continue;
            var racine = existant.Lignes.Where(l => l.LigParentId is null && l.LigTylId == TL.Section).ToList();
            var regroupee = racine.FirstOrDefault(l => RegroupementLivraisons.Origine(l) == origine);
            if (regroupee is not null)
            {
                var enfants = existant.Lignes.Where(l => l.LigParentId == regroupee.LigId).ToList();
                existant.Lignes.AddRange(RegroupementLivraisons.Ajouter(regroupee, enfants, liste.Select(x => (x.Contenu.Lignes, LibelleLivraison(x.Preparation))).ToList(), ids.Suivant));
                foreach (var x in liste) specialisation.FusionnerComplements(existant, x.Contenu);
                continue;
            }
            // Section d'un BL déjà repris de la même commande (code = numéro du BL).
            var codes = deja.Where(d => origines.TryGetValue(d, out var o) && o == origine).Select(d => numeros.FirstOrDefault(x => x.EntId == d)?.EntNumero).Where(c => c is not null).ToHashSet();
            var sectionBl = racine.FirstOrDefault(l => l.LigCode is not null && codes.Contains(l.LigCode));
            if (sectionBl is null) { restantes.AddRange(liste.Select(x => x.Preparation)); continue; }
            var parId = existant.Lignes.ToDictionary(l => l.LigId);
            var sousArbre = existant.Lignes.Where(l => l == sectionBl || EstDescendant(l, sectionBl.LigId, parId)).ToList();
            var position = existant.Lignes.IndexOf(sectionBl);
            existant.Lignes.RemoveAll(sousArbre.Contains);
            var livraisons = new List<(List<TLigne>, string)> { (sousArbre, System.Net.WebUtility.HtmlDecode(sectionBl.LigLibelleHtml ?? sectionBl.LigCode ?? "")) };
            livraisons.AddRange(liste.Select(x => (x.Contenu.Lignes, LibelleLivraison(x.Preparation))));
            var lignes = RegroupementLivraisons.Regrouper(livraisons, origine, await LibelleDocument(origine, ct),
                await db.Documents.AsNoTracking().Where(x => x.EntId == origine).Select(x => x.EntNumero).FirstAsync(ct), ids.Suivant);
            existant.Lignes.InsertRange(Math.Min(position, existant.Lignes.Count), lignes);
            foreach (var x in liste) specialisation.FusionnerComplements(existant, x.Contenu);
        }
        return restantes;
    }

    /// <summary>Contenus mis bout à bout (sections dans l'ordre des sources), compléments de la spécialisation fusionnés.</summary>
    private TComplet Fusionner(List<TComplet> contenus)
    {
        var res = JsonCalcul.Cloner(contenus[0]);
        for (var i = 1; i < contenus.Count; i++)
        {
            res.Lignes.AddRange(contenus[i].Lignes);
            specialisation.FusionnerComplements(res, contenus[i]);
        }
        var rang = 0;
        foreach (var l in res.Lignes.Where(l => l.LigParentId is null).ToList()) l.LigOrdre = ++rang;
        return res;
    }

    /// <summary>
    /// Met le contenu d'une source dans une section à la racine (la sienne si elle en a une seule, sinon une section
    /// créée au libellé donné) ; ses lignes de pied et sous-totaux de pied deviennent le pied de la section. La section
    /// sans code prend le numéro du document source (colonne Code).
    /// </summary>
    private static void EnSection(TComplet c, string libelle, string? code, ref long n)
    {
        var racine = c.Lignes.Where(l => l.LigParentId is null).OrderBy(l => l.LigOrdre).ThenBy(l => l.LigId).ToList();
        var sections = racine.Where(l => l.LigTylId == TL.Section).ToList();
        if (sections.Count > 1) return;
        TLigne section;
        if (sections.Count == 1)
        {
            section = sections[0];
        }
        else
        {
            section = new TLigne { LigId = --n, LigEntId = c.Document.EntId, LigTylId = TL.Section, LigLibelleHtml = System.Net.WebUtility.HtmlEncode(libelle), LigOrdre = 0 };
            c.Lignes.Add(section);
        }
        if (string.IsNullOrWhiteSpace(section.LigCode) && !string.IsNullOrWhiteSpace(code)) section.LigCode = code;
        var ordre = c.Lignes.Where(l => l.LigParentId == section.LigId).Select(l => l.LigOrdre).DefaultIfEmpty(0).Max();
        var corps = new List<TLigne>();
        var pied = new List<TLigne>();
        var vuPied = false;
        foreach (var l in racine.Where(l => l != section))
        {
            if (TL.EstPied(l)) { vuPied = true; pied.Add(l); }
            else if (l.LigTylId == TL.SousTotal && vuPied) pied.Add(l);
            else corps.Add(l);
        }
        foreach (var l in corps.Concat(pied))
        {
            l.LigParentId = section.LigId;
            l.LigOrdre = ++ordre;
        }
    }

    /// <summary>Libellé d'un document source : type, numéro, objet.</summary>
    private async Task<string> LibelleDocument(long entId, CancellationToken ct)
    {
        var d = await db.Documents.AsNoTracking().FirstAsync(x => x.EntId == entId, ct);
        var t = await documents.Type(d.EntTydId, ct);
        return $"{t.TydLibelle} {d.EntNumero ?? ""}{(string.IsNullOrWhiteSpace(d.EntObjet) ? "" : " – " + d.EntObjet)}".Trim();
    }

    /// <summary>
    /// Documents validés qui peuvent alimenter un document du type donné (facture de plusieurs BL…) : types sources
    /// déclarés vers ce type, même tiers si demandé, avec un reste pour toutes les étapes de la transformation.
    /// </summary>
    public async Task<List<DocumentEnAttente>> EnAttente(int cibleTydId, long? tiersId, CancellationToken ct)
    {
        var regles = await db.TransformationsAutorisees.AsNoTracking().Where(t => t.TraCibleTydId == cibleTydId).ToListAsync(ct);
        var types = regles.Select(r => r.TraSourceTydId).ToList();
        var docs = await db.Documents.AsNoTracking()
            .Where(d => types.Contains(d.EntTydId) && d.EntVerrouille && (tiersId == null || d.EntTiersId == tiersId))
            .OrderByDescending(d => d.EntId).Take(200).ToListAsync(ct);
        var res = new List<DocumentEnAttente>();
        foreach (var d in docs)
        {
            var regle = regles.First(r => r.TraSourceTydId == d.EntTydId);
            if (EstNegative(regle.TraEtape)) continue;
            var etapes = new[] { regle.TraEtape }.Concat(regle.TraVautEtapes ?? []).Distinct().ToList();
            var suivi = await Suivi(await documents.Charger(d.EntId, ct), ct);
            var ouvertes = suivi.Count(l => l.Etapes.Where(e => etapes.Contains(e.Etape)).Select(e => e.Reliquat).DefaultIfEmpty(0).Min() > 0);
            if (ouvertes == 0) continue;
            var type = await documents.Type(d.EntTydId, ct);
            res.Add(new DocumentEnAttente(d.EntId, type.TydCode, type.TydLibelle, d.EntNumero, d.EntDate, d.EntObjet, d.EntTiersId, d.EntTotalHt, ouvertes));
        }
        return res;
    }

    /// <summary>
    /// Garde les lignes retenues ; la ligne de prix prend la quantité transformée, les composantes absolues suivent au
    /// prorata ; les options et variantes retenues passent en prix vendu (plus de lien de variante).
    /// </summary>
    private TComplet Filtrer(TComplet c, HashSet<long> garder, Dictionary<long, decimal> retenues, HashSet<long> enVendu)
    {
        c.Lignes = c.Lignes.Where(l => l.LigOrigineId is long o && garder.Contains(o)).ToList();
        // La case Soldé de la source (cochée à sa validation quand elle a soldé sa propre ligne parente) ne passe pas à
        // la cible : elle y solderait d'office la ligne de la source dès la première transformation partielle.
        foreach (var l in c.Lignes) l.LigSolde = false;
        foreach (var l in c.Lignes.Where(l => enVendu.Contains(l.LigOrigineId!.Value)))
        {
            l.LigTypePrix = "V";
            l.LigVarianteDeId = null;
        }
        foreach (var l in c.Lignes.Where(l => retenues.ContainsKey(l.LigOrigineId!.Value)))
        {
            var ancienne = l.LigQteVendue ?? 0;
            var nouvelle = retenues[l.LigOrigineId!.Value];
            var ratio = ancienne == 0 ? 0 : nouvelle / ancienne;
            l.LigQte = nouvelle;
            specialisation.AjusterLigneTransformee(l);
            foreach (var d in c.Lignes.Where(x => x.LigParentId == l.LigId && x.LigQteType == "A"))
            {
                d.LigQte = ArrondiCalcul.Arr6((d.LigQte ?? 0) * ratio);
            }
        }
        specialisation.FiltrerComplements(c, c.Lignes.Select(l => l.LigId).ToHashSet());
        return c;
    }

    private static bool EstDescendant(TLigne l, long ancetre, Dictionary<long, TLigne> parId)
    {
        for (var x = l; x.LigParentId is long p && parId.TryGetValue(p, out var parent); x = parent)
        {
            if (p == ancetre) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ suivi et soldes

    /// <summary>Suivi des lignes de prix : pour chaque étape, transformé, soldé et reliquat.</summary>
    public async Task<List<SuiviLigne>> Suivi(TComplet d, CancellationToken ct)
    {
        var parId = d.Lignes.ToDictionary(l => l.LigId);
        bool AncetreOuvrage(TLigne l)
        {
            for (var x = l; x.LigParentId is long p && parId.TryGetValue(p, out var parent); x = parent)
            {
                if (parent.LigTylId == TL.Ouvrage) return true;
            }
            return false;
        }
        var lignesPrix = d.Lignes.Where(l => l.LigTylId is TL.Ouvrage or TL.Element && !specialisation.EstLigneCalculee(l)
            && !AncetreOuvrage(l) && l.LigTypePrix == "V").ToList();
        var ids = lignesPrix.Select(l => l.LigId).ToList();
        var liens = await db.LignesLien.AsNoTracking().Where(x => ids.Contains(x.LilSourceLigId)).ToListAsync(ct);
        var soldes = await db.LignesSolde.AsNoTracking().Where(x => ids.Contains(x.LsoLigId)).ToListAsync(ct);
        var regles = await db.TransformationsAutorisees.AsNoTracking().Where(t => t.TraSourceTydId == d.Document.EntTydId).ToListAsync(ct);
        var etapes = regles.SelectMany(r => new[] { r.TraEtape }.Concat(r.TraVautEtapes ?? []))
            .Concat(liens.Select(x => x.LilEtape)).Distinct().Order(StringComparer.Ordinal).ToList();

        return lignesPrix.Select(l =>
        {
            var qte = l.LigQteVendue ?? 0;
            var parEtape = etapes.Select(e =>
            {
                var somme = liens.Where(x => x.LilSourceLigId == l.LigId && x.LilEtape == e).Sum(x => x.LilQte);
                var transforme = EstNegative(e) ? -somme : somme;
                var solde = soldes.Where(x => x.LsoLigId == l.LigId && x.LsoEtape == e).Sum(x => x.LsoQte);
                return new SuiviEtape(e, transforme, solde, qte - transforme - solde);
            }).ToList();
            return new SuiviLigne(l.LigId, l.LigNumerotation, l.LigLibelleBrut, qte, parEtape);
        }).ToList();
    }

    /// <summary>
    /// Restes à solder des lignes d'un document issu d'une transformation (colonnes Qté parent, Reste, Soldé) : pour
    /// chaque ligne liée à sa ligne parente (lig_origine_id), quantité du parent, quantités des autres documents à la
    /// même étape (brouillons compris, part des brouillons à part), soldes écrits par d'autres lignes. Le client en
    /// déduit le reste avec la quantité en cours de saisie (etatSolde). Retours et avoirs : quantités au signe près.
    /// </summary>
    public async Task<RestesDocument> Restes(long entId, CancellationToken ct)
    {
        var doc = await db.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.EntId == entId, ct) ?? throw ExceptionMetier.Introuvable($"Document {entId}");
        var type = await documents.Type(doc.EntTydId, ct);
        var (pct, qte) = await documents.SeuilsSolde(type.TydFamille, ct);
        var lignes = await db.Lignes.AsNoTracking().Where(l => l.LigEntId == entId && l.LigOrigineId != null)
            .Select(l => new { l.LigId, l.LigOrigineId }).ToListAsync(ct);
        var ids = lignes.Select(l => l.LigId).ToList();
        var directs = (await db.LignesLien.AsNoTracking().Where(x => ids.Contains(x.LilCibleLigId)).ToListAsync(ct))
            .Where(x => lignes.Any(l => l.LigId == x.LilCibleLigId && l.LigOrigineId == x.LilSourceLigId)).ToList();
        if (directs.Count == 0) return new RestesDocument(pct, qte, []);
        var parentsIds = directs.Select(x => x.LilSourceLigId).Distinct().ToList();
        var parents = await db.Lignes.AsNoTracking().Where(l => parentsIds.Contains(l.LigId))
            .ToDictionaryAsync(l => l.LigId, l => (Qte: l.LigQteVendue ?? 0, Montant: l.LigMontantHt ?? 0), ct);
        // Liens des parents avec l'état (brouillon ou validé) du document cible ; ceux du document en cours à part.
        var liens = await (from x in db.LignesLien.AsNoTracking()
                           join l in db.Lignes.AsNoTracking() on x.LilCibleLigId equals l.LigId
                           join d in db.Documents.AsNoTracking() on l.LigEntId equals d.EntId
                           where parentsIds.Contains(x.LilSourceLigId) && l.LigEntId != entId
                           select new { x.LilSourceLigId, x.LilEtape, x.LilQte, x.LilMontantHt, d.EntVerrouille }).ToListAsync(ct);
        var soldes = await db.LignesSolde.AsNoTracking()
            .Where(x => parentsIds.Contains(x.LsoLigId) && (x.LsoCibleLigId == null || !ids.Contains(x.LsoCibleLigId.Value))).ToListAsync(ct);
        var res = new List<ResteLigne>();
        foreach (var l in lignes)
        {
            // Étape principale : la première écrite à la transformation (une facture qui vaut réception en a deux).
            var lien = directs.Where(x => x.LilCibleLigId == l.LigId).OrderBy(x => x.LilId).FirstOrDefault();
            if (lien is null || !parents.TryGetValue(lien.LilSourceLigId, out var parent)) continue;
            var signe = EstNegative(lien.LilEtape) ? -1 : 1;
            var autres = liens.Where(x => x.LilSourceLigId == lien.LilSourceLigId && x.LilEtape == lien.LilEtape).ToList();
            res.Add(new ResteLigne(l.LigId, lien.LilSourceLigId, lien.LilEtape, parent.Qte,
                signe * autres.Sum(x => x.LilQte), signe * autres.Where(x => !x.EntVerrouille).Sum(x => x.LilQte),
                soldes.Where(x => x.LsoLigId == lien.LilSourceLigId && x.LsoEtape == lien.LilEtape).Sum(x => x.LsoQte),
                parent.Montant, signe * autres.Sum(x => x.LilMontantHt ?? 0)));
        }
        return new RestesDocument(pct, qte, res);
    }

    /// <summary>Solde d'un reliquat sans création de document.</summary>
    public async Task Solder(long ligId, DemandeSolde s, Utilisateur u, CancellationToken ct)
    {
        var ligne = await db.Lignes.AsNoTracking().FirstOrDefaultAsync(l => l.LigId == ligId, ct) ?? throw ExceptionMetier.Introuvable($"Ligne {ligId}");
        var doc = await db.Documents.AsNoTracking().FirstAsync(x => x.EntId == ligne.LigEntId, ct);
        await documents.VerifierDroit(u, doc.EntTydId, ActionsDroits.Transformer, ct);
        if (s.Qte <= 0) throw ExceptionMetier.Invalide("QTE", "La quantité soldée doit être positive");
        db.LignesSolde.Add(new DocumentLigneSolde
        {
            LsoLigId = ligId, LsoEtape = s.Etape, LsoQte = s.Qte, LsoDate = DateTimeOffset.UtcNow, LsoUtilisateur = u.Code, LsoMotif = s.Motif,
        });
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ archivage

    /// <summary>
    /// Lot d'archivage : tous les documents reliés, directement ou indirectement, par document_lien et
    /// document_ligne_lien. Le lot n'est archivable que si tous ses documents le sont.
    /// </summary>
    public async Task<LotArchivage> LotArchivage(long entId, CancellationToken ct)
    {
        var ids = await db.Database.SqlQuery<long>($"""
            WITH RECURSIVE aretes AS (
                SELECT lie_source_ent_id AS a, lie_cible_ent_id AS b FROM document_lien
                UNION
                SELECT ls.lig_ent_id, lc.lig_ent_id
                FROM document_ligne_lien x
                JOIN document_ligne ls ON ls.lig_id = x.lil_source_lig_id
                JOIN document_ligne lc ON lc.lig_id = x.lil_cible_lig_id
            ), voisins AS (
                SELECT a, b FROM aretes UNION SELECT b, a FROM aretes
            ), lot(ent_id) AS (
                SELECT {entId}::bigint
                UNION
                SELECT v.b FROM voisins v JOIN lot ON v.a = lot.ent_id
            )
            SELECT ent_id AS "Value" FROM lot
            """).ToListAsync(ct);

        var docs = new List<DocumentDuLot>();
        var bloquants = new List<string>();
        foreach (var id in ids.Order())
        {
            var complet = await documents.Charger(id, ct);
            var type = await db.TypesDocument.AsNoTracking().FirstAsync(t => t.TydId == complet.Document.EntTydId, ct);
            var statut = await db.StatutsDocument.AsNoTracking().FirstAsync(s => s.StdId == complet.Document.EntStdId, ct);
            var suivi = await Suivi(complet, ct);
            // Une ligne est close dès qu'une étape obligatoire est entièrement transformée ou soldée
            // (les chemins devis → commande et devis → facture sont des alternatives).
            var reliquat = suivi.Any(l =>
            {
                var obligatoires = l.Etapes.Where(e => !EtapesFacultatives.Contains(e.Etape)).ToList();
                return obligatoires.Count > 0 && obligatoires.All(e => e.Reliquat > 0);
            });
            var terminal = statut.StdTerminal;
            docs.Add(new DocumentDuLot(id, complet.Document.EntNumero, type.TydCode, statut.StdCode, terminal, reliquat));
            var nom = $"{type.TydLibelle} {complet.Document.EntNumero ?? "#" + id}";
            if (!terminal) bloquants.Add($"{nom} : statut « {statut.StdLibelle} » non terminal");
            if (reliquat) bloquants.Add($"{nom} : reliquat ouvert");
        }
        return new LotArchivage(docs, bloquants.Count == 0, bloquants);
    }
}
