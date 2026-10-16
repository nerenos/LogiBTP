using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Metres;
using LogiBTP.Metres.Script;
using LogiBTP.Socle;
using static LogiBTP.Socle.ArrondiCalcul;

namespace LogiBTP.Calcul;

/// <summary>
/// Moteur de calcul d'un devis BTP (calcul définitif) : spécialise MoteurDocument (module Document) et
/// s'appuie sur le module Métré pour les métrés et les variables de calcul. Réplique exacte de
/// client/src/calcul/moteur-btp.js : toute règle modifiée l'est dans les deux, avec un cas dans tests/cas.
///
/// Ajouts BTP : variables ($$, $ titre, @@ ouvrage, @ ligne), métrés, coefficient de perte, déboursé
/// (PA × FG × bénéfice), ouvrages en mode déboursé (D), somme des PV (V) ou bordereau (B : PV fixe sans ventilation),
/// PV fixe et ventilation avec ligne d'écart d'arrondi, PV affiché fixe, ventilation des frais annexes (tranches F) par
/// portée et par clés, montants PA / PR.
/// Métrés en script (module Métré) : quantité renvoyée, erreurs non bloquantes (la quantité saisie est conservée),
/// libellé calculé ({{lig_libelle_html}} inscriptible), variables non locales régénérées à chaque calcul.
/// </summary>
public sealed partial class MoteurDevisBtp : MoteurDocument<DocumentBtp, DocumentLigneBtp>
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
    private readonly List<VariableDefinition> _definitions;
    private readonly Dictionary<long, List<VariableDefinition>> _variablesScript = [];
    private readonly Dictionary<long, string> _libellesScript = [];
    private readonly List<DiagnosticScript> _scripts = [];
    private long _prochainVarId;
    private long _prochainId;
    private decimal _coefFa = 1;
    // Frais annexes : clés saisies (ventilation_frais), coefficients par ligne, détail et bilan par tranche de frais.
    private readonly List<VentilationFrais> _ventilations;
    private readonly Dictionary<long, decimal> _coefsFa = [];
    private readonly Dictionary<long, decimal> _partsFa = [];
    private readonly List<VentilationFraisLigne> _ventilationsLignes = [];
    private readonly List<Bilan> _frais = [];
    private readonly Dictionary<long, decimal> _ecartsFaReels = [];

    private MoteurDevisBtp(EntreeCalcul e) : base(e)
    {
        _e = e;
        _mode = Doc.EntModeCalculOuvrage;
        _ventilations = e.Ventilations;
        // Variables des métrés : produites par leur script à chaque calcul, jamais évaluées comme définitions.
        var scripts = e.Metres.Select(m => m.MtrId).ToHashSet();
        _definitions = e.Variables.Where(v => v.VarMtrId is not long m || !scripts.Contains(m)).ToList();
        foreach (var v in e.Variables)
        {
            if (v.VarMtrId is not long m || !scripts.Contains(m)) continue;
            if (!_variablesScript.TryGetValue(m, out var liste)) _variablesScript[m] = liste = [];
            liste.Add(v);
        }
        _prochainVarId = Math.Min(0, e.Variables.Count == 0 ? 0 : e.Variables.Min(v => v.VarId)) - 1;
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
        foreach (var v in _definitions) v.VarValeur = null;
        _variables = Variables.Repartir(_definitions);
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
            if (metre is not null) EvaluerScript(l, metre);
            if (l.LigQteSource == "M")
            {
                if (metre is null) throw new ErreurCalcul("METRE_ABSENT", "La quantité est issue d'un métré absent");
                // Script sans résultat (sans « Renvoyer » ou en erreur) : la quantité saisie est conservée.
                return metre.MtrResultat ?? l.LigQte ?? 0;
            }
            return l.LigQte ?? 0;
        }
        finally
        {
            QteEnCours = null;
        }
    }

    /// <summary>Script du métré de la ligne : erreurs non bloquantes, libellé calculé, lignes de variables.</summary>
    private void EvaluerScript(DocumentLigneBtp l, Metre metre)
    {
        var r = ScriptMetre.Evaluer(metre, new ContexteScript
        {
            Resoudre = ResolveurScript(l), Ecrire = (reference, valeur) => EcrireScript(l, reference, valeur), Portees = _portees, LigneId = l.LigId,
        });
        foreach (var e in r.Erreurs) Erreur(l.LigId, e.Code, ScriptMetre.Message(e), false);
        if (r.Erreurs.Count > 0) _libellesScript.Remove(l.LigId);
        else if (r.Resultat is null && l.LigQteSource == "M")
        {
            Avertir(l.LigId, "METRE_SANS_RESULTAT", "Le métré ne renvoie pas de quantité (« Renvoyer » absent) : quantité saisie conservée");
        }
        _variablesScript[metre.MtrId] = ScriptMetre.LignesVariables(metre, r, _variablesScript.GetValueOrDefault(metre.MtrId) ?? [],
            Doc.EntId, () => _prochainVarId--);
        _scripts.Add(new DiagnosticScript(metre.MtrId, l.LigId, r.Resultat, r.Erreurs, r.Avertissements));
    }

    /// <summary>Lecture d'un script : variables et données typées ; {{lig_libelle_html}} = libellé courant (déjà écrit par le script).</summary>
    private Func<string, object?> ResolveurScript(DocumentLigneBtp l) => texte =>
    {
        var reference = References.Analyser(texte);
        if (reference is ReferenceVariable v) return LireVariable(v.Portee, v.Nom, l);
        var d = (ReferenceDonnee)reference;
        if (d.Table is null && d.Colonne == "lig_libelle_html") return _libellesScript.GetValueOrDefault(l.LigId) ?? l.LigLibelleHtml ?? "";
        return LireDonnee(d, l, PhaseCalcul.Calcul);
    };

    /// <summary>Écriture d'un script : seul le libellé de la ligne ({{lig_libelle_html}}), dans le libellé calculé.</summary>
    private void EcrireScript(DocumentLigneBtp l, string texte, object valeur)
    {
        if (References.Analyser(texte) is not ReferenceDonnee { Table: null, Colonne: "lig_libelle_html" })
        {
            throw new ErreurCalcul("ECRITURE_INTERDITE", $"{{{{{texte}}}}} ne peut pas être modifié par un métré (seul {{{{lig_libelle_html}}}} l'est)");
        }
        if (valeur is not string ecrit) throw new ErreurCalcul("TYPE", "Libellé : chaîne attendue");
        _libellesScript[l.LigId] = LibelleEcrit(_libellesScript.GetValueOrDefault(l.LigId) ?? l.LigLibelleHtml ?? "", ecrit);
    }

    /// <summary>
    /// Libellé écrit par un script : le texte ajouté avant ou après le libellé courant (HTML sûr) est échappé ; un texte
    /// qui ne le contient pas est échappé en entier (libelleEcrit côté JS).
    /// </summary>
    public static string LibelleEcrit(string avant, string ecrit)
    {
        if (ecrit.StartsWith(avant, StringComparison.Ordinal)) return avant + Libelles.EchapperHtml(ecrit[avant.Length..]);
        if (ecrit.EndsWith(avant, StringComparison.Ordinal)) return Libelles.EchapperHtml(ecrit[..^avant.Length]) + avant;
        return Libelles.EchapperHtml(ecrit);
    }

    protected override string? SourceLibelle(DocumentLigneBtp l) => _libellesScript.GetValueOrDefault(l.LigId) ?? base.SourceLibelle(l);

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

        // Bordereau (B) : prix unitaire imposé comme dans un BPU ; le sous-détail garde ses prix (PA, PR = sommes des
        // composantes), sans ventilation ni écart d'arrondi.
        if (_mode == "B")
        {
            x.Pv = pvFixe;
            return;
        }

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

    /// <summary>Lignes de prix vendues entrant dans le total (base du coefficient moyen de frais annexes).</summary>
    private List<DocumentLigneBtp> LignesDePrixEnTotal() =>
        Ordre.Where(l => !TL.EstPied(l) && EstLigneDePrix(l) && !HorsTotal(l) && !EnErreur.Contains(l.LigId) && Px.ContainsKey(l.LigId)).ToList();

    /// <summary>
    /// Coefficient de prorata de la ligne vendue (ligne de prix ; une composante d'ouvrage n'en a pas) : appliqué au
    /// prix affiché après les frais annexes, avant la remise.
    /// </summary>
    private decimal Prorata(DocumentLigneBtp l) => EstLigneDePrix(l) && !EstFraisAnnexes(l) ? l.LigCoefProrata : 1;

    /// <summary>PV affiché imposé hors prorata.</summary>
    private decimal AfficheHorsProrata(DocumentLigneBtp l) =>
        Prorata(l) == 1 ? l.LigPvAffiche!.Value : Arr6(l.LigPvAffiche!.Value / Prorata(l));

    /// <summary>
    /// Coefficient de frais annexes de la ligne : celui de sa ligne de prix (une composante suit son ouvrage, sauf en
    /// mode bordereau où les frais restent sur l'ouvrage) ; 1 pour les frais eux-mêmes.
    /// </summary>
    private decimal CoefFaDe(DocumentLigneBtp l)
    {
        if (EstFraisAnnexes(l)) return 1;
        DocumentLigneBtp? x = l;
        if (!EstLigneDePrix(l))
        {
            if (_mode == "B") return 1;
            while (x is not null && !EstLigneDePrix(x)) x = Parent(x);
            if (x is null) return 1;
        }
        return _coefsFa.GetValueOrDefault(x.LigId, 1);
    }

    /// <summary>Montant HT d'une ligne de frais annexes (PV remisé × quantité vendue).</summary>
    private decimal MontantFraisAnnexes(DocumentLigneBtp l)
    {
        var pvRem = Arrondir(PvAffiche(l, Px[l.LigId]) * l.LigCoefRemise, l.LigPrecisionPv);
        return Arrondir((l.LigQteVendue ?? 0) * pvRem, PrecMontant);
    }

    /// <summary>Type de prix effectif : le premier type non vendu de la ligne ou de ses ancêtres.</summary>
    private string TypePrixEffectif(DocumentLigneBtp l)
    {
        for (DocumentLigneBtp? x = l; x is not null; x = Parent(x)) if (x.LigTypePrix != "V") return x.LigTypePrix;
        return "V";
    }

    /// <summary>Tranche F de plus haut niveau contenant la ligne (null : la ligne n'est pas dans une tranche de frais annexes).</summary>
    private DocumentLigneBtp? UniteDe(DocumentLigneBtp l)
    {
        DocumentLigneBtp? u = null;
        for (DocumentLigneBtp? x = l; x is not null; x = Parent(x)) if (x.LigTylId == TL.Titre && x.LigTypePrix == "F") u = x;
        return u is not null && EstFraisAnnexes(l) ? u : null;
    }

    /// <summary>Feuilles chiffrées du sous-arbre d'une ligne de prix (la ligne elle-même si elle n'a pas de composante).</summary>
    private List<DocumentLigneBtp> FeuillesDe(DocumentLigneBtp l)
    {
        var enfants = EnfantsDe(l.LigId).Where(c => TL.EstChiffree(c)).ToList();
        return enfants.Count == 0 ? [l] : enfants.SelectMany(FeuillesDe).ToList();
    }

    /// <summary>Poids d'une feuille : quantité totale × PV (montant avant frais annexes, comme l'onglet Analyse).</summary>
    private decimal PoidsFeuille(DocumentLigneBtp x) => Px.TryGetValue(x.LigId, out var y) ? (x.LigQteTotale ?? 0) * y.Pv : 0;

    /// <summary>
    /// Clé d'un élément pour la ventilation des frais annexes : code (majuscules) et libellé saisi sans balises (minuscules,
    /// espaces réduits). Réplique de cleElementVentilation (moteur-btp.js).
    /// </summary>
    public static string CleElementVentilation(DocumentLigneBtp l, string? libelleHtml) =>
        $"{(l.LigCode ?? "").Trim().ToUpperInvariant()}|{Espaces().Replace(Libelles.TexteBrut(libelleHtml ?? "") ?? "", " ").Trim().ToLowerInvariant()}";

    [System.Text.RegularExpressions.GeneratedRegex(@"\s+")]
    private static partial System.Text.RegularExpressions.Regex Espaces();

    /// <summary>
    /// Répartit <paramref name="montant"/> au prorata des poids (parts égales si tous sont nuls), arrondi au montant ;
    /// la cible de plus fort poids (la première à égalité) absorbe l'écart d'arrondi.
    /// </summary>
    private List<decimal> RepartirMontant(decimal montant, IReadOnlyList<decimal> poids)
    {
        if (poids.Count == 0) return [];
        var w = poids.Sum();
        var parts = poids.Select(p => Arrondir(w == 0 ? montant / poids.Count : montant * p / w, PrecMontant)).ToList();
        var im = 0;
        for (var i = 1; i < poids.Count; i++) if (poids[i] > poids[im]) im = i;
        parts[im] += montant - parts.Sum();
        return parts;
    }

    private sealed class Bilan
    {
        public long LigId;
        public long? PorteeId;
        public decimal Prevu, Ventile;
        public bool Cles;
        public HashSet<long> Receptrices = [];
    }

    private sealed record Statut(DocumentLigneBtp L, decimal Base, char Role);

    /// <summary>
    /// Unités de frais annexes : tranches (titres) F de plus haut niveau. Leurs frais sont ventilés sur les lignes de prix
    /// de la tranche parente (portée), qui doit être dans une section ; une ligne cumule les parts de toutes ses portées.
    /// Clés (ventilation_frais) par priorité : ligne > élément > nature de l'unité > nature globale ; sans aucune clé,
    /// prorata du montant hors frais ; avec des clés, le reste n'est pas ventilé (FA_ECART). Lignes à PV affiché fixe
    /// exclues ; options / variantes (et pour mémoire) selon ent_fa_lignes, dans la base (ent_fa_mode B) ou au
    /// coefficient moyen des lignes vendues de la portée (C). Réplique de ventilerFraisAnnexes (moteur-btp.js).
    /// </summary>
    private void VentilerFraisAnnexes()
    {
        var pm = PrecMontant;
        var horsVente = Doc.EntFaLignes ?? "V";
        var modeBase = (Doc.EntFaMode ?? "C") == "B";
        void Ajouter(DocumentLigneBtp u, DocumentLigneBtp l, decimal montant, long? vfrId)
        {
            if (montant == 0) return;
            _ventilationsLignes.Add(new VentilationFraisLigne { VflSourceLigId = u.LigId, VflLigId = l.LigId, VflMontant = montant, VflVfrId = vfrId });
            _partsFa[l.LigId] = _partsFa.GetValueOrDefault(l.LigId) + montant;
        }

        foreach (var l in Ordre)
        {
            if (TL.EstPied(l) && l.LigPiedIsFa)
                Avertir(l.LigId, "FA_PIED", "Frais annexe de pied non ventilé : à remplacer par une tranche de frais annexes");
            if (!TL.EstPied(l) && EstLigneDePrix(l) && EstFraisAnnexes(l) && UniteDe(l) is null)
                Avertir(l.LigId, "FA_HORS_TRANCHE", "Ligne de frais annexes hors d'une tranche de frais annexes : non ventilée");
        }

        var unites = Ordre.Where(l => l.LigTylId == TL.Titre && UniteDe(l) == l).ToList();
        foreach (var u in unites)
        {
            var prevu = Ordre.Where(l => EstLigneDePrix(l) && DescendDe(l, u) && !EnErreur.Contains(l.LigId) && Px.ContainsKey(l.LigId))
                .Aggregate(0m, (s, l) => s + MontantFraisAnnexes(l));
            var portee = Parent(u);
            var bilan = new Bilan { LigId = u.LigId, PorteeId = portee?.LigId, Prevu = prevu };
            _frais.Add(bilan);
            var section = false;
            for (var x = portee; x is not null; x = Parent(x)) if (x.LigTylId == TL.Section) section = true;
            if (!section)
            {
                Avertir(u.LigId, "FA_HORS_SECTION", "Tranche de frais annexes hors d'une section : non ventilée");
                continue;
            }

            // Lignes de prix de la portée : réceptrices R (base), dérivées D (coefficient moyen, mode C) ou exclues X.
            var statut = new Dictionary<long, Statut>();
            var ordreStatut = new List<Statut>();
            foreach (var l in Ordre)
            {
                if (TL.EstPied(l) || !EstLigneDePrix(l) || !DescendDe(l, portee!) || EstFraisAnnexes(l) || l.LigIsEcartArrondi
                    || EnErreur.Contains(l.LigId) || !Px.ContainsKey(l.LigId)) continue;
                var bas = Arr6(Px[l.LigId].Pv * (l.LigQteVendue ?? 0));
                var type = TypePrixEffectif(l);
                var eligible = type == "V" || ((type == "O" || type == "A") && horsVente != "V") || (type == "M" && horsVente == "OAM");
                var role = !eligible || FixeDe(l) == Blocage.Affiche || bas <= 0 ? 'X' : type == "V" || modeBase ? 'R' : 'D';
                var s = new Statut(l, bas, role);
                statut[l.LigId] = s;
                ordreStatut.Add(s);
            }
            var receptrices = ordreStatut.Where(s => s.Role == 'R').ToList();
            bilan.Receptrices = receptrices.Select(s => s.L.LigId).ToHashSet();
            if (receptrices.Count == 0)
            {
                Avertir(u.LigId, "FA_SANS_RECEPTRICE", "Aucune ligne pour recevoir les frais annexes de la tranche");
                continue;
            }

            var cles = _ventilations.Where(k => k.VfrSourceLigId == u.LigId || (k.VfrSourceLigId is null && k.VfrCible == "NATURE")).ToList();
            bilan.Cles = cles.Count > 0;
            var couvertes = new HashSet<long>();
            if (!bilan.Cles)
            {
                var parts = RepartirMontant(prevu, receptrices.Select(s => s.Base).ToList());
                for (var i = 0; i < receptrices.Count; i++) Ajouter(u, receptrices[i].L, parts[i], null);
                bilan.Ventile = prevu;
            }
            else
            {
                // Clés en % : réparties ensemble pour que 100 % fassent exactement le montant prévu.
                var enPct = cles.Where(k => k.VfrMode == "P" && k.VfrValeur >= 0).ToList();
                var totalPct = enPct.Sum(k => k.VfrValeur);
                var partsPct = RepartirMontant(Arrondir(prevu * totalPct / 100, pm), enPct.Select(k => k.VfrValeur).ToList());
                var montantsPct = new Dictionary<VentilationFrais, decimal>(ReferenceEqualityComparer.Instance);
                for (var i = 0; i < enPct.Count; i++) montantsPct[enPct[i]] = partsPct[i];
                // Clé en montant : par unité de quantité pour une ligne, total pour un élément ou une nature.
                decimal? MontantCle(VentilationFrais k, DocumentLigneBtp? cible)
                {
                    if (k.VfrMode == "P") return montantsPct.TryGetValue(k, out var m) ? m : null;
                    if (k.VfrValeur < 0) return null;
                    return Arrondir(cible is null ? k.VfrValeur : k.VfrValeur * (cible.LigQteVendue ?? 0), pm);
                }

                // 1. Clés de ligne.
                var niveauLigne = new List<long>();
                foreach (var k in cles.Where(x => x.VfrCible == "LIGNE" && x.VfrSourceLigId == u.LigId))
                {
                    if (k.VfrLigId is not long kl || !statut.TryGetValue(kl, out var s))
                    {
                        Avertir(u.LigId, "FA_CLE_ORPHELINE", $"Clé de ventilation sur une ligne absente de la portée ({k.VfrLigId})");
                        continue;
                    }
                    if (s.Role == 'X')
                    {
                        Avertir(u.LigId, "FA_CLE_BLOQUEE", $"Clé de ventilation sur une ligne qui ne reçoit pas de frais ({k.VfrLigId})");
                        continue;
                    }
                    if (MontantCle(k, s.L) is not decimal montant)
                    {
                        Avertir(u.LigId, "FA_CLE_ORPHELINE", "Clé de ventilation de valeur invalide");
                        continue;
                    }
                    niveauLigne.Add(s.L.LigId);
                    Ajouter(u, s.L, montant, k.VfrId);
                    if (s.Role == 'R') bilan.Ventile += montant;
                }
                foreach (var id in niveauLigne) couvertes.Add(id);

                // 2. Éléments, 3. natures de l'unité, 4. natures globales : au prorata des feuilles visées des lignes non couvertes.
                var niveaux = new[]
                {
                    cles.Where(x => x.VfrCible == "ELEMENT" && x.VfrSourceLigId == u.LigId).ToList(),
                    cles.Where(x => x.VfrCible == "NATURE" && x.VfrSourceLigId == u.LigId).ToList(),
                    cles.Where(x => x.VfrCible == "NATURE" && x.VfrSourceLigId is null).ToList(),
                };
                foreach (var niveau in niveaux)
                {
                    var vues = new List<long>();
                    foreach (var k in niveau)
                    {
                        Func<DocumentLigneBtp, bool> vise = k.VfrCible == "ELEMENT"
                            ? x => x.LigTylId == TL.Element && !x.LigIsEcartArrondi && CleElementVentilation(x, SourceLibelle(x)) == k.VfrElement
                            : x => !x.LigIsEcartArrondi && x.LigNatId is not null && x.LigNatId == k.VfrNatId;
                        var cibles = new List<(DocumentLigneBtp L, decimal W)>();
                        foreach (var s in receptrices)
                        {
                            if (couvertes.Contains(s.L.LigId)) continue;
                            var w = FeuillesDe(s.L).Where(vise).Aggregate(0m, (t, x) => t + PoidsFeuille(x));
                            if (w > 0) cibles.Add((s.L, w));
                        }
                        if (cibles.Count == 0)
                        {
                            Avertir(u.LigId, "FA_CLE_ORPHELINE", $"Clé de ventilation sans ligne visée ({(k.VfrCible == "ELEMENT" ? k.VfrElement : $"nature {k.VfrNatId}")})");
                            continue;
                        }
                        if (MontantCle(k, null) is not decimal montant)
                        {
                            Avertir(u.LigId, "FA_CLE_ORPHELINE", "Clé de ventilation de valeur invalide");
                            continue;
                        }
                        var parts = RepartirMontant(montant, cibles.Select(c => c.W).ToList());
                        for (var i = 0; i < cibles.Count; i++)
                        {
                            Ajouter(u, cibles[i].L, parts[i], k.VfrId);
                            vues.Add(cibles[i].L.LigId);
                        }
                        bilan.Ventile += montant;
                    }
                    foreach (var id in vues) couvertes.Add(id);
                }
                if (bilan.Ventile != prevu) Avertir(u.LigId, "FA_ECART", $"Frais annexes ventilés {Texte(bilan.Ventile)} pour {Texte(prevu)} prévus");
            }

            // Mode C : options et variantes reçoivent le coefficient moyen des lignes vendues de la portée.
            var baseR = receptrices.Sum(x => x.Base);
            foreach (var s in ordreStatut)
            {
                if (s.Role != 'D' || couvertes.Contains(s.L.LigId) || baseR == 0) continue;
                Ajouter(u, s.L, Arrondir(s.Base * bilan.Ventile / baseR, pm), null);
            }
        }

        // Coefficient de chaque ligne qui reçoit des frais : 1 + parts / montant hors frais.
        foreach (var (id, part) in _partsFa)
        {
            var l = ParId[id];
            var bas = Px[id].Pv * (l.LigQteVendue ?? 0);
            if (bas != 0) _coefsFa[id] = Arr6(1 + part / bas);
        }
    }

    private static string Texte(decimal v) => v.ToString(System.Globalization.CultureInfo.InvariantCulture);

    protected override void ApresPrix()
    {
        // PV affiché fixe : prix imposé hors frais annexes (la ligne ne reçoit pas de frais).
        foreach (var l in Ordre)
        {
            if (FixeDe(l) != Blocage.Affiche || !Px.ContainsKey(l.LigId)) continue;
            var y = PxBtp(l.LigId);
            var pvFixe = AfficheHorsProrata(l);
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
        VentilerFraisAnnexes();

        // Coefficient moyen du document (information) : lignes vendues.
        decimal bas = 0, avec = 0;
        foreach (var l in LignesDePrixEnTotal())
        {
            var b = Px[l.LigId].Pv * (l.LigQteVendue ?? 0);
            bas += b;
            avec += b + _partsFa.GetValueOrDefault(l.LigId);
        }
        _coefFa = bas == 0 ? 1 : Arr6(avec / bas);
    }

    /// <summary>
    /// Bilan par tranche de frais annexes : prévu, ventilé (clés), ventilé réel (montants HT après arrondi du PV, la
    /// différence de chaque ligne répartie entre ses tranches au prorata de leurs parts) et écart = prévu − ventilé.
    /// </summary>
    private List<BilanFraisAnnexes> BilanFrais() => _frais.Select(b =>
    {
        decimal reel = 0;
        foreach (var v in _ventilationsLignes)
        {
            if (v.VflSourceLigId != b.LigId || !b.Receptrices.Contains(v.VflLigId)) continue;
            var total = _partsFa.GetValueOrDefault(v.VflLigId);
            if (total == 0 || !_ecartsFaReels.TryGetValue(v.VflLigId, out var diff)) continue;
            reel += diff * v.VflMontant / total;
        }
        return new BilanFraisAnnexes(b.LigId, b.PorteeId, b.Cles, b.Prevu, b.Ventile, Arrondir(reel, PrecMontant), b.Prevu - b.Ventile);
    }).ToList();

    // ------------------------------------------------------------------ montants, totaux, pied

    protected override void ViderMontants(DocumentLigneBtp l)
    {
        base.ViderMontants(l);
        l.LigPr = l.LigPvAffiche = l.LigMontantPa = l.LigMontantPr = null;
    }

    protected override decimal PvAffiche(DocumentLigneBtp l, Prix y) =>
        FixeDe(l) == Blocage.Affiche ? l.LigPvAffiche!.Value : Arrondir(y.Pv * CoefFaDe(l) * Prorata(l), l.LigPrecisionPv);

    protected override void EcrireMontants(DocumentLigneBtp l, Prix prix, decimal pvAff, decimal pvRem, decimal qv)
    {
        base.EcrireMontants(l, prix, pvAff, pvRem, qv);
        var y = (PrixBtp)prix;
        l.LigPa = y.Pa;
        l.LigPr = y.Pr;
        if (y.CoefFg is decimal fg) l.LigCoefFg = fg;
        if (y.CoefBenef is decimal bn) l.LigCoefBenef = bn;
        l.LigCoefFa = CoefFaDe(l);
        l.LigPvAffiche = pvAff;
        l.LigMontantPa = Arrondir(qv * y.Pa, PrecMontant);
        l.LigMontantPr = Arrondir(qv * y.Pr, PrecMontant);
        if (_pvVentiles.Contains(l.LigId)) l.LigPvFixe = true;
        // Frais réellement ventilés (après arrondi du PV) : montant HT avec frais − montant HT sans frais.
        if (_partsFa.ContainsKey(l.LigId))
        {
            var sans = Arrondir(Arrondir(y.Pv * Prorata(l), l.LigPrecisionPv) * l.LigCoefRemise, l.LigPrecisionPv);
            _ecartsFaReels[l.LigId] = l.LigMontantHt!.Value - Arrondir(qv * sans, PrecMontant);
        }
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
        r.Variables = [.. _definitions, .. _variablesScript.Values.SelectMany(v => v)];
        r.Scripts = _scripts;
        r.LignesSupprimees = _ecartsExistants.Values.Select(l => l.LigId).ToList();
        r.Ventilations = _ventilations;
        r.VentilationsLignes = _ventilationsLignes;
        r.FraisAnnexes = BilanFrais();
        return r;
    }
}
