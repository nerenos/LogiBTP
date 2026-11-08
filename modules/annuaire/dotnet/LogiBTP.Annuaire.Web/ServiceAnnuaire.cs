using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using LogiBTP.Annuaire;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace LogiBTP.Annuaire.Web;

/// <summary>
/// Point de spécialisation du module Annuaire (classe mère) : droits de paramétrage, niveau et casquette du compte
/// particulier créé depuis un individu.
/// </summary>
public class SpecialisationAnnuaire
{
    public virtual bool PeutParametrer(Utilisateur u) => u.EstAdmin;

    /// <summary>Droit de valider la création d'un tiers provisoire ou de le fusionner dans une autre fiche.</summary>
    public virtual bool PeutValiderTiers(Utilisateur u) => u.EstAdmin;

    /// <summary>Niveau d'un tiers provisoire saisi sans niveau.</summary>
    public virtual string NiveauProvisoire => "SOCIETE";

    /// <summary>
    /// Fusion d'un tiers provisoire : références de l'application (documents, structure…) reportées de la source sur la
    /// cible, dans la transaction de la fusion ; renvoie le nombre d'éléments reportés par nature. Par défaut : aucune.
    /// </summary>
    public virtual Task<IReadOnlyDictionary<string, int>> ReporterFusionAsync(NpgsqlConnection cnx, NpgsqlTransaction tx, long source, long cible, CancellationToken ct) =>
        Task.FromResult<IReadOnlyDictionary<string, int>>(new Dictionary<string, int>());

    public virtual string NiveauParticulier => "PARTICULIER";

    public virtual IReadOnlyList<string> CasquettesParticulier => ["CLIENT"];
}

/// <summary>
/// Services du module Annuaire (classe mère), mêmes règles que FournisseurAnnuaireMemoire : référentiels, recherches,
/// coordonnées partagées (plan, choix, historique), rattachements, liens, compte particulier. Les fiches personne et
/// individu passent par le module Fiche ; leurs champs gérés (coordonnées, rattachements, liens) sont lus et écrits ici.
/// </summary>
public partial class ServiceAnnuaire(AnnuaireDbContext db, SpecialisationAnnuaire specialisation, IChronosFiches? chronos = null)
{
    protected AnnuaireDbContext Db => db;

