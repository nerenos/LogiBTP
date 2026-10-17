using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using LogiBTP.Annuaire;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Annuaire.Web;

/// <summary>Doublons possibles d'un nouveau tiers : même SIRET (bloquant), noms proches (à confirmer).</summary>
public sealed record DoublonsTiers(ResumePersonne? Siret, List<ResumePersonne> Noms);

/// <summary>Saisie d'un tiers provisoire : raison sociale, SIRET, relations (casquettes), niveau ; Confirme : malgré des noms proches.</summary>
public sealed class SaisieProvisoire
{
    public string? RaisonSociale { get; set; }
    public string? Siret { get; set; }
    public List<string>? Casquettes { get; set; }
    public string? Niveau { get; set; }
    public bool Confirme { get; set; }
}

/// <summary>Fusion demandée : fiche conservée et choix par colonne (ou « +clé » d'un champ supplémentaire) : source | cible.</summary>
public sealed class DemandeFusion
{
    public long CibleId { get; set; }
    public Dictionary<string, string>? Choix { get; set; }
}

/// <summary>Aperçu d'une fusion : les deux fiches (colonnes fusionnables), conflits et plan par défaut.</summary>
public sealed record ApercuFusion(ResumePersonne Source, ResumePersonne Cible, Dictionary<string, object?> ValeursSource,
    Dictionary<string, object?> ValeursCible, IReadOnlyList<string> Conflits, IReadOnlyDictionary<string, object?> Valeurs);

/// <summary>Fusion réalisée : fiche conservée et nombre d'éléments reportés (contacts, coordonnées, documents…).</summary>
public sealed record FusionRealisee(long CibleId, Dictionary<string, int> Reports);

/// <summary>
/// Tiers provisoires : création après contrôle des doublons (SIRET, nom), validation de la création, fusion dans une
/// fiche existante (PlanFusion, contacts, coordonnées, liens et enfants reportés, références de l'application par
/// SpecialisationAnnuaire.ReporterFusionAsync, journal fusion_personne, fiche provisoire supprimée).
/// </summary>
public partial class ServiceAnnuaire
{
    [GeneratedRegex("^per_[a-z0-9_]+$")]
    private static partial Regex ColonnePersonne();

    public virtual async Task<DoublonsTiers> Doublons(string? raisonSociale, string? siret, long? exclure, CancellationToken ct)
    {
        var s = Texte(siret) is { } t ? await ParSiret(t, ct) : null;
        if (s is not null && s.Id == exclure) s = null;
        var mots = PlanFusion.MotsDoublon(raisonSociale);
        if (mots.Count == 0) return new(s, []);
        var p = new List<object?>();
        string P(object? v) { p.Add(v); return $"@p{p.Count - 1}"; }
        var conditions = mots.Take(8).Select(m =>
            $"f_annuaire_normaliser(concat_ws(' ', per_raison_sociale, per_nom_commercial)) LIKE '%' || f_annuaire_normaliser({P(m)}) || '%'").ToList();
        if (exclure is { } e) conditions.Add($"per_id <> {P(e)}");
        var lignes = await Lire($"{SelectPersonnes} WHERE {string.Join(" AND ", conditions)} ORDER BY per_actif DESC, per_raison_sociale, per_id LIMIT 10", p, ct);
        return new(s, lignes.Select(VersResume).Where(x => x.Id != s?.Id).ToList());
    }

