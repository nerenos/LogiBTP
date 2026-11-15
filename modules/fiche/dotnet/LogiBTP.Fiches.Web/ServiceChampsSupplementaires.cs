using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Fiches.Web;

/// <summary>
/// Administration des champs supplémentaires en colonnes « x_ » des tables des fiches (administrateur seulement,
/// <c>u.ExigerAdmin()</c>). Le DDL n'est jamais émis ici : il passe par les fonctions SQL SECURITY DEFINER
/// fiche_champ_creer / fiche_champ_retirer (module Fiche 1.1), dans l'unité d'écriture ; après création ou suppression,
/// les caches des colonnes de la base (IPurgeCacheBase : types de colonnes de ServiceFiche, schémas de ServiceListe) sont vidés.
/// </summary>
public class ServiceChampsSupplementaires(FicheDbContext db, IEnumerable<IPurgeCacheBase> purges)
{
    private static ExceptionMetier Refus(params ErreurChamp[] erreurs) =>
        ExceptionMetier.Invalide(ErreursEnregistrement.Validation, "Champ supplémentaire refusé", erreurs.ToList());

    private static ExceptionMetier Refus(List<ErreurChamp> erreurs) =>
        ExceptionMetier.Invalide(ErreursEnregistrement.Validation, "Champ supplémentaire refusé", erreurs);

    private static ChampColonneDto Vers(ChampColonne c) =>
        new(c.FcsTable, c.FcsColonne, c.FcsType, c.FcsLibelle, c.FcsOrdre, c.FcsType == TypesChampSupplementaire.Liste ? ChampsSupplementaires.LireValeurs(c.FcsValeurs) : null, c.FcsActif);

    /// <summary>Tables ouvertes : tables principales des fiches déclarées par l'application (type_fiche actifs), avec leurs types.</summary>
    public virtual async Task<List<TableOuverteDto>> Tables(Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        var types = await db.Types.AsNoTracking().Where(t => t.TyfActif).OrderBy(t => t.TyfTable).ThenBy(t => t.TyfCode).Select(t => new { t.TyfTable, t.TyfCode }).ToListAsync(ct);
        return types.GroupBy(t => t.TyfTable).Select(g => new TableOuverteDto(g.Key, g.Select(t => t.TyfCode).ToList())).ToList();
    }

    public virtual async Task<List<ChampColonneDto>> Lister(string? table, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        var q = db.ChampsColonnes.AsNoTracking();
        if (!string.IsNullOrEmpty(table)) q = q.Where(c => c.FcsTable == table);
        return (await q.OrderBy(c => c.FcsTable).ThenBy(c => c.FcsOrdre).ThenBy(c => c.FcsColonne).ToListAsync(ct)).Select(Vers).ToList();
    }

    public virtual async Task<ChampColonneDto> Creer(DemandeChampColonne d, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        var erreurs = ChampsSupplementaires.ValiderCreation(d.Colonne, d.Type, d.Libelle, d.Valeurs);
        if (erreurs.Count > 0) throw Refus(erreurs);
        if (!await db.Types.AnyAsync(t => t.TyfTable == d.Table && t.TyfActif, ct))
            throw Refus(new ErreurChamp(d.Colonne, ErreursChampSupplementaire.TableFermee, $"Table non ouverte aux champs supplémentaires : {d.Table}"));
        var valeurs = d.Type == TypesChampSupplementaire.Liste
            ? JsonSerializer.Serialize(d.Valeurs!.Select(v => new OptionChamp { Valeur = v.Valeur, Libelle = string.IsNullOrWhiteSpace(v.Libelle) ? v.Valeur : v.Libelle }))
            : null;
        try
        {
            await db.Unite().ExecuterAsync(async ctu =>
            {
                var unite = db.Unite();
                await using var cmd = new NpgsqlCommand("SELECT fiche_champ_creer(@t, @c, @y, @l, @o, CAST(@v AS jsonb))", unite.Connexion, unite.Transaction);
                cmd.Parameters.AddWithValue("t", d.Table);
                cmd.Parameters.AddWithValue("c", d.Colonne);
                cmd.Parameters.AddWithValue("y", d.Type);
                cmd.Parameters.AddWithValue("l", d.Libelle);
                cmd.Parameters.AddWithValue("o", d.Ordre);
                cmd.Parameters.Add(new NpgsqlParameter("v", NpgsqlDbType.Text) { Value = (object?)valeurs ?? DBNull.Value });
                await cmd.ExecuteNonQueryAsync(ctu);
                return true;
            }, ct);
        }
        catch (PostgresException e) when (Traduire(e, d.Colonne) is { } erreur)
        {
            throw Refus(erreur);
        }
        PurgerCaches();
        return Vers(await db.ChampsColonnes.AsNoTracking().FirstAsync(c => c.FcsTable == d.Table && c.FcsColonne == d.Colonne, ct));
    }

