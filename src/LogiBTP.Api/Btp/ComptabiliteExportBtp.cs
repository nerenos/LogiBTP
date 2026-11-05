using System.Text.RegularExpressions;
using LogiBTP.Bibliotheque;
using LogiBTP.Comptabilite;
using LogiBTP.Comptabilite.Web;
using LogiBTP.Documents;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Module Comptabilité, lot 3 : pièces comptables construites depuis les documents (ANALYSE-MODULE-COMPTABILITE.md § 6).
/// <list type="bullet">
/// <item>Pièces : état comptable `ent_etat_compta` (A / T), indice de référence seulement (un indice remplacé n'est pas transféré), type comptable `f_type_comptable`, date comptable = date de la
/// pièce du fournisseur pour un achat, sinon date du document ; avoir saisi en positif : signe -1.</item>
/// <item>Lignes : les lignes vendues (élément ou ouvrage sans ligne chiffrée au-dessus, prix vendu, hors frais annexes,
/// options, variantes et pour mémoire), compte par la ventilation (lot 2 : ligne, compte de produit ou de charge du tiers
/// de la relation, clés, défaut du type) ; leurs montants ne servent que de poids : la base HT de chaque taux
/// (`document_tva`) fait foi.</item>
/// <item>Postes de pied (HT et TTC) : genre par le marqueur du marché (`poste_marche` : R retenue, A&lt;n&gt; acompte, sinon
/// le type du poste du marché), sinon par le genre recopié de l'élément POSTE_PIED (`lig_proprietes.genre_poste`), à
/// défaut (lignes antérieures) par le libellé ; compte de la ligne, sinon celui du genre dans le type comptable ;
/// déduction d'acompte selon le mode de la société : poste HT (chiffre d'affaires) = diminution des produits, sans
/// compte d'acompte ; poste TTC (trésorerie) = part HT au compte d'acompte, part de TVA retirée de la TVA de la pièce ;
/// paiement direct : à défaut, compte du sous-traitant du poste (collectif sous-traitant et son compte auxiliaire) ;
/// retenue du marché (R) couverte par une échéance RETENUE : portée par l'échéance ; autres retenues (pieds de section) :
/// postes sur le compte de retenue.</item>
/// <item>Écarts d'inventaire (type comptable <see cref="TypeStock"/>, pièces S_INVENTAIRE : `InventaireComptableBtp`) :
/// opération diverse sans tiers ni TVA, une ligne par ligne d'article au compte de stock de la ventilation (montant signé :
/// boni au débit, mali au crédit), contrepartie en variation des stocks (`tco_cpt_contrepartie` du type ou de son parent).</item>
/// <item>Tiers : compte auxiliaire et collectif de la relation (client, fournisseur, sous-traitant : compte fournisseur
/// faute de compte propre) ; TVA : exigibilité de la catégorie, sinon paramètre « TVA sur les débits ».</item>
/// </list>
/// </summary>
public sealed partial class SpecialisationComptabiliteBtp
{
    private sealed record DocSql(long Id, string? Numero, DateOnly Date, string? Reference, string TypeDocument, string Famille, string? TypeComptable,
        decimal TotalTtc, string Etat, string? Tiers, bool Particulier, string? CompteClient, string? CompteFournisseur, string? CompteSt,
        string? CollectifClient, string? CollectifFournisseur, string? CollectifSt, string? Chantier, string? Objet,
        string? ProduitClient, string? ChargeFournisseur, string? ChargeSt);

    private sealed record LigneSql(long Ent, long Id, long? Parent, short Type, string TypePrix, decimal? Montant, string? Nature, string? Taux,
        string? Compte, string? Poste, string? Libelle, string? GenrePoste);

    private sealed record TvaSql(long Ent, string Code, decimal Taux, string Comportement, decimal Base, decimal Montant, string? Exigibilite,
        string? Collectee, string? Encaissement, string? Deductible, string? Autoliquidee);

    private sealed record EcheanceSql(long Ent, DateOnly? Date, decimal Montant, string Nature);

    private sealed record PosteMarcheSql(int Id, string Type, long? Tiers, string? Compte, string? Collectif);

    private sealed record CleSql(string Type, string? Nature, string? Taux, string Compte);

    [GeneratedRegex("^A[0-9]+$")] private static partial Regex CleAcompte();

