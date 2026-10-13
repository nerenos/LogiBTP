using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Metres;
using LogiBTP.Socle;
using static LogiBTP.Socle.ArrondiCalcul;

namespace LogiBTP.Calcul;

/// <summary>
/// Moteur de calcul d'un devis BTP (calcul définitif) : spécialise MoteurDocument (module Document) et
/// s'appuie sur le module Métré pour les métrés et les variables de calcul. Réplique exacte de
/// client/src/calcul/moteur-btp.js : toute règle modifiée l'est dans les deux, avec un cas dans tests/cas.
///
/// Ajouts BTP : variables ($$, $ titre, @@ ouvrage, @ ligne), métrés, coefficient de perte, déboursé
/// (PA × FG × bénéfice), ouvrages en mode déboursé (D) ou somme des PV (V), PV fixe et ventilation avec
/// ligne d'écart d'arrondi, PV affiché fixe et coefficient de frais annexes, montants PA / PR.
/// </summary>
public sealed class MoteurDevisBtp : MoteurDocument<DocumentBtp, DocumentLigneBtp>
{
    /// <summary>Calcule un devis BTP. L'entrée n'est pas modifiée.</summary>
    public static ResultatCalcul Calculer(EntreeCalcul entree) =>
        (ResultatCalcul)new MoteurDevisBtp(JsonCalcul.Cloner(entree)).Executer();

    private sealed class PrixBtp : Prix
    {
        public decimal Pa, Pr, PvNat;
        public decimal? CoefFg, CoefBenef;
    }

    private enum Blocage { Aucun, Pv, Affiche }

    private static readonly HashSet<string> PrixCalculesBtp =
    [
        "lig_pv_remise", "lig_montant_ht", "lig_montant_tva", "lig_base_calcul",
        "ent_total_ht", "ent_total_tva", "ent_total_ttc", "ent_net_a_payer",
        "lig_pr", "lig_pv", "lig_pv_affiche", "lig_coef_fa", "lig_montant_pa", "lig_montant_pr", "ent_coef_fa",
    ];

    private static readonly HashSet<string> QuantitesCalculeesBtp = ["lig_qte_vendue", "lig_qte_totale", "lig_qte_base"];

    private readonly EntreeCalcul _e;
    private readonly string _mode;
    private readonly Dictionary<long, DocumentLigneBtp> _ecartsExistants = [];
    private readonly Dictionary<long, DocumentLigneBtp> _ecartsCrees = [];
    private readonly Dictionary<long, Blocage> _fixe = [];
    private readonly HashSet<long> _pvVentiles = [];
    private readonly Dictionary<long, Metre?> _metreDeLigne = [];
    private readonly Portees _portees;
    private RepartitionVariables _variables = new([], [], []);
    private long _prochainId;
    private decimal _coefFa = 1;

    private MoteurDevisBtp(EntreeCalcul e) : base(e)
    {
        _e = e;
        _mode = Doc.EntModeCalculOuvrage;
        // $ : titres englobants (la ligne elle-même si c'est un titre) ; @@ : ouvrages englobants.
        _portees = new Portees(ChainePortee, p => p switch
        {
            "$" => "Aucun titre parent pour une variable $",
            "@@" => "Aucun ouvrage parent pour une variable @@",
            _ => $"Portée inconnue {p}",
        });
    }

    private IReadOnlyList<long> ChainePortee(string portee, long? ligneId)
    {
        short? type = portee switch { "$" => TL.Titre, "@@" => TL.Ouvrage, _ => null };
        var res = new List<long>();
        if (type is null || ligneId is not long id || !ParId.TryGetValue(id, out var depart)) return res;
        for (var x = depart; x is not null; x = Parent(x)) if (x.LigTylId == type) res.Add(x.LigId);
        return res;
    }

