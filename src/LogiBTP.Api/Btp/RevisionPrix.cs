using System.Globalization;
using System.Text.Json;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>Mois zéro propre d'une commande du marché (vide : celui du marché).</summary>
public sealed record MoisZeroCommande(long EntId, DateOnly? MoisZero);

/// <summary>Paramètres de révision d'un marché saisis dans la fiche (onglet Révision).</summary>
public sealed record RevisionMarche(string TypePrix, DateOnly? MoisZero, decimal PartieFixe, List<TermeRevision>? Termes, short Decalage, short Precision,
    string Arrondi, DateOnly? DebutTravaux, bool Baisse, List<MoisZeroCommande>? Commandes);

/// <summary>Index du catalogue (raccordements : base ancienne → coefficient).</summary>
public sealed record IndexPrix(int? Id, string Code, string Libelle, string? Base, string? SerieInsee, bool Actif, Dictionary<string, decimal>? Raccordements);

/// <summary>Valeur mensuelle saisie ou importée (mois « AAAA-MM »).</summary>
public sealed record ValeurIndexSaisie(string Index, string Mois, decimal? Valeur, bool Provisoire, string? Base);

/// <summary>Valeurs à enregistrer : simulation = contrôle et bilan sans écriture ; import = source IMPORT.</summary>
public sealed record ValeursIndex(List<ValeurIndexSaisie> Valeurs, bool Simulation, bool Import);

/// <summary>Modèle de formule.</summary>
public sealed record FormuleModele(int? Id, string Libelle, decimal PartieFixe, List<TermeRevision> Termes, short Precision, string Arrondi, bool Actif);

/// <summary>
/// Révision et actualisation des prix des marchés de vente (CONCEPTION-REVISION-PRIX.md, lot G1, db/250) : paramètres du
/// marché, catalogue et valeurs des index, modèles de formules ; sur les factures et avoirs d'avancement du marché, poste
/// de pied HT système « Révision des prix » par commande (marqueur poste_marche = V&lt;commande&gt;, mode C : coefficient
/// sur le total HT de la section, calculé en direct par le moteur) et régularisation des périodes précédentes
/// (VR&lt;commande&gt;, montant : révision due avec les meilleurs index connus − déjà facturée), posés à la création depuis
/// le marché et à la validation ; détail figé dans document_revision. Facture simple de régularisation (Q9) : lignes
/// d'élément VR&lt;commande&gt; recalculées à sa validation. Règle : <see cref="ReglesRevision"/>.
/// </summary>
public static class RevisionPrix
{
    public const string PrefixeRevision = "V";
    public const string PrefixeRegularisation = "VR";

    // ------------------------------------------------------------------ contexte d'un marché

    private sealed record ParametresSql(string TypePrix, DateOnly? MoisZero, decimal PartieFixe, string Termes, short Decalage, short Precision, string Arrondi,
        DateOnly? DebutTravaux, bool Baisse, DateOnly? DebutEffectif, DateOnly? DateMarche, string Sens, bool Saisis);
    private sealed record CommandeSql(long EntId, string? Numero, string? Objet, DateOnly? MoisZero, short Rang);
    private sealed record ValeurSql(string Code, DateOnly Mois, decimal Valeur, bool Provisoire, string? Base);
    private sealed record RaccordementSql(string Code, string Base, decimal Coefficient);
    private sealed record PeriodeSql(long Piece, string? Numero, DateOnly Date, DateOnly Mois, long Commande, decimal Base);
    private sealed record DejaSql(long Piece, long Commande, decimal Montant);
    private sealed record SourceSql(long Id, long Ent);
    private sealed record TvaSql(long Commande, int? Tva);

    /// <summary>Paramètres, séries et commandes d'un marché ; null pour un prix ferme (ou sans paramètres).</summary>
    private sealed record Contexte(RevisionMarche Saisie, ParametresRevision Parametres, Dictionary<string, SerieIndex> Series, List<CommandeSql> Commandes,
        DateOnly? DebutEffectif)
    {
        /// <summary>Paramètres d'une commande : son mois zéro propre, sinon celui du marché.</summary>
        public ParametresRevision Pour(long commande) =>
            Commandes.FirstOrDefault(c => c.EntId == commande)?.MoisZero is DateOnly m ? Parametres with { MoisZero = m } : Parametres;
    }

    private static List<TermeRevision> LireTermes(string json) =>
        JsonSerializer.Deserialize<List<TermeRevision>>(json, JsonCalcul.Options) ?? [];

    /// <summary>Paramètres du marché ; <paramref name="applicables"/> faux (onglet) : proposition du marché de vente lié pour un marché de sous-traitance.</summary>
    private static async Task<(RevisionMarche Saisie, DateOnly? DebutEffectif, DateOnly? DateMarche, string Sens, bool Proposee)> ParametresAsync(DbContext db, int marche,
        CancellationToken ct, bool applicables = true)
    {
        var p = await db.Database.SqlQuery<ParametresSql>($"""
            SELECT coalesce(r.mre_type_prix, 'FERME') AS type_prix, r.mre_mois_zero AS mois_zero, coalesce(r.mre_partie_fixe, 0.15) AS partie_fixe,
                   coalesce(r.mre_termes, '[]')::text AS termes, coalesce(r.mre_decalage, 0)::smallint AS decalage, coalesce(r.mre_precision, 3)::smallint AS precision,
                   coalesce(r.mre_arrondi, 'PROCHE') AS arrondi, r.mre_debut_travaux AS debut_travaux, coalesce(r.mre_baisse, false) AS baisse,
                   coalesce(r.mre_debut_travaux, c.cha_debut_reel, c.cha_debut_prevu) AS debut_effectif, m.mar_date AS date_marche,
                   m.mar_sens AS sens, r.mre_mar_id IS NOT NULL AS saisis
            FROM marche m LEFT JOIN marche_revision r ON r.mre_mar_id = m.mar_id LEFT JOIN chantier c ON c.cha_id = m.mar_cha_id
            WHERE m.mar_id = {marche}
            """).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Marché {marche}");
        // Marché de sous-traitance sans paramètres (lot G3, Q4) : la formule du marché de vente lié est proposée, à
        // enregistrer pour qu'elle s'applique (jamais appliquée aux pièces tant qu'elle n'est que proposée).
        if (p.Sens == "ST" && !p.Saisis && !applicables)
        {
            var v = await db.Database.SqlQuery<ParametresSql>($"""
                SELECT r.mre_type_prix AS type_prix, r.mre_mois_zero AS mois_zero, r.mre_partie_fixe AS partie_fixe, r.mre_termes::text AS termes,
                       r.mre_decalage AS decalage, r.mre_precision AS precision, r.mre_arrondi AS arrondi, NULL::date AS debut_travaux, r.mre_baisse AS baisse,
                       NULL::date AS debut_effectif, NULL::date AS date_marche, 'V' AS sens, true AS saisis
                FROM marche m JOIN marche_revision r ON r.mre_mar_id = m.mar_marche_vente_id WHERE m.mar_id = {marche} AND r.mre_type_prix <> 'FERME'
                """).FirstOrDefaultAsync(ct);
            if (v is not null)
            {
                var proposee = new RevisionMarche(v.TypePrix, null, v.PartieFixe, LireTermes(v.Termes), v.Decalage, v.Precision, v.Arrondi, null, v.Baisse, null);
                return (proposee, p.DebutEffectif, p.DateMarche, p.Sens, true);
            }
        }
        var saisie = new RevisionMarche(p.TypePrix, p.MoisZero, p.PartieFixe, LireTermes(p.Termes), p.Decalage, p.Precision, p.Arrondi, p.DebutTravaux, p.Baisse, null);
        return (saisie, p.DebutEffectif, p.DateMarche, p.Sens, false);
    }

