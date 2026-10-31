using System.Data;
using LogiBTP.Fiches;
using Npgsql;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Lien entre les salariés du cœur (salarie.sal_ind_id) et l'annuaire. Fiche individu : résumé du salarié lié
/// (champ géré « salarie »). Salarié enregistré : l'individu reprend l'identité (nom, prénom, naissance, actif), le
/// rôle salarié ou intérimaire et son rattachement à l'agence (fonction = poste, service, date d'entrée). Réplique de
/// synchroniserSalarie (client/src/app/annuaire/salaries.js).
/// </summary>
public static class SalariesAnnuaire
{
    private static async Task<T> Executer<T>(IServiceProvider sp, Func<NpgsqlConnection, Task<T>> f, CancellationToken ct)
    {
        var cnx = (NpgsqlConnection)sp.GetRequiredService<LogiBtpContext>().Database.GetDbConnection();
        var ouverte = cnx.State == ConnectionState.Open;
        if (!ouverte) await cnx.OpenAsync(ct);
        try { return await f(cnx); }
        finally { if (!ouverte) await cnx.CloseAsync(); }
    }

    private static NpgsqlCommand Commande(NpgsqlConnection cnx, string sql, params (string Nom, object? Valeur)[] p)
    {
        var cmd = new NpgsqlCommand(sql, cnx);
        foreach (var (nom, valeur) in p) cmd.Parameters.AddWithValue(nom, valeur ?? DBNull.Value);
        return cmd;
    }

    /// <summary>Résumé du salarié lié à un individu, ou null.</summary>
    public static Task<object?> Salarie(IServiceProvider sp, long indId, CancellationToken ct) => Executer<object?>(sp, async cnx =>
    {
        await using var cmd = Commande(cnx, "SELECT sal_id, sal_code, sal_poste, sal_agence, sal_statut, sal_actif FROM salarie WHERE sal_ind_id = @i", ("i", indId));
        await using var rd = await cmd.ExecuteReaderAsync(ct);
        if (!await rd.ReadAsync(ct)) return null;
        return new
        {
            id = rd.GetInt32(0), code = rd.IsDBNull(1) ? null : rd.GetString(1), poste = rd.IsDBNull(2) ? null : rd.GetString(2), agence = rd.IsDBNull(3) ? null : rd.GetString(3),
            statut = rd.IsDBNull(4) ? null : rd.GetString(4), actif = rd.GetBoolean(5),
        };
    }, ct);

    private static string? Texte(object? v) => v?.ToString() is { Length: > 0 } s ? s : null;

    /// <summary>Individu du salarié mis à jour avec les valeurs de la fiche salarié (ligne complète après modification).</summary>
    public static Task Synchroniser(IServiceProvider sp, IReadOnlyDictionary<string, object?> v, CancellationToken ct) => Executer(sp, async cnx =>
    {
        if (ValidationFiche.Nombre(v.GetValueOrDefault("ind_id")) is not { } d) return 0;
        var ind = (long)d;
        var interim = Texte(v.GetValueOrDefault("statut")) == "INTERIM";
        var actif = v.GetValueOrDefault("actif") is not false;
        var naissance = Texte(v.GetValueOrDefault("date_naissance"));
        await using (var cmd = Commande(cnx, """
            UPDATE individu SET ind_nom = @nom, ind_prenom = @prenom, ind_actif = @actif,
                   ind_date_naissance = coalesce(CAST(@naissance AS date), ind_date_naissance),
                   ind_roles = jsonb_build_array(CAST(@contrat AS text)) || coalesce((SELECT jsonb_agg(r) FROM jsonb_array_elements_text(ind_roles) r
                                                                                 WHERE r NOT IN ('SALARIE', 'INTERIMAIRE')), '[]'::jsonb)
            WHERE ind_id = @i
            """, ("nom", Texte(v.GetValueOrDefault("nom"))), ("prenom", Texte(v.GetValueOrDefault("prenom"))), ("actif", actif),
            ("naissance", naissance is null ? null : naissance[..10]), ("contrat", interim ? "INTERIMAIRE" : "SALARIE"), ("i", ind)))
        {
            await cmd.ExecuteNonQueryAsync(ct);
        }
        // Salarié sorti : son compte est désactivé d'office et ses sessions fermées (module Authentification, lot 1).
        if (!actif)
        {
            await using var compte = Commande(cnx, """
                WITH c AS (UPDATE compte SET cpt_actif = FALSE, cpt_maj_le = now(), cpt_maj_par = 'sortie_salarie'
                           WHERE cpt_type_element = 'individu' AND cpt_id_element = CAST(@i AS text) AND cpt_actif RETURNING cpt_id, cpt_code),
                     s AS (UPDATE session_utilisateur SET ses_fermee_le = now() WHERE ses_cpt_id IN (SELECT cpt_id FROM c) AND ses_fermee_le IS NULL)
                INSERT INTO journal_connexion (jco_code, jco_evenement, jco_detail, jco_par) SELECT cpt_code, 'COMPTE', 'désactivé : salarié sorti', 'sortie_salarie' FROM c
                """, ("i", ind));
            if (await compte.ExecuteNonQueryAsync(ct) > 0) LogiBTP.Authentification.Web.ServiceAuthentification.OublierSessions();
        }
        // Agence : personne de l'annuaire (notre société ou un de ses niveaux inférieurs, v_agences_societe de db/247) ;
        // le rattachement du salarié à l'une d'elles est déplacé, sinon créé.
        var agence = long.TryParse(Texte(v.GetValueOrDefault("agence")), out var a) ? a : (long?)null;
        var poste = Texte(v.GetValueOrDefault("poste"));
        var entree = Texte(v.GetValueOrDefault("date_entree"));
        await using var maj = Commande(cnx, """
            WITH agence AS (SELECT per_id FROM v_agences_societe WHERE per_id = @agence),
            maj AS (
                UPDATE rattachement SET rat_fonction = @fonction, rat_service = @service, rat_debut = CAST(@debut AS date), rat_actif = @actif,
                       rat_per_id = coalesce((SELECT per_id FROM agence), rat_per_id), rat_modifie_le = now()
                WHERE rat_ind_id = @i AND rat_per_id IN (SELECT per_id FROM v_agences_societe)
                RETURNING rat_id)
            INSERT INTO rattachement (rat_ind_id, rat_per_id, rat_fonction, rat_service, rat_debut, rat_actif)
            SELECT @i, per_id, @fonction, @service, CAST(@debut AS date), @actif FROM agence WHERE NOT EXISTS (SELECT 1 FROM maj)
            """, ("agence", agence), ("fonction", poste is null ? null : poste + (interim ? " (intérim)" : "")), ("service", Texte(v.GetValueOrDefault("service"))),
            ("debut", entree is null ? null : entree[..10]), ("actif", actif), ("i", ind));
        return await maj.ExecuteNonQueryAsync(ct);
    }, ct);
}
