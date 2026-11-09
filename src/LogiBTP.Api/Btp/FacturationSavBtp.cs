using System.Globalization;
using System.Net;
using System.Text.Json;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>Article « Main-d'œuvre SAV » désigné (db/293) : prix par unité de stock, coefficients, TVA, compte et nature.</summary>
public sealed record ArticleMainOeuvreSav(long Id, string Code, string LibelleHtml, int BibId, string BibCode, string Unite, decimal? Pa, decimal CoefFg,
    decimal CoefBenef, decimal? Pv, decimal CoefRemise, int? NatId, string? Compte, string? TvaCode);

/// <summary>Paramètre de la facturation SAV saisi : code de l'article (« CODE » dans la bibliothèque par défaut, « BIB:CODE » sinon), vide = aucun.</summary>
public sealed record ParametresSavSaisis(string? Article);

/// <summary>
/// Plan terrain-suites, lot 22 (TS21 a, TS22 c) : facture brouillon depuis le bon de SAV, au bureau. Le temps de
/// l'intervention (pointages retenus de l'ordre, sinon heures réalisées de ses lignes) est facturé au prix de l'article
/// « Main-d'œuvre SAV » désigné en paramètre (<c>parametre_sav</c>, db/293) ; chaque fourniture des comptes rendus devient
/// une ligne sans prix, à compléter. La facture (V_FACTURE) reste un brouillon, jamais validée ici, liée à l'ordre
/// (<c>document_lien</c> TRANSFORMATION) ; un second clic est refusé tant qu'une facture brouillon de l'ordre existe.
/// Sans article désigné, l'interface masque le bouton avec l'explication. Aucune règle de calcul n'est modifiée : les
/// lignes sont calculées par le moteur à l'enregistrement.
/// </summary>
public static class FacturationSavBtp
{
    private sealed record OrdreAFacturer(long EntId, string TydCode, string? Numero, string? Objet, int? ChantierId, int? AffaireId, long? TiersId,
        string? AdresseLivraison, string? ContactClient);
    private sealed record FactureLiee(long Id, string? Numero, string Statut, bool Verrouille);
    private sealed record ArticleSql(long Id, string Code, string? LibelleHtml, int BibId, string BibCode, string UntStock, decimal? Pa, decimal CoefFg,
        decimal CoefBenef, decimal? Pv, decimal CoefRemise, int? NatId, string? CptCode, string? TvaCode);

    /// <summary>Heures facturées : pointages retenus de l'ordre (minutes), sinon heures réalisées saisies sur ses lignes.</summary>
    public static decimal Heures(long minutesPointees, decimal heuresRealisees) =>
        minutesPointees > 0 ? ArrondiCalcul.Arrondir(minutesPointees / 60m, 2) : heuresRealisees;

    /// <summary>Refus d'une seconde facture tant qu'une facture brouillon de l'ordre existe.</summary>
    public static void ExigerSansBrouillon(string? brouillon)
    {
        if (brouillon is not null) throw ExceptionMetier.Conflit("SAV_FACTURE_BROUILLON", $"Une facture brouillon de cette intervention existe déjà ({brouillon})");
    }

    /// <summary>Code d'appel de l'article : « CODE » dans la bibliothèque du document, « BIB:CODE » sinon (comme l'appel de la bibliothèque).</summary>
    public static string CodeAppel(ArticleMainOeuvreSav a, int? bibDocument) => a.BibId == bibDocument ? a.Code : $"{a.BibCode}:{a.Code}";

