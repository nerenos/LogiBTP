using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle.Web;
using LogiBTP.Stock.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

public sealed record ClotureSaisie(DateTimeOffset? Date, DateTimeOffset? Debut, string? Libelle);
public sealed record NatureCloture(int? Nature, string? Code, string Libelle, decimal Initial, decimal Final, decimal ProvisionInitiale = 0, decimal ProvisionFinale = 0);
public sealed record ApercuCloture(string Date, string? Debut, string Methode, decimal ValeurInitiale, decimal ValeurFinale, decimal ProvisionInitiale, decimal ProvisionFinale,
    List<NatureCloture> Natures, List<string> Avertissements);
public sealed record ClotureDto(long Id, string Date, string? Debut, string Libelle, string Methode, string Etat, long? Piece, string? Numero, string? EtatCompta,
    decimal ValeurInitiale, decimal ValeurFinale, string Par, DateTimeOffset Le);

/// <summary>
/// Clôture du stock, variation de fin d'exercice (plans/stock.md, lot 10 ; ANALYSE-MODULE-STOCK.md Q9) : à une date-heure, l'état
/// valorisé de tous les lieux (<see cref="ServiceStock.EtatValoriseAsync"/>, méthode de la société) est comparé à celui de la date
/// de départ (la clôture précédente non annulée par défaut, sinon stock initial nul). La valeur de chaque nature d'article, début
/// et fin, est gardée (`stk_cloture_nature`) ; la pièce <c>S_INVENTAIRE</c> de la clôture (une ligne par article, montant = variation
/// de sa valeur) porte l'opération diverse que l'export de la comptabilité écrit par nature avec <c>ReglesStockCompta</c> (compte
/// de stock, de variation) — voir <see cref="SpecialisationComptabiliteBtp"/>. Annulation : tant que la pièce n'est pas transférée
/// en comptabilité (sinon refusée : annuler d'abord son export). Droit : paramétrage (administrateur).
/// </summary>
public static class ClotureStockBtp
{
    private sealed record ArticleNatureSql(long Id, int? NatId);
    private sealed record NatureSql(int Id, string Code, string Libelle);
    private sealed record ProvisionSql(int? NatId, decimal Provision);
    private sealed record ClotureSql(long Id, DateTimeOffset Date, DateTimeOffset? Debut, string Libelle, string Methode, string Etat, long? EntId, string? Numero, string? EtatCompta,
        decimal ValeurInitiale, decimal ValeurFinale, string Par, DateTimeOffset Le);
    private sealed record PieceLigne(long Ele, string Libelle, decimal Variation);
    private sealed record Calcul(ApercuCloture Apercu, List<PieceLigne> Articles);

    private const string SelectClotures = """
        SELECT c.clo_id AS id, c.clo_date AS date, c.clo_debut AS debut, c.clo_libelle AS libelle, c.clo_methode AS methode, c.clo_etat AS etat, c.clo_ent_id AS ent_id,
               d.ent_numero AS numero, d.ent_etat_compta::text AS etat_compta, c.clo_valeur_initiale AS valeur_initiale, c.clo_valeur_finale AS valeur_finale,
               c.clo_cree_par AS par, c.clo_cree_le AS le
        FROM stk_cloture c LEFT JOIN document d ON d.ent_id = c.clo_ent_id
        """;

    private static string Minute(DateTimeOffset d) => d.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm");

    private static ClotureDto Dto(ClotureSql c) => new(c.Id, Minute(c.Date), c.Debut is { } d ? Minute(d) : null, c.Libelle, c.Methode, c.Etat, c.EntId, c.Numero, c.EtatCompta,
        c.ValeurInitiale, c.ValeurFinale, c.Par, c.Le);

