using LogiBTP.Calcul;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Metres;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>Document BTP complet : document générique + métrés et variables (module Métré).</summary>
public sealed class DocumentCompletBtp : DocumentComplet<DocumentBtp, DocumentLigneBtp>
{
    public List<Metre> Metres { get; set; } = [];
    public List<MetreLigne> MetreLignes { get; set; } = [];
    public List<VariableDefinition> Variables { get; set; } = [];
}

/// <summary>
/// Spécialisation BTP des services du module Document : moteur MoteurDevisBtp, mode de calcul des ouvrages,
/// persistance des métrés et des variables (correspondances « metres », « metre_lignes », « variables »),
/// lignes d'écart d'arrondi calculées.
/// </summary>
public sealed class SpecialisationBtp : SpecialisationDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>
{
    public const string ComplementMetres = "metres";
    public const string ComplementMetreLignes = "metre_lignes";
    public const string ComplementVariables = "variables";

    public override ComparateurCalcul Comparateur { get; } = new ComparateurBtp();

    // ------------------------------------------------------------------ calcul

    public override EntreeDocument<DocumentBtp, DocumentLigneBtp> CreerEntree(DocumentCompletBtp saisie, List<TauxTva> tauxTva, OptionsCalcul options) => new EntreeCalcul
    {
        Document = saisie.Document, Lignes = saisie.Lignes, TauxTva = tauxTva, Options = options,
        Metres = saisie.Metres, MetreLignes = saisie.MetreLignes, Variables = saisie.Variables,
    };

    public override ResultatDocument<DocumentBtp, DocumentLigneBtp> Calculer(EntreeDocument<DocumentBtp, DocumentLigneBtp> entree) =>
        MoteurDevisBtp.Calculer(entree as EntreeCalcul ?? new EntreeCalcul
        {
            Document = entree.Document, Lignes = entree.Lignes, TauxTva = entree.TauxTva, Entites = entree.Entites, Options = entree.Options,
        });

    public override DocumentCompletBtp VersComplet(ResultatDocument<DocumentBtp, DocumentLigneBtp> r)
    {
        var c = base.VersComplet(r);
        if (r is ResultatCalcul b)
        {
            c.Metres = b.Metres;
            c.MetreLignes = b.MetreLignes;
            c.Variables = b.Variables;
        }
        return c;
    }

    public override void CopierEnteteSaisie(DocumentBtp cible, DocumentBtp saisie)
    {
        cible.EntModeCalculOuvrage = saisie.EntModeCalculOuvrage;
        cible.EntBibId = saisie.EntBibId;
        cible.EntProjetId = saisie.EntProjetId;
        cible.EntAffaireId = saisie.EntAffaireId;
        cible.EntChantierId = saisie.EntChantierId;
        cible.EntMarcheId = saisie.EntMarcheId;
        cible.EntIntervenants = saisie.EntIntervenants ?? cible.EntIntervenants;
    }

    // ------------------------------------------------------------------ chargement

    public override async Task ChargerComplements(DocumentDbContext<DocumentBtp, DocumentLigneBtp> contexte, DocumentCompletBtp complet,
        IReadOnlyCollection<long> lignes, CancellationToken ct)
    {
        var db = (LogiBtpContext)contexte;
        var entId = complet.Document.EntId;
        complet.Metres = await db.Metres.AsNoTracking().Where(m => lignes.Contains(m.MtrLigId)).OrderBy(m => m.MtrId).ToListAsync(ct);
        var mids = complet.Metres.Select(m => m.MtrId).ToList();
        complet.MetreLignes = await db.MetreLignes.AsNoTracking().Where(x => mids.Contains(x.MliMtrId))
            .OrderBy(x => x.MliMtrId).ThenBy(x => x.MliOrdre).ToListAsync(ct);
        complet.Variables = await db.Variables.AsNoTracking().Where(v => v.VarEntId == entId)
            .OrderBy(v => v.VarOrdre).ThenBy(v => v.VarId).ToListAsync(ct);
    }

    // ------------------------------------------------------------------ écriture

    /// <summary>lig_mtr_id peut viser un métré pas encore créé : renseigné après l'écriture des métrés.</summary>
    public override void PreparerLigneAEcrire(DocumentLigneBtp copie) => copie.LigMtrId = null;

    public override async Task EcrireComplements(DocumentDbContext<DocumentBtp, DocumentLigneBtp> contexte, long entId, DocumentCompletBtp r,
        Correspondances corr, CancellationToken ct)
    {
        var db = (LogiBtpContext)contexte;
        await EcrireMetres(db, r, corr, ct);
        await EcrireVariables(db, entId, r, corr, ct);
    }

