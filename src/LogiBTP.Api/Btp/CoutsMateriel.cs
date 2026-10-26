using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Coûts du matériel (db/232, lot 5c-1 des demandes du 25/10/2026, décisions M1 à M3) : chantier de suivi d'un matériel
/// (affaire MATERIEL ; MAT-code pour un matériel identifié, MAT-T-type partagé par les matériels gérés par nombre du
/// même type), créé à la demande ou à la première imputation (<see cref="ChantierMaterielAsync"/>) ; coûts du chantier
/// par mois et nature (<c>v_cout_chantier</c> : main-d'œuvre pointée, stock, achats, sous-traitance), cumuls de l'année
/// et depuis l'entrée, coût par heure d'utilisation.
/// </summary>
public static class CoutsMateriel
{
    private sealed record MaterielSql(int Id, string Code, string Designation, string? Mode, string? Famille, string? Type, int? ChaId, decimal? Heures, DateOnly? DateEntree);
    private sealed record ChantierSql(int Id, string Code, string Libelle, string Statut, long Materiels);
    private sealed record CoutSql(DateOnly Mois, string Nature, decimal Montant, decimal? Minutes, long NonValorises);

    /// <summary>Natures de coût de <c>v_cout_chantier</c>, dans l'ordre d'affichage.</summary>
    public static readonly string[] Natures = ["MO", "STOCK", "ACHAT", "SOUS_TRAITANCE"];

