using System.Text.Json;
using LogiBTP.Api.Btp;
using LogiBTP.Api.Reprise.Mde;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Documents;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Reglements.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Reprise;

/// <summary>Pièce comptable reprise (facture, avoir des ventes ou des achats, validée, non annulée, avec tiers).</summary>
public sealed record PieceReglee(long EntId, long TiersId, bool Achat, decimal Net, DateOnly Date, string? Mode, string? Condition, int Signe,
    short Precision, int? MarcheId, string? Numero);

/// <summary>Échéance de la source : montant positif (le signe de l'avoir est porté par la pièce), retenue sans date.</summary>
public sealed record EcheanceReprise((string Table, string Cle) Origine, DateOnly? Date, decimal Montant, string? Mode, bool Retenue);

/// <summary>
/// Échéanciers, règlements, lettrage et cautions repris (plan reprise-mde-optim, lot 13) : les domaines MDE et OPTIM
/// rattachent les échéances de la source aux pièces comptables reprises, puis <see cref="EcrireEcheancesAsync"/> écrit
/// l'échéancier de chaque pièce (celui de la source, sinon calculé comme à la validation : condition figée, net à payer
/// moins la retenue de garantie, retenue en échéance RETENUE sans date) ; règlements (E ventes, D achats) et pointages
/// ensuite, plafonnés au reste de chaque échéance (l'excédent reste non pointé : trop-perçu) ; état de paiement et statut
/// des pièces recalculés comme après un pointage (<see cref="SpecialisationReglementBtp.ApresPointageAsync"/>). Sans le
/// module Règlements dans la base : échéanciers seuls, règlements et cautions signalés non repris.
/// </summary>
public sealed class ReglementsReprise : IAsyncDisposable
{
    public const string TableEcheance = "document_echeance";
    public const string NatureNormale = "NORMALE";
    public const string NatureRetenue = "RETENUE";
    public const string SensEncaissement = "E";
    public const string SensDecaissement = "D";
    public const string ObjetMarche = "marche";

    /// <summary>Pièces comptables de la base : seules elles reçoivent un échéancier (comme à la validation).</summary>
    private const string SqlPieces = """
        SELECT d.ent_id, d.ent_tiers_id, f_famille_achat(t.tyd_famille), coalesce(d.ent_net_a_payer, 0), d.ent_date, d.ent_mode_reglement,
               d.ent_cpa_code, f_signe_reglement(d.ent_id), d.ent_precision_montant, d.ent_marche_id, d.ent_numero
        FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id
        WHERE d.ent_tiers_id IS NOT NULL AND (t.tyd_famille = 'V' OR f_famille_achat(t.tyd_famille))
          AND coalesce(f_regle_document('PIECE_COMPTABLE', t.tyd_id) = 'true'::jsonb, false)
          AND f_document_valable(d.ent_id, FALSE)
        """;

    private readonly ContexteReprise ctx;
    private readonly Dictionary<long, PieceReglee> pieces;
    private readonly Dictionary<string, List<LigneCondition>> conditions;
    private readonly string? modeDefaut;
    private readonly Dictionary<long, List<EcheanceReprise>> source = [];
    private readonly Dictionary<long, decimal> retenues = [];
    private readonly Dictionary<(string Table, string Cle), long> parOrigine = [];
    private readonly Dictionary<long, List<(long Id, decimal Montant, bool Retenue)>> echeances = [];
    private readonly Dictionary<long, decimal> pointe = [];
    private readonly HashSet<long> touchees = [];

    private ReglementsReprise(ContexteReprise ctx, bool module, Dictionary<long, PieceReglee> pieces, Dictionary<string, List<LigneCondition>> conditions,
        string? modeDefaut)
    {
        this.ctx = ctx;
        Module = module;
        this.pieces = pieces;
        this.conditions = conditions;
        this.modeDefaut = modeDefaut;
    }

    /// <summary>Module Règlements présent dans la base (tables reglement, pointage, caution).</summary>
    public bool Module { get; }