    /// <summary>
    /// Lignes de prix de la facture : le temps (article « Main-d'œuvre SAV », quantité en heures, prix de l'article imposé),
    /// puis une ligne par fourniture du bon (libellé seul, prix à compléter au bureau). Ordre à partir de <paramref name="premier"/>.
    /// </summary>
    public static List<DocumentLigneBtp> LignesFacture(long ent, int premier, int? bibDocument, ArticleMainOeuvreSav a, decimal heures,
        IReadOnlyList<string> fournitures, int? tvaArticle, int? tvaDefaut)
    {
        var tva = tvaArticle ?? tvaDefaut;
        var lignes = new List<DocumentLigneBtp>
        {
            new()
            {
                LigId = -premier, LigEntId = ent, LigOrdre = premier, LigTylId = TL.Element, LigArtId = a.Id, LigCode = CodeAppel(a, bibDocument),
                LigLibelleHtml = a.LibelleHtml, LigQte = heures, LigUntCode = a.Unite, LigPa = a.Pa, LigCoefFg = a.CoefFg, LigCoefBenef = a.CoefBenef,
                LigPvFixe = a.Pv is not null, LigPv = a.Pv, LigCoefRemise = a.CoefRemise, LigNatId = a.NatId, LigCptCode = a.Compte, LigTvaId = tva, LigTypePrix = "V",
                LigProprietes = JsonSerializer.SerializeToDocument(new { element = new { id = a.Id, bib = a.BibCode, code = a.Code, type = "ARTICLE" } }),
            },
        };
        var i = premier;
        foreach (var f in fournitures.Select(x => x.Trim()).Where(x => x.Length > 0))
        {
            i++;
            lignes.Add(new DocumentLigneBtp
            {
                LigId = -i, LigEntId = ent, LigOrdre = i, LigTylId = TL.Element, LigLibelleHtml = WebUtility.HtmlEncode(f), LigQte = 1, LigTvaId = tva, LigTypePrix = "V",
            });
        }
        return lignes;
    }

    private static async Task<ArticleSql?> ArticleAsync(LogiBtpContext db, string condition, NpgsqlParameter[] p, CancellationToken ct) =>
        await db.Database.SqlQueryRaw<ArticleSql>($"""
            SELECT e.ele_id AS id, e.ele_code AS code, e.ele_libelle_html AS libelle_html, e.ele_bib_id AS bib_id, b.bib_code, e.ele_unt_stock AS unt_stock,
                   e.ele_pa AS pa, e.ele_coef_fg AS coef_fg, e.ele_coef_benef AS coef_benef, e.ele_pv AS pv, e.ele_coef_remise AS coef_remise,
                   e.ele_nat_id AS nat_id, e.ele_cpt_code AS cpt_code, e.ele_tva_code AS tva_code
            FROM element e JOIN bibliotheque b ON b.bib_id = e.ele_bib_id
            WHERE e.ele_actif AND e.ele_type = 'ARTICLE' AND {condition}
            ORDER BY b.bib_defaut DESC, e.ele_id LIMIT 1
            """, p).FirstOrDefaultAsync(ct);

    /// <summary>Article désigné en paramètre (null : aucun, ou plus actif).</summary>
    private static async Task<ArticleMainOeuvreSav?> ArticleParametreAsync(LogiBtpContext db, CancellationToken ct)
    {
        var a = await ArticleAsync(db, "e.ele_id = (SELECT psa_ele_mo_id FROM parametre_sav WHERE psa_id = 1)", [], ct);
        return a is null ? null : new ArticleMainOeuvreSav(a.Id, a.Code, string.IsNullOrWhiteSpace(a.LibelleHtml) ? WebUtility.HtmlEncode(a.Code) : a.LibelleHtml,
            a.BibId, a.BibCode, a.UntStock, a.Pa, a.CoefFg, a.CoefBenef, a.Pv, a.CoefRemise, a.NatId, a.CptCode, a.TvaCode);
    }

    private static object? ArticleLu(ArticleMainOeuvreSav? a) => a is null ? null : new { id = a.Id, code = a.Code, bib = a.BibCode, libelle = a.LibelleHtml, unite = a.Unite, pv = a.Pv };

    private static async Task<OrdreAFacturer> OrdreAsync(LogiBtpContext db, long ent, CancellationToken ct)
    {
        var o = await db.Database.SqlQueryRaw<OrdreAFacturer>("""
            SELECT d.ent_id, t.tyd_code, d.ent_numero AS numero, d.ent_objet AS objet, d.ent_chantier_id AS chantier_id, d.ent_affaire_id AS affaire_id,
                   coalesce(d.ent_tiers_id, c.cha_tiers_id) AS tiers_id, d.ent_adresse_livraison::text AS adresse_livraison, d.ent_contact_client::text AS contact_client
            FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id LEFT JOIN chantier c ON c.cha_id = d.ent_chantier_id WHERE d.ent_id = @e
            """, new NpgsqlParameter("e", ent)).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Document {ent}");
        if (o.TydCode != TypesDocument.ESav) throw ExceptionMetier.Invalide("TERRAIN_SAV_TYPE", "Cet ordre n'est pas une intervention SAV");
        return o;
    }