    /// <summary>
    /// Nouveau tiers provisoire : SIRET valide et inconnu (409 DOUBLON_SIRET, la fiche existante en détail), aucun nom
    /// proche sauf confirmation (409 DOUBLON_NOM, les fiches proches en détail).
    /// </summary>
    public virtual async Task<ResumePersonne> CreerProvisoire(SaisieProvisoire saisie, Utilisateur u, CancellationToken ct)
    {
        var raison = Texte(saisie.RaisonSociale) ?? throw Validation("Raison sociale obligatoire", "raison_sociale", "OBLIGATOIRE", "Raison sociale obligatoire");
        var siret = Texte(saisie.Siret) is { } s ? Identifiants.Compacter(s) : null;
        if (siret is not null && !Identifiants.SiretValide(siret)) throw Validation("SIRET invalide", "siret", "SIRET", "SIRET invalide (14 chiffres, clé de contrôle)");
        var doublons = await Doublons(raison, siret, null, ct);
        if (doublons.Siret is { } existant)
            throw ExceptionMetier.Conflit("DOUBLON_SIRET", $"SIRET déjà enregistré : {existant.RaisonSociale} ({existant.Code})", new { personne = existant });
        if (!saisie.Confirme && doublons.Noms.Count > 0)
            throw ExceptionMetier.Conflit("DOUBLON_NOM", "Des tiers de nom proche existent déjà : vérifiez avant de créer", new { personnes = doublons.Noms });
        var niveau = Texte(saisie.Niveau) ?? specialisation.NiveauProvisoire;
        if (!await db.Niveaux.AnyAsync(n => n.NivCode == niveau, ct)) throw Validation("Niveau inconnu", "niveau", "NIVEAU", $"Niveau {niveau} inconnu");
        var personne = new Personne
        {
            PerNivCode = niveau, PerRaisonSociale = raison, PerSiret = siret, PerSiren = siret?[..9],
            PerCasquettes = JsonSerializer.SerializeToDocument((saisie.Casquettes ?? []).Where(c => !string.IsNullOrWhiteSpace(c)).Distinct().ToList()),
            PerProvisoire = true, PerProvisoirePar = u.Code, PerProvisoireLe = DateTimeOffset.UtcNow,
        };
        db.Personnes.Add(personne);
        await db.SaveChangesAsync(ct);
        return await Personne(personne.PerId, ct);
    }

    private void ExigerValidation(Utilisateur u)
    {
        if (!specialisation.PeutValiderTiers(u)) throw ExceptionMetier.AccesRefuse("VALIDER_TIERS");
    }

    /// <summary>Validation de la création d'un tiers provisoire (droit VALIDER_TIERS) : il devient une fiche définitive.</summary>
    public virtual async Task<ResumePersonne> ValiderProvisoire(long id, Utilisateur u, CancellationToken ct)
    {
        ExigerValidation(u);
        var n = await db.Personnes.Where(p => p.PerId == id && p.PerProvisoire)
            .ExecuteUpdateAsync(x => x.SetProperty(p => p.PerProvisoire, false).SetProperty(p => p.PerValidePar, u.Code).SetProperty(p => p.PerValideLe, DateTimeOffset.UtcNow), ct);
        if (n == 0) throw ExceptionMetier.Conflit("NON_PROVISOIRE", "Cette fiche n'est pas un tiers provisoire");
        return await Personne(id, ct);
    }