    private static Task<List<CommandeSql>> CommandesAsync(DbContext db, int marche, CancellationToken ct) =>
        db.Database.SqlQuery<CommandeSql>($"""
            SELECT x.mdo_ent_id AS ent_id, c.ent_numero AS numero, c.ent_objet AS objet, x.mdo_mois_zero AS mois_zero, x.mdo_rang AS rang
            FROM marche_document x JOIN document c ON c.ent_id = x.mdo_ent_id
            WHERE x.mdo_mar_id = {marche} ORDER BY x.mdo_rang
            """).ToListAsync(ct);

    /// <summary>Séries des index (valeurs et raccordements), clés insensibles à la casse.</summary>
    public static async Task<Dictionary<string, SerieIndex>> SeriesAsync(DbContext db, IEnumerable<string> codes, CancellationToken ct)
    {
        var liste = codes.Select(c => c.Trim().ToUpperInvariant()).Distinct().ToArray();
        var valeurs = await db.Database.SqlQuery<ValeurSql>($"""
            SELECT p.ipx_code AS code, v.ixv_mois AS mois, v.ixv_valeur AS valeur, v.ixv_provisoire AS provisoire, v.ixv_base AS base
            FROM index_valeur v JOIN index_prix p ON p.ipx_id = v.ixv_ipx_id WHERE upper(p.ipx_code) = ANY({liste})
            """).ToListAsync(ct);
        var raccordements = await db.Database.SqlQuery<RaccordementSql>($"""
            SELECT p.ipx_code AS code, r.ira_base AS base, r.ira_coefficient AS coefficient
            FROM index_raccordement r JOIN index_prix p ON p.ipx_id = r.ira_ipx_id WHERE upper(p.ipx_code) = ANY({liste})
            """).ToListAsync(ct);
        var series = new Dictionary<string, SerieIndex>(StringComparer.OrdinalIgnoreCase);
        foreach (var g in valeurs.GroupBy(v => v.Code, StringComparer.OrdinalIgnoreCase))
        {
            series[g.Key] = new SerieIndex([.. g.Select(v => new ValeurIndex(v.Mois, v.Valeur, v.Provisoire, v.Base))],
                raccordements.Where(r => string.Equals(r.Code, g.Key, StringComparison.OrdinalIgnoreCase)).ToDictionary(r => r.Base, r => r.Coefficient));
        }
        return series;
    }

    private static async Task<Contexte?> ContexteAsync(DbContext db, int marche, CancellationToken ct)
    {
        var (saisie, debut, _, _, _) = await ParametresAsync(db, marche, ct);
        if (saisie.TypePrix == TypesPrix.Ferme) return null;
        var formule = new FormuleRevision(saisie.PartieFixe, saisie.Termes ?? [], saisie.Precision, saisie.Arrondi);
        var parametres = new ParametresRevision(saisie.TypePrix, saisie.MoisZero, formule, saisie.Decalage, debut, saisie.Baisse);
        var series = await SeriesAsync(db, formule.Termes.Select(t => t.Index), ct);
        return new Contexte(saisie, parametres, series, await CommandesAsync(db, marche, ct), debut);
    }

    private static DateOnly MoisPiece(DocumentBtp d) => ReglesRevision.Mois(d.EntMoisRevision ?? d.EntDate);

    // ------------------------------------------------------------------ périodes du marché

    /// <summary>
    /// Périodes révisables du marché : pièces d'avancement (factures et avoirs, présentation P) validées, non annulées, hors
    /// avoirs d'annulation, base HT par commande (lignes vendues reprises d'une ligne de commande, hors composantes).
    /// </summary>
    private static async Task<List<PeriodeSql>> PeriodesAsync(DbContext db, int marche, long? exclure, long? seule, CancellationToken ct)
    {
        var sql = $"""
            SELECT q.ent_id AS piece, q.ent_numero AS numero, q.ent_date AS date,
                   coalesce(q.ent_mois_revision, date_trunc('month', q.ent_date)::date) AS mois, s.lig_ent_id AS commande,
                   sum(coalesce(l.lig_montant_ht, 0)) AS base
            FROM document q JOIN statut_document st ON st.std_id = q.ent_std_id
            JOIN document_ligne l ON l.lig_ent_id = q.ent_id AND l.lig_tyl_id IN ({TL.Ouvrage}, {TL.Element}) AND coalesce(l.lig_type_prix, 'V') = 'V'
            LEFT JOIN document_ligne p ON p.lig_id = l.lig_parent_id
            JOIN document_ligne s ON s.lig_id = l.lig_avt_source_lig_id
            WHERE q.ent_marche_id = @m AND q.ent_avt_presentation = 'P' AND coalesce(q.ent_nature_avoir, '') <> 'ANNULATION'
              AND (p.lig_id IS NULL OR p.lig_tyl_id <> {TL.Ouvrage})
              AND (CASE WHEN @seule::bigint IS NULL THEN q.ent_verrouille AND st.std_code <> 'ANNULE' AND q.ent_id <> coalesce(@x::bigint, 0)
                        ELSE q.ent_id = @seule::bigint END)
            GROUP BY 1, 2, 3, 4, 5
            ORDER BY 4, 3, 1
            """;
        return await db.Database.SqlQueryRaw<PeriodeSql>(sql, new NpgsqlParameter("m", marche), SqlBtp.P("x", exclure, NpgsqlTypes.NpgsqlDbType.Bigint),
            SqlBtp.P("seule", seule, NpgsqlTypes.NpgsqlDbType.Bigint)).ToListAsync(ct);
    }

    /// <summary>Révision déjà facturée par période et commande (pièces validées non annulées, hors la pièce exclue).</summary>
    private static Task<List<DejaSql>> DejaAsync(DbContext db, int marche, long? exclure, CancellationToken ct) =>
        db.Database.SqlQuery<DejaSql>($"""
            SELECT r.dre_periode_ent_id AS piece, r.dre_commande_ent_id AS commande, sum(r.dre_montant) AS montant
            FROM document_revision r JOIN document f ON f.ent_id = r.dre_ent_id JOIN statut_document s ON s.std_id = f.ent_std_id
            WHERE f.ent_marche_id = {marche} AND f.ent_verrouille AND s.std_code <> 'ANNULE' AND f.ent_id <> {exclure ?? 0}
            GROUP BY 1, 2
            """).ToListAsync(ct);

    private sealed record Periode(PeriodeSql Sql, CoefficientRevision Coef, RevisionPeriode Revision, decimal Deja);

