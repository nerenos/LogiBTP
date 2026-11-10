using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.FactureElectronique.Web;

/// <summary>
/// Étape à inscrire au journal : type (<see cref="EvenementFe"/>), flux et élément de l'application, états avant / après
/// (<see cref="EtatFlux"/>, ou code de statut <see cref="StatutCdv"/> pour un statut), acteur (<see cref="ActeurFe"/>) et
/// utilisateur, détail (sérialisé en JSON snake_case, champs sensibles retirés).
/// </summary>
public sealed record EtapeFe(string Type, string Acteur)
{
    public long? FluxId { get; init; }
    public string? TypeElement { get; init; }
    public string? IdElement { get; init; }
    public string? EtatAvant { get; init; }
    public string? EtatApres { get; init; }
    public string? Utilisateur { get; init; }
    public object? Detail { get; init; }

    /// <summary>Étape d'un flux : flux, élément et utilisateur repris.</summary>
    public static EtapeFe Du(FluxFe f, string type, string acteur, string? utilisateur = null) =>
        new(type, acteur) { FluxId = f.FflId, TypeElement = f.FflTypeElement, IdElement = f.FflIdElement, Utilisateur = utilisateur };
}

/// <summary>Étape lue du journal (chronologie).</summary>
public sealed record EvenementDto(long Id, long Rang, long? FluxId, string? TypeElement, string? IdElement, string Type, string? EtatAvant,
    string? EtatApres, string Acteur, string? Utilisateur, JsonElement? Detail, DateTimeOffset Horodatage, string Empreinte);

/// <summary>Vérification de la chaîne : entrées lues, première rupture (rang et raison), empreinte de la dernière entrée (à noter hors de la base).</summary>
public sealed record VerificationJournal(bool Ok, int Entrees, long? RangRompu, string? Raison, string? DerniereEmpreinte);

/// <summary>
/// Journal des étapes fe_evenement, en ajout seul et chaîné par empreinte. L'écriture passe par un INSERT dont le
/// trigger fn_fe_evenement_chainer pose le rang, l'horodatage du serveur (milliseconde) et les empreintes sous verrou de
/// transaction ; la vérification recalcule ici la même empreinte sur le texte du JSONB rendu par PostgreSQL. Un détail ne
/// contient jamais de jeton ni de secret (champs retirés, textes passés par <see cref="Masquage"/>).
/// </summary>
public static class JournalFe
{
    public static readonly string EmpreinteOrigine = new('0', 64);

    private static readonly string[] ChampsSensibles = ["jeton", "token", "secret", "authorization", "autorisation", "password", "mot_de_passe", "bearer"];

    private const string Selection =
        "SELECT fev_id, fev_rang, fev_ffl_id, fev_type_element, fev_id_element, fev_type, fev_etat_avant, fev_etat_apres, fev_acteur, " +
        "fev_utilisateur, fev_detail::text AS fev_detail, fev_horodatage, fev_empreinte_precedente, fev_empreinte FROM fe_evenement";

