using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Documents.Web;

/// <summary>Mode de règlement (mode_reglement, 019k).</summary>
public class ModeReglement
{
    public string MreCode { get; set; } = "";
    public string MreLibelle { get; set; } = "";
    public short MreOrdre { get; set; }
    public bool MreActif { get; set; } = true;
}

public sealed record ModeReglementDto(string Code, string Libelle, short Ordre, bool Actif);
public sealed record UniteDto(string Code, string Libelle, short Precision, int Ordre, bool Actif, string[] Synonymes);
/// <summary>Numérotation d'un type : préfixe, format, remise à zéro, dernier rang de l'exercice en cours, prochain numéro.</summary>
public sealed record NumerotationType(string Code, string Libelle, string Famille, string? Prefixe, string? Format, string Raz, bool Continue,
    int Exercice, int Dernier, string Prochain);
public sealed record NumerotationSaisie(string? Prefixe, string? Format, string Raz, int? Dernier);

/// <summary>
/// Référentiels paramétrables du module (lot 2 des demandes du 25/10/2026) : modes de règlement, unités (décimales
/// par défaut, synonymes), numérotation des types (format, remise à zéro, reprise du dernier rang). Écriture :
/// administrateur ; un élément retiré qui sert encore est désactivé.
/// </summary>
public sealed class ReferentielsDocument<TDoc, TLigne>(DocumentDbContext<TDoc, TLigne> db)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
{
    public async Task<List<ModeReglementDto>> Modes(bool tous, CancellationToken ct) =>
        (await db.ModesReglement.AsNoTracking().Where(m => tous || m.MreActif).OrderBy(m => m.MreOrdre).ThenBy(m => m.MreCode).ToListAsync(ct))
        .Select(m => new ModeReglementDto(m.MreCode, m.MreLibelle, m.MreOrdre, m.MreActif)).ToList();

    public async Task<List<ModeReglementDto>> EnregistrerModes(List<ModeReglementDto> modes, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        var erreurs = modes.Where(m => string.IsNullOrWhiteSpace(m.Code) || m.Code.Length > 20 || string.IsNullOrWhiteSpace(m.Libelle))
            .Select(m => $"{m.Code} : code (20 caractères au plus) et libellé obligatoires").ToList();
        if (modes.GroupBy(m => m.Code).Any(g => g.Count() > 1)) erreurs.Add("Codes de mode en double");
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide("MODE_REGLEMENT", string.Join(" ; ", erreurs));
        var existants = await db.ModesReglement.ToListAsync(ct);
        foreach (var m in modes)
        {
            var e = existants.FirstOrDefault(x => x.MreCode == m.Code);
            if (e is null) db.ModesReglement.Add(e = new ModeReglement { MreCode = m.Code });
            e.MreLibelle = m.Libelle.Trim();
            e.MreOrdre = m.Ordre;
            e.MreActif = m.Actif;
        }
        foreach (var e in existants.Where(x => modes.All(m => m.Code != x.MreCode)))
        {
            if (await db.Documents.AnyAsync(d => d.EntModeReglement == e.MreCode, ct)) e.MreActif = false;
            else db.ModesReglement.Remove(e);
        }
        await db.SaveChangesAsync(ct);
        return await Modes(true, ct);
    }

    public async Task<List<UniteDto>> Unites(CancellationToken ct) =>
        (await db.Unites.AsNoTracking().OrderBy(x => x.UntOrdre).ThenBy(x => x.UntCode).ToListAsync(ct))
        .Select(x => new UniteDto(x.UntCode, x.UntLibelle, x.UntPrecisionQte, x.UntOrdre, x.UntActif, x.UntSynonymes)).ToList();