    /// <summary>Les lignes d'écart d'arrondi sont supprimées puis recréées si nécessaire (section 10).</summary>
    protected override List<DocumentLigneBtp> PreparerLignes(List<DocumentLigneBtp> lignes)
    {
        _prochainId = Math.Min(0, lignes.Count == 0 ? 0 : lignes.Min(l => l.LigId)) - 1;
        var res = new List<DocumentLigneBtp>();
        foreach (var l in lignes)
        {
            if (l.LigIsEcartArrondi && l.LigParentId is long p) _ecartsExistants[p] = l;
            else if (!l.LigIsEcartArrondi) res.Add(l);
        }
        return res;
    }

    protected override IReadOnlySet<string> PrixCalcules => PrixCalculesBtp;
    protected override IReadOnlySet<string> QuantitesCalculees => QuantitesCalculeesBtp;

    protected override List<DocumentLigneBtp> Composantes(DocumentLigneBtp ouvrage) =>
        base.Composantes(ouvrage).Where(c => !c.LigIsEcartArrondi).ToList();

    protected override bool EstNumerotee(DocumentLigneBtp l) => base.EstNumerotee(l) && !l.LigIsEcartArrondi;

    protected override decimal LireVariable(string portee, string nom, DocumentLigneBtp? ligne) => _portees.Lire(portee, nom, ligne?.LigId);

    // ------------------------------------------------------------------ validation : blocages de prix

    protected override void ValiderLigne(DocumentLigneBtp l)
    {
        var fixe = Blocage.Aucun;
        if (l.LigPvFixe) fixe = Blocage.Pv;
        if (l.LigPvAfficheFixe)
        {
            if (fixe != Blocage.Aucun) Erreur(l.LigId, "BLOCAGES_EXCLUSIFS", "PV fixe et PV affiché fixe sont exclusifs : seul le PV fixe est retenu", false);
            else if (!EstLigneDePrix(l)) Erreur(l.LigId, "PV_AFFICHE_FIXE", "Le PV affiché fixe est réservé aux lignes de prix", false);
            else fixe = Blocage.Affiche;
        }
        if (fixe == Blocage.Pv && l.LigPv is null) { Avertir(l.LigId, "PV_FIXE_VIDE", "PV fixe sans valeur : blocage ignoré"); fixe = Blocage.Aucun; }
        if (fixe == Blocage.Affiche && l.LigPvAffiche is null) { Avertir(l.LigId, "PV_FIXE_VIDE", "PV affiché fixe sans valeur : blocage ignoré"); fixe = Blocage.Aucun; }
        if (fixe != Blocage.Aucun && l.LigTylId == TL.Ouvrage && EnfantsDe(l.LigId).Count == 0)
        {
            Erreur(l.LigId, "OUVRAGE_SANS_COMPOSANTE",
                "Prix fixe interdit sur un ouvrage sans composante : ajoutez des composantes ou transformez la ligne en élément", false);
            fixe = Blocage.Aucun;
        }
        if (fixe != Blocage.Aucun && TL.EstChiffree(l)) _fixe[l.LigId] = fixe;
    }

    private Blocage FixeDe(DocumentLigneBtp l) => _fixe.GetValueOrDefault(l.LigId, Blocage.Aucun);

    // ------------------------------------------------------------------ passe 1 : variables, métrés, quantités

    private void EvaluerVariable(VariableDefinition v, DocumentLigneBtp? ligne) =>
        Variables.Evaluer(v, Resolveur(ligne, PhaseCalcul.Calcul), _portees, ligne?.LigId);

    protected override void AvantQuantites()
    {
        foreach (var v in _e.Variables) v.VarValeur = null;
        _variables = Variables.Repartir(_e.Variables);
        foreach (var v in _variables.Document)
        {
            try { EvaluerVariable(v, null); }
            catch (ErreurCalcul e) { Erreur(null, e.Code, e.Message); }
        }
    }

