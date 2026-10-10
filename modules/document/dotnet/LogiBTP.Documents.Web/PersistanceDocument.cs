using System.Text.Json;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Documents.Web;

/// <summary>
/// Écriture d'un document calculé (classe mère). Les ID existants sont conservés (les lignes sont référencées
/// par les liens de transformation, et le client garde sa pile d'annulation) ; les lignes nouvelles portent un
/// ID temporaire négatif, remplacé par l'ID définitif et renvoyé au client. Les compléments (métrés…) sont
/// écrits par la spécialisation. Doit être appelée dans une transaction.
/// </summary>
public class PersistanceDocument<TDoc, TLigne, TComplet>(DocumentDbContext<TDoc, TLigne> db, SpecialisationDocument<TDoc, TLigne, TComplet> specialisation)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
    where TComplet : DocumentComplet<TDoc, TLigne>, new()
{
    protected DocumentDbContext<TDoc, TLigne> Db => db;

    private static JsonDocument Vide() => JsonDocument.Parse("{}");

    public virtual async Task<TComplet> Charger(long entId, CancellationToken ct)
    {
        var doc = await db.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.EntId == entId, ct)
            ?? throw ExceptionMetier.Introuvable($"Document {entId}");
        var lignes = await db.Lignes.AsNoTracking().Where(l => l.LigEntId == entId)
            .OrderBy(l => l.LigParentId).ThenBy(l => l.LigOrdre).ToListAsync(ct);
        var complet = new TComplet
        {
            Document = doc,
            Lignes = lignes,
            Tva = await db.DocumentsTva.AsNoTracking().Where(t => t.TvaEntId == entId).OrderBy(t => t.TvaCode).ToListAsync(ct),
        };
        await specialisation.ChargerComplements(db, complet, lignes.Select(l => l.LigId).ToList(), ct);
        return complet;
    }

    /// <summary>Instantané JSON complet pour document_historique (type concret, compléments compris).</summary>
    public static JsonDocument Instantane(TComplet d) => JsonSerializer.SerializeToDocument(d, JsonCalcul.Options);

    /// <summary>Remplace le contenu calculé du document et renvoie les correspondances d'ID.</summary>
    public virtual async Task<Correspondances> Ecrire(long entId, TComplet r, CancellationToken ct)
    {
        var corr = new Correspondances();
        await EcrireLignes(entId, r, corr.Lignes, ct);
        await specialisation.EcrireComplements(db, entId, r, corr, ct);

        // Ventilation de TVA : table de référence recalculée à chaque enregistrement.
        await db.DocumentsTva.Where(t => t.TvaEntId == entId).ExecuteDeleteAsync(ct);
        foreach (var t in r.Tva)
        {
            var copie = JsonCalcul.Cloner(t);
            copie.TvaEntId = entId;
            db.DocumentsTva.Add(copie);
        }
        await db.SaveChangesAsync(ct);
        return corr;
    }

    private async Task EcrireLignes(long entId, TComplet r, Dictionary<long, long> ids, CancellationToken ct)
    {
        var existantes = await db.Lignes.Where(l => l.LigEntId == entId).ToDictionaryAsync(l => l.LigId, ct);
        var resultat = r.Lignes.ToDictionary(l => l.LigId);
        var conservees = r.Lignes.Where(l => existantes.ContainsKey(l.LigId)).Select(l => l.LigId).ToHashSet();

        // lig_origine_id ne garde que des lignes existantes (la source d'une copie a pu être supprimée).
        var origines = r.Lignes.Where(l => l.LigOrigineId is > 0).Select(l => l.LigOrigineId!.Value).Distinct().ToList();
        var originesValides = (await db.Lignes.Where(l => origines.Contains(l.LigId)).Select(l => l.LigId).ToListAsync(ct)).ToHashSet();

        // 1. Suppressions sans descendant conservé : avant les insertions (index uniques sur des lignes recréées).
        var aSupprimer = existantes.Keys.Where(id => !conservees.Contains(id)).ToHashSet();
        bool ADesDescendantsConserves(long id) =>
            existantes.Values.Any(l => conservees.Contains(l.LigId) && EstDescendant(l, id, existantes));
        var immediates = aSupprimer.Where(id => !ADesDescendantsConserves(id)).ToList();
        await SupprimerLignes(immediates, ct);

        // 2. Insertions et mises à jour par niveau : un parent reçoit son ID avant ses enfants.
        int Profondeur(TLigne l)
        {
            var p = 0;
            for (var x = l; x.LigParentId is long pid && resultat.TryGetValue(pid, out var parent); x = parent) p++;
            return p;
        }
        foreach (var niveau in r.Lignes.GroupBy(Profondeur).OrderBy(g => g.Key))
        {
            var nouvelles = new List<(long Temp, TLigne Entite)>();
            foreach (var l in niveau)
            {
                var copie = JsonCalcul.Cloner(l);
                copie.LigEntId = entId;
                copie.LigParentId = l.LigParentId is long p ? ids.GetValueOrDefault(p, p) : null;
                copie.LigStDepuisId = null;
                copie.LigVarianteDeId = null;
                copie.LigOrigineId = l.LigOrigineId is long o && originesValides.Contains(o) ? o : null;
                copie.LigProprietes ??= Vide();
                specialisation.PreparerLigneAEcrire(copie);
                if (existantes.TryGetValue(l.LigId, out var entite))
                {
                    db.Entry(entite).CurrentValues.SetValues(copie);
                    ids[l.LigId] = l.LigId;
                }
                else
                {
                    copie.LigId = 0;
                    db.Lignes.Add(copie);
                    nouvelles.Add((l.LigId, copie));
                }
            }
            await db.SaveChangesAsync(ct);
            foreach (var (temp, e) in nouvelles) ids[temp] = e.LigId;
        }

        // 3. Suppressions restantes (leurs descendants conservés ont été déplacés).
        await SupprimerLignes(aSupprimer.Except(immediates).ToList(), ct);

        // 4. Références croisées vers des lignes éventuellement nouvelles.
        foreach (var l in r.Lignes)
        {
            var e = await db.Lignes.FindAsync([ids[l.LigId]], ct);
            e!.LigStDepuisId = l.LigStDepuisId is long st && ids.TryGetValue(st, out var st2) ? st2 : null;
            e.LigVarianteDeId = l.LigVarianteDeId is long va && ids.TryGetValue(va, out var va2) ? va2 : null;
        }
        await db.SaveChangesAsync(ct);
    }

    private static bool EstDescendant(TLigne l, long ancetre, Dictionary<long, TLigne> lignes)
    {
        for (var x = l; x.LigParentId is long p; x = lignes[p])
        {
            if (p == ancetre) return true;
            if (!lignes.ContainsKey(p)) return false;
        }
        return false;
    }

    private async Task SupprimerLignes(List<long> ids, CancellationToken ct)
    {
        if (ids.Count == 0) return;
        await db.Lignes.Where(l => ids.Contains(l.LigId)).ExecuteDeleteAsync(ct);
        foreach (var e in db.ChangeTracker.Entries<TLigne>().Where(e => ids.Contains(e.Entity.LigId)).ToList())
        {
            e.State = EntityState.Detached;
        }
    }
}
