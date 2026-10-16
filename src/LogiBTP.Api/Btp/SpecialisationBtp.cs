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
    /// <summary>Frais annexes : clés de ventilation saisies et détail calculé (db/167).</summary>
    public List<VentilationFrais> Ventilations { get; set; } = [];
    public List<VentilationFraisLigne> VentilationsLignes { get; set; } = [];
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
    public const string ComplementVentilations = "ventilations";

    public override ComparateurCalcul Comparateur { get; } = new ComparateurBtp();

    // ------------------------------------------------------------------ calcul

    public override EntreeDocument<DocumentBtp, DocumentLigneBtp> CreerEntree(DocumentCompletBtp saisie, List<TauxTva> tauxTva, OptionsCalcul options) => new EntreeCalcul
    {
        Document = saisie.Document, Lignes = saisie.Lignes, TauxTva = tauxTva, Options = options,
        Metres = saisie.Metres, Variables = saisie.Variables, Ventilations = saisie.Ventilations,
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
            c.Ventilations = b.Ventilations;
            c.VentilationsLignes = b.VentilationsLignes;
        }
        return c;
    }

    /// <summary>
    /// Validation : la ventilation calculée des frais annexes est figée en clés de ligne (montant par unité), pour que
    /// les prix des lignes inchangées restent les mêmes dans un nouvel indice ; les clés orphelines disparaissent.
    /// </summary>
    public override void PreparerValidation(ResultatDocument<DocumentBtp, DocumentLigneBtp> r)
    {
        if (r is ResultatCalcul b) b.Ventilations = FigerVentilation(b.VentilationsLignes, b.Lignes, b.Document.EntId);
    }

    /// <summary>
    /// Clés de ligne en montant par unité de quantité reproduisant un détail de ventilation (identifiants temporaires
    /// négatifs). Réplique de figerVentilation (client/src/app/frais-annexes.js).
    /// </summary>
    public static List<VentilationFrais> FigerVentilation(IEnumerable<VentilationFraisLigne> detail, IEnumerable<DocumentLigneBtp> lignes, long entId)
    {
        var parId = lignes.ToDictionary(l => l.LigId);
        var res = new List<VentilationFrais>();
        long n = 0;
        foreach (var g in detail.GroupBy(v => (v.VflSourceLigId, v.VflLigId)))
        {
            if (!parId.TryGetValue(g.Key.VflLigId, out var l) || (l.LigQteVendue ?? 0) == 0) continue;
            res.Add(new VentilationFrais
            {
                VfrId = --n, VfrEntId = entId, VfrSourceLigId = g.Key.VflSourceLigId, VfrCible = "LIGNE", VfrLigId = g.Key.VflLigId,
                VfrMode = "M", VfrValeur = ArrondiCalcul.Arr6(g.Sum(v => v.VflMontant) / l.LigQteVendue!.Value),
            });
        }
        return res;
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

    /// <summary>
    /// Commande client : un marché est obligatoire pour la valider (créé ou choisi par l'utilisateur), sauf la commande
    /// intermédiaire d'un devis facturé directement (CONCEPTION-ACHATS-MARCHES.md, Q16 et 13.1).
    /// </summary>
    public override Task ControlerValidationAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, DocumentCompletBtp document, TypeDocument type,
        List<MessageCalcul> erreurs, CancellationToken ct)
    {
        if (type.TydCode == "V_COMMANDE" && !document.Document.EntIntermediaire && document.Document.EntMarcheId is null)
        {
            erreurs.Add(new MessageCalcul(null, "MARCHE_OBLIGATOIRE", "Marché à créer ou à choisir avant de valider la commande"));
        }
        return Task.CompletedTask;
    }

    /// <summary>Commande client validée : inscrite à son marché (base ou avenant), montant du marché recalculé (db/170).</summary>
    public override async Task ApresValidationAsync(DocumentDbContext<DocumentBtp, DocumentLigneBtp> db, long entId, TypeDocument type, CancellationToken ct)
    {
        if (type.TydCode == "V_COMMANDE") await db.Database.ExecuteSqlInterpolatedAsync($"SELECT f_marche_commande({entId})", ct);
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
        cible.EntFaLignes = saisie.EntFaLignes ?? "V";
        cible.EntFaMode = saisie.EntFaMode ?? "C";
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
        complet.Ventilations = await db.VentilationsFrais.AsNoTracking().Where(v => v.VfrEntId == entId).OrderBy(v => v.VfrId).ToListAsync(ct);
        complet.VentilationsLignes = await db.VentilationsFraisLignes.AsNoTracking().Where(v => v.VflEntId == entId).OrderBy(v => v.VflId).ToListAsync(ct);
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
        await EcrireVentilations(db, entId, r, corr, ct);
    }

    /// <summary>
    /// Clés de ventilation (une ligne supprimée garde sa clé, orpheline, jusqu'à la validation) puis détail calculé,
    /// réécrit à chaque enregistrement.
    /// </summary>
    private static async Task EcrireVentilations(LogiBtpContext db, long entId, DocumentCompletBtp r, Correspondances corr, CancellationToken ct)
    {
        var cVentilations = corr.Complement(ComplementVentilations);
        long? Ligne(long? id) => id is long v ? corr.Lignes.GetValueOrDefault(v, v) : null;
        var existantes = await db.VentilationsFrais.Where(v => v.VfrEntId == entId).ToDictionaryAsync(v => v.VfrId, ct);
        var nouvelles = new List<(long Temp, VentilationFrais Entite)>();
        foreach (var v in r.Ventilations)
        {
            var copie = JsonCalcul.Cloner(v);
            copie.VfrEntId = entId;
            copie.VfrSourceLigId = Ligne(v.VfrSourceLigId);
            copie.VfrLigId = Ligne(v.VfrLigId);
            if (existantes.Remove(v.VfrId, out var entite))
            {
                db.Entry(entite).CurrentValues.SetValues(copie);
                cVentilations[v.VfrId] = v.VfrId;
            }
            else
            {
                copie.VfrId = 0;
                db.VentilationsFrais.Add(copie);
                nouvelles.Add((v.VfrId, copie));
            }
        }
        db.VentilationsFrais.RemoveRange(existantes.Values);
        db.VentilationsFraisLignes.RemoveRange(await db.VentilationsFraisLignes.Where(v => v.VflEntId == entId).ToListAsync(ct));
        await db.SaveChangesAsync(ct);
        foreach (var (temp, e) in nouvelles) cVentilations[temp] = e.VfrId;

        foreach (var v in r.VentilationsLignes)
        {
            if (!corr.Lignes.TryGetValue(v.VflSourceLigId, out var source) || !corr.Lignes.TryGetValue(v.VflLigId, out var ligne)) continue;
            db.VentilationsFraisLignes.Add(new VentilationFraisLigne
            {
                VflEntId = entId, VflSourceLigId = source, VflLigId = ligne, VflMontant = v.VflMontant,
                VflVfrId = v.VflVfrId is long k && cVentilations.TryGetValue(k, out var k2) ? k2 : null,
            });
        }
        await db.SaveChangesAsync(ct);
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
        // Frais annexes : les clés suivent leurs lignes (une clé orpheline n'est pas copiée).
        var vfr = new Dictionary<long, long>();
        var cles = new List<VentilationFrais>();
        foreach (var v in d.Ventilations)
        {
            if (v.VfrSourceLigId is long s && !lig.ContainsKey(s)) continue;
            if (v.VfrCible == "LIGNE" && (v.VfrLigId is not long l || !lig.ContainsKey(l))) continue;
            vfr[v.VfrId] = --n;
            v.VfrId = vfr[v.VfrId];
            v.VfrSourceLigId = Map(lig, v.VfrSourceLigId);
            v.VfrLigId = Map(lig, v.VfrLigId);
            cles.Add(v);
        }
        d.Ventilations = cles;
        d.VentilationsLignes = d.VentilationsLignes.Where(v => lig.ContainsKey(v.VflSourceLigId) && lig.ContainsKey(v.VflLigId)).ToList();
        foreach (var v in d.VentilationsLignes)
        {
            v.VflSourceLigId = lig[v.VflSourceLigId];
            v.VflLigId = lig[v.VflLigId];
            v.VflVfrId = Map(vfr, v.VflVfrId);
        }
    }

    public override void FiltrerComplements(DocumentCompletBtp c, ISet<long> lignes)
    {
        c.Metres = c.Metres.Where(m => lignes.Contains(m.MtrLigId)).ToList();
        var mids = c.Metres.Select(m => m.MtrId).ToHashSet();
        c.Variables = c.Variables.Where(v => (v.VarLigId is null || lignes.Contains(v.VarLigId.Value))
            && (v.VarMtrId is null || mids.Contains(v.VarMtrId.Value))).ToList();
        foreach (var l in c.Lignes.Where(l => l.LigMtrId is long m && !mids.Contains(m))) l.LigMtrId = null;
        // Transformation : la ventilation est figée en clés de ligne (prix unitaires conservés, quantités transformées).
        c.VentilationsLignes = c.VentilationsLignes.Where(v => lignes.Contains(v.VflSourceLigId) && lignes.Contains(v.VflLigId)).ToList();
        c.Ventilations = FigerVentilation(c.VentilationsLignes, c.Lignes, c.Document.EntId);
    }

    /// <summary>Plusieurs sources : métrés, variables, clés et détail de ventilation mis bout à bout (identifiants distincts).</summary>
    public override void FusionnerComplements(DocumentCompletBtp cible, DocumentCompletBtp ajout)
    {
        cible.Metres.AddRange(ajout.Metres);
        cible.Variables.AddRange(ajout.Variables);
        cible.Ventilations.AddRange(ajout.Ventilations);
        cible.VentilationsLignes.AddRange(ajout.VentilationsLignes);
    }

    /// <summary>
    /// Document créé depuis plusieurs sources : un rattachement (projet, affaire, chantier, marché) n'est gardé que s'il
    /// est commun à toutes (une facture fournisseur peut couvrir plusieurs chantiers).
    /// </summary>
    public override void PreparerEntetePlusieurs(DocumentBtp cible, IReadOnlyList<DocumentBtp> sources)
    {
        static T? Commun<T>(IEnumerable<T?> v) where T : struct => v.Distinct().Count() == 1 ? v.First() : null;
        cible.EntProjetId = Commun(sources.Select(s => s.EntProjetId));
        cible.EntAffaireId = Commun(sources.Select(s => s.EntAffaireId));
        cible.EntChantierId = Commun(sources.Select(s => s.EntChantierId));
        cible.EntMarcheId = Commun(sources.Select(s => s.EntMarcheId));
    }

    /// <summary>
    /// Une commande client d'un marché ne se transforme pas seule en BL, situation ou facture d'avancement : ces
    /// documents se créent depuis le marché, avec toutes ses commandes (CONCEPTION-ACHATS-MARCHES.md, Q19).
    /// </summary>
    public override void ControlerTransformation(DocumentCompletBtp source, TypeDocument typeSource, TypeDocument typeCible, bool depuisPlusieurs)
    {
        if (!depuisPlusieurs && typeSource.TydCode == "V_COMMANDE" && source.Document.EntMarcheId is not null
            && typeCible.TydCode is "V_RECEPTION" or "V_SITUATION" or "V_FACTURE_AVT")
        {
            throw LogiBTP.Socle.Web.ExceptionMetier.Invalide("MARCHE_CREATION", "Commande d'un marché : créez ce document depuis la fiche du marché (toutes ses commandes)");
        }
    }

    public override bool EstLigneCalculee(DocumentLigneBtp l) => l.LigIsEcartArrondi;

    public override void AjusterLigneTransformee(DocumentLigneBtp l)
    {
        l.LigQteSource = "S";
        l.LigCoefPerte = 1;
    }
}