    /// <summary>Inscrit une étape (dans la transaction courante du contexte, s'il y en a une).</summary>
    public static Task AjouterAsync(FactureElectroniqueDbContext db, EtapeFe e, CancellationToken ct)
    {
        var detail = Detail(e.Detail);
        return db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO fe_evenement (fev_rang, fev_ffl_id, fev_type_element, fev_id_element, fev_type, fev_etat_avant, fev_etat_apres,
                fev_acteur, fev_utilisateur, fev_detail, fev_horodatage, fev_empreinte_precedente, fev_empreinte)
            VALUES (0, {e.FluxId}, {e.TypeElement}, {e.IdElement}, {e.Type}, {e.EtatAvant}, {e.EtatApres}, {e.Acteur}, {e.Utilisateur},
                CAST({detail} AS jsonb), now(), '', '')
            """, ct);
    }

    /// <summary>Détail en JSON (snake_case) sans champ sensible ; null si absent.</summary>
    public static string? Detail(object? detail)
    {
        if (detail is null) return null;
        var noeud = detail as JsonNode ?? JsonSerializer.SerializeToNode(detail, JsonCalcul.Options);
        return noeud is null ? null : Nettoyer(noeud)?.ToJsonString(JsonCalcul.Options);
    }

    private static JsonNode? Nettoyer(JsonNode? n)
    {
        switch (n)
        {
            case JsonObject o:
                foreach (var cle in o.Select(p => p.Key).ToList())
                {
                    if (ChampsSensibles.Any(s => cle.Contains(s, StringComparison.OrdinalIgnoreCase))) o.Remove(cle);
                    else o[cle] = Nettoyer(o[cle]?.DeepClone());
                }
                return o;
            case JsonArray a:
                for (var i = 0; i < a.Count; i++) a[i] = Nettoyer(a[i]?.DeepClone());
                return a;
            case JsonValue v when v.TryGetValue<string>(out var s):
                return JsonValue.Create(Masquage.Texte(s));
            default:
                return n;
        }
    }

    /// <summary>Étapes dans l'ordre de la chaîne (texte du détail tel que PostgreSQL le rend).</summary>
    public static IQueryable<EvenementFeEntite> Lire(FactureElectroniqueDbContext db) =>
        db.Evenements.FromSqlRaw(Selection).AsNoTracking();

    /// <summary>Chronologie d'un flux, ou d'un élément de l'application (toutes ses étapes et celles de ses flux, tous flux confondus).</summary>
    public static async Task<List<EvenementDto>> ChronologieAsync(FactureElectroniqueDbContext db, long? fluxId, string? typeElement, string? idElement,
        CancellationToken ct)
    {
        var q = Lire(db);
        if (fluxId is long f) q = q.Where(e => e.FevFflId == f);
        // Élément : ses étapes et toutes celles des flux qui lui sont rattachés (réception et lecture d'avant le rattachement).
        if (typeElement is not null)
        {
            var flux = db.Flux.Where(x => x.FflTypeElement == typeElement && x.FflIdElement == idElement).Select(x => (long?)x.FflId);
            q = q.Where(e => (e.FevTypeElement == typeElement && e.FevIdElement == idElement) || flux.Contains(e.FevFflId));
        }
        var lignes = await q.OrderBy(e => e.FevRang).ToListAsync(ct);
        return [.. lignes.Select(Dto)];
    }

    public static EvenementDto Dto(EvenementFeEntite e) => new(e.FevId, e.FevRang, e.FevFflId, e.FevTypeElement, e.FevIdElement, e.FevType,
        e.FevEtatAvant, e.FevEtatApres, e.FevActeur, e.FevUtilisateur,
        e.FevDetail is null ? null : JsonSerializer.Deserialize<JsonElement>(e.FevDetail), e.FevHorodatage, e.FevEmpreinte);

    /// <summary>Vérifie toute la chaîne de la base.</summary>
    public static async Task<VerificationJournal> VerifierAsync(FactureElectroniqueDbContext db, CancellationToken ct) =>
        Verifier(await Lire(db).OrderBy(e => e.FevRang).ToListAsync(ct));

    /// <summary>Texte d'une entrée (même formule que fn_fe_evenement_chainer).</summary>
    public static string Texte(EvenementFeEntite e) => string.Join('|',
        e.FevEmpreintePrecedente, e.FevRang.ToString(CultureInfo.InvariantCulture),
        e.FevHorodatage.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
        e.FevType, e.FevFflId?.ToString(CultureInfo.InvariantCulture) ?? "", e.FevTypeElement ?? "", e.FevIdElement ?? "", e.FevEtatAvant ?? "",
        e.FevEtatApres ?? "", e.FevActeur, e.FevUtilisateur ?? "", e.FevDetail ?? "");

    public static string Empreinte(EvenementFeEntite e) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Texte(e))));

    /// <summary>Vérification dans l'ordre des rangs : rangs consécutifs depuis 1, chaînage, puis empreinte de chaque entrée.</summary>
    public static VerificationJournal Verifier(IReadOnlyList<EvenementFeEntite> entrees)
    {
        var precedente = EmpreinteOrigine;
        for (var i = 0; i < entrees.Count; i++)
        {
            var e = entrees[i];
            if (e.FevRang != i + 1) return new(false, entrees.Count, e.FevRang, "Entrée manquante", null);
            if (e.FevEmpreintePrecedente != precedente) return new(false, entrees.Count, e.FevRang, "Chaînage rompu", null);
            if (Empreinte(e) != e.FevEmpreinte) return new(false, entrees.Count, e.FevRang, "Entrée modifiée", null);
            precedente = e.FevEmpreinte;
        }
        return new(true, entrees.Count, null, null, entrees.Count == 0 ? null : precedente);
    }
}