    /// <summary>Révision cumulée des périodes validées (hors la pièce exclue), avec les meilleurs index connus.</summary>
    private static async Task<List<Periode>> RegulariserAsync(DbContext db, int marche, Contexte c, long? exclure, CancellationToken ct)
    {
        var periodes = await PeriodesAsync(db, marche, exclure, null, ct);
        var deja = (await DejaAsync(db, marche, exclure, ct)).ToDictionary(x => (x.Piece, x.Commande), x => x.Montant);
        var coefs = periodes.Select(p => ReglesRevision.CoefficientPiece(c.Pour(p.Commande), c.Series, p.Mois)).ToList();
        var calcul = ReglesRevision.Regulariser([.. periodes.Select((p, i) =>
            new PeriodeRevision(i.ToString(CultureInfo.InvariantCulture), p.Base, coefs[i].Coef, deja.GetValueOrDefault((p.Piece, p.Commande))))]);
        return [.. periodes.Select((p, i) => new Periode(p, coefs[i], calcul[i], deja.GetValueOrDefault((p.Piece, p.Commande))))];
    }

    // ------------------------------------------------------------------ lignes des pièces

    private static string? Cle(DocumentLigneBtp l) =>
        l.LigProprietes is { } p && p.RootElement.ValueKind == JsonValueKind.Object && p.RootElement.TryGetProperty(PostesMarche.Marqueur, out var v)
            && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static bool EstRegularisation(string? cle) => cle is not null && cle.StartsWith(PrefixeRegularisation, StringComparison.Ordinal)
        && cle.Length > 2 && cle[2..].All(char.IsDigit);

    private static bool EstRevision(string? cle) => cle is not null && cle.StartsWith(PrefixeRevision, StringComparison.Ordinal)
        && cle.Length > 1 && cle[1..].All(char.IsDigit);

    private static long CommandeDe(string cle) => long.Parse(EstRegularisation(cle) ? cle[2..] : cle[1..], CultureInfo.InvariantCulture);

    private static string Coef(decimal c) => c.ToString("0.######", CultureInfo.GetCultureInfo("fr-FR"));

    /// <summary>Pièce concernée : facture ou avoir d'avancement d'un marché (hors annulation), ou facture simple de régularisation.</summary>
    public static bool Concerne(DocumentCompletBtp d, TypeDocument type) =>
        d.Document.EntMarcheId is not null && d.Document.EntNatureAvoir != "ANNULATION"
        && (d.Document.EntAvtPresentation == "P" || (type.TydCode == TypesDocument.VFacture && d.Lignes.Any(l => EstRegularisation(Cle(l)))));

    /// <summary>
    /// Lignes de révision posées dans la pièce (création depuis le marché, validation) ; vrai si le document a changé.
    /// Pièce d'avancement : un poste V par commande dont le coefficient de la période est connu et différent de 1, un poste
    /// VR par commande dont la régularisation des périodes précédentes n'est pas nulle. Facture simple : montant des lignes
    /// d'élément VR recalculé.
    /// </summary>
    public static async Task<bool> Appliquer(DbContext db, DocumentCompletBtp d, TypeDocument type, CancellationToken ct)
    {
        if (!Concerne(d, type)) return false;
        var marche = d.Document.EntMarcheId!.Value;
        var c = await ContexteAsync(db, marche, ct);
        List<Periode> regul = c is null ? [] : await RegulariserAsync(db, marche, c, d.Document.EntId > 0 ? d.Document.EntId : null, ct);
        var aFacturer = regul.GroupBy(p => p.Sql.Commande).ToDictionary(g => g.Key, g => g.Sum(p => p.Revision.AFacturer));

        if (d.Document.EntAvtPresentation != "P")
        {
            // Facture simple de régularisation : montant à jour de chaque ligne VR.
            var change = false;
            foreach (var l in d.Lignes.Where(l => EstRegularisation(Cle(l))))
            {
                var montant = aFacturer.GetValueOrDefault(CommandeDe(Cle(l)!));
                if (l.LigPv == montant && l.LigQte == 1) continue;
                (l.LigPv, l.LigQte, l.LigPvFixe) = (montant, 1, true);
                change = true;
            }
            return change;
        }

        var avant = d.Lignes.Where(l => EstRevision(Cle(l)) || EstRegularisation(Cle(l)))
            .Select(l => (Cle(l), l.LigParentId, l.LigLibelleHtml, l.LigPiedValeur, l.LigPiedSens)).OrderBy(x => x.Item1).ToList();
        foreach (var l in d.Lignes.Where(l => EstRevision(Cle(l)) || EstRegularisation(Cle(l))).ToList()) d.Lignes.Remove(l);
        if (c is null) return avant.Count > 0;

        // Commande de chaque section : lignes vendues reprises d'une ligne de commande.
        var parents = d.Lignes.ToDictionary(l => l.LigId);
        long? Section(DocumentLigneBtp l)
        {
            var x = l;
            while (x.LigParentId is long p && parents.TryGetValue(p, out var parent)) x = parent;
            return x.LigTylId == TL.Section ? x.LigId : null;
        }
        var nbSections = d.Lignes.Count(l => l.LigParentId is null && l.LigTylId == TL.Section);
        var vendues = d.Lignes.Where(l => l.LigAvtSourceLigId is not null && (l.LigTylId == TL.Ouvrage || l.LigTylId == TL.Element)
            && (l.LigTypePrix ?? "V") == "V").ToList();
        var ids = vendues.Select(l => l.LigAvtSourceLigId!.Value).Distinct().ToArray();
        var sources = ids.Length == 0 ? new Dictionary<long, long>() : (await db.Database.SqlQuery<SourceSql>($"""
            SELECT lig_id AS id, lig_ent_id AS ent FROM document_ligne WHERE lig_id = ANY({ids})
            """).ToListAsync(ct)).ToDictionary(x => x.Id, x => x.Ent);
        var blocs = vendues.Where(l => sources.ContainsKey(l.LigAvtSourceLigId!.Value))
            .GroupBy(l => (Section: nbSections >= 2 ? Section(l) : null, Commande: sources[l.LigAvtSourceLigId!.Value]))
            .Select(g => g.Key).Distinct().ToList();
        // Commandes régularisées sans ligne dans la pièce : pied de la racine (ou de la première section).
        foreach (var cmd in aFacturer.Where(x => x.Value != 0).Select(x => x.Key).Where(k => blocs.All(b => b.Commande != k)))
        {
            blocs.Add((nbSections >= 2 ? d.Lignes.Where(l => l.LigParentId is null && l.LigTylId == TL.Section).OrderBy(l => l.LigOrdre).First().LigId : null, cmd));
        }
        var plusieurs = blocs.Select(b => b.Commande).Distinct().Count() > 1;
        var prochainId = Math.Min(0, d.Lignes.Count == 0 ? 0 : d.Lignes.Min(l => l.LigId)) - 1;
        foreach (var (section, commande) in blocs)
        {
            var numero = plusieurs ? c.Commandes.FirstOrDefault(x => x.EntId == commande)?.Numero : null;
            var suffixe = numero is null ? "" : $" – commande {numero}";
            var cn = ReglesRevision.CoefficientPiece(c.Pour(commande), c.Series, MoisPiece(d.Document));
            if (cn.Coef is decimal k && k != 1)
            {
                var libelle = $"Révision des prix{suffixe} (coefficient {Coef(k)}{(cn.Provisoire ? ", provisoire" : "")})";
                Inserer(d, section, new DocumentLigneBtp
                {
                    LigId = prochainId--, LigEntId = d.Document.EntId, LigTylId = TL.PiedHt, LigLibelleHtml = libelle, LigTypePrix = "V",
                    LigPiedMode = "C", LigPiedBase = "TOTAL_HT", LigPiedSens = 1, LigPiedValeur = k,
                    LigProprietes = JsonSerializer.SerializeToDocument(new Dictionary<string, string> { [PostesMarche.Marqueur] = $"{PrefixeRevision}{commande}" }),
                });
            }
            if (aFacturer.GetValueOrDefault(commande) is var r && r != 0)
            {
                aFacturer[commande] = 0;
                Inserer(d, section, new DocumentLigneBtp
                {
                    LigId = prochainId--, LigEntId = d.Document.EntId, LigTylId = TL.PiedHt, LigLibelleHtml = $"Régularisation de la révision des prix{suffixe}",
                    LigTypePrix = "V", LigPiedMode = "M", LigPiedSens = (short)(r > 0 ? 1 : -1), LigPiedValeur = Math.Abs(r),
                    LigProprietes = JsonSerializer.SerializeToDocument(new Dictionary<string, string> { [PostesMarche.Marqueur] = $"{PrefixeRegularisation}{commande}" }),
                });
            }
        }
        var apres = d.Lignes.Where(l => EstRevision(Cle(l)) || EstRegularisation(Cle(l)))
            .Select(l => (Cle(l), l.LigParentId, l.LigLibelleHtml, l.LigPiedValeur, l.LigPiedSens)).OrderBy(x => x.Item1).ToList();
        return !avant.SequenceEqual(apres);
    }

