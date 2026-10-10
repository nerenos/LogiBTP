using System.Text.Json;
using LogiBTP.Api.Donnees;
using LogiBTP.Calcul;
using LogiBTP.Domaine;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Documents;

/// <summary>Correspondances ID temporaire (négatif) → ID définitif, par table.</summary>
public sealed class Correspondances
{
    public Dictionary<long, long> Lignes { get; } = [];
    public Dictionary<long, long> Metres { get; } = [];
    public Dictionary<long, long> MetreLignes { get; } = [];
    public Dictionary<long, long> Variables { get; } = [];
}

/// <summary>
/// Écriture d'un document calculé. Les ID existants sont conservés (les lignes sont référencées par les
/// liens de transformation, et le client garde sa pile d'annulation) ; les éléments nouveaux portent un ID
/// temporaire négatif, remplacé par l'ID définitif et renvoyé au client. Doit être appelé dans une transaction.
/// </summary>
public sealed class PersistanceDocument(LogiBtpContext db)
{
    private static JsonDocument Vide() => JsonDocument.Parse("{}");

    public async Task<DocumentComplet> Charger(long entId, CancellationToken ct)
    {
        var doc = await db.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.EntId == entId, ct)
            ?? throw Infrastructure.ExceptionMetier.Introuvable($"Document {entId}");
        var lignes = await db.Lignes.AsNoTracking().Where(l => l.LigEntId == entId)
            .OrderBy(l => l.LigParentId).ThenBy(l => l.LigOrdre).ToListAsync(ct);
        var ids = lignes.Select(l => l.LigId).ToList();
        var metres = await db.Metres.AsNoTracking().Where(m => ids.Contains(m.MtrLigId)).OrderBy(m => m.MtrId).ToListAsync(ct);
        var mids = metres.Select(m => m.MtrId).ToList();
        return new DocumentComplet
        {
            Document = doc,
            Lignes = lignes,
            Metres = metres,
            MetreLignes = await db.MetreLignes.AsNoTracking().Where(x => mids.Contains(x.MliMtrId)).OrderBy(x => x.MliMtrId).ThenBy(x => x.MliOrdre).ToListAsync(ct),
            Variables = await db.Variables.AsNoTracking().Where(v => v.VarEntId == entId).OrderBy(v => v.VarOrdre).ThenBy(v => v.VarId).ToListAsync(ct),
            Tva = await db.DocumentsTva.AsNoTracking().Where(t => t.TvaEntId == entId).OrderBy(t => t.TvaCode).ToListAsync(ct),
        };
    }

    /// <summary>Instantané JSON complet pour document_historique.</summary>
    public static JsonDocument Instantane(DocumentComplet d) => JsonSerializer.SerializeToDocument(d, JsonCalcul.Options);

    /// <summary>Remplace le contenu calculé du document et renvoie les correspondances d'ID.</summary>
    public async Task<Correspondances> Ecrire(long entId, ResultatCalcul r, CancellationToken ct)
    {
        var corr = new Correspondances();
        await EcrireLignes(entId, r, corr.Lignes, ct);
        await EcrireMetres(r, corr, ct);
        await EcrireVariables(entId, r, corr, ct);

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

    private async Task EcrireLignes(long entId, ResultatCalcul r, Dictionary<long, long> ids, CancellationToken ct)
    {
        var existantes = await db.Lignes.Where(l => l.LigEntId == entId).ToDictionaryAsync(l => l.LigId, ct);
        var resultat = r.Lignes.ToDictionary(l => l.LigId);
        var conservees = r.Lignes.Where(l => existantes.ContainsKey(l.LigId)).Select(l => l.LigId).ToHashSet();

        // lig_origine_id ne garde que des lignes existantes (la source d'une copie a pu être supprimée).
        var origines = r.Lignes.Where(l => l.LigOrigineId is > 0).Select(l => l.LigOrigineId!.Value).Distinct().ToList();
        var originesValides = (await db.Lignes.Where(l => origines.Contains(l.LigId)).Select(l => l.LigId).ToListAsync(ct)).ToHashSet();

        // 1. Suppressions sans descendant conservé : avant les insertions (index unique de l'écart d'arrondi).
        var aSupprimer = existantes.Keys.Where(id => !conservees.Contains(id)).ToHashSet();
        bool ADesDescendantsConserves(long id) =>
            existantes.Values.Any(l => conservees.Contains(l.LigId) && EstDescendant(l, id, existantes));
        var immediates = aSupprimer.Where(id => !ADesDescendantsConserves(id)).ToList();
        await SupprimerLignes(immediates, ct);

        // 2. Insertions et mises à jour par niveau : un parent reçoit son ID avant ses enfants.
        int Profondeur(DocumentLigne l)
        {
            var p = 0;
            for (var x = l; x.LigParentId is long pid && resultat.TryGetValue(pid, out var parent); x = parent) p++;
            return p;
        }
        foreach (var niveau in r.Lignes.GroupBy(Profondeur).OrderBy(g => g.Key))
        {
            var nouvelles = new List<(long Temp, DocumentLigne Entite)>();
            foreach (var l in niveau)
            {
                var copie = JsonCalcul.Cloner(l);
                copie.LigEntId = entId;
                copie.LigParentId = l.LigParentId is long p ? ids.GetValueOrDefault(p, p) : null;
                copie.LigStDepuisId = null;
                copie.LigVarianteDeId = null;
                copie.LigMtrId = null;
                copie.LigOrigineId = l.LigOrigineId is long o && originesValides.Contains(o) ? o : null;
                copie.LigProprietes ??= Vide();
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

        // 4. Références croisées vers des lignes éventuellement nouvelles (le métré est relié plus loin).
        foreach (var l in r.Lignes)
        {
            var e = await db.Lignes.FindAsync([ids[l.LigId]], ct);
            e!.LigStDepuisId = l.LigStDepuisId is long st && ids.TryGetValue(st, out var st2) ? st2 : null;
            e.LigVarianteDeId = l.LigVarianteDeId is long va && ids.TryGetValue(va, out var va2) ? va2 : null;
        }
        await db.SaveChangesAsync(ct);
    }

    private async Task EcrireMetres(ResultatCalcul r, Correspondances corr, CancellationToken ct)
    {
        var ids = corr.Lignes;
        var lignesDoc = ids.Values.ToList();
        var existants = await db.Metres.Where(m => lignesDoc.Contains(m.MtrLigId)).ToDictionaryAsync(m => m.MtrId, ct);
        var nouveaux = new List<(long Temp, Metre Entite)>();
        foreach (var m in r.Metres)
        {
            if (!ids.TryGetValue(m.MtrLigId, out var ligId)) continue;
            var copie = JsonCalcul.Cloner(m);
            copie.MtrLigId = ligId;
            if (existants.Remove(m.MtrId, out var entite))
            {
                db.Entry(entite).CurrentValues.SetValues(copie);
                corr.Metres[m.MtrId] = m.MtrId;
            }
            else
            {
                copie.MtrId = 0;
                db.Metres.Add(copie);
                nouveaux.Add((m.MtrId, copie));
            }
        }
        db.Metres.RemoveRange(existants.Values);
        await db.SaveChangesAsync(ct);
        foreach (var (temp, e) in nouveaux) corr.Metres[temp] = e.MtrId;

        foreach (var l in r.Lignes)
        {
            var e = await db.Lignes.FindAsync([ids[l.LigId]], ct);
            e!.LigMtrId = l.LigMtrId is long mt && corr.Metres.TryGetValue(mt, out var mt2) ? mt2 : null;
        }

        // Lignes de métré : conservées par ID, insérées par niveau de sous-détail.
        var mids = corr.Metres.Values.ToList();
        var lignesExistantes = await db.MetreLignes.Where(x => mids.Contains(x.MliMtrId)).ToDictionaryAsync(x => x.MliId, ct);
        var saisies = r.MetreLignes.Where(x => corr.Metres.ContainsKey(x.MliMtrId)).ToDictionary(x => x.MliId);
        int Profondeur(MetreLigne x)
        {
            var p = 0;
            for (var y = x; y.MliParentId is long pid && saisies.TryGetValue(pid, out var parent); y = parent) p++;
            return p;
        }
        foreach (var niveau in saisies.Values.GroupBy(Profondeur).OrderBy(g => g.Key))
        {
            var ajout = new List<(long Temp, MetreLigne Entite)>();
            foreach (var x in niveau)
            {
                var copie = JsonCalcul.Cloner(x);
                copie.MliMtrId = corr.Metres[x.MliMtrId];
                copie.MliParentId = x.MliParentId is long p ? corr.MetreLignes.GetValueOrDefault(p, p) : null;
                copie.MliStDepuisId = null;
                if (lignesExistantes.TryGetValue(x.MliId, out var entite))
                {
                    db.Entry(entite).CurrentValues.SetValues(copie);
                    corr.MetreLignes[x.MliId] = x.MliId;
                }
                else
                {
                    copie.MliId = 0;
                    db.MetreLignes.Add(copie);
                    ajout.Add((x.MliId, copie));
                }
            }
            await db.SaveChangesAsync(ct);
            foreach (var (temp, e) in ajout) corr.MetreLignes[temp] = e.MliId;
        }
        // Suppressions après les mises à jour : un sous-détail supprimé n'emporte pas une ligne déplacée.
        var aSupprimer = lignesExistantes.Keys.Where(id => !saisies.ContainsKey(id)).ToList();
        await db.MetreLignes.Where(x => aSupprimer.Contains(x.MliId)).ExecuteDeleteAsync(ct);
        foreach (var id in aSupprimer) db.Entry(lignesExistantes[id]).State = EntityState.Detached;
        foreach (var x in saisies.Values)
        {
            var e = await db.MetreLignes.FindAsync([corr.MetreLignes[x.MliId]], ct);
            e!.MliStDepuisId = x.MliStDepuisId is long s && corr.MetreLignes.TryGetValue(s, out var s2) ? s2 : null;
        }
        await db.SaveChangesAsync(ct);
    }

    private async Task EcrireVariables(long entId, ResultatCalcul r, Correspondances corr, CancellationToken ct)
    {
        var existantes = await db.Variables.Where(v => v.VarEntId == entId).ToDictionaryAsync(v => v.VarId, ct);
        var nouvelles = new List<(long Temp, VariableDefinition Entite)>();
        foreach (var v in r.Variables)
        {
            if (v.VarLigId is long vl && !corr.Lignes.ContainsKey(vl)) continue;
            if (v.VarMtrId is long vm && !corr.Metres.ContainsKey(vm)) continue;
            var copie = JsonCalcul.Cloner(v);
            copie.VarEntId = entId;
            copie.VarLigId = v.VarLigId is long l ? corr.Lignes[l] : null;
            copie.VarMtrId = v.VarMtrId is long m ? corr.Metres[m] : null;
            if (existantes.Remove(v.VarId, out var entite))
            {
                db.Entry(entite).CurrentValues.SetValues(copie);
                corr.Variables[v.VarId] = v.VarId;
            }
            else
            {
                copie.VarId = 0;
                db.Variables.Add(copie);
                nouvelles.Add((v.VarId, copie));
            }
        }
        db.Variables.RemoveRange(existantes.Values);
        await db.SaveChangesAsync(ct);
        foreach (var (temp, e) in nouvelles) corr.Variables[temp] = e.VarId;
    }

    private static bool EstDescendant(DocumentLigne l, long ancetre, Dictionary<long, DocumentLigne> lignes)
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
        foreach (var e in db.ChangeTracker.Entries<DocumentLigne>().Where(e => ids.Contains(e.Entity.LigId)).ToList())
        {
            e.State = EntityState.Detached;
        }
    }
}
