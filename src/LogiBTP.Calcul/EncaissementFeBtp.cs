using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.Socle;

namespace LogiBTP.Calcul;

/// <summary>Montant d'un taux de TVA (ventilation TTC d'une facture, montant encaissé MDT-215 / MDT-224).</summary>
public sealed record MontantTauxFe(decimal Taux, decimal Montant);

/// <summary>Écart d'un pointage (règlement × échéance) : pointé − déjà déclaré ; négatif : annulation d'encaissement.</summary>
public sealed record EcartEncaissementFe(string Cle, decimal Montant);

/// <summary>Données d'une facture émise pour ses statuts Encaissée (voir <see cref="EncaissementFeBtp.Proposer"/>).</summary>
public sealed record EntreeEncaissementFe
{
    /// <summary>TTC par taux de la facture émise (BG-23 : base + TVA), du signe de ses échéances (avoir : négatif).</summary>
    public IReadOnlyList<MontantTauxFe> Ventilation { get; init; } = [];
    /// <summary>Part des services : HT des lignes vendues de services sur le HT des lignes vendues (S : 1 / 1).</summary>
    public decimal ServicesHt { get; init; } = 1;
    public decimal TotalHt { get; init; } = 1;
    /// <summary>Montants déjà déclarés (envoyés ou écartés) par taux.</summary>
    public IReadOnlyList<MontantTauxFe> Declare { get; init; } = [];
    /// <summary>Pointages déjà déclarés (envoyés ou écartés) de la facture.</summary>
    public decimal Cumul { get; init; }
    /// <summary>Écarts à proposer, dans l'ordre (règlement puis échéance).</summary>
    public IReadOnlyList<EcartEncaissementFe> Ecarts { get; init; } = [];
}

/// <summary>Statut Encaissée proposé : pointage, montant pointé (signé), annulation (cas 34), montants encaissés par taux.</summary>
public sealed record PropositionEncaissementFe(string Cle, decimal Montant, bool Annulation, IReadOnlyList<MontantTauxFe> Encaissements);

/// <summary>
/// Statut Encaissée (212) d'une facture émise (plans/facturation-electronique.md, lot 26 ; Q15, XP Z12-014 cas 26 et 34).
/// Réplique de client/src/calcul/encaissement-fe.js (jeu tests/emission-fe/03_encaissement.json).
/// - Concernée : cadre de services ou mixte (S*, M*) sans TVA sur les débits (BT-8 ≠ 5) ;
/// - part des services : services / total des lignes vendues (mixte), 1 pour des services ;
/// - montants encaissés au cumul c des pointages : total arrondi(c × services / total), réparti au prorata du TTC de chaque
///   taux (arrondi(c × TTC du taux × services / (TTC × total))), le dernier taux recevant le reste ;
///   chaque proposition = montant au nouveau cumul − déjà déclaré du taux : les versements partiels et les annulations se
///   compensent au centime, et la facture entièrement payée donne exactement le TTC de chaque taux (services) ;
/// - annulation d'encaissement (pointage diminué ou supprimé après un envoi) : écart de signe contraire, montants négatifs.
/// </summary>
public static class EncaissementFeBtp
{
    /// <summary>Facture concernée : cadre BT-23 de services ou mixte, et pas de TVA sur les débits (BT-8 = 5).</summary>
    public static bool Concerne(string? cadre, string? codeExigibilite) =>
        !string.IsNullOrEmpty(cadre) && (cadre[0] == 'S' || cadre[0] == 'M') && codeExigibilite != CodeExigibiliteTva.DateFacture;

    /// <summary>HT des lignes vendues de services et HT de toutes les lignes vendues (lig_montant_ht).</summary>
    public static (decimal Services, decimal Total) PartServices(IReadOnlyList<DocumentLigneBtp> lignes, IReadOnlyDictionary<int, string> naturesFe)
    {
        decimal services = 0, total = 0;
        foreach (var l in EmissionFeBtp.LignesVendues(lignes))
        {
            var m = l.LigMontantHt ?? 0;
            total += m;
            if (EmissionFeBtp.NatureLigne(l, naturesFe) == NaturesFe.Services) services += m;
        }
        return (services, total);
    }

    /// <summary>Ventilation regroupée par taux (ordre de première apparition).</summary>
    private static List<MontantTauxFe> ParTaux(IEnumerable<MontantTauxFe> v)
    {
        var r = new List<MontantTauxFe>();
        foreach (var x in v)
        {
            var i = r.FindIndex(y => y.Taux == x.Taux);
            if (i < 0) r.Add(x);
            else r[i] = r[i] with { Montant = r[i].Montant + x.Montant };
        }
        return r;
    }

    /// <summary>Montant encaissé de chaque taux au cumul des pointages.</summary>
    public static List<MontantTauxFe> Repartir(IReadOnlyList<MontantTauxFe> ventilation, decimal servicesHt, decimal totalHt, decimal cumul)
    {
        var v = ParTaux(ventilation);
        var ttc = v.Sum(x => x.Montant);
        if (ttc == 0 || totalHt == 0) return v.Select(x => x with { Montant = 0 }).ToList();
        // Total arrondi une fois ; chaque taux au prorata, le dernier reçoit le reste (la somme suit le pointage).
        var reste = ArrondiCalcul.Arrondir(cumul * servicesHt / totalHt, 2);
        var r = new List<MontantTauxFe>();
        for (var i = 0; i < v.Count; i++)
        {
            var m = i == v.Count - 1 ? reste : ArrondiCalcul.Arrondir(cumul * v[i].Montant * servicesHt / (ttc * totalHt), 2);
            reste -= m;
            r.Add(v[i] with { Montant = m });
        }
        return r;
    }

    /// <summary>Statuts Encaissée proposés pour les écarts d'une facture (écart nul : rien).</summary>
    public static List<PropositionEncaissementFe> Proposer(EntreeEncaissementFe e)
    {
        var v = ParTaux(e.Ventilation);
        var ttc = v.Sum(x => x.Montant);
        var declare = v.ToDictionary(x => x.Taux, _ => 0m);
        foreach (var d in e.Declare)
            declare[d.Taux] = (declare.TryGetValue(d.Taux, out var x) ? x : 0) + d.Montant;
        var cumul = e.Cumul;
        var r = new List<PropositionEncaissementFe>();
        foreach (var ecart in e.Ecarts)
        {
            if (ecart.Montant == 0) continue;
            cumul += ecart.Montant;
            var encaissements = new List<MontantTauxFe>();
            foreach (var a in Repartir(v, e.ServicesHt, e.TotalHt, cumul))
            {
                var m = a.Montant - declare[a.Taux];
                declare[a.Taux] = a.Montant;
                if (m != 0) encaissements.Add(new MontantTauxFe(a.Taux, m));
            }
            r.Add(new PropositionEncaissementFe(ecart.Cle, ecart.Montant, ecart.Montant * ttc < 0, encaissements));
        }
        return r;
    }
}
