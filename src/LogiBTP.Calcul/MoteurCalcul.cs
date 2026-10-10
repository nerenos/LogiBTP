using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using LogiBTP.Domaine;
using static LogiBTP.Calcul.ArrondiCalcul;

namespace LogiBTP.Calcul;

public enum PhaseCalcul { Calcul, Libelle }

/// <summary>
/// Moteur de calcul C# (calcul définitif). Réplique exacte de client/src/calcul/moteur.js :
/// toute modification de règle doit être faite dans les deux moteurs et couverte par tests/cas.
/// Fonction pure, sans accès à la base (section 13 de l'analyse).
/// </summary>
public sealed partial class MoteurCalcul
{
    public const string Version = "0.1.0";
    private const long Racine = long.MinValue;

    /// <summary>Calcule un document. L'entrée n'est pas modifiée.</summary>
    public static ResultatCalcul Calculer(EntreeCalcul entree) => new MoteurCalcul(JsonCalcul.Cloner(entree)).Executer();

    private sealed class Prix
    {
        public decimal Pa, Pr, Pv, PvNat;
        public decimal? CoefFg, CoefBenef;
    }

    private enum Blocage { Aucun, Pv, Affiche }

    internal Document Document { get; }
    internal List<MetreLigne> MetreLignes { get; }
    internal Portees Portees { get; }

    private readonly EntreeCalcul _e;
    private readonly Dictionary<int, TauxTva> _tauxTva;
    private readonly int _precMontant;
    private readonly string _mode;
    private readonly List<MessageCalcul> _erreurs = [];
    private readonly List<MessageCalcul> _avertissements = [];
    private readonly Dictionary<long, DocumentLigne> _ecartsExistants = [];
    private readonly Dictionary<long, DocumentLigne> _ecartsCrees = [];
    private readonly HashSet<long> _enErreur = [];
    private readonly HashSet<long> _traitees = [];
    private readonly Dictionary<long, Prix> _px = [];
    private readonly Dictionary<long, Blocage> _fixe = [];
    private readonly HashSet<long> _pvVentiles = [];
    private List<DocumentLigne> _lignes = [];
    private Dictionary<long, DocumentLigne> _parId = [];
    private Dictionary<long, List<DocumentLigne>> _enfants = [];
    private List<DocumentLigne> _ordre = [];
    private DocumentLigne? _qteEnCours;
    private long _prochainId;
    private decimal _coefFa = 1;
    private decimal _totalCorps;
    private List<DocumentTva> _tva = [];

    private MoteurCalcul(EntreeCalcul e)
    {
        _e = e;
        Document = e.Document;
        MetreLignes = e.MetreLignes;
        _tauxTva = e.TauxTva.GroupBy(t => t.TtvId).ToDictionary(g => g.Key, g => g.First());
        _precMontant = Document.EntPrecisionMontant;
        _mode = Document.EntModeCalculOuvrage;
        _prochainId = Math.Min(0, e.Lignes.Count == 0 ? 0 : e.Lignes.Min(l => l.LigId)) - 1;
        foreach (var l in e.Lignes)
        {
            if (l.LigIsEcartArrondi && l.LigParentId is long p) _ecartsExistants[p] = l;
            else if (!l.LigIsEcartArrondi) _lignes.Add(l);
        }
        Portees = new Portees(Parent);
        ConstruireArbre();
    }

    // ------------------------------------------------------------------ arbre

    private static long Cle(long? id) => id ?? Racine;

    private void ConstruireArbre()
    {
        _parId = _lignes.GroupBy(l => l.LigId).ToDictionary(g => g.Key, g => g.First());
        _enfants = [];
        foreach (var l in _lignes)
        {
            var k = Cle(l.LigParentId);
            if (!_enfants.TryGetValue(k, out var liste)) _enfants[k] = liste = [];
            liste.Add(l);
        }
        foreach (var liste in _enfants.Values) Trier(liste);
        ReconstruireOrdre();
    }

    private static void Trier(List<DocumentLigne> liste) =>
        liste.Sort((a, b) => a.LigOrdre != b.LigOrdre ? a.LigOrdre.CompareTo(b.LigOrdre) : a.LigId.CompareTo(b.LigId));

    private void ReconstruireOrdre()
    {
        _ordre = [];
        var vus = new HashSet<long>();
        void Parcourir(long? p)
        {
            foreach (var l in EnfantsDe(p))
            {
                if (!vus.Add(l.LigId)) continue;
                _ordre.Add(l);
                Parcourir(l.LigId);
            }
        }
        Parcourir(null);
    }

