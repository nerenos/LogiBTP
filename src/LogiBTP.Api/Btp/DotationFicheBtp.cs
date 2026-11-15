using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Domaine;
using LogiBTP.Editions.Web;
using LogiBTP.Ged.Web;
using LogiBTP.Pointage.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Fiche de dotation EPI et outillage (module Stock, S26 ; `db/270`) : éditée par le module Édition (modèle
/// <see cref="Modele"/>, source fiche du salarié, source annexe <c>dotations_salarie</c> : mouvements de dotation de la
/// période — sortis, rendus, mis au rebut —, encore doté au jour, signature) ; aperçu et impression au bureau
/// (`/edition?source=fiche&amp;id=salarie/…&amp;p_du=&amp;p_au=`) ; signée à la borne d'atelier par le salarié identifié pour
/// les mouvements enregistrés depuis sa fiche signée précédente (jamais vide ; chaque mouvement sur une seule fiche), PDF rangé dans la GED du salarié (catégorie
/// <see cref="Categorie"/>) avec son empreinte SHA-256 ; fiche signée réimprimable (`p_fiche`).
/// </summary>
public static class DotationFicheBtp
{
    public const string Modele = ModelesEdition.FicheDotation;
    public const string SourceAnnexe = "dotations_salarie";
    public const string CodeSignature = "SIGNATURE_DOTATION";
    public const string Categorie = CategoriesGed.Dotation;
    private const int SignatureMax = 512 * 1024;
    private static readonly Utilisateur ServeurEditions = new("editions_fond", Profils.Admin);

    public sealed record SignatureBorne(string Jeton, string? Signature, bool Test = false);
    private sealed record FicheSql(long Id, int Salarie, DateOnly Du, DateOnly Au, DateTimeOffset? Debut, DateTimeOffset Fin, long? SigId, long? DgeId, string Lieu,
        string? Signataire, DateTimeOffset? SigneLe);
    private sealed record PeriodeSql(DateTimeOffset? Debut, DateOnly? Du);

    /// <summary>
    /// Période des mouvements : dates (impression libre, sur la date du mouvement) ou instants d'enregistrement
    /// (<c>Fin</c> renseignée : fiche signée ou à signer, sur <c>mvt_cree_le</c>, début exclu, fin incluse).
    /// </summary>
    private sealed record Periode(DateOnly Du, DateOnly Au, DateTimeOffset? Debut = null, DateTimeOffset? Fin = null);

    /// <summary>
    /// Période à signer : mouvements enregistrés depuis la signature de la fiche précédente (sinon tous) jusqu'à
    /// maintenant ; dates affichées : premier mouvement de la période (sinon aujourd'hui), aujourd'hui.
    /// </summary>
    private static async Task<Periode> PeriodeASignerAsync(LogiBtpContext db, int salarie, CancellationToken ct)
    {
        var maintenant = DateTimeOffset.UtcNow;
        var p = await db.Database.SqlQuery<PeriodeSql>($"""
            WITH d AS (SELECT max(f.dfi_fin) AS debut FROM dotation_fiche f WHERE f.dfi_sal_id = {salarie})
            SELECT d.debut, (SELECT min(m.mvt_date AT TIME ZONE 'Europe/Paris')::date FROM stk_mouvement m JOIN salarie s ON s.sal_cha_dotation_id = m.mvt_lieu_id
                              WHERE s.sal_id = {salarie} AND (d.debut IS NULL OR m.mvt_cree_le > d.debut) AND m.mvt_cree_le <= {maintenant}) AS du
            FROM d
            """).FirstAsync(ct);
        var aujourdhui = DateOnly.FromDateTime(DateTime.Today);
        var du = p.Du ?? aujourdhui;
        return new Periode(du > aujourdhui ? aujourdhui : du, aujourdhui, p.Debut, maintenant);
    }

    /// <summary>
    /// Données de la fiche (source annexe et borne) : salarié, période, mouvements de dotation de la période (date,
    /// article, remis, rendu, rebut, pièce), encore doté au jour, signature de la fiche signée demandée.
    /// </summary>
    private static async Task<JsonObject?> DonneesAsync(LogiBtpContext db, int salarie, Periode periode, long? fiche, CancellationToken ct)
    {
        FicheSql? f = null;
        if (fiche is { } fid)
        {
            f = await FichesSql(db, salarie, fid).FirstOrDefaultAsync(ct);
            if (f is null) return null;
            periode = new Periode(f.Du, f.Au, f.Debut, f.Fin);
        }
        var (du, au) = (periode.Du, periode.Au);
        var debut = du.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var fin = au.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var (enrDebut, enrFin) = (periode.Debut, periode.Fin);
        var json = await db.Database.SqlQuery<string>($"""
            SELECT json_build_object(
              'salarie', (SELECT json_build_object('id', s.sal_id, 'code', s.sal_code, 'nom', s.sal_nom, 'prenom', s.sal_prenom,
                            'service', coalesce((SELECT v.srv_libelle FROM service v WHERE v.srv_code = s.sal_service), s.sal_service))
                          FROM salarie s WHERE s.sal_id = {salarie}),
              'du', {du}::date, 'au', {au}::date,
              'mouvements', coalesce((SELECT json_agg(json_build_object('date', (m.mvt_date AT TIME ZONE 'Europe/Paris')::date, 'code', e.ele_code, 'libelle', e.ele_libelle,
                    'unite', e.ele_unt_stock, 'remis', CASE WHEN m.mvt_quantite > 0 THEN m.mvt_quantite END,
                    'rendu', CASE WHEN m.mvt_quantite < 0 AND t.tyd_code = {TypesDocument.STransfert} THEN -m.mvt_quantite END,
                    'rebut', CASE WHEN m.mvt_quantite < 0 AND t.tyd_code IS DISTINCT FROM {TypesDocument.STransfert} THEN -m.mvt_quantite END,
                    'numero', d.ent_numero, 'borne', m.mvt_origine = 'BORNE') ORDER BY m.mvt_date, m.mvt_id)
                  FROM stk_mouvement m JOIN salarie s ON s.sal_cha_dotation_id = m.mvt_lieu_id JOIN element e ON e.ele_id = m.mvt_ele_id
                  LEFT JOIN document d ON d.ent_id = m.mvt_ent_id LEFT JOIN type_document t ON t.tyd_id = d.ent_tyd_id
                  WHERE s.sal_id = {salarie}
                    AND CASE WHEN {enrFin}::timestamptz IS NULL THEN m.mvt_date >= {debut} AND m.mvt_date < {fin}
                             ELSE m.mvt_cree_le <= {enrFin}::timestamptz AND ({enrDebut}::timestamptz IS NULL OR m.mvt_cree_le > {enrDebut}::timestamptz) END), '[]'),
              'dote', coalesce((SELECT json_agg(json_build_object('code', e.ele_code, 'libelle', e.ele_libelle, 'unite', e.ele_unt_stock, 'quantite', v.quantite) ORDER BY e.ele_code)
                  FROM v_stk_stock v JOIN salarie s ON s.sal_cha_dotation_id = v.lieu_id JOIN element e ON e.ele_id = v.ele_id
                  WHERE s.sal_id = {salarie} AND v.quantite <> 0), '[]'))::text AS "Value"
            """).FirstAsync(ct);
        var r = JsonNode.Parse(json)!.AsObject();
        r["fiche_id"] = f?.Id;
        r["signe"] = f?.SigId is not null;
        r["signature_id"] = f?.SigId;
        r["signataire"] = f?.Signataire;
        r["signe_le"] = f?.SigneLe?.ToLocalTime().ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture);
        r["lieu"] = f?.Lieu;
        return r;
    }

    private static IQueryable<FicheSql> FichesSql(LogiBtpContext db, int salarie, long? fiche) => db.Database.SqlQuery<FicheSql>($"""
        SELECT f.dfi_id AS id, f.dfi_sal_id AS salarie, f.dfi_du AS du, f.dfi_au AS au, f.dfi_debut AS debut, f.dfi_fin AS fin, f.dfi_sig_id AS sig_id, f.dfi_dge_id AS dge_id, f.dfi_lieu AS lieu,
               s.sig_nom AS signataire, s.sig_le AS signe_le
        FROM dotation_fiche f LEFT JOIN signature s ON s.sig_id = f.dfi_sig_id
        WHERE f.dfi_sal_id = {salarie} AND ({fiche}::bigint IS NULL OR f.dfi_id = {fiche}::bigint)
        ORDER BY f.dfi_au DESC, f.dfi_id DESC
        """);

    /// <summary>
    /// Source annexe <see cref="SourceAnnexe"/> d'une édition de la fiche salarié : période par les paramètres de la
    /// demande (`du`, `au` ; défaut : les douze derniers mois) ou fiche signée (`fiche`).
    /// </summary>
    public static async Task<JsonNode?> SourceAnnexeAsync(LogiBtpContext db, JsonObject donnees, CancellationToken ct)
    {
        if (donnees["fiche"]?["type"]?.GetValue<string>() != TypesFiche.Salarie || !int.TryParse(donnees["fiche"]?["id"]?.ToString(), out var salarie)) return null;
        var p = donnees["_parametres"] as JsonObject;
        static DateOnly? Date(JsonNode? n) => DateOnly.TryParse(n?.ToString(), CultureInfo.InvariantCulture, out var d) ? d : null;
        long? fiche = long.TryParse(p?["fiche"]?.ToString(), out var x) ? x : null;
        var au = Date(p?["au"]) ?? DateOnly.FromDateTime(DateTime.Today);
        var du = Date(p?["du"]) ?? au.AddMonths(-12);
        return await DonneesAsync(db, salarie, new Periode(du, au), fiche, ct);
    }

    /// <summary>Image PNG d'une data URL (signature tracée) ; refus si ce n'est pas un PNG ou s'il est trop lourd.</summary>
    private static byte[] ImageSignature(string? dataUrl)
    {
        const string prefixe = "data:image/png;base64,";
        if (string.IsNullOrWhiteSpace(dataUrl) || !dataUrl.StartsWith(prefixe, StringComparison.Ordinal))
            throw ExceptionMetier.Invalide("STK_FICHE_SIGNATURE", "Signature du salarié obligatoire (image PNG)");
        byte[] octets;
        try { octets = Convert.FromBase64String(dataUrl[prefixe.Length..]); }
        catch (FormatException) { throw ExceptionMetier.Invalide("STK_FICHE_SIGNATURE", "Signature illisible"); }
        if (octets.Length > SignatureMax || octets.Length < 8 || octets[0] != 0x89 || octets[1] != 0x50)
            throw ExceptionMetier.Invalide("STK_FICHE_SIGNATURE", "Signature : image PNG attendue");
        return octets;
    }

    /// <summary>
    /// Fiche signée : signature et fiche en une transaction, puis PDF (modèle <see cref="Modele"/>) rangé dans la GED du
    /// salarié ; un PDF en échec est rendu en avertissement (la signature reste, la fiche se réimprime).
    /// </summary>
    public static async Task<object> SignerAsync(IServiceProvider services, LogiBtpContext db, int salarie, string lieu, byte[] image, string auteur, CancellationToken ct)
    {
        var periode = await PeriodeASignerAsync(db, salarie, ct);
        var (du, au) = (periode.Du, periode.Au);
        var donnees = await DonneesAsync(db, salarie, periode, null, ct) ?? throw ExceptionMetier.Introuvable("Salarié");
        if (donnees["mouvements"] is not JsonArray { Count: > 0 }) throw ExceptionMetier.Invalide("STK_FICHE_VIDE", "Aucune dotation à signer depuis la dernière fiche");
        var nom = $"{donnees["salarie"]?["prenom"]} {donnees["salarie"]?["nom"]}".Trim();
        long fiche, sig;
        await using (var tx = await db.Unite().CommencerAsync(ct))
        {
            sig = (await db.Database.SqlQuery<long>($"""
                INSERT INTO signature (sig_type_element, sig_id_element, sig_nom, sig_qualite, sig_image, sig_par)
                VALUES ({TypesFiche.Salarie}, {salarie.ToString(CultureInfo.InvariantCulture)}, {nom}, 'Salarié', {image}, {auteur}) RETURNING sig_id AS "Value"
                """).ToListAsync(ct))[0];
            fiche = (await db.Database.SqlQuery<long>($"""
                INSERT INTO dotation_fiche (dfi_sal_id, dfi_du, dfi_au, dfi_debut, dfi_fin, dfi_sig_id, dfi_lieu, dfi_cree_par)
                VALUES ({salarie}, {du}, {au}, {periode.Debut}, {periode.Fin}, {sig}, {lieu}, {auteur}) RETURNING dfi_id AS "Value"
                """).ToListAsync(ct))[0];
            await tx.CommitAsync(ct);
        }
        var avertissements = new List<string>();
        try
        {
            var parametres = new Dictionary<string, JsonElement> { ["fiche"] = JsonSerializer.SerializeToElement(fiche.ToString(CultureInfo.InvariantCulture)) };
            var (pdf, _, _) = await services.GetRequiredService<ServiceEdition>().Pdf(services,
                new DemandeEdition("fiche", $"{TypesFiche.Salarie}/{salarie}", Modele, Parametres: parametres), false, ServeurEditions, ct);
            var empreinte = Convert.ToHexStringLower(SHA256.HashData(pdf.Octets));
            await using var flux = new MemoryStream(pdf.Octets);
            var fichier = new FormFile(flux, 0, pdf.Octets.Length, "fichier", $"fiche-dotation-{salarie}-{au:yyyyMMdd}.pdf")
            {
                Headers = new HeaderDictionary(), ContentType = "application/pdf",
            };
            var d = await services.GetRequiredService<ServiceGed>().DeposerFichier(fichier, new MetaDepot
            {
                Titre = $"Fiche de dotation {nom} du {du:dd/MM/yyyy} au {au:dd/MM/yyyy}", Categorie = Categorie, TypeElement = TypesFiche.Salarie,
                IdElement = salarie.ToString(CultureInfo.InvariantCulture), Auteur = auteur, Resume = $"Signée {(lieu == "BORNE" ? "à la borne" : "au bureau")} ; empreinte SHA-256 {empreinte}",
            }, ServeurEditions, ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE signature SET sig_empreinte = {empreinte}, sig_dge_id = {d.Id} WHERE sig_id = {sig}", ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE dotation_fiche SET dfi_dge_id = {d.Id} WHERE dfi_id = {fiche}", ct);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            services.GetRequiredService<ILoggerFactory>().CreateLogger("Stock").LogError(e, "Fiche de dotation {Fiche} : PDF non rangé", fiche);
            avertissements.Add($"PDF non rangé en GED : {e.Message}");
        }
        return new { fiche, du, au, avertissements };
    }

    public static IEndpointRouteBuilder MapDotationFiche(this IEndpointRouteBuilder api)
    {
        // Bureau : fiches signées d'un salarié (onglet Dotations, page de la fiche).
        api.MapGet("/stock/magasin/dotations/fiches", async (int salarie, LogiBtpContext db, CancellationToken ct) =>
        {
            var l = await FichesSql(db, salarie, null).ToListAsync(ct);
            var p = await PeriodeASignerAsync(db, salarie, ct);
            var d = await DonneesAsync(db, salarie, p, null, ct);
            return Results.Ok(new
            {
                a_signer = new { du = p.Du, au = p.Au, nombre = (d?["mouvements"] as JsonArray)?.Count ?? 0 },
                fiches = l.Select(f => new { f.Id, f.Du, f.Au, f.Lieu, f.Signataire, signe_le = f.SigneLe, f.DgeId }),
            });
        });

        // Borne (publique : X-Borne-Jeton + jeton de saisie du salarié identifié) : dotations à signer, puis signature.
        var b = api.MapGroup("/pointage/borne/stock/fiche");
        b.MapGet("", async (string jeton, HttpContext http, LogiBtpContext db, ServiceBorne borne, CancellationToken ct) =>
        {
            var (s, _, _) = await borne.SalarieIdentifieAsync(http, jeton, ct);
            return await DonneesAsync(db, s, await PeriodeASignerAsync(db, s, ct), null, ct);
        });
        b.MapPost("", async (SignatureBorne x, HttpContext http, LogiBtpContext db, ServiceBorne borne, IServiceProvider services, CancellationToken ct) =>
        {
            var (s, appareil, test) = await borne.SalarieIdentifieAsync(http, x.Jeton, ct);
            var image = ImageSignature(x.Signature);
            if (test) return Results.Ok(new { essai = true });
            var auteur = await ComptesBtp.AuteurBorneAsync(db, s, appareil, ct);
            return Results.Ok(await SignerAsync(services, db, s, "BORNE", image, auteur.Code, ct));
        });
        return api;
    }
}