    /// <summary>Factures liées à l'ordre (non annulées), la plus récente d'abord.</summary>
    private static Task<List<FactureLiee>> FacturesAsync(LogiBtpContext db, long ent, CancellationToken ct) =>
        db.Database.SqlQueryRaw<FactureLiee>("""
            SELECT f.ent_id AS id, f.ent_numero AS numero, s.std_code AS statut, f.ent_verrouille AS verrouille
            FROM document_lien k JOIN document f ON f.ent_id = k.lie_cible_ent_id JOIN type_document t ON t.tyd_id = f.ent_tyd_id
            JOIN statut_document s ON s.std_id = f.ent_std_id
            WHERE k.lie_source_ent_id = @e AND k.lie_type = 'TRANSFORMATION' AND t.tyd_code = @t AND s.std_code <> 'ANNULE'
            ORDER BY f.ent_id DESC
            """, new NpgsqlParameter("e", ent), new NpgsqlParameter("t", TypesDocument.VFacture)).ToListAsync(ct);

    private static string? Brouillon(List<FactureLiee> factures) =>
        factures.FirstOrDefault(f => !f.Verrouille) is { } b ? b.Numero ?? b.Id.ToString(CultureInfo.InvariantCulture) : null;

    private static async Task<(decimal Heures, List<string> Fournitures)> BonAsync(LogiBtpContext db, long ent, CancellationToken ct)
    {
        var minutes = await db.Database.SqlQueryRaw<long>("SELECT coalesce(sum(minutes), 0)::bigint AS \"Value\" FROM v_cout_mo_chantier WHERE ordre_id = @e",
            new NpgsqlParameter("e", ent)).FirstAsync(ct);
        var realisees = await db.Database.SqlQueryRaw<decimal>("""
            SELECT coalesce(sum(lig_heures_realisees), 0) AS "Value" FROM document_ligne WHERE lig_ent_id = @e
            """, new NpgsqlParameter("e", ent)).FirstAsync(ct);
        var fournitures = await db.Database.SqlQueryRaw<string>("""
            SELECT f.valeur AS "Value" FROM intervention_sav i CROSS JOIN LATERAL jsonb_array_elements_text(i.isv_fournitures) WITH ORDINALITY AS f(valeur, rang)
            WHERE i.isv_ent_id = @e ORDER BY i.isv_id, f.rang
            """, new NpgsqlParameter("e", ent)).ToListAsync(ct);
        return (Heures(minutes, realisees), fournitures);
    }