    internal List<DocumentLigne> EnfantsDe(long? id) => _enfants.TryGetValue(Cle(id), out var l) ? l : [];

    private DocumentLigne? Parent(DocumentLigne l) =>
        l.LigParentId is long p && _parId.TryGetValue(p, out var x) ? x : null;

    private bool AUnAncetreOuvrage(DocumentLigne l)
    {
        for (var x = Parent(l); x is not null; x = Parent(x)) if (x.LigTylId == TL.Ouvrage) return true;
        return false;
    }

    /// <summary>Ligne chiffrée sans ancêtre Ouvrage : porte la TVA et entre dans les totaux.</summary>
    private bool EstLigneDePrix(DocumentLigne l) => TL.EstChiffree(l) && !AUnAncetreOuvrage(l);

    /// <summary>Type de prix hérité : Option, Pour mémoire et Variante sont hors total.</summary>
    private bool HorsTotal(DocumentLigne l, DocumentLigne? jusqua = null)
    {
        for (var x = l; x is not null && x != jusqua; x = Parent(x)) if (x.LigTypePrix != "V") return true;
        return false;
    }

    private List<DocumentLigne> Composantes(DocumentLigne ouvrage) =>
        EnfantsDe(ouvrage.LigId).Where(c => TL.EstChiffree(c) && !c.LigIsEcartArrondi).ToList();

    private bool EstCompose(DocumentLigne l) => l.LigTylId == TL.Ouvrage && EnfantsDe(l.LigId).Count > 0;

    /// <summary>Quantité d'une composante ramenée à l'unité d'ouvrage.</summary>
    private static decimal Qu(DocumentLigne c, DocumentLigne ouvrage)
    {
        var qv = c.LigQteVendue ?? 0;
        if ((c.LigQteType ?? "R") == "A")
        {
            var pq = ouvrage.LigQteVendue ?? 0;
            return pq == 0 ? 0 : qv / pq;
        }
        return qv;
    }

    private void Erreur(long? ligId, string code, string message, bool bloquante = true)
    {
        _erreurs.Add(new MessageCalcul(ligId, code, message));
        if (bloquante && ligId is long id) _enErreur.Add(id);
    }

    internal void Avertir(long? ligId, string code, string message) => _avertissements.Add(new MessageCalcul(ligId, code, message));

    // ------------------------------------------------------------------ références

    internal Func<string, decimal> Resolveur(DocumentLigne? ligne, PhaseCalcul phase) => texte =>
    {
        var reference = References.Analyser(texte);
        if (reference is ReferenceVariable v) return Portees.Lire(v.Portee, v.Nom, ligne);
        return VersDecimal(LireDonnee((ReferenceDonnee)reference, ligne, phase), texte);
    };

    [GeneratedRegex(@"^-?[0-9]+([.,][0-9]+)?$")] private static partial Regex ReNombre();

    private static decimal VersDecimal(object? v, string texte) => v switch
    {
        null => 0,
        decimal d => d,
        int i => i,
        long l => l,
        short s => s,
        string s when ReNombre().IsMatch(s.Trim()) =>
            decimal.Parse(s.Trim().Replace(',', '.'), NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture),
        _ => throw new ErreurCalcul("NON_NUMERIQUE", $"{{{{{texte}}}}} n'est pas une valeur numérique"),
    };

    private object? LireDonnee(ReferenceDonnee r, DocumentLigne? ligne, PhaseCalcul phase)
    {
        object entite;
        if (r.Table is null) entite = (object?)ligne ?? Document;
        else if (r.Table == "document") entite = Document;
        else if (r.Table == "document_ligne")
        {
            if (r.Id is not null)
            {
                var id = long.Parse(r.Id, CultureInfo.InvariantCulture);
                if (!_parId.TryGetValue(id, out var l)) throw new ErreurCalcul("ENTITE_INTROUVABLE", $"document_ligne[{r.Id}] introuvable");
                if (phase == PhaseCalcul.Calcul && l != ligne && !_traitees.Contains(l.LigId))
                {
                    throw new ErreurCalcul("ORDRE", $"La ligne {r.Id} n'est pas encore calculée à ce point du document");
                }
                entite = l;
            }
            else entite = ligne ?? throw new ErreurCalcul("PORTEE", "Aucune ligne courante");
        }
        else return LireEntiteLiee(r, ligne);