    public virtual async Task<ChampColonneDto> Modifier(string table, string colonne, ModificationChampColonne m, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        var champ = await db.ChampsColonnes.AsNoTracking().FirstOrDefaultAsync(c => c.FcsTable == table && c.FcsColonne == colonne, ct)
            ?? throw ExceptionMetier.Introuvable($"Champ supplémentaire {table}.{colonne}");
        var erreurs = new List<ErreurChamp>();
        if (ChampsSupplementaires.ValiderLibelle(m.Libelle, colonne) is { } e) erreurs.Add(e);
        if (champ.FcsType == TypesChampSupplementaire.Liste) erreurs.AddRange(ChampsSupplementaires.ValiderValeurs(m.Valeurs, colonne));
        if (erreurs.Count > 0) throw Refus(erreurs);
        var valeurs = champ.FcsType == TypesChampSupplementaire.Liste
            ? JsonSerializer.Serialize(m.Valeurs!.Select(v => new OptionChamp { Valeur = v.Valeur, Libelle = string.IsNullOrWhiteSpace(v.Libelle) ? v.Valeur : v.Libelle }))
            : null;
        await db.Unite().ExecuterAsync(async ctu =>
        {
            var unite = db.Unite();
            await using var cmd = new NpgsqlCommand("""
                UPDATE fiche_champ_supplementaire
                   SET fcs_libelle = @l, fcs_ordre = @o, fcs_valeurs = CAST(@v AS jsonb), fcs_actif = @a, fcs_modifie_le = now()
                 WHERE fcs_table = @t AND fcs_colonne = @c
                """, unite.Connexion, unite.Transaction);
            cmd.Parameters.AddWithValue("l", m.Libelle.Trim());
            cmd.Parameters.AddWithValue("o", m.Ordre);
            cmd.Parameters.Add(new NpgsqlParameter("v", NpgsqlDbType.Text) { Value = (object?)valeurs ?? DBNull.Value });
            cmd.Parameters.AddWithValue("a", m.Actif);
            cmd.Parameters.AddWithValue("t", table);
            cmd.Parameters.AddWithValue("c", colonne);
            await cmd.ExecuteNonQueryAsync(ctu);
            return true;
        }, ct);
        return Vers(await db.ChampsColonnes.AsNoTracking().FirstAsync(c => c.FcsTable == table && c.FcsColonne == colonne, ct));
    }

    /// <summary>Retire la colonne et son inscription (les valeurs saisies sont perdues : l'interface demande confirmation).</summary>
    public virtual async Task Supprimer(string table, string colonne, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        if (!ChampsSupplementaires.NomValide(colonne)) throw Refus(new ErreurChamp(colonne, ErreursChampSupplementaire.NomInvalide, "Nom de colonne invalide"));
        if (!await db.ChampsColonnes.AnyAsync(c => c.FcsTable == table && c.FcsColonne == colonne, ct))
            throw ExceptionMetier.Introuvable($"Champ supplémentaire {table}.{colonne}");
        try
        {
            await db.Unite().ExecuterAsync(async ctu =>
            {
                var unite = db.Unite();
                await using var cmd = new NpgsqlCommand("SELECT fiche_champ_retirer(@t, @c)", unite.Connexion, unite.Transaction);
                cmd.Parameters.AddWithValue("t", table);
                cmd.Parameters.AddWithValue("c", colonne);
                await cmd.ExecuteNonQueryAsync(ctu);
                return true;
            }, ct);
        }
        catch (PostgresException e) when (Traduire(e, colonne) is { } erreur)
        {
            throw Refus(erreur);
        }
        PurgerCaches();
    }

    /// <summary>Erreur d'une fonction SQL (« CODE : message ») traduite en erreur de champ ; null si ce n'est pas l'un des nôtres.</summary>
    private static ErreurChamp? Traduire(PostgresException e, string colonne)
    {
        var code = e.MessageText.Split(' ', 2)[0];
        return code.StartsWith("CHAMP_", StringComparison.Ordinal) ? new ErreurChamp(colonne, code, e.MessageText[(code.Length)..].TrimStart(' ', ':')) : null;
    }

    /// <summary>Colonnes de la base de la société courante modifiées : caches des colonnes vidés (fiches, listes).</summary>
    private void PurgerCaches()
    {
        var connexion = db.Database.GetConnectionString();
        if (connexion is null) return;
        foreach (var p in purges) p.Purger(connexion);
    }
}
