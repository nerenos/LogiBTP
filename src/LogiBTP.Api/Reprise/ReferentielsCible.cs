using System.Globalization;
using System.Text.Json;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>Ligne d'une condition de paiement (forme de <c>condition_paiement.cpa_lignes</c>).</summary>
public sealed record LigneConditionReprise(decimal Pct, int Delai, string Base, int? Jour);

/// <summary>
/// Référentiels de la base cible pendant une reprise (plan reprise-mde-optim, lot 4) : lus une fois, puis rapprochés
/// ou complétés. Une valeur source est d'abord rapprochée d'une valeur existante (<see cref="Associations"/>) ; sinon
/// elle est créée, sous son code s'il est libre, sinon suffixé (collision signalée).
/// </summary>
public sealed class ReferentielsCible
{
    /// <summary>Bases d'échéance des conditions de paiement (modules/document : echeances.js, Echeances.cs).</summary>
    public static class BaseEcheance
    {
        public const string Net = "NET";
        public const string FinMois = "FIN_MOIS";
        public const string Jour = "JOUR";
    }

    /// <summary>Types de comptes du module Comptabilité.</summary>
    public static class TypeCompte
    {
        public const string General = "GENERAL";
        public const string Collectif = "COLLECTIF";
        public const string Tva = "TVA";
        public const string Tresorerie = "TRESORERIE";
    }

    /// <summary>Sens d'usage d'un compte.</summary>
    public static class SensCompte
    {
        public const string Vente = "VENTE";
        public const string Achat = "ACHAT";
        public const string Aucun = "AUCUN";
    }

    private readonly ContexteReprise ctx;
    private readonly List<UniteCible> unites;
    private readonly List<TauxCible> taux;
    private readonly HashSet<string> codesTaux;
    private readonly List<OptionCible> modes;
    private readonly Dictionary<string, List<LigneConditionReprise>> conditions;
    private readonly HashSet<string> comptes;
    private readonly List<(long Id, OptionCible Option)> natures;

    private ReferentielsCible(ContexteReprise ctx, List<UniteCible> unites, List<TauxCible> taux, HashSet<string> codesTaux,
        List<OptionCible> modes, Dictionary<string, List<LigneConditionReprise>> conditions, HashSet<string> comptes,
        List<(long, OptionCible)> natures)
    {
        this.ctx = ctx; this.unites = unites; this.taux = taux; this.codesTaux = codesTaux; this.modes = modes;
        this.conditions = conditions; this.comptes = comptes; this.natures = natures;
    }

