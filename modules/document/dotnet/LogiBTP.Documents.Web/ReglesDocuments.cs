using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Documents.Web;

/// <summary>Valeur d'une règle saisie : code, niveau (famille ou code de type, ou aucun pour global), valeur, active.</summary>
public sealed record RegleSaisie(string Code, string? Famille, string? Type, JsonElement Valeur, bool Actif = true);

/// <summary>Catalogue et valeurs paramétrées des règles (page de paramétrage).</summary>
public sealed record ReglesParametrage(List<DefinitionRegle> Catalogue, List<RegleSaisie> Regles);

/// <summary>
/// Règles des documents à trois niveaux (CONCEPTION-REGLES-DOCUMENTS.md, § 6.1) : valeur du type, sinon de sa famille,
/// sinon globale, sinon par défaut du catalogue (module et spécialisation). Lecture mise en cache pour la requête.
/// </summary>
public sealed class ReglesDocuments<TDoc, TLigne, TComplet>(DocumentDbContext<TDoc, TLigne> db, SpecialisationDocument<TDoc, TLigne, TComplet> specialisation)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
    where TComplet : DocumentComplet<TDoc, TLigne>, new()
{
    private List<RegleDocument>? lues;

    public IReadOnlyList<DefinitionRegle> Catalogue => specialisation.Regles.ToList();

    private async Task<List<RegleDocument>> Lues(CancellationToken ct) =>
        lues ??= await db.Set<RegleDocument>().AsNoTracking().Where(r => r.RdoActif).ToListAsync(ct);

    /// <summary>Valeur d'une règle pour un type : type, famille, global, défaut du catalogue (null si inconnue).</summary>
    public async Task<JsonNode?> Valeur(string code, TypeDocument type, CancellationToken ct)
    {
        var l = (await Lues(ct)).Where(r => r.RdoCode == code).ToList();
        var r = l.FirstOrDefault(x => x.RdoTydId == type.TydId)
            ?? l.FirstOrDefault(x => x.RdoTydId is null && x.RdoFamille == type.TydFamille)
            ?? l.FirstOrDefault(x => x.RdoTydId is null && x.RdoFamille is null);
        return r is not null ? JsonNode.Parse(r.RdoValeur.RootElement.GetRawText()) : Catalogue.FirstOrDefault(d => d.Code == code)?.Defaut?.DeepClone();
    }

    public async Task<bool> Booleen(string code, TypeDocument type, CancellationToken ct) =>
        await Valeur(code, type, ct) is JsonValue v && v.TryGetValue<bool>(out var b) && b;

    public async Task<decimal?> Nombre(string code, TypeDocument type, CancellationToken ct) =>
        await Valeur(code, type, ct) is JsonValue v && v.TryGetValue<decimal>(out var n) ? n : null;

    public async Task<string?> Texte(string code, TypeDocument type, CancellationToken ct) =>
        await Valeur(code, type, ct) is JsonValue v && v.TryGetValue<string>(out var t) ? t : null;

    /// <summary>Valeurs résolues de toutes les règles du catalogue pour un type (définition transmise au client).</summary>
    public async Task<Dictionary<string, JsonNode?>> Resolues(TypeDocument type, CancellationToken ct)
    {
        var res = new Dictionary<string, JsonNode?>();
        foreach (var d in Catalogue) res[d.Code] = await Valeur(d.Code, type, ct);
        return res;
    }

    public async Task<ReglesParametrage> Lire(CancellationToken ct)
    {
        var types = await db.TypesDocument.AsNoTracking().ToDictionaryAsync(t => t.TydId, t => t.TydCode, ct);
        var regles = await db.Set<RegleDocument>().AsNoTracking().OrderBy(r => r.RdoCode).ThenBy(r => r.RdoTydId).ThenBy(r => r.RdoFamille).ToListAsync(ct);
        return new ReglesParametrage(Catalogue.ToList(), regles.Select(r => new RegleSaisie(r.RdoCode, r.RdoFamille,
            r.RdoTydId is int t ? types.GetValueOrDefault(t) : null, r.RdoValeur.RootElement.Clone(), r.RdoActif)).ToList());
    }

    /// <summary>Valeurs paramétrées remplacées (administrateur) : codes du catalogue, niveau unique, valeur du bon genre.</summary>
    public async Task<ReglesParametrage> Enregistrer(List<RegleSaisie> saisie, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        var types = await db.TypesDocument.AsNoTracking().ToDictionaryAsync(t => t.TydCode, t => t.TydId, ct);
        var catalogue = Catalogue.ToDictionary(d => d.Code);
        var erreurs = new List<string>();
        foreach (var r in saisie)
        {
            if (!catalogue.TryGetValue(r.Code, out var d)) { erreurs.Add($"Règle {r.Code} inconnue"); continue; }
            if (r.Famille is not null && !FamillesDocument.Toutes.Contains(r.Famille)) erreurs.Add($"{d.Libelle} : famille {r.Famille} inconnue");
            if (r.Type is not null && !types.ContainsKey(r.Type)) erreurs.Add($"{d.Libelle} : type {r.Type} inconnu");
            if (r.Type is not null && r.Famille is not null) erreurs.Add($"{d.Libelle} : une famille ou un type, pas les deux");
            var ok = d.Genre switch
            {
                "BOOLEEN" => r.Valeur.ValueKind is JsonValueKind.True or JsonValueKind.False,
                "NOMBRE" => r.Valeur.ValueKind == JsonValueKind.Number,
                "CHOIX" => r.Valeur.ValueKind == JsonValueKind.String && (d.Choix?.Contains(r.Valeur.GetString()!) ?? true),
                _ => true,
            };
            if (!ok) erreurs.Add($"{d.Libelle} : valeur invalide");
        }
        if (saisie.GroupBy(r => (r.Code, r.Famille, r.Type)).Any(g => g.Count() > 1)) erreurs.Add("Une règle n'a qu'une valeur par niveau");
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide("REGLES", string.Join(" ; ", erreurs.Distinct()));

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Set<RegleDocument>().ExecuteDeleteAsync(ct);
        db.Set<RegleDocument>().AddRange(saisie.Select(r => new RegleDocument
        {
            RdoCode = r.Code, RdoFamille = r.Famille, RdoTydId = r.Type is string t ? types[t] : null,
            RdoValeur = JsonDocument.Parse(r.Valeur.GetRawText()), RdoActif = r.Actif,
        }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        lues = null;
        return await Lire(ct);
    }
}
