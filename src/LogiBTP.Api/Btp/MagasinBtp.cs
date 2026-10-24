using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

public sealed record LigneMagasin(long Ele, decimal Quantite, bool Rebut = false);
public sealed record SaisieMagasin(long? Lieu, int? Salarie, int? Chantier, List<LigneMagasin>? Lignes, string? Commentaire, DateTimeOffset? Date);
public sealed record PieceMagasin(long EntId, string? Numero, string Type, int Lignes);

/// <summary>
/// Module Stock, lot 4 (ANALYSE-MODULE-STOCK.md § 5.5, § 5.6, S16 à S19) : magasin (comptoir) et dotations des
/// salariés. Une sortie est un transfert validé d'office du dépôt vers un chantier ou vers le chantier de dotation du
/// salarié (créé à la première sortie dans l'affaire DOTATIONS, il tient un stock : le doté non rendu) ; un retour est un
/// transfert vers le dépôt (réutilisable) ou une sortie du chantier de dotation (rebut). Mouvements d'une dotation
/// marqués DOTATION avec l'individu du salarié. Droit : administrateur ou membre d'un service LOGISTIQUE.
/// </summary>
public static class MagasinBtp
{
    private sealed record SalarieSql(int Id, string? Code, string? Matricule, string Nom, string Prenom, string? Service, long? IndId, int? Chantier, bool Actif);
    private sealed record ArticleSql(long Id, string Code, string? LibelleHtml, string Unite, int? NatId);
    private sealed record MouvementDotationSql(int Salarie, long Ele, DateTimeOffset Date, decimal Quantite, long? EntId, string? Numero, string? TypeCode, string? Origine);
    private sealed record NetSql(int Salarie, long Ele, decimal Quantite);