    protected override decimal QuantiteBase(DocumentLigneBtp l)
    {
        l.LigQteBase = null;
        var metre = l.LigMtrId is long mid ? _e.Metres.FirstOrDefault(m => m.MtrId == mid) : null;
        _metreDeLigne[l.LigId] = metre;
        QteEnCours = l;
        try
        {
            if (metre is not null)
            {
                new EvaluateurMetre(Resolveur(l, PhaseCalcul.Calcul), (portee, nom, valeur) => _portees.Affecter(portee, nom, "=", valeur, l.LigId))
                    .Evaluer(metre, _e.MetreLignes);
            }
            if (l.LigQteSource == "M")
            {
                if (metre is null) throw new ErreurCalcul("METRE_ABSENT", "La quantité est issue d'un métré absent");
                return metre.MtrResultat ?? 0;
            }
            return l.LigQte ?? 0;
        }
        finally
        {
            QteEnCours = null;
        }
    }

    protected override decimal QuantiteVendue(DocumentLigneBtp l, decimal qteBase) => Arrondir(qteBase * l.LigCoefPerte, l.LigPrecisionQte);

    protected override void EcrireQuantites(DocumentLigneBtp l, decimal qteBase, decimal qv, decimal totale)
    {
        l.LigQteBase = Arr6(qteBase);
        base.EcrireQuantites(l, qteBase, qv, totale);
    }

    protected override void ApresLigne(DocumentLigneBtp l)
    {
        // Variables de l'onglet Définition du métré : sorties du métré, évaluées après ses lignes et après
        // la quantité (elles peuvent lire le résultat, les variables du métré et lig_qte_vendue).
        if (TL.EstChiffree(l) && _metreDeLigne.GetValueOrDefault(l.LigId) is { } metre)
        {
            foreach (var v in _variables.ParMetre.GetValueOrDefault(metre.MtrId) ?? []) EvaluerVariable(v, l);
        }
        foreach (var v in _variables.ParLigne.GetValueOrDefault(l.LigId) ?? []) EvaluerVariable(v, l);
    }

    // ------------------------------------------------------------------ passe 2 : prix, PV fixes

    private PrixBtp PxBtp(long id) => (PrixBtp)Px[id];

    protected override void PrixLigne(DocumentLigneBtp l)
    {
        var fixe = FixeDe(l);
        if (!EstCompose(l))
        {
            PrixElement(l, fixe);
            return;
        }
        decimal pa = 0, pr = 0, pv = 0, pvNat = 0;
        foreach (var c in Composantes(l))
        {
            if (!Px.TryGetValue(c.LigId, out var p)) continue;
            var x = (PrixBtp)p;
            var q = Qu(c, l);
            pa += q * x.Pa;
            pr += q * x.Pr;
            pv += q * x.Pv;
            pvNat += q * x.PvNat;
        }
        PrixBtp res;
        if (_mode == "D")
        {
            pa = Arr6(pa);
            var prD = Arr6(pa * l.LigCoefFg);
            var pvD = Arr6(prD * l.LigCoefBenef);
            res = new PrixBtp { Pa = pa, Pr = prD, Pv = pvD, PvNat = pvD, CoefFg = l.LigCoefFg, CoefBenef = l.LigCoefBenef };
        }
        else
        {
            res = new PrixBtp { Pa = Arr6(pa), Pr = Arr6(pr), Pv = Arr6(pv), PvNat = Arr6(pvNat) };
        }
        Px[l.LigId] = res;
        if (fixe == Blocage.Pv) Ventiler(l, l.LigPv!.Value);
    }

    private void PrixElement(DocumentLigneBtp l, Blocage fixe)
    {
        decimal fg = l.LigCoefFg, bn = l.LigCoefBenef;
        var pa = l.LigPa;
        if (fixe == Blocage.Pv)
        {
            var pvFixe = l.LigPv!.Value;
            if (pa is null || pa == 0)
            {
                // Prix non défini : PA = PR = PV = prix fixe, coefficients à 1.
                Px[l.LigId] = new PrixBtp { Pa = pvFixe, Pr = pvFixe, Pv = pvFixe, PvNat = pvFixe, CoefFg = 1, CoefBenef = 1 };
            }
            else
            {
                var prF = Arr6(pa.Value * fg);
                Px[l.LigId] = new PrixBtp
                {
                    Pa = pa.Value, Pr = prF, Pv = pvFixe, PvNat = Arr6(prF * bn), CoefFg = fg,
                    CoefBenef = prF == 0 ? bn : Arr6(pvFixe / prF),
                };
            }
            return;
        }
        var pr = Arr6((pa ?? 0) * fg);
        var pv = Arr6(pr * bn);
        Px[l.LigId] = new PrixBtp { Pa = pa ?? 0, Pr = pr, Pv = pv, PvNat = pv, CoefFg = fg, CoefBenef = bn };
    }

