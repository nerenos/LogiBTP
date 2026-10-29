using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Chantiers techniques créés par l'application dans une affaire de gestion (MATERIEL : suivi des coûts d'un matériel ;
/// DOTATIONS : dotations d'un salarié).
/// </summary>
public static class ChantiersTechniques
{
    /// <summary>
    /// Chantier de ce code dans l'affaire de gestion, créé s'il manque (le même s'il existe déjà dans cette affaire).
    /// Un code déjà pris par un chantier d'une autre affaire reçoit le suffixe donné (tronqué à 20 caractères en tout).
    /// Un stock tenu n'est jamais retiré à un chantier existant.
    /// </summary>
    public static async Task<int> CreerAsync(LogiBtpContext db, string code, string suffixe, string libelle, string affaire, string statut,
        bool stockTenu, string commentaire, CancellationToken ct)
    {
        code = code.ToUpperInvariant();
        if (code.Length > 20) code = code[..20];
        if (libelle.Length > 150) libelle = libelle[..150];
        var pris = await db.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS (SELECT 1 FROM chantier c WHERE c.cha_code = @code
                           AND c.cha_aff_id IS DISTINCT FROM (SELECT aff_id FROM affaire WHERE aff_code = @affaire)) AS "Value"
            """, new NpgsqlParameter("code", code), new NpgsqlParameter("affaire", affaire)).FirstAsync(ct);
        if (pris) code = (code.Length + suffixe.Length > 20 ? code[..(20 - suffixe.Length)] : code) + suffixe;
        return (await db.Database.SqlQueryRaw<int>("""
            INSERT INTO chantier (cha_code, cha_libelle, cha_aff_id, cha_statut, cha_stock_tenu, cha_commentaire)
            VALUES (@code, @libelle, (SELECT aff_id FROM affaire WHERE aff_code = @affaire), @statut, @stock, @commentaire)
            ON CONFLICT (cha_code) DO UPDATE SET cha_stock_tenu = chantier.cha_stock_tenu OR EXCLUDED.cha_stock_tenu
            RETURNING cha_id AS "Value"
            """, new NpgsqlParameter("code", code), new NpgsqlParameter("libelle", libelle), new NpgsqlParameter("affaire", affaire),
            new NpgsqlParameter("statut", statut), new NpgsqlParameter("stock", stockTenu), new NpgsqlParameter("commentaire", commentaire)).ToListAsync(ct))[0];
    }
}
