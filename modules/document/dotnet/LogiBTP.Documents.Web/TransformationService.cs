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

    public async Task<TComplet> Transformer(long sourceId, DemandeTransformation dem, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var source = await documents.Charger(sourceId, ct);
        var typeSource = await documents.Type(source.Document.EntTydId, ct);
        var typeCible = await documents.Type(dem.CibleTydId, ct);
        await documents.VerifierDroit(u, typeSource.TydId, "TRANSFORMER", ct);
        await documents.VerifierDroit(u, typeCible.TydId, "CREER", ct);
        var regle = await db.TransformationsAutorisees.AsNoTracking()
            .FirstOrDefaultAsync(t => t.TraSourceTydId == typeSource.TydId && t.TraCibleTydId == typeCible.TydId, ct)
            ?? throw ExceptionMetier.Invalide("TRANSFORMATION_INTERDITE", $"Transformation {typeSource.TydCode} → {typeCible.TydCode} non autorisée");
        if (!source.Document.EntVerrouille)
        {
            throw ExceptionMetier.Invalide("SOURCE_NON_VALIDEE", "Seul un document validé peut être transformé");
        }

        var suivi = await Suivi(source, ct);
        var parId = source.Lignes.ToDictionary(l => l.LigId);
        var handler = handlers.Pour(typeCible);
        var demandes = dem.Lignes.Count > 0
            ? dem.Lignes
            : suivi.Select(s => new LigneATransformer { LigId = s.LigId }).ToList();

        // Tout le reliquat : toutes les lignes de prix sont reprises, celles qui n'ont plus de reste à 0 (structure du
        // parent conservée, lien créé pour suivre une quantité saisie ensuite) ; lignes choisies : seulement celles-ci.
        var toutes = dem.Lignes.Count == 0;
        var retenues = new Dictionary<long, decimal>();
        var avancements = new Dictionary<long, decimal?>();
        foreach (var d in demandes)
        {
            if (!parId.TryGetValue(d.LigId, out var src) || suivi.All(s => s.LigId != d.LigId))
            {
                throw ExceptionMetier.Invalide("LIGNE_INVALIDE", $"La ligne {d.LigId} n'est pas une ligne de prix du document");
            }
            var etape = suivi.First(s => s.LigId == d.LigId).Etapes.FirstOrDefault(e => e.Etape == regle.TraEtape);
            var reliquat = etape?.Reliquat ?? src.LigQteVendue ?? 0;
            var deja = etape?.Transforme ?? 0;
            var qte = handler.QuantiteCible(new LigneTransformee(src, d.Qte ?? reliquat, d.AvancementPct), deja);
            if (toutes && !EstNegative(regle.TraEtape) && qte < 0) qte = 0;
            if (qte == 0 && !toutes) continue;
            retenues[src.LigId] = qte;
            avancements[src.LigId] = d.AvancementPct;
        }
        if (retenues.Values.All(q => q == 0)) throw ExceptionMetier.Invalide("RIEN_A_TRANSFORMER", "Aucune quantité à transformer");

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
        foreach (var l in source.Lignes.Where(l => l.LigTylId is TL.PiedHt or TL.PiedTtc or TL.Tva)) garder.Add(l.LigId);
        // Frais annexes (type F) : conservés avec leurs tranches ancêtres, hors total et non édités.
        foreach (var l in source.Lignes.Where(l => l.LigTypePrix == "F"))
        {
            for (var x = l; ; x = parId[x.LigParentId!.Value])
            {
                garder.Add(x.LigId);
                if (x.LigParentId is null) break;
            }
        }
        // Sous-totaux de pied (racine) et bases des lignes de pied (sous-total désigné par LigPiedBaseId) : conservés.
        foreach (var l in source.Lignes.Where(l => l.LigTylId == TL.SousTotal && l.LigParentId is null)) garder.Add(l.LigId);
        foreach (var l in source.Lignes.Where(l => garder.Contains(l.LigId) && l.LigPiedBaseId is long)) garder.Add(l.LigPiedBaseId!.Value);

        var numero = typeCible.TydNumerotationContinue ? null : await documents.AttribuerNumero(typeCible, DateOnly.FromDateTime(DateTime.Today), ct);
        var cible = await documents.Dupliquer(source, d =>
        {
            d.EntTydId = typeCible.TydId;
            d.EntIndice = "A";
            d.EntIsReference = true;
            d.EntGroupeId = null;
            d.EntNumero = numero;
            d.EntDate = DateOnly.FromDateTime(DateTime.Today);
        }, u, ct, contenu => Filtrer(contenu, garder, retenues));

        // Liens document et lignes : étape de la règle et étapes sautées couvertes (facture qui vaut réception).
        db.DocumentsLien.Add(new DocumentLien { LieSourceEntId = sourceId, LieCibleEntId = cible.Document.Document.EntId });
        var lignesCible = cible.Document.Lignes.Where(l => l.LigOrigineId is long o && retenues.ContainsKey(o)).ToList();
        var etapes = new[] { regle.TraEtape }.Concat(regle.TraVautEtapes ?? []).Distinct().ToList();
        foreach (var lc in lignesCible)
        {
            var src = lc.LigOrigineId!.Value;
            var qte = retenues[src];
            foreach (var etape in etapes)
            {
                db.LignesLien.Add(new DocumentLigneLien
                {
                    LilSourceLigId = src,
                    LilCibleLigId = lc.LigId,
                    LilEtape = etape,
                    LilQte = EstNegative(etape) ? -qte : qte,
                    LilMontantHt = lc.LigMontantHt,
                    LilAvancementPct = avancements[src],
                });
            }
            // Retours et avoirs : quantité négative sur l'étape amont, qui rouvre le reliquat du document d'origine ; les
            // soldes demandés par la ligne annulée sont retirés.
            if (EstNegative(regle.TraEtape))
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
                    foreach (var etape in etapes)
                    {
                        db.LignesLien.Add(new DocumentLigneLien { LilSourceLigId = o, LilCibleLigId = lc.LigId, LilEtape = etape, LilQte = qte, LilMontantHt = lc.LigMontantHt });
                    }
                }
            }
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await documents.Charger(cible.Document.Document.EntId, ct);
    }

    /// <summary>Garde les lignes retenues ; la ligne de prix prend la quantité transformée, les composantes absolues suivent au prorata.</summary>
    private TComplet Filtrer(TComplet c, HashSet<long> garder, Dictionary<long, decimal> retenues)
    {
        c.Lignes = c.Lignes.Where(l => l.LigOrigineId is long o && garder.Contains(o)).ToList();
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
            .ToDictionaryAsync(l => l.LigId, l => l.LigQteVendue ?? 0, ct);
        // Liens des parents avec l'état (brouillon ou validé) du document cible ; ceux du document en cours à part.
        var liens = await (from x in db.LignesLien.AsNoTracking()
                           join l in db.Lignes.AsNoTracking() on x.LilCibleLigId equals l.LigId
                           join d in db.Documents.AsNoTracking() on l.LigEntId equals d.EntId
                           where parentsIds.Contains(x.LilSourceLigId) && l.LigEntId != entId
                           select new { x.LilSourceLigId, x.LilEtape, x.LilQte, d.EntVerrouille }).ToListAsync(ct);
        var soldes = await db.LignesSolde.AsNoTracking()
            .Where(x => parentsIds.Contains(x.LsoLigId) && (x.LsoCibleLigId == null || !ids.Contains(x.LsoCibleLigId.Value))).ToListAsync(ct);
        var res = new List<ResteLigne>();
        foreach (var l in lignes)
        {
            // Étape principale : la première écrite à la transformation (une facture qui vaut réception en a deux).
            var lien = directs.Where(x => x.LilCibleLigId == l.LigId).OrderBy(x => x.LilId).FirstOrDefault();
            if (lien is null || !parents.TryGetValue(lien.LilSourceLigId, out var qteParent)) continue;
            var signe = EstNegative(lien.LilEtape) ? -1 : 1;
            var autres = liens.Where(x => x.LilSourceLigId == lien.LilSourceLigId && x.LilEtape == lien.LilEtape).ToList();
            res.Add(new ResteLigne(l.LigId, lien.LilSourceLigId, lien.LilEtape, qteParent,
                signe * autres.Sum(x => x.LilQte), signe * autres.Where(x => !x.EntVerrouille).Sum(x => x.LilQte),
                soldes.Where(x => x.LsoLigId == lien.LilSourceLigId && x.LsoEtape == lien.LilEtape).Sum(x => x.LsoQte)));
        }
        return new RestesDocument(pct, qte, res);
    }

    /// <summary>Solde d'un reliquat sans création de document.</summary>
    public async Task Solder(long ligId, DemandeSolde s, Utilisateur u, CancellationToken ct)
    {
        var ligne = await db.Lignes.AsNoTracking().FirstOrDefaultAsync(l => l.LigId == ligId, ct) ?? throw ExceptionMetier.Introuvable($"Ligne {ligId}");
        var doc = await db.Documents.AsNoTracking().FirstAsync(x => x.EntId == ligne.LigEntId, ct);
        await documents.VerifierDroit(u, doc.EntTydId, "TRANSFORMER", ct);
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