        if (!AccesColonnes.Existe(entite, r.Colonne))
        {
            throw new ErreurCalcul("COLONNE_INCONNUE", $"Colonne inconnue {(r.Table is null ? "" : r.Table + ".")}{r.Colonne}");
        }
        if (phase == PhaseCalcul.Calcul)
        {
            if (AccesColonnes.PrixCalcules.Contains(r.Colonne))
            {
                throw new ErreurCalcul("PRIX_INTERDIT", $"Une formule de quantité ne peut pas lire un prix calculé ({r.Colonne})");
            }
            if (entite == _qteEnCours && AccesColonnes.QuantitesCalculees.Contains(r.Colonne))
            {
                throw new ErreurCalcul("QTE_NON_CALCULEE", $"La quantité de la ligne n'est pas encore calculée ({r.Colonne})");
            }
        }
        return AccesColonnes.Lire(entite, r.Colonne);
    }

    /// <summary>Entité liée par clé étrangère (article de la ligne) ou désignée par son ID (article[1542]).</summary>
    private object? LireEntiteLiee(ReferenceDonnee r, DocumentLigne? ligne)
    {
        if (!_e.Entites.TryGetValue(r.Table!, out var def)) throw new ErreurCalcul("TABLE_INCONNUE", $"Table inconnue : {r.Table}");
        var cleId = $"{def.Prefixe}_id";
        var cible = r.Id;
        if (cible is null)
        {
            object courante = (object?)ligne ?? Document;
            var pref = ligne is not null ? "lig" : "ent";
            var cle = new[] { $"{pref}_{def.Prefixe}_id", $"{pref}_{r.Table}_id" }
                .FirstOrDefault(c => AccesColonnes.Existe(courante, c) && AccesColonnes.Lire(courante, c) is not null)
                ?? throw new ErreurCalcul("LIEN_INCONNU", $"Aucun lien vers {r.Table} depuis l'entité courante");
            cible = Convert.ToString(AccesColonnes.Lire(courante, cle), CultureInfo.InvariantCulture);
        }
        var rec = def.Enregistrements.FirstOrDefault(e =>
            e.TryGetProperty(cleId, out var v) && (v.ValueKind == JsonValueKind.String ? v.GetString() : v.GetRawText()) == cible);
        if (rec.ValueKind == JsonValueKind.Undefined) throw new ErreurCalcul("ENTITE_INTROUVABLE", $"{r.Table}[{cible}] introuvable");
        if (!rec.TryGetProperty(r.Colonne, out var val))
        {
            throw new ErreurCalcul("COLONNE_INCONNUE", $"Colonne inconnue {r.Table}.{r.Colonne}");
        }
        return val.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.Number => val.GetDecimal(),
            JsonValueKind.String => val.GetString(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => val,
        };
    }

    // ------------------------------------------------------------------ orchestration

    private ResultatCalcul Executer()
    {
        Valider();
        PasseQuantites();
        PassePrix();
        PasseFraisAnnexes();
        PasseMontants();
        PasseTotaux();
        PassePied();
        Numerotation.Numeroter(this);
        PasseLibelles();
        return new ResultatCalcul
        {
            VersionMoteur = Version,
            Document = Document,
            Lignes = _ordre,
            Metres = _e.Metres,
            MetreLignes = _e.MetreLignes,
            Variables = _e.Variables,
            Tva = _tva,
            LignesSupprimees = _ecartsExistants.Values.Select(l => l.LigId).ToList(),
            Erreurs = _erreurs,
            Avertissements = _avertissements,
        };
    }

