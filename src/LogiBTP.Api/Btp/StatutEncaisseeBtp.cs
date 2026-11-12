using System.Globalization;
using System.Text.Json;
using LogiBTP.Calcul;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Statut Encaissée proposé (liste à valider) : pointage d'un règlement reçu sur une échéance d'une facture émise (clé
/// « pièce:règlement:échéance »), montant pointé non encore déclaré (négatif : annulation d'encaissement, cas 34),
/// montants encaissés par taux qui partiraient dans le CDAR. Règlement supprimé : date, mode et référence absents.
/// </summary>
public sealed record PropositionEncaisseeFe(string Cle, long EntId, string? Numero, long? TiersId, string? Tiers, long RegId, long EchId,
    DateOnly? DateReglement, string? Mode, string? Reference, decimal Montant, bool Annulation, bool ReglementSupprime,
    IReadOnlyList<MontantTauxFe> Encaissements);

/// <summary>Proposition retenue par l'utilisateur : clé et montant lus dans la liste (contrôlé à l'envoi).</summary>
public sealed record ChoixEncaisseeFe(string Cle, decimal Montant);

/// <summary>Validation de la liste : propositions retenues, envoyées (statut 212) ou écartées (rien d'envoyé).</summary>
public sealed record DemandeEncaisseeFe(IReadOnlyList<ChoixEncaisseeFe> Propositions, bool Ecarter = false);

/// <summary>Erreur d'une proposition à l'envoi (statut refusé par le module : code et message).</summary>
public sealed record ErreurEncaisseeFe(string Cle, string Code, string Message);

/// <summary>Résultat de la validation : envoyés, écartés, propositions périmées (changées ou disparues depuis la lecture), erreurs.</summary>
public sealed record ResultatEncaisseeFe(int Envoyes, int Ecartes, IReadOnlyList<string> Perimees, IReadOnlyList<ErreurEncaisseeFe> Erreurs);

/// <summary>
/// Statut Encaissée (212) des factures émises (plans/facturation-electronique.md, lot 26 ; Q15 (a), XP Z12-014 cas 26 et
/// 34) : proposé pour chaque pointage d'un règlement reçu (hors imputation d'avoir) sur une échéance d'une facture émise par
/// la plateforme (document_fe_emission EMISE) de services ou mixte sans TVA sur les débits (<see cref="EncaissementFeBtp.Concerne"/>,
/// cadre et BT-8 lus dans l'original déposé), par échéance et par versement partiel, puis envoyé après validation d'une
/// liste par l'utilisateur, comme les relances. Les propositions ne sont jamais stockées : pointages − encaissements déclarés
/// (document_fe_encaissement, db/302) à chaque lecture ; un pointage diminué ou supprimé après l'envoi donne une annulation
/// d'encaissement (montants négatifs). Montants par taux : <see cref="EncaissementFeBtp.Proposer"/> (TTC par taux de la
/// facture émise, part des services des lignes vendues pour une facture mixte). Statut posable seulement après Déposée et
/// avant Rejetée / Refusée (<c>ReglesCycleVie</c>) ; envoi : <see cref="ServiceFactureElectronique.PoserStatutApplicationAsync"/>
/// (CDAR à un ou plusieurs taux, mis en file) et ligne ENVOYE dans la même transaction.
/// Routes : GET /api/facture-electronique/encaissements[?piece=], POST /api/facture-electronique/encaissements/validation (droit Modifier).
/// </summary>
public static class StatutEncaisseeBtp
{
    /// <summary>Origine notée au journal du statut posé.</summary>
    public const string Origine = "ENCAISSEMENT";

    private sealed record LigneEcartSql(long Ent, long Reg, long Ech, decimal Ecart, long Flux, string? Numero, long? TiersId, string? Tiers,
        DateOnly? DateReglement, string? Mode, string? Reference, long? LuFluxId, string? Cadre, string? Exigibilite, string? Ventilation);

    private sealed record LigneDeclareSql(decimal Montant, string Ventilation);

    private sealed record LigneMontantSql(long Id, long? Parent, short Type, string? TypePrix, int? Nature, decimal? MontantHt);

    /// <summary>Facture émise et ses écarts, prête pour <see cref="EncaissementFeBtp.Proposer"/>.</summary>
    private sealed record FactureEncaisseeFe(long Ent, long Flux, EntreeEncaissementFe Entree, List<LigneEcartSql> Lignes);

    public static string Cle(long ent, long reg, long ech) => string.Create(CultureInfo.InvariantCulture, $"{ent}:{reg}:{ech}");

    private static async Task<bool> SchemaAsync(DbContext db, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<bool>("""
            SELECT to_regclass('document_fe_encaissement') IS NOT NULL AND to_regclass('pointage') IS NOT NULL AS "Value"
            """).FirstAsync(ct);

    private const string SqlEcarts = """
        WITH pt AS (
            SELECT e.ech_ent_id AS ent, p.poi_reg_id AS reg, e.ech_id AS ech, sum(p.poi_montant) AS m
            FROM pointage p JOIN reglement r ON r.reg_id = p.poi_reg_id JOIN document_echeance e ON e.ech_id = p.poi_echeance_id
            WHERE r.reg_sens = 'E' AND r.reg_mode <> @imputation
            GROUP BY 1, 2, 3),
        dc AS (SELECT dfn_ent_id AS ent, dfn_reg_id AS reg, dfn_ech_id AS ech, sum(dfn_montant) AS m FROM document_fe_encaissement GROUP BY 1, 2, 3),
        x AS (
            SELECT coalesce(pt.ent, dc.ent) AS ent, coalesce(pt.reg, dc.reg) AS reg, coalesce(pt.ech, dc.ech) AS ech,
                   coalesce(pt.m, 0) - coalesce(dc.m, 0) AS ecart
            FROM pt FULL JOIN dc ON dc.ent = pt.ent AND dc.reg = pt.reg AND dc.ech = pt.ech)
        SELECT x.ent, x.reg, x.ech, x.ecart, f.dfe_flux_id AS flux, d.ent_numero AS numero, d.ent_tiers_id AS tiers_id,
               p.per_raison_sociale AS tiers, r.reg_date AS date_reglement, r.reg_mode AS mode, r.reg_reference AS reference,
               f.dfe_lu_flux_id AS lu_flux_id, f.dfe_cadre AS cadre, f.dfe_exigibilite AS exigibilite, f.dfe_ventilation::text AS ventilation
        FROM x
        JOIN document_fe_emission f ON f.dfe_ent_id = x.ent AND f.dfe_etat = 'EMISE' AND f.dfe_flux_id IS NOT NULL
        JOIN document d ON d.ent_id = x.ent
        LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
        LEFT JOIN reglement r ON r.reg_id = x.reg
        WHERE round(x.ecart, 2) <> 0 AND (@ents IS NULL OR x.ent = ANY(@ents))
        ORDER BY x.ent, x.reg, x.ech
        """;

    /// <summary>Propositions de la liste à valider (pièce : celles d'une seule facture).</summary>
    public static async Task<List<PropositionEncaisseeFe>> ProposerAsync(IServiceProvider services, long? piece, CancellationToken ct)
    {
        var r = new List<PropositionEncaisseeFe>();
        foreach (var f in await FacturesAsync(services, piece is long p ? [p] : null, ct))
            r.AddRange(Propositions(f, null));
        return r;
    }

    private static List<PropositionEncaisseeFe> Propositions(FactureEncaisseeFe f, ISet<string>? retenues)
    {
        var lignes = f.Lignes.Where(l => retenues is null || retenues.Contains(Cle(l.Ent, l.Reg, l.Ech))).ToList();
        var parCle = lignes.ToDictionary(l => Cle(l.Ent, l.Reg, l.Ech));
        return EncaissementFeBtp.Proposer(f.Entree with { Ecarts = lignes.Select(l => new EcartEncaissementFe(Cle(l.Ent, l.Reg, l.Ech), l.Ecart)).ToList() })
            .Select(p =>
            {
                var l = parCle[p.Cle];
                return new PropositionEncaisseeFe(p.Cle, l.Ent, l.Numero, l.TiersId, l.Tiers, l.Reg, l.Ech, l.DateReglement, l.Mode, l.Reference,
                    p.Montant, p.Annulation, l.Mode is null, p.Encaissements);
            }).ToList();
    }

    /// <summary>Factures émises concernées qui ont des écarts : données de l'original (lues une fois), part des services, déclarés.</summary>
    private static async Task<List<FactureEncaisseeFe>> FacturesAsync(IServiceProvider services, long[]? pieces, CancellationToken ct)
    {
        if (services.GetService<ModulesSociete>() is { } modules && !await modules.EstActifAsync(ModulesFacultatifs.FactureElectronique, ct)) return [];
        var db = services.GetRequiredService<LogiBtpContext>();
        if (!await SchemaAsync(db, ct)) return [];
        var fe = services.GetRequiredService<ServiceFactureElectronique>();
        var journal = services.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(StatutEncaisseeBtp));
        var ecarts = await db.Database.SqlQueryRaw<LigneEcartSql>(SqlEcarts,
            new NpgsqlParameter("imputation", LogiBTP.Reglements.ModeReglementSysteme.Imputation),
            SqlBtp.P("ents", pieces, NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Bigint)).ToListAsync(ct);
        var r = new List<FactureEncaisseeFe>();
        foreach (var g in ecarts.GroupBy(x => x.Ent))
        {
            var premier = g.First();
            var (cadre, exigibilite, ventilation) = (premier.Cadre, premier.Exigibilite, premier.Ventilation);
            if (premier.LuFluxId != premier.Flux || cadre is null)
            {
                try
                {
                    (cadre, exigibilite, ventilation) = await LireOriginalAsync(db, fe, g.Key, premier.Flux, ct);
                }
                catch (Exception e) when (e is ExceptionLectureFacture or ExceptionMetier)
                {
                    journal.LogWarning("Facturation électronique : original de la pièce {Piece} illisible pour l'encaissement ({Erreur})", g.Key, Masquage.Texte(e.Message));
                    continue;
                }
            }
            if (!EncaissementFeBtp.Concerne(cadre, exigibilite)) continue;
            var flux = await fe.Db.Flux.AsNoTracking().FirstOrDefaultAsync(x => x.FflId == premier.Flux, ct);
            if (flux?.FflNumero is null) continue;
            var historique = await fe.HistoriqueAsync(flux.FflId, flux.FflNumero, ct);
            if (!ReglesCycleVie.StatutsPosables(SensFacture.Emise, historique).Contains(StatutCdv.Encaissee)) continue;
            var (servicesHt, totalHt) = cadre![0] == 'M' ? await PartServicesAsync(db, g.Key, ct) : (1m, 1m);
            var declares = await db.Database.SqlQueryRaw<LigneDeclareSql>(
                "SELECT dfn_montant AS montant, dfn_ventilation::text AS ventilation FROM document_fe_encaissement WHERE dfn_ent_id = @e",
                new NpgsqlParameter("e", g.Key)).ToListAsync(ct);
            r.Add(new FactureEncaisseeFe(g.Key, premier.Flux, new EntreeEncaissementFe
            {
                Ventilation = Montants(ventilation),
                ServicesHt = servicesHt,
                TotalHt = totalHt,
                Declare = declares.SelectMany(d => Montants(d.Ventilation)).ToList(),
                Cumul = declares.Sum(d => d.Montant),
            }, g.ToList()));
        }
        return r;
    }

    private static List<MontantTauxFe> Montants(string? json) =>
        string.IsNullOrEmpty(json) ? [] : JsonSerializer.Deserialize<List<MontantTauxFe>>(json, JsonCalcul.Options) ?? [];

    /// <summary>
    /// Cadre BT-23, BT-8, devise et TTC par taux (base + TVA de BG-23) lus dans l'original du flux émis, du signe des
    /// échéances de la pièce (avoir : négatif) ; gardés dans document_fe_emission pour ce flux.
    /// </summary>
    private static async Task<(string Cadre, string? Exigibilite, string Ventilation)> LireOriginalAsync(LogiBtpContext db, ServiceFactureElectronique fe,
        long ent, long flux, CancellationToken ct)
    {
        var original = await fe.Db.Fichiers.AsNoTracking().FirstOrDefaultAsync(x => x.FfiFflId == flux && x.FfiDocument == TypeDocumentFlux.Original, ct)
            ?? throw ExceptionMetier.Introuvable("Original de la facture émise");
        var facture = Lecture.Lire(original.FfiContenu, validerXsd: false).Facture;
        var echeances = await db.Database.SqlQueryRaw<decimal>(
            "SELECT coalesce(sum(ech_montant), 0) AS \"Value\" FROM document_echeance WHERE ech_ent_id = @e", new NpgsqlParameter("e", ent)).FirstAsync(ct);
        var signe = echeances < 0 ? -1m : 1m;
        var ventilation = facture.DetailsTva
            .GroupBy(t => t.Taux ?? 0m)
            .Select(t => new MontantTauxFe(t.Key, signe * t.Sum(x => x.Base + x.Montant)))
            .ToList();
        var json = JsonSerializer.Serialize(ventilation, JsonCalcul.Options);
        await db.Database.ExecuteSqlRawAsync("""
            UPDATE document_fe_emission SET dfe_lu_flux_id = @f, dfe_cadre = @c, dfe_exigibilite = @x, dfe_devise = @d, dfe_ventilation = @v::jsonb
            WHERE dfe_ent_id = @e
            """, [new NpgsqlParameter("f", flux), new NpgsqlParameter("c", facture.CadreFacturation),
                  SqlBtp.P("x", facture.CodeExigibiliteTva, NpgsqlTypes.NpgsqlDbType.Varchar), new NpgsqlParameter("d", facture.Devise),
                  new NpgsqlParameter("v", json), new NpgsqlParameter("e", ent)], ct);
        return (facture.CadreFacturation, facture.CodeExigibiliteTva, json);
    }

    /// <summary>Part des services d'une facture mixte : HT des lignes vendues de services et HT des lignes vendues.</summary>
    private static async Task<(decimal, decimal)> PartServicesAsync(LogiBtpContext db, long ent, CancellationToken ct)
    {
        var lignes = await db.Database.SqlQueryRaw<LigneMontantSql>("""
            SELECT lig_id AS id, lig_parent_id AS parent, lig_tyl_id AS type, lig_type_prix AS type_prix, lig_nat_id AS nature, lig_montant_ht AS montant_ht
            FROM document_ligne WHERE lig_ent_id = @e AND NOT coalesce(lig_is_ecart_arrondi, FALSE)
            """, new NpgsqlParameter("e", ent)).ToListAsync(ct);
        return EncaissementFeBtp.PartServices(lignes.Select(l => new DocumentLigneBtp
        {
            LigId = l.Id, LigParentId = l.Parent, LigTylId = l.Type, LigTypePrix = l.TypePrix ?? "V", LigNatId = l.Nature, LigMontantHt = l.MontantHt,
        }).ToList(), await EmissionFeDonneesBtp.NaturesAsync(db, ct));
    }

    /// <summary>
    /// Validation de la liste : propositions retenues recalculées (montant changé ou disparu : périmée), dans l'ordre de la
    /// liste ; écartées (ECARTE) ou envoyées (statut 212 posé et ligne ENVOYE dans une transaction ; sans montant à un taux :
    /// écartée). Une erreur sur une proposition n'arrête pas les autres.
    /// </summary>
    public static async Task<ResultatEncaisseeFe> ValiderAsync(IServiceProvider services, DemandeEncaisseeFe d, Utilisateur u, CancellationToken ct)
    {
        if (d.Propositions is not { Count: > 0 }) throw ExceptionMetier.Invalide(ErreurFe.DemandeInvalide, "Aucune proposition retenue");
        var choix = d.Propositions.GroupBy(x => x.Cle).ToDictionary(g => g.Key, g => g.First().Montant);
        var fe = services.GetRequiredService<ServiceFactureElectronique>();
        int envoyes = 0, ecartes = 0;
        var erreurs = new List<ErreurEncaisseeFe>();
        var traitees = new HashSet<string>();
        var pieces = choix.Keys.Select(c => long.TryParse(c.Split(':')[0], NumberStyles.None, CultureInfo.InvariantCulture, out var e) ? e : 0).Distinct().ToArray();
        foreach (var f in await FacturesAsync(services, pieces, ct))
        {
            var retenues = f.Lignes.Select(l => Cle(l.Ent, l.Reg, l.Ech))
                .Where(c => choix.TryGetValue(c, out var m) && f.Lignes.Any(l => Cle(l.Ent, l.Reg, l.Ech) == c && l.Ecart == m)).ToHashSet();
            if (retenues.Count == 0) continue;
            foreach (var p in Propositions(f, retenues))
            {
                traitees.Add(p.Cle);
                var envoyer = !d.Ecarter && p.Encaissements.Count > 0;
                await using var tx = await fe.Db.Database.BeginTransactionAsync(ct);
                try
                {
                    long? statut = null, cdar = null;
                    if (envoyer)
                    {
                        var s = await fe.PoserStatutApplicationAsync(f.Flux, new StatutAPoser(StatutCdv.Encaissee)
                        {
                            Encaissements = p.Encaissements.Select(x => new MontantEncaisse(x.Montant, x.Taux, null)).ToList(),
                            Origine = new { evenement = Origine, ent_id = p.EntId, reglement = p.RegId, echeance = p.EchId, montant = p.Montant, annulation = p.Annulation },
                        }, u.Code, ct);
                        (statut, cdar) = (s.Id, s.FluxCdarId);
                    }
                    await fe.Db.Database.ExecuteSqlRawAsync("""
                        INSERT INTO document_fe_encaissement (dfn_ent_id, dfn_reg_id, dfn_ech_id, dfn_montant, dfn_ventilation, dfn_etat, dfn_fst_id, dfn_flux_id, dfn_cree_par)
                        VALUES (@e, @r, @h, @m, @v::jsonb, @etat, @s, @f, @u)
                        """, [new NpgsqlParameter("e", p.EntId), new NpgsqlParameter("r", p.RegId), new NpgsqlParameter("h", p.EchId),
                              new NpgsqlParameter("m", p.Montant), new NpgsqlParameter("v", JsonSerializer.Serialize(p.Encaissements, JsonCalcul.Options)),
                              new NpgsqlParameter("etat", envoyer ? EtatsEncaissementFe.Envoye : EtatsEncaissementFe.Ecarte),
                              SqlBtp.P("s", statut, NpgsqlTypes.NpgsqlDbType.Bigint), SqlBtp.P("f", cdar, NpgsqlTypes.NpgsqlDbType.Bigint),
                              new NpgsqlParameter("u", u.Code)], ct);
                    await tx.CommitAsync(ct);
                    if (envoyer) envoyes++;
                    else ecartes++;
                }
                catch (Exception e) when (e is ExceptionMetier or DbUpdateException or PostgresException)
                {
                    await tx.RollbackAsync(ct);
                    erreurs.Add(new ErreurEncaisseeFe(p.Cle, e is ExceptionMetier m ? m.Code : ErreurFe.DemandeInvalide, Masquage.Texte(e.Message)));
                }
            }
        }
        var perimees = choix.Keys.Where(c => !traitees.Contains(c)).ToList();
        return new ResultatEncaisseeFe(envoyes, ecartes, perimees, erreurs);
    }

    public static RouteGroupBuilder MapEncaisseeFe(this RouteGroupBuilder api)
    {
        api.MapGet("/facture-electronique/encaissements", (long? piece, HttpContext http, CancellationToken ct) =>
            ProposerAsync(http.RequestServices, piece, ct));
        api.MapPost("/facture-electronique/encaissements/validation", (DemandeEncaisseeFe d, HttpContext http, CancellationToken ct) =>
            ValiderAsync(http.RequestServices, d, Utilisateur.Depuis(http), ct));
        return api;
    }
}