    public static async Task<ReglementsReprise> OuvrirAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var module = await SqlReprise.ScalaireAsync(ctx.Unite, "SELECT to_regclass('reglement') IS NOT NULL", ct) is true;
        var pieces = (await SqlReprise.LireAsync(ctx.Unite, SqlPieces, r => new PieceReglee(r.GetInt64(0), r.GetInt64(1), r.GetBoolean(2), r.GetDecimal(3),
                DateOnly.FromDateTime(r.GetDateTime(4)), r.IsDBNull(5) ? null : r.GetString(5), r.IsDBNull(6) ? null : r.GetString(6), r.GetInt32(7),
                r.GetInt16(8), r.IsDBNull(9) ? null : r.GetInt32(9), r.IsDBNull(10) ? null : r.GetString(10)), ct))
            .ToDictionary(p => p.EntId);
        var conditions = (await SqlReprise.LireAsync(ctx.Unite, "SELECT cpa_code, cpa_lignes::text FROM condition_paiement",
                r => (Code: r.GetString(0), Lignes: JsonSerializer.Deserialize<List<LigneCondition>>(r.GetString(1), JsonCalcul.Options) ?? []), ct))
            .ToDictionary(c => c.Code, c => c.Lignes, StringComparer.Ordinal);
        var mode = (string?)await SqlReprise.ScalaireAsync(ctx.Unite,
            "SELECT mre_code FROM mode_reglement WHERE mre_actif ORDER BY mre_ordre, mre_code LIMIT 1", ct);
        return new ReglementsReprise(ctx, module, pieces, conditions, mode);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    /// <summary>Pièce comptable reprise d'une ligne source (registre), null si elle n'est pas reprise ou pas comptable.</summary>
    public PieceReglee? Piece(string table, string? cle) =>
        ctx.Registre.Trouver(table, cle) is long id && pieces.TryGetValue(id, out var p) ? p : null;

    public void AjouterEcheance(PieceReglee p, EcheanceReprise e)
    {
        if (!source.TryGetValue(p.EntId, out var l)) source[p.EntId] = l = [];
        l.Add(e);
    }

    /// <summary>Retenue de garantie de la source (échéancier calculé seulement : celui de la source porte déjà la sienne).</summary>
    public void AjouterRetenue(PieceReglee p, decimal montant) => retenues[p.EntId] = retenues.GetValueOrDefault(p.EntId) + Math.Abs(montant);

