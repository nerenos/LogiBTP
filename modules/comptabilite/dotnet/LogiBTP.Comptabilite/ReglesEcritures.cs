namespace LogiBTP.Comptabilite;

/// <summary>Ligne de produit ou de charge d'une pièce : compte (déjà ventilé), taux de TVA (code), montant HT servant de poids.</summary>
public sealed record LignePiece(string? Compte, string? Taux, decimal Montant, string? Erreur = null);

/// <summary>
/// Poste de pied (HT : dans la base de TVA ; TTC : après la TVA, déduit du tiers), montant signé tel que saisi ; compte
/// auxiliaire pour un poste porté sur un compte de tiers (retenue de garantie). Acompte : déduction TTC d'un acompte
/// tenu en trésorerie (compte d'acompte en HT, TVA déjà collectée ou déduite à son encaissement ou à son paiement).
/// </summary>
public sealed record PostePiece(string Libelle, string? Compte, decimal Montant, string? Auxiliaire = null, bool Acompte = false);

/// <summary>TVA d'un taux : base et montant nets, comportement (N, A, I, E), exigibilité (E encaissements, D débits) et comptes.</summary>
public sealed record TvaPiece(string Taux, decimal TauxPct, decimal Base, decimal Montant, string Comportement, string Exigibilite,
    string? CompteCollectee, string? CompteEncaissement, string? CompteDeductible, string? CompteAutoliquidee);

/// <summary>Échéance du tiers : date, montant, retenue de garantie.</summary>
public sealed record EcheancePiece(DateOnly? Date, decimal Montant, bool Retenue);

/// <summary>
/// Pièce à transférer, vue par la règle : journal, sens (VENTE : tiers au débit ; ACHAT : tiers au crédit), signe (-1 : avoir
/// saisi en positif), tiers (collectif + compte auxiliaire), lignes, postes HT et TTC, TVA, échéances (vide : net = TTC +
/// postes TTC), compte de la retenue (null : collectif du tiers), comptes d'écart d'arrondi, analytique.
/// </summary>
public sealed record PieceComptable(long Id, string Journal, DateOnly Date, string Numero, string? Reference, string Libelle, string Sens, int Signe,
    string? Collectif, string? CompteTiers, IReadOnlyList<LignePiece> Lignes, IReadOnlyList<PostePiece> PostesHt, IReadOnlyList<PostePiece> PostesTtc,
    IReadOnlyList<TvaPiece> Tva, IReadOnlyList<EcheancePiece> Echeances, decimal TotalTtc, string? CompteRetenue, string? CompteDefaut,
    string? CompteEcartDebit, string? CompteEcartCredit, string? Analytique);

/// <summary>Ligne d'écriture : compte général, compte auxiliaire (tiers), libellé, débit ou crédit (positifs), échéance.</summary>
public sealed record LigneEcriture(string Journal, DateOnly Date, string Piece, string? Reference, string Compte, string? Auxiliaire, string Libelle,
    decimal Debit, decimal Credit, DateOnly? Echeance, string? Analytique);

/// <summary>Écriture : lignes, codes d'erreur et, pour chaque code, les libellés des lignes en cause.</summary>
public sealed record Ecriture(long Piece, List<LigneEcriture> Lignes, List<string> Erreurs, Dictionary<string, List<string>> Details);

