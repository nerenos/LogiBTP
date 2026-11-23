using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Documents.Web;

/// <summary>Étiquette de ligne (couleur en début de ligne : à vérifier, prix confirmé…).</summary>
public class EtiquetteLigne
{
    public string EtlCode { get; set; } = "";
    public string EtlLibelle { get; set; } = "";
    public string EtlCouleur { get; set; } = "#999999";
    public int EtlOrdre { get; set; }
    public bool EtlActif { get; set; } = true;
}

/// <summary>Seconde couleur du marqueur selon le mode de vente (O option, M pour mémoire, A variante).</summary>
public class CouleurTypePrix
{
    public string CtpType { get; set; } = "";
    public string CtpLibelle { get; set; } = "";
    public string CtpCouleur { get; set; } = "#999999";
}

/// <summary>Style d'une classe de ligne à un niveau (table style_ligne) : global, famille ou type de document.</summary>
public class StyleLigneParametre
{
    public int SliId { get; set; }
    public string SliClasse { get; set; } = "";
    public string? SliFamille { get; set; }
    public int? SliTydId { get; set; }
    public JsonDocument SliValeur { get; set; } = JsonDocument.Parse("{}");
}

/// <summary>Modèle de saisie d'un document (complet, chiffrage, à la volée…).</summary>
public class ModeleDocument
{
    public string ModCode { get; set; } = "";
    public string ModLibelle { get; set; } = "";
    public int ModOrdre { get; set; }
    public bool ModActif { get; set; } = true;
}

/// <summary>Vue de colonnes de la grille des lignes : globale (propriétaire null) ou d'un utilisateur.</summary>
public class VueDocument
{
    public int VdoId { get; set; }
    public string VdoNom { get; set; } = "";
    public int? VdoTydId { get; set; }
    public string? VdoModCode { get; set; }
    public string? VdoProprietaire { get; set; }
    public bool VdoParDefaut { get; set; }
    public JsonDocument VdoDefinition { get; set; } = JsonDocument.Parse("{}");
    public DateTimeOffset VdoModifieLe { get; set; }
    public string? VdoModifiePar { get; set; }
}

/// <summary>Vue enregistrée ou proposée (globale si Globale).</summary>
public sealed class VueDocumentDto
{
    public int Id { get; set; }
    public string Nom { get; set; } = "";
    public int? TydId { get; set; }
    public string? ModCode { get; set; }
    public bool Globale { get; set; }
    public string? Proprietaire { get; set; }
    public bool ParDefaut { get; set; }
    public JsonElement Definition { get; set; }
}

public sealed record EtiquetteDto(string Code, string Libelle, string Couleur, int Ordre, bool Actif);

public sealed record CouleurTypePrixDto(string Type, string Libelle, string Couleur);

public sealed record ModeleDto(string Code, string Libelle);

/// <summary>
/// Affichage de la saisie (classe mère) : étiquettes de lignes et couleurs des modes de vente (paramétrage global),
/// vues de colonnes globales ou par utilisateur, vue par défaut par type et modèle de document.
/// </summary>
public class AffichageDocumentService<TDoc, TLigne>(DocumentDbContext<TDoc, TLigne> db)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
{
    protected DocumentDbContext<TDoc, TLigne> Db => db;

    public virtual async Task<List<EtiquetteDto>> Etiquettes(CancellationToken ct) =>
        (await db.Set<EtiquetteLigne>().AsNoTracking().OrderBy(e => e.EtlOrdre).ThenBy(e => e.EtlCode).ToListAsync(ct))
            .Select(e => new EtiquetteDto(e.EtlCode, e.EtlLibelle, e.EtlCouleur, e.EtlOrdre, e.EtlActif)).ToList();

    public virtual async Task<List<CouleurTypePrixDto>> CouleursTypePrix(CancellationToken ct) =>
        (await db.Set<CouleurTypePrix>().AsNoTracking().OrderBy(c => c.CtpType).ToListAsync(ct))
            .Select(c => new CouleurTypePrixDto(c.CtpType, c.CtpLibelle, c.CtpCouleur)).ToList();

    public virtual async Task<List<ModeleDto>> Modeles(CancellationToken ct) =>
        (await db.Set<ModeleDocument>().AsNoTracking().Where(m => m.ModActif).OrderBy(m => m.ModOrdre).ToListAsync(ct))
            .Select(m => new ModeleDto(m.ModCode, m.ModLibelle)).ToList();

    private static bool Couleur(string? c) => c is { Length: 7 } && c[0] == '#' && c[1..].All(Uri.IsHexDigit);