    /// <summary>Ligne complète de personne : colonnes fusionnables, relations et champs supplémentaires.</summary>
    private async Task<(Dictionary<string, object?> Valeurs, List<string> Casquettes, Dictionary<string, object?> Proprietes, bool Provisoire)> LigneFusion(
        long id, bool verrouiller, CancellationToken ct)
    {
        var l = (await Lire($"SELECT * FROM personne WHERE per_id = @p0{(verrouiller ? " FOR UPDATE" : "")}", [id], ct)).FirstOrDefault()
            ?? throw ExceptionMetier.Introuvable($"Personne {id}");
        var valeurs = l.Where(kv => kv.Key.StartsWith("per_", StringComparison.Ordinal) && !PlanFusion.ColonnesNonFusionnees.Contains(kv.Key))
            .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);
        var proprietes = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (l.GetValueOrDefault("per_proprietes") is string json && JsonDocument.Parse(json).RootElement is { ValueKind: JsonValueKind.Object } o)
            foreach (var p in o.EnumerateObject())
                proprietes[p.Name] = p.Value.ValueKind switch
                {
                    JsonValueKind.String => p.Value.GetString(), JsonValueKind.Number => p.Value.GetDecimal(), JsonValueKind.True => true,
                    JsonValueKind.False => false, JsonValueKind.Null => null, _ => p.Value.GetRawText(),
                };
        return (valeurs, ListeJson(l.GetValueOrDefault("per_casquettes")), proprietes, l.GetValueOrDefault("per_provisoire") is true);
    }

    /// <summary>Valeurs d'un aperçu, lisibles côté client (dates ISO, nombres invariants).</summary>
    private static Dictionary<string, object?> Exposees(IReadOnlyDictionary<string, object?> v) =>
        v.ToDictionary(kv => kv.Key, kv => kv.Value switch
        {
            DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            DateTime d => d.ToString("O", CultureInfo.InvariantCulture),
            _ => kv.Value,
        }, StringComparer.Ordinal);

    public virtual async Task<ApercuFusion> Apercu(long id, long cibleId, CancellationToken ct)
    {
        if (id == cibleId) throw Validation("Fusion", "cible_id", "MEME_FICHE", "Choisissez une autre fiche que le tiers provisoire");
        var s = await LigneFusion(id, false, ct);
        var k = await LigneFusion(cibleId, false, ct);
        var plan = PlanFusion.Calculer(s.Valeurs, k.Valeurs, s.Casquettes, k.Casquettes, s.Proprietes, k.Proprietes);
        var vs = Exposees(s.Valeurs);
        var vk = Exposees(k.Valeurs);
        foreach (var (cle, v) in s.Proprietes) vs["+" + cle] = v;
        foreach (var (cle, v) in k.Proprietes) vk["+" + cle] = v;
        return new(await Personne(id, ct), await Personne(cibleId, ct), vs, vk, plan.Conflits, Exposees(plan.Valeurs));
    }

    /// <summary>
    /// Fusion d'un tiers provisoire dans une autre fiche (droit VALIDER_TIERS), en une transaction : valeurs choisies
    /// écrites sur la fiche conservée, coordonnées, contacts (un individu déjà contact garde un seul rattachement, ses
    /// coordonnées y sont reportées), liens et enfants reportés, références de l'application reportées par la
    /// spécialisation, journal, puis le provisoire supprimé (une référence restante annule tout : 409 FICHE_UTILISEE).
    /// </summary>
    public virtual async Task<FusionRealisee> Fusionner(long id, DemandeFusion demande, Utilisateur u, CancellationToken ct)
    {
        ExigerValidation(u);
        var cible = demande.CibleId;
        if (id == cible) throw Validation("Fusion", "cible_id", "MEME_FICHE", "Choisissez une autre fiche que le tiers provisoire");
        var choix = (demande.Choix ?? []).Where(kv => kv.Value is "source" or "cible").ToDictionary(kv => kv.Key, kv => kv.Value);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var cnx = (NpgsqlConnection)db.Database.GetDbConnection();
        var tx = (NpgsqlTransaction)transaction.GetDbTransaction();
        async Task<int> Executer(string sql, params object?[] parametres)
        {
            await using var cmd = new NpgsqlCommand(sql, cnx, tx);
            for (var i = 0; i < parametres.Length; i++)
                cmd.Parameters.Add(parametres[i] is NpgsqlParameter np ? np : new NpgsqlParameter($"p{i}", parametres[i] ?? DBNull.Value));
            return await cmd.ExecuteNonQueryAsync(ct);
        }

        var s = await LigneFusion(id, true, ct);
        if (!s.Provisoire) throw ExceptionMetier.Conflit("NON_PROVISOIRE", "Seul un tiers provisoire se fusionne dans une autre fiche");
        var k = await LigneFusion(cible, true, ct);
        var source = await Personne(id, ct);
        var plan = PlanFusion.Calculer(s.Valeurs, k.Valeurs, s.Casquettes, k.Casquettes, s.Proprietes, k.Proprietes, choix);
        var reports = new Dictionary<string, int>(StringComparer.Ordinal);

        // SIRET unique : retiré du provisoire avant d'être (éventuellement) repris par la fiche conservée.
        await Executer("UPDATE personne SET per_siret = NULL WHERE per_id = @p0", id);
        var colonnes = plan.Valeurs.Keys.Where(c => ColonnePersonne().IsMatch(c)).ToList();
        var parametres = new List<object?> { cible, JsonSerializer.Serialize(plan.Casquettes), JsonSerializer.Serialize(plan.Proprietes), id };
        var affectations = colonnes.Select((c, i) => { parametres.Add(plan.Valeurs[c]); return $"{c} = @p{i + 4}"; }).ToList();
        // Fiche conservée placée sous le provisoire : elle reprend le niveau supérieur de celui-ci.
        await Executer($"""
            UPDATE personne SET {string.Join("", affectations.Select(a => a + ", "))}per_casquettes = @p1::jsonb, per_proprietes = @p2::jsonb,
                   per_parent_id = CASE WHEN per_parent_id = @p3 THEN (SELECT per_parent_id FROM personne WHERE per_id = @p3) ELSE per_parent_id END
            WHERE per_id = @p0
            """, [.. parametres]);

        // Coordonnées de la fiche : une coordonnée déjà utilisée par la fiche conservée n'est pas doublée ; un seul principal par nature.
        reports["coordonnees"] = await Executer("""
            UPDATE usage_coordonnee u SET uco_per_id = @p1,
                   uco_principal = u.uco_principal AND NOT EXISTS (SELECT 1 FROM usage_coordonnee x JOIN coordonnee cx ON cx.coo_id = x.uco_coo_id
                       JOIN coordonnee c ON c.coo_id = u.uco_coo_id WHERE x.uco_per_id = @p1 AND x.uco_principal AND cx.coo_nature = c.coo_nature)
            WHERE u.uco_per_id = @p0 AND u.uco_coo_id NOT IN (SELECT uco_coo_id FROM usage_coordonnee WHERE uco_per_id = @p1)
            """, id, cible);

        // Contacts : un individu déjà rattaché à la fiche conservée garde ce rattachement, qui reçoit les coordonnées de l'autre.
        await Executer("""
            UPDATE usage_coordonnee u SET uco_rat_id = k.rat_id
            FROM rattachement s JOIN rattachement k ON k.rat_ind_id = s.rat_ind_id AND k.rat_per_id = @p1
            WHERE s.rat_per_id = @p0 AND u.uco_rat_id = s.rat_id
              AND u.uco_coo_id NOT IN (SELECT uco_coo_id FROM usage_coordonnee WHERE uco_rat_id = k.rat_id)
            """, id, cible);
        await Executer("DELETE FROM rattachement s USING rattachement k WHERE s.rat_per_id = @p0 AND k.rat_per_id = @p1 AND k.rat_ind_id = s.rat_ind_id", id, cible);
        reports["contacts"] = await Executer("""
            UPDATE rattachement SET rat_per_id = @p1, rat_modifie_le = now(),
                   rat_principal = rat_principal AND NOT EXISTS (SELECT 1 FROM rattachement x WHERE x.rat_per_id = @p1 AND x.rat_principal)
            WHERE rat_per_id = @p0
            """, id, cible);

        // Liens entre personnes : ni lien vers soi-même, ni doublon.
        await Executer("DELETE FROM lien_personne WHERE (lpe_per_id = @p0 AND lpe_cible_id = @p1) OR (lpe_per_id = @p1 AND lpe_cible_id = @p0)", id, cible);
        await Executer("DELETE FROM lien_personne s USING lien_personne k WHERE s.lpe_per_id = @p0 AND k.lpe_per_id = @p1 AND k.lpe_cible_id = s.lpe_cible_id AND k.lpe_tli_code = s.lpe_tli_code", id, cible);
        await Executer("DELETE FROM lien_personne s USING lien_personne k WHERE s.lpe_cible_id = @p0 AND k.lpe_cible_id = @p1 AND k.lpe_per_id = s.lpe_per_id AND k.lpe_tli_code = s.lpe_tli_code", id, cible);
        reports["liens"] = await Executer("UPDATE lien_personne SET lpe_per_id = @p1 WHERE lpe_per_id = @p0", id, cible)
            + await Executer("UPDATE lien_personne SET lpe_cible_id = @p1 WHERE lpe_cible_id = @p0", id, cible);
        reports["enfants"] = await Executer("UPDATE personne SET per_parent_id = @p1 WHERE per_parent_id = @p0 AND per_id <> @p1", id, cible);

        foreach (var (quoi, nombre) in await specialisation.ReporterFusionAsync(cnx, tx, id, cible, ct)) reports[quoi] = nombre;

        await Executer("""
            INSERT INTO fusion_personne (fpe_source_id, fpe_source_code, fpe_source_libelle, fpe_cible_id, fpe_choix, fpe_valeurs, fpe_reports, fpe_par)
            VALUES (@p0, @p1, @p2, @p3, @p4::jsonb, @p5::jsonb, @p6::jsonb, @p7)
            """, id, source.Code, source.RaisonSociale, cible, JsonSerializer.Serialize(choix),
            JsonSerializer.Serialize(Exposees(plan.Valeurs)), JsonSerializer.Serialize(reports), u.Code);
        try
        {
            await Executer("DELETE FROM personne WHERE per_id = @p0", id);
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.ForeignKeyViolation)
        {
            throw ExceptionMetier.Conflit("FICHE_UTILISEE", $"Le tiers provisoire est encore utilisé ({e.TableName}) : fusion annulée");
        }
        await transaction.CommitAsync(ct);
        return new(cible, reports.Where(kv => kv.Value > 0).ToDictionary(kv => kv.Key, kv => kv.Value));
    }
}
