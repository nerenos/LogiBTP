namespace LogiBTP.Stock;

/// <summary>Besoin d'une demande d'appro : article, quantité en unité de stock, date de besoin, dépôt préféré.</summary>
public sealed record BesoinStock(string Id, string Article, decimal Quantite, string DateBesoin, string? DepotPrefere = null);

/// <summary>Article d'un dépôt : stock présent, mini / maxi, entrées et sorties prévues (projection).</summary>
public sealed record ArticleDuDepot(string Article, decimal Stock, decimal? Mini, decimal? Maxi, IReadOnlyList<EvenementPrevu> Evenements);

public sealed record DepotDisponible(string Id, IReadOnlyList<ArticleDuDepot> Articles);

/// <summary>Commande fournisseur en cours : reste à recevoir non affecté (hors des événements des dépôts).</summary>
public sealed record CommandeARecevoir(string Id, string Article, decimal Reste, string DateLivraison, string? Fournisseur);

/// <summary>Fournisseur principal et conditionnement (quantité en unité de stock d'une unité d'achat) d'un article.</summary>
public sealed record ArticleFournisseur(string Article, string? Fournisseur, decimal Conditionnement = 1);

/// <summary>Part d'un besoin : STOCK (Depot), COMMANDE (Commande) ou ACHAT (Fournisseur, UnitesAchat).</summary>
public sealed record PartBesoin(string Nature, string? Depot, string? Commande, string? Fournisseur, decimal Quantite, decimal? UnitesAchat);

public sealed record BesoinVentile(string Id, string Article, decimal Quantite, List<PartBesoin> Parts);

public sealed record LigneReappro(string Article, string Motif, decimal Disponible, decimal? Mini, decimal? Maxi, decimal Quantite, decimal UnitesAchat);

public sealed record FournisseurReappro(string? Fournisseur, List<LigneReappro> Lignes);

public sealed record DemandeReappro(string Depot, List<FournisseurReappro> Fournisseurs);

public sealed record VentilationStock(List<BesoinVentile> Besoins, List<DemandeReappro> Reappros);

/// <summary>
/// Ventilation des besoins d'une demande d'appro (ANALYSE-MODULE-MCP.md § 7.2, plan mcp.md lot 8, décision Q10), répliquée
/// dans ventilation.js (jeu modules/stock/tests/cas/07_ventilation.json) : besoins servis par date puis ordre reçu ; 1) stock
/// des dépôts (préféré d'abord), prenable = disponible projeté le plus bas de la date de besoin à la fin, jamais négatif (aucune
/// rupture créée, le mini peut être franchi) ; 2) commandes en cours livrées au plus tard à la date de besoin, la plus tôt
/// d'abord ; 3) achat au fournisseur principal, au conditionnement supérieur. Dépôt dont un article prélevé finit sous son
/// mini : demande de réappro (maxi, sinon mini) avec les articles du dépôt au plus à <c>procheMini</c> % au-dessus de leur
/// mini, regroupés par fournisseur principal. Seul arrondi : <see cref="AuConditionnement"/>.
/// </summary>
public static class ReglesVentilation
{
    public const decimal ProcheMiniDefaut = 20;

    private static string Jour(string d) => d[..Math.Min(10, d.Length)];

    private sealed class Etat(ArticleDuDepot a)
    {
        public readonly ArticleDuDepot Article = a;
        public readonly List<EvenementPrevu> Prelevements = [];
        public decimal Preleve;
    }

    /// <summary>Seul arrondi de la règle : quantité → unités d'achat entières (conditionnement &gt; 0, sinon unité entière supérieure).</summary>
    public static (decimal Quantite, decimal UnitesAchat) AuConditionnement(decimal quantite, decimal conditionnement = 1)
    {
        var unites = conditionnement > 0 ? Math.Ceiling(quantite / conditionnement) : Math.Ceiling(quantite);
        return (conditionnement > 0 ? unites * conditionnement : unites, unites);
    }

    private static Projection Projeter(string aujourdhui, Etat e) =>
        ReglesProjection.Projeter(e.Article.Stock, aujourdhui, [.. e.Article.Evenements, .. e.Prelevements]);

    private static decimal Prenable(string aujourdhui, Etat e, string date)
    {
        var points = Projeter(aujourdhui, e).Points;
        var min = e.Article.Stock;
        foreach (var p in points) if (string.CompareOrdinal(p.Date, date) <= 0) min = p.Disponible;
        foreach (var p in points) if (string.CompareOrdinal(p.Date, date) > 0 && p.Disponible < min) min = p.Disponible;
        return min > 0 ? min : 0m;
    }

