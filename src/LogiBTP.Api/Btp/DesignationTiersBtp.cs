using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>Tiers désigné (garde-fou TIERS) : code, raison sociale et ville d'une personne morale ; particulier : code seul.</summary>
public sealed record TiersDesigne(long PerId, string? PerCode, string? PerRaisonSociale, string? Ville, bool Particulier);

/// <summary>
/// Désignation d'un tiers pour l'utiliser dans une pièce (plans/mcp.md, lot 6 ; ANALYSE-MODULE-MCP.md § 5.2, Q6), sans
/// exposer la fiche : ni coordonnées, ni contacts, ni IBAN, ni encours. Route de lecture dédiée (sous-arbre « documents » :
/// qui consulte des pièces y voit leurs tiers), que l'annuaire (retenu par le garde-fou TIERS) ne fournit
/// pas sous cette forme. Personne morale : recherche par mots sur code, raison sociale, nom commercial, ville ;
/// particulier (niveau non moral) : trouvé seulement par son code exact, rendu sous son code seul.
/// </summary>
public static class DesignationTiersBtp
{
    /// <summary>Nombre de tiers rendus par défaut et au plus.</summary>
    public const int LimiteDefaut = 20, LimiteMax = 50;

    private sealed record LigneTiers(long PerId, string? PerCode, string PerRaisonSociale, string? Ville, bool Morale);

    /// <summary>Mots de la recherche (espaces), vides ignorés.</summary>
    public static string[] Mots(string? recherche) => (recherche ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>Désignation d'une ligne : rien d'un particulier hormis son code (Q6).</summary>
    public static TiersDesigne Designer(long id, string? code, string raisonSociale, string? ville, bool morale) =>
        morale ? new(id, code, raisonSociale, ville, false) : new(id, code, null, null, true);

    public static async Task<List<TiersDesigne>> RechercherAsync(LogiBtpContext db, string? recherche, long? id, string? casquette, int? limite, CancellationToken ct)
    {
        var mots = Mots(recherche);
        if (mots.Length == 0 && id is null) return [];
        var code = mots.Length == 1 ? mots[0] : "";
        var n = Math.Clamp(limite ?? LimiteDefaut, 1, LimiteMax);
        var cas = string.IsNullOrWhiteSpace(casquette) ? null : casquette.Trim();
        var lignes = await db.Database.SqlQuery<LigneTiers>($"""
            SELECT p.per_id, p.per_code, p.per_raison_sociale, p.ville, coalesce(p.niv_morale, TRUE) AS morale
            FROM v_annuaire_personnes p
            WHERE p.per_actif
              AND ({id}::bigint IS NULL OR p.per_id = {id}::bigint)
              AND ({cas}::text IS NULL OR jsonb_exists(p.per_casquettes, {cas}::text))
              AND (cardinality({mots}::text[]) = 0
                   OR (coalesce(p.niv_morale, TRUE)
                       AND NOT EXISTS (SELECT 1 FROM unnest({mots}::text[]) m
                                       WHERE f_annuaire_normaliser(concat_ws(' ', p.per_code, p.per_raison_sociale, p.per_nom_commercial, p.ville))
                                             NOT LIKE '%' || f_annuaire_normaliser(m) || '%'))
                   OR (NOT coalesce(p.niv_morale, TRUE) AND upper(p.per_code) = upper({code})))
            ORDER BY p.per_raison_sociale, p.per_id
            LIMIT {n}
            """).ToListAsync(ct);
        return lignes.Select(l => Designer(l.PerId, l.PerCode, l.PerRaisonSociale, l.Ville, l.Morale)).ToList();
    }

    /// <summary>GET /api/designation/tiers?recherche=&amp;id=&amp;casquette=&amp;limite= (lecture seule ; aucune écriture).</summary>
    public static RouteGroupBuilder MapDesignationTiers(this RouteGroupBuilder api)
    {
        api.MapGet("/designation/tiers", (string? recherche, long? id, string? casquette, int? limite, LogiBtpContext db, CancellationToken ct) =>
            RechercherAsync(db, recherche, id, casquette, limite, ct));
        return api;
    }
}