    private static string? Texte(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    private static List<string> Liste(JsonDocument d) =>
        d.RootElement.ValueKind == JsonValueKind.Array ? d.RootElement.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList() : [];

    private static string? Date(DateOnly? d) => d?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static DateOnly? Date(string? s) =>
        Texte(s) is { } t && DateOnly.TryParseExact(t.Length >= 10 ? t[..10] : t, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;

    private static ExceptionMetier Validation(string message, string champ, string code, string detail) =>
        ExceptionMetier.Invalide("VALIDATION", message, new[] { new { champ, code, message = detail } });

    // ------------------------------------------------------------------ référentiels

    public virtual async Task<ReferentielsDto> Referentiels(CancellationToken ct) => new(
        (await db.Niveaux.AsNoTracking().OrderBy(x => x.NivOrdre).ThenBy(x => x.NivCode).ToListAsync(ct))
            .Select(n => new ReferentielDto { Code = n.NivCode, Libelle = n.NivLibelle, Icone = n.NivIcone, Ordre = n.NivOrdre, Actif = n.NivActif, Morale = n.NivMorale }).ToList(),
        (await db.Casquettes.AsNoTracking().OrderBy(x => x.CasOrdre).ThenBy(x => x.CasCode).ToListAsync(ct))
            .Select(c => new ReferentielDto { Code = c.CasCode, Libelle = c.CasLibelle, Icone = c.CasIcone, Ordre = c.CasOrdre, Actif = c.CasActif, Groupes = Liste(c.CasGroupes) }).ToList(),
        (await db.TypesLien.AsNoTracking().OrderBy(x => x.TliOrdre).ThenBy(x => x.TliCode).ToListAsync(ct))
            .Select(t => new ReferentielDto { Code = t.TliCode, Libelle = t.TliLibelle, LibelleInverse = t.TliLibelleInverse, Ordre = t.TliOrdre, Actif = t.TliActif }).ToList(),
        (await db.Roles.AsNoTracking().OrderBy(x => x.RolOrdre).ThenBy(x => x.RolCode).ToListAsync(ct))
            .Select(r => new ReferentielDto { Code = r.RolCode, Libelle = r.RolLibelle, Icone = r.RolIcone, Ordre = r.RolOrdre, Actif = r.RolActif }).ToList());

    [GeneratedRegex("^[A-Z][A-Z0-9_]{0,29}$")]
    private static partial Regex CodeReferentiel();

    public virtual async Task<ReferentielsDto> EnregistrerReferentiel(string genre, ReferentielDto r, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.ParametrageRefuse();
        var code = (r.Code ?? "").Trim().ToUpperInvariant();
        if (!CodeReferentiel().IsMatch(code)) throw ExceptionMetier.Invalide("CODE", "Code : lettres majuscules, chiffres et _ (30 caractères au plus)");
        var libelle = Texte(r.Libelle) ?? throw ExceptionMetier.Invalide("LIBELLE", "Libellé obligatoire");
        switch (genre)
        {
            case "niveaux":
                var n = await db.Niveaux.FindAsync([code], ct) ?? db.Niveaux.Add(new NiveauPersonne { NivCode = code }).Entity;
                (n.NivLibelle, n.NivIcone, n.NivOrdre, n.NivActif, n.NivMorale) = (libelle, Texte(r.Icone), r.Ordre, r.Actif, r.Morale ?? true);
                break;
            case "casquettes":
                var c = await db.Casquettes.FindAsync([code], ct) ?? db.Casquettes.Add(new Casquette { CasCode = code }).Entity;
                (c.CasLibelle, c.CasIcone, c.CasOrdre, c.CasActif) = (libelle, Texte(r.Icone), r.Ordre, r.Actif);
                c.CasGroupes = JsonSerializer.SerializeToDocument(r.Groupes ?? []);
                break;
            case "types-lien":
                var t = await db.TypesLien.FindAsync([code], ct) ?? db.TypesLien.Add(new TypeLien { TliCode = code }).Entity;
                (t.TliLibelle, t.TliOrdre, t.TliActif) = (libelle, r.Ordre, r.Actif);
                t.TliLibelleInverse = Texte(r.LibelleInverse) ?? throw ExceptionMetier.Invalide("LIBELLE", "Libellé vu depuis la cible obligatoire");
                break;
            case "roles":
                var o = await db.Roles.FindAsync([code], ct) ?? db.Roles.Add(new RoleIndividu { RolCode = code }).Entity;
                (o.RolLibelle, o.RolIcone, o.RolOrdre, o.RolActif) = (libelle, Texte(r.Icone), r.Ordre, r.Actif);
                break;
            default:
                throw ExceptionMetier.Introuvable($"Référentiel {genre}");
        }
        await db.SaveChangesAsync(ct);
        return await Referentiels(ct);
    }

    public virtual async Task<ReferentielsDto> SupprimerReferentiel(string genre, string code, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.ParametrageRefuse();
        var json = JsonSerializer.Serialize(new[] { code });
        var utilise = genre switch
        {
            "niveaux" => await db.Personnes.AnyAsync(p => p.PerNivCode == code, ct),
            "casquettes" => await db.Personnes.AnyAsync(p => EF.Functions.JsonContains(p.PerCasquettes, json), ct),
            "types-lien" => await db.Liens.AnyAsync(l => l.LpeTliCode == code, ct),
            "roles" => await db.Individus.AnyAsync(i => EF.Functions.JsonContains(i.IndRoles, json), ct),
            _ => throw ExceptionMetier.Introuvable($"Référentiel {genre}"),
        };
        if (utilise) throw ExceptionMetier.Conflit("UTILISE", "Code utilisé : désactivez-le plutôt");
        switch (genre)
        {
            case "niveaux": await db.Niveaux.Where(x => x.NivCode == code).ExecuteDeleteAsync(ct); break;
            case "casquettes": await db.Casquettes.Where(x => x.CasCode == code).ExecuteDeleteAsync(ct); break;
            case "types-lien": await db.TypesLien.Where(x => x.TliCode == code).ExecuteDeleteAsync(ct); break;
            default: await db.Roles.Where(x => x.RolCode == code).ExecuteDeleteAsync(ct); break;
        }
        return await Referentiels(ct);
    }

    // ------------------------------------------------------------------ lecture SQL (vues de l'annuaire)

    protected virtual async Task<List<Dictionary<string, object?>>> Lire(string sql, IReadOnlyList<object?> parametres, CancellationToken ct)
    {
        var cnx = (NpgsqlConnection)db.Database.GetDbConnection();
        var ouverte = cnx.State == ConnectionState.Open;
        if (!ouverte) await cnx.OpenAsync(ct);
        try
        {
            await using var cmd = new NpgsqlCommand(sql, cnx);
            if (db.Database.CurrentTransaction?.GetDbTransaction() is NpgsqlTransaction tx) cmd.Transaction = tx;
            for (var i = 0; i < parametres.Count; i++) cmd.Parameters.Add(new NpgsqlParameter($"p{i}", parametres[i] ?? DBNull.Value));
            var res = new List<Dictionary<string, object?>>();
            await using var rd = await cmd.ExecuteReaderAsync(ct);
            while (await rd.ReadAsync(ct))
            {
                var l = new Dictionary<string, object?>(rd.FieldCount, StringComparer.Ordinal);
                for (var i = 0; i < rd.FieldCount; i++) l[rd.GetName(i)] = rd.IsDBNull(i) ? null : rd.GetValue(i);
                res.Add(l);
            }
            return res;
        }
        finally
        {
            if (!ouverte) await cnx.CloseAsync();
        }
    }

    private static List<string> ListeJson(object? v) => v is string s ? JsonSerializer.Deserialize<List<string>>(s) ?? [] : [];

    private const string SelectPersonnes = """
        SELECT per_id, per_code, per_raison_sociale, per_nom_commercial, per_niv_code, niv_libelle, niv_icone, ville, per_siret,
               per_casquettes::text AS casquettes, per_actif, per_parent_id, chemin, per_provisoire
        FROM v_annuaire_personnes
        """;

    private static ResumePersonne VersResume(Dictionary<string, object?> l) => new(
        (long)l["per_id"]!, l["per_code"] as string, (string)l["per_raison_sociale"]!, l["per_nom_commercial"] as string, (string)l["per_niv_code"]!,
        (string)l["niv_libelle"]!, l["niv_icone"] as string, l["ville"] as string, l["per_siret"] as string, ListeJson(l["casquettes"]),
        (bool)l["per_actif"]!, l["per_parent_id"] as long?, l["chemin"] as string, l["per_provisoire"] is true);

    private static ResumeIndividu VersResumeIndividu(Dictionary<string, object?> l) => new(
        (long)l["ind_id"]!, l["ind_civilite"] as string, (string)l["ind_nom"]!, l["ind_prenom"] as string, (string)l["libelle"]!, l["personnes"] as string,
        l["email"] as string, (l["telephone"] ?? l["portable"]) as string, (bool)l["ind_actif"]!);

    public static IReadOnlyList<string> Mots(string? recherche) =>
        (recherche ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Take(8).ToList();

    /// <summary>
    /// Point d'accroche : condition SQL (sur <c>v_annuaire_personnes</c>) qui écarte des tiers des seuls choix de recherche
    /// (la fiche, la liste et la lecture par identifiant ne sont pas touchées). Par défaut : aucun filtre.
    /// </summary>
    protected virtual string? FiltreChoixPersonnes() => null;

    /// <summary>Même accroche pour les individus (condition sur <c>v_annuaire_individus</c>).</summary>
    protected virtual string? FiltreChoixIndividus() => null;

    public virtual async Task<List<ResumePersonne>> RechercherPersonnes(string? recherche, string? casquette, int limite, CancellationToken ct)
    {
        var p = new List<object?>();
        string P(object? v) { p.Add(v); return $"@p{p.Count - 1}"; }
        var conditions = Mots(recherche).Select(m =>
            $"f_annuaire_normaliser(concat_ws(' ', per_code, per_raison_sociale, per_nom_commercial, per_siret, per_siren, ville)) LIKE '%' || f_annuaire_normaliser({P(m)}) || '%'").ToList();
        if (Texte(casquette) is { } c) conditions.Add($"jsonb_exists(per_casquettes, {P(c)})");
        if (FiltreChoixPersonnes() is { } filtre) conditions.Add($"({filtre})");
        var where = conditions.Count == 0 ? "" : " WHERE " + string.Join(" AND ", conditions);
        var lignes = await Lire($"{SelectPersonnes}{where} ORDER BY per_actif DESC, per_raison_sociale, per_id LIMIT {P(Math.Clamp(limite, 1, 200))}", p, ct);
        return lignes.Select(VersResume).ToList();
    }

    public virtual async Task<List<ResumeIndividu>> RechercherIndividus(string? recherche, int limite, CancellationToken ct)
    {
        var p = new List<object?>();
        string P(object? v) { p.Add(v); return $"@p{p.Count - 1}"; }
        var conditions = Mots(recherche).Select(m =>
            $"f_annuaire_normaliser(concat_ws(' ', ind_nom, ind_prenom, email, telephone, portable, personnes)) LIKE '%' || f_annuaire_normaliser({P(m)}) || '%'").ToList();
        if (FiltreChoixIndividus() is { } filtre) conditions.Add($"({filtre})");
        var where = conditions.Count == 0 ? "" : " WHERE " + string.Join(" AND ", conditions);
        var lignes = await Lire($"SELECT * FROM v_annuaire_individus{where} ORDER BY ind_nom, ind_prenom, ind_id LIMIT {P(Math.Clamp(limite, 1, 200))}", p, ct);
        return lignes.Select(VersResumeIndividu).ToList();
    }

    public virtual async Task<ResumePersonne> Personne(long id, CancellationToken ct) =>
        (await Lire($"{SelectPersonnes} WHERE per_id = @p0", [id], ct)).Select(VersResume).FirstOrDefault() ?? throw ExceptionMetier.Introuvable($"Personne {id}");

    public virtual async Task<ResumeIndividu> Individu(long id, CancellationToken ct) =>
        (await Lire("SELECT * FROM v_annuaire_individus WHERE ind_id = @p0", [id], ct)).Select(VersResumeIndividu).FirstOrDefault() ?? throw ExceptionMetier.Introuvable($"Individu {id}");

    public virtual async Task<ResumePersonne?> SocieteBase(CancellationToken ct) =>
        (await Lire($"{SelectPersonnes} WHERE per_societe_base", [], ct)).Select(VersResume).FirstOrDefault();

    public virtual async Task<ResumePersonne?> ParSiret(string siret, CancellationToken ct) =>
        (await Lire($"{SelectPersonnes} WHERE per_siret = @p0", [Identifiants.Compacter(siret)], ct)).Select(VersResume).FirstOrDefault();

    // ------------------------------------------------------------------ coordonnées

    private static Dictionary<string, string?> Valeurs(Coordonnee c) => PlanCoordonnees.Valeurs(c.VersSaisie());

    private async Task<Dictionary<long, string>> LibellesPersonnes(IEnumerable<long> ids, CancellationToken ct)
    {
        var l = ids.Distinct().ToList();
        return await db.Personnes.AsNoTracking().Where(p => l.Contains(p.PerId)).ToDictionaryAsync(p => p.PerId, p => p.PerRaisonSociale, ct);
    }

    private static string LibelleIndividu(Individu? i) => string.Join(" ", new[] { i?.IndCivilite, i?.IndPrenom, i?.IndNom }.Where(x => !string.IsNullOrWhiteSpace(x)));

    /// <summary>Fiches qui utilisent des coordonnées : par coordonnée, (usage, fiche) dans l'ordre des usages.</summary>
    private async Task<Dictionary<long, List<(long UcoId, FicheUsage Fiche)>>> Partages(IReadOnlyCollection<long> coordonnees, CancellationToken ct)
    {
        var usages = await db.Usages.AsNoTracking().Where(u => coordonnees.Contains(u.UcoCooId)).OrderBy(u => u.UcoId).ToListAsync(ct);
        var rats = await db.Rattachements.AsNoTracking().Where(r => usages.Select(u => u.UcoRatId).Contains(r.RatId)).ToDictionaryAsync(r => r.RatId, ct);
        var indIds = usages.Where(u => u.UcoIndId is not null).Select(u => u.UcoIndId!.Value).Concat(rats.Values.Select(r => r.RatIndId)).Distinct().ToList();
        var individus = await db.Individus.AsNoTracking().Where(i => indIds.Contains(i.IndId)).ToDictionaryAsync(i => i.IndId, ct);
        var personnes = await LibellesPersonnes(usages.Where(u => u.UcoPerId is not null).Select(u => u.UcoPerId!.Value).Concat(rats.Values.Select(r => r.RatPerId)), ct);
        var res = new Dictionary<long, List<(long, FicheUsage)>>();
        foreach (var u in usages)
        {
            FicheUsage f;
            if (u.UcoPerId is { } per) f = new("personne", per, personnes.GetValueOrDefault(per) ?? $"Personne {per}", u.UcoUsage);
            else if (u.UcoIndId is { } ind) f = new("individu", ind, LibelleIndividu(individus.GetValueOrDefault(ind)), u.UcoUsage);
            else
            {
                var r = rats.GetValueOrDefault(u.UcoRatId!.Value);
                f = new("rattachement", u.UcoRatId!.Value, $"{LibelleIndividu(r is null ? null : individus.GetValueOrDefault(r.RatIndId))} chez {(r is null ? "?" : personnes.GetValueOrDefault(r.RatPerId) ?? "?")}",
                    u.UcoUsage, r?.RatIndId, r?.RatPerId);
            }
            if (!res.TryGetValue(u.UcoCooId, out var l)) res[u.UcoCooId] = l = [];
            l.Add((u.UcoId, f));
        }
        return res;
    }

    /// <summary>Usages d'une fiche (personne, individu ou rattachement), au format des champs gérés.</summary>
    protected async Task<List<UsageDto>> UsagesDe(string type, long id, CancellationToken ct) =>
        (await UsagesDe(type, [id], ct)).GetValueOrDefault(id, []);

    /// <summary>Usages de plusieurs fiches d'un même type, en quelques requêtes (contacts d'une société à nombreux salariés).</summary>
    protected async Task<Dictionary<long, List<UsageDto>>> UsagesDe(string type, IReadOnlyCollection<long> ids, CancellationToken ct)
    {
        var liste = ids.Distinct().ToList();
        var q = db.Usages.AsNoTracking();
        q = type switch
        {
            "personne" => q.Where(u => u.UcoPerId != null && liste.Contains(u.UcoPerId.Value)),
            "individu" => q.Where(u => u.UcoIndId != null && liste.Contains(u.UcoIndId.Value)),
            _ => q.Where(u => u.UcoRatId != null && liste.Contains(u.UcoRatId.Value)),
        };
        var usages = await q.ToListAsync(ct);
        var cooIds = usages.Select(u => u.UcoCooId).Distinct().ToList();
        var coordonnees = await db.Coordonnees.AsNoTracking().Where(c => cooIds.Contains(c.CooId)).ToDictionaryAsync(c => c.CooId, ct);
        var fiches = await Partages(cooIds, ct);
        long Proprietaire(UsageCoordonnee u) => type switch { "personne" => u.UcoPerId!.Value, "individu" => u.UcoIndId!.Value, _ => u.UcoRatId!.Value };
        return usages.GroupBy(Proprietaire).ToDictionary(g => g.Key, g => g
            .OrderBy(u => coordonnees[u.UcoCooId].CooNature, StringComparer.Ordinal).ThenBy(u => u.UcoOrdre).ThenBy(u => u.UcoId).Select(u =>
            {
                var c = coordonnees[u.UcoCooId];
                var v = Valeurs(c);
                // Autres fiches qui utilisent la coordonnée (sauf l'usage lu lui-même).
                var partages = fiches.GetValueOrDefault(c.CooId, []).Where(x => x.UcoId != u.UcoId).Select(x => x.Fiche).ToList();
                return new UsageDto
                {
                    UcoId = u.UcoId, CooId = c.CooId, Nature = c.CooNature, Usage = u.UcoUsage, Libelle = u.UcoLibelle, Principal = u.UcoPrincipal,
                    Ligne1 = v.GetValueOrDefault("ligne1"), Ligne2 = v.GetValueOrDefault("ligne2"), Ligne3 = v.GetValueOrDefault("ligne3"),
                    CodePostal = v.GetValueOrDefault("code_postal"), Ville = v.GetValueOrDefault("ville"), Pays = v.GetValueOrDefault("pays"),
                    Valeur = v.GetValueOrDefault("valeur"), Reseau = v.GetValueOrDefault("reseau"), Origine = v, Maj = c.CooModifieLe,
                    NonRemisLe = c.CooNonRemisLe, NonRemisMotif = c.CooNonRemisMotif, Partages = partages,
                };
            }).ToList());
    }

    /// <summary>Efface la marque « non remise » d'une coordonnée (adresse vérifiée).</summary>
    public virtual Task EffacerNonRemise(long cooId, Utilisateur u, CancellationToken ct) =>
        db.Coordonnees.Where(c => c.CooId == cooId).ExecuteUpdateAsync(s => s
            .SetProperty(c => c.CooNonRemisLe, (DateTimeOffset?)null).SetProperty(c => c.CooNonRemisMotif, (string?)null)
            .SetProperty(c => c.CooModifiePar, u.Code), ct);

    /// <summary>Coordonnées des fiches liées, à reprendre avec le même identifiant (mêmes sources que la démo).</summary>
    public virtual async Task<List<UsageDto>> CoordonneesProposees(string type, long? id, CancellationToken ct)
    {
        var sources = new List<FicheUsage>();
        if (id is { } n && type == "personne")
        {
            var vus = new HashSet<long> { n };
            var p = await db.Personnes.AsNoTracking().FirstOrDefaultAsync(x => x.PerId == n, ct);
            for (var parent = p?.PerParentId; parent is { } pid && vus.Add(pid);)
            {
                var q = await db.Personnes.AsNoTracking().FirstOrDefaultAsync(x => x.PerId == pid, ct);
                if (q is null) break;
                sources.Add(new("personne", q.PerId, q.PerRaisonSociale, null));
                parent = q.PerParentId;
            }
            foreach (var e in await db.Personnes.AsNoTracking().Where(x => x.PerParentId == n).OrderBy(x => x.PerId).ToListAsync(ct)) sources.Add(new("personne", e.PerId, e.PerRaisonSociale, null));
            foreach (var r in await db.Rattachements.AsNoTracking().Where(x => x.RatPerId == n).OrderBy(x => x.RatId).ToListAsync(ct))
            {
                var i = await db.Individus.AsNoTracking().FirstOrDefaultAsync(x => x.IndId == r.RatIndId, ct);
                if (i is not null) sources.Add(new("individu", i.IndId, LibelleIndividu(i), null));
            }
        }
        else if (id is { } m && type == "individu")
        {
            foreach (var r in await db.Rattachements.AsNoTracking().Where(x => x.RatIndId == m).OrderBy(x => x.RatId).ToListAsync(ct))
            {
                var p = await db.Personnes.AsNoTracking().FirstOrDefaultAsync(x => x.PerId == r.RatPerId, ct);
                if (p is null) continue;
                sources.Add(new("personne", p.PerId, p.PerRaisonSociale, null));
                sources.Add(new("rattachement", r.RatId, $"{p.PerRaisonSociale} (coordonnées professionnelles)", null));
            }
        }
        var vues = new HashSet<long>();
        var res = new List<UsageDto>();
        foreach (var s in sources)
        {
            foreach (var u in await UsagesDe(s.Type, s.Id, ct))
            {
                if (!vues.Add(u.CooId)) continue;
                u.UcoId = null;
                u.Source = s;
                res.Add(u);
            }
        }
        return res;
    }

    public virtual async Task<List<HistoriqueCoordonneeDto>> HistoriqueCoordonnee(long cooId, CancellationToken ct) =>
        (await db.Historique.AsNoTracking().Where(h => h.CohCooId == cooId).OrderByDescending(h => h.CohId).ToListAsync(ct))
            .Select(h => new HistoriqueCoordonneeDto(Avant(h.CohAvant), h.CohLe, h.CohPar)).ToList();

    /// <summary>Valeurs avant modification, au format des saisies (coo_ligne1 → ligne1…).</summary>
    private static JsonElement Avant(JsonDocument d)
    {
        var c = new Coordonnee
        {
            CooNature = Lu(d, "coo_nature") ?? "", CooValeur = Lu(d, "coo_valeur"), CooLigne1 = Lu(d, "coo_ligne1"), CooLigne2 = Lu(d, "coo_ligne2"),
            CooLigne3 = Lu(d, "coo_ligne3"), CooCodePostal = Lu(d, "coo_code_postal"), CooVille = Lu(d, "coo_ville"), CooPays = Lu(d, "coo_pays"), CooReseau = Lu(d, "coo_reseau"),
        };
        return JsonSerializer.SerializeToElement(Valeurs(c));
    }

    private static string? Lu(JsonDocument d, string k) => d.RootElement.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Nombre d'autres usages de chaque coordonnée des saisies (hors l'usage saisi lui-même).</summary>
    private async Task<Dictionary<long, int>> PartagesSaisies(IReadOnlyList<SaisieCoordonnee> saisies, CancellationToken ct)
    {
        var res = new Dictionary<long, int>();
        foreach (var s in saisies.Where(s => s.CooId is not null))
        {
            var uco = s.UcoId ?? 0;
            res[s.CooId!.Value] = await db.Usages.CountAsync(u => u.UcoCooId == s.CooId && u.UcoId != uco, ct);
        }
        return res;
    }

    private static string Nom(SaisieCoordonnee? s, int index, string? contexte)
    {
        var n = s?.Nature switch { "ADRESSE" => "Adresse", "TELEPHONE" => "Téléphone", "EMAIL" => "E-mail", "WEB" => "Lien web", _ => "Coordonnée" };
        var t = s is null ? "" : PlanCoordonnees.Texte(s);
        return $"{(contexte is null ? "" : $"{contexte} – ")}{n} {(t.Length > 0 ? t : $"n° {index + 1}")}";
    }

    /// <summary>Plan contrôlé : coordonnée modifiée entre-temps (409), erreurs (422 VALIDATION), choix requis (422 CHOIX_REQUIS).</summary>
    protected async Task<PlanEnregistrement> Planifier(string type, long? id, IReadOnlyList<SaisieCoordonnee> saisies, string? contexte, CancellationToken ct)
    {
        var existantes = id is not { } n ? [] : type switch
        {
            "personne" => await db.Usages.Where(u => u.UcoPerId == n).Select(u => u.UcoId).ToListAsync(ct),
            "individu" => await db.Usages.Where(u => u.UcoIndId == n).Select(u => u.UcoId).ToListAsync(ct),
            _ => await db.Usages.Where(u => u.UcoRatId == n).Select(u => u.UcoId).ToListAsync(ct),
        };
        var plan = PlanCoordonnees.Planifier(existantes, saisies, await PartagesSaisies(saisies, ct));
        for (var i = 0; i < saisies.Count; i++)
        {
            var s = saisies[i];
            if (s.CooId is not { } coo || PlanCoordonnees.EstVide(s)) continue;
            var c = await db.Coordonnees.AsNoTracking().FirstOrDefaultAsync(x => x.CooId == coo, ct) ?? throw ExceptionMetier.Introuvable($"Coordonnée {coo}");
            if (s.Origine is not null && !PlanCoordonnees.MemesValeurs(c.VersSaisie(), s.Origine))
                throw ExceptionMetier.Conflit("COORDONNEE_MODIFIEE", $"{Nom(s, i, contexte)} : modifiée par ailleurs entre-temps, rechargez la fiche");
        }
        if (plan.Erreurs.Count > 0)
            throw ExceptionMetier.Invalide("VALIDATION", "Coordonnées incorrectes",
                plan.Erreurs.Select(e => new { champ = "coordonnees", code = e.Code, message = $"{Nom(saisies[e.Index], e.Index, contexte)} : {e.Message}" }).ToList());
        if (plan.ChoixRequis.Count > 0)
            throw ExceptionMetier.Invalide("CHOIX_REQUIS", PlanCoordonnees.Messages["CHOIX"],
                plan.ChoixRequis.Select(c => new { champ = "coordonnees", code = "CHOIX", message = Nom(saisies[c.Index], c.Index, contexte), index = c.Index, coo_id = c.CooId, partages = c.Partages }).ToList());
        return plan;
    }

    /// <summary>Application d'un plan (même ordre que la démo) ; coordonnées devenues orphelines supprimées.</summary>
    protected async Task Appliquer(string type, long id, PlanEnregistrement plan, Utilisateur u, CancellationToken ct)
    {
        var touchees = new HashSet<long>();
        foreach (var o in plan.Operations)
        {
            if (o.Op == "SUPPRIMER")
            {
                var s = await db.Usages.FirstOrDefaultAsync(x => x.UcoId == o.UcoId, ct);
                if (s is null) continue;
                touchees.Add(s.UcoCooId);
                db.Usages.Remove(s);
                await db.SaveChangesAsync(ct);
                continue;
            }
            var cooId = o.CooId ?? 0;
            if (o.Coordonnee == "NOUVELLE")
            {
                var c = new Coordonnee { CooNature = o.Nature!, CooModifieLe = DateTimeOffset.UtcNow, CooModifiePar = u.Code };
                c.Affecter(o.Valeurs!);
                db.Coordonnees.Add(c);
                await db.SaveChangesAsync(ct);
                cooId = c.CooId;
            }
            else if (o.Coordonnee == "MODIFIER")
            {
                // Historique des valeurs remplacées : trigger tg_coordonnee_historique (coo_modifie_par).
                var c = await db.Coordonnees.FirstAsync(x => x.CooId == cooId, ct);
                c.Affecter(o.Valeurs!);
                c.CooModifiePar = u.Code;
            }
            if (o.Op == "AJOUTER")
            {
                db.Usages.Add(new UsageCoordonnee
                {
                    UcoCooId = cooId, UcoPerId = type == "personne" ? id : null, UcoIndId = type == "individu" ? id : null, UcoRatId = type == "rattachement" ? id : null,
                    UcoUsage = o.Usage, UcoLibelle = o.Libelle, UcoPrincipal = o.Principal, UcoOrdre = o.Ordre,
                });
            }
            else
            {
                var s = await db.Usages.FirstAsync(x => x.UcoId == o.UcoId, ct);
                if (s.UcoCooId != cooId) touchees.Add(s.UcoCooId);
                (s.UcoCooId, s.UcoUsage, s.UcoLibelle, s.UcoPrincipal, s.UcoOrdre) = (cooId, o.Usage, o.Libelle, o.Principal, o.Ordre);
            }
            await db.SaveChangesAsync(ct);
        }
        await SupprimerOrphelines(touchees, ct);
    }

    private async Task SupprimerOrphelines(IReadOnlyCollection<long> coordonnees, CancellationToken ct)
    {
        if (coordonnees.Count == 0) return;
        var ids = coordonnees.ToList();
        await db.Coordonnees.Where(c => ids.Contains(c.CooId) && !db.Usages.Any(x => x.UcoCooId == c.CooId)).ExecuteDeleteAsync(ct);
    }

    // ------------------------------------------------------------------ rattachements et liens

    /// <summary>Rattachements lus avec une fiche (première page) et par page dans l'onglet Contacts.</summary>
    public const int TaillePageRattachements = 20;

    /// <summary>
    /// Page de rattachements d'une fiche : tri principal, actif, nom de l'autre fiche (sans accents), identifiant ; recherche
    /// sur ce nom, la fonction et le service (comme pageRattachements de la démo). Coordonnées lues pour la page seulement.
    /// </summary>
    public virtual async Task<PageRattachementsDto> PageRattachements(string type, long id, string? recherche, int page, int taille, CancellationToken ct)
    {
        if (type is not ("personne" or "individu")) throw ExceptionMetier.Invalide("TYPE", "Type de fiche : personne ou individu");
        taille = Math.Clamp(taille, 1, 200);
        page = Math.Max(1, page);
        var p = new List<object?> { id };
        string P(object? v) { p.Add(v); return $"@p{p.Count - 1}"; }
        var nom = type == "personne" ? "concat_ws(' ', i.ind_civilite, i.ind_prenom, i.ind_nom)" : "pe.per_raison_sociale";
        var conditions = new List<string> { type == "personne" ? "r.rat_per_id = @p0" : "r.rat_ind_id = @p0" };
        conditions.AddRange(Mots(recherche).Select(m => $"f_annuaire_normaliser(concat_ws(' ', {nom}, r.rat_fonction, r.rat_service)) LIKE '%' || f_annuaire_normaliser({P(m)}) || '%'"));
        var depuis = $"FROM rattachement r JOIN individu i ON i.ind_id = r.rat_ind_id JOIN personne pe ON pe.per_id = r.rat_per_id WHERE {string.Join(" AND ", conditions)}";
        var total = Convert.ToInt32((await Lire($"SELECT count(*) AS n {depuis}", p, ct))[0]["n"]);
        var ids = (await Lire($"SELECT r.rat_id {depuis} ORDER BY r.rat_principal DESC, r.rat_actif DESC, f_annuaire_normaliser({nom}), r.rat_id LIMIT {P(taille)} OFFSET {P((page - 1) * taille)}", p, ct))
            .Select(l => (long)l["rat_id"]!).ToList();
        return new(await RattachementsDe(ids, ct), total, page, taille);
    }

    /// <summary>Rattachements (dans l'ordre des identifiants donnés), avec leurs coordonnées propres.</summary>
    protected async Task<List<RattachementDto>> RattachementsDe(IReadOnlyList<long> ids, CancellationToken ct)
    {
        var parId = await db.Rattachements.AsNoTracking().Where(r => ids.Contains(r.RatId)).ToDictionaryAsync(r => r.RatId, ct);
        var rats = ids.Where(parId.ContainsKey).Select(x => parId[x]).ToList();
        var indIds = rats.Select(r => r.RatIndId).ToList();
        var individus = await db.Individus.AsNoTracking().Where(i => indIds.Contains(i.IndId)).ToDictionaryAsync(i => i.IndId, ct);
        var perIds = rats.Select(r => r.RatPerId).ToList();
        var personnes = await db.Personnes.AsNoTracking().Where(p => perIds.Contains(p.PerId)).ToDictionaryAsync(p => p.PerId, ct);
        var coordonnees = await UsagesDe("rattachement", rats.Select(r => r.RatId).ToList(), ct);
        var res = new List<RattachementDto>();
        foreach (var r in rats)
        {
            var p = personnes.GetValueOrDefault(r.RatPerId);
            res.Add(new RattachementDto
            {
                RatId = r.RatId, IndId = r.RatIndId, PerId = r.RatPerId, Individu = LibelleIndividu(individus.GetValueOrDefault(r.RatIndId)), Personne = p?.PerRaisonSociale,
                Niveau = p?.PerNivCode, Fonction = r.RatFonction, Service = r.RatService, Principal = r.RatPrincipal, Titulaire = r.RatTitulaire, Debut = Date(r.RatDebut),
                Fin = Date(r.RatFin), Actif = r.RatActif, Commentaire = r.RatCommentaire, Maj = r.RatModifieLe, Coordonnees = coordonnees.GetValueOrDefault(r.RatId, []),
            });
        }
        return res;
    }

    protected async Task<List<LienDto>> LiensDe(long id, CancellationToken ct)
    {
        var liens = await db.Liens.AsNoTracking().Where(l => l.LpePerId == id || l.LpeCibleId == id).OrderBy(l => l.LpeId).ToListAsync(ct);
        var autres = await LibellesPersonnes(liens.Select(l => l.LpeCibleId == id ? l.LpePerId : l.LpeCibleId), ct);
        return liens.Select(l =>
        {
            var inverse = l.LpeCibleId == id;
            var autre = inverse ? l.LpePerId : l.LpeCibleId;
            return new LienDto(l.LpeId, l.LpeTliCode, inverse, autre, autres.GetValueOrDefault(autre), l.LpeCommentaire, Date(l.LpeDebut), Date(l.LpeFin));
        }).ToList();
    }

    protected async Task<List<ResumePersonne>> EnfantsDe(long id, CancellationToken ct) =>
        (await Lire($"{SelectPersonnes} WHERE per_parent_id = @p0 ORDER BY per_raison_sociale, per_id", [id], ct)).Select(VersResume).ToList();

    private sealed record PlanRattachement(SaisieRattachement S, Rattachement? R, PlanEnregistrement Plan)
    {
        public bool? Principal { get; set; }
    }

    /// <summary>
    /// Plan des rattachements saisis : seuls les rattachements modifiés, ajoutés (sans rat_id) ou retirés (supprime) sont
    /// saisis ; les autres restent inchangés (fiche à nombreux contacts lus par page).
    /// </summary>
    private async Task<(List<Rattachement> Retires, List<PlanRattachement> Plans)> PlanRattachements(string type, long? id, List<SaisieRattachement> saisies, CancellationToken ct)
    {
        var existants = id is not { } n ? [] : await (type == "personne" ? db.Rattachements.Where(r => r.RatPerId == n) : db.Rattachements.Where(r => r.RatIndId == n)).ToListAsync(ct);
        var saisis = saisies.Where(s => s.RatId is not null).Select(s => s.RatId!.Value).ToHashSet();
        // Autres fiches déjà rattachées (hors saisie) : un nouveau rattachement ne peut les doubler.
        var vus = existants.Where(r => !saisis.Contains(r.RatId)).Select(r => type == "personne" ? r.RatIndId : r.RatPerId).ToHashSet();
        var retires = new List<Rattachement>();
        var plans = new List<PlanRattachement>();
        for (var i = 0; i < saisies.Count; i++)
        {
            var s = saisies[i];
            var r = s.RatId is { } rid ? existants.FirstOrDefault(x => x.RatId == rid) ?? throw ExceptionMetier.Introuvable($"Rattachement {rid}") : null;
            if (r is not null && s.Maj is { } maj && maj.UtcTicks != r.RatModifieLe.UtcTicks)
                throw ExceptionMetier.Conflit("RATTACHEMENT_MODIFIE", "Un rattachement a été modifié par ailleurs entre-temps : rechargez la fiche");
            if (s.Supprime)
            {
                retires.Add(r ?? throw Validation("Retrait impossible", "rattachements", "RETRAIT", $"Rattachement n° {i + 1} : pas encore enregistré"));
                continue;
            }
            var cible = type == "personne" ? s.IndId : s.PerId;
            if (cible is null && !(type == "personne" && s.NouvelIndividu is not null))
                throw Validation("Rattachement incomplet", "rattachements", "OBLIGATOIRE", $"Rattachement n° {i + 1} : {(type == "personne" ? "individu" : "personne")} à choisir");
            if (s.NouvelIndividu is not null && Texte(s.NouvelIndividu.Nom) is null)
                throw Validation("Rattachement incomplet", "rattachements", "OBLIGATOIRE", $"Contact n° {i + 1} : nom obligatoire");
            if (cible is { } c)
            {
                if (!vus.Add(c)) throw Validation("Rattachement en double", "rattachements", "DOUBLON", $"Rattachement n° {i + 1} : déjà rattaché");
                var existe = type == "personne" ? await db.Individus.AnyAsync(x => x.IndId == c, ct) : await db.Personnes.AnyAsync(x => x.PerId == c, ct);
                if (!existe) throw ExceptionMetier.Introuvable($"Fiche {c}");
            }
            if (Date(s.Debut) is { } d && Date(s.Fin) is { } f && f < d)
                throw Validation("Dates incohérentes", "rattachements", "DATES", $"Rattachement n° {i + 1} : fin avant le début");
            var libelle = s.Individu ?? s.Personne ?? string.Join(" ", new[] { s.NouvelIndividu?.Civilite, s.NouvelIndividu?.Prenom, s.NouvelIndividu?.Nom }.Where(x => !string.IsNullOrWhiteSpace(x)));
            plans.Add(new(s, r, await Planifier("rattachement", r?.RatId, s.Coordonnees, libelle, ct)));
        }
        return (retires, plans);
    }

    private async Task EcrireRattachements(string type, long id, List<SaisieRattachement> saisies, Utilisateur u, CancellationToken ct)
    {
        var (retires, plans) = await PlanRattachements(type, id, saisies, ct);
        foreach (var r in retires)
        {
            var touchees = await db.Usages.Where(x => x.UcoRatId == r.RatId).Select(x => x.UcoCooId).ToListAsync(ct);
            await db.Usages.Where(x => x.UcoRatId == r.RatId).ExecuteDeleteAsync(ct);
            await db.Rattachements.Where(x => x.RatId == r.RatId).ExecuteDeleteAsync(ct);
            db.Entry(r).State = EntityState.Detached;
            await SupprimerOrphelines(touchees, ct);
        }
        if (type == "personne")
        {
            var vu = false;
            foreach (var p in plans.Where(p => p.S.Principal)) { p.Principal = !vu; vu = true; }
        }
        foreach (var p in plans)
        {
            var s = p.S;
            var cible = type == "personne" ? s.IndId : s.PerId;
            if (cible is null && s.NouvelIndividu is { } ni)
            {
                var i = new Individu { IndCivilite = Texte(ni.Civilite), IndNom = Texte(ni.Nom)!, IndPrenom = Texte(ni.Prenom) };
                db.Individus.Add(i);
                await db.SaveChangesAsync(ct);
                cible = i.IndId;
            }
            var r = p.R ?? db.Rattachements.Add(new Rattachement()).Entity;
            r.RatPerId = type == "personne" ? id : cible!.Value;
            r.RatIndId = type == "personne" ? cible!.Value : id;
            r.RatFonction = Texte(s.Fonction);
            r.RatService = Texte(s.Service);
            r.RatPrincipal = p.Principal ?? s.Principal;
            r.RatTitulaire = s.Titulaire;
            r.RatDebut = Date(s.Debut);
            r.RatFin = Date(s.Fin);
            r.RatActif = s.Actif ?? true;
            r.RatCommentaire = Texte(s.Commentaire);
            r.RatModifieLe = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            await Appliquer("rattachement", r.RatId, p.Plan, u, ct);
            // Contact principal d'une personne : les autres rattachements de la personne ne le sont plus.
            if (r.RatPrincipal)
                await db.Rattachements.Where(x => x.RatPerId == r.RatPerId && x.RatId != r.RatId && x.RatPrincipal).ExecuteUpdateAsync(x => x.SetProperty(y => y.RatPrincipal, false), ct);
        }
    }

    private async Task ControlerLiens(long? id, List<SaisieLien> saisies, CancellationToken ct)
    {
        var types = await db.TypesLien.Select(t => t.TliCode).ToListAsync(ct);
        for (var i = 0; i < saisies.Count; i++)
        {
            var s = saisies[i];
            ExceptionMetier Err(string m) => Validation("Lien incorrect", "liens", "LIEN", $"Lien n° {i + 1} : {m}");
            if (s.AutreId is not { } autre) throw Err("personne à choisir");
            if (autre == id) throw Err("une personne ne peut pas être liée à elle-même");
            if (s.TliCode is null || !types.Contains(s.TliCode)) throw Err("type de lien à choisir");
            if (!await db.Personnes.AnyAsync(p => p.PerId == autre, ct)) throw ExceptionMetier.Introuvable($"Personne {autre}");
        }
    }

    private async Task EcrireLiens(long id, List<SaisieLien> saisies, CancellationToken ct)
    {
        var gardes = saisies.Where(s => s.LpeId is not null).Select(s => s.LpeId!.Value).ToList();
        await db.Liens.Where(l => (l.LpePerId == id || l.LpeCibleId == id) && !gardes.Contains(l.LpeId)).ExecuteDeleteAsync(ct);
        foreach (var s in saisies)
        {
            var l = s.LpeId is { } lid ? await db.Liens.FirstOrDefaultAsync(x => x.LpeId == lid, ct) : null;
            l ??= db.Liens.Add(new LienPersonne()).Entity;
            l.LpePerId = s.Inverse ? s.AutreId!.Value : id;
            l.LpeCibleId = s.Inverse ? id : s.AutreId!.Value;
            l.LpeTliCode = s.TliCode!;
            l.LpeCommentaire = Texte(s.Commentaire);
            l.LpeDebut = Date(s.Debut);
            l.LpeFin = Date(s.Fin);
        }
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ champs gérés des fiches

    private static T Lire<T>(IReadOnlyDictionary<string, JsonElement> geres, string code) where T : new() =>
        geres.TryGetValue(code, out var v) && v.ValueKind != JsonValueKind.Null ? v.Deserialize<T>(JsonCalcul.Options) ?? new T() : new T();

    /// <summary>Champs gérés d'une fiche personne (coordonnées, rattachements, liens, enfants) ou individu (coordonnées, rattachements).</summary>
    public virtual async Task<IReadOnlyDictionary<string, object?>> LireGeres(string type, long id, CancellationToken ct)
    {
        var res = new Dictionary<string, object?>
        {
            ["coordonnees"] = await UsagesDe(type, id, ct),
        };
        var page = await PageRattachements(type, id, null, 1, TaillePageRattachements, ct);
        res["rattachements"] = page.Lignes;
        res["nb_rattachements"] = page.Total;
        if (type == "personne")
        {
            res["liens"] = await LiensDe(id, ct);
            res["enfants"] = await EnfantsDe(id, ct);
        }
        return res;
    }

    public virtual async Task ValiderGeres(string type, long? id, IReadOnlyDictionary<string, JsonElement> geres, CancellationToken ct)
    {
        if (geres.ContainsKey("coordonnees")) await Planifier(type, id, Lire<List<SaisieCoordonnee>>(geres, "coordonnees"), null, ct);
        if (geres.ContainsKey("rattachements")) await PlanRattachements(type, id, Lire<List<SaisieRattachement>>(geres, "rattachements"), ct);
        if (geres.ContainsKey("liens")) await ControlerLiens(id, Lire<List<SaisieLien>>(geres, "liens"), ct);
    }

    public virtual async Task EcrireGeres(string type, long id, IReadOnlyDictionary<string, JsonElement> geres, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (geres.ContainsKey("coordonnees")) await Appliquer(type, id, await Planifier(type, id, Lire<List<SaisieCoordonnee>>(geres, "coordonnees"), null, ct), u, ct);
        if (geres.ContainsKey("rattachements")) await EcrireRattachements(type, id, Lire<List<SaisieRattachement>>(geres, "rattachements"), u, ct);
        if (geres.ContainsKey("liens")) await EcrireLiens(id, Lire<List<SaisieLien>>(geres, "liens"), ct);
        await tx.CommitAsync(ct);
    }

    /// <summary>Contrôles d'une personne nécessitant les données : société de la base unique, SIRET unique, hiérarchie sans boucle.</summary>
    public virtual async Task ControlerPersonne(long? id, bool societeBase, string? siret, long? parentId, CancellationToken ct)
    {
        if (societeBase && await db.Personnes.AnyAsync(p => p.PerSocieteBase && p.PerId != id, ct))
            throw Validation("Société de la base", "societe_base", "UNIQUE", "La société de la base existe déjà");
        if (Texte(siret) is { } s && await db.Personnes.AnyAsync(p => p.PerSiret == Identifiants.Compacter(s) && p.PerId != id, ct))
            throw Validation("SIRET déjà utilisé", "siret", "UNIQUE", "SIRET déjà enregistré pour une autre personne");
        if (parentId is { } parent)
        {
            var vus = new HashSet<long>();
            if (id is { } moi) vus.Add(moi);
            for (long? p = parent; p is { } courant;)
            {
                if (!vus.Add(courant)) throw Validation("Hiérarchie", "parent_id", "BOUCLE", "Niveau supérieur : la hiérarchie bouclerait");
                p = await db.Personnes.Where(x => x.PerId == courant).Select(x => x.PerParentId).FirstOrDefaultAsync(ct);
            }
        }
    }

    /// <summary>
    /// Graphe relationnel autour d'une fiche (GrapheAnnuaire) : personnes, individus, rattachements et liens lus en une fois
    /// (requêtes ensemblistes), puis parcours en mémoire.
    /// </summary>
    public virtual async Task<Graphe> Graphe(string type, long id, OptionsGraphe options, CancellationToken ct)
    {
        if (type is not ("personne" or "individu")) throw ExceptionMetier.Invalide("TYPE", "Type de fiche : personne ou individu");
        var personnes = (await Lire("SELECT per_id, per_parent_id, per_niv_code, per_raison_sociale, per_casquettes::text AS casquettes, per_actif, ville FROM v_annuaire_personnes", [], ct))
            .Select(l => new PersonneGraphe((long)l["per_id"]!, l["per_parent_id"] as long?, (string)l["per_niv_code"]!, (string)l["per_raison_sociale"]!,
                ListeJson(l["casquettes"]), (bool)l["per_actif"]!, l["ville"] as string)).ToList();
        var individus = (await Lire("SELECT ind_id, concat_ws(' ', ind_civilite, ind_prenom, ind_nom) AS libelle, ind_actif FROM individu", [], ct))
            .Select(l => new IndividuGraphe((long)l["ind_id"]!, (string)l["libelle"]!, (bool)l["ind_actif"]!)).ToList();
        var rattachements = await db.Rattachements.AsNoTracking()
            .Select(r => new RattachementGraphe(r.RatId, r.RatPerId, r.RatIndId, r.RatFonction, r.RatPrincipal, r.RatActif)).ToListAsync(ct);
        var liens = await db.Liens.AsNoTracking().Select(l => new LienGraphe(l.LpeId, l.LpePerId, l.LpeCibleId, l.LpeTliCode)).ToListAsync(ct);
        var niveaux = await db.Niveaux.AsNoTracking().Select(n => new NiveauGraphe(n.NivCode, n.NivOrdre, n.NivIcone)).ToListAsync(ct);
        var types = await db.TypesLien.AsNoTracking().Select(t => new TypeLienGraphe(t.TliCode, t.TliLibelle)).ToListAsync(ct);
        return GrapheAnnuaire.Construire(new DonneesGraphe(niveaux, types, personnes, individus, rattachements, liens), type, id, options);
    }

    /// <summary>
    /// Code d'un tiers créé hors de sa fiche (tiers provisoire, compte particulier) : chrono des fiches personne s'il est
    /// branché (IChronosFiches) ; sinon null et le trigger de la base pose T + identifiant.
    /// </summary>
    protected async Task<string?> CodeTiers(CancellationToken ct) => chronos is null ? null : await chronos.AttribuerAsync("personne", new Dictionary<string, object?>(), ct);

    /// <summary>Compte particulier d'un individu : personne titulaire, coordonnées personnelles partagées (même identifiant).</summary>
    public virtual async Task<ParticulierDto> CreerParticulier(long indId, Utilisateur u, CancellationToken ct)
    {
        var i = await db.Individus.AsNoTracking().FirstOrDefaultAsync(x => x.IndId == indId, ct) ?? throw ExceptionMetier.Introuvable($"Individu {indId}");
        var niveau = specialisation.NiveauParticulier;
        var existant = await (from r in db.Rattachements
                              join p in db.Personnes on r.RatPerId equals p.PerId
                              where r.RatIndId == indId && r.RatTitulaire && p.PerNivCode == niveau
                              select p.PerId).FirstOrDefaultAsync(ct);
        if (existant != 0) return new(existant, true);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var personne = new Personne
        {
            PerNivCode = niveau, PerRaisonSociale = string.Join(" ", new[] { i.IndCivilite, i.IndNom.ToUpperInvariant(), i.IndPrenom }.Where(x => !string.IsNullOrWhiteSpace(x))),
            PerCasquettes = JsonSerializer.SerializeToDocument(specialisation.CasquettesParticulier), PerPays = i.IndPays,
            PerCode = await CodeTiers(ct),
        };
        db.Personnes.Add(personne);
        await db.SaveChangesAsync(ct);
        db.Rattachements.Add(new Rattachement
        {
            RatPerId = personne.PerId, RatIndId = indId, RatFonction = "Titulaire", RatPrincipal = true, RatTitulaire = true, RatActif = true, RatModifieLe = DateTimeOffset.UtcNow,
        });
        foreach (var x in await db.Usages.AsNoTracking().Where(x => x.UcoIndId == indId).OrderBy(x => x.UcoId).ToListAsync(ct))
        {
            db.Usages.Add(new UsageCoordonnee { UcoCooId = x.UcoCooId, UcoPerId = personne.PerId, UcoUsage = x.UcoUsage, UcoLibelle = x.UcoLibelle, UcoPrincipal = x.UcoPrincipal, UcoOrdre = x.UcoOrdre });
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new(personne.PerId, false);
    }
}
