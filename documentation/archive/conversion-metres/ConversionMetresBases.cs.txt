using LogiBTP.Metres;
using LogiBTP.Socle.Web;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Migration des métrés saisis en lignes vers les scripts (documentation/conception/CONCEPTION-SCRIPT.md), au démarrage de l'API,
/// pour la base principale et chaque société configurée. Une base qui a encore la table metre_ligne est convertie en
/// une transaction : métrés des documents (ConversionMetre), compositions d'ouvrage et d'ensemble de la bibliothèque
/// (ele_composition), puis suppression de metre_ligne. Sans cette table, rien n'est fait (base neuve ou déjà convertie).
/// Les instantanés de l'historique des documents et les cas de test archivés ne sont pas modifiés.
/// </summary>
public static class ConversionMetresBases
{
    public static async Task ConvertirAsync(IServiceProvider services, ILogger logger, CancellationToken ct = default)
    {
        var o = services.GetRequiredService<IOptions<OptionsSocietes>>().Value;
        var bases = new List<(string Nom, string Connexion)>();
        if (!string.IsNullOrEmpty(o.Principale)) bases.Add(("principale", o.Principale));
        foreach (var (code, s) in o.Liste) if (!string.IsNullOrEmpty(s.Connexion)) bases.Add((code, s.Connexion));
        foreach (var (nom, connexion) in bases)
        {
            try
            {
                var (metres, elements) = await ConvertirBaseAsync(connexion, ct);
                if (metres >= 0) logger.LogInformation("Métrés convertis en scripts ({Base}) : {Metres} métré(s), {Elements} composition(s) ; table metre_ligne supprimée", nom, metres, elements);
            }
            catch (Exception e) when (e is NpgsqlException or InvalidOperationException)
            {
                logger.LogError(e, "Conversion des métrés impossible pour la base {Base}", nom);
            }
        }
    }