    private void SupprimerEcartCree(DocumentLigneBtp ouvrage)
    {
        if (!_ecartsCrees.Remove(ouvrage.LigId, out var e)) return;
        _ecartsExistants[ouvrage.LigId] = e;
        Lignes.Remove(e);
        ParId.Remove(e.LigId);
        EnfantsDe(ouvrage.LigId).Remove(e);
        Px.Remove(e.LigId);
    }

    /// <summary>Répartit un PV fixe sur l'ouvrage (section 10). Le PV de l'ouvrage reste la valeur fixe.</summary>
    private void Ventiler(DocumentLigneBtp ouvrage, decimal pvFixe)
    {
        var x = PxBtp(ouvrage.LigId);
        SupprimerEcartCree(ouvrage);

        if (_mode == "D")
        {
            if (x.Pr == 0)
            {
                x.Pa = x.Pr = x.Pv = pvFixe;
                x.CoefFg = x.CoefBenef = 1;
            }
            else
            {
                x.CoefBenef = Arr6(pvFixe / x.Pr);
                x.Pv = pvFixe;
            }
            return;
        }

        var comps = Composantes(ouvrage).Where(c => Px.ContainsKey(c.LigId)).ToList();
        var qus = comps.Select(c => Qu(c, ouvrage)).ToList();
        var contribs = comps.Select((c, i) => qus[i] * PxBtp(c.LigId).PvNat).ToList();
        var somme = contribs.Sum();
        DocumentLigneBtp? principale = null;

        if (somme != 0)
        {
            var k = pvFixe / somme;
            var pvs = comps.Select(c => Arrondir(PxBtp(c.LigId).PvNat * k, c.LigPrecisionPv)).ToList();
            var im = 0;
            for (var i = 1; i < contribs.Count; i++) if (contribs[i] > contribs[im]) im = i;
            principale = comps[im];
            decimal total = 0;
            for (var i = 0; i < comps.Count; i++) total += qus[i] * pvs[i];
            var ecart = pvFixe - total;
            if (qus[im] != 0) pvs[im] = Arrondir(pvs[im] + ecart / qus[im], principale.LigPrecisionPv);
            for (var i = 0; i < comps.Count; i++) AppliquerPvVentile(comps[i], pvs[i]);
        }

        decimal pa = 0, pr = 0, tot = 0;
        for (var i = 0; i < comps.Count; i++)
        {
            var y = PxBtp(comps[i].LigId);
            pa += qus[i] * y.Pa;
            pr += qus[i] * y.Pr;
            tot += qus[i] * y.Pv;
        }
        var residu = Arr6(pvFixe - tot);
        if (residu != 0)
        {
            CreerEcart(ouvrage, residu, principale);
            pa += residu;
            pr += residu;
        }
        x.Pa = Arr6(pa);
        x.Pr = Arr6(pr);
        x.Pv = pvFixe;
    }

    private void AppliquerPvVentile(DocumentLigneBtp c, decimal pv)
    {
        var y = PxBtp(c.LigId);
        _pvVentiles.Add(c.LigId);
        if (EstCompose(c))
        {
            y.Pv = pv;
            Ventiler(c, pv);
            return;
        }
        if (y.Pr == 0)
        {
            // Composante sans déboursé : PA = PR = PV, coefficients à 1.
            if (pv != 0)
            {
                y.Pa = y.Pr = pv;
                y.CoefFg = y.CoefBenef = 1;
            }
            y.Pv = pv;
            return;
        }
        y.Pv = pv;
        y.CoefBenef = Arr6(pv / y.Pr);
    }