    private static async Task<MaterielSql> MaterielAsync(LogiBtpContext db, int id, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<MaterielSql>("""
            SELECT m.mat_id AS id, m.mat_code AS code, m.mat_designation AS designation, m.mat_mode AS mode, m.mat_famille AS famille,
                   coalesce((SELECT l.lva_libelle FROM liste_valeur l WHERE l.lva_liste = 'TYPE_MATERIEL' AND l.lva_code = m.mat_famille), m.mat_famille) AS type,
                   m.mat_cha_id AS cha_id, m.mat_heures::numeric AS heures, m.mat_date_entree AS date_entree
            FROM materiel m WHERE m.mat_id = @m
            """, new NpgsqlParameter("m", id)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable("Matériel");

    /// <summary>
    /// Chantier de suivi du matériel, créé s'il manque (M1, M2) : matériel identifié → MAT-code ; géré par nombre → le
    /// chantier d'un autre matériel par nombre du même type, sinon MAT-T-type, posé sur tous les matériels par nombre de
    /// ce type. Un code déjà pris hors de l'affaire MATERIEL reçoit l'identifiant du matériel en suffixe. Statut tenu par
    /// le trigger de db/232 (clos quand tous ses matériels sont en sommeil).
    /// </summary>
    public static async Task<int> ChantierMaterielAsync(LogiBtpContext db, int materiel, CancellationToken ct)
    {
        var m = await MaterielAsync(db, materiel, ct);
        if (m.ChaId is { } c) return c;
        var parNombre = m.Mode == "NOMBRE" && !string.IsNullOrEmpty(m.Famille);
        if (parNombre)
        {
            var commun = await db.Database.SqlQueryRaw<int?>("""
                SELECT min(mat_cha_id) AS "Value" FROM materiel WHERE mat_mode = 'NOMBRE' AND mat_famille = @f AND mat_cha_id IS NOT NULL
                """, new NpgsqlParameter("f", m.Famille)).FirstAsync(ct);
            if (commun is { } x)
            {
                await db.Database.ExecuteSqlRawAsync("UPDATE materiel SET mat_cha_id = @c WHERE mat_id = @m", [new NpgsqlParameter("c", x), new NpgsqlParameter("m", materiel)], ct);
                return x;
            }
        }
        var code = (parNombre ? $"MAT-T-{m.Famille}" : $"MAT-{m.Code}").ToUpperInvariant();
        if (code.Length > 20) code = code[..20];
        var libelle = parNombre ? $"Matériel par nombre : {m.Type}" : $"Matériel {m.Code} {m.Designation}";
        if (libelle.Length > 150) libelle = libelle[..150];
        var pris = await db.Database.SqlQueryRaw<int>("""
            SELECT count(*)::int AS "Value" FROM chantier c
            WHERE c.cha_code = @code AND c.cha_aff_id IS DISTINCT FROM (SELECT aff_id FROM affaire WHERE aff_code = 'MATERIEL')
            """, new NpgsqlParameter("code", code)).FirstAsync(ct);
        if (pris > 0)
        {
            var suffixe = $"-{materiel}";
            code = (code.Length + suffixe.Length > 20 ? code[..(20 - suffixe.Length)] : code) + suffixe;
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var id = await db.Database.SqlQueryRaw<int>("""
            INSERT INTO chantier (cha_code, cha_libelle, cha_aff_id, cha_statut, cha_commentaire)
            VALUES (@code, @libelle, (SELECT aff_id FROM affaire WHERE aff_code = 'MATERIEL'), 'OUVERT',
                    'Chantier de suivi des coûts du matériel : main-d''œuvre, pièces du stock, achats, sous-traitance (lot 5c)')
            ON CONFLICT (cha_code) DO UPDATE SET cha_libelle = chantier.cha_libelle
            RETURNING cha_id AS "Value"
            """, new NpgsqlParameter("code", code), new NpgsqlParameter("libelle", libelle)).ToListAsync(ct);
        if (parNombre)
        {
            await db.Database.ExecuteSqlRawAsync("UPDATE materiel SET mat_cha_id = @c WHERE (mat_mode = 'NOMBRE' AND mat_famille = @f AND mat_cha_id IS NULL) OR mat_id = @m",
                [new NpgsqlParameter("c", id[0]), new NpgsqlParameter("f", m.Famille), new NpgsqlParameter("m", materiel)], ct);
        }
        else
        {
            await db.Database.ExecuteSqlRawAsync("UPDATE materiel SET mat_cha_id = @c WHERE mat_id = @m", [new NpgsqlParameter("c", id[0]), new NpgsqlParameter("m", materiel)], ct);
        }
        await tx.CommitAsync(ct);
        return id[0];
    }

    private static Dictionary<string, decimal> Totaux(IEnumerable<CoutSql> l)
    {
        var t = Natures.ToDictionary(n => n, n => l.Where(c => c.Nature == n).Sum(c => c.Montant));
        t["TOTAL"] = t.Values.Sum();
        return t;
    }

    /// <summary>Coûts du matériel : chantier de suivi, mois de l'année, totaux de l'année et depuis l'entrée, coût par heure.</summary>
    public static async Task<object> CoutsAsync(LogiBtpContext db, int materiel, int? annee, CancellationToken ct)
    {
        var m = await MaterielAsync(db, materiel, ct);
        var an = annee ?? DateTime.Today.Year;
        if (m.ChaId is not { } cha)
        {
            return new { chantier = (object?)null, annee = an, annees = Array.Empty<int>(), heures = m.Heures, date_entree = m.DateEntree, natures = Natures };
        }
        var chantier = await db.Database.SqlQueryRaw<ChantierSql>("""
            SELECT c.cha_id AS id, c.cha_code AS code, c.cha_libelle AS libelle, c.cha_statut AS statut,
                   (SELECT count(*) FROM materiel x WHERE x.mat_cha_id = c.cha_id) AS materiels
            FROM chantier c WHERE c.cha_id = @c
            """, new NpgsqlParameter("c", cha)).FirstAsync(ct);
        var couts = await db.Database.SqlQueryRaw<CoutSql>("""
            SELECT v.mois, v.nature, v.montant, v.minutes, v.non_valorises FROM v_cout_chantier v WHERE v.chantier_id = @c ORDER BY v.mois
            """, new NpgsqlParameter("c", cha)).ToListAsync(ct);
        var debut = m.DateEntree is { } e ? new DateOnly(e.Year, e.Month, 1) : DateOnly.MinValue;
        var depuis = couts.Where(c => c.Mois >= debut).ToList();
        var deLAnnee = couts.Where(c => c.Mois.Year == an).ToList();
        var totalDepuis = Totaux(depuis);
        return new
        {
            chantier = new { chantier.Id, chantier.Code, chantier.Libelle, chantier.Statut, partage = chantier.Materiels > 1, materiels = chantier.Materiels },
            annee = an,
            annees = couts.Select(c => c.Mois.Year).Append(an).Distinct().OrderDescending(),
            heures = m.Heures, date_entree = m.DateEntree, natures = Natures,
            mois = Enumerable.Range(1, 12).Select(i =>
            {
                var l = deLAnnee.Where(c => c.Mois.Month == i).ToList();
                return new { mois = new DateOnly(an, i, 1), montants = Totaux(l), heures_mo = Math.Round((l.Sum(c => c.Minutes) ?? 0) / 60m, 2) };
            }),
            total_annee = Totaux(deLAnnee),
            total_depuis_entree = totalDepuis,
            heures_mo_annee = Math.Round((deLAnnee.Sum(c => c.Minutes) ?? 0) / 60m, 2),
            cout_par_heure = m.Heures is > 0 && chantier.Materiels == 1 ? Math.Round(totalDepuis["TOTAL"] / m.Heures.Value, 2) : (decimal?)null,
            non_valorises = depuis.Sum(c => c.NonValorises),
        };
    }

    public static IEndpointRouteBuilder MapCoutsMateriel(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/ressources/materiels");
        g.MapGet("/{id:int}/couts", async (int id, int? annee, LogiBtpContext db, CancellationToken ct) => Results.Ok(await CoutsAsync(db, id, annee, ct)));
        // Création à la demande du chantier de suivi (bouton de l'onglet Coûts).
        g.MapPost("/{id:int}/chantier", async (int id, LogiBtpContext db, CancellationToken ct) =>
        {
            await ChantierMaterielAsync(db, id, ct);
            return Results.Ok(await CoutsAsync(db, id, null, ct));
        });
        return api;
    }
}