    private void Valider()
    {
        var vus = _ordre.Select(l => l.LigId).ToHashSet();
        foreach (var l in _lignes)
        {
            if (!vus.Contains(l.LigId)) Erreur(l.LigId, "ARBRE", "Ligne hors arborescence (parent inconnu ou cycle)");
        }
        foreach (var l in _ordre)
        {
            var p = Parent(l);
            if (TL.EstPied(l) && p is not null) Erreur(l.LigId, "PIED_RACINE", "Les lignes de pied sont au niveau racine");
            if (p is not null && !TL.AccepteEnfants(p)) Erreur(l.LigId, "PARENT_INVALIDE", "Le type de la ligne parente n'accepte pas d'enfants");

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
    }

    private Blocage FixeDe(DocumentLigne l) => _fixe.GetValueOrDefault(l.LigId, Blocage.Aucun);

    // ------------------------------------------------------------------ passe 1 : variables, métrés, quantités

    private void PasseQuantites()
    {
        foreach (var v in _e.Variables) v.VarValeur = null;
        var vars = _e.Variables.OrderBy(v => v.VarOrdre).ThenBy(v => v.VarId).ToList();
        var parLigne = new Dictionary<long, List<VariableDefinition>>();
        var parMetre = new Dictionary<long, List<VariableDefinition>>();
        foreach (var v in vars)
        {
            if (v.VarMtrId is long m)
            {
                if (!parMetre.TryGetValue(m, out var l)) parMetre[m] = l = [];
                l.Add(v);
            }
            else if (v.VarLigId is long li)
            {
                if (!parLigne.TryGetValue(li, out var l)) parLigne[li] = l = [];
                l.Add(v);
            }
            else
            {
                try { EvaluerVariable(v, null); }
                catch (ErreurCalcul e) { Erreur(null, e.Code, e.Message); }
            }
        }

        foreach (var l in _ordre)
        {
            if (!TL.EstPied(l) && !_enErreur.Contains(l.LigId))
            {
                try
                {
                    if (TL.EstChiffree(l) && CalculerQuantite(l) is { } metre)
                    {
                        // Variables de l'onglet Définition du métré : sorties du métré, évaluées après ses lignes
                        // et après la quantité (elles peuvent lire le résultat, les variables du métré et lig_qte_vendue).
                        foreach (var v in parMetre.GetValueOrDefault(metre.MtrId) ?? []) EvaluerVariable(v, l);
                    }
                    foreach (var v in parLigne.GetValueOrDefault(l.LigId) ?? []) EvaluerVariable(v, l);
                }
                catch (ErreurCalcul e)
                {
                    Erreur(l.LigId, e.Code, e.Message);
                }
            }
            _traitees.Add(l.LigId);
        }
    }

    private void EvaluerVariable(VariableDefinition v, DocumentLigne? ligne)
    {
        var val = Expression.Evaluer(v.VarFormule, Resolveur(ligne, PhaseCalcul.Calcul));
        v.VarValeur = Portees.Affecter(v.VarPortee, v.VarNom, v.VarOperation, val, ligne);
    }

    private Metre? CalculerQuantite(DocumentLigne l)
    {
        l.LigQteBase = null;
        l.LigQteVendue = null;
        l.LigQteTotale = null;
        var metre = l.LigMtrId is long mid ? _e.Metres.FirstOrDefault(m => m.MtrId == mid) : null;
        decimal qteBase;
        _qteEnCours = l;
        try
        {
            if (metre is not null) EvaluateurMetre.Evaluer(this, metre, l);
            if (l.LigQteSource == "M")
            {
                if (metre is null) throw new ErreurCalcul("METRE_ABSENT", "La quantité est issue d'un métré absent");
                qteBase = metre.MtrResultat ?? 0;
            }
            else qteBase = l.LigQte ?? 0;
        }
        finally
        {
            _qteEnCours = null;
        }

        var qv = Arrondir(qteBase * l.LigCoefPerte, l.LigPrecisionQte);
        var p = Parent(l);
        var totale = qv;
        if (p is not null && TL.EstChiffree(p))
        {
            var pqv = p.LigQteVendue ?? 0;
            var pqt = p.LigQteTotale ?? 0;
            if ((l.LigQteType ?? "R") == "A") totale = pqv == 0 ? 0 : qv * pqt / pqv;
            else totale = qv * pqt;
        }
        l.LigQteBase = Arr6(qteBase);
        l.LigQteVendue = qv;
        l.LigQteTotale = Arr6(totale);
        return metre;
    }

    // ------------------------------------------------------------------ passes 2 et 3 : prix, PV fixes

    private void PassePrix()
    {
        void Recursif(DocumentLigne l)
        {
            foreach (var c in EnfantsDe(l.LigId).ToList()) Recursif(c);
            if (!TL.EstChiffree(l) || _enErreur.Contains(l.LigId)) return;
            PrixLigne(l);
        }
        foreach (var l in EnfantsDe(null).ToList()) Recursif(l);
    }

    private void PrixLigne(DocumentLigne l)
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
            if (!_px.TryGetValue(c.LigId, out var x)) continue;
            var q = Qu(c, l);
            pa += q * x.Pa;
            pr += q * x.Pr;
            pv += q * x.Pv;
            pvNat += q * x.PvNat;
        }
        Prix res;
        if (_mode == "D")
        {
            pa = Arr6(pa);
            var prD = Arr6(pa * l.LigCoefFg);
            var pvD = Arr6(prD * l.LigCoefBenef);
            res = new Prix { Pa = pa, Pr = prD, Pv = pvD, PvNat = pvD, CoefFg = l.LigCoefFg, CoefBenef = l.LigCoefBenef };
        }
        else
        {
            res = new Prix { Pa = Arr6(pa), Pr = Arr6(pr), Pv = Arr6(pv), PvNat = Arr6(pvNat) };
        }
        _px[l.LigId] = res;
        if (fixe == Blocage.Pv) Ventiler(l, l.LigPv!.Value);
    }

    private void PrixElement(DocumentLigne l, Blocage fixe)
    {
        decimal fg = l.LigCoefFg, bn = l.LigCoefBenef;
        var pa = l.LigPa;
        if (fixe == Blocage.Pv)
        {
            var pvFixe = l.LigPv!.Value;
            if (pa is null || pa == 0)
            {
                // Prix non défini : PA = PR = PV = prix fixe, coefficients à 1.
                _px[l.LigId] = new Prix { Pa = pvFixe, Pr = pvFixe, Pv = pvFixe, PvNat = pvFixe, CoefFg = 1, CoefBenef = 1 };
            }
            else
            {
                var prF = Arr6(pa.Value * fg);
                _px[l.LigId] = new Prix
                {
                    Pa = pa.Value, Pr = prF, Pv = pvFixe, PvNat = Arr6(prF * bn), CoefFg = fg,
                    CoefBenef = prF == 0 ? bn : Arr6(pvFixe / prF),
                };
            }
            return;
        }
        var pr = Arr6((pa ?? 0) * fg);
        var pv = Arr6(pr * bn);
        _px[l.LigId] = new Prix { Pa = pa ?? 0, Pr = pr, Pv = pv, PvNat = pv, CoefFg = fg, CoefBenef = bn };
    }

    private void SupprimerEcartCree(DocumentLigne ouvrage)
    {
        if (!_ecartsCrees.Remove(ouvrage.LigId, out var e)) return;
        _ecartsExistants[ouvrage.LigId] = e;
        _lignes.Remove(e);
        _parId.Remove(e.LigId);
        EnfantsDe(ouvrage.LigId).Remove(e);
        _px.Remove(e.LigId);
    }

    /// <summary>Répartit un PV fixe sur l'ouvrage (section 10). Le PV de l'ouvrage reste la valeur fixe.</summary>
    private void Ventiler(DocumentLigne ouvrage, decimal pvFixe)
    {
        var x = _px[ouvrage.LigId];
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

        var comps = Composantes(ouvrage).Where(c => _px.ContainsKey(c.LigId)).ToList();
        var qus = comps.Select(c => Qu(c, ouvrage)).ToList();
        var contribs = comps.Select((c, i) => qus[i] * _px[c.LigId].PvNat).ToList();
        var somme = contribs.Sum();
        DocumentLigne? principale = null;

        if (somme != 0)
        {
            var k = pvFixe / somme;
            var pvs = comps.Select(c => Arrondir(_px[c.LigId].PvNat * k, c.LigPrecisionPv)).ToList();
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
            var y = _px[comps[i].LigId];
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

    private void AppliquerPvVentile(DocumentLigne c, decimal pv)
    {
        var y = _px[c.LigId];
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

    private void CreerEcart(DocumentLigne ouvrage, decimal residu, DocumentLigne? principale)
    {
        _ecartsExistants.Remove(ouvrage.LigId, out var existant);
        var id = existant?.LigId ?? _prochainId--;
        var reference = principale ?? EnfantsDe(ouvrage.LigId).FirstOrDefault();
        var typeQte = principale is not null ? principale.LigQteType ?? "R" : "R";
        // Quantité 1 en relatif, quantité de l'ouvrage en absolu : dans les deux cas une unité par unité d'ouvrage.
        var qte = typeQte == "A" ? ouvrage.LigQteVendue ?? 0 : 1m;
        var enfants = EnfantsDe(ouvrage.LigId);
        var l = new DocumentLigne
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
        _lignes.Add(l);
        _parId[id] = l;
        if (!_enfants.TryGetValue(ouvrage.LigId, out var liste)) _enfants[ouvrage.LigId] = liste = [];
        liste.Add(l);
        _ecartsCrees[ouvrage.LigId] = l;
        _px[id] = new Prix { Pa = residu, Pr = residu, Pv = residu, PvNat = residu, CoefFg = 1, CoefBenef = 1 };
        _traitees.Add(id);
    }

    // ------------------------------------------------------------------ passe 4 : coefficient de frais annexes

    private List<DocumentLigne> LignesDePrixEnTotal() =>
        _ordre.Where(l => !TL.EstPied(l) && EstLigneDePrix(l) && !HorsTotal(l) && !_enErreur.Contains(l.LigId) && _px.ContainsKey(l.LigId)).ToList();

    private void PasseFraisAnnexes()
    {
        decimal f = 0, a = 0, p = 0;
        foreach (var l in LignesDePrixEnTotal())
        {
            var qv = l.LigQteVendue ?? 0;
            if (FixeDe(l) == Blocage.Affiche) a += l.LigPvAffiche!.Value * qv;
            else f += _px[l.LigId].Pv * qv;
        }
        foreach (var pied in EnfantsDe(null))
        {
            if (!TL.EstPied(pied) || pied.LigTylId == TL.Tva || !pied.LigPiedIsFa || pied.LigTypePrix != "V") continue;
            if ((pied.LigPiedMode ?? "M") != "M")
            {
                Erreur(pied.LigId, "FA_POURCENTAGE", "Un frais annexe ventilé doit être saisi en montant", false);
                continue;
            }
            p += Arrondir(pied.LigPiedValeur ?? 0, _precMontant) * (pied.LigPiedSens == -1 ? -1 : 1);
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

        foreach (var l in _ordre)
        {
            if (FixeDe(l) != Blocage.Affiche || !_px.TryGetValue(l.LigId, out var y)) continue;
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

    // ------------------------------------------------------------------ passe 5 : PV affiché, remise, montants

    private void PasseMontants()
    {
        var pm = _precMontant;
        foreach (var l in _ordre)
        {
            if (!TL.EstChiffree(l)) continue;
            if (!_px.TryGetValue(l.LigId, out var y) || _enErreur.Contains(l.LigId))
            {
                l.LigPr = l.LigPvAffiche = l.LigPvRemise = l.LigMontantPa = l.LigMontantPr = l.LigMontantHt = null;
                continue;
            }
            var pvAff = FixeDe(l) == Blocage.Affiche ? l.LigPvAffiche!.Value : Arrondir(y.Pv * _coefFa, l.LigPrecisionPv);
            var pvRem = Arrondir(pvAff * l.LigCoefRemise, l.LigPrecisionPv);
            var qv = l.LigQteVendue ?? 0;
            l.LigPa = y.Pa;
            l.LigPr = y.Pr;
            l.LigPv = y.Pv;
            if (y.CoefFg is decimal fg) l.LigCoefFg = fg;
            if (y.CoefBenef is decimal bn) l.LigCoefBenef = bn;
            l.LigCoefFa = _coefFa;
            l.LigPvAffiche = pvAff;
            l.LigPvRemise = pvRem;
            l.LigMontantPa = Arrondir(qv * y.Pa, pm);
            l.LigMontantPr = Arrondir(qv * y.Pr, pm);
            l.LigMontantHt = Arrondir(qv * pvRem, pm);
            if (_pvVentiles.Contains(l.LigId)) l.LigPvFixe = true;
        }
    }

    // ------------------------------------------------------------------ passe 6 : sous-totaux et titres

    private void PasseTotaux()
    {
        var corps = _ordre.Where(l => !TL.EstPied(l)).ToList();
        bool EnTotal(DocumentLigne l) => EstLigneDePrix(l) && !HorsTotal(l) && !_enErreur.Contains(l.LigId) && l.LigMontantHt is not null;
        static (decimal Ht, decimal Pa, decimal Pr) Somme(IEnumerable<DocumentLigne> lignes)
        {
            decimal ht = 0, pa = 0, pr = 0;
            foreach (var l in lignes) { ht += l.LigMontantHt!.Value; pa += l.LigMontantPa ?? 0; pr += l.LigMontantPr ?? 0; }
            return (ht, pa, pr);
        }
        static void Ecrire(DocumentLigne l, (decimal Ht, decimal Pa, decimal Pr) s)
        {
            l.LigMontantHt = s.Ht;
            l.LigMontantPa = s.Pa;
            l.LigMontantPr = s.Pr;
        }

        for (var i = 0; i < corps.Count; i++)
        {
            var l = corps[i];
            if (l.LigTylId == TL.Titre)
            {
                var desc = new List<DocumentLigne>();
                for (var j = i + 1; j < corps.Count && DescendDe(corps[j], l); j++) desc.Add(corps[j]);
                Ecrire(l, Somme(desc.Where(x => EstLigneDePrix(x) && !HorsTotal(x, l) && !_enErreur.Contains(x.LigId) && x.LigMontantHt is not null)));
            }
            else if (l.LigTylId == TL.SousTotal)
            {
                var debut = 0;
                if (l.LigStDepuisId is long st)
                {
                    var j = corps.FindIndex(x => x.LigId == st);
                    if (j < 0 || j >= i || corps[j].LigTylId != TL.SousTotal)
                    {
                        Erreur(l.LigId, "SOUS_TOTAL_POINTE", "Le sous-total pointé doit être un sous-total précédent");
                        Ecrire(l, (0, 0, 0));
                        continue;
                    }
                    debut = j + 1;
                }
                Ecrire(l, Somme(corps.Skip(debut).Take(i - debut).Where(EnTotal)));
            }
        }
        _totalCorps = Somme(corps.Where(EnTotal)).Ht;
    }

    private bool DescendDe(DocumentLigne l, DocumentLigne ancetre)
    {
        for (var x = Parent(l); x is not null; x = Parent(x)) if (x == ancetre) return true;
        return false;
    }

    // ------------------------------------------------------------------ passe 7 : lignes de pied et TVA

    private sealed class BaseTva
    {
        public int TtvId;
        public string Code = "";
        public decimal Taux;
        public string Categorie = "N";
        public string? Mention;
        public decimal Base;
    }

    private BaseTva InfoTaux(int id, decimal? tauxLigne)
    {
        _tauxTva.TryGetValue(id, out var t);
        return new BaseTva
        {
            TtvId = id,
            Code = t?.TtvCode ?? id.ToString(CultureInfo.InvariantCulture),
            Taux = tauxLigne ?? t?.TtvTaux ?? 0,
            Categorie = t?.TtvCategorie ?? "N",
            Mention = t?.TtvMention,
        };
    }

    private void PassePied()
    {
        var bases = new Dictionary<int, BaseTva>();
        foreach (var l in _ordre)
        {
            if (TL.EstPied(l) || !TL.EstChiffree(l)) continue;
            if (!EstLigneDePrix(l))
            {
                l.LigTvaId = null;
                l.LigTauxTva = null;
                continue;
            }
            if (l.LigTvaId is int tid && l.LigTauxTva is null && _tauxTva.TryGetValue(tid, out var t)) l.LigTauxTva = t.TtvTaux;
            if (HorsTotal(l) || _enErreur.Contains(l.LigId) || l.LigMontantHt is null) continue;
            if (l.LigTvaId is not int id)
            {
                Erreur(l.LigId, "TVA_MANQUANTE", "Taux de TVA manquant sur une ligne de prix", false);
                continue;
            }
            if (!bases.TryGetValue(id, out var e)) bases[id] = e = InfoTaux(id, l.LigTauxTva);
            e.Base += l.LigMontantHt.Value;
        }

        var totalHt = _totalCorps;
        var totalTtc = totalHt + CalculerTva(bases).Net;
        var cumul = totalHt;
        (List<DocumentTva> Lignes, decimal Base, decimal Net)? tva = null;

        foreach (var p in EnfantsDe(null))
        {
            if (!TL.EstPied(p)) continue;
            p.LigBaseCalcul = null;
            p.LigMontantTva = null;
            if (p.LigTylId == TL.Tva)
            {
                p.LigMontantHt = null;
                if (tva is not null)
                {
                    Erreur(p.LigId, "TVA_DOUBLE", "Une seule ligne de ventilation TVA par document", false);
                    continue;
                }
                tva = CalculerTva(bases);
                p.LigBaseCalcul = tva.Value.Base;
                p.LigMontantTva = tva.Value.Net;
                cumul += tva.Value.Net;
                continue;
            }
            var codeBase = p.LigPiedBase ?? "CUMUL";
            var baseCalcul = codeBase == "TOTAL_HT" ? totalHt : codeBase == "TOTAL_TTC" ? totalTtc : cumul;
            var sens = p.LigPiedSens == -1 ? -1 : 1;
            var pourcentage = (p.LigPiedMode ?? "M") == "P";
            var montant = (pourcentage
                ? Arrondir(baseCalcul * (p.LigPiedValeur ?? 0) / 100, _precMontant)
                : Arrondir(p.LigPiedValeur ?? 0, _precMontant)) * sens;
            p.LigBaseCalcul = pourcentage ? baseCalcul : null;
            p.LigMontantHt = montant;
            // Frais annexe déjà ventilé dans les prix, ou poste pour mémoire : affiché, hors cumul.
            if (p.LigPiedIsFa || p.LigTypePrix != "V") continue;
            cumul += montant;
            if (p.LigTylId == TL.PiedHt && tva is null) RepartirSurBases(bases, montant, p);
        }
        if (tva is null)
        {
            tva = CalculerTva(bases);
            cumul += tva.Value.Net;
        }

        _tva = tva.Value.Lignes;
        Document.EntCoefFa = _coefFa;
        Document.EntTotalHt = tva.Value.Base;
        Document.EntTotalTva = tva.Value.Net;
        Document.EntTotalTtc = tva.Value.Base + tva.Value.Net;
        Document.EntNetAPayer = cumul;
        Document.EntVersionCalcul = Version;
    }

    private void RepartirSurBases(Dictionary<int, BaseTva> bases, decimal montant, DocumentLigne p)
    {
        if (p.LigTvaId is int id)
        {
            if (!bases.TryGetValue(id, out var e)) bases[id] = e = InfoTaux(id, null);
            e.Base += montant;
            return;
        }
        var entrees = bases.Values.OrderBy(e => e.Code, StringComparer.Ordinal).ToList();
        if (entrees.Count == 0)
        {
            Erreur(p.LigId, "TVA_REPARTITION", "Aucune base de TVA sur laquelle répartir le poste", false);
            return;
        }
        var total = entrees.Sum(e => e.Base);
        if (total == 0)
        {
            entrees[0].Base += montant;
            return;
        }
        var reste = montant;
        for (var i = 0; i < entrees.Count - 1; i++)
        {
            var part = Arrondir(montant * entrees[i].Base / total, _precMontant);
            entrees[i].Base += part;
            reste -= part;
        }
        entrees[^1].Base += reste;
    }

    /// <summary>Ventilation par taux selon la catégorie : Normale, Autoliquidation, Intracommunautaire, Exonérée.</summary>
    private (List<DocumentTva> Lignes, decimal Base, decimal Net) CalculerTva(Dictionary<int, BaseTva> bases)
    {
        decimal total = 0, net = 0;
        var lignes = new List<DocumentTva>();
        foreach (var e in bases.Values.OrderBy(e => e.Code, StringComparer.Ordinal))
        {
            var b = Arrondir(e.Base, _precMontant);
            var calcule = Arrondir(b * e.Taux / 100, _precMontant);
            decimal montant = calcule, annulation = 0;
            if (e.Categorie == "A") montant = 0;
            else if (e.Categorie == "I") annulation = -calcule;
            var n = montant + annulation;
            total += b;
            net += n;
            lignes.Add(new DocumentTva
            {
                TvaEntId = Document.EntId,
                TvaTtvId = e.TtvId,
                TvaCode = e.Code,
                TvaTaux = e.Taux,
                TvaCategorie = e.Categorie,
                TvaBaseHt = b,
                TvaMontant = montant,
                TvaMontantAnnulation = annulation,
                TvaMontantNet = n,
                TvaMention = e.Mention,
            });
        }
        return (lignes, total, net);
    }

    // ------------------------------------------------------------------ passe 8 : libellés

    private void PasseLibelles()
    {
        if (_e.Options.LibellesFiges) return;
        foreach (var l in _ordre)
        {
            object? Resoudre(string texte)
            {
                var r = References.Analyser(texte);
                if (r is ReferenceVariable v) return Portees.Lire(v.Portee, v.Nom, l);
                return LireDonnee((ReferenceDonnee)r, l, PhaseCalcul.Libelle);
            }
            var (texteAffiche, inconnues) = Libelles.Remplacer(l.LigLibelleHtml, Resoudre);
            foreach (var (_, message) in inconnues) Avertir(l.LigId, "VARIABLE_LIBELLE", $"Libellé : {message}");
            l.LigLibelleAffiche = texteAffiche;
            l.LigLibelleBrut = Libelles.TexteBrut(texteAffiche);
        }
    }
}