    private void CreerEcart(DocumentLigneBtp ouvrage, decimal residu, DocumentLigneBtp? principale)
    {
        _ecartsExistants.Remove(ouvrage.LigId, out var existant);
        var id = existant?.LigId ?? _prochainId--;
        var reference = principale ?? EnfantsDe(ouvrage.LigId).FirstOrDefault();
        var typeQte = principale is not null ? principale.LigQteType ?? "R" : "R";
        // Quantité 1 en relatif, quantité de l'ouvrage en absolu : dans les deux cas une unité par unité d'ouvrage.
        var qte = typeQte == "A" ? ouvrage.LigQteVendue ?? 0 : 1m;
        var enfants = EnfantsDe(ouvrage.LigId);
        var l = new DocumentLigneBtp
        {
            LigId = id,
            LigEntId = ouvrage.LigEntId,
            LigParentId = ouvrage.LigId,
            LigOrdre = (enfants.Count == 0 ? 0 : Math.Max(0, enfants.Max(c => c.LigOrdre))) + 1,
            LigTylId = TL.Element,
            LigLibelleHtml = "Ajustement d'arrondi",
            LigNatId = reference?.LigNatId,
            LigPtvId = reference?.LigPtvId,
            LigQte = qte,
            LigQteType = typeQte,
            LigQteSource = "S",
            LigQteBase = qte,
            LigCoefPerte = 1,
            LigQteVendue = qte,
            LigQteTotale = Arr6(ouvrage.LigQteTotale ?? 0),
            LigPrecisionQte = 6,
            LigPa = residu,
            LigPr = residu,
            LigPv = residu,
            LigPrecisionPv = 6,
            LigTypePrix = ouvrage.LigTypePrix,
            LigIsEcartArrondi = true,
            LigIsNonEditee = true,
        };
        Lignes.Add(l);
        ParId[id] = l;
        ListeEnfants(ouvrage.LigId).Add(l);
        _ecartsCrees[ouvrage.LigId] = l;
        Px[id] = new PrixBtp { Pa = residu, Pr = residu, Pv = residu, PvNat = residu, CoefFg = 1, CoefBenef = 1 };
        Traitees.Add(id);
    }

    // ------------------------------------------------------------------ après les prix : frais annexes

    private List<DocumentLigneBtp> LignesDePrixEnTotal() =>
        Ordre.Where(l => !TL.EstPied(l) && EstLigneDePrix(l) && !HorsTotal(l) && !EnErreur.Contains(l.LigId) && Px.ContainsKey(l.LigId)).ToList();

    protected override void ApresPrix()
    {
        decimal f = 0, a = 0, p = 0;
        foreach (var l in LignesDePrixEnTotal())
        {
            var qv = l.LigQteVendue ?? 0;
            if (FixeDe(l) == Blocage.Affiche) a += l.LigPvAffiche!.Value * qv;
            else f += Px[l.LigId].Pv * qv;
        }
        foreach (var pied in EnfantsDe(null))
        {
            if (!TL.EstPied(pied) || pied.LigTylId == TL.Tva || !pied.LigPiedIsFa || pied.LigTypePrix != "V") continue;
            if ((pied.LigPiedMode ?? "M") != "M")
            {
                Erreur(pied.LigId, "FA_POURCENTAGE", "Un frais annexe ventilé doit être saisi en montant", false);
                continue;
            }
            p += Arrondir(pied.LigPiedValeur ?? 0, PrecMontant) * (pied.LigPiedSens == -1 ? -1 : 1);
        }

        decimal c = 1;
        if (p != 0)
        {
            if (f > 0)
            {
                // Racine positive de F·c² − (F + P − A)·c − A = 0.
                var b = f + p - a;
                c = Arr6((b + Racine(b * b + 4 * f * a)) / (2 * f));
            }
            else if (a > p) c = Arr6(a / (a - p));
            else Erreur(null, "FRAIS_ANNEXES", "Les frais annexes doivent rester inférieurs à la somme des prix affichés fixes");
        }
        _coefFa = c;

        foreach (var l in Ordre)
        {
            if (FixeDe(l) != Blocage.Affiche || !Px.ContainsKey(l.LigId)) continue;
            var y = PxBtp(l.LigId);
            var pvFixe = Arr6(l.LigPvAffiche!.Value / c);
            if (EstCompose(l))
            {
                y.Pv = pvFixe;
                Ventiler(l, pvFixe);
            }
            else if (y.Pr == 0)
            {
                y.Pa = y.Pr = y.Pv = pvFixe;
                y.CoefFg = y.CoefBenef = 1;
            }
            else
            {
                y.Pv = pvFixe;
                y.CoefBenef = Arr6(pvFixe / y.Pr);
            }
        }
        ReconstruireOrdre();
    }