    /// <summary>Type comptable des écarts d'inventaire du stock (`db/269`).</summary>
    public const string TypeStock = "STOCK";

    /// <summary>
    /// Genre d'un poste de pied : marqueur du marché, sinon genre recopié de l'élément POSTE_PIED, sinon (lignes saisies
    /// avant le genre) libellé.
    /// </summary>
    private static string Genre(string? poste, string? genre, string? libelle, IReadOnlyDictionary<int, string> postesMarche)
    {
        if (poste == PostesMarche.CleRetenue) return GenrePoste.Retenue;
        if (poste is not null && CleAcompte().IsMatch(poste)) return GenrePoste.Acompte;
        if (int.TryParse(poste, out var id) && postesMarche.TryGetValue(id, out var type))
            return type is GenrePoste.Remise or GenrePoste.Prorata or GenrePoste.PaiementDirect ? type : GenrePoste.Autre;
        if (!string.IsNullOrWhiteSpace(genre)) return genre;
        var l = (libelle ?? "").ToLowerInvariant();
        return l.Contains("retenue de garantie") ? GenrePoste.Retenue : l.Contains("acompte") ? GenrePoste.Acompte : l.Contains("paiement direct") ? GenrePoste.PaiementDirect
            : l.Contains("prorata") ? GenrePoste.Prorata : l.Contains("remise") || l.Contains("rabais") ? GenrePoste.Remise : GenrePoste.Autre;
    }

