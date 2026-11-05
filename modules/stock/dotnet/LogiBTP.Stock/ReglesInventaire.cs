namespace LogiBTP.Stock;

/// <summary>Ligne d'un bordereau d'inventaire : quantité null = non comptée.</summary>
public sealed record LigneInventaire(long Bordereau, long Ele, long? Emp, decimal? Quantite, decimal? Prix, bool AppliquerPmp, string? Commentaire, string? Lot = null);

/// <summary>Comptage d'un article ; Lots (numéro, quantité) seulement si une ligne de l'article porte un lot (le reste est sans lot).</summary>
public sealed record ComptageLot(long Ele, decimal Quantite, decimal? Prix, bool AppliquerPmp, string? Commentaire, int Lignes, List<PartLot>? Lots = null);

public sealed record AvertissementInventaire(string Code, long Ele, long Emp, int Nombre);

public sealed record ErreurInventaire(string Code, long Ele);

public sealed record ControleLot(List<ComptageLot> Comptages, List<AvertissementInventaire> Avertissements, List<ErreurInventaire> Erreurs);

/// <summary>
/// Contrôle d'un lot d'inventaire (ANALYSE-MODULE-STOCK.md § 5.3, S6, S30), répliqué dans inventaire.js (jeu
/// modules/stock/tests/cas/03_inventaire.json) : cumul par article des lignes comptées de tous les bordereaux (ligne sans
/// quantité ignorée : l'article n'est pas mis à 0), article compté plusieurs fois au même emplacement signalé, prix
/// d'inventaire unique par article, « Appliquer au PMP » avec un prix.
/// </summary>
public static class ReglesInventaire
{
    public static readonly Dictionary<string, string> Messages = new()
    {
        ["INV_DOUBLON_EMPLACEMENT"] = "Article compté plusieurs fois au même emplacement : les quantités sont cumulées",
        ["INV_QUANTITE_NEGATIVE"] = "Quantité comptée négative",
        ["INV_PRIX_DIFFERENTS"] = "Deux prix d'inventaire différents pour le même article",
        ["INV_PMP_SANS_PRIX"] = "« Appliquer au PMP » sans prix saisi",
    };

    private sealed class Cumul
    {
        public decimal Quantite;
        public readonly List<decimal> Prix = [];
        public bool Appliquer;
        public readonly List<string> Commentaires = [];
        public int Lignes;
        public readonly List<(string Cle, string Numero, decimal Quantite)> Lots = [];
    }

    public static ControleLot Controler(IReadOnlyList<LigneInventaire> lignes)
    {
        var parArticle = new List<(long Ele, Cumul C)>();
        var parEmplacement = new List<(long Ele, long Emp, string Lot, int Nombre)>();
        var erreurs = new List<ErreurInventaire>();
        foreach (var l in lignes)
        {
            if (l.Quantite is not { } q) continue;
            if (q < 0) erreurs.Add(new("INV_QUANTITE_NEGATIVE", l.Ele));
            var i = parArticle.FindIndex(x => x.Ele == l.Ele);
            if (i < 0) { parArticle.Add((l.Ele, new Cumul())); i = parArticle.Count - 1; }
            var a = parArticle[i].C;
            a.Quantite += q;
            if (l.Prix is { } p && !a.Prix.Contains(p)) a.Prix.Add(p);
            a.Appliquer |= l.AppliquerPmp;
            var c = l.Commentaire?.Trim();
            if (!string.IsNullOrEmpty(c) && !a.Commentaires.Contains(c)) a.Commentaires.Add(c);
            a.Lignes++;
            var numero = ReglesTracabilite.Numero(l.Lot);
            var cleLot = numero?.ToUpperInvariant() ?? "";
            if (numero is not null)
            {
                var j = a.Lots.FindIndex(x => x.Cle == cleLot);
                if (j < 0) a.Lots.Add((cleLot, numero, q));
                else a.Lots[j] = (cleLot, a.Lots[j].Numero, a.Lots[j].Quantite + q);
            }
            if (l.Emp is { } emp)
            {
                var k = parEmplacement.FindIndex(x => x.Ele == l.Ele && x.Emp == emp && x.Lot == cleLot);
                if (k < 0) parEmplacement.Add((l.Ele, emp, cleLot, 1));
                else parEmplacement[k] = (l.Ele, emp, cleLot, parEmplacement[k].Nombre + 1);
            }
        }
        var comptages = new List<ComptageLot>();
        foreach (var (ele, a) in parArticle)
        {
            if (a.Prix.Count > 1) erreurs.Add(new("INV_PRIX_DIFFERENTS", ele));
            if (a.Appliquer && a.Prix.Count == 0) erreurs.Add(new("INV_PMP_SANS_PRIX", ele));
            comptages.Add(new(ele, a.Quantite, a.Prix.Count == 1 ? a.Prix[0] : null, a.Appliquer && a.Prix.Count == 1,
                a.Commentaires.Count > 0 ? string.Join(" ; ", a.Commentaires) : null, a.Lignes,
                a.Lots.Count > 0 ? a.Lots.Select(x => new PartLot(x.Numero, x.Quantite)).ToList() : null));
        }
        return new(comptages, parEmplacement.Where(x => x.Nombre > 1).Select(x => new AvertissementInventaire("INV_DOUBLON_EMPLACEMENT", x.Ele, x.Emp, x.Nombre)).ToList(), erreurs);
    }
}
