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
    public List<VariableDefinition> Variables { get; set; } = [];
}

/// <summary>
/// Spécialisation BTP des services du module Document : moteur MoteurDevisBtp, mode de calcul des ouvrages,
/// persistance des métrés (scripts) et des variables (correspondances « metres », « variables »),
/// lignes d'écart d'arrondi calculées.
/// </summary>
public sealed class SpecialisationBtp : SpecialisationDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>
{
    public const string ComplementMetres = "metres";
    public const string ComplementVariables = "variables";

    public override ComparateurCalcul Comparateur { get; } = new ComparateurBtp();

    // ------------------------------------------------------------------ calcul

    public override EntreeDocument<DocumentBtp, DocumentLigneBtp> CreerEntree(DocumentCompletBtp saisie, List<TauxTva> tauxTva, OptionsCalcul options) => new EntreeCalcul
    {
        Document = saisie.Document, Lignes = saisie.Lignes, TauxTva = tauxTva, Options = options,
        Metres = saisie.Metres, Variables = saisie.Variables,
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
            c.Variables = b.Variables;
        }
        return c;
    }

    /// <summary>
    /// Nature obligatoire sur les lignes de prix (éléments, ouvrages et composantes), hors écart d'arrondi : exigée à la
    /// validation. Réplique de controlesValidation (client/src/calcul/controles-btp.js).
    /// </summary>
    public override void ControlerValidation(EntreeDocument<DocumentBtp, DocumentLigneBtp> entree, List<MessageCalcul> erreurs)
    {
        foreach (var l in entree.Lignes.Where(l => TL.EstChiffree(l) && !l.LigIsEcartArrondi && l.LigNatId is null))
            erreurs.Add(new MessageCalcul(l.LigId, "NATURE_OBLIGATOIRE", "Nature obligatoire sur une ligne de prix"));
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
        cible.EntRedacteurId = saisie.EntRedacteurId;
    }

    // ------------------------------------------------------------------ chargement

    public override async Task ChargerComplements(DocumentDbContext<DocumentBtp, DocumentLigneBtp> contexte, DocumentCompletBtp complet,
        IReadOnlyCollection<long> lignes, CancellationToken ct)
    {
        var db = (LogiBtpContext)contexte;
        var entId = complet.Document.EntId;
        complet.Metres = await db.Metres.AsNoTracking().Where(m => lignes.Contains(m.MtrLigId)).OrderBy(m => m.MtrId).ToListAsync(ct);
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
        foreach (var m in d.Metres) mtr[m.MtrId] = --n;
        static long? Map(IReadOnlyDictionary<long, long> t, long? id) => id is long v && t.TryGetValue(v, out var r) ? r : null;
        // Les lignes portent déjà leur nouvel ID ; seul lig_mtr_id reste à convertir.
        foreach (var l in d.Lignes) l.LigMtrId = Map(mtr, l.LigMtrId);
        foreach (var m in d.Metres)
        {
            m.MtrId = mtr[m.MtrId];
            m.MtrLigId = lig[m.MtrLigId];
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