    public override async Task<List<PieceExportee>> PiecesAsync(ComptabiliteDbContext db, FiltrePieces f, CancellationToken ct)
    {
        var types = f.Types.ToArray();
        var ids = f.Ids?.ToArray();
        var docs = await db.Database.SqlQuery<DocSql>($"""
            SELECT d.ent_id AS id, d.ent_numero AS numero,
                   CASE WHEN f_famille_achat(t.tyd_famille) THEN coalesce(d.ent_date_externe, d.ent_date) ELSE d.ent_date END AS date,
                   d.ent_reference_externe AS reference, t.tyd_code AS type_document, t.tyd_famille::text AS famille,
                   f_type_comptable(t.tyd_tco_code, t.tyd_famille) AS type_comptable, d.ent_total_ttc AS total_ttc, d.ent_etat_compta::text AS etat,
                   p.per_raison_sociale AS tiers, NOT coalesce(n.niv_morale, TRUE) AS particulier,
                   p.per_cli_compte AS compte_client, p.per_fou_compte AS compte_fournisseur, p.per_st_compte AS compte_st,
                   p.per_cli_collectif AS collectif_client, p.per_fou_collectif AS collectif_fournisseur, p.per_st_collectif AS collectif_st,
                   coalesce(nullif(c.cha_code_analytique, ''), c.cha_code) AS chantier, d.ent_objet AS objet,
                   p.per_cli_compte_produit AS produit_client, p.per_fou_compte_charge AS charge_fournisseur, p.per_st_compte_charge AS charge_st
            FROM document d
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id
            LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
            LEFT JOIN niveau_personne n ON n.niv_code = p.per_niv_code
            LEFT JOIN chantier c ON c.cha_id = d.ent_chantier_id
            WHERE d.ent_etat_compta = {f.Etat} AND d.ent_is_reference AND f_type_comptable(t.tyd_tco_code, t.tyd_famille) = ANY({types})
              AND ({ids}::bigint[] IS NULL OR d.ent_id = ANY({ids}))
              AND ({f.Du}::date IS NULL OR CASE WHEN f_famille_achat(t.tyd_famille) THEN coalesce(d.ent_date_externe, d.ent_date) ELSE d.ent_date END >= {f.Du})
              AND ({f.Au}::date IS NULL OR CASE WHEN f_famille_achat(t.tyd_famille) THEN coalesce(d.ent_date_externe, d.ent_date) ELSE d.ent_date END <= {f.Au})
            ORDER BY 3, d.ent_numero, d.ent_id
            """).ToListAsync(ct);
        if (docs.Count == 0) return [];
        var ents = docs.Select(d => d.Id).ToArray();
        var lignes = (await db.Database.SqlQuery<LigneSql>($"""
            SELECT l.lig_ent_id AS ent, l.lig_id AS id, l.lig_parent_id AS parent, l.lig_tyl_id AS type, l.lig_type_prix::text AS type_prix,
                   l.lig_montant_ht AS montant, n.nat_code AS nature, v.ttv_code AS taux, l.lig_cpt_code AS compte,
                   l.lig_proprietes ->> 'poste_marche' AS poste, left(l.lig_libelle_brut, 60) AS libelle,
                   l.lig_proprietes ->> 'genre_poste' AS genre_poste
            FROM document_ligne l
            LEFT JOIN nature_element n ON n.nat_id = l.lig_nat_id
            LEFT JOIN taux_tva v ON v.ttv_id = l.lig_tva_id
            WHERE l.lig_ent_id = ANY({ents})
            """).ToListAsync(ct)).ToLookup(l => l.Ent);
        var tva = (await db.Database.SqlQuery<TvaSql>($"""
            SELECT x.tva_ent_id AS ent, x.tva_code AS code, x.tva_taux AS taux, x.tva_categorie::text AS comportement, x.tva_base_ht AS base,
                   x.tva_montant_net AS montant, c.ctv_exigibilite::text AS exigibilite, v.ttv_cpt_collectee AS collectee,
                   v.ttv_cpt_collectee_encaissement AS encaissement, v.ttv_cpt_deductible AS deductible, v.ttv_cpt_autoliquidee AS autoliquidee
            FROM document_tva x
            LEFT JOIN taux_tva v ON v.ttv_id = x.tva_ttv_id OR (x.tva_ttv_id IS NULL AND v.ttv_code = x.tva_code)
            LEFT JOIN categorie_tva c ON c.ctv_code = v.ttv_ctv_code
            WHERE x.tva_ent_id = ANY({ents})
            ORDER BY x.tva_ent_id, x.tva_taux DESC, x.tva_code
            """).ToListAsync(ct)).ToLookup(t => t.Ent);
        var echeances = (await db.Database.SqlQuery<EcheanceSql>($"""
            SELECT ech_ent_id AS ent, ech_date AS date, ech_montant AS montant, ech_nature AS nature
            FROM document_echeance WHERE ech_ent_id = ANY({ents}) ORDER BY ech_ent_id, ech_rang
            """).ToListAsync(ct)).ToLookup(e => e.Ent);
        var postesMarche = (await db.Database.SqlQuery<PosteMarcheSql>($"""
            SELECT m.mpo_id AS id, m.mpo_type AS type, m.mpo_per_id AS tiers, coalesce(p.per_st_compte, p.per_fou_compte) AS compte,
                   coalesce(p.per_st_collectif, (SELECT col_cpt_code FROM collectif_tiers WHERE col_code = 'SOUS_TRAITANT')) AS collectif
            FROM marche_poste m LEFT JOIN personne p ON p.per_id = m.mpo_per_id
            """).ToListAsync(ct)).ToDictionary(p => p.Id);
        var typesPostes = postesMarche.ToDictionary(p => p.Key, p => p.Value.Type);
        var typesComptables = await db.TypesComptables.AsNoTracking().ToDictionaryAsync(t => t.TcoCode, ct);
        var typesRegle = typesComptables.Values.Where(t => t.TcoActif).Select(t => new TypeVentilation(t.TcoCode, t.TcoParent, t.TcoCptDefaut)).ToList();
        // Clés enregistrées par identifiant, comparées aux codes des lignes (code du moment de la nature et du taux).
        var cles = (await db.Database.SqlQuery<CleSql>($"""
            SELECT v.vco_tco_code AS type, n.nat_code AS nature, t.ttv_code AS taux, v.vco_cpt_code AS compte
            FROM ventilation_compte v
            LEFT JOIN nature_element n ON n.nat_id = v.vco_nat_id
            LEFT JOIN taux_tva t ON t.ttv_id = v.vco_ttv_id
            WHERE (v.vco_nat_id IS NULL OR n.nat_id IS NOT NULL) AND (v.vco_ttv_id IS NULL OR t.ttv_id IS NOT NULL)
            """).ToListAsync(ct)).Select(v => new CleVentilation(v.Type, v.Nature, v.Taux, v.Compte)).ToList();
        var collectifs = await db.Collectifs.AsNoTracking().ToDictionaryAsync(c => c.ColCode, c => c.ColCptCode, ct);
        var surDebits = await db.Parametres.AsNoTracking().AnyAsync(p => p.PcpCle == "tva_sur_debits" && p.PcpValeur == "true", ct);

        // Compte d'un type comptable ou de son parent.
        string? Compte(string? type, Func<TypeComptableEntite, string?> lire)
        {
            foreach (var t in ReglesVentilation.ChaineTypes(type, typesRegle))
                if (typesComptables.TryGetValue(t, out var x) && lire(x) is string c) return c;
            return null;
        }

        var res = new List<PieceExportee>();
        foreach (var d in docs)
        {
            var tco = d.TypeComptable ?? "";
            var type = typesComptables.GetValueOrDefault(tco);
            var achat = FamillesDocument.EstAchat(d.Famille);
            var sousTraitance = d.Famille == "T";
            var ls = lignes[d.Id].ToList();
            // Compte de produit ou de charge du tiers de la relation (sous-traitant : celui du fournisseur s'il est vide).
            var compteTiersLignes = !achat ? d.ProduitClient : sousTraitance ? d.ChargeSt ?? d.ChargeFournisseur : d.ChargeFournisseur;
            var parId = ls.ToDictionary(l => l.Id);
            // Ligne vendue : chiffrée (ouvrage, élément), sans ligne chiffrée au-dessus, au prix vendu sur toute sa branche.
            bool Exclue(LigneSql l)
            {
                for (var x = l; x is not null; x = x.Parent is long p ? parId.GetValueOrDefault(p) : null)
                    if (x.TypePrix != "V") return true;
                return false;
            }
            bool SousChiffree(LigneSql l)
            {
                for (var x = l.Parent is long p ? parId.GetValueOrDefault(p) : null; x is not null; x = x.Parent is long q ? parId.GetValueOrDefault(q) : null)
                    if (x.Type is 2 or 3) return true;
                return false;
            }
            var vendues = ls.Where(l => l.Type is 2 or 3 && (l.Montant ?? 0) != 0 && !SousChiffree(l) && !Exclue(l))
                .Select(l =>
                {
                    var r = ReglesVentilation.Compte(new EntreeVentilation(l.Compte, l.Nature, l.Taux, tco, compteTiersLignes), typesRegle, cles);
                    return new LignePiece(r.Compte, l.Taux, l.Montant ?? 0, r.Erreur);
                }).ToList();
            if (tco == TypeStock)
            {
                // Opération diverse : compte de stock par la ventilation de chaque ligne, contrepartie en variation.
                var od = vendues.Zip(ls.Where(l => l.Type is 2 or 3 && (l.Montant ?? 0) != 0 && !SousChiffree(l) && !Exclue(l)),
                    (v, l) => new LigneOd(v.Erreur is null ? v.Compte : null, l.Libelle ?? d.Objet ?? "", v.Montant)).ToList();
                od.Add(new LigneOd(Compte(tco, t => t.TcoCptContrepartie), $"Variation des stocks – {d.Objet ?? d.Numero}", -od.Sum(x => x.Montant)));
                res.Add(new PieceExportee(new PieceComptable(d.Id, type?.TcoJournal ?? tco, d.Date, d.Numero ?? $"#{d.Id}", d.Reference, d.Objet ?? d.Numero ?? "",
                    type?.TcoSens ?? "ACHAT", 1, null, null, [], [], [], [], [], 0, null, null, Compte(tco, t => t.TcoCptEcartDebit), Compte(tco, t => t.TcoCptEcartCredit),
                    d.Chantier, od), tco, d.TypeDocument, d.Objet, d.TotalTtc, d.Etat));
                continue;
            }
            var ech = echeances[d.Id].ToList();
            var retenueParEcheance = ech.Any(e => e.Nature == "RETENUE");
            var compteRetenue = type?.TcoRetenueCompteTiers == true ? null : Compte(tco, t => t.TcoCptRetenue);
            var postesHt = new List<PostePiece>();
            var postesTtc = new List<PostePiece>();
            foreach (var p in ls.Where(l => l.Type is 8 or 9 && (l.Montant ?? 0) != 0))
            {
                var genre = Genre(p.Poste, p.GenrePoste, p.Libelle, typesPostes);
                if (p.Poste == PostesMarche.CleRetenue && retenueParEcheance) continue;
                // Déduction d'acompte avant la TVA (mode chiffre d'affaires) : l'acompte facturé est déjà un produit, la
                // déduction diminue simplement les produits de la pièce (base HT des taux), sans compte d'acompte.
                if (genre == GenrePoste.Acompte && p.Type == 8) continue;
                // Paiement direct d'un poste du marché : sous-traitant du poste (sauf compte saisi ou compte du type).
                var sousTraitant = genre == GenrePoste.PaiementDirect && int.TryParse(p.Poste, out var mpo) ? postesMarche.GetValueOrDefault(mpo) : null;
                var compte = p.Compte ?? genre switch
                {
                    GenrePoste.Remise => Compte(tco, t => t.TcoCptRemise),
                    GenrePoste.Prorata => Compte(tco, t => t.TcoCptProrata),
                    GenrePoste.Acompte => Compte(tco, t => t.TcoCptAcompte),
                    GenrePoste.PaiementDirect => Compte(tco, t => t.TcoCptPaiementDirect) ?? (sousTraitant?.Compte is not null ? sousTraitant.Collectif : null),
                    GenrePoste.Retenue => compteRetenue ?? (achat ? d.CollectifFournisseur : d.CollectifClient),
                    _ when p.Type == 8 => ReglesVentilation.Compte(new EntreeVentilation(null, p.Nature, null, tco), typesRegle, cles).Compte,
                    _ => null,
                };
                var auxiliaire = genre == GenrePoste.Retenue ? (achat ? d.CompteSt ?? d.CompteFournisseur : d.CompteClient)
                    : genre == GenrePoste.PaiementDirect && p.Compte is null && Compte(tco, t => t.TcoCptPaiementDirect) is null ? sousTraitant?.Compte : null;
                (p.Type == 8 ? postesHt : postesTtc).Add(new PostePiece(p.Libelle ?? genre.ToLowerInvariant(), compte, p.Montant ?? 0, auxiliaire,
                    Acompte: genre == GenrePoste.Acompte && p.Type == 9));
            }
            var (compteTiers, collectif) = !achat
                ? (d.CompteClient, d.CollectifClient ?? collectifs.GetValueOrDefault(d.Particulier ? "CLIENT_PRIVE" : "CLIENT_PRO"))
                : sousTraitance
                    ? (d.CompteSt ?? d.CompteFournisseur, d.CollectifSt ?? collectifs.GetValueOrDefault("SOUS_TRAITANT"))
                    : (d.CompteFournisseur, d.CollectifFournisseur ?? collectifs.GetValueOrDefault("FOURNISSEUR"));
            var avoir = d.TypeDocument.Contains("AVOIR") && d.TotalTtc > 0;
            var piece = new PieceComptable(
                d.Id, type?.TcoJournal ?? tco, d.Date, d.Numero ?? $"#{d.Id}", d.Reference, d.Tiers ?? d.Objet ?? d.Numero ?? "", type?.TcoSens ?? (achat ? "ACHAT" : "VENTE"),
                avoir ? -1 : 1, collectif, compteTiers, vendues, postesHt, postesTtc,
                tva[d.Id].Select(t => new TvaPiece(t.Code, t.Taux, t.Base, t.Montant, t.Comportement, t.Exigibilite ?? (surDebits ? "D" : "E"),
                    t.Collectee, t.Encaissement, t.Deductible, t.Autoliquidee)).ToList(),
                ech.Select(e => new EcheancePiece(e.Date, e.Montant, e.Nature == "RETENUE")).ToList(),
                d.TotalTtc, compteRetenue, Compte(tco, t => t.TcoCptDefaut), Compte(tco, t => t.TcoCptEcartDebit), Compte(tco, t => t.TcoCptEcartCredit), d.Chantier);
            res.Add(new PieceExportee(piece, tco, d.TypeDocument, d.Tiers, d.TotalTtc, d.Etat));
        }
        return res;
    }

    public override async Task MarquerAsync(ComptabiliteDbContext db, List<long> pieces, bool transferees, CancellationToken ct)
    {
        if (pieces.Count == 0) return;
        var ids = pieces.ToArray();
        var etat = transferees ? "T" : "A";
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE document SET ent_etat_compta = {etat} WHERE ent_id = ANY({ids}) AND ent_etat_compta IN ('A', 'T')", ct);
    }
}