    public static async Task<ReferentielsCible> LireAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var u = ctx.Unite;
        var unites = await SqlReprise.LireAsync(u, "SELECT unt_code, unt_libelle, unt_synonymes FROM unite ORDER BY unt_ordre, unt_code",
            r => new UniteCible(r.GetString(0), r.GetString(1), r.GetFieldValue<string[]>(2)), ct);
        var tauxLus = await SqlReprise.LireAsync(u, "SELECT ttv_id, ttv_taux, ttv_categorie, ttv_code FROM taux_tva ORDER BY ttv_ordre, ttv_id",
            r => (new TauxCible(r.GetInt32(0), r.GetDecimal(1), r.GetString(2)), r.GetString(3)), ct);
        var modes = await SqlReprise.LireAsync(u, "SELECT mre_code, mre_libelle FROM mode_reglement ORDER BY mre_ordre, mre_code",
            r => new OptionCible(r.GetString(0), r.GetString(1)), ct);
        var conditions = (await SqlReprise.LireAsync(u, "SELECT cpa_code, cpa_lignes::text FROM condition_paiement ORDER BY cpa_ordre, cpa_code",
            r => (r.GetString(0), LireLignes(r.GetString(1))), ct)).ToDictionary(c => c.Item1, c => c.Item2, StringComparer.Ordinal);
        var comptes = (await SqlReprise.LireAsync(u, "SELECT cpt_code FROM compte_comptable", r => r.GetString(0), ct)).ToHashSet(StringComparer.Ordinal);
        var natures = await SqlReprise.LireAsync(u, "SELECT nat_id, nat_code, nat_libelle FROM nature_element ORDER BY nat_id",
            r => ((long)r.GetInt32(0), new OptionCible(r.GetString(1), r.GetString(2))), ct);
        return new ReferentielsCible(ctx, unites, tauxLus.Select(t => t.Item1).ToList(),
            tauxLus.Select(t => t.Item2).ToHashSet(StringComparer.Ordinal), modes, conditions, comptes, natures);
    }

    private void Renomme(string table, string souhaite, string obtenu)
    {
        if (souhaite != obtenu)
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.CodeRenomme, $"{table} {souhaite}",
                $"Code « {souhaite} » déjà pris : créé sous « {obtenu} »");
    }

    /// <summary>Unité cible d'une unité source (rapprochée, sinon créée) ; le registre retient table + clé → code.</summary>
    public async Task<string?> UniteAsync(string tableSource, string cle, string? code, string? libelle, int? precision, bool actif, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(tableSource);
        volume.Lues++;
        if (string.IsNullOrWhiteSpace(code)) { volume.Ecartees++; return null; }
        var trouve = Associations.Unite(code, unites) ?? Associations.Unite(libelle, unites);
        if (trouve is null)
        {
            trouve = Associations.CodeLibre(code.Trim(), 10, c => unites.Any(u => string.Equals(u.Code, c, StringComparison.OrdinalIgnoreCase)));
            Renomme(tableSource, code.Trim(), trouve);
            await SqlReprise.ExecuterAsync(ctx.Unite,
                "INSERT INTO unite (unt_code, unt_libelle, unt_precision_qte, unt_ordre, unt_actif, unt_synonymes) VALUES ($1, $2, $3, $4, $5, $6)",
                ct, trouve, AnnuaireReprise.Couper(libelle ?? code, 50), (short)Math.Clamp(precision ?? 2, 0, 6), 100 + unites.Count, actif,
                trouve == code.Trim() ? Array.Empty<string>() : new[] { code.Trim() });
            unites.Add(new UniteCible(trouve, libelle ?? code, [code.Trim()]));
            ctx.Rapport.Appliquer("unite", code, $"{trouve} (créée)");
        }
        else ctx.Rapport.Appliquer("unite", code, trouve);
        volume.Ecrites++;
        ctx.Registre.InscrireCode(tableSource, cle, trouve);
        return trouve;
    }

    /// <summary>Compte du plan comptable : gardé s'il existe, sinon créé.</summary>
    public async Task<string?> CompteAsync(string? code, string? libelle, string type, string sens, CancellationToken ct)
    {
        var c = AnnuaireReprise.Couper(code, 20);
        if (c is null) return null;
        if (comptes.Add(c))
            await SqlReprise.ExecuterAsync(ctx.Unite,
                "INSERT INTO compte_comptable (cpt_code, cpt_libelle, cpt_type, cpt_sens, cpt_maj_par) VALUES ($1, $2, $3, $4, $5)",
                ct, c, AnnuaireReprise.Couper(libelle, 150) ?? c, type, sens, AnnuaireReprise.Couper(ctx.Options.Auteur, 100));
        return c;
    }

    /// <summary>Type et sens d'usage d'un compte d'après sa classe (collectifs fournis par la source).</summary>
    public static (string Type, string Sens) Classer(string compte, IReadOnlySet<string> collectifs) =>
        (collectifs.Contains(compte) ? TypeCompte.Collectif
            : compte.StartsWith("445", StringComparison.Ordinal) ? TypeCompte.Tva
            : compte.StartsWith('5') ? TypeCompte.Tresorerie : TypeCompte.General,
         compte.StartsWith('7') ? SensCompte.Vente : compte.StartsWith('6') ? SensCompte.Achat : SensCompte.Aucun);

    /// <summary>
    /// Taux de TVA cible (rapproché par taux et catégorie, sinon créé). Autoliquidation ou intracommunautaire à 0 % : le
    /// premier taux de la catégorie (la source met le taux à 0, LogiBTP garde le taux dû par le preneur). Comptes posés
    /// sur un taux qui n'en a pas.
    /// </summary>
    public async Task<long> TauxAsync(string tableSource, string cle, decimal pourcentage, string categorie, string libelle, bool actif,
        string? compteCollectee, string? compteDeductible, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(tableSource);
        volume.Lues++;
        var id = Associations.Taux(pourcentage, taux, categorie)
                 ?? (pourcentage == 0 && categorie is "A" or "I" ? taux.FirstOrDefault(t => t.Categorie == categorie)?.Id : null);
        if (id is null)
        {
            var souhaite = $"{categorie}{pourcentage.ToString("0.##", CultureInfo.InvariantCulture).Replace(".", "", StringComparison.Ordinal)}";
            var code = Associations.CodeLibre(souhaite, 10, codesTaux.Contains);
            codesTaux.Add(code);
            id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
                INSERT INTO taux_tva (ttv_code, ttv_libelle, ttv_taux, ttv_categorie, ttv_actif, ttv_ordre)
                VALUES ($1, $2, $3, $4, $5, $6) RETURNING ttv_id
                """, ct, code, AnnuaireReprise.Couper(libelle, 100) ?? code, pourcentage, categorie, actif, 100 + taux.Count), CultureInfo.InvariantCulture);
            taux.Add(new TauxCible(id.Value, pourcentage, categorie));
            ctx.Rapport.Appliquer("taux_tva", cle, $"{code} (créé)");
        }
        else ctx.Rapport.Appliquer("taux_tva", cle, id.Value.ToString(CultureInfo.InvariantCulture));
        await SqlReprise.ExecuterAsync(ctx.Unite, """
            UPDATE taux_tva SET ttv_cpt_collectee = COALESCE(ttv_cpt_collectee, $2), ttv_cpt_deductible = COALESCE(ttv_cpt_deductible, $3)
            WHERE ttv_id = $1
            """, ct, (int)id.Value, compteCollectee, compteDeductible);
        volume.Ecrites++;
        ctx.Registre.Inscrire(tableSource, cle, "taux_tva", id.Value);
        return id.Value;
    }

    /// <summary>Mode de règlement cible : cible imposée, sinon rapproché par code ou libellé, sinon créé.</summary>
    public async Task<string?> ModeAsync(string tableSource, string cle, string? code, string? libelle, CancellationToken ct)
    {
        var trouve = Associations.Option(code, libelle, modes);
        if (trouve is null)
        {
            var souhaite = Associations.Normaliser(code ?? libelle);
            if (souhaite.Length == 0) return null;
            trouve = Associations.CodeLibre(souhaite, 20, c => modes.Any(m => m.Code == c));
            Renomme(tableSource, souhaite, trouve);
            await SqlReprise.ExecuterAsync(ctx.Unite, "INSERT INTO mode_reglement (mre_code, mre_libelle, mre_ordre) VALUES ($1, $2, $3)",
                ct, trouve, AnnuaireReprise.Couper(libelle ?? code, 80) ?? trouve, (short)(100 + modes.Count));
            modes.Add(new OptionCible(trouve, libelle ?? trouve));
            ctx.Rapport.Appliquer("mode_reglement", code ?? libelle!, $"{trouve} (créé)");
        }
        else ctx.Rapport.Appliquer("mode_reglement", code ?? libelle!, trouve);
        ctx.Registre.InscrireCode(tableSource, cle, trouve);
        return trouve;
    }

    /// <summary>
    /// Condition de paiement cible : une condition existante aux mêmes lignes (le comptant : aucune ligne ou une ligne
    /// à 100 % sans délai), sinon créée sous le code source.
    /// </summary>
    public async Task<string> ConditionAsync(string tableSource, string cle, string libelle, IReadOnlyList<LigneConditionReprise> lignes, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(tableSource);
        volume.Lues++;
        var forme = Canonique(lignes);
        var trouve = conditions.FirstOrDefault(c => Canonique(c.Value).SequenceEqual(forme)).Key;
        if (trouve is null)
        {
            var souhaite = Associations.Normaliser(cle);
            trouve = Associations.CodeLibre(souhaite.Length > 0 ? souhaite : "COND", 20, conditions.ContainsKey);
            Renomme(tableSource, souhaite, trouve);
            await SqlReprise.ExecuterAsync(ctx.Unite, "INSERT INTO condition_paiement (cpa_code, cpa_libelle, cpa_lignes, cpa_ordre) VALUES ($1, $2, $3, $4)",
                ct, trouve, AnnuaireReprise.Couper(libelle, 100) ?? trouve, new SqlReprise.Json(EnJson(forme)), (short)(100 + conditions.Count));
            conditions[trouve] = forme;
            ctx.Rapport.Appliquer("condition_paiement", cle, $"{trouve} (créée)");
        }
        else ctx.Rapport.Appliquer("condition_paiement", cle, trouve);
        volume.Ecrites++;
        ctx.Registre.InscrireCode(tableSource, cle, trouve);
        return trouve;
    }

    /// <summary>
    /// Nature des éléments : rapprochée par code ou libellé, sinon créée dans le regroupement donné ; le registre retient
    /// table + clé → nat_id.
    /// </summary>
    public async Task<long> NatureAsync(string tableSource, string cle, string code, string libelle, string? regroupement, bool actif, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(tableSource);
        volume.Lues++;
        var trouve = Associations.Option(code, libelle, natures.Select(n => n.Option).ToList());
        long id;
        if (trouve is not null)
        {
            id = natures.First(n => n.Option.Code == trouve).Id;
            ctx.Rapport.Appliquer("nature_element", code, trouve);
        }
        else
        {
            var nouveau = Associations.CodeLibre(Associations.Normaliser(code), 20, c => natures.Any(n => n.Option.Code == c));
            Renomme(tableSource, Associations.Normaliser(code), nouveau);
            id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite,
                "INSERT INTO nature_element (nat_code, nat_libelle, nat_rgn_code, nat_actif) VALUES ($1, $2, $3, $4) RETURNING nat_id",
                ct, nouveau, AnnuaireReprise.Couper(libelle, 100) ?? nouveau, regroupement, actif), CultureInfo.InvariantCulture);
            natures.Add((id, new OptionCible(nouveau, libelle)));
            ctx.Rapport.Appliquer("nature_element", code, $"{nouveau} (créée)");
        }
        volume.Ecrites++;
        ctx.Registre.Inscrire(tableSource, cle, "nature_element", id);
        return id;
    }

    private static List<LigneConditionReprise> Canonique(IReadOnlyList<LigneConditionReprise> lignes) =>
        lignes.Count == 1 && lignes[0] is { Pct: 100, Delai: 0, Base: BaseEcheance.Net } ? [] : lignes.ToList();

    private static string EnJson(IReadOnlyList<LigneConditionReprise> lignes) => JsonSerializer.Serialize(lignes.Select(l =>
    {
        var o = new Dictionary<string, object> { ["pct"] = l.Pct, ["delai"] = l.Delai, ["base"] = l.Base };
        if (l.Jour is { } j) o["jour"] = j;
        return o;
    }));

    private static List<LigneConditionReprise> LireLignes(string json)
    {
        using var d = JsonDocument.Parse(json);
        return d.RootElement.EnumerateArray().Select(e => new LigneConditionReprise(
            e.TryGetProperty("pct", out var p) ? p.GetDecimal() : 100,
            e.TryGetProperty("delai", out var dl) ? dl.GetInt32() : 0,
            e.TryGetProperty("base", out var b) ? b.GetString() ?? BaseEcheance.Net : BaseEcheance.Net,
            e.TryGetProperty("jour", out var j) && j.ValueKind == JsonValueKind.Number ? j.GetInt32() : null)).ToList();
    }

    /// <summary>
    /// Code ISO d'un pays source : déjà au format, sinon table « pays » des correspondances (casse et accents ignorés) ;
    /// inconnu : avertissement et null.
    /// </summary>
    public static string? Pays(ContexteReprise ctx, string? valeur, string emplacement)
    {
        if (string.IsNullOrWhiteSpace(valeur)) return null;
        if (PaysIso.Code(valeur) is { } iso) return iso;
        var table = ctx.Correspondances.Tables[TablesCorrespondance.Pays];
        var cle = Associations.Normaliser(valeur);
        var e = table.Trouver(valeur) ?? table.Entrees.FirstOrDefault(x => Associations.Normaliser(x.Source) == cle);
        if (e is null || e.Ignorer)
        {
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, ErreurCorrespondance.SansCible, emplacement,
                $"{TablesCorrespondance.Pays} : valeur « {valeur} » sans correspondance");
            return null;
        }
        ctx.Rapport.Appliquer(TablesCorrespondance.Pays, valeur, e.Cible!);
        return e.Cible;
    }
}

/// <summary>Noms des tables des fichiers de correspondances lues par les domaines du cœur.</summary>
public static class TablesCorrespondance
{
    public const string Pays = "pays";
    public const string Civilite = "civilite";
    public const string ModePaiement = "mode_paiement";
    public const string RegroupementNature = "regroupement_nature";
    public const string Compteur = "compteur";
    public const string TableFiche = "table_fiche";
    public const string TypeChamp = "type_champ";
    public const string Entite = "entite";
    public const string TypeTiers = "type_tiers";
    public const string TiersPayeur = "tiers_payeur";
    public const string CategorieTiers = "categorie_tiers";
    public const string TypeElement = "type_element";
    public const string FonctionIntervenant = "fonction_intervenant";
    public const string TypeDocument = "type_document";
    public const string TypeFacture = "type_facture";
    public const string TypeLigneVente = "type_ligne_vente";
    public const string TypeDocumentVente = "type_document_vente";
    public const string TypeDocumentAchat = "type_document_achat";
    public const string TypeLigneAchat = "type_ligne_achat";
}