    /// <summary>Convertit une base ; renvoie (-1, 0) si elle n'a plus de table metre_ligne.</summary>
    public static async Task<(int Metres, int Elements)> ConvertirBaseAsync(string connexion, CancellationToken ct = default)
    {
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync(ct);
        if (!await ExisteAsync(cnx, "metre_ligne", ct)) return (-1, 0);
        await using var tx = await cnx.BeginTransactionAsync(ct);

        // Colonnes du script (modules/metre/db/021), au cas où le script n'aurait pas encore été appliqué.
        await ExecuterAsync(cnx, """
            ALTER TABLE metre ADD COLUMN IF NOT EXISTS mtr_script TEXT;
            ALTER TABLE variable_definition ADD COLUMN IF NOT EXISTS var_type CHAR(1) NOT NULL DEFAULT 'N' CHECK (var_type IN ('N','C','B'));
            ALTER TABLE variable_definition ADD COLUMN IF NOT EXISTS var_valeur_texte TEXT;
            """, ct);

        var lignes = new List<LigneMetreAncienne>();
        await using (var cmd = new NpgsqlCommand("""
            SELECT mli_id, mli_mtr_id, mli_parent_id, mli_ordre, mli_type, mli_operateur, mli_formule, mli_st_depuis_id, mli_variable, mli_commentaire
            FROM metre_ligne
            """, cnx))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                lignes.Add(new LigneMetreAncienne
                {
                    MliId = r.GetInt64(0), MliMtrId = r.GetInt64(1), MliParentId = r.IsDBNull(2) ? null : r.GetInt64(2), MliOrdre = r.GetInt32(3),
                    MliType = r.GetString(4), MliOperateur = r.IsDBNull(5) ? null : r.GetString(5), MliFormule = r.IsDBNull(6) ? null : r.GetString(6),
                    MliStDepuisId = r.IsDBNull(7) ? null : r.GetInt64(7), MliVariable = r.IsDBNull(8) ? null : r.GetString(8),
                    MliCommentaire = r.IsDBNull(9) ? null : r.GetString(9),
                });
            }
        }
        var metres = new List<Metre>();
        await using (var cmd = new NpgsqlCommand("SELECT mtr_id, mtr_lig_id, mtr_variable FROM metre WHERE mtr_script IS NULL", cnx))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct)) metres.Add(new Metre { MtrId = r.GetInt64(0), MtrLigId = r.GetInt64(1), MtrVariable = r.IsDBNull(2) ? null : r.GetString(2) });
        }
        var definitions = new List<VariableDefinition>();
        await using (var cmd = new NpgsqlCommand("""
            SELECT var_id, var_ent_id, var_lig_id, var_mtr_id, var_portee, var_nom, var_operation, var_formule, var_ordre
            FROM variable_definition WHERE var_mtr_id IS NOT NULL
            """, cnx))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                definitions.Add(new VariableDefinition
                {
                    VarId = r.GetInt64(0), VarEntId = r.GetInt64(1), VarLigId = r.IsDBNull(2) ? null : r.GetInt64(2), VarMtrId = r.GetInt64(3),
                    VarPortee = r.GetString(4), VarNom = r.GetString(5), VarOperation = r.GetString(6), VarFormule = r.GetString(7), VarOrdre = r.GetInt32(8),
                });
            }
        }

        foreach (var m in metres)
        {
            var defs = definitions.Where(d => d.VarMtrId == m.MtrId).ToList();
            var c = ConversionMetre.Convertir(m, lignes, defs);
            await ExecuterAsync(cnx, "UPDATE metre SET mtr_script = @s, mtr_variable = @v WHERE mtr_id = @id", ct,
                ("s", c.MtrScript), ("v", (object?)c.MtrVariable ?? DBNull.Value), ("id", m.MtrId));
            // Définitions reprises dans le script : supprimées ; les autres deviennent des variables de ligne.
            var restantes = c.VariablesLigne.Select(v => v.VarId).ToArray();
            await ExecuterAsync(cnx, "DELETE FROM variable_definition WHERE var_mtr_id = @id AND NOT (var_id = ANY(@ids))", ct, ("id", m.MtrId), ("ids", restantes));
            await ExecuterAsync(cnx, "UPDATE variable_definition SET var_mtr_id = NULL, var_lig_id = @lig WHERE var_id = ANY(@ids)", ct,
                ("lig", m.MtrLigId), ("ids", restantes));
        }

        var elements = 0;
        if (await ExisteAsync(cnx, "element", ct))
        {
            var compositions = new List<(long Id, string Json)>();
            await using (var cmd = new NpgsqlCommand("SELECT ele_id, ele_composition::text FROM element WHERE ele_composition ? 'metre_lignes'", cnx))
            await using (var r = await cmd.ExecuteReaderAsync(ct))
            {
                while (await r.ReadAsync(ct)) compositions.Add((r.GetInt64(0), r.GetString(1)));
            }
            foreach (var (id, json) in compositions)
            {
                await ExecuterAsync(cnx, "UPDATE element SET ele_composition = @j::jsonb WHERE ele_id = @id", ct, ("j", ConversionMetre.ConvertirComposition(json)), ("id", id));
                elements++;
            }
        }

        await ExecuterAsync(cnx, "DROP TABLE metre_ligne", ct);
        await tx.CommitAsync(ct);
        return (metres.Count, elements);
    }

    private static async Task<bool> ExisteAsync(NpgsqlConnection cnx, string table, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("SELECT to_regclass(@t) IS NOT NULL", cnx);
        cmd.Parameters.AddWithValue("t", table);
        return (bool)(await cmd.ExecuteScalarAsync(ct))!;
    }

    private static async Task ExecuterAsync(NpgsqlConnection cnx, string sql, CancellationToken ct, params (string Nom, object Valeur)[] parametres)
    {
        await using var cmd = new NpgsqlCommand(sql, cnx);
        foreach (var (nom, valeur) in parametres) cmd.Parameters.AddWithValue(nom, valeur);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