    private static async Task Exiger(LogiBtpContext db, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin && !await SpecialisationStockBtp.MagasinierAsync(db.Database, u.Code, ct)) throw ExceptionMetier.AccesRefuse("GERER_STOCK");
    }

    private static Task<List<SalarieSql>> SalariesAsync(LogiBtpContext db, int? id, CancellationToken ct) =>
        db.Database.SqlQuery<SalarieSql>($"""
            SELECT s.sal_id AS id, s.sal_code AS code, s.sal_matricule AS matricule, s.sal_nom AS nom, s.sal_prenom AS prenom, s.sal_service AS service,
                   s.sal_ind_id AS ind_id, s.sal_cha_dotation_id AS chantier, s.sal_actif AS actif
            FROM salarie s WHERE ({id}::int IS NULL AND s.sal_actif) OR s.sal_id = {id}::int
            ORDER BY s.sal_nom, s.sal_prenom
            """).ToListAsync(ct);

    /// <summary>Chantier de dotation du salarié, créé à la première sortie (DOT-code, affaire DOTATIONS, tient un stock, CLOS).</summary>
    public static async Task<int> ChantierDotationAsync(LogiBtpContext db, int salarie, CancellationToken ct)
    {
        var s = (await SalariesAsync(db, salarie, ct)).FirstOrDefault() ?? throw ExceptionMetier.Introuvable("Salarié");
        if (s.Chantier is { } c) return c;
        var code = $"DOT-{(s.Code ?? s.Matricule ?? s.Id.ToString()).ToUpperInvariant()}";
        if (code.Length > 20) code = code[..20];
        var id = await db.Database.SqlQuery<int>($"""
            INSERT INTO chantier (cha_code, cha_libelle, cha_aff_id, cha_statut, cha_stock_tenu, cha_commentaire)
            VALUES ({code}, {$"Dotations {s.Prenom} {s.Nom}"}, (SELECT aff_id FROM affaire WHERE aff_code = 'DOTATIONS'), 'CLOS', TRUE,
                    'Chantier de dotation du salarié : son stock = EPI et outillage dotés non rendus (module Stock)')
            ON CONFLICT (cha_code) DO UPDATE SET cha_stock_tenu = TRUE
            RETURNING cha_id AS "Value"
            """).ToListAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE salarie SET sal_cha_dotation_id = {id[0]} WHERE sal_id = {salarie}", ct);
        return id[0];
    }

    /// <summary>Crée, enregistre et valide une pièce de stock (transfert ou sortie) aux lignes en unité de stock.</summary>
    private static async Task<PieceMagasin> PieceAsync(LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents,
        string type, int? origine, int? destination, int? chantier, List<LigneMagasin> lignes, string? objet, DateTimeOffset? date, Utilisateur u, CancellationToken ct)
    {
        var tyd = await db.TypesDocument.AsNoTracking().Where(t => t.TydCode == type).Select(t => t.TydId).FirstAsync(ct);
        var tva = await db.TauxTva.Where(t => t.TtvCategorie == "N" && t.TtvActif).OrderByDescending(t => t.TtvTaux).Select(t => (int?)t.TtvId).FirstOrDefaultAsync(ct);
        var ids = lignes.Select(l => l.Ele).Distinct().ToArray();
        var articles = (await db.Database.SqlQuery<ArticleSql>($"""
            SELECT ele_id AS id, ele_code AS code, ele_libelle_html AS libelle_html, ele_unt_stock AS unite, ele_nat_id AS nat_id
            FROM element WHERE ele_id = ANY({ids}) AND ele_gestion = 'STOCK'
            """).ToListAsync(ct)).ToDictionary(a => a.Id);
        if (ids.Any(i => !articles.ContainsKey(i))) throw ExceptionMetier.Invalide("STK_ARTICLE", "Article non géré en stock");
        var cree = await documents.Creer(new CreationDocument { EntTydId = tyd, EntObjet = objet }, u, ct);
        var c = await documents.Charger(cree.Document.EntId, ct);
        c.Document.EntStkOrigineId = origine;
        c.Document.EntStkDestinationId = destination;
        c.Document.EntChantierId = chantier;
        c.Document.EntDateMouvement = date;
        var n = 0;
        foreach (var l in lignes)
        {
            var a = articles[l.Ele];
            n++;
            foreach (var x in c.Lignes.Where(x => x.LigParentId is null && x.LigOrdre >= n)) x.LigOrdre++;
            c.Lignes.Add(new DocumentLigneBtp
            {
                LigId = -n, LigEntId = c.Document.EntId, LigOrdre = n, LigTylId = TL.Element, LigArtId = a.Id, LigCode = a.Code, LigLibelleHtml = a.LibelleHtml ?? a.Code,
                LigQte = l.Quantite, LigUntCode = a.Unite, LigPa = 0, LigNatId = a.NatId, LigTvaId = tva, LigTypePrix = "V",
            });
        }
        if (!c.Lignes.Any(l => l.LigParentId is null && l.LigTylId == TL.Tva))
            c.Lignes.Add(new DocumentLigneBtp { LigId = -1000, LigEntId = c.Document.EntId, LigOrdre = n + 100, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" });
        var r = await documents.Enregistrer(c.Document.EntId, c, u, ct);
        var v = await documents.Valider(c.Document.EntId, new DemandeVersion { EntVersion = (r.Document ?? c).Document.EntVersion }, u, ct);
        return new PieceMagasin(c.Document.EntId, (v.Document ?? c).Document.EntNumero, type, n);
    }

    private static void Controler(SaisieMagasin s)
    {
        if (s.Lieu is null) throw ExceptionMetier.Invalide("STK_LIEU", "Dépôt obligatoire");
        if (s.Salarie is null == s.Chantier is null) throw ExceptionMetier.Invalide("STK_BENEFICIAIRE", "Un salarié (dotation) ou un chantier");
        if (s.Lignes is not { Count: > 0 } || s.Lignes.Any(l => l.Quantite <= 0)) throw ExceptionMetier.Invalide("STK_QUANTITE", "Au moins une ligne à quantité positive");
    }

    private static async Task MarquerDotationAsync(LogiBtpContext db, IEnumerable<long> pieces, int salarie, CancellationToken ct)
    {
        var t = pieces.ToArray();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE stk_mouvement SET mvt_origine = 'DOTATION', mvt_ind_id = (SELECT sal_ind_id FROM salarie WHERE sal_id = {salarie})
            WHERE mvt_ent_id = ANY({t})
            """, ct);
    }

    public static RouteGroupBuilder MapMagasinStock(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/stock/magasin");
        // Salariés actifs (bénéficiaires des dotations) et leur chantier de dotation.
        g.MapGet("/salaries", async (LogiBtpContext db, CancellationToken ct) => (await SalariesAsync(db, null, ct))
            .Select(s => new { s.Id, s.Code, s.Matricule, s.Nom, s.Prenom, s.Service, s.Chantier }));
        // Sortie du dépôt : vers un chantier (consommation ou stock du chantier) ou en dotation d'un salarié.
        g.MapPost("/sorties", async (SaisieMagasin s, HttpContext http, LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            await Exiger(db, u, ct);
            Controler(s);
            var cible = s.Salarie is { } sal ? await ChantierDotationAsync(db, sal, ct) : s.Chantier!.Value;
            var objet = s.Salarie is null ? "Sortie du magasin" : "Dotation du magasin";
            var p = await PieceAsync(db, documents, "S_TRANSFERT", (int)s.Lieu!.Value, cible, cible, s.Lignes!, string.IsNullOrWhiteSpace(s.Commentaire) ? objet : $"{objet} : {s.Commentaire.Trim()}", s.Date, u, ct);
            if (s.Salarie is { } sa) await MarquerDotationAsync(db, [p.EntId], sa, ct);
            return Results.Ok(new[] { p });
        });
        // Retour : réutilisable → transfert vers le dépôt ; rebut → sortie du chantier (ou de la dotation).
        g.MapPost("/retours", async (SaisieMagasin s, HttpContext http, LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            await Exiger(db, u, ct);
            Controler(s);
            var source = s.Salarie is { } sal ? await ChantierDotationAsync(db, sal, ct) : s.Chantier!.Value;
            var pieces = new List<PieceMagasin>();
            var bons = s.Lignes!.Where(l => !l.Rebut).ToList();
            var rebuts = s.Lignes!.Where(l => l.Rebut).ToList();
            var com = string.IsNullOrWhiteSpace(s.Commentaire) ? "" : $" : {s.Commentaire.Trim()}";
            if (bons.Count > 0) pieces.Add(await PieceAsync(db, documents, "S_TRANSFERT", source, (int)s.Lieu!.Value, source, bons, $"Retour au magasin{com}", s.Date, u, ct));
            if (rebuts.Count > 0) pieces.Add(await PieceAsync(db, documents, "S_SORTIE", source, null, source, rebuts, $"Mise au rebut{com}", s.Date, u, ct));
            if (s.Salarie is { } sa) await MarquerDotationAsync(db, pieces.Select(p => p.EntId), sa, ct);
            return Results.Ok(pieces);
        });
        // Dotations sur une période : par salarié et article, sorti, rendu (réutilisable ou rebut), net actuel, dates.
        g.MapGet("/dotations", async (DateOnly? du, DateOnly? au, int? salarie, LogiBtpContext db, CancellationToken ct) =>
        {
            var debut = (du ?? DateOnly.FromDateTime(DateTime.Today.AddMonths(-12))).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            var fin = (au ?? DateOnly.FromDateTime(DateTime.Today)).AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            var mvts = await db.Database.SqlQuery<MouvementDotationSql>($"""
                SELECT s.sal_id AS salarie, m.mvt_ele_id AS ele, m.mvt_date AS date, m.mvt_quantite AS quantite, m.mvt_ent_id AS ent_id, d.ent_numero AS numero,
                       t.tyd_code AS type_code, m.mvt_origine AS origine
                FROM stk_mouvement m JOIN salarie s ON s.sal_cha_dotation_id = m.mvt_lieu_id
                LEFT JOIN document d ON d.ent_id = m.mvt_ent_id LEFT JOIN type_document t ON t.tyd_id = d.ent_tyd_id
                WHERE m.mvt_date >= {debut} AND m.mvt_date < {fin} AND ({salarie}::int IS NULL OR s.sal_id = {salarie}::int)
                ORDER BY m.mvt_date, m.mvt_id
                """).ToListAsync(ct);
            var nets = await db.Database.SqlQuery<NetSql>($"""
                SELECT s.sal_id AS salarie, v.ele_id AS ele, v.quantite FROM v_stk_stock v JOIN salarie s ON s.sal_cha_dotation_id = v.lieu_id
                WHERE v.quantite <> 0 AND ({salarie}::int IS NULL OR s.sal_id = {salarie}::int)
                """).ToListAsync(ct);
            var sal = (await SalariesAsync(db, salarie, ct)).Where(x => x.Chantier is not null).ToList();
            if (salarie is null)
            {
                var avec = mvts.Select(m => m.Salarie).Union(nets.Select(n => n.Salarie)).ToHashSet();
                sal = sal.Where(x => avec.Contains(x.Id)).ToList();
            }
            var articles = mvts.Select(m => m.Ele).Union(nets.Select(n => n.Ele)).Distinct().ToArray();
            var infos = (await db.Database.SqlQuery<ArticleSql>($"SELECT ele_id AS id, ele_code AS code, ele_libelle AS libelle_html, ele_unt_stock AS unite, ele_nat_id AS nat_id FROM element WHERE ele_id = ANY({articles})")
                .ToListAsync(ct)).ToDictionary(a => a.Id);
            return Results.Ok(new
            {
                du = DateOnly.FromDateTime(debut), au = DateOnly.FromDateTime(fin.AddDays(-1)),
                articles = articles.Select(a => new { id = a, code = infos.GetValueOrDefault(a)?.Code, libelle = infos.GetValueOrDefault(a)?.LibelleHtml, unite = infos.GetValueOrDefault(a)?.Unite })
                    .OrderBy(a => a.code, StringComparer.OrdinalIgnoreCase),
                salaries = sal.Select(x => new
                {
                    id = x.Id, code = x.Code, nom = x.Nom, prenom = x.Prenom, service = x.Service, chantier = x.Chantier,
                    articles = articles.Select(a =>
                    {
                        var l = mvts.Where(m => m.Salarie == x.Id && m.Ele == a).ToList();
                        var net = nets.FirstOrDefault(n => n.Salarie == x.Id && n.Ele == a)?.Quantite ?? 0;
                        return new
                        {
                            ele = a, sorti = l.Where(m => m.Quantite > 0).Sum(m => m.Quantite), rendu = -l.Where(m => m.Quantite < 0 && m.TypeCode == "S_TRANSFERT").Sum(m => m.Quantite),
                            rebut = -l.Where(m => m.Quantite < 0 && m.TypeCode != "S_TRANSFERT").Sum(m => m.Quantite), net,
                            mouvements = l.Select(m => new { date = m.Date, quantite = m.Quantite, m.EntId, m.Numero, m.TypeCode }),
                        };
                    }).Where(a => a.sorti != 0 || a.rendu != 0 || a.rebut != 0 || a.net != 0),
                }),
            });
        });
        return api;
    }
}