    public static VentilationStock Ventiler(string aujourdhui, IReadOnlyList<BesoinStock> besoins, IReadOnlyList<DepotDisponible> depots,
        IReadOnlyList<CommandeARecevoir> commandes, IReadOnlyList<ArticleFournisseur> articles, decimal procheMini = ProcheMiniDefaut)
    {
        var auj = Jour(aujourdhui);
        string AuPlusTot(string d) { var j = Jour(d); return string.CompareOrdinal(j, auj) < 0 ? auj : j; }
        var etats = new Dictionary<(string, string), Etat>();
        foreach (var d in depots) foreach (var a in d.Articles) etats[(d.Id, a.Article)] = new Etat(a);
        var fiches = new Dictionary<string, ArticleFournisseur>();
        foreach (var a in articles) fiches.TryAdd(a.Article, a);
        var restes = commandes.Select(c => c.Reste).ToArray();
        var ids = depots.Select(d => d.Id).ToList();

        var resultats = new BesoinVentile[besoins.Count];
        foreach (var (b, i, d) in besoins.Select((b, i) => (b, i, AuPlusTot(b.DateBesoin))).OrderBy(x => x.Item3, StringComparer.Ordinal).ThenBy(x => x.i))
        {
            var parts = new List<PartBesoin>();
            var reste = b.Quantite;
            var rangs = b.DepotPrefere is { } pref && ids.Contains(pref) ? [pref, .. ids.Where(x => x != pref)] : ids;
            foreach (var depot in rangs)
            {
                if (reste <= 0) break;
                if (!etats.TryGetValue((depot, b.Article), out var e)) continue;
                var q = Math.Min(reste, Prenable(auj, e, d));
                if (q <= 0) continue;
                e.Prelevements.Add(new EvenementPrevu($"V:{b.Id}", "SORTIE", d, q));
                e.Preleve += q;
                reste -= q;
                parts.Add(new PartBesoin(NaturePartAppro.Stock, depot, null, null, q, null));
            }
            var eligibles = commandes.Select((c, k) => (c, k)).Where(x => x.c.Article == b.Article && string.CompareOrdinal(AuPlusTot(x.c.DateLivraison), d) <= 0)
                .OrderBy(x => AuPlusTot(x.c.DateLivraison), StringComparer.Ordinal).ThenBy(x => x.k);
            foreach (var (c, k) in eligibles)
            {
                if (reste <= 0) break;
                var q = Math.Min(reste, restes[k]);
                if (q <= 0) continue;
                restes[k] -= q;
                reste -= q;
                parts.Add(new PartBesoin(NaturePartAppro.Commande, null, c.Id, null, q, null));
            }
            if (reste > 0)
            {
                var f = fiches.GetValueOrDefault(b.Article);
                var (q, u) = AuConditionnement(reste, f?.Conditionnement ?? 1);
                parts.Add(new PartBesoin(NaturePartAppro.Achat, null, null, f?.Fournisseur, q, u));
            }
            resultats[i] = new BesoinVentile(b.Id, b.Article, b.Quantite, parts);
        }

        var reappros = new List<DemandeReappro>();
        foreach (var depot in depots)
        {
            var franchis = new List<(Etat E, decimal Min, string Motif)>();
            var proches = new List<(Etat E, decimal Min, string Motif)>();
            foreach (var a in depot.Articles)
            {
                var e = etats[(depot.Id, a.Article)];
                if (a.Mini is not { } mini) continue;
                var min = Projeter(auj, e).Minimum.Disponible;
                if (e.Preleve > 0 && min < mini) franchis.Add((e, min, MotifReappro.MiniFranchi));
                else if (min <= mini * (100 + procheMini) / 100) proches.Add((e, min, MotifReappro.ProcheMini));
            }
            if (franchis.Count == 0) continue;
            var groupes = new List<FournisseurReappro>();
            foreach (var (e, min, motif) in franchis.Concat(proches))
            {
                var a = e.Article;
                var besoin = (a.Maxi ?? a.Mini!.Value) - min;
                if (besoin <= 0) continue;
                var f = fiches.GetValueOrDefault(a.Article);
                var (q, u) = AuConditionnement(besoin, f?.Conditionnement ?? 1);
                var g = groupes.FirstOrDefault(x => x.Fournisseur == f?.Fournisseur);
                if (g is null) { g = new FournisseurReappro(f?.Fournisseur, []); groupes.Add(g); }
                g.Lignes.Add(new LigneReappro(a.Article, motif, min, a.Mini, a.Maxi, q, u));
            }
            reappros.Add(new DemandeReappro(depot.Id, groupes));
        }
        return new VentilationStock([.. resultats], reappros);
    }
}