    // ------------------------------------------------------------------ montants, totaux, pied

    protected override void ViderMontants(DocumentLigneBtp l)
    {
        base.ViderMontants(l);
        l.LigPr = l.LigPvAffiche = l.LigMontantPa = l.LigMontantPr = null;
    }

    protected override decimal PvAffiche(DocumentLigneBtp l, Prix y) =>
        FixeDe(l) == Blocage.Affiche ? l.LigPvAffiche!.Value : Arrondir(y.Pv * _coefFa, l.LigPrecisionPv);

    protected override void EcrireMontants(DocumentLigneBtp l, Prix prix, decimal pvAff, decimal pvRem, decimal qv)
    {
        base.EcrireMontants(l, prix, pvAff, pvRem, qv);
        var y = (PrixBtp)prix;
        l.LigPa = y.Pa;
        l.LigPr = y.Pr;
        if (y.CoefFg is decimal fg) l.LigCoefFg = fg;
        if (y.CoefBenef is decimal bn) l.LigCoefBenef = bn;
        l.LigCoefFa = _coefFa;
        l.LigPvAffiche = pvAff;
        l.LigMontantPa = Arrondir(qv * y.Pa, PrecMontant);
        l.LigMontantPr = Arrondir(qv * y.Pr, PrecMontant);
        if (_pvVentiles.Contains(l.LigId)) l.LigPvFixe = true;
    }

    protected override void EcrireSomme(DocumentLigneBtp cible, IReadOnlyList<DocumentLigneBtp> lignes)
    {
        base.EcrireSomme(cible, lignes);
        cible.LigMontantPa = lignes.Sum(l => l.LigMontantPa ?? 0);
        cible.LigMontantPr = lignes.Sum(l => l.LigMontantPr ?? 0);
    }

    /// <summary>Sous-total de pied : le cumul HT ; déboursé et revient sans objet (comme champsCumules en JS).</summary>
    protected override void EcrireSousTotalPied(DocumentLigneBtp l, decimal cumul)
    {
        base.EcrireSousTotalPied(l, cumul);
        l.LigMontantPa = null;
        l.LigMontantPr = null;
    }

    /// <summary>Frais annexe déjà ventilé dans les prix, ou poste pour mémoire : affiché, hors cumul.</summary>
    protected override bool HorsCumulPied(DocumentLigneBtp p) => p.LigPiedIsFa || base.HorsCumulPied(p);

    protected override void EcrireTotaux(VentilationTva tva, decimal cumul)
    {
        Doc.EntCoefFa = _coefFa;
        base.EcrireTotaux(tva, cumul);
    }

    protected override ResultatDocument<DocumentBtp, DocumentLigneBtp> CreerResultat()
    {
        var r = Remplir(new ResultatCalcul());
        r.Metres = _e.Metres;
        r.MetreLignes = _e.MetreLignes;
        r.Variables = _e.Variables;
        r.LignesSupprimees = _ecartsExistants.Values.Select(l => l.LigId).ToList();
        return r;
    }
}
