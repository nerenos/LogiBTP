namespace LogiBTP.Comptabilite;

/// <summary>
/// Stock d'une nature d'article en fin d'exercice (comptes déjà résolus par la ventilation des types STOCK, STOCK_VARIATION et
/// STOCK_PROVISION) : valeur au début et à la fin, provision pour dépréciation au début et à la fin (toutes positives).
/// </summary>
public sealed record StockNature(string Nature, string? CompteStock, string? CompteVariation, string? CompteProvision, decimal Initial, decimal Final,
    decimal ProvisionInitiale = 0, decimal ProvisionFinale = 0);

/// <summary>Comptes de la dotation (charge) et de la reprise (produit) de la provision pour dépréciation des stocks.</summary>
public sealed record ComptesDepreciation(string? Dotation, string? Reprise);

/// <summary>Opération diverse du stock : lignes signées (positif = débit), codes d'erreur et, pour chacun, les natures en cause.</summary>
public sealed record OdStock(List<LigneOd> Lignes, List<string> Erreurs, Dictionary<string, List<string>> Details);

/// <summary>
/// Écritures de fin d'exercice du stock (plans/stock.md, lot 9 ; ANALYSE-MODULE-STOCK.md Q9), règle du serveur seul, jeu
/// modules/comptabilite/tests/cas/04_stock_compta.json. Par nature d'article, montants arrondis au centime (demi vers l'infini) :
/// - variation de stock = stock final − stock initial : compte de stock au débit (stock en hausse) ou au crédit, compte de variation
///   en face (variation des stocks) ;
/// - dépréciation = provision finale − provision initiale : dotation (compte de charge au débit, provision au crédit) si positive,
///   reprise (provision au débit, compte de produit au crédit) si négative.
/// Une nature dont un compte nécessaire manque est écartée de l'opération et signalée (jamais d'écriture partielle) ; les natures
/// restantes gardent leurs lignes. Une opération en erreur n'est pas exportée.
/// </summary>
public static class ReglesStockCompta
{
    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["STOCK_COMPTE_STOCK"] = "Nature sans compte de stock",
        ["STOCK_COMPTE_VARIATION"] = "Nature sans compte de variation des stocks",
        ["STOCK_COMPTE_PROVISION"] = "Nature sans compte de provision pour dépréciation",
        ["STOCK_COMPTE_DOTATION"] = "Compte de dotation à la provision manquant",
        ["STOCK_COMPTE_REPRISE"] = "Compte de reprise sur provision manquant",
        ["STOCK_PROVISION_NEGATIVE"] = "Provision négative",
    };

    private static bool Vide(string? compte) => string.IsNullOrWhiteSpace(compte);

    public static OdStock Cloturer(IReadOnlyList<StockNature> natures, ComptesDepreciation comptes)
    {
        var lignes = new List<LigneOd>();
        var erreurs = new List<string>();
        var details = new Dictionary<string, List<string>>();
        void Erreur(string code, string nature)
        {
            if (!erreurs.Contains(code)) erreurs.Add(code);
            if (!details.TryGetValue(code, out var l)) details[code] = l = [];
            if (!l.Contains(nature)) l.Add(nature);
        }
        foreach (var n in natures)
        {
            if (n.ProvisionInitiale < 0 || n.ProvisionFinale < 0) { Erreur("STOCK_PROVISION_NEGATIVE", n.Nature); continue; }
            var variation = ReglesEcritures.Arrondir(n.Final) - ReglesEcritures.Arrondir(n.Initial);
            var dotation = ReglesEcritures.Arrondir(n.ProvisionFinale) - ReglesEcritures.Arrondir(n.ProvisionInitiale);
            var propres = new List<LigneOd>();
            var ok = true;
            if (variation != 0)
            {
                if (Vide(n.CompteStock)) { Erreur("STOCK_COMPTE_STOCK", n.Nature); ok = false; }
                if (Vide(n.CompteVariation)) { Erreur("STOCK_COMPTE_VARIATION", n.Nature); ok = false; }
                propres.Add(new(n.CompteStock, $"Variation de stock – {n.Nature}", variation));
                propres.Add(new(n.CompteVariation, $"Variation de stock – {n.Nature}", -variation));
            }
            if (dotation != 0)
            {
                var libelle = dotation > 0 ? $"Dotation à la provision pour dépréciation des stocks – {n.Nature}" : $"Reprise sur la provision pour dépréciation des stocks – {n.Nature}";
                var compte = dotation > 0 ? comptes.Dotation : comptes.Reprise;
                if (Vide(compte)) { Erreur(dotation > 0 ? "STOCK_COMPTE_DOTATION" : "STOCK_COMPTE_REPRISE", n.Nature); ok = false; }
                if (Vide(n.CompteProvision)) { Erreur("STOCK_COMPTE_PROVISION", n.Nature); ok = false; }
                propres.Add(new(compte, libelle, dotation));
                propres.Add(new(n.CompteProvision, libelle, -dotation));
            }
            if (ok) lignes.AddRange(propres);
        }
        return new OdStock(lignes, erreurs, details);
    }
}