    /// <summary>Liste globale des étiquettes remplacée (administrateur) ; codes en majuscules.</summary>
    public virtual async Task<List<EtiquetteDto>> EnregistrerEtiquettes(List<EtiquetteDto> liste, Utilisateur u, CancellationToken ct)
    {
        u.ExigerParametres();
        var codes = new HashSet<string>();
        foreach (var e in liste)
        {
            var code = (e.Code ?? "").Trim().ToUpperInvariant();
            if (!System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z][A-Z0-9_]{0,19}$")) throw ExceptionMetier.Invalide("CODE", $"Code d'étiquette invalide : {e.Code}");
            if (!codes.Add(code)) throw ExceptionMetier.Invalide("CODE", $"Code d'étiquette en double : {code}");
            if (string.IsNullOrWhiteSpace(e.Libelle)) throw ExceptionMetier.Invalide("LIBELLE", $"Libellé obligatoire ({code})");
            if (!Couleur(e.Couleur)) throw ExceptionMetier.Invalide("COULEUR", $"Couleur #rrggbb attendue ({code})");
        }
        await using var tx = await db.Unite().CommencerAsync(ct);
        await db.Set<EtiquetteLigne>().ExecuteDeleteAsync(ct);
        db.Set<EtiquetteLigne>().AddRange(liste.Select(e => new EtiquetteLigne
        {
            EtlCode = e.Code.Trim().ToUpperInvariant(), EtlLibelle = e.Libelle.Trim(), EtlCouleur = e.Couleur.ToLowerInvariant(), EtlOrdre = e.Ordre, EtlActif = e.Actif,
        }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await Etiquettes(ct);
    }

    public virtual async Task<List<CouleurTypePrixDto>> EnregistrerCouleurs(List<CouleurTypePrixDto> liste, Utilisateur u, CancellationToken ct)
    {
        u.ExigerParametres();
        foreach (var c in liste)
        {
            var e = await db.Set<CouleurTypePrix>().FindAsync([c.Type], ct) ?? throw ExceptionMetier.Introuvable($"Mode de vente {c.Type}");
            if (!Couleur(c.Couleur)) throw ExceptionMetier.Invalide("COULEUR", $"Couleur #rrggbb attendue ({c.Type})");
            e.CtpCouleur = c.Couleur.ToLowerInvariant();
        }
        await db.SaveChangesAsync(ct);
        return await CouleursTypePrix(ct);
    }

    /// <summary>Styles paramétrés des classes de ligne (global, famille, type) : le client les résout avec styles-lignes.js.</summary>
    public virtual async Task<List<StyleParametre>> StylesLignes(CancellationToken ct)
    {
        var types = await db.TypesDocument.AsNoTracking().ToDictionaryAsync(t => t.TydId, t => t.TydCode, ct);
        return (await db.Set<StyleLigneParametre>().AsNoTracking().OrderBy(x => x.SliClasse).ThenBy(x => x.SliFamille).ThenBy(x => x.SliTydId).ToListAsync(ct))
            .Select(x => new StyleParametre(x.SliClasse, x.SliFamille, x.SliTydId is int t ? types.GetValueOrDefault(t) : null, x.SliValeur.RootElement.Clone())).ToList();
    }

    /// <summary>Contexte de résolution des styles d'un document : famille et type du document, styles paramétrés, styles propres du document.</summary>
    public async Task<ContexteStyles> ContexteStyles(TypeDocument type, JsonDocument? stylesDocument, CancellationToken ct) =>
        new(type.TydFamille, type.TydCode, await StylesLignes(ct), stylesDocument?.RootElement.Clone());

    /// <summary>Styles paramétrés remplacés (administrateur) : classes connues, un niveau (famille ou type), valeurs valides ; un style vide est retiré.</summary>
    public virtual async Task<List<StyleParametre>> EnregistrerStylesLignes(List<StyleParametre> saisie, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        var types = await db.TypesDocument.AsNoTracking().ToDictionaryAsync(t => t.TydCode, t => t.TydId, ct);
        var erreurs = new List<string>();
        foreach (var s in saisie)
        {
            if (!ClassesStyleLigne.Toutes.Contains(s.Classe)) erreurs.Add($"Classe de style {s.Classe} inconnue");
            if (s.Famille is not null && !FamillesDocument.Toutes.Contains(s.Famille)) erreurs.Add($"{s.Classe} : famille {s.Famille} inconnue");
            if (s.Type is not null && !types.ContainsKey(s.Type)) erreurs.Add($"{s.Classe} : type {s.Type} inconnu");
            if (s.Type is not null && s.Famille is not null) erreurs.Add($"{s.Classe} : une famille ou un type, pas les deux");
            erreurs.AddRange(LogiBTP.Documents.StylesLignes.Erreurs(s.Valeur).Select(e => $"{s.Classe} : {e}"));
        }
        if (saisie.GroupBy(s => (s.Classe, s.Famille, s.Type)).Any(g => g.Count() > 1)) erreurs.Add("Un style n'a qu'une valeur par niveau");
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide("STYLES", string.Join(" ; ", erreurs.Distinct()));

        await using var tx = await db.Unite().CommencerAsync(ct);
        await db.Set<StyleLigneParametre>().ExecuteDeleteAsync(ct);
        db.Set<StyleLigneParametre>().AddRange(saisie
            .Select(s => (S: s, Style: LogiBTP.Documents.StylesLignes.Normaliser(s.Valeur)))
            .Where(x => !x.Style.EstVide)
            .Select(x => new StyleLigneParametre
            {
                SliClasse = x.S.Classe, SliFamille = x.S.Famille, SliTydId = x.S.Type is string t ? types[t] : null,
                SliValeur = JsonDocument.Parse(x.Style.VersJson().ToJsonString()),
            }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await StylesLignes(ct);
    }

    private static VueDocumentDto VersDto(VueDocument v) => new()
    {
        Id = v.VdoId, Nom = v.VdoNom, TydId = v.VdoTydId, ModCode = v.VdoModCode, Globale = v.VdoProprietaire is null, Proprietaire = v.VdoProprietaire,
        ParDefaut = v.VdoParDefaut, Definition = v.VdoDefinition.RootElement.Clone(),
    };

    /// <summary>Vues visibles pour un type de document : globales et celles de l'utilisateur (tous types ou ce type).</summary>
    public virtual async Task<List<VueDocumentDto>> Vues(string? type, Utilisateur u, CancellationToken ct)
    {
        var tydId = type is null ? null : await db.TypesDocument.Where(t => t.TydCode == type).Select(t => (int?)t.TydId).FirstOrDefaultAsync(ct);
        return (await db.Set<VueDocument>().AsNoTracking()
                .Where(v => (v.VdoProprietaire == null || v.VdoProprietaire == u.Code) && (v.VdoTydId == null || v.VdoTydId == tydId))
                .OrderBy(v => v.VdoProprietaire != null).ThenBy(v => v.VdoNom).ToListAsync(ct))
            .Select(VersDto).ToList();
    }

    /// <summary>
    /// Vue créée ou modifiée : une vue globale (et la vue par défaut d'un type et d'un modèle) est réservée à un
    /// administrateur ; une vue personnelle n'est modifiable que par son propriétaire.
    /// </summary>
    public virtual async Task<VueDocumentDto> EnregistrerVue(VueDocumentDto d, Utilisateur u, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(d.Nom)) throw ExceptionMetier.Invalide("NOM", "Nom de la vue obligatoire");
        if ((d.Globale || d.ParDefaut) && !u.EstAdmin) throw ExceptionMetier.ParametrageRefuse();
        if (d.Definition.ValueKind != JsonValueKind.Object || !d.Definition.TryGetProperty("colonnes", out var cols) || cols.ValueKind != JsonValueKind.Array)
            throw ExceptionMetier.Invalide("DEFINITION", "Définition de vue : colonnes attendues");
        var v = d.Id > 0 ? await db.Set<VueDocument>().FindAsync([d.Id], ct) ?? throw ExceptionMetier.Introuvable($"Vue {d.Id}") : null;
        if (v is not null && v.VdoProprietaire is not null && v.VdoProprietaire != u.Code) throw ExceptionMetier.AccesRefuse(ActionsDroits.Modifier);
        if (v is not null && v.VdoProprietaire is null && !u.EstAdmin) throw ExceptionMetier.ParametrageRefuse();
        v ??= db.Set<VueDocument>().Add(new VueDocument()).Entity;
        v.VdoNom = d.Nom.Trim();
        v.VdoTydId = d.TydId;
        v.VdoModCode = string.IsNullOrWhiteSpace(d.ModCode) ? null : d.ModCode;
        v.VdoProprietaire = d.Globale || d.ParDefaut ? null : u.Code;
        v.VdoDefinition = JsonDocument.Parse(d.Definition.GetRawText());
        v.VdoModifieLe = DateTimeOffset.UtcNow;
        v.VdoModifiePar = u.Code;
        await using var tx = await db.Unite().CommencerAsync(ct);
        // Une seule vue par défaut par type et modèle.
        if (d.ParDefaut)
            await db.Set<VueDocument>().Where(x => x.VdoParDefaut && x.VdoTydId == v.VdoTydId && x.VdoModCode == v.VdoModCode && x.VdoId != v.VdoId)
                .ExecuteUpdateAsync(x => x.SetProperty(y => y.VdoParDefaut, false), ct);
        v.VdoParDefaut = d.ParDefaut;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return VersDto(v);
    }

    public virtual async Task SupprimerVue(int id, Utilisateur u, CancellationToken ct)
    {
        var v = await db.Set<VueDocument>().FindAsync([id], ct) ?? throw ExceptionMetier.Introuvable($"Vue {id}");
        if (v.VdoProprietaire is null ? !u.EstAdmin : v.VdoProprietaire != u.Code) throw ExceptionMetier.AccesRefuse(ActionsDroits.Supprimer);
        db.Remove(v);
        await db.SaveChangesAsync(ct);
    }
}