    /// <summary>Échéancier de chaque pièce comptable : celui de la source, sinon calculé.</summary>
    public async Task EcrireEcheancesAsync(CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(TableEcheance);
        foreach (var p in pieces.Values.OrderBy(p => p.EntId))
        {
            List<(EcheanceReprise? Source, DateOnly? Date, decimal Montant, string? Mode, string Nature)> lignes;
            if (source.TryGetValue(p.EntId, out var s) && s.Count > 0)
            {
                lignes = [.. s.Where(e => !e.Retenue).Concat(s.Where(e => e.Retenue))
                    .Select(e => ((EcheanceReprise?)e, e.Retenue ? (DateOnly?)null : e.Date ?? p.Date, Math.Abs(e.Montant), e.Mode ?? p.Mode, e.Retenue ? NatureRetenue : NatureNormale))];
                var total = lignes.Sum(l => l.Montant);
                if (Math.Abs(total - Math.Abs(p.Net)) >= 0.01m)
                    ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.EcheancierEcart, $"{TableDocument} {p.Numero ?? p.EntId.ToString()}",
                        $"Échéancier de la source de {total:0.00} pour un net à payer de {Math.Abs(p.Net):0.00} (acompte déduit, paiement direct…) : échéances de la source gardées");
            }
            else
            {
                var retenue = Math.Min(retenues.GetValueOrDefault(p.EntId), Math.Abs(p.Net));
                lignes = [.. Echeances.Calculer(p.Date, Math.Abs(p.Net) - retenue, p.Condition is { } c ? conditions.GetValueOrDefault(c) ?? [] : [], retenue,
                        p.Mode, p.Precision)
                    .Select(e => ((EcheanceReprise?)null, e.Date, e.Montant, e.Mode, e.Nature))];
            }
            var ecrites = echeances[p.EntId] = [];
            short rang = 0;
            foreach (var l in lignes.Where(l => l.Montant != 0))
            {
                var id = (long)(await SqlReprise.ScalaireAsync(ctx.Unite, """
                    INSERT INTO document_echeance (ech_ent_id, ech_rang, ech_date, ech_montant, ech_mode, ech_nature, ech_manuel)
                    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ech_id
                    """, ct, p.EntId, ++rang, l.Date, l.Montant, l.Mode, l.Nature, l.Source is not null))!;
                ecrites.Add((id, l.Montant, l.Nature == NatureRetenue));
                if (l.Source is { } o) parOrigine[o.Origine] = id;
                volume.Ecrites++;
            }
        }
    }

    private const string TableDocument = PiecesReprise.TableDocument;

    /// <summary>Échéance écrite d'une échéance de la source.</summary>
    public long? Echeance(string table, string? cle) => cle is not null && parOrigine.TryGetValue((table, cle.TrimEnd()), out var id) ? id : null;

    private (long Ent, decimal Montant)? Lire(long ech) =>
        echeances.SelectMany(x => x.Value.Select(e => (Ent: x.Key, e.Id, e.Montant))).Where(e => e.Id == ech).Select(e => ((long, decimal)?)(e.Ent, e.Montant)).FirstOrDefault();

    /// <summary>Part pointable d'un montant (positif) sur une échéance : plafonnée à son reste, notée comme pointée.</summary>
    public decimal Pointer(long ech, decimal montant)
    {
        if (Lire(ech) is not { } e) return 0;
        var part = Math.Min(Math.Abs(montant), Math.Max(0, e.Montant - pointe.GetValueOrDefault(ech)));
        pointe[ech] = pointe.GetValueOrDefault(ech) + part;
        return part;
    }

    /// <summary>
    /// Montant réglé sans échéance désignée : réparti sur les échéances ouvertes de la pièce, dans l'ordre (retenues en
    /// dernier, ou seules si <paramref name="retenue"/>).
    /// </summary>
    public List<(long Ech, decimal Montant)> Repartir(PieceReglee p, decimal montant, bool retenue = false)
    {
        var res = new List<(long, decimal)>();
        var reste = Math.Abs(montant);
        foreach (var e in (echeances.GetValueOrDefault(p.EntId) ?? []).Where(e => !retenue || e.Retenue).OrderBy(e => e.Retenue))
        {
            if (reste <= 0) break;
            var part = Pointer(e.Id, reste);
            if (part > 0) res.Add((e.Id, part));
            reste -= part;
        }
        return res;
    }

    /// <summary>
    /// Règlement d'un tiers : pointages positifs (déjà plafonnés par <see cref="Pointer"/> ou <see cref="Repartir"/>),
    /// signés comme l'échéance (avoir négatif) ; montant = pointages signés + trop-perçu non pointé.
    /// </summary>
    public async Task ReglerAsync(PieceReglee p, DateOnly date, string? mode, string? reference, string? commentaire,
        IReadOnlyList<(long Ech, decimal Montant)> pointages, decimal tropPercu, string emplacement, CancellationToken ct)
    {
        var lignes = pointages.Where(x => x.Montant != 0).Select(x => (x.Ech, Montant: x.Montant * pieces[Lire(x.Ech)!.Value.Ent].Signe)).ToList();
        var montant = lignes.Sum(x => x.Montant) + tropPercu;
        if (montant == 0 && lignes.Count == 0) return;
        if (!Module)
        {
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.SansEquivalent, emplacement, "Module Règlements absent de la base : règlement non repris");
            return;
        }
        if (tropPercu != 0)
            ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.PointageExcedent, emplacement,
                $"{tropPercu:0.00} réglés au-delà du reste des échéances reprises : gardés non pointés (trop-perçu)");
        var reg = (long)(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO reglement (reg_tiers_id, reg_sens, reg_date, reg_mode, reg_montant, reg_reference, reg_commentaire, reg_cree_par)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING reg_id
            """, ct, p.TiersId, p.Achat ? SensDecaissement : SensEncaissement, date, mode ?? p.Mode ?? modeDefaut ?? "", montant,
            AnnuaireReprise.Couper(reference, 100), commentaire, ctx.Options.Auteur ?? "reprise"))!;
        foreach (var (ech, m) in lignes)
        {
            await SqlReprise.ExecuterAsync(ctx.Unite, "INSERT INTO pointage (poi_reg_id, poi_echeance_id, poi_montant) VALUES ($1, $2, $3)", ct, reg, ech, m);
            touchees.Add(ech);
        }
        ctx.Rapport.Volume("reglement").Ecrites++;
    }

    /// <summary>Caution (remplace la retenue de garantie) : rattachée au marché de la pièce s'il y en a un.</summary>
    public async Task CautionAsync(PieceReglee p, string organisme, decimal montant, DateOnly date, DateOnly? fin, string? reference, DateOnly? mainlevee,
        string emplacement, CancellationToken ct)
    {
        if (!Module)
        {
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.SansEquivalent, emplacement, "Module Règlements absent de la base : caution non reprise");
            return;
        }
        await SqlReprise.ExecuterAsync(ctx.Unite, """
            INSERT INTO caution (cau_tiers_id, cau_objet, cau_objet_id, cau_organisme, cau_montant, cau_date, cau_date_fin, cau_reference, cau_mainlevee)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """, ct, p.TiersId, p.MarcheId is null ? null : ObjetMarche, (long?)p.MarcheId, AnnuaireReprise.Couper(organisme, 150), Math.Abs(montant), date,
            fin, AnnuaireReprise.Couper(reference, 100), mainlevee);
        ctx.Rapport.Volume("caution").Ecrites++;
    }

    /// <summary>État de paiement et statut des pièces pointées, comme après un pointage saisi.</summary>
    public async Task TerminerAsync(CancellationToken ct)
    {
        if (!Module || touchees.Count == 0) return;
        var options = new DbContextOptionsBuilder<ReglementDbContext>().UseNpgsql(ctx.Unite.Connexion).UseSnakeCaseNamingConvention().Options;
        await using var db = new ReglementDbContext(options);
        if (ctx.Unite.Transaction is { } tx) await db.Database.UseTransactionAsync(tx, ct);
        await new SpecialisationReglementBtp().ApresPointageAsync(db, touchees, ct);
    }
}

/// <summary>
/// Règlements MDE (lot 13) : échéances COMM_ECHEANCE des pièces de FIN_DOCUMENT (CODELOGICIEL = clé de la pièce ;
/// TYPETIERS C → factures clients, F → fournisseurs, S → sous-traitants ; FLRETENUEGARANTIE → échéance RETENUE) ; MDE ne
/// garde que le cumul réglé de chaque échéance (DEJAREGLE) : un règlement par pièce, daté de la dernière modification de
/// FIN_DOCUMENT, mode MODEREG ; sans échéance source, cumul FIN_DOCUMENT.DEJAREGLE réparti ; PMEDOCRETENUE : retenue
/// de l'échéancier calculé, caution si TYPECAUTION est renseigné.
/// </summary>
public sealed class ReglementsMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Reglements;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.PiecesVente, DomainesReprise.Codes.Achats];

    public const string Echeance = "COMM_ECHEANCE";
    public const string Document = "FIN_DOCUMENT";
    public const string Retenue = "PMEDOCRETENUE";
    private const string FactureFournisseur = "ENTETEFACTUREFOURNISSEUR";
    private const string FactureSousTraitant = "ENTETEFACTURESSTRAIT";
    private static readonly string[] Toutes = [PiecesVenteMde.Facture, FactureFournisseur, FactureSousTraitant];
    private static readonly Dictionary<string, string[]> ParTypeTiers = new(StringComparer.Ordinal)
    {
        ["C"] = [PiecesVenteMde.Facture], ["F"] = [FactureFournisseur], ["S"] = [FactureSousTraitant],
    };

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        await using var r = await ReglementsReprise.OuvrirAsync(ctx, ct);
        var docs = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM FIN_DOCUMENT ORDER BY CODELOGICIEL", ct))
            .ToDictionary(l => l.Texte("CODELOGICIEL")!, StringComparer.Ordinal);
        PieceReglee? Piece(string? code) =>
            code is null ? null : (docs.GetValueOrDefault(code)?.Texte("TYPETIERS") is { } t && ParTypeTiers.TryGetValue(t, out var tables) ? tables : Toutes)
                .Select(table => r.Piece(table, code)).FirstOrDefault(p => p is not null);

        var lues = await SqlReprise.SourceAsync(ctx, "SELECT * FROM COMM_ECHEANCE ORDER BY CODELOGICIEL, DATEECH, NLIGNE, CODE", ct);
        var volume = ctx.Rapport.Volume(Echeance);
        var retenues = new List<(PieceReglee Piece, LigneSource Ligne)>();
        foreach (var e in lues)
        {
            volume.Lues++;
            if (Piece(e.Texte("CODELOGICIEL")) is not { } p)
            {
                volume.Ecartees++;
                continue;
            }
            var mode = ctx.Registre.TrouverCode(RegistreMde.ModeCondition, docs.GetValueOrDefault(e.Texte("CODELOGICIEL")!)?.Texte("MODEREG"));
            r.AjouterEcheance(p, new EcheanceReprise((Echeance, e.Texte("CODE")!), SourcesRessources.Jour(e, "DATEECH"), e.Decimal("MONTANT") ?? 0, mode,
                e.Booleen("FLRETENUEGARANTIE") == true));
            volume.Ecrites++;
        }
        var volumeRetenues = ctx.Rapport.Volume(Retenue);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMEDOCRETENUE ORDER BY CLEDOC, NUMORDRE", ct))
        {
            volumeRetenues.Lues++;
            if (r.Piece(PiecesVenteMde.Facture, l.Texte("CLEDOC")) is not { } p)
            {
                volumeRetenues.Ecartees++;
                continue;
            }
            if (string.IsNullOrWhiteSpace(l.Texte("TYPECAUTION"))) r.AjouterRetenue(p, l.Decimal("MTRET") ?? 0);
            retenues.Add((p, l));
            volumeRetenues.Ecrites++;
        }
        await r.EcrireEcheancesAsync(ct);

        // Règlements : cumul réglé de chaque échéance (ou de la pièce sans échéance source), un règlement par pièce.
        var volumeDocs = ctx.Rapport.Volume(Document);
        var parPiece = lues.GroupBy(e => e.Texte("CODELOGICIEL") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        foreach (var (code, d) in docs)
        {
            volumeDocs.Lues++;
            if (Piece(code) is not { } p)
            {
                volumeDocs.Ecartees++;
                continue;
            }
            var emplacement = $"{Document} {code}";
            var pointages = new List<(long, decimal)>();
            decimal trop = 0;
            if (parPiece.TryGetValue(code, out var lignes))
            {
                foreach (var e in lignes.Where(e => e.Decimal("DEJAREGLE") is { } x && x != 0))
                {
                    var montant = Math.Abs(e.Decimal("DEJAREGLE")!.Value);
                    var part = r.Echeance(Echeance, e.Texte("CODE")) is long ech ? r.Pointer(ech, montant) : 0;
                    if (part > 0) pointages.Add((r.Echeance(Echeance, e.Texte("CODE"))!.Value, part));
                    trop += (montant - part) * p.Signe;
                }
            }
            else if (d.Decimal("DEJAREGLE") is { } regle && regle != 0)
            {
                pointages = r.Repartir(p, regle);
                trop = (Math.Abs(regle) - pointages.Sum(x => x.Item2)) * p.Signe;
            }
            if (pointages.Count == 0 && trop == 0) continue;
            var date = SourcesRessources.Jour(d, "DATEMODIF") ?? (lignes ?? []).Select(e => SourcesRessources.Jour(e, "DATEMODIF")).Max() ?? p.Date;
            await r.ReglerAsync(p, date, ctx.Registre.TrouverCode(RegistreMde.ModeCondition, d.Texte("MODEREG")), d.Texte("REFERENCE") ?? p.Numero,
                null, pointages, trop, emplacement, ct);
            volumeDocs.Ecrites++;
        }

        foreach (var (p, l) in retenues.Where(x => !string.IsNullOrWhiteSpace(x.Ligne.Texte("TYPECAUTION"))))
            await r.CautionAsync(p, l.Texte("DESCRIPTIF") ?? l.Texte("CODERETENUE") ?? Retenue, l.Decimal("MTRET") ?? 0, p.Date,
                SourcesRessources.Jour(l, "DATEECH"), l.Texte("CODERETENUE"), null, $"{Retenue} {l.Texte("CLEDOC")}", ct);
        await r.TerminerAsync(ct);
    }
}

/// <summary>
/// Règlements OPTIM (lot 13) : échéances vac_doc_echeance_reglement (polymorphe : VDE → pièce de vente, VSI → facture de
/// la situation, FAC → facture d'achat ou situation de sous-traitance ; échéance d'une retenue : VER_VRG_ID ; lignes de
/// groupement écartées) ; règlements clients vac_reglement_facture_vte (un règlement par remise vac_reglement_lot, sinon
/// par ligne ; échéance VER_VER_ID, sinon réparti) ; échéances fournisseurs soldées (VER_IsSolde) réglées à leur montant ;
/// vac_doc_retenue_caution : retenue (échéancier calculé, payée : VRG_MontantPaye) ou caution (VRG_IsCaution).
/// </summary>
public sealed class ReglementsOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Reglements;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.PiecesVente, DomainesReprise.Codes.Achats];

    public const string Echeance = "vac_doc_echeance_reglement";
    public const string Reglement = "vac_reglement_facture_vte";
    public const string Remise = "vac_reglement_lot";
    public const string RetenueCaution = "vac_doc_retenue_caution";
    /// <summary>Types d'entité des tables polymorphes (VER_TypeEntite, VRG_TypeEntite).</summary>
    public const string EntitePiece = "VDE";
    public const string EntiteSituation = "VSI";
    public const string EntiteFacture = "FAC";

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        await using var r = await ReglementsReprise.OuvrirAsync(ctx, ct);
        var situations = (await SqlReprise.SourceAsync(ctx, "SELECT VDE_ID, VDE_VSI_ID FROM vte_doc_entete WHERE VDE_VSI_ID <> 0", ct))
            .GroupBy(l => l.Texte("VDE_VSI_ID")!).ToDictionary(g => g.Key, g => g.First().Texte("VDE_ID"), StringComparer.Ordinal);
        var factures = (await SqlReprise.SourceAsync(ctx, "SELECT FAC_ID, FAC_DOE_ID, FAC_PSS_ID FROM ach_export_facture_entete", ct))
            .ToDictionary(l => l.Texte("FAC_ID")!, StringComparer.Ordinal);
        PieceReglee? Piece(string? type, string? id, string emplacement)
        {
            switch (type)
            {
                case EntitePiece: return r.Piece(PiecesVenteOptim.Entete, id);
                case EntiteSituation: return r.Piece(PiecesVenteOptim.Entete, id is null ? null : situations.GetValueOrDefault(id));
                case EntiteFacture:
                    var f = id is null ? null : factures.GetValueOrDefault(id);
                    return f?.Texte("FAC_PSS_ID") is { } pss and not "0" ? r.Piece(AchatsOptim.SituationSt, pss) : r.Piece(AchatsOptim.Entete, f?.Texte("FAC_DOE_ID"));
                default:
                    ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ValeurInconnue, emplacement, $"Type d'entité {type} inconnu : ligne non reprise");
                    return null;
            }
        }

        // Échéances.
        var lues = await SqlReprise.SourceAsync(ctx, """
            SELECT * FROM vac_doc_echeance_reglement WHERE VER_IsDesactive = 0 AND VER_IsGroupement = 0 ORDER BY VER_Entite_ID, VER_DateEch, VER_ID
            """, ct);
        var volume = ctx.Rapport.Volume(Echeance);
        var piecesEcheances = new Dictionary<string, PieceReglee>(StringComparer.Ordinal);
        var retenuesAvecEcheance = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in lues)
        {
            volume.Lues++;
            var cle = e.Texte("VER_ID")!;
            if (Piece(e.Texte("VER_TypeEntite"), e.Texte("VER_Entite_ID"), $"{Echeance} {cle}") is not { } p)
            {
                volume.Ecartees++;
                continue;
            }
            var vrg = e.Texte("VER_VRG_ID") is { } v and not "0" ? v : null;
            if (vrg is not null) retenuesAvecEcheance.Add(vrg);
            r.AjouterEcheance(p, new EcheanceReprise((Echeance, cle), SourcesRessources.Jour(e, "VER_DateEch"), e.Decimal("VER_Montant") ?? 0,
                ctx.Registre.TrouverCode(RegistreOptim.Mode, e.Texte("VER_ModeRegl")), vrg is not null));
            piecesEcheances[cle] = p;
            volume.Ecrites++;
        }
        var vrgs = new List<(PieceReglee Piece, LigneSource Ligne)>();
        var volumeRetenues = ctx.Rapport.Volume(RetenueCaution);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM vac_doc_retenue_caution WHERE VRG_IsDesactive = 0 ORDER BY VRG_ID", ct))
        {
            volumeRetenues.Lues++;
            if (Piece(l.Texte("VRG_TypeEntite"), l.Texte("VRG_Entite_ID"), $"{RetenueCaution} {l.Texte("VRG_ID")}") is not { } p)
            {
                volumeRetenues.Ecartees++;
                continue;
            }
            if (l.Booleen("VRG_IsCaution") != true) r.AjouterRetenue(p, l.Decimal("VRG_MontantTotalRG") ?? 0);
            vrgs.Add((p, l));
            volumeRetenues.Ecrites++;
        }
        await r.EcrireEcheancesAsync(ct);

        // Règlements clients : par remise (même tiers), sinon par ligne.
        var remises = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM vac_reglement_lot WHERE VEL_IsDesactive = 0", ct))
            .ToDictionary(l => l.Texte("VEL_ID")!, StringComparer.Ordinal);
        var volumeReglements = ctx.Rapport.Volume(Reglement);
        var groupes = new Dictionary<(string Cle, long Tiers), (PieceReglee Piece, LigneSource Ligne, List<(long, decimal)> Pointages, decimal Trop)>();
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM vac_reglement_facture_vte WHERE VRV_IsDesactive = 0 ORDER BY VRV_Date, VRV_ID", ct))
        {
            volumeReglements.Lues++;
            var ver = l.Texte("VRV_VER_ID");
            var p = (ver is null ? null : piecesEcheances.GetValueOrDefault(ver)) ?? r.Piece(PiecesVenteOptim.Entete, l.Texte("VRV_VDE_ID"));
            if (p is null)
            {
                volumeReglements.Ecartees++;
                continue;
            }
            var montant = Math.Abs(l.Decimal("VRV_Montant") ?? 0);
            var pointages = r.Echeance(Echeance, ver) is long ech ? [(ech, r.Pointer(ech, montant))] : r.Repartir(p, montant);
            var trop = (montant - pointages.Sum(x => x.Item2)) * p.Signe;
            var lot = l.Texte("VRV_VEL_ID") is { } v and not "0" && remises.ContainsKey(v) ? v : null;
            var cle = (lot is null ? $"{Reglement} {l.Texte("VRV_ID")}" : $"{Remise} {lot}", p.TiersId);
            var g = groupes.TryGetValue(cle, out var x) ? x : (Piece: p, Ligne: lot is null ? l : remises[lot], Pointages: new List<(long, decimal)>(), Trop: 0m);
            g.Pointages.AddRange(pointages.Where(y => y.Item2 > 0));
            groupes[cle] = g with { Trop = g.Trop + trop };
            volumeReglements.Ecrites++;
        }
        foreach (var ((cle, _), g) in groupes)
        {
            var remise = cle.StartsWith(Remise, StringComparison.Ordinal);
            var date = SourcesRessources.Jour(g.Ligne, remise ? "VEL_Date" : "VRV_Date") ?? g.Piece.Date;
            var mode = ctx.Registre.TrouverCode(RegistreOptim.Mode, g.Ligne.Texte(remise ? "VEL_ModeRegl" : "VRV_ModeRegl"));
            var trop = g.Trop + (remise ? g.Ligne.Decimal("VEL_TropPercu") ?? 0 : 0);
            await r.ReglerAsync(g.Piece, date, mode, remise ? g.Ligne.Texte("VEL_Commentaire") : g.Ligne.Texte("VRV_Libelle"),
                g.Ligne.Texte(remise ? "VEL_Commentaire" : "VRV_Commentaire"), g.Pointages, trop, cle, ct);
        }

        // Échéances d'achat soldées : OPTIM ne garde pas le paiement des fournisseurs.
        foreach (var e in lues.Where(e => e.Booleen("VER_IsSolde") == true && e.Texte("VER_TypeEntite") == EntiteFacture))
        {
            if (!piecesEcheances.TryGetValue(e.Texte("VER_ID")!, out var p) || r.Echeance(Echeance, e.Texte("VER_ID")) is not long ech) continue;
            var part = r.Pointer(ech, e.Decimal("VER_Montant") ?? 0);
            if (part <= 0) continue;
            await r.ReglerAsync(p, SourcesRessources.Jour(e, "VER_MQuand") ?? SourcesRessources.Jour(e, "VER_DateEch") ?? p.Date,
                ctx.Registre.TrouverCode(RegistreOptim.Mode, e.Texte("VER_ModeRegl")), e.Texte("VER_RefPiece") ?? p.Numero, e.Texte("VER_Commentaire"),
                [(ech, part)], 0, $"{Echeance} {e.Texte("VER_ID")}", ct);
        }

        // Retenues payées sans échéance source, puis cautions.
        foreach (var (p, l) in vrgs)
        {
            var emplacement = $"{RetenueCaution} {l.Texte("VRG_ID")}";
            if (l.Booleen("VRG_IsCaution") == true)
            {
                // VRG_NbMois (tinyint(1)) est lu comme un booléen par le pilote : durée perdue, pas de date de fin.
                await r.CautionAsync(p, l.Texte("VRG_Banque") ?? l.Texte("VRG_Libelle") ?? RetenueCaution, l.Decimal("VRG_MontantCaution") ?? 0,
                    SourcesRessources.Jour(l, "VRG_DateRG") ?? p.Date, null, l.Texte("VRG_NumActe"), SourcesRessources.Jour(l, "VRG_DateLevee"), emplacement, ct);
            }
            else if (!retenuesAvecEcheance.Contains(l.Texte("VRG_ID")!) && l.Decimal("VRG_MontantPaye") is { } paye and not 0)
            {
                var pointages = r.Repartir(p, paye, retenue: true);
                await r.ReglerAsync(p, SourcesRessources.Jour(l, "VRG_DateLevee") ?? SourcesRessources.Jour(l, "VRG_MQuand") ?? p.Date, null, l.Texte("VRG_Libelle"),
                    l.Texte("VRG_Observation"), pointages, (Math.Abs(paye) - pointages.Sum(x => x.Montant)) * p.Signe, emplacement, ct);
            }
        }
        await r.TerminerAsync(ct);
    }
}
