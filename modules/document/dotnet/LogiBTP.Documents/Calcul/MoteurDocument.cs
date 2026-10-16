using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using LogiBTP.Socle;
using static LogiBTP.Socle.ArrondiCalcul;

namespace LogiBTP.Documents;

public enum PhaseCalcul { Calcul, Libelle }

internal static partial class MotifsMoteur
{
    [GeneratedRegex(@"^-?[0-9]+([.,][0-9]+)?$")] internal static partial Regex Nombre();
}

/// <summary>
/// Moteur de calcul d'un document commercial générique (classe mère du module Document), réplique exacte
/// de moteur-document.js. Fonction pure, sans accès à la base.
///
/// Méthode patron : <see cref="Executer"/> enchaîne des étapes que le cœur ou un autre module redéfinit
/// (ValiderLigne, AvantQuantites, QuantiteBase, QuantiteVendue, EcrireQuantites, ApresLigne, PrixLigne,
/// ApresPrix, PvAffiche, EcrireMontants, ViderMontants, EcrireSomme, HorsCumulPied, EcrireTotaux,
/// LireVariable, CreerResultat…).
///
/// Comportement générique : PV saisi, remise, ligne composée = somme de ses composantes, sous-totaux,
/// titres, lignes de pied séquentielles, TVA par catégorie, numérotation, libellés avec variables de données.
/// </summary>
public class MoteurDocument<TDoc, TLigne>
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
{
    public const string Version = "0.1.0";
    private const long Racine = long.MinValue;

    /// <summary>Prix unitaire d'une ligne pendant le calcul ; une spécialisation l'étend (PA, PR…).</summary>
    protected class Prix
    {
        public decimal Pv;
    }

    /// <summary>Calcule un document générique. L'entrée n'est pas modifiée.</summary>
    public static ResultatDocument<TDoc, TLigne> Calculer(EntreeDocument<TDoc, TLigne> entree) =>
        new MoteurDocument<TDoc, TLigne>(JsonCalcul.Cloner(entree)).Executer();

    protected internal TDoc Doc { get; }
    protected EntreeDocument<TDoc, TLigne> Entree { get; }
    protected Dictionary<int, TauxTva> TauxTvaParId { get; }
    protected int PrecMontant { get; }
    protected List<MessageCalcul> Erreurs { get; } = [];
    protected List<MessageCalcul> Avertissements { get; } = [];
    protected HashSet<long> EnErreur { get; } = [];
    protected HashSet<long> Traitees { get; } = [];
    protected Dictionary<long, Prix> Px { get; } = [];
    protected List<TLigne> Lignes { get; set; }
    protected Dictionary<long, TLigne> ParId { get; set; } = [];
    protected Dictionary<long, List<TLigne>> Enfants { get; set; } = [];
    protected List<TLigne> Ordre { get; set; } = [];
    protected TLigne? QteEnCours { get; set; }
    protected decimal TotalCorps { get; set; }
    protected List<DocumentTva> Tva { get; set; } = [];
    protected List<EntreePied> Pied { get; set; } = [];

    /// <param name="entree">Entrée déjà copiée : le moteur la modifie.</param>
    public MoteurDocument(EntreeDocument<TDoc, TLigne> entree)
    {
        Entree = entree;
        Doc = entree.Document;
        TauxTvaParId = entree.TauxTva.GroupBy(t => t.TtvId).ToDictionary(g => g.Key, g => g.First());
        PrecMontant = Doc.EntPrecisionMontant;
        Lignes = PreparerLignes(entree.Lignes);
        ConstruireArbre();
    }

    /// <summary>Lignes retenues pour le calcul (point de spécialisation : lignes calculées à recréer…).</summary>
    protected virtual List<TLigne> PreparerLignes(List<TLigne> lignes) => [.. lignes];

    // ------------------------------------------------------------------ colonnes (spécialisables)

    private static readonly HashSet<string> PrixCalculesGeneriques =
    [
        "lig_pv_remise", "lig_montant_ht", "lig_montant_tva", "lig_base_calcul",
        "ent_total_ht", "ent_total_tva", "ent_total_ttc", "ent_net_a_payer",
    ];

    private static readonly HashSet<string> QuantitesCalculeesGeneriques = ["lig_qte_vendue", "lig_qte_totale"];

    /// <summary>Colonnes calculées que les formules de quantité ne peuvent pas lire.</summary>
    protected virtual IReadOnlySet<string> PrixCalcules => PrixCalculesGeneriques;

    protected virtual IReadOnlySet<string> QuantitesCalculees => QuantitesCalculeesGeneriques;

    // ------------------------------------------------------------------ arbre

    private static long Cle(long? id) => id ?? Racine;

    protected void ConstruireArbre()
    {
        ParId = Lignes.GroupBy(l => l.LigId).ToDictionary(g => g.Key, g => g.First());
        Enfants = [];
        foreach (var l in Lignes)
        {
            var k = Cle(l.LigParentId);
            if (!Enfants.TryGetValue(k, out var liste)) Enfants[k] = liste = [];
            liste.Add(l);
        }
        foreach (var liste in Enfants.Values) Trier(liste);
        ReconstruireOrdre();
    }

    private static void Trier(List<TLigne> liste) =>
        liste.Sort((a, b) => a.LigOrdre != b.LigOrdre ? a.LigOrdre.CompareTo(b.LigOrdre) : a.LigId.CompareTo(b.LigId));

    protected void ReconstruireOrdre()
    {
        Ordre = [];
        var vus = new HashSet<long>();
        void Parcourir(long? p)
        {
            foreach (var l in EnfantsDe(p))
            {
                if (!vus.Add(l.LigId)) continue;
                Ordre.Add(l);
                Parcourir(l.LigId);
            }
        }
        Parcourir(null);
    }

    protected internal List<TLigne> EnfantsDe(long? id) => Enfants.TryGetValue(Cle(id), out var l) ? l : [];

    /// <summary>Liste des enfants d'une ligne, créée au besoin (ajout de lignes calculées).</summary>
    protected List<TLigne> ListeEnfants(long id)
    {
        if (!Enfants.TryGetValue(id, out var liste)) Enfants[id] = liste = [];
        return liste;
    }

    protected TLigne? Parent(TLigne l) =>
        l.LigParentId is long p && ParId.TryGetValue(p, out var x) ? x : null;

    protected bool AUnAncetreOuvrage(TLigne l)
    {
        for (var x = Parent(l); x is not null; x = Parent(x)) if (x.LigTylId == TL.Ouvrage) return true;
        return false;
    }

    /// <summary>Ligne chiffrée sans ancêtre composé : porte la TVA et entre dans les totaux.</summary>
    protected bool EstLigneDePrix(TLigne l) => TL.EstChiffree(l) && !AUnAncetreOuvrage(l);

    /// <summary>Type de prix hérité : Option, Pour mémoire, Variante et Frais annexes sont hors total.</summary>
    protected bool HorsTotal(TLigne l, TLigne? jusqua = null)
    {
        for (var x = l; x is not null && x != jusqua; x = Parent(x)) if (x.LigTypePrix != "V") return true;
        return false;
    }

    /// <summary>Frais annexes (type F, hérité) : hors total, jamais imprimé ; ventilés sur les autres lignes en spécialisation.</summary>
    protected bool EstFraisAnnexes(TLigne l)
    {
        var f = false;
        for (var x = l; x is not null; x = Parent(x))
        {
            if (x.LigTypePrix == "F") f = true;
            else if (x.LigTypePrix != "V") return false;
        }
        return f;
    }

    protected virtual List<TLigne> Composantes(TLigne compose) => EnfantsDe(compose.LigId).Where(c => TL.EstChiffree(c)).ToList();

    protected bool EstCompose(TLigne l) => l.LigTylId == TL.Ouvrage && EnfantsDe(l.LigId).Count > 0;

    /// <summary>Ligne numérotée (Titre, Ouvrage, Élément) ; spécialisable pour exclure des lignes calculées.</summary>
    protected internal virtual bool EstNumerotee(TLigne l) => TL.EstTypeNumerote(l);

    /// <summary>Quantité d'une composante ramenée à l'unité du composé.</summary>
    protected static decimal Qu(TLigne c, TLigne compose)
    {
        var qv = c.LigQteVendue ?? 0;
        if ((c.LigQteType ?? "R") == "A")
        {
            var pq = compose.LigQteVendue ?? 0;
            return pq == 0 ? 0 : qv / pq;
        }
        return qv;
    }

    protected void Erreur(long? ligId, string code, string message, bool bloquante = true)
    {
        Erreurs.Add(new MessageCalcul(ligId, code, message));
        if (bloquante && ligId is long id) EnErreur.Add(id);
    }

    protected internal void Avertir(long? ligId, string code, string message) => Avertissements.Add(new MessageCalcul(ligId, code, message));

    // ------------------------------------------------------------------ références

    /// <summary>Variable de calcul {{$$x}}, {{@x}}… : le document générique n'en définit pas (module Métré).</summary>
    protected virtual decimal LireVariable(string portee, string nom, TLigne? ligne) =>
        throw new ErreurCalcul("VARIABLE_INCONNUE", $"Variable {{{{{portee}{nom}}}}} non définie à ce point du document");

    protected internal Func<string, decimal> Resolveur(TLigne? ligne, PhaseCalcul phase) => texte =>
    {
        var reference = References.Analyser(texte);
        if (reference is ReferenceVariable v) return LireVariable(v.Portee, v.Nom, ligne);
        return VersDecimal(LireDonnee((ReferenceDonnee)reference, ligne, phase), texte);
    };

    private static decimal VersDecimal(object? v, string texte) => v switch
    {
        null => 0,
        decimal d => d,
        int i => i,
        long l => l,
        short s => s,
        string s when MotifsMoteur.Nombre().IsMatch(s.Trim()) =>
            decimal.Parse(s.Trim().Replace(',', '.'), NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture),
        _ => throw new ErreurCalcul("NON_NUMERIQUE", $"{{{{{texte}}}}} n'est pas une valeur numérique"),
    };

    protected object? LireDonnee(ReferenceDonnee r, TLigne? ligne, PhaseCalcul phase)
    {
        object entite;
        if (r.Table is null) entite = (object?)ligne ?? Doc;
        else if (r.Table == "document") entite = Doc;
        else if (r.Table == "document_ligne")
        {
            if (r.Id is not null)
            {
                var id = long.Parse(r.Id, CultureInfo.InvariantCulture);
                if (!ParId.TryGetValue(id, out var l)) throw new ErreurCalcul("ENTITE_INTROUVABLE", $"document_ligne[{r.Id}] introuvable");
                if (phase == PhaseCalcul.Calcul && l != ligne && !Traitees.Contains(l.LigId))
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
            if (PrixCalcules.Contains(r.Colonne))
            {
                throw new ErreurCalcul("PRIX_INTERDIT", $"Une formule de quantité ne peut pas lire un prix calculé ({r.Colonne})");
            }
            if (QteEnCours is not null && entite == QteEnCours && QuantitesCalculees.Contains(r.Colonne))
            {
                throw new ErreurCalcul("QTE_NON_CALCULEE", $"La quantité de la ligne n'est pas encore calculée ({r.Colonne})");
            }
        }
        return AccesColonnes.Lire(entite, r.Colonne);
    }

    /// <summary>Entité liée par clé étrangère (article de la ligne) ou désignée par son ID (article[1542]).</summary>
    private object? LireEntiteLiee(ReferenceDonnee r, TLigne? ligne)
    {
        if (!Entree.Entites.TryGetValue(r.Table!, out var def)) throw new ErreurCalcul("TABLE_INCONNUE", $"Table inconnue : {r.Table}");
        var cleId = $"{def.Prefixe}_id";
        var cible = r.Id;
        if (cible is null)
        {
            object courante = (object?)ligne ?? Doc;
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

    // ------------------------------------------------------------------ orchestration (méthode patron)

    public ResultatDocument<TDoc, TLigne> Executer()
    {
        Valider();
        PasseQuantites();
        PassePrix();
        ApresPrix();
        PasseMontants();
        PasseTotaux();
        PassePied();
        Numerotation.Numeroter(this);
        PasseLibelles();
        return CreerResultat();
    }

    protected virtual void Valider()
    {
        var vus = Ordre.Select(l => l.LigId).ToHashSet();
        foreach (var l in Lignes)
        {
            if (!vus.Contains(l.LigId)) Erreur(l.LigId, "ARBRE", "Ligne hors arborescence (parent inconnu ou cycle)");
        }
        foreach (var l in Ordre)
        {
            var p = Parent(l);
            if (TL.EstPied(l) && p is not null) Erreur(l.LigId, "PIED_RACINE", "Les lignes de pied sont au niveau racine");
            if (p is not null && !TL.AccepteEnfants(p)) Erreur(l.LigId, "PARENT_INVALIDE", "Le type de la ligne parente n'accepte pas d'enfants");
            if (l.LigTylId == TL.Section && p is not null) Erreur(l.LigId, "SECTION_RACINE", "Une section est au niveau racine");
            if (EstFraisAnnexes(l)) l.LigIsNonEditee = true;
            ValiderLigne(l);
        }
    }

    /// <summary>Contrôles propres à une spécialisation (blocages de prix…).</summary>
    protected virtual void ValiderLigne(TLigne l) { }

    // ------------------------------------------------------------------ passe 1 : quantités

    protected virtual void PasseQuantites()
    {
        AvantQuantites();
        foreach (var l in Ordre)
        {
            if (!TL.EstPied(l) && !EnErreur.Contains(l.LigId))
            {
                try
                {
                    if (TL.EstChiffree(l)) CalculerQuantite(l);
                    ApresLigne(l);
                }
                catch (ErreurCalcul e)
                {
                    Erreur(l.LigId, e.Code, e.Message);
                }
            }
            Traitees.Add(l.LigId);
        }
    }

    /// <summary>Avant la première ligne (variables du document…).</summary>
    protected virtual void AvantQuantites() { }

    /// <summary>Après la quantité de chaque ligne hors pied, dans l'ordre du document (variables de ligne…).</summary>
    protected virtual void ApresLigne(TLigne l) { }

    protected void CalculerQuantite(TLigne l)
    {
        l.LigQteVendue = null;
        l.LigQteTotale = null;
        var qteBase = QuantiteBase(l);
        var qv = QuantiteVendue(l, qteBase);
        var p = Parent(l);
        var totale = qv;
        if (p is not null && TL.EstChiffree(p))
        {
            var pqv = p.LigQteVendue ?? 0;
            var pqt = p.LigQteTotale ?? 0;
            if ((l.LigQteType ?? "R") == "A") totale = pqv == 0 ? 0 : qv * pqt / pqv;
            else totale = qv * pqt;
        }
        EcrireQuantites(l, qteBase, qv, totale);
    }

    /// <summary>Quantité de départ : la saisie (un métré, une formule… en spécialisation).</summary>
    protected virtual decimal QuantiteBase(TLigne l) => l.LigQte ?? 0;

    /// <summary>Quantité vendue arrondie à la précision de la ligne (coefficient de perte… en spécialisation).</summary>
    protected virtual decimal QuantiteVendue(TLigne l, decimal qteBase) => Arrondir(qteBase, l.LigPrecisionQte);

    protected virtual void EcrireQuantites(TLigne l, decimal qteBase, decimal qv, decimal totale)
    {
        l.LigQteVendue = qv;
        l.LigQteTotale = Arr6(totale);
    }

    // ------------------------------------------------------------------ passe 2 : prix

    protected virtual void PassePrix()
    {
        void Recursif(TLigne l)
        {
            foreach (var c in EnfantsDe(l.LigId).ToList()) Recursif(c);
            if (!TL.EstChiffree(l) || EnErreur.Contains(l.LigId)) return;
            PrixLigne(l);
        }
        foreach (var l in EnfantsDe(null).ToList()) Recursif(l);
    }

    /// <summary>Prix unitaire : PV saisi, ou somme des composantes d'une ligne composée. Renseigne Px.</summary>
    protected virtual void PrixLigne(TLigne l)
    {
        if (!EstCompose(l))
        {
            Px[l.LigId] = new Prix { Pv = l.LigPv ?? 0 };
            return;
        }
        decimal pv = 0;
        foreach (var c in Composantes(l))
        {
            if (Px.TryGetValue(c.LigId, out var x)) pv += Qu(c, l) * x.Pv;
        }
        Px[l.LigId] = new Prix { Pv = Arr6(pv) };
    }

    /// <summary>Après le calcul des prix (frais annexes, ventilations… en spécialisation).</summary>
    protected virtual void ApresPrix() { }

    // ------------------------------------------------------------------ passe 3 : remise et montants

    protected virtual void PasseMontants()
    {
        foreach (var l in Ordre)
        {
            if (!TL.EstChiffree(l)) continue;
            if (!Px.TryGetValue(l.LigId, out var y) || EnErreur.Contains(l.LigId))
            {
                ViderMontants(l);
                continue;
            }
            var pvAff = PvAffiche(l, y);
            var pvRem = Arrondir(pvAff * l.LigCoefRemise, l.LigPrecisionPv);
            EcrireMontants(l, y, pvAff, pvRem, l.LigQteVendue ?? 0);
        }
    }

    protected virtual void ViderMontants(TLigne l)
    {
        l.LigPvRemise = null;
        l.LigMontantHt = null;
    }

    /// <summary>PV avant remise, arrondi à la précision PV (frais annexes… en spécialisation).</summary>
    protected virtual decimal PvAffiche(TLigne l, Prix y) => Arrondir(y.Pv, l.LigPrecisionPv);

    protected virtual void EcrireMontants(TLigne l, Prix y, decimal pvAff, decimal pvRem, decimal qv)
    {
        l.LigPv = y.Pv;
        l.LigPvRemise = pvRem;
        l.LigMontantHt = Arrondir(qv * pvRem, PrecMontant);
    }

    // ------------------------------------------------------------------ passe 4 : sous-totaux et titres

    /// <summary>Montants cumulés d'un titre ou d'un sous-total (spécialisable : déboursé, revient…).</summary>
    protected virtual void EcrireSomme(TLigne cible, IReadOnlyList<TLigne> lignes) =>
        cible.LigMontantHt = lignes.Sum(l => l.LigMontantHt!.Value);

    /// <summary>
    /// Sous-total de pied : sous-total à la racine placé après une ligne de pied ; il vaut le cumul du pied à ce point et
    /// peut servir de base de calcul (LigPiedBase = LIGNE).
    /// </summary>
    protected bool EstSousTotalPied(TLigne l)
    {
        if (l.LigTylId != TL.SousTotal || Parent(l) is not null) return false;
        foreach (var x in EnfantsDe(null))
        {
            if (x == l) return false;
            if (TL.EstPied(x)) return true;
        }
        return false;
    }

    /// <summary>Montants d'un sous-total de pied : le cumul (une spécialisation vide ses autres montants cumulés).</summary>
    protected virtual void EcrireSousTotalPied(TLigne l, decimal cumul) => l.LigMontantHt = cumul;

    protected virtual void PasseTotaux()
    {
        var corps = Ordre.Where(l => !TL.EstPied(l) && !EstSousTotalPied(l)).ToList();
        bool EnTotal(TLigne l) => EstLigneDePrix(l) && !HorsTotal(l) && !EnErreur.Contains(l.LigId) && l.LigMontantHt is not null;

        for (var i = 0; i < corps.Count; i++)
        {
            var l = corps[i];
            if (TL.EstTranche(l))
            {
                var desc = new List<TLigne>();
                for (var j = i + 1; j < corps.Count && DescendDe(corps[j], l); j++) desc.Add(corps[j]);
                EcrireSomme(l, desc.Where(x => EstLigneDePrix(x) && !HorsTotal(x, l) && !EnErreur.Contains(x.LigId) && x.LigMontantHt is not null).ToList());
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
                        EcrireSomme(l, []);
                        continue;
                    }
                    debut = j + 1;
                }
                EcrireSomme(l, corps.Skip(debut).Take(i - debut).Where(EnTotal).ToList());
            }
        }
        TotalCorps = corps.Where(EnTotal).Sum(l => l.LigMontantHt!.Value);
    }

    private bool DescendDe(TLigne l, TLigne ancetre)
    {
        for (var x = Parent(l); x is not null; x = Parent(x)) if (x == ancetre) return true;
        return false;
    }

    // ------------------------------------------------------------------ passe 5 : lignes de pied et TVA

    protected sealed class BaseTva
    {
        public int TtvId;
        public string Code = "";
        public decimal Taux;
        public string Categorie = "N";
        public string? Mention;
        public decimal Base;
    }

    protected sealed record VentilationTva(List<DocumentTva> Lignes, decimal Base, decimal Net);

    private BaseTva InfoTaux(int id, decimal? tauxLigne)
    {
        TauxTvaParId.TryGetValue(id, out var t);
        return new BaseTva
        {
            TtvId = id,
            Code = t?.TtvCode ?? id.ToString(CultureInfo.InvariantCulture),
            Taux = tauxLigne ?? t?.TtvTaux ?? 0,
            Categorie = t?.TtvCategorie ?? "N",
            Mention = t?.TtvMention,
        };
    }

    /// <summary>Poste affiché mais hors du net à payer (pour mémoire ; frais annexes ventilés en spécialisation).</summary>
    protected virtual bool HorsCumulPied(TLigne p) => p.LigTypePrix != "V";

    protected virtual void PassePied()
    {
        var bases = new Dictionary<int, BaseTva>();
        foreach (var l in Ordre)
        {
            if (TL.EstPied(l) || !TL.EstChiffree(l)) continue;
            if (!EstLigneDePrix(l))
            {
                l.LigTvaId = null;
                l.LigTauxTva = null;
                continue;
            }
            if (l.LigTvaId is int tid && l.LigTauxTva is null && TauxTvaParId.TryGetValue(tid, out var t)) l.LigTauxTva = t.TtvTaux;
            if (HorsTotal(l) || EnErreur.Contains(l.LigId) || l.LigMontantHt is null) continue;
            if (l.LigTvaId is not int id)
            {
                Erreur(l.LigId, "TVA_MANQUANTE", "Taux de TVA manquant sur une ligne de prix", false);
                continue;
            }
            if (!bases.TryGetValue(id, out var e)) bases[id] = e = InfoTaux(id, l.LigTauxTva);
            e.Base += l.LigMontantHt.Value;
        }

        var totalHt = TotalCorps;
        var totalTtc = totalHt + CalculerTva(bases).Net;
        var cumul = totalHt;
        VentilationTva? tva = null;
        var htNet = totalHt;
        var sousTotaux = new Dictionary<long, decimal>();

        // Structure du pied (affichage) : totaux calculés et groupes (postes HT, TVA, postes TTC), dans l'ordre du calcul.
        var pied = new List<(string Genre, string Cle, long? LigId, List<long>? Lignes, decimal Montant)> { ("total", "TOTAL_HT", null, null, totalHt) };
        (string Cle, List<long> Lignes, decimal Montant)? groupe = null;
        // Fermeture d'un groupe : suivi d'un total calculé, sauf s'il est fermé par un sous-total de pied saisi.
        void Fermer(bool avecTotal = true)
        {
            if (groupe is not { } g) return;
            pied.Add(("groupe", g.Cle, null, g.Lignes, g.Montant));
            if (g.Cle == "HT" && tva is null) htNet = cumul;
            groupe = null;
            if (!avecTotal) return;
            if (g.Cle == "HT" && tva is null) pied.Add(("total", "HT_NET", null, null, cumul));
            else if (g.Cle == "TVA") pied.Add(("total", "TOTAL_TTC", null, null, cumul));
            else pied.Add(("total", "SOUS_TOTAL", null, null, cumul));
        }
        void Dans(string cle, long? id, decimal montant)
        {
            if (groupe?.Cle != cle) { Fermer(); groupe = (cle, [], 0m); }
            var g = groupe!.Value;
            if (id is long x) g.Lignes.Add(x);
            groupe = (g.Cle, g.Lignes, g.Montant + montant);
        }

        foreach (var p in EnfantsDe(null))
        {
            if (EstSousTotalPied(p))
            {
                Fermer(false);
                EcrireSousTotalPied(p, cumul);
                sousTotaux[p.LigId] = cumul;
                pied.Add(("ligne", "SOUS_TOTAL", p.LigId, null, cumul));
                continue;
            }
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
                Fermer();
                tva = CalculerTva(bases);
                p.LigBaseCalcul = tva.Base;
                p.LigMontantTva = tva.Net;
                cumul += tva.Net;
                Dans("TVA", p.LigId, tva.Net);
                Fermer();
                continue;
            }
            var baseCalcul = BasePied(p, cumul, totalHt, totalTtc, htNet, sousTotaux);
            var mode = p.LigPiedMode ?? "M";
            var sens = p.LigPiedSens == -1 ? -1 : 1;
            var valeur = p.LigPiedValeur ?? 0;
            var montant = mode switch
            {
                "P" => Arrondir(baseCalcul * valeur / 100, PrecMontant) * sens,
                "C" => Arrondir(baseCalcul * (valeur - 1), PrecMontant),
                _ => Arrondir(valeur, PrecMontant) * sens,
            };
            p.LigBaseCalcul = mode == "M" ? null : baseCalcul;
            p.LigMontantHt = montant;
            var hors = HorsCumulPied(p);
            Dans(p.LigTylId == TL.PiedHt ? "HT" : "TTC", p.LigId, hors ? 0 : montant);
            if (hors) continue;
            cumul += montant;
            if (p.LigTylId == TL.PiedHt && tva is null) RepartirSurBases(bases, montant, p);
        }
        if (tva is null)
        {
            Fermer();
            tva = CalculerTva(bases);
            cumul += tva.Net;
            Dans("TVA", null, tva.Net);
        }
        // Le dernier groupe n'a pas de sous-total : le net à payer le suit.
        if (groupe is { } dernier) pied.Add(("groupe", dernier.Cle, null, dernier.Lignes, dernier.Montant));
        pied.Add(("total", "NET", null, null, cumul));
        Pied = MasquerTotaux(pied);

        Tva = tva.Lignes;
        EcrireTotaux(tva, cumul);
    }

    /// <summary>Base d'une ligne de pied en pourcentage ou coefficient (LigPiedBase).</summary>
    protected decimal BasePied(TLigne p, decimal cumul, decimal totalHt, decimal totalTtc, decimal htNet, IReadOnlyDictionary<long, decimal> sousTotaux)
    {
        switch (p.LigPiedBase ?? "CUMUL")
        {
            case "TOTAL_HT": return totalHt;
            case "TOTAL_TTC": return totalTtc;
            case "HT_NET": return htNet;
            case "LIGNE":
                if (p.LigPiedBaseId is long id && sousTotaux.TryGetValue(id, out var st)) return st;
                Erreur(p.LigId, "PIED_BASE", "La base doit être un sous-total de pied placé avant la ligne", false);
                return cumul;
            default: return cumul;
        }
    }

    /// <summary>Un total calculé égal au total suivant (calculé ou sous-total de pied saisi) est masqué : une seule ligne affichée.</summary>
    private static List<EntreePied> MasquerTotaux(List<(string Genre, string Cle, long? LigId, List<long>? Lignes, decimal Montant)> pied) =>
        pied.Select((e, i) =>
        {
            var masque = false;
            if (e.Genre == "total" && e.Cle != "NET")
            {
                var suivant = pied.Skip(i + 1).FirstOrDefault(x => x.Genre != "groupe");
                masque = suivant.Genre is not null && suivant.Montant == e.Montant;
            }
            return new EntreePied(e.Genre, e.Cle, e.LigId, e.Lignes, e.Montant, masque);
        }).ToList();

    /// <summary>Totaux de l'entête ; une spécialisation y ajoute ses propres valeurs.</summary>
    protected virtual void EcrireTotaux(VentilationTva tva, decimal cumul)
    {
        Doc.EntTotalHt = tva.Base;
        Doc.EntTotalTva = tva.Net;
        Doc.EntTotalTtc = tva.Base + tva.Net;
        Doc.EntNetAPayer = cumul;
        Doc.EntVersionCalcul = Version;
    }

    private void RepartirSurBases(Dictionary<int, BaseTva> bases, decimal montant, TLigne p)
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
            var part = Arrondir(montant * entrees[i].Base / total, PrecMontant);
            entrees[i].Base += part;
            reste -= part;
        }
        entrees[^1].Base += reste;
    }

    /// <summary>Ventilation par taux selon la catégorie : Normale, Autoliquidation, Intracommunautaire, Exonérée.</summary>
    private VentilationTva CalculerTva(Dictionary<int, BaseTva> bases)
    {
        decimal total = 0, net = 0;
        var lignes = new List<DocumentTva>();
        foreach (var e in bases.Values.OrderBy(e => e.Code, StringComparer.Ordinal))
        {
            var b = Arrondir(e.Base, PrecMontant);
            var calcule = Arrondir(b * e.Taux / 100, PrecMontant);
            decimal montant = calcule, annulation = 0;
            if (e.Categorie == "A") montant = 0;
            else if (e.Categorie == "I") annulation = -calcule;
            var n = montant + annulation;
            total += b;
            net += n;
            lignes.Add(new DocumentTva
            {
                TvaEntId = Doc.EntId,
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
        return new VentilationTva(lignes, total, net);
    }

    // ------------------------------------------------------------------ passe 6 : libellés

    /// <summary>Libellé HTML d'où part le libellé affiché (une spécialisation peut le calculer : métré en script…).</summary>
    protected virtual string? SourceLibelle(TLigne l) => l.LigLibelleHtml;

    protected virtual void PasseLibelles()
    {
        if (Entree.Options.LibellesFiges) return;
        foreach (var l in Ordre)
        {
            object? Resoudre(string texte)
            {
                var r = References.Analyser(texte);
                if (r is ReferenceVariable v) return LireVariable(v.Portee, v.Nom, l);
                return LireDonnee((ReferenceDonnee)r, l, PhaseCalcul.Libelle);
            }
            var (texteAffiche, inconnues) = Libelles.Remplacer(SourceLibelle(l), Resoudre);
            foreach (var (_, message) in inconnues) Avertir(l.LigId, "VARIABLE_LIBELLE", $"Libellé : {message}");
            l.LigLibelleAffiche = texteAffiche;
            l.LigLibelleBrut = Libelles.TexteBrut(texteAffiche);
        }
    }

    // ------------------------------------------------------------------ résultat

    /// <summary>Résultat du calcul ; une spécialisation renvoie son propre type (métrés, variables…).</summary>
    protected virtual ResultatDocument<TDoc, TLigne> CreerResultat() => Remplir(new ResultatDocument<TDoc, TLigne>());

    protected TResultat Remplir<TResultat>(TResultat r) where TResultat : ResultatDocument<TDoc, TLigne>
    {
        r.VersionMoteur = Version;
        r.Document = Doc;
        r.Lignes = Ordre;
        r.Tva = Tva;
        r.Pied = Pied;
        r.Erreurs = Erreurs;
        r.Avertissements = Avertissements;
        return r;
    }
}