    public static RouteGroupBuilder MapFacturationSav(this RouteGroupBuilder g)
    {
        // Paramètre : article « Main-d'œuvre SAV » (page Paramètres › Exécution).
        g.MapGet("/sav-parametres", async (LogiBtpContext db, CancellationToken ct) => new { article = ArticleLu(await ArticleParametreAsync(db, ct)) });
        g.MapPut("/sav-parametres", async (ParametresSavSaisis p, HttpContext http, LogiBtpContext db, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            u.ExigerParametres();
            long? id = null;
            var saisi = (p.Article ?? "").Trim();
            if (saisi.Length > 0)
            {
                var deux = saisi.Split(':', 2);
                var a = deux.Length == 2
                    ? await ArticleAsync(db, "b.bib_code = @b AND e.ele_code = @c", [new NpgsqlParameter("b", deux[0].Trim()), new NpgsqlParameter("c", deux[1].Trim())], ct)
                    : await ArticleAsync(db, "e.ele_code = @c", [new NpgsqlParameter("c", saisi)], ct);
                id = (a ?? throw ExceptionMetier.Invalide("SAV_ARTICLE", $"Article {saisi} introuvable (article actif de la bibliothèque)")).Id;
            }
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO parametre_sav (psa_id, psa_ele_mo_id, psa_maj_par, psa_maj_le) VALUES (1, @a, @u, now())
                ON CONFLICT (psa_id) DO UPDATE SET psa_ele_mo_id = EXCLUDED.psa_ele_mo_id, psa_maj_par = EXCLUDED.psa_maj_par, psa_maj_le = now()
                """, [SqlBtp.P("a", id, NpgsqlTypes.NpgsqlDbType.Bigint), new NpgsqlParameter("u", u.Code)], ct);
            return new { article = ArticleLu(await ArticleParametreAsync(db, ct)) };
        });

        // État de la facturation d'une intervention : article, temps et fournitures du bon, factures liées.
        g.MapGet("/documents/{id:long}/facturation-sav", async (long id, LogiBtpContext db, CancellationToken ct) =>
        {
            await OrdreAsync(db, id, ct);
            var (heures, fournitures) = await BonAsync(db, id, ct);
            var factures = await FacturesAsync(db, id, ct);
            return new
            {
                article = ArticleLu(await ArticleParametreAsync(db, ct)), heures, fournitures,
                factures = factures.Select(f => new { id = f.Id, numero = f.Numero, statut = f.Statut, brouillon = !f.Verrouille }),
                brouillon = Brouillon(factures) is not null,
            };
        });

        // Facture brouillon préremplie (jamais validée ici).
        g.MapPost("/documents/{id:long}/facturation-sav", async (long id, HttpContext http, LogiBtpContext db,
            DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, CancellationToken ct) =>
        {
            var u = Utilisateur.Depuis(http);
            var o = await OrdreAsync(db, id, ct);
            var article = await ArticleParametreAsync(db, ct)
                ?? throw ExceptionMetier.Invalide("SAV_ARTICLE", "Aucun article « Main-d'œuvre SAV » désigné dans les paramètres de l'Exécution");
            ExigerSansBrouillon(Brouillon(await FacturesAsync(db, id, ct)));
            if (o.TiersId is not long tiers) throw ExceptionMetier.Invalide("SAV_CLIENT", "Client de l'intervention inconnu (chantier sans client)");
            var (heures, fournitures) = await BonAsync(db, id, ct);
            var objet = $"Intervention {o.Numero}{(string.IsNullOrWhiteSpace(o.Objet) ? "" : $" – {o.Objet.Trim()}")}";

            var cree = await documents.Creer(new CreationDocument
            {
                EntTydId = await TypesDocumentBtp.IdAsync(db, TypesDocument.VFacture, ct), EntTiersId = tiers, EntObjet = objet.Length > 200 ? objet[..200] : objet,
            }, u, ct);
            var factureId = cree.Document.EntId;
            var c = await documents.Charger(factureId, ct);
            c.Document.EntChantierId = o.ChantierId;
            c.Document.EntAffaireId = o.AffaireId;
            if (o.AdresseLivraison is string adr) c.Document.EntAdresseLivraison ??= JsonDocument.Parse(adr);
            if (o.ContactClient is string contact) c.Document.EntContactClient ??= JsonDocument.Parse(contact);
            var tvaArticle = article.TvaCode is { Length: > 0 } code
                ? await db.TauxTva.Where(t => t.TtvCode == code && t.TtvActif).Select(t => (int?)t.TtvId).FirstOrDefaultAsync(ct) : null;
            var tvaDefaut = await db.TauxTva.Where(t => t.TtvCategorie == "N" && t.TtvActif).OrderByDescending(t => t.TtvDefaut).ThenByDescending(t => t.TtvTaux)
                .Select(t => (int?)t.TtvId).FirstOrDefaultAsync(ct);
            var lignes = LignesFacture(factureId, 1, c.Document.EntBibId, article, heures, fournitures, tvaArticle, tvaDefaut);
            foreach (var x in c.Lignes.Where(x => x.LigParentId is null)) x.LigOrdre += lignes.Count;
            c.Lignes.AddRange(lignes);
            if (!c.Lignes.Any(l => l.LigParentId is null && l.LigTylId == TL.Tva))
                c.Lignes.Add(new DocumentLigneBtp { LigId = -1000, LigEntId = factureId, LigOrdre = c.Lignes.Where(l => l.LigParentId is null).Max(l => l.LigOrdre) + 1, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" });
            await documents.Enregistrer(factureId, c, u, ct);
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO document_lien (lie_source_ent_id, lie_cible_ent_id, lie_type) VALUES (@o, @f, 'TRANSFORMATION') ON CONFLICT DO NOTHING
                """, [new NpgsqlParameter("o", id), new NpgsqlParameter("f", factureId)], ct);
            var numero = await db.Database.SqlQueryRaw<string?>("SELECT ent_numero AS \"Value\" FROM document WHERE ent_id = @e", new NpgsqlParameter("e", factureId)).FirstAsync(ct);
            return new { ent_id = factureId, numero, lignes = lignes.Count, heures };
        });
        return g;
    }
}