    /// <summary>Calcul d'une clôture : valeur de chaque nature à la date de départ et à la date de clôture, variation par article.</summary>
    private static async Task<Calcul> CalculerAsync(ServiceStock stock, LogiBtpContext db, DateTimeOffset fin, DateTimeOffset? debut, CancellationToken ct)
    {
        if (fin > DateTimeOffset.UtcNow) throw ExceptionMetier.Invalide("CLOTURE_DATE_FUTURE", "Clôture à une date à venir refusée");
        if (debut is { } d0 && d0 >= fin) throw ExceptionMetier.Invalide("CLOTURE_DEBUT", "La date de départ doit précéder la date de clôture");
        // Départ par défaut : la clôture précédente non annulée.
        debut ??= await db.Database.SqlQuery<DateTimeOffset?>($"SELECT max(clo_date) AS \"Value\" FROM stk_cloture WHERE clo_etat = 'ACTIVE' AND clo_date < {fin}").FirstOrDefaultAsync(ct);
        var finale = await stock.EtatValoriseAsync(fin, null, false, ct);
        var initiale = debut is { } d ? await stock.EtatValoriseAsync(d, null, false, ct) : null;
        var valeurs = new Dictionary<long, (decimal Initiale, decimal Finale, string Code, string Libelle)>();
        // Provision pour dépréciation (S30) : par article, valeur de la méthode − valeur d'inventaire saisie quand celle-ci est inférieure.
        var provisions = new Dictionary<long, decimal>();
        var avertissements = new List<string>();
        foreach (var l in finale.Lignes)
        {
            if (l.Valeur is null && l.Quantite != 0) avertissements.Add($"{l.Code} : article sans valeur, non comptabilisé");
            valeurs[l.EleId] = (0, l.Valeur ?? 0, l.Code, l.Libelle);
            if (l.Valeur is { } valeur && l.ValeurInventaire is { } inventaire && valeur > inventaire) provisions[l.EleId] = valeur - inventaire;
        }
        // Provision de départ : celle de la clôture active datée du départ (reprise à cette clôture), sinon nulle.
        var departProvisions = debut is { } dp
            ? (await db.Database.SqlQuery<ProvisionSql>($"""
                SELECT n.cln_nat_id AS nat_id, n.cln_provision_finale AS provision FROM stk_cloture c JOIN stk_cloture_nature n ON n.cln_clo_id = c.clo_id
                WHERE c.clo_etat = 'ACTIVE' AND c.clo_date = {dp}
                """).ToListAsync(ct)).ToDictionary(x => x.NatId ?? 0, x => x.Provision)
            : [];
        foreach (var l in initiale?.Lignes ?? [])
        {
            if (l.Valeur is null && l.Quantite != 0) avertissements.Add($"{l.Code} (début) : article sans valeur, non comptabilisé");
            var v = valeurs.GetValueOrDefault(l.EleId, (0, 0, l.Code, l.Libelle));
            valeurs[l.EleId] = (l.Valeur ?? 0, v.Finale, v.Code, v.Libelle);
        }
        var ids = valeurs.Keys.ToArray();
        var natureArticle = (await db.Database.SqlQuery<ArticleNatureSql>($"SELECT ele_id AS id, ele_nat_id AS nat_id FROM element WHERE ele_id = ANY({ids})").ToListAsync(ct)).ToDictionary(a => a.Id, a => a.NatId);
        var natures = (await db.Database.SqlQuery<NatureSql>($"SELECT nat_id AS id, nat_code AS code, nat_libelle AS libelle FROM nature_element").ToListAsync(ct)).ToDictionary(n => n.Id);
        var parNature = new SortedDictionary<int, (decimal Initial, decimal Final)>();
        var provisionNature = new Dictionary<int, decimal>();
        var articles = new List<PieceLigne>();
        foreach (var (ele, v) in valeurs)
        {
            var nat = natureArticle.GetValueOrDefault(ele) ?? 0;
            var cumul = parNature.GetValueOrDefault(nat);
            parNature[nat] = (cumul.Initial + v.Initiale, cumul.Final + v.Finale);
            if (provisions.TryGetValue(ele, out var prov)) provisionNature[nat] = provisionNature.GetValueOrDefault(nat) + prov;
            var variation = Math.Round(v.Finale - v.Initiale, 2, MidpointRounding.AwayFromZero);
            if (variation != 0) articles.Add(new PieceLigne(ele, $"{v.Code} – {v.Libelle}", variation));
        }
        // Une nature absente de l'état mais provisionnée à la clôture précédente doit être reprise.
        foreach (var nat in departProvisions.Keys) if (!parNature.ContainsKey(nat)) parNature[nat] = (0, 0);
        decimal Arrondi(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
        var liste = parNature.Select(p => new NatureCloture(p.Key == 0 ? null : p.Key, p.Key == 0 ? null : natures.GetValueOrDefault(p.Key)?.Code,
            p.Key == 0 ? "Sans nature" : natures.GetValueOrDefault(p.Key)?.Libelle ?? $"Nature {p.Key}",
            Arrondi(p.Value.Initial), Arrondi(p.Value.Final), Arrondi(departProvisions.GetValueOrDefault(p.Key)), Arrondi(provisionNature.GetValueOrDefault(p.Key)))).ToList();
        // Pièce sans variation de valeur (dépréciation seule) : une ligne à zéro par article provisionné.
        if (articles.Count == 0) articles.AddRange(provisions.Keys.Select(e => new PieceLigne(e, $"{valeurs[e].Code} – {valeurs[e].Libelle}", 0)));
        return new Calcul(new ApercuCloture(Minute(fin), debut is { } dd ? Minute(dd) : null, finale.Methode, liste.Sum(n => n.Initial), liste.Sum(n => n.Final),
            liste.Sum(n => n.ProvisionInitiale), liste.Sum(n => n.ProvisionFinale), liste, avertissements),
            articles.OrderBy(a => a.Libelle, StringComparer.OrdinalIgnoreCase).ToList());
    }

    public static RouteGroupBuilder MapClotureStock(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/stock/clotures");

        g.MapGet("", async (LogiBtpContext db, CancellationToken ct) =>
            (await db.Database.SqlQueryRaw<ClotureSql>(SelectClotures + " ORDER BY c.clo_date DESC, c.clo_id DESC").ToListAsync(ct)).Select(Dto));

        g.MapGet("/apercu", async (DateTimeOffset date, DateTimeOffset? debut, ServiceStock stock, LogiBtpContext db, CancellationToken ct) =>
            (await CalculerAsync(stock, db, date, debut, ct)).Apercu);

        g.MapPost("", async (ClotureSaisie s, HttpContext http, ServiceStock stock, LogiBtpContext db,
            DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var fin = s.Date ?? throw ExceptionMetier.Invalide("CLOTURE_DATE", "Date de clôture obligatoire");
            if (await db.Database.SqlQuery<bool>($"SELECT EXISTS (SELECT 1 FROM stk_cloture WHERE clo_etat = 'ACTIVE' AND clo_date = {fin}) AS \"Value\"").FirstAsync(ct))
                throw ExceptionMetier.Conflit("CLOTURE_DOUBLON", "Une clôture existe déjà à cette date");
            var calcul = await CalculerAsync(stock, db, fin, s.Debut, ct);
            var a = calcul.Apercu;
            if (a.Natures.All(n => n.Initial == n.Final && n.ProvisionInitiale == n.ProvisionFinale)) throw ExceptionMetier.Invalide("CLOTURE_VIDE", "Aucune variation de stock à comptabiliser");
            var libelle = string.IsNullOrWhiteSpace(s.Libelle) ? $"Clôture du stock au {fin.UtcDateTime:dd/MM/yyyy}" : s.Libelle.Trim();
            libelle = libelle.Length > 200 ? libelle[..200] : libelle;
            var debut = a.Debut is null ? (DateTimeOffset?)null : DateTimeOffset.Parse(a.Debut + ":00Z", System.Globalization.CultureInfo.InvariantCulture);
            var id = (await db.Database.SqlQuery<long>($"""
                INSERT INTO stk_cloture (clo_date, clo_debut, clo_libelle, clo_methode, clo_valeur_initiale, clo_valeur_finale, clo_cree_par)
                VALUES ({fin}, {debut}, {libelle}, {a.Methode}, {a.ValeurInitiale}, {a.ValeurFinale}, {u.Code}) RETURNING clo_id AS "Value"
                """).ToListAsync(ct))[0];
            foreach (var n in a.Natures)
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO stk_cloture_nature (cln_clo_id, cln_nat_id, cln_initial, cln_final, cln_provision_initiale, cln_provision_finale)
                    VALUES ({id}, {n.Nature}, {n.Initial}, {n.Final}, {n.ProvisionInitiale}, {n.ProvisionFinale})
                    """, ct);
            // Pièce d'opération diverse : une ligne par article (quantité ±1, prix = variation de sa valeur), sans lieu.
            var lignes = calcul.Articles.Select(x => (x.Ele, x.Libelle, x.Variation < 0 ? -1m : 1m, Math.Abs(x.Variation))).ToList();
            long piece;
            try
            {
                piece = await SpecialisationStockBtp.PieceEcartsAsync(documents, db, null, DateOnly.FromDateTime(fin.UtcDateTime), libelle, lignes, u, ct);
            }
            catch
            {
                // Pas de clôture sans sa pièce : lignes de nature supprimées avec elle.
                await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM stk_cloture WHERE clo_id = {id}", CancellationToken.None);
                throw;
            }
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE stk_cloture SET clo_ent_id = {piece} WHERE clo_id = {id}", ct);
            return Results.Ok(Dto(await db.Database.SqlQueryRaw<ClotureSql>(SelectClotures + " WHERE c.clo_id = @c", new NpgsqlParameter("c", id)).FirstAsync(ct)));
        });

        g.MapPost("/{id:long}/annulation", async (long id, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var c = await db.Database.SqlQueryRaw<ClotureSql>(SelectClotures + " WHERE c.clo_id = @c", new NpgsqlParameter("c", id)).FirstOrDefaultAsync(ct)
                ?? throw ExceptionMetier.Introuvable("Clôture");
            if (c.Etat != "ACTIVE") throw ExceptionMetier.Conflit("CLOTURE_ANNULEE", "Clôture déjà annulée");
            if (c.EtatCompta == "T")
                throw ExceptionMetier.Conflit("CLOTURE_TRANSFEREE", "La pièce de la clôture est transférée en comptabilité : annulez d'abord son lot d'export");
            if (c.EntId is long piece)
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE document d SET ent_std_id = s.std_id, ent_etat_compta = 'S' FROM statut_document s
                    WHERE d.ent_id = {piece} AND s.std_tyd_id = d.ent_tyd_id AND s.std_code = {StatutsDocument.Annule}
                    """, ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE stk_cloture SET clo_etat = 'ANNULEE', clo_annule_par = {u.Code}, clo_annule_le = now() WHERE clo_id = {id}", ct);
            return Results.Ok(Dto(await db.Database.SqlQueryRaw<ClotureSql>(SelectClotures + " WHERE c.clo_id = @c", new NpgsqlParameter("c", id)).FirstAsync(ct)));
        });
        return g;
    }
}
