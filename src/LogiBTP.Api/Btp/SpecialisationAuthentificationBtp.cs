using LogiBTP.Authentification.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Spécialisation du module Authentification par le cœur (ANALYSE-MODULE-AUTHENTIFICATION.md, A3 à A5) : un compte se
/// lie à l'individu d'un salarié (CDI, CDD) ou d'un intérimaire actif ; un intérimaire a une fin de validité
/// obligatoire (fin de mission) et ne peut pas être administrateur ; le pseudo du compte est recopié dans
/// <c>individu.ind_utilisateur</c> (identifiant lu par les autres modules : CRM…).
/// </summary>
public class SpecialisationAuthentificationBtp : SpecialisationAuthentification
{
    private const string SqlPersonnes = """
        SELECT i.ind_id::text AS id, concat_ws(' ', i.ind_prenom, i.ind_nom) AS libelle, i.ind_actif AS individu_actif,
               s.sal_statut AS statut, s.sal_actif AS salarie_actif, s.sal_matricule AS matricule
        FROM individu i
        LEFT JOIN LATERAL (SELECT sal_statut, sal_actif, sal_matricule FROM demo_salarie WHERE sal_ind_id = i.ind_id
                           ORDER BY sal_actif DESC, sal_id DESC LIMIT 1) s ON TRUE
        """;

    private sealed record LignePersonne(string Id, string Libelle, bool IndividuActif, string? Statut, bool? SalarieActif, string? Matricule);

    private static PersonneCompte Decrire(LignePersonne l)
    {
        var interim = l.Statut == "INTERIM";
        string? motif = !l.IndividuActif ? "individu inactif"
            : l.Statut is null ? "aucun salarié ni intérimaire lié à cet individu"
            : l.SalarieActif != true ? (interim ? "intérimaire inactif" : "salarié inactif (sorti)") : null;
        var statut = l.Statut switch { "INTERIM" => "Intérimaire", "CDD" => "Salarié (CDD)", "CDI" => "Salarié (CDI)", _ => null };
        return new PersonneCompte("individu", l.Id, l.Libelle, motif is null, interim, interim ? ["ADMIN"] : [],
            statut is null ? null : l.Matricule is null ? statut : $"{statut} · {l.Matricule}", null, motif);
    }

    public override async Task<PersonneCompte?> PersonneAsync(AuthDbContext db, string type, string id, CancellationToken ct)
    {
        if (type != "individu" || !long.TryParse(id, out var ind)) return null;
        var l = await db.Database.SqlQueryRaw<LignePersonne>(SqlPersonnes + " WHERE i.ind_id = @id", new NpgsqlParameter("id", ind)).FirstOrDefaultAsync(ct);
        return l is null ? null : Decrire(l);
    }

    public override async Task<List<PersonneCompte>> RechercherPersonnesAsync(AuthDbContext db, string texte, CancellationToken ct)
    {
        var lignes = await db.Database.SqlQueryRaw<LignePersonne>(SqlPersonnes + """
             WHERE s.sal_statut IS NOT NULL AND s.sal_actif AND i.ind_actif
               AND (concat_ws(' ', i.ind_prenom, i.ind_nom) ILIKE @t OR concat_ws(' ', i.ind_nom, i.ind_prenom) ILIKE @t OR s.sal_matricule ILIKE @t)
             ORDER BY lower(i.ind_nom), lower(i.ind_prenom) LIMIT 30
            """, new NpgsqlParameter("t", $"%{texte.Trim()}%")).ToListAsync(ct);
        return lignes.Select(Decrire).ToList();
    }

    /// <summary>Le pseudo du compte devient l'identifiant de connexion de l'individu (ancien identifiant retiré).</summary>
    public override async Task ApresEcritureAsync(AuthDbContext db, Compte compte, string? ancienCode, CancellationToken ct)
    {
        if (compte.CptTypeElement != "individu" || !long.TryParse(compte.CptIdElement, out var ind)) return;
        await db.Database.ExecuteSqlRawAsync("UPDATE individu SET ind_utilisateur = NULL WHERE ind_id <> @id AND lower(ind_utilisateur) = lower(@code)",
            [new NpgsqlParameter("id", ind), new NpgsqlParameter("code", compte.CptCode)], ct);
        await db.Database.ExecuteSqlRawAsync("UPDATE individu SET ind_utilisateur = @code WHERE ind_id = @id",
            [new NpgsqlParameter("id", ind), new NpgsqlParameter("code", compte.CptCode)], ct);
    }
}