/// <summary>
/// Écriture d'une pièce de vente, d'achat ou de sous-traitance (ANALYSE-MODULE-COMPTABILITE.md § 4.6, § 6) ; jeu
/// modules/comptabilite/tests/cas/03_ecritures.json (règle du serveur seul : l'export n'est calculé que par lui).
/// Produits ou charges : la base HT de chaque taux, moins sa part des postes HT, répartie entre les comptes des lignes du
/// taux au prorata de leurs montants (le plus fort absorbe l'arrondi ; un taux sans ligne va au compte par défaut) ;
/// postes HT et TTC sur leur compte ; TVA par taux (collectée à l'encaissement ou sur les débits, déductible,
/// autoliquidée due et déductible sur la base) ; déduction d'un acompte tenu en trésorerie : part HT au compte d'acompte,
/// part de TVA (au prorata du TTC de chaque taux) retirée de la TVA de la pièce, déjà collectée ou déduite à
/// l'encaissement ou au paiement de l'acompte (la TVA n'est jamais comptée deux fois) ; tiers par échéance, la retenue de garantie sur son compte ; écart
/// d'équilibre jusqu'à 0,05 sur le compte d'écart, au-delà erreur. Montants arrondis au centime (demi vers l'infini).
/// </summary>
public static class ReglesEcritures
{
    public const decimal ToleranceEcart = 0.05m;

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["COMPTE_INTROUVABLE"] = "Ligne sans compte (ventilation)",
        ["POSTE_SANS_COMPTE"] = "Poste de pied sans compte",
        ["TVA_SANS_COMPTE"] = "Taux de TVA sans compte",
        ["TIERS_SANS_COMPTE"] = "Tiers sans compte auxiliaire ou sans collectif",
        ["DESEQUILIBRE"] = "Écriture déséquilibrée",
        ["ECART_SANS_COMPTE"] = "Écart d'arrondi sans compte",
    };

    public static decimal Arrondir(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    /// <summary>Répartit un total entre des poids, au prorata ; la plus forte part (en valeur absolue) absorbe l'arrondi.</summary>
    public static List<decimal> Repartir(decimal total, IReadOnlyList<decimal> poids)
    {
        var somme = poids.Sum();
        if (poids.Count == 0) return [];
        var parts = poids.Select(p => somme == 0 ? 0m : Arrondir(total * p / somme)).ToList();
        if (somme == 0) parts[0] = total;
        var reste = Arrondir(total) - parts.Sum();
        if (reste != 0)
        {
            var i = parts.Select((p, k) => (p, k)).OrderByDescending(x => Math.Abs(poids[x.k])).First().k;
            parts[i] += reste;
        }
        return parts;
    }

    public static Ecriture Ecrire(PieceComptable p)
    {
        var lignes = new List<LigneEcriture>();
        var erreurs = new List<string>();
        var details = new Dictionary<string, List<string>>();
        var vente = p.Sens == "VENTE";
        // Montant signé du point de vue de la pièce : positif = sens naturel (produit au crédit d'une vente).
        void Ajouter(string? compte, string? auxiliaire, string libelle, decimal montant, bool debitNaturel, DateOnly? echeance, string erreur)
        {
            var m = Arrondir(montant * p.Signe);
            if (m == 0) return;
            if (string.IsNullOrWhiteSpace(compte))
            {
                if (!erreurs.Contains(erreur)) erreurs.Add(erreur);
                var d = details.TryGetValue(erreur, out var x) ? x : details[erreur] = [];
                if (!d.Contains(libelle)) d.Add(libelle);
                return;
            }
            var debit = debitNaturel ^ (m < 0);
            var a = Math.Abs(m);
            lignes.Add(new(p.Journal, p.Date, p.Numero, p.Reference, compte, auxiliaire, libelle, debit ? a : 0, debit ? 0 : a, echeance, p.Analytique));
        }
        // Produits (vente : crédit) ou charges (achat : débit) : débit naturel de ces lignes = achat.
        var produitDebit = !vente;
        foreach (var l in p.Lignes.Where(l => l.Erreur is not null)) if (!erreurs.Contains(l.Erreur!)) erreurs.Add(l.Erreur!);
        var postesHt = p.PostesHt.Sum(x => x.Montant);
        var poidsTaux = p.Tva.Select(t => p.Lignes.Where(l => l.Taux == t.Taux).Sum(l => l.Montant)).ToList();
        var partsPostes = Repartir(postesHt, poidsTaux.Any(x => x != 0) ? poidsTaux : p.Tva.Select(t => t.Base).ToList());
        for (var i = 0; i < p.Tva.Count; i++)
        {
            var t = p.Tva[i];
            var cible = Arrondir(t.Base) - partsPostes[i];
            var lignesTaux = p.Lignes.Where(l => l.Taux == t.Taux && l.Montant != 0).ToList();
            if (lignesTaux.Count == 0)
            {
                Ajouter(p.CompteDefaut, null, p.Libelle, cible, produitDebit, null, "COMPTE_INTROUVABLE");
                continue;
            }
            // Regroupées par compte, dans l'ordre de première apparition.
            var parCompte = lignesTaux.GroupBy(l => l.Compte ?? "").Select(g => (Compte: g.Key, Poids: g.Sum(l => l.Montant))).ToList();
            var parts = Repartir(cible, parCompte.Select(x => x.Poids).ToList());
            for (var k = 0; k < parCompte.Count; k++)
                Ajouter(parCompte[k].Compte, null, p.Libelle, parts[k], produitDebit, null, "COMPTE_INTROUVABLE");
        }
        foreach (var x in p.PostesHt) Ajouter(x.Compte, null, $"{p.Libelle} – {x.Libelle}", x.Montant, produitDebit, null, "POSTE_SANS_COMPTE");
        // TVA : collectée au crédit d'une vente, déductible au débit d'un achat ; autoliquidation d'un achat : déductible et due.
        bool TvaPostee(TvaPiece t) => vente ? t.Comportement is "N" or "E" : t.Comportement is not ("A" or "I");
        string? CompteTva(TvaPiece t) => vente ? (t.Exigibilite == "D" ? t.CompteCollectee : t.CompteEncaissement ?? t.CompteCollectee) : t.CompteDeductible;
        foreach (var t in p.Tva)
        {
            var lib = $"{p.Libelle} – TVA {t.Taux}";
            if (vente)
            {
                if (TvaPostee(t)) Ajouter(CompteTva(t), null, lib, t.Montant, false, null, "TVA_SANS_COMPTE");
            }
            else if (t.Comportement is "A" or "I")
            {
                var due = Arrondir(t.Base * t.TauxPct / 100m);
                Ajouter(t.CompteDeductible, null, lib, due, true, null, "TVA_SANS_COMPTE");
                Ajouter(t.CompteAutoliquidee, null, lib, due, false, null, "TVA_SANS_COMPTE");
            }
            else Ajouter(t.CompteDeductible, null, lib, t.Montant, true, null, "TVA_SANS_COMPTE");
        }
        // Postes après la TVA (déductions : acompte, paiement direct…) : contrepartie du tiers.
        foreach (var x in p.PostesTtc)
        {
            if (!x.Acompte || p.Tva.Count == 0)
            {
                Ajouter(x.Compte, x.Auxiliaire, $"{p.Libelle} – {x.Libelle}", -x.Montant, vente, null, "POSTE_SANS_COMPTE");
                continue;
            }
            // Acompte tenu en trésorerie : la déduction TTC se répartit entre les taux au prorata de leur TTC ; la TVA de
            // chaque part est retirée du compte de TVA du taux, le reste (HT) solde le compte d'acompte.
            var poids = p.Tva.Select(t => Arrondir(t.Base) + (TvaPostee(t) ? Arrondir(t.Montant) : 0)).ToList();
            var parts = Repartir(x.Montant, poids);
            var ht = 0m;
            for (var i = 0; i < p.Tva.Count; i++)
            {
                var t = p.Tva[i];
                var partTva = TvaPostee(t) && poids[i] != 0 ? Arrondir(parts[i] * Arrondir(t.Montant) / poids[i]) : 0;
                ht += parts[i] - partTva;
                Ajouter(CompteTva(t), null, $"{p.Libelle} – {x.Libelle} – TVA {t.Taux}", -partTva, vente, null, "TVA_SANS_COMPTE");
            }
            Ajouter(x.Compte, x.Auxiliaire, $"{p.Libelle} – {x.Libelle}", -ht, vente, null, "POSTE_SANS_COMPTE");
        }
        // Tiers : une ligne par échéance ; la retenue sur son compte (sinon le collectif du tiers).
        var tiersOk = !string.IsNullOrWhiteSpace(p.Collectif) && !string.IsNullOrWhiteSpace(p.CompteTiers);
        var echeances = p.Echeances.Count > 0 ? p.Echeances : [new EcheancePiece(null, p.TotalTtc + p.PostesTtc.Sum(x => x.Montant), false)];
        foreach (var e in echeances)
        {
            var retenue = e.Retenue && !string.IsNullOrWhiteSpace(p.CompteRetenue);
            Ajouter(retenue ? p.CompteRetenue : tiersOk ? p.Collectif : null, tiersOk ? p.CompteTiers : null, retenue ? $"{p.Libelle} – retenue de garantie" : p.Libelle,
                e.Montant, vente, e.Date, "TIERS_SANS_COMPTE");
        }
        // Équilibre : petit écart sur le compte d'écart, sinon erreur.
        if (erreurs.Count == 0)
        {
            var ecart = lignes.Sum(l => l.Debit) - lignes.Sum(l => l.Credit);
            if (ecart != 0 && Math.Abs(ecart) <= ToleranceEcart)
            {
                var compte = ecart > 0 ? p.CompteEcartCredit : p.CompteEcartDebit;
                if (string.IsNullOrWhiteSpace(compte)) erreurs.Add("ECART_SANS_COMPTE");
                else lignes.Add(new(p.Journal, p.Date, p.Numero, p.Reference, compte, null, $"{p.Libelle} – écart d'arrondi",
                    ecart < 0 ? -ecart : 0, ecart > 0 ? ecart : 0, null, p.Analytique));
            }
            else if (ecart != 0) erreurs.Add("DESEQUILIBRE");
        }
        return new(p.Id, lignes, erreurs, details);
    }
}