    private static async Task EcrireMetres(LogiBtpContext db, DocumentCompletBtp r, Correspondances corr, CancellationToken ct)
    {
        var ids = corr.Lignes;
        var cMetres = corr.Complement(ComplementMetres);
        var cLignes = corr.Complement(ComplementMetreLignes);
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
                cMetres[m.MtrId] = m.MtrId;
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
        foreach (var (temp, e) in nouveaux) cMetres[temp] = e.MtrId;

        foreach (var l in r.Lignes)
        {
            var e = await db.Lignes.FindAsync([ids[l.LigId]], ct);
            e!.LigMtrId = l.LigMtrId is long mt && cMetres.TryGetValue(mt, out var mt2) ? mt2 : null;
        }

        // Lignes de métré : conservées par ID, insérées par niveau de sous-détail.
        var mids = cMetres.Values.ToList();
        var lignesExistantes = await db.MetreLignes.Where(x => mids.Contains(x.MliMtrId)).ToDictionaryAsync(x => x.MliId, ct);
        var saisies = r.MetreLignes.Where(x => cMetres.ContainsKey(x.MliMtrId)).ToDictionary(x => x.MliId);
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
                copie.MliMtrId = cMetres[x.MliMtrId];
                copie.MliParentId = x.MliParentId is long p ? cLignes.GetValueOrDefault(p, p) : null;
                copie.MliStDepuisId = null;
                if (lignesExistantes.TryGetValue(x.MliId, out var entite))
                {
                    db.Entry(entite).CurrentValues.SetValues(copie);
                    cLignes[x.MliId] = x.MliId;
                }
                else
                {
                    copie.MliId = 0;
                    db.MetreLignes.Add(copie);
                    ajout.Add((x.MliId, copie));
                }
            }
            await db.SaveChangesAsync(ct);
            foreach (var (temp, e) in ajout) cLignes[temp] = e.MliId;
        }
        // Suppressions après les mises à jour : un sous-détail supprimé n'emporte pas une ligne déplacée.
        var aSupprimer = lignesExistantes.Keys.Where(id => !saisies.ContainsKey(id)).ToList();
        await db.MetreLignes.Where(x => aSupprimer.Contains(x.MliId)).ExecuteDeleteAsync(ct);
        foreach (var id in aSupprimer) db.Entry(lignesExistantes[id]).State = EntityState.Detached;
        foreach (var x in saisies.Values)
        {
            var e = await db.MetreLignes.FindAsync([cLignes[x.MliId]], ct);
            e!.MliStDepuisId = x.MliStDepuisId is long s && cLignes.TryGetValue(s, out var s2) ? s2 : null;
        }
        await db.SaveChangesAsync(ct);
    }

    private static async Task EcrireVariables(LogiBtpContext db, long entId, DocumentCompletBtp r, Correspondances corr, CancellationToken ct)
    {
        var cMetres = corr.Complement(ComplementMetres);
        var cVariables = corr.Complement(ComplementVariables);
        var existantes = await db.Variables.Where(v => v.VarEntId == entId).ToDictionaryAsync(v => v.VarId, ct);
        var nouvelles = new List<(long Temp, VariableDefinition Entite)>();
        foreach (var v in r.Variables)
        {
            if (v.VarLigId is long vl && !corr.Lignes.ContainsKey(vl)) continue;
            if (v.VarMtrId is long vm && !cMetres.ContainsKey(vm)) continue;
            var copie = JsonCalcul.Cloner(v);
            copie.VarEntId = entId;
            copie.VarLigId = v.VarLigId is long l ? corr.Lignes[l] : null;
            copie.VarMtrId = v.VarMtrId is long m ? cMetres[m] : null;
            if (existantes.Remove(v.VarId, out var entite))
            {
                db.Entry(entite).CurrentValues.SetValues(copie);
                cVariables[v.VarId] = v.VarId;
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
        foreach (var (temp, e) in nouvelles) cVariables[temp] = e.VarId;
    }

    // ------------------------------------------------------------------ copies et transformations

    public override void RenumeroterComplements(DocumentCompletBtp d, IReadOnlyDictionary<long, long> lig, ref long n)
    {
        var mtr = new Dictionary<long, long>();
        var mli = new Dictionary<long, long>();
        foreach (var m in d.Metres) mtr[m.MtrId] = --n;
        foreach (var x in d.MetreLignes) mli[x.MliId] = --n;
        static long? Map(IReadOnlyDictionary<long, long> t, long? id) => id is long v && t.TryGetValue(v, out var r) ? r : null;
        // Les lignes portent déjà leur nouvel ID ; seul lig_mtr_id reste à convertir.
        foreach (var l in d.Lignes) l.LigMtrId = Map(mtr, l.LigMtrId);
        foreach (var m in d.Metres)
        {
            m.MtrId = mtr[m.MtrId];
            m.MtrLigId = lig[m.MtrLigId];
        }
        foreach (var x in d.MetreLignes)
        {
            x.MliId = mli[x.MliId];
            x.MliMtrId = mtr[x.MliMtrId];
            x.MliParentId = Map(mli, x.MliParentId);
            x.MliStDepuisId = Map(mli, x.MliStDepuisId);
        }
        foreach (var v in d.Variables)
        {
            v.VarLigId = Map(lig, v.VarLigId);
            v.VarMtrId = Map(mtr, v.VarMtrId);
        }
    }

    public override void FiltrerComplements(DocumentCompletBtp c, ISet<long> lignes)
    {
        c.Metres = c.Metres.Where(m => lignes.Contains(m.MtrLigId)).ToList();
        var mids = c.Metres.Select(m => m.MtrId).ToHashSet();
        c.MetreLignes = c.MetreLignes.Where(x => mids.Contains(x.MliMtrId)).ToList();
        c.Variables = c.Variables.Where(v => (v.VarLigId is null || lignes.Contains(v.VarLigId.Value))
            && (v.VarMtrId is null || mids.Contains(v.VarMtrId.Value))).ToList();
        foreach (var l in c.Lignes.Where(l => l.LigMtrId is long m && !mids.Contains(m))) l.LigMtrId = null;
    }

    public override bool EstLigneCalculee(DocumentLigneBtp l) => l.LigIsEcartArrondi;

    public override void AjusterLigneTransformee(DocumentLigneBtp l)
    {
        l.LigQteSource = "S";
        l.LigCoefPerte = 1;
    }
}
