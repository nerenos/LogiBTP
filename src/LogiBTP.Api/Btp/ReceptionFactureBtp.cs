using System.Globalization;
using System.Net;
using System.Text.Json;
using LogiBTP.Annuaire;
using LogiBTP.Annuaire.Web;
using LogiBTP.Comptabilite;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using CategorieFe = LogiBTP.FactureElectronique.CategorieTva;

namespace LogiBTP.Api.Btp;

/// <summary>Taux de TVA du référentiel (taux_tva) avec la catégorie EN 16931 de sa catégorie comptable (ctv_categorie_en16931, lot 10).</summary>
public sealed record TauxTvaRecu(int Id, string Code, decimal Taux, string Comportement, string? CategorieEn16931, bool Defaut);

/// <summary>Personne de l'annuaire candidate pour le vendeur d'une facture reçue (même SIREN ou même SIRET).</summary>
public sealed record FournisseurCandidat(long Id, string? Siren, string? Siret, bool Provisoire, long? Parent);

/// <summary>Ligne d'une commande candidate au rapprochement d'une ligne reçue : identifiant, numérotation, code, libellé brut, quantité.</summary>
public sealed record LigneCommandeRecue(long Id, string? Numerotation, string? Code, string? Libelle, decimal? Qte);

/// <summary>Ligne de pièce préparée depuis une ligne reçue : type (élément ou texte), ligne reçue, quantité, prix, unité, TVA.</summary>
public sealed record LignePreparee(short Type, string? IdentifiantRecu, string LibelleHtml, decimal? Qte, decimal? Pv, string? Unite, int? TvaId, string? Code,
    string? Commentaire, decimal Montant);

/// <summary>Lignes préparées d'une facture reçue et ce qui n'a pas pu être repris (TVA ou unité non reconnue, écart avec le total).</summary>
public sealed record PreparationLignes(List<LignePreparee> Lignes, List<string> TvaNonReconnues, List<string> UnitesNonReconnues, decimal TotalLignes,
    decimal TotalFacture);

/// <summary>
/// Réception d'une facture électronique dans le cœur (plans/facturation-electronique.md, lot 12) : facture lue → pièce
/// d'achat A_FACTURE, ou de sous-traitance T_FACTURE_AVT quand une commande de sous-traitance du fournisseur est désignée
/// (BT-12 contrat, BT-13 commande, BT-18 objet : numéro de la commande ou code du marché de sous-traitance), toujours en
/// BROUILLON (jamais de validation automatique). Fournisseur par SIREN puis SIRET, sinon fiche provisoire de l'annuaire
/// (modules/annuaire/db/071) ; commande d'achat par BT-13 (transformation : écarts de prix et de quantité dans les
/// avertissements existants, PRIX_ACHAT_ECART) ; chantier par BT-11 / BT-18 (code du chantier) ou par le marché (BT-12) ;
/// lignes, TVA par la catégorie EN 16931 (AE → taux autoliquidé), référence externe = numéro du fournisseur (BT-1),
/// date externe = date de la facture (BT-2) ; document_origine IMPORT (format = syntaxe, fichier = original en GED,
/// rapport de reprise) ; pièces jointes (BG-24, BR-FR-17) en GED de la pièce, étape RECEPTION, au coffre (Q21). Doublon
/// (même fournisseur, même référence externe, facture d'achat ou de sous-traitance non annulée) refusé, tracé par le module.
/// Création idempotente (lot 13) : brouillon déjà créé pour le flux repris ; Prise en charge (204) posée au rattachement.
/// Avoir reçu (lot 14 : BT-3 381 et autres types d'avoir, UBL CreditNote) : avoir d'achat A_AVOIR en brouillon, montants
/// rendus positifs (<see cref="EnPositif"/>), facture d'origine (BT-25) du même fournisseur rattachée quand elle est
/// retrouvée (lien de transformation). Fichiers déjà rangés en GED de la pièce (même contenu) réutilisés, pas redéposés.
/// </summary>
public sealed class ReceptionFactureBtp(IServiceProvider services, ILogger journal, Utilisateur service)
{
    /// <summary>Relation (casquette) donnée à la fiche provisoire d'un fournisseur inconnu.</summary>
    public const string CasquetteFournisseur = "FOURNISSEUR";

    /// <summary>Pièces d'une facture de fournisseur, où se cherche un doublon (même fournisseur, même référence externe).</summary>
    public static readonly string[] TypesFactureRecue = [TypesDocument.AFacture, TypesDocument.TFactureAvt];

    /// <summary>Pièces d'un avoir de fournisseur, où se cherche un doublon d'avoir reçu (lot 14).</summary>
    public static readonly string[] TypesAvoirRecu = [TypesDocument.AAvoir];

    /// <summary>Pièces créées par la réception (brouillon repris d'un flux).</summary>
    public static readonly string[] TypesPieceRecue = [.. TypesFactureRecue, .. TypesAvoirRecu];

    /// <summary>Factures d'achat où se cherche la facture d'origine d'un avoir reçu (BT-25).</summary>
    public static readonly string[] TypesFactureOrigine = [TypesDocument.AFacture, TypesDocument.AFactureAvt];

