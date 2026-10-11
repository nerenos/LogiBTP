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
            if (qte == 0) continue;
            retenues[src.LigId] = qte;
            avancements[src.LigId] = d.AvancementPct;
        }
        if (retenues.Count == 0) throw ExceptionMetier.Invalide("RIEN_A_TRANSFORMER", "Aucune quantité à transformer");

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
            // Retours et avoirs : quantité négative sur l'étape amont, qui rouvre le reliquat du document d'origine.
            if (EstNegative(regle.TraEtape))
            {
                var amont = await db.LignesLien.AsNoTracking().Where(x => x.LilCibleLigId == src && !EtapesFacultatives.Contains(x.LilEtape)).ToListAsync(ct);
                foreach (var a in amont)
                {
                    db.LignesLien.Add(new DocumentLigneLien { LilSourceLigId = a.LilSourceLigId, LilCibleLigId = lc.LigId, LilEtape = a.LilEtape, LilQte = -qte });
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