    /// <summary>Unités (administrateur) : une unité absente est supprimée si aucune ligne ne l'emploie, sinon désactivée.</summary>
    public async Task<List<UniteDto>> EnregistrerUnites(List<UniteDto> unites, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        var erreurs = new List<string>();
        foreach (var x in unites)
        {
            if (string.IsNullOrWhiteSpace(x.Code) || x.Code.Length > 10) erreurs.Add($"{x.Code} : code obligatoire (10 caractères au plus)");
            if (string.IsNullOrWhiteSpace(x.Libelle)) erreurs.Add($"{x.Code} : libellé obligatoire");
            if (x.Precision is < 0 or > 6) erreurs.Add($"{x.Code} : décimales entre 0 et 6");
        }
        if (unites.GroupBy(x => x.Code).Any(g => g.Count() > 1)) erreurs.Add("Codes d'unité en double");
        // Un synonyme ne désigne qu'une unité (et jamais le code d'une autre).
        var ecritures = unites.SelectMany(x => (x.Synonymes ?? []).Select(s => (Cle: CleUnite(s), x.Code))).Where(s => s.Cle.Length > 0)
            .Concat(unites.Select(x => (Cle: CleUnite(x.Code), x.Code)));
        foreach (var g in ecritures.GroupBy(e => e.Cle).Where(g => g.Select(e => e.Code).Distinct().Count() > 1))
            erreurs.Add($"« {g.Key} » désigne plusieurs unités ({string.Join(", ", g.Select(e => e.Code).Distinct())})");
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide("UNITE", string.Join(" ; ", erreurs.Distinct()));
        var existantes = await db.Unites.ToListAsync(ct);
        foreach (var x in unites)
        {
            var e = existantes.FirstOrDefault(y => y.UntCode == x.Code);
            if (e is null) db.Unites.Add(e = new Unite { UntCode = x.Code });
            e.UntLibelle = x.Libelle.Trim();
            e.UntPrecisionQte = x.Precision;
            e.UntOrdre = x.Ordre;
            e.UntActif = x.Actif;
            e.UntSynonymes = (x.Synonymes ?? []).Select(s => s.Trim()).Where(s => s.Length > 0).Distinct().ToArray();
        }
        foreach (var e in existantes.Where(y => unites.All(x => x.Code != y.UntCode)))
        {
            if (await db.Lignes.AnyAsync(l => l.LigUntCode == e.UntCode, ct)) e.UntActif = false;
            else db.Unites.Remove(e);
        }
        await db.SaveChangesAsync(ct);
        return await Unites(ct);
    }

    /// <summary>Clé de comparaison d'une écriture d'unité : minuscules, ² ³ en 2 3, sans espace, point ni accent.</summary>
    public static string CleUnite(string? s) =>
        new string((s ?? "").ToLowerInvariant().Replace('²', '2').Replace('³', '3').Normalize(System.Text.NormalizationForm.FormD)
            .Where(c => char.IsLetterOrDigit(c) && System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark).ToArray());

    public async Task<List<NumerotationType>> Numerotations(CancellationToken ct)
    {
        var annee = DateTime.Today.Year;
        var types = await db.TypesDocument.AsNoTracking().OrderBy(t => t.TydFamille).ThenBy(t => t.TydCode).ToListAsync(ct);
        var compteurs = await db.CompteursNumero.AsNoTracking().ToListAsync(ct);
        return types.Select(t =>
        {
            var exercice = NumeroDocument.Exercice(t.TydRazNumero, annee);
            var dernier = compteurs.FirstOrDefault(c => c.CnuTydId == t.TydId && c.CnuExercice == exercice)?.CnuDernierNumero ?? 0;
            return new NumerotationType(t.TydCode, t.TydLibelle, t.TydFamille, t.TydPrefixeNumero, t.TydFormatNumero, t.TydRazNumero, t.TydNumerotationContinue,
                exercice, dernier, NumeroDocument.Formater(t.TydFormatNumero, t.TydPrefixeNumero, annee, dernier + 1));
        }).ToList();
    }

    /// <summary>
    /// Numérotation d'un type (administrateur) : préfixe, format contrôlé, remise à zéro ; reprise : dernier rang de
    /// l'exercice en cours (le suivant sera attribué ; un rang déjà pris est sauté à l'attribution).
    /// </summary>
    public async Task<List<NumerotationType>> EnregistrerNumerotation(string code, NumerotationSaisie s, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        var t = await db.TypesDocument.FirstOrDefaultAsync(x => x.TydCode == code, ct) ?? throw ExceptionMetier.Introuvable($"Type {code}");
        var raz = s.Raz == "J" ? "J" : "A";
        var format = string.IsNullOrWhiteSpace(s.Format) || s.Format.Trim() == NumeroDocument.FormatDefaut ? null : s.Format.Trim();
        if (NumeroDocument.Controler(format, raz) is { } erreur) throw ExceptionMetier.Invalide("NUMERO_FORMAT", erreur);
        if (s.Prefixe?.Trim().Length > 10) throw ExceptionMetier.Invalide("NUMERO_FORMAT", "Préfixe de 10 caractères au plus");
        if (s.Dernier is < 0) throw ExceptionMetier.Invalide("NUMERO_REPRISE", "Dernier numéro positif ou nul");
        t.TydPrefixeNumero = string.IsNullOrWhiteSpace(s.Prefixe) ? null : s.Prefixe.Trim();
        t.TydFormatNumero = format;
        t.TydRazNumero = raz;
        await db.SaveChangesAsync(ct);
        if (s.Dernier is int dernier)
        {
            var exercice = NumeroDocument.Exercice(t.TydRazNumero, DateTime.Today.Year);
            await db.Database.ExecuteSqlAsync($"""
                INSERT INTO compteur_numero (cnu_tyd_id, cnu_exercice, cnu_dernier_numero) VALUES ({t.TydId}, {exercice}, {dernier})
                ON CONFLICT (cnu_tyd_id, cnu_exercice) DO UPDATE SET cnu_dernier_numero = {dernier}
                """, ct);
        }
        return await Numerotations(ct);
    }
}