    /// <summary>Unités UN/ECE (recommandation 20) → unités du référentiel LogiBTP (les synonymes de la table unite priment).</summary>
    public static readonly IReadOnlyDictionary<string, string> UnitesUnece = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["C62"] = "u", ["H87"] = "u", ["EA"] = "u", ["XPP"] = "pce", ["NAR"] = "u", ["SET"] = "ens", ["LS"] = "ft", ["MTR"] = "m", ["LM"] = "ml",
        ["MTK"] = "m2", ["MTQ"] = "m3", ["CMT"] = "cm", ["MMT"] = "mm", ["KMT"] = "km", ["KGM"] = "kg", ["TNE"] = "t", ["LTR"] = "l",
        ["HUR"] = "h", ["DAY"] = "j", ["WEE"] = "sem", ["MON"] = "mois", ["XSA"] = "sac", ["XPX"] = "pal", ["XRO"] = "rl", ["XBX"] = "bte", ["LO"] = "lot",
    };

    // ---------------------------------------------------------------- règles (sans base)

    /// <summary>Forme comparable d'une référence (lettres et chiffres en majuscules, comme les numéros des accusés de commande).</summary>
    public static string Comparable(string? s) => s is null ? "" : new string(s.Where(char.IsAsciiLetterOrDigit).ToArray()).ToUpperInvariant();

    /// <summary>SIREN et SIRET du vendeur : BT-30, identifiant de schéma 0009 (SIRET), sinon SIREN tiré du SIRET.</summary>
    public static (string? Siren, string? Siret) Identifiants(Partie vendeur)
    {
        var siret = vendeur.Identifiants.FirstOrDefault(i => i.Schema == SchemaIdentifiant.Siret)?.Valeur is { } s ? Comparable(s) : null;
        if (siret is { Length: not 14 }) siret = null;
        var siren = vendeur.Siren is { } n ? Comparable(n) : vendeur.Identifiants.FirstOrDefault(i => i.Schema == SchemaIdentifiant.Siren)?.Valeur is { } m ? Comparable(m) : null;
        if (siren is { Length: not 9 }) siren = null;
        siren ??= siret?[..9];
        return (siren, siret);
    }

    /// <summary>
    /// Fournisseur d'une facture reçue, par SIREN puis SIRET : une seule personne du SIREN la désigne ; plusieurs, celle du
    /// SIRET de la facture, sinon la tête (sans parent, ou la plus ancienne) ; aucune du SIREN : celle du SIRET. Les fiches
    /// définitives passent avant les provisoires. Null : inconnu (fiche provisoire à créer).
    /// </summary>
    public static FournisseurCandidat? ChoisirFournisseur(string? siren, string? siret, IReadOnlyList<FournisseurCandidat> candidats)
    {
        var ordonnes = candidats.OrderBy(c => c.Provisoire).ThenBy(c => c.Id).ToList();
        var duSiren = siren is null ? [] : ordonnes.Where(c => c.Siren == siren).ToList();
        if (duSiren.Count == 1) return duSiren[0];
        if (duSiren.Count > 1)
            return duSiren.FirstOrDefault(c => siret is not null && c.Siret == siret) ?? duSiren.FirstOrDefault(c => c.Parent is null || !duSiren.Any(p => p.Id == c.Parent)) ?? duSiren[0];
        return siret is null ? null : ordonnes.FirstOrDefault(c => c.Siret == siret);
    }

    /// <summary>Catégorie EN 16931 d'un taux : celle de sa catégorie comptable, sinon proposée depuis son comportement (ReglesTva, lot 10).</summary>
    public static string? CategorieDe(TauxTvaRecu t) => string.IsNullOrWhiteSpace(t.CategorieEn16931) ? ReglesTva.Proposer(t.Comportement)?.Categorie : t.CategorieEn16931;

    /// <summary>
    /// Taux du référentiel pour une catégorie EN 16931 et un taux reçus : même catégorie (S : même taux) ; AE → taux
    /// autoliquidé (comportement A avant I), K → intracommunautaire (I), Z / G / O → exonéré à défaut de la catégorie
    /// exacte ; le taux par défaut, puis le premier. Null : non reconnu (ligne sans TVA, signalée au rapport).
    /// </summary>
    public static TauxTvaRecu? ChoisirTva(string? categorie, decimal? taux, IReadOnlyList<TauxTvaRecu> referentiel)
    {
        if (string.IsNullOrWhiteSpace(categorie)) return null;
        static IEnumerable<TauxTvaRecu> Ordre(IEnumerable<TauxTvaRecu> l) => l.OrderByDescending(t => t.Defaut).ThenBy(t => t.Id);
        if (categorie == CategorieFe.Normale)
            return taux is decimal x ? Ordre(referentiel.Where(t => CategorieDe(t) == CategorieEn16931.Standard && t.Taux == x)).FirstOrDefault() : null;
        var exacte = referentiel.Where(t => CategorieDe(t) == categorie).ToList();
        return categorie switch
        {
            CategorieFe.Autoliquidation => Ordre(exacte).OrderBy(t => t.Comportement == ComportementTva.Autoliquidation ? 0 : 1).FirstOrDefault()
                ?? Ordre(referentiel.Where(t => t.Comportement == ComportementTva.Autoliquidation)).FirstOrDefault(),
            CategorieFe.Intracommunautaire => Ordre(exacte).FirstOrDefault() ?? Ordre(referentiel.Where(t => t.Comportement == ComportementTva.Intracommunautaire)).FirstOrDefault(),
            CategorieFe.TauxZero or CategorieFe.Exportation or CategorieFe.HorsChamp => Ordre(exacte).FirstOrDefault()
                ?? Ordre(referentiel.Where(t => CategorieDe(t) == CategorieEn16931.Exoneree)).FirstOrDefault(),
            _ => Ordre(exacte).FirstOrDefault(),
        };
    }

    /// <summary>Unité du référentiel pour un code UN/ECE : synonyme déclaré dans la table unite, sinon table de correspondance ; null si absente.</summary>
    public static string? ChoisirUnite(string? code, IReadOnlyDictionary<string, string[]> unites)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var parSynonyme = unites.FirstOrDefault(u => u.Key.Equals(code, StringComparison.OrdinalIgnoreCase) || u.Value.Any(s => s.Equals(code, StringComparison.OrdinalIgnoreCase))).Key;
        if (parSynonyme is not null) return parSynonyme;
        return UnitesUnece.TryGetValue(code, out var u) && unites.ContainsKey(u) ? u : null;
    }

    /// <summary>
    /// Lignes de la pièce : chaque ligne reçue sans sous-ligne (BG-25 ; feuille de l'arbre EXT-FR-FE-162) devient un élément
    /// au prix net (BT-146 ramené à la quantité de base BT-149) avec sa TVA ; une ligne de groupe (qui a des sous-lignes,
    /// dont la somme fait son montant) ou d'information (EXT-FR-FE-163 INFORMATION) devient un texte ; remises (BG-20) et
    /// charges (BG-21) du document en éléments d'une unité. Facture sans ligne (profil BASIC WL) : un élément par
    /// ventilation de TVA (BG-23, base hors taxe). Total des éléments comparé au total HT de la facture (BT-109).
    /// </summary>
    public static PreparationLignes PreparerLignes(Facture f, IReadOnlyList<TauxTvaRecu> tva, IReadOnlyDictionary<string, string[]> unites)
    {
        var lignes = new List<LignePreparee>();
        var tvaInconnues = new List<string>();
        var unitesInconnues = new List<string>();
        int? Tva(string? categorie, decimal? taux, string quoi)
        {
            var t = ChoisirTva(categorie, taux, tva);
            if (t is null) tvaInconnues.Add($"{quoi} : {categorie ?? "?"} {taux?.ToString(CultureInfo.InvariantCulture) ?? ""}".Trim());
            return t?.Id;
        }
        static string Html(string? s) => WebUtility.HtmlEncode(s ?? "");
        static string Nombre(decimal d, string format) => d.ToString(format, CultureInfo.InvariantCulture);
        var parents = f.Lignes.Where(l => l.LigneParente is not null).Select(l => l.LigneParente!).ToHashSet();
        foreach (var l in f.Lignes)
        {
            var nom = string.IsNullOrWhiteSpace(l.Description) || l.Description == l.Nom ? l.Nom : $"{l.Nom} – {l.Description}";
            if (parents.Contains(l.Identifiant) || l.SousType == SousTypeLigne.Information)
            {
                var detail = l.Quantite == 0 && l.MontantNet == 0 ? nom
                    : $"{nom} : {Nombre(l.Quantite, "0.####")} {l.Unite} × {Nombre(l.PrixNet, "0.00####")} = {Nombre(l.MontantNet, "0.00")}";
                lignes.Add(new LignePreparee(TL.Texte, l.Identifiant, Html(detail), null, null, null, null, null, l.Note, 0));
                continue;
            }
            var unite = ChoisirUnite(l.Unite, unites);
            if (unite is null && !string.IsNullOrWhiteSpace(l.Unite)) unitesInconnues.Add($"{l.Identifiant} : {l.Unite}");
            var pv = l.QuantiteBase is decimal b && b != 0 ? l.PrixNet / b : l.PrixNet;
            var qte = l.Quantite;
            // Ligne sans quantité (forfait) : une unité au montant net.
            if (qte == 0 && l.MontantNet != 0) (qte, pv) = (1, l.MontantNet);
            lignes.Add(new LignePreparee(TL.Element, l.Identifiant, Html(nom), qte, decimal.Round(pv, 6, MidpointRounding.AwayFromZero), unite,
                Tva(l.CategorieTva, l.TauxTva, $"ligne {l.Identifiant}"), l.ReferenceVendeur ?? l.ReferenceAcheteur, l.Note, l.MontantNet));
        }
        if (f.Lignes.Count == 0)
        {
            foreach (var t in f.DetailsTva)
            {
                var libelle = $"TVA {t.Categorie} {(t.Taux is decimal x ? Nombre(x, "0.##") + " %" : "")}".Trim();
                lignes.Add(new LignePreparee(TL.Element, null, Html(libelle), 1, t.Base, null, Tva(t.Categorie, t.Taux, libelle), null, null, t.Base));
            }
        }
        else
        {
            foreach (var r in f.RemisesCharges)
            {
                var libelle = r.Motif ?? r.CodeMotif ?? (r.Charge ? "Charge" : "Remise");
                var montant = r.Charge ? r.Montant : -r.Montant;
                lignes.Add(new LignePreparee(TL.Element, null, Html(libelle), 1, montant, null, Tva(r.CategorieTva, r.TauxTva, libelle), null, null, montant));
            }
        }
        var total = lignes.Where(l => l.Type == TL.Element).Sum(l => l.Montant);
        return new PreparationLignes(lignes, tvaInconnues, unitesInconnues, total, f.Totaux.TotalHt);
    }

    /// <summary>
    /// Rapprochement des lignes reçues et des lignes d'une commande (chacune une fois) : BT-132 = numérotation ou identifiant
    /// de la ligne de la commande, sinon référence de l'article (BT-155 / BT-156) = code de la ligne, sinon même libellé.
    /// Rend l'identifiant de la ligne reçue → ligne de la commande.
    /// </summary>
    public static Dictionary<string, LigneCommandeRecue> Rapprocher(IReadOnlyList<LigneFacture> recues, IReadOnlyList<LigneCommandeRecue> commande)
    {
        var res = new Dictionary<string, LigneCommandeRecue>();
        var libres = commande.ToList();
        static string Texte(string? s) => SansAccent.Retirer(WebUtility.HtmlDecode(s ?? "")).Trim().ToUpperInvariant();
        var parents = recues.Where(l => l.LigneParente is not null).Select(l => l.LigneParente!).ToHashSet();
        var priced = recues.Where(l => !parents.Contains(l.Identifiant) && l.SousType != SousTypeLigne.Information).ToList();
        foreach (var passe in new Func<LigneFacture, LigneCommandeRecue, bool>[]
        {
            (r, c) => r.LigneCommande is { Length: > 0 } x && (x.Trim() == c.Numerotation || x.Trim() == c.Id.ToString(CultureInfo.InvariantCulture)),
            (r, c) => c.Code is { Length: > 0 } code && (Comparable(r.ReferenceVendeur) == Comparable(code) || Comparable(r.ReferenceAcheteur) == Comparable(code)),
            (r, c) => Texte(r.Nom).Length > 0 && Texte(r.Nom) == Texte(c.Libelle),
        })
        {
            foreach (var r in priced.Where(r => !res.ContainsKey(r.Identifiant)))
            {
                var c = libres.FirstOrDefault(c => passe(r, c));
                if (c is null) continue;
                res[r.Identifiant] = c;
                libres.Remove(c);
            }
        }
        return res;
    }

    /// <summary>Avoir (BT-3 : 381, 261, 262, 396, 502, 503) : donne un avoir d'achat (lot 14), sinon une facture.</summary>
    public static bool EstAvoir(string typeFacture) => typeFacture is TypeFacture.Avoir or TypeFacture.AvoirAutofacture or TypeFacture.AvoirRemiseGlobale
        or TypeFacture.AvoirAffacture or TypeFacture.AvoirAutofactureAffacture or TypeFacture.AvoirAcompte;

    /// <summary>
    /// Montants d'un avoir reçu dans le sens de l'avoir d'achat (A_AVOIR, totaux positifs, déduits par son type) : un avoir
    /// émis en négatif (total HT de la facture négatif) voit ses quantités et ses montants inversés ; sinon inchangé.
    /// </summary>
    public static PreparationLignes EnPositif(PreparationLignes p)
    {
        if (p.TotalFacture >= 0) return p;
        var lignes = p.Lignes.Select(l => l.Type == TL.Element ? l with { Qte = -l.Qte, Montant = -l.Montant } : l).ToList();
        return p with { Lignes = lignes, TotalLignes = -p.TotalLignes, TotalFacture = -p.TotalFacture };
    }

    // ---------------------------------------------------------------- création

    /// <summary>Pièce trouvée : identifiant, numéro, code du type.</summary>
    public sealed record Trouve(long Id, string? Numero, string Type);

    private sealed record LigneUnite(string Code, string[] Synonymes);

    private sealed record Rattachements(int? Chantier, int? Affaire, int? Projet, int? Marche);

    private DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> Documents => services.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();

    /// <summary>Pièce en brouillon d'une facture ou d'un avoir reçu, refus (doublon), ou null (facture illisible, pièce non créée : reste à traiter).</summary>
    public async Task<PieceRecueFe?> CreerAsync(FactureRecueFe recue, CancellationToken ct)
    {
        if (recue.Facture is not { } f) return null;
        var avoir = EstAvoir(f.TypeFacture);
        var db = services.GetRequiredService<LogiBtpContext>();
        // Reprise (lot 13) : la pièce est créée hors de la transaction du flux ; un échec ensuite annule le flux, pas la
        // pièce. Le brouillon déjà créé pour ce flux (même connecteur et même identifiant de la plateforme, ou même flux)
        // est rattaché, sans doublon ni nouvelle pièce ; la Prise en charge est reposée avec le flux.
        if (await BrouillonDuFluxAsync(db, recue.Flux, ct) is { } repris)
        {
            return PieceRecueFe.Creee(new ElementFe(TypesElementFe.Document, repris.Id.ToString(CultureInfo.InvariantCulture)), new
            {
                ent_id = repris.Id, type = repris.Type, reprise = true,
            }) with { Statuts = StatutsReceptionBtp.ALaCreation(repris.Id, reprise: true) };
        }
        var (siren, siret) = Identifiants(f.Vendeur);
        var candidats = siren is null && siret is null ? [] : await db.Database.SqlQueryRaw<FournisseurCandidat>("""
            SELECT per_id AS id, per_siren AS siren, per_siret AS siret, per_provisoire AS provisoire, per_parent_id AS parent
            FROM personne WHERE per_actif AND NOT per_societe_base AND (per_siren = @siren OR per_siret = @siret)
            """, SqlBtp.P("siren", siren, NpgsqlTypes.NpgsqlDbType.Char), SqlBtp.P("siret", siret, NpgsqlTypes.NpgsqlDbType.Char)).ToListAsync(ct);
        var fournisseur = ChoisirFournisseur(siren, siret, candidats);
        var rapport = new Dictionary<string, object?>
        {
            ["flux"] = recue.Flux.FflId, ["connecteur"] = recue.Flux.FflConnecteur, ["id_flux"] = recue.Flux.FflIdFlux, ["syntaxe"] = recue.Syntaxe, ["profil"] = f.Profil, ["type_facture"] = f.TypeFacture, ["cadre"] = f.CadreFacturation,
            ["numero"] = f.Numero, ["siren"] = siren, ["siret"] = siret,
        };
        if (recue.Flux.FflHorsPlateforme) rapport["hors_plateforme"] = true;

        if (fournisseur is not null)
        {
            var doublon = (await db.Database.SqlQueryRaw<Trouve>("""
                SELECT d.ent_id AS id, d.ent_numero AS numero, t.tyd_code AS type FROM document d
                JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
                WHERE t.tyd_code = ANY(@types) AND d.ent_tiers_id = @tiers AND d.ent_is_reference
                  AND s.std_code <> ALL(@hors) AND regexp_replace(upper(coalesce(d.ent_reference_externe, '')), '[^A-Z0-9]', '', 'g') = @ref
                ORDER BY d.ent_id LIMIT 1
                """, new NpgsqlParameter("types", avoir ? TypesAvoirRecu : TypesFactureRecue), new NpgsqlParameter("tiers", fournisseur.Id), new NpgsqlParameter("hors", SqlBtp.StatutsHorsVigueur),
                new NpgsqlParameter("ref", Comparable(f.Numero))).ToListAsync(ct)).FirstOrDefault();
            if (doublon is not null)
            {
                return PieceRecueFe.Refusee(ErreurFe.FactureEnDouble,
                    $"{(avoir ? "Avoir" : "Facture")} {f.Numero} du fournisseur déjà enregistré{(avoir ? "" : "e")} ({doublon.Numero ?? $"document {doublon.Id}"})",
                    new ElementFe(TypesElementFe.Document, doublon.Id.ToString(CultureInfo.InvariantCulture)), new { tiers = fournisseur.Id, type = doublon.Type });
            }
        }

        long tiers;
        var provisoire = false;
        if (fournisseur is null)
        {
            var annuaire = services.GetRequiredService<ServiceAnnuaire>();
            var cree = await annuaire.CreerProvisoire(new SaisieProvisoire
            {
                RaisonSociale = f.Vendeur.RaisonSociale, Siret = siret is not null && LogiBTP.Annuaire.Identifiants.SiretValide(siret) ? siret : null,
                Casquettes = [CasquetteFournisseur], Confirme = true,
            }, service, ct);
            tiers = cree.Id;
            provisoire = true;
            // SIREN et TVA de la facture sur la fiche provisoire (le SIRET seul les a posés quand il est connu).
            await db.Database.ExecuteSqlRawAsync("""
                UPDATE personne SET per_siren = coalesce(per_siren, @siren), per_tva_intra = coalesce(per_tva_intra, @tva) WHERE per_id = @p
                """, [SqlBtp.P("siren", siren is not null && LogiBTP.Annuaire.Identifiants.SirenValide(siren) ? siren : null, NpgsqlTypes.NpgsqlDbType.Char),
                SqlBtp.P("tva", f.Vendeur.NumeroTva is { } t ? Comparable(t) : null, NpgsqlTypes.NpgsqlDbType.Varchar), new NpgsqlParameter("p", tiers)], ct);
        }
        else
        {
            tiers = fournisseur.Id;
            provisoire = fournisseur.Provisoire;
        }
        rapport["fournisseur"] = new { id = tiers, provisoire, cree = fournisseur is null };

        var references = new[] { f.References.Commande, f.References.Contrat, f.References.Objet }.Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r!).ToList();
        var commandeSt = avoir ? null : await CommandeSousTraitanceAsync(db, tiers, references, ct);
        var tva = await db.Database.SqlQueryRaw<TauxTvaRecu>("""
            SELECT t.ttv_id AS id, t.ttv_code AS code, t.ttv_taux AS taux, t.ttv_categorie AS comportement,
                   c.ctv_categorie_en16931 AS categorie_en16931, t.ttv_defaut AS defaut
            FROM taux_tva t LEFT JOIN categorie_tva c ON c.ctv_code = t.ttv_ctv_code WHERE t.ttv_actif ORDER BY t.ttv_id
            """).ToListAsync(ct);
        var unites = (await db.Database.SqlQueryRaw<LigneUnite>("SELECT unt_code AS code, unt_synonymes AS synonymes FROM unite WHERE unt_actif").ToListAsync(ct))
            .ToDictionary(u => u.Code, u => u.Synonymes);
        var preparation = PreparerLignes(f, tva, unites);
        if (avoir)
        {
            if (preparation.TotalFacture < 0) rapport["montants_inverses"] = true;
            preparation = EnPositif(preparation);
        }
        rapport["total_facture_ht"] = preparation.TotalFacture;
        rapport["total_lignes_ht"] = preparation.TotalLignes;
        if (preparation.TvaNonReconnues.Count > 0) rapport["tva_non_reconnues"] = preparation.TvaNonReconnues;
        if (preparation.UnitesNonReconnues.Count > 0) rapport["unites_non_reconnues"] = preparation.UnitesNonReconnues;

        ReponseEnregistrement<DocumentCompletBtp> reponse;
        long ent;
        try
        {
            if (commandeSt is not null)
            {
                (ent, reponse) = await SousTraitanceAsync(db, commandeSt, tiers, f, ct);
                rapport["commande_sous_traitance"] = new { id = commandeSt.Id, numero = commandeSt.Numero };
            }
            else
            {
                (ent, reponse) = await AchatAsync(db, tiers, f, preparation, rapport, avoir, ct);
            }
        }
        catch (ExceptionMetier e)
        {
            journal.LogWarning("Facturation électronique : pièce de la facture reçue {Numero} (flux {Flux}) non créée ({Code} : {Erreur})", f.Numero,
                recue.Flux.FflId, e.Code, Masquage.Texte(e.Message));
            return null;
        }
        if (reponse.Avertissements.Count > 0) rapport["avertissements"] = reponse.Avertissements.Select(a => new { a.Code, a.Message }).ToList();
        if (reponse.Erreurs.Count > 0) rapport["erreurs"] = reponse.Erreurs.Select(a => new { a.Code, a.Message }).ToList();

        if (avoir) await RattacherFactureOrigineAsync(db, tiers, ent, f, rapport, ct);
        var type = await TypesDocumentBtp.CodeAsync(db, ent, ct) ?? "";
        var groupe = await db.Documents.Where(d => d.EntId == ent).Select(d => d.EntGroupeId ?? d.EntId).FirstAsync(ct);
        var jointes = new List<long>();
        foreach (var pj in f.PiecesJointes.Where(p => p.Contenu is { Length: > 0 }))
        {
            if (await DeposerAsync(type, groupe, pj.NomFichier ?? $"{pj.Reference}.bin", pj.Contenu!, pj.TypeMime,
                    $"Pièce jointe {pj.Reference} de la facture {f.Numero}", pj.Description, ct) is long g) jointes.Add(g);
        }
        if (jointes.Count > 0) rapport["pieces_jointes"] = jointes;
        await services.GetRequiredService<TracabiliteService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>().EnregistrerOrigine(ent, new OrigineDocumentDto
        {
            Format = recue.Syntaxe ?? recue.Flux.FflSyntaxe, NomFichier = recue.Flux.FflNom, Reference = f.Numero,
            Rapport = JsonSerializer.SerializeToDocument(rapport, JsonCalcul.Options),
        }, service, ct);
        return PieceRecueFe.Creee(new ElementFe(TypesElementFe.Document, ent.ToString(CultureInfo.InvariantCulture)), new
        {
            ent_id = ent, type, tiers, provisoire, rapport,
        }) with { Statuts = StatutsReceptionBtp.ALaCreation(ent) };
    }

    /// <summary>
    /// Brouillon déjà créé pour un flux reçu (document_origine IMPORT : rapport du même connecteur et du même identifiant
    /// de la plateforme, sinon du même flux), facture d'achat ou de sous-traitance ou avoir d'achat encore en BROUILLON ; sinon null.
    /// </summary>
    public static async Task<Trouve?> BrouillonDuFluxAsync(LogiBtpContext db, FluxFe flux, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<Trouve>("""
            SELECT d.ent_id AS id, d.ent_numero AS numero, t.tyd_code AS type FROM document_origine o
            JOIN document d ON d.ent_id = o.dor_ent_id JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            WHERE o.dor_type = 'IMPORT' AND t.tyd_code = ANY(@types) AND s.std_code = @brouillon
              AND ((@id_flux IS NOT NULL AND o.dor_rapport->>'connecteur' = @connecteur AND o.dor_rapport->>'id_flux' = @id_flux)
                   OR (@flux > 0 AND o.dor_rapport->>'flux' = @flux::text))
            ORDER BY d.ent_id LIMIT 1
            """, new NpgsqlParameter("types", TypesPieceRecue), new NpgsqlParameter("brouillon", StatutsDocument.Brouillon),
            SqlBtp.P("id_flux", flux.FflIdFlux, NpgsqlTypes.NpgsqlDbType.Text), new NpgsqlParameter("connecteur", flux.FflConnecteur),
            new NpgsqlParameter("flux", flux.FflId)).ToListAsync(ct)).FirstOrDefault();

    /// <summary>Commande de sous-traitance valable du fournisseur désignée par une référence : numéro de la commande, ou code de son marché de sous-traitance.</summary>
    private static async Task<Trouve?> CommandeSousTraitanceAsync(LogiBtpContext db, long tiers, List<string> references, CancellationToken ct)
    {
        var refs = AccuseCommandeBtp.Comparables(references);
        if (refs.Length == 0) return null;
        var l = await db.Database.SqlQueryRaw<Trouve>("""
            SELECT DISTINCT e.ent_id AS id, e.ent_numero AS numero, t.tyd_code AS type FROM document e
            JOIN type_document t ON t.tyd_id = e.ent_tyd_id
            JOIN v_document_valable v ON v.ent_id = e.ent_id AND NOT v.annule
            LEFT JOIN marche m ON m.mar_id = e.ent_marche_id AND m.mar_sens = 'ST'
            WHERE t.tyd_code = @type AND e.ent_tiers_id = @tiers
              AND (regexp_replace(upper(coalesce(e.ent_numero, '')), '[^A-Z0-9]', '', 'g') = ANY(@refs)
                   OR regexp_replace(upper(coalesce(m.mar_code, '')), '[^A-Z0-9]', '', 'g') = ANY(@refs))
            ORDER BY e.ent_id
            """, new NpgsqlParameter("type", TypesDocument.TCommande), new NpgsqlParameter("tiers", tiers), new NpgsqlParameter("refs", refs)).ToListAsync(ct);
        return l.Count == 1 ? l[0] : null;
    }

    /// <summary>Chantier par BT-11 / BT-18 (code du chantier), sinon par le marché de BT-12 (code du marché) ; affaire et projet du chantier.</summary>
    private static async Task<Rattachements> RattachementsAsync(LogiBtpContext db, Facture f, CancellationToken ct)
    {
        var chantiers = AccuseCommandeBtp.Comparables(new[] { f.References.Projet, f.References.Objet }.Where(r => r is not null)!);
        var marches = AccuseCommandeBtp.Comparables(new[] { f.References.Contrat }.Where(r => r is not null)!);
        if (chantiers.Length == 0 && marches.Length == 0) return new(null, null, null, null);
        var l = await db.Database.SqlQueryRaw<Rattachements>("""
            SELECT c.cha_id AS chantier, c.cha_aff_id AS affaire, c.cha_prj_id AS projet, NULL::int AS marche FROM chantier c
            WHERE regexp_replace(upper(c.cha_code), '[^A-Z0-9]', '', 'g') = ANY(@c)
            UNION ALL
            SELECT c.cha_id, c.cha_aff_id, c.cha_prj_id, m.mar_id FROM marche m JOIN chantier c ON c.cha_id = m.mar_cha_id
            WHERE regexp_replace(upper(m.mar_code), '[^A-Z0-9]', '', 'g') = ANY(@m)
            """, new NpgsqlParameter("c", chantiers), new NpgsqlParameter("m", marches)).ToListAsync(ct);
        return l.Select(x => x.Chantier).Distinct().Count() == 1 ? l[0] with { Marche = null } : new(null, null, null, null);
    }

    /// <summary>Facture de sous-traitance : transformation de la commande, montants reçus à ventiler (saisie RECUE, ST8), brouillon.</summary>
    private async Task<(long, ReponseEnregistrement<DocumentCompletBtp>)> SousTraitanceAsync(LogiBtpContext db, Trouve commande, long tiers, Facture f, CancellationToken ct)
    {
        var cible = await TypesDocumentBtp.IdAsync(db, TypesDocument.TFactureAvt, ct);
        var cree = await services.GetRequiredService<TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>()
            .Transformer(commande.Id, new DemandeTransformation { CibleTydId = cible }, service, ct);
        var c = await Documents.Charger(cree.Document.EntId, ct);
        Entete(c.Document, f);
        c.Document.EntStSaisie = "RECUE";
        c.Document.EntStRecuHt = f.Totaux.TotalHt;
        c.Document.EntStRecuTva = f.Totaux.TotalTva;
        c.Document.EntStRecuTtc = f.Totaux.TotalTtc;
        return (c.Document.EntId, await Documents.Enregistrer(c.Document.EntId, c, service, ct));
    }

    /// <summary>
    /// Facture d'achat : par transformation de la commande de BT-13 quand des lignes s'y rapprochent (quantités et prix de
    /// la facture sur les lignes reprises, les autres ajoutées), sinon pièce libre ; chantier par les références.
    /// </summary>
    private async Task<(long, ReponseEnregistrement<DocumentCompletBtp>)> AchatAsync(LogiBtpContext db, long tiers, Facture f, PreparationLignes p,
        Dictionary<string, object?> rapport, bool avoir, CancellationToken ct)
    {
        var cible = await TypesDocumentBtp.IdAsync(db, avoir ? TypesDocument.AAvoir : TypesDocument.AFacture, ct);
        DocumentCompletBtp? c = null;
        var rapprochees = new Dictionary<string, LigneCommandeRecue>();
        // Avoir : pièce libre (la facture d'origine est rattachée ensuite), jamais par transformation de la commande.
        if (!avoir && f.References.Commande is { Length: > 0 } bt13)
        {
            var commandes = (await db.Database.SqlQueryRaw<Trouve>(
                    $"SELECT x.ent_id AS id, x.ent_numero AS numero, '' AS type FROM ({AccuseCommandeBtp.SqlCommandes}) x WHERE x.ent_tiers_id = @tiers",
                    new NpgsqlParameter("types", new[] { TypesDocument.ACommande }), new NpgsqlParameter("numeros", AccuseCommandeBtp.Comparables([bt13])),
                    new NpgsqlParameter("tiers", tiers)).ToListAsync(ct));
            if (commandes.Count == 1)
            {
                var commande = commandes[0];
                var lignes = await db.Lignes.AsNoTracking().Where(l => l.LigEntId == commande.Id && (l.LigTylId == TL.Element || l.LigTylId == TL.Ouvrage))
                    .Select(l => new LigneCommandeRecue(l.LigId, l.LigNumerotation, l.LigCode, l.LigLibelleBrut ?? l.LigLibelleHtml, l.LigQte)).ToListAsync(ct);
                rapprochees = Rapprocher(f.Lignes, lignes);
                rapport["commande"] = new { id = commande.Id, numero = commande.Numero, lignes_rapprochees = rapprochees.Count };
                if (rapprochees.Count > 0)
                {
                    var qtes = f.Lignes.Where(l => rapprochees.ContainsKey(l.Identifiant)).ToDictionary(l => rapprochees[l.Identifiant].Id, l => l.Quantite);
                    try
                    {
                        var cree = await services.GetRequiredService<TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>().Transformer(commande.Id,
                            new DemandeTransformation { CibleTydId = cible, Lignes = [.. qtes.Select(q => new LigneATransformer { LigId = q.Key, Qte = q.Value })] }, service, ct);
                        c = await Documents.Charger(cree.Document.EntId, ct);
                    }
                    catch (ExceptionMetier e)
                    {
                        // Commande non transformable (soldée, quantités…) : pièce libre, la commande reste au rapport.
                        rapport["commande_refus"] = new { e.Code, e.Message };
                        rapprochees.Clear();
                    }
                }
            }
        }
        if (c is null)
        {
            var cree = await Documents.Creer(new CreationDocument { EntTydId = cible, EntTiersId = tiers }, service, ct);
            c = await Documents.Charger(cree.Document.EntId, ct);
            var r = await RattachementsAsync(db, f, ct);
            c.Document.EntChantierId = r.Chantier;
            c.Document.EntAffaireId = r.Affaire;
            c.Document.EntProjetId = r.Projet;
            if (r.Chantier is not null) rapport["chantier"] = r.Chantier;
        }
        Entete(c.Document, f, avoir);
        var ent = c.Document.EntId;

        // Lignes reprises de la commande : prix et TVA de la facture (prix fixe ; écart signalé par PRIX_ACHAT_ECART).
        var parOrigine = rapprochees.ToDictionary(kv => kv.Value.Id, kv => kv.Key);
        var preparees = p.Lignes.Where(l => l.IdentifiantRecu is not null).GroupBy(l => l.IdentifiantRecu!).ToDictionary(g => g.Key, g => g.First());
        foreach (var l in c.Lignes.Where(l => l.LigOrigineId is long o && parOrigine.ContainsKey(o)))
        {
            var x = preparees[parOrigine[l.LigOrigineId!.Value]];
            l.LigQte = x.Qte;
            l.LigPv = x.Pv;
            l.LigPvFixe = true;
            l.LigCoefRemise = 1;
            if (x.TvaId is int t) l.LigTvaId = t;
        }
        // Autres lignes de la facture : ajoutées à la racine avant le pied.
        var ajoutees = p.Lignes.Where(l => l.IdentifiantRecu is null || !rapprochees.ContainsKey(l.IdentifiantRecu)).ToList();
        var racine = c.Lignes.Where(l => l.LigParentId is null).ToList();
        var premierPied = racine.Where(TL.EstPied).Select(l => (int?)l.LigOrdre).Min() ?? (racine.Count == 0 ? 1 : racine.Max(l => l.LigOrdre) + 1);
        foreach (var l in racine.Where(l => l.LigOrdre >= premierPied)) l.LigOrdre += ajoutees.Count;
        var id = -1L;
        foreach (var (x, i) in ajoutees.Select((x, i) => (x, i)))
        {
            c.Lignes.Add(new DocumentLigneBtp
            {
                LigId = id--, LigEntId = ent, LigOrdre = premierPied + i, LigTylId = x.Type, LigLibelleHtml = x.LibelleHtml, LigQte = x.Qte, LigUntCode = x.Unite,
                LigPv = x.Pv, LigPvFixe = x.Pv is not null, LigTvaId = x.TvaId, LigCode = x.Code, LigCommentaire = x.Commentaire, LigTypePrix = "V",
                LigChaId = x.Type == TL.Element ? c.Document.EntChantierId : null,
            });
        }
        if (!c.Lignes.Any(l => l.LigParentId is null && l.LigTylId == TL.Tva))
        {
            c.Lignes.Add(new DocumentLigneBtp { LigId = id, LigEntId = ent, LigOrdre = c.Lignes.Where(l => l.LigParentId is null).Max(l => l.LigOrdre) + 1, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" });
        }
        return (ent, await Documents.Enregistrer(ent, c, service, ct));
    }

    /// <summary>
    /// Avoir reçu : facture d'origine (BT-25 des factures antérieures) du même fournisseur parmi ses factures d'achat de
    /// référence non annulées (référence externe comparée sans séparateurs) ; une seule trouvée → lien de transformation
    /// facture → avoir (comme un avoir créé depuis la facture), notée au rapport ; sinon les numéros cherchés y sont notés.
    /// </summary>
    private static async Task RattacherFactureOrigineAsync(LogiBtpContext db, long tiers, long avoir, Facture f, Dictionary<string, object?> rapport, CancellationToken ct)
    {
        var numeros = f.FacturesAnterieures.Select(x => Comparable(x.Numero)).Where(x => x.Length > 0).Distinct().ToArray();
        if (numeros.Length == 0) return;
        var trouvees = await db.Database.SqlQueryRaw<Trouve>("""
            SELECT d.ent_id AS id, d.ent_numero AS numero, t.tyd_code AS type FROM document d
            JOIN type_document t ON t.tyd_id = d.ent_tyd_id JOIN statut_document s ON s.std_id = d.ent_std_id
            WHERE t.tyd_code = ANY(@types) AND d.ent_tiers_id = @tiers AND d.ent_is_reference AND d.ent_id <> @avoir
              AND s.std_code <> ALL(@hors) AND regexp_replace(upper(coalesce(d.ent_reference_externe, '')), '[^A-Z0-9]', '', 'g') = ANY(@refs)
            ORDER BY d.ent_id
            """, new NpgsqlParameter("types", TypesFactureOrigine), new NpgsqlParameter("tiers", tiers), new NpgsqlParameter("avoir", avoir),
            new NpgsqlParameter("hors", SqlBtp.StatutsHorsVigueur), new NpgsqlParameter("refs", numeros)).ToListAsync(ct);
        if (trouvees.Count != 1)
        {
            rapport["facture_origine_introuvable"] = f.FacturesAnterieures.Select(x => x.Numero).ToList();
            return;
        }
        var origine = trouvees[0];
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO document_lien (lie_source_ent_id, lie_cible_ent_id, lie_type) VALUES (@s, @c, 'TRANSFORMATION') ON CONFLICT DO NOTHING
            """, [new NpgsqlParameter("s", origine.Id), new NpgsqlParameter("c", avoir)], ct);
        rapport["facture_origine"] = new { id = origine.Id, numero = origine.Numero, type = origine.Type };
    }

    /// <summary>Entête d'une pièce reçue : numéro et date du fournisseur, objet.</summary>
    private static void Entete(DocumentBtp d, Facture f, bool avoir = false)
    {
        d.EntReferenceExterne = f.Numero.Length > 100 ? f.Numero[..100] : f.Numero;
        d.EntDateExterne = f.DateEmission;
        var objet = $"{(avoir ? "Avoir" : "Facture")} {f.Numero} – {f.Vendeur.RaisonSociale}";
        d.EntObjet ??= objet.Length > 200 ? objet[..200] : objet;
    }

    /// <summary>
    /// Fichier d'une facture reçue déposé en GED d'une pièce : catégorie facture_electronique, confidentialité interne,
    /// étape RECEPTION, puis au coffre (Q21). GED indisponible : journalisé, null.
    /// </summary>
    public async Task<long?> DeposerAsync(string typeElement, long groupe, string nom, byte[] contenu, string? typeMime, string titre, string? resume, CancellationToken ct)
    {
        try
        {
            // Même contenu déjà rangé en GED de la pièce (brouillon repris, lot 13 : vue lisible, pièces jointes) : réutilisé.
            if (await DejaRangeAsync(typeElement, groupe, contenu, ct) is long deja) return deja;
            var ged = services.GetRequiredService<ServiceGed>();
            await using var flux = new MemoryStream(contenu);
            var formulaire = new FormFile(flux, 0, contenu.Length, "fichier", nom)
            {
                Headers = new HeaderDictionary(), ContentType = typeMime ?? "application/octet-stream",
            };
            var depot = await ged.DeposerFichier(formulaire, new MetaDepot
            {
                Titre = titre.Length > 200 ? titre[..200] : titre, Categorie = CategoriesGed.FactureElectronique, TypeElement = typeElement,
                IdElement = groupe.ToString(CultureInfo.InvariantCulture), Auteur = service.Code, Confidentialite = NiveauConfidentialite.Interne, Resume = resume,
                MotsCles = ["facture_electronique", "reception"],
            }, service, ct);
            await ged.Etape(depot.Id, new DemandeEtape { Etape = EtapesGed.Reception, Etat = EtapesGed.Reception, Commentaire = titre }, service, ct);
            await ged.MettreAuCoffre(depot.Id, new DemandeCoffre { Motif = $"Réception {titre}" }, service, ct);
            return depot.Id;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            journal.LogWarning("Facturation électronique : fichier {Nom} non rangé en GED ({Erreur})", nom, Masquage.Texte(e.Message));
            return null;
        }
    }

    /// <summary>Document de la GED d'une pièce (catégorie facture_electronique, non supprimé) dont une version a ce contenu (SHA-256), sinon null.</summary>
    public async Task<long?> DejaRangeAsync(string typeElement, long groupe, byte[] contenu, CancellationToken ct)
    {
        var empreinte = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(contenu));
        return (await services.GetRequiredService<LogiBtpContext>().Database.SqlQueryRaw<long>("""
            SELECT g.dge_id AS "Value" FROM document_ged g
            WHERE g.dge_type_element = @t AND g.dge_id_element = @e AND g.dge_categorie = @c AND NOT g.dge_supprime
              AND EXISTS (SELECT 1 FROM version_ged v WHERE v.vge_document = g.dge_id AND v.vge_empreinte = @h)
            ORDER BY g.dge_id LIMIT 1
            """, new NpgsqlParameter("t", typeElement), new NpgsqlParameter("e", groupe.ToString(CultureInfo.InvariantCulture)),
            new NpgsqlParameter("c", CategoriesGed.FactureElectronique), new NpgsqlParameter("h", empreinte)).ToListAsync(ct)).Select(x => (long?)x).FirstOrDefault();
    }
}