    /// <summary>Ligne de pied HT placée avant la ligne de TVA de son bloc (section ou racine), sinon à la fin.</summary>
    private static void Inserer(DocumentCompletBtp d, long? section, DocumentLigneBtp l)
    {
        l.LigParentId = section;
        var freres = d.Lignes.Where(x => x.LigParentId == section).OrderBy(x => x.LigOrdre).ToList();
        var tva = freres.FirstOrDefault(x => x.LigTylId == TL.Tva);
        l.LigOrdre = tva?.LigOrdre ?? freres.Select(x => x.LigOrdre).DefaultIfEmpty(0).Max() + 1;
        if (tva is not null) foreach (var x in freres.Where(x => x.LigOrdre >= l.LigOrdre)) x.LigOrdre++;
        d.Lignes.Add(l);
    }

    /// <summary>
    /// Détail de la révision de la pièce validée (Q9) : sa propre période par commande (base, coefficient, révision = poste V)
    /// et les périodes précédentes régularisées (révision due, montant facturé = part de la ligne VR).
    /// </summary>
    public static async Task EcrireAsync(DbContext db, long entId, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM document_revision WHERE dre_ent_id = {entId}", ct);
        var doc = await db.Set<DocumentBtp>().AsNoTracking().FirstAsync(x => x.EntId == entId, ct);
        if (doc.EntMarcheId is not int marche || doc.EntNatureAvoir == "ANNULATION") return;
        var c = await ContexteAsync(db, marche, ct);
        if (c is null) return;
        var lignes = await db.Set<DocumentLigneBtp>().AsNoTracking().Where(l => l.LigEntId == entId && l.LigProprietes != null).ToListAsync(ct);
        var montants = lignes.Select(l => (Cle: Cle(l), l.LigMontantHt)).Where(x => x.Cle is not null).ToList();
        decimal Montant(string cle) => montants.Where(x => x.Cle == cle).Sum(x => x.LigMontantHt ?? 0);
        var lignesRegul = montants.Where(x => EstRegularisation(x.Cle)).Select(x => CommandeDe(x.Cle!)).ToHashSet();

        var rangs = new List<(long Periode, long Commande, DateOnly? MoisIndex, decimal Base, decimal? Coef, bool Provisoire, decimal Revision, decimal Montant)>();
        if (doc.EntAvtPresentation == "P")
        {
            foreach (var p in await PeriodesAsync(db, marche, null, entId, ct))
            {
                var cn = ReglesRevision.CoefficientPiece(c.Pour(p.Commande), c.Series, p.Mois);
                var m = Montant($"{PrefixeRevision}{p.Commande}");
                rangs.Add((entId, p.Commande, cn.MoisIndex, p.Base, cn.Coef, cn.Provisoire, m, m));
            }
        }
        if (lignesRegul.Count > 0)
        {
            foreach (var p in (await RegulariserAsync(db, marche, c, entId, ct)).Where(p => lignesRegul.Contains(p.Sql.Commande) && p.Revision.AFacturer != 0))
            {
                rangs.Add((p.Sql.Piece, p.Sql.Commande, p.Coef.MoisIndex, p.Sql.Base, p.Coef.Coef, p.Coef.Provisoire, p.Revision.Revision, p.Revision.AFacturer));
            }
        }
        foreach (var x in rangs)
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO document_revision (dre_ent_id, dre_periode_ent_id, dre_commande_ent_id, dre_mois_index, dre_base, dre_coef, dre_provisoire, dre_revision, dre_montant)
                VALUES ({entId}, {x.Periode}, {x.Commande}, {x.MoisIndex}, {x.Base}, {x.Coef}, {x.Provisoire}, {x.Revision}, {x.Montant})
                """, ct);
        }
    }

    /// <summary>Nouvelle version d'une pièce (dévalidation) : le détail et les périodes la suivent.</summary>
    public static async Task ReporterVersionAsync(DbContext db, long ancien, long nouveau, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_revision SET dre_ent_id = {nouveau} WHERE dre_ent_id = {ancien}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_revision SET dre_periode_ent_id = {nouveau} WHERE dre_periode_ent_id = {ancien}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_revision SET dre_commande_ent_id = {nouveau} WHERE dre_commande_ent_id = {ancien}", ct);
    }

    // ------------------------------------------------------------------ éditions

    /// <summary>Formule en texte : « 0,15 + 0,85 × BT01 » (coefficient Cn = partie fixe + Σ poids × In / I0).</summary>
    public static string TexteFormule(decimal partieFixe, IEnumerable<TermeRevision> termes)
    {
        var fr = CultureInfo.GetCultureInfo("fr-FR");
        return string.Join(" + ", new[] { partieFixe.ToString("0.######", fr) }.Concat(termes.Select(t => $"{t.Index} × {t.Poids.ToString("0.######", fr)}")));
    }

    /// <summary>
    /// Bloc « revision » des éditions d'une pièce du marché (lots G1, G3) : type de prix, mois zéro, formule et détail figé
    /// à la validation (période de la pièce et périodes régularisées) ; null sans détail (prix ferme, brouillon).
    /// </summary>
    public static async Task<System.Text.Json.Nodes.JsonNode?> EditionAsync(DbContext db, long entId, int marche, CancellationToken ct)
    {
        var periodes = System.Text.Json.Nodes.JsonNode.Parse(await db.Database.SqlQueryRaw<string>("""
            SELECT coalesce(json_agg(json_build_object(
                'piece', p.ent_numero, 'commande', c.ent_numero,
                'mois', to_char(coalesce(p.ent_mois_revision, date_trunc('month', p.ent_date)::date), 'YYYY-MM'),
                'mois_index', to_char(r.dre_mois_index, 'YYYY-MM'), 'base', r.dre_base, 'coef', r.dre_coef, 'provisoire', r.dre_provisoire,
                'revision', r.dre_revision, 'montant', r.dre_montant, 'regularisation', r.dre_periode_ent_id <> r.dre_ent_id)
              ORDER BY r.dre_periode_ent_id <> r.dre_ent_id, coalesce(p.ent_mois_revision, p.ent_date), c.ent_numero), '[]')::text AS "Value"
            FROM document_revision r
            LEFT JOIN document p ON p.ent_id = r.dre_periode_ent_id LEFT JOIN document c ON c.ent_id = r.dre_commande_ent_id
            WHERE r.dre_ent_id = @id
            """, new NpgsqlParameter("id", entId)).FirstAsync(ct))!.AsArray();
        var information = false;
        if (periodes.Count == 0)
        {
            // Situation (non comptable, Q8) : révision pour information, calculée à ce jour.
            if (await SituationAsync(db, entId, marche, ct) is not { } situation) return null;
            (periodes, information) = (situation, true);
        }
        var (p, _, _, _, _) = await ParametresAsync(db, marche, ct);
        return new System.Text.Json.Nodes.JsonObject
        {
            ["type_prix"] = p.TypePrix, ["mois_zero"] = p.MoisZero?.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            ["formule"] = TexteFormule(p.PartieFixe, p.Termes ?? []), ["decalage"] = p.Decalage,
            ["periodes"] = periodes,
            ["information"] = information,
            ["total"] = periodes.Sum(x => x![information ? "revision" : "montant"]!.GetValue<decimal>()),
            ["provisoire"] = periodes.Any(x => x!["provisoire"]!.GetValue<bool>()),
        };
    }

    private sealed record EnteteSql(string? Presentation, DateOnly Mois, string? Numero);
    private sealed record CumulSql(long Commande, decimal Cumul);

    /// <summary>
    /// Révision d'une situation, pour information (Q8) : périodes des factures d'avancement validées du marché (révision
    /// due avec les index connus, à facturer = due − déjà facturée), puis la période de la situation par commande (cumul
    /// situé − déjà facturé) au coefficient du mois de la situation. Null hors situation ou sans révision.
    /// </summary>
    private static async Task<System.Text.Json.Nodes.JsonArray?> SituationAsync(DbContext db, long entId, int marche, CancellationToken ct)
    {
        var e = await db.Database.SqlQuery<EnteteSql>($"""
            SELECT ent_avt_presentation AS presentation, coalesce(ent_mois_revision, date_trunc('month', ent_date)::date) AS mois, ent_numero AS numero
            FROM document WHERE ent_id = {entId}
            """).FirstOrDefaultAsync(ct);
        if (e?.Presentation != "C" || await ContexteAsync(db, marche, ct) is not { } c) return null;
        var periodes = await RegulariserAsync(db, marche, c, null, ct);
        var cumuls = await db.Database.SqlQuery<CumulSql>($"""
            SELECT s.lig_ent_id AS commande, sum(coalesce(l.lig_avt_montant_cumul, 0)) AS cumul
            FROM document_ligne l JOIN document_ligne s ON s.lig_id = l.lig_avt_source_lig_id
            LEFT JOIN document_ligne p ON p.lig_id = l.lig_parent_id
            WHERE l.lig_ent_id = {entId} AND l.lig_tyl_id IN ({TL.Ouvrage}, {TL.Element}) AND coalesce(l.lig_type_prix, 'V') = 'V'
              AND (p.lig_id IS NULL OR p.lig_tyl_id <> {TL.Ouvrage})
            GROUP BY 1
            """).ToListAsync(ct);
        string? Numero(long commande) => c.Commandes.FirstOrDefault(x => x.EntId == commande)?.Numero;
        string? M(DateOnly? m) => m?.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        var res = new System.Text.Json.Nodes.JsonArray();
        foreach (var x in periodes)
        {
            res.Add(new System.Text.Json.Nodes.JsonObject
            {
                ["piece"] = x.Sql.Numero, ["commande"] = Numero(x.Sql.Commande), ["mois"] = M(x.Sql.Mois), ["mois_index"] = M(x.Coef.MoisIndex),
                ["base"] = x.Sql.Base, ["coef"] = x.Coef.Coef, ["provisoire"] = x.Coef.Provisoire, ["revision"] = x.Revision.Revision,
                ["montant"] = x.Revision.AFacturer, ["regularisation"] = false,
            });
        }
        foreach (var k in cumuls)
        {
            var reste = k.Cumul - periodes.Where(x => x.Sql.Commande == k.Commande).Sum(x => x.Sql.Base);
            if (reste == 0) continue;
            var cn = ReglesRevision.CoefficientPiece(c.Pour(k.Commande), c.Series, e.Mois);
            var due = cn.Coef is decimal coef ? ArrondiCalcul.Arrondir(reste * (coef - 1), 2) : 0;
            res.Add(new System.Text.Json.Nodes.JsonObject
            {
                ["piece"] = e.Numero, ["commande"] = Numero(k.Commande), ["mois"] = M(e.Mois), ["mois_index"] = M(cn.MoisIndex),
                ["base"] = reste, ["coef"] = cn.Coef, ["provisoire"] = cn.Provisoire, ["revision"] = due, ["montant"] = due, ["regularisation"] = false,
            });
        }
        return res.Count == 0 ? null : res;
    }

    // ------------------------------------------------------------------ fiche du marché

    /// <summary>
    /// Onglet Révision de la fiche marché : paramètres, début des travaux retenu, commandes et leur mois zéro, périodes
    /// facturées (coefficient avec les index connus, révision due, déjà facturée, à facturer), totaux.
    /// </summary>
    public static async Task<object> LireAsync(DbContext db, int marche, CancellationToken ct)
    {
        var (saisie, debut, dateMarche, sens, proposee) = await ParametresAsync(db, marche, ct, applicables: false);
        var commandes = await CommandesAsync(db, marche, ct);
        var c = await ContexteAsync(db, marche, ct);
        List<Periode> periodes = c is null ? [] : await RegulariserAsync(db, marche, c, null, ct);
        return new
        {
            parametres = saisie with { Commandes = [.. commandes.Select(x => new MoisZeroCommande(x.EntId, x.MoisZero))] },
            debut_effectif = debut,
            sens,
            // Sous-traitance : formule du marché de vente lié proposée (non enregistrée) ; pas de facture simple de régularisation.
            proposee,
            facture_simple = sens != "ST",
            mois_zero_propose = dateMarche is DateOnly dm ? ReglesRevision.Mois(dm) : (DateOnly?)null,
            commandes = commandes.Select(x => new { ent_id = x.EntId, numero = x.Numero, objet = x.Objet, rang = x.Rang, mois_zero = x.MoisZero }),
            periodes = periodes.Select(p => new
            {
                piece = p.Sql.Piece, numero = p.Sql.Numero, date = p.Sql.Date, mois = p.Sql.Mois, commande = p.Sql.Commande,
                commande_numero = commandes.FirstOrDefault(x => x.EntId == p.Sql.Commande)?.Numero, @base = p.Sql.Base,
                mois_index = p.Coef.MoisIndex, coef = p.Coef.Coef, provisoire = p.Coef.Provisoire, manquants = p.Coef.Manquants,
                revision = p.Revision.Revision, deja = p.Deja, a_facturer = p.Revision.AFacturer,
            }),
            totaux = new
            {
                @base = periodes.Sum(p => p.Sql.Base), revision = periodes.Sum(p => p.Revision.Revision), deja = periodes.Sum(p => p.Deja),
                a_facturer = periodes.Sum(p => p.Revision.AFacturer),
            },
        };
    }

    /// <summary>Paramètres du marché enregistrés (formule contrôlée, index du catalogue), mois zéro des commandes.</summary>
    public static async Task<object> EnregistrerAsync(DbContext db, int marche, RevisionMarche r, Utilisateur u, CancellationToken ct)
    {
        if (!TypesPrix.Tous.Contains(r.TypePrix)) throw ExceptionMetier.Invalide("TYPE_PRIX", "Type de prix FERME, ACTUALISABLE ou REVISABLE");
        var termes = (r.Termes ?? []).Select(t => t with { Index = t.Index.Trim() }).ToList();
        if (r.TypePrix != TypesPrix.Ferme)
        {
            var erreurs = ReglesRevision.ControlerFormule(new FormuleRevision(r.PartieFixe, termes, r.Precision, r.Arrondi));
            if (erreurs.Count > 0) throw ExceptionMetier.Invalide(erreurs[0], string.Join(" ; ", erreurs));
            if (r.MoisZero is null) throw ExceptionMetier.Invalide("MOIS_ZERO", "Mois zéro (établissement des prix) obligatoire");
            if (r.Decalage is < 0 or > 12) throw ExceptionMetier.Invalide("DECALAGE", "Décalage de 0 à 12 mois");
            termes = await NormaliserIndexAsync(db, termes, ct);
        }
        var moisZero = r.MoisZero is DateOnly mz ? ReglesRevision.Mois(mz) : (DateOnly?)null;
        var json = JsonSerializer.Serialize(termes, JsonCalcul.Options);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO marche_revision (mre_mar_id, mre_type_prix, mre_mois_zero, mre_partie_fixe, mre_termes, mre_decalage, mre_precision, mre_arrondi,
                                         mre_debut_travaux, mre_baisse, mre_maj_par, mre_maj_le)
            VALUES ({marche}, {r.TypePrix}, {moisZero}, {r.PartieFixe}, {json}::jsonb, {r.Decalage}, {r.Precision}, {r.Arrondi}, {r.DebutTravaux}, {r.Baisse}, {u.Code}, now())
            ON CONFLICT (mre_mar_id) DO UPDATE SET mre_type_prix = EXCLUDED.mre_type_prix, mre_mois_zero = EXCLUDED.mre_mois_zero,
              mre_partie_fixe = EXCLUDED.mre_partie_fixe, mre_termes = EXCLUDED.mre_termes, mre_decalage = EXCLUDED.mre_decalage,
              mre_precision = EXCLUDED.mre_precision, mre_arrondi = EXCLUDED.mre_arrondi, mre_debut_travaux = EXCLUDED.mre_debut_travaux,
              mre_baisse = EXCLUDED.mre_baisse, mre_maj_par = EXCLUDED.mre_maj_par, mre_maj_le = now()
            """, ct);
        foreach (var x in r.Commandes ?? [])
        {
            var m = x.MoisZero is DateOnly v ? ReglesRevision.Mois(v) : (DateOnly?)null;
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE marche_document SET mdo_mois_zero = {m} WHERE mdo_mar_id = {marche} AND mdo_ent_id = {x.EntId}", ct);
        }
        await tx.CommitAsync(ct);
        return await LireAsync(db, marche, ct);
    }

    /// <summary>Index de la formule écrits comme dans le catalogue (BT16b…) ; un index inconnu est refusé.</summary>
    private static async Task<List<TermeRevision>> NormaliserIndexAsync(DbContext db, List<TermeRevision> termes, CancellationToken ct)
    {
        var codes = await db.Database.SqlQuery<string>($"SELECT ipx_code AS \"Value\" FROM index_prix").ToListAsync(ct);
        var inconnus = termes.Where(t => !codes.Contains(t.Index, StringComparer.OrdinalIgnoreCase)).Select(t => t.Index).ToList();
        if (inconnus.Count > 0) throw ExceptionMetier.Invalide("REV_INDEX_INCONNU", $"Index inconnu : {string.Join(", ", inconnus)}");
        return [.. termes.Select(t => t with { Index = codes.First(c => string.Equals(c, t.Index, StringComparison.OrdinalIgnoreCase)) })];
    }

    /// <summary>
    /// Facture simple de régularisation (Q9, option) : une ligne par commande dont la révision des périodes facturées reste
    /// à facturer (positive ou négative), au taux de TVA principal de la commande, nature Prestation ; montants recalculés
    /// à la validation.
    /// </summary>
    public static async Task<DocumentCompletBtp> CreerFactureAsync(LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents,
        int marche, Utilisateur u, CancellationToken ct)
    {
        var c = await ContexteAsync(db, marche, ct) ?? throw ExceptionMetier.Invalide("REV_FERME", "Marché à prix ferme : aucune révision");
        if ((await ParametresAsync(db, marche, ct)).Sens == "ST")
        {
            throw ExceptionMetier.Invalide("REV_SOUS_TRAITANCE", "Marché de sous-traitance : la régularisation passe sur la facture d'avancement suivante");
        }
        var aFacturer = (await RegulariserAsync(db, marche, c, null, ct)).GroupBy(p => p.Sql.Commande)
            .Select(g => (Commande: g.Key, Montant: g.Sum(p => p.Revision.AFacturer))).Where(x => x.Montant != 0).ToList();
        if (aFacturer.Count == 0) throw ExceptionMetier.Invalide("REV_RIEN", "Aucune régularisation de révision à facturer");
        var m = await db.Database.SqlQuery<MarcheSql>($"SELECT mar_code AS code, mar_tiers_id AS tiers, mar_cha_id AS chantier FROM marche WHERE mar_id = {marche}")
            .FirstAsync(ct);
        if (m.Tiers is null) throw ExceptionMetier.Invalide("REV_TIERS", "Client du marché à renseigner");
        var cmds = aFacturer.Select(x => x.Commande).ToArray();
        var tva = (await db.Database.SqlQuery<TvaSql>($"""
            SELECT DISTINCT ON (l.lig_ent_id) l.lig_ent_id AS commande, l.lig_tva_id AS tva
            FROM document_ligne l WHERE l.lig_ent_id = ANY({cmds}) AND l.lig_tva_id IS NOT NULL AND l.lig_tyl_id IN ({TL.Ouvrage}, {TL.Element})
            GROUP BY l.lig_ent_id, l.lig_tva_id ORDER BY l.lig_ent_id, sum(coalesce(l.lig_montant_ht, 0)) DESC
            """).ToListAsync(ct)).ToDictionary(x => x.Commande, x => x.Tva);
        var nature = (await db.Database.SqlQuery<int?>($"SELECT nat_id AS \"Value\" FROM nature_element WHERE nat_code = 'PRE'").ToListAsync(ct)).FirstOrDefault();

        var tyd = await TypesDocumentBtp.IdAsync(db, TypesDocument.VFacture, ct);
        var objet = $"Régularisation de la révision des prix – marché {m.Code}";
        var cree = await documents.Creer(new CreationDocument { EntTydId = tyd, EntTiersId = m.Tiers, EntObjet = objet }, u, ct);
        var d = await documents.Charger(cree.Document.EntId, ct);
        d.Document.EntMarcheId = marche;
        d.Document.EntChantierId = m.Chantier;
        foreach (var l in d.Lignes.Where(l => l.LigParentId is null)) l.LigOrdre += aFacturer.Count;
        for (var i = 0; i < aFacturer.Count; i++)
        {
            var (commande, montant) = aFacturer[i];
            var numero = c.Commandes.FirstOrDefault(x => x.EntId == commande)?.Numero;
            d.Lignes.Add(new DocumentLigneBtp
            {
                LigId = -1 - i, LigEntId = d.Document.EntId, LigOrdre = 1 + i, LigTylId = TL.Element, LigQte = 1, LigPv = montant, LigPvFixe = true,
                LigLibelleHtml = $"Régularisation de la révision des prix{(numero is null ? "" : $" – commande {numero}")}", LigTvaId = tva.GetValueOrDefault(commande),
                LigNatId = nature, LigTypePrix = "V",
                LigProprietes = JsonSerializer.SerializeToDocument(new Dictionary<string, string> { [PostesMarche.Marqueur] = $"{PrefixeRegularisation}{commande}" }),
            });
        }
        if (!d.Lignes.Any(l => l.LigParentId is null && l.LigTylId == TL.Tva))
        {
            var ordre = d.Lignes.Where(l => l.LigParentId is null).Select(l => l.LigOrdre).DefaultIfEmpty(0).Max();
            d.Lignes.Add(new DocumentLigneBtp { LigId = -100, LigEntId = d.Document.EntId, LigOrdre = ordre + 1, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" });
        }
        var r = await documents.Enregistrer(d.Document.EntId, d, u, ct);
        return r.Document ?? d;
    }

    private sealed record MarcheSql(string Code, long? Tiers, int? Chantier);

    // ------------------------------------------------------------------ index et formules (/parametres/revision)

    private const string SqlIndex = """
        SELECT coalesce(json_agg(json_build_object('id', p.ipx_id, 'code', p.ipx_code, 'libelle', p.ipx_libelle, 'base', p.ipx_base,
          'serie_insee', p.ipx_serie_insee, 'actif', p.ipx_actif,
          'raccordements', (SELECT coalesce(json_object_agg(r.ira_base, r.ira_coefficient), '{}') FROM index_raccordement r WHERE r.ira_ipx_id = p.ipx_id),
          'utilise', EXISTS (SELECT 1 FROM marche_revision m WHERE m.mre_type_prix <> 'FERME'
                             AND m.mre_termes @> jsonb_build_array(jsonb_build_object('index', p.ipx_code))))
          ORDER BY p.ipx_code), '[]') AS "Value"
        FROM index_prix p
        """;

    /// <summary>Catalogue des index (index utilisés par une formule de marché marqués).</summary>
    public static Task<IResult> IndexAsync(LogiBtpContext db, CancellationToken ct) => db.JsonAsync(SqlIndex, ct);

    /// <summary>Catalogue enregistré (administrateur) : ajouts, modifications ; un index absent est retiré s'il n'a ni valeur ni usage.</summary>
    public static async Task<IResult> EnregistrerIndexAsync(LogiBtpContext db, List<IndexPrix> index, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        if (index.Any(i => string.IsNullOrWhiteSpace(i.Code) || string.IsNullOrWhiteSpace(i.Libelle))) throw ExceptionMetier.Invalide("INDEX", "Code et libellé obligatoires");
        if (index.GroupBy(i => i.Code.Trim(), StringComparer.OrdinalIgnoreCase).Any(g => g.Count() > 1)) throw ExceptionMetier.Invalide("INDEX", "Code d'index en double");
        if (index.Any(i => i.Raccordements?.Values.Any(v => v <= 0) == true)) throw ExceptionMetier.Invalide("INDEX", "Coefficient de raccordement positif");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var gardes = index.Where(i => i.Id is not null).Select(i => i.Id!.Value).ToArray();
        var retires = await db.Database.SqlQuery<string>($"""
            SELECT p.ipx_code AS "Value" FROM index_prix p WHERE NOT (p.ipx_id = ANY({gardes}))
              AND (EXISTS (SELECT 1 FROM index_valeur v WHERE v.ixv_ipx_id = p.ipx_id)
                   OR EXISTS (SELECT 1 FROM marche_revision m WHERE m.mre_termes @> jsonb_build_array(jsonb_build_object('index', p.ipx_code))))
            """).ToListAsync(ct);
        if (retires.Count > 0) throw ExceptionMetier.Conflit("INDEX_UTILISE", $"Index avec des valeurs ou utilisé par un marché : {string.Join(", ", retires)} (le désactiver)");
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM index_prix WHERE NOT (ipx_id = ANY({gardes}))", ct);
        foreach (var i in index)
        {
            var code = i.Code.Trim();
            var id = i.Id ?? (await db.Database.SqlQuery<int>($"""
                INSERT INTO index_prix (ipx_code, ipx_libelle, ipx_base, ipx_serie_insee, ipx_actif) VALUES ({code}, {i.Libelle.Trim()}, {i.Base}, {i.SerieInsee}, {i.Actif})
                RETURNING ipx_id AS "Value"
                """).ToListAsync(ct))[0];
            if (i.Id is not null)
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE index_prix SET ipx_code = {code}, ipx_libelle = {i.Libelle.Trim()}, ipx_base = {i.Base}, ipx_serie_insee = {i.SerieInsee}, ipx_actif = {i.Actif}
                    WHERE ipx_id = {id}
                    """, ct);
            }
            await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM index_raccordement WHERE ira_ipx_id = {id}", ct);
            foreach (var (b, k) in i.Raccordements ?? [])
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO index_raccordement (ira_ipx_id, ira_base, ira_coefficient) VALUES ({id}, {b.Trim()}, {k})", ct);
            }
        }
        await tx.CommitAsync(ct);
        return await IndexAsync(db, ct);
    }

    /// <summary>Valeurs des index d'une période (mois « AAAA-MM » inclus) : { index, mois, valeur, provisoire, base, source }.</summary>
    public static Task<IResult> ValeursAsync(LogiBtpContext db, string? du, string? au, CancellationToken ct)
    {
        var debut = du is null ? new DateOnly(1900, 1, 1) : ReglesRevision.LireMois(du);
        var fin = au is null ? new DateOnly(9999, 12, 1) : ReglesRevision.LireMois(au);
        return db.JsonAsync("""
            SELECT coalesce(json_agg(json_build_object('index', p.ipx_code, 'mois', to_char(v.ixv_mois, 'YYYY-MM'), 'valeur', v.ixv_valeur,
              'provisoire', v.ixv_provisoire, 'base', v.ixv_base, 'source', v.ixv_source, 'maj_par', v.ixv_maj_par, 'maj_le', v.ixv_maj_le)
              ORDER BY v.ixv_mois DESC, p.ipx_code), '[]') AS "Value"
            FROM index_valeur v JOIN index_prix p ON p.ipx_id = v.ixv_ipx_id
            WHERE v.ixv_mois BETWEEN @du AND @au
            """, ct, new NpgsqlParameter("du", debut), new NpgsqlParameter("au", fin));
    }

    /// <summary>
    /// Valeurs saisies ou importées (CSV index;mois;valeur;état) : contrôle de chaque ligne (index connu, mois, valeur
    /// positive, base raccordée), bilan (créées, modifiées, inchangées, erreurs) ; simulation : rien n'est écrit. Valeur vide :
    /// la valeur du mois est supprimée. Une valeur remplacée reste dans l'historique (trigger).
    /// </summary>
    public static async Task<object> EnregistrerValeursAsync(LogiBtpContext db, ValeursIndex v, Utilisateur u, CancellationToken ct)
    {
        var index = await db.Database.SqlQuery<IndexSql>($"SELECT ipx_id AS id, ipx_code AS code FROM index_prix").ToListAsync(ct);
        var existantes = (await db.Database.SqlQuery<ExistanteSql>($"""
            SELECT ixv_ipx_id AS id, ixv_mois AS mois, ixv_valeur AS valeur, ixv_provisoire AS provisoire, ixv_base AS base FROM index_valeur
            """).ToListAsync(ct)).ToDictionary(x => (x.Id, x.Mois));
        var raccordees = (await db.Database.SqlQuery<RaccordeSql>($"SELECT ira_ipx_id AS id, ira_base AS base FROM index_raccordement").ToListAsync(ct))
            .Select(x => (x.Id, x.Base)).ToHashSet();
        var erreurs = new List<object>();
        var operations = new List<(int Id, DateOnly Mois, ValeurIndexSaisie V, string Etat)>();
        var vus = new HashSet<(int, DateOnly)>();
        for (var n = 0; n < v.Valeurs.Count; n++)
        {
            var x = v.Valeurs[n];
            var ipx = index.FirstOrDefault(i => string.Equals(i.Code, x.Index?.Trim(), StringComparison.OrdinalIgnoreCase));
            DateOnly mois = default;
            string? erreur = ipx is null ? $"index {x.Index} inconnu"
                : !TryMois(x.Mois, out mois) ? $"mois {x.Mois} illisible (AAAA-MM)"
                : x.Valeur is <= 0 ? "valeur positive attendue"
                : !string.IsNullOrWhiteSpace(x.Base) && !raccordees.Contains((ipx.Id, x.Base.Trim())) ? $"base {x.Base} sans raccordement"
                : !vus.Add((ipx.Id, mois)) ? "mois en double" : null;
            if (erreur is not null)
            {
                erreurs.Add(new { ligne = n + 1, index = x.Index, mois = x.Mois, erreur });
                continue;
            }
            var base_ = string.IsNullOrWhiteSpace(x.Base) ? null : x.Base.Trim();
            var etat = existantes.TryGetValue((ipx!.Id, mois), out var e)
                ? x.Valeur is null ? "SUPPRIMEE" : e.Valeur == x.Valeur && e.Provisoire == x.Provisoire && e.Base == base_ ? "INCHANGEE" : "MODIFIEE"
                : x.Valeur is null ? "INCHANGEE" : "CREEE";
            operations.Add((ipx.Id, mois, x with { Base = base_ }, etat));
        }
        var bilan = new
        {
            creees = operations.Count(o => o.Etat == "CREEE"), modifiees = operations.Count(o => o.Etat == "MODIFIEE"),
            supprimees = operations.Count(o => o.Etat == "SUPPRIMEE"), inchangees = operations.Count(o => o.Etat == "INCHANGEE"), erreurs,
            simulation = v.Simulation || erreurs.Count > 0,
        };
        if (v.Simulation || erreurs.Count > 0) return bilan;
        var source = v.Import ? "IMPORT" : "SAISIE";
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        foreach (var (id, mois, x, etat) in operations.Where(o => o.Etat != "INCHANGEE"))
        {
            if (etat == "SUPPRIMEE")
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM index_valeur WHERE ixv_ipx_id = {id} AND ixv_mois = {mois}", ct);
                continue;
            }
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO index_valeur (ixv_ipx_id, ixv_mois, ixv_valeur, ixv_provisoire, ixv_base, ixv_source, ixv_maj_par, ixv_maj_le)
                VALUES ({id}, {mois}, {x.Valeur}, {x.Provisoire}, {x.Base}, {source}, {u.Code}, now())
                ON CONFLICT (ixv_ipx_id, ixv_mois) DO UPDATE SET ixv_valeur = EXCLUDED.ixv_valeur, ixv_provisoire = EXCLUDED.ixv_provisoire,
                  ixv_base = EXCLUDED.ixv_base, ixv_source = EXCLUDED.ixv_source, ixv_maj_par = EXCLUDED.ixv_maj_par, ixv_maj_le = now()
                """, ct);
        }
        await tx.CommitAsync(ct);
        return bilan;
    }

    private static bool TryMois(string? s, out DateOnly mois)
    {
        mois = default;
        if (string.IsNullOrWhiteSpace(s)) return false;
        var t = s.Trim();
        // AAAA-MM ou MM/AAAA (export de l'INSEE).
        if (DateOnly.TryParseExact(t.Length == 7 && t[4] == '-' ? t + "-01" : t, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out mois)
            || DateOnly.TryParseExact("01/" + t, "dd/MM/yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out mois))
        {
            mois = ReglesRevision.Mois(mois);
            return true;
        }
        return false;
    }

    private sealed record IndexSql(int Id, string Code);
    private sealed record ExistanteSql(int Id, DateOnly Mois, decimal Valeur, bool Provisoire, string? Base);
    private sealed record RaccordeSql(int Id, string Base);

    /// <summary>Modèles de formules.</summary>
    public static Task<IResult> FormulesAsync(LogiBtpContext db, CancellationToken ct) => db.JsonAsync("""
        SELECT coalesce(json_agg(json_build_object('id', frv_id, 'libelle', frv_libelle, 'partie_fixe', frv_partie_fixe, 'termes', frv_termes,
          'precision', frv_precision, 'arrondi', frv_arrondi, 'actif', frv_actif) ORDER BY frv_libelle), '[]') AS "Value"
        FROM formule_revision
        """, ct);

    /// <summary>Modèles de formules remplacés (administrateur), chacun contrôlé.</summary>
    public static async Task<IResult> EnregistrerFormulesAsync(LogiBtpContext db, List<FormuleModele> formules, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        var normalisees = new List<(FormuleModele F, string Termes)>();
        foreach (var f in formules)
        {
            if (string.IsNullOrWhiteSpace(f.Libelle)) throw ExceptionMetier.Invalide("FORMULE", "Libellé du modèle obligatoire");
            var erreurs = ReglesRevision.ControlerFormule(new FormuleRevision(f.PartieFixe, f.Termes, f.Precision, f.Arrondi));
            if (erreurs.Count > 0) throw ExceptionMetier.Invalide(erreurs[0], $"{f.Libelle} : {string.Join(" ; ", erreurs)}");
            normalisees.Add((f, JsonSerializer.Serialize(await NormaliserIndexAsync(db, f.Termes, ct), JsonCalcul.Options)));
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var gardes = formules.Where(f => f.Id is not null).Select(f => f.Id!.Value).ToArray();
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM formule_revision WHERE NOT (frv_id = ANY({gardes}))", ct);
        foreach (var (f, termes) in normalisees)
        {
            if (f.Id is int id)
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE formule_revision SET frv_libelle = {f.Libelle.Trim()}, frv_partie_fixe = {f.PartieFixe}, frv_termes = {termes}::jsonb,
                      frv_precision = {f.Precision}, frv_arrondi = {f.Arrondi}, frv_actif = {f.Actif} WHERE frv_id = {id}
                    """, ct);
            }
            else
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO formule_revision (frv_libelle, frv_partie_fixe, frv_termes, frv_precision, frv_arrondi, frv_actif)
                    VALUES ({f.Libelle.Trim()}, {f.PartieFixe}, {termes}::jsonb, {f.Precision}, {f.Arrondi}, {f.Actif})
                    """, ct);
            }
        }
        await tx.CommitAsync(ct);
        return await FormulesAsync(db, ct);
    }
}
