using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Api.Btp;
using LogiBTP.Calcul;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Reprise;

/// <summary>Ligne d'une pièce source traduite (pivot commun MDE / OPTIM, comme la ligne du devis neutre du module Import).</summary>
public sealed record LignePiece
{
    public required string Cle { get; init; }
    /// <summary>Clé de la ligne dans toute la source (ligne du marché citée par les situations), null si sans objet.</summary>
    public string? Reference { get; init; }
    public string? ParentCle { get; init; }
    /// <summary>Type de ligne (<see cref="TL"/>).</summary>
    public required short Type { get; init; }
    /// <summary>Composante d'ouvrage (quantité relative au parent, sauf <see cref="QteAbsolue"/>).</summary>
    public bool Composante { get; init; }
    public bool QteAbsolue { get; init; }
    public string? Code { get; init; }
    public string LibelleHtml { get; init; } = "";
    public bool NonEditee { get; init; }
    public decimal? Qte { get; init; }
    public short PrecisionQte { get; init; } = 2;
    public string? Unite { get; init; }
    public int? NatId { get; init; }
    public int? TvaId { get; init; }
    public decimal? Pa { get; init; }
    public decimal CoefFg { get; init; } = 1;
    public decimal CoefBenef { get; init; } = 1;
    public decimal CoefRemise { get; init; } = 1;
    /// <summary>PV unitaire de la source (null : vide ou nul).</summary>
    public decimal? PvUnitaire { get; init; }
    /// <summary>Prix fixé dans la source (PV imposé).</summary>
    public bool PvFixe { get; init; }
    /// <summary>Montant HT de la source (contrôle des lignes de prix hors composantes).</summary>
    public decimal? MontantHt { get; init; }
}

/// <summary>Pièce de vente source traduite.</summary>
public sealed record PieceSource
{
    /// <summary>Table et clé source (registre, document_origine).</summary>
    public required (string Table, string Cle) Origine { get; init; }
    public required string TypeDocument { get; init; }
    public string? Numero { get; init; }
    public required DateOnly Date { get; init; }
    public string? Objet { get; init; }
    public long? TiersPerId { get; init; }
    /// <summary>Adresse recopiée sur la pièce (nom, lignes, code postal, ville, pays ISO).</summary>
    public AdressePiece? Adresse { get; init; }
    public int? AffaireId { get; init; }
    public int? ChantierId { get; init; }
    /// <summary>Statut cible : BROUILLON, ENVOYE ou VALIDE (<see cref="PiecesReprise.Statut"/>).</summary>
    public required string Statut { get; init; }
    public bool Verrouille { get; init; }
    /// <summary>Clé source de la première version du groupe (versions d'un devis) ; null : la pièce est seule.</summary>
    public string? GroupeCle { get; init; }
    public bool Reference { get; init; } = true;
    public string? NotreReference { get; init; }
    public string? ReferenceExterne { get; init; }
    public short? ValiditeJours { get; init; }
    public string? TexteIntroHtml { get; init; }
    public string? TexteFinHtml { get; init; }
    public string? CpaCode { get; init; }
    public string? ModeReglement { get; init; }
    public decimal? TotalHt { get; init; }
    public decimal? TotalTtc { get; init; }
    public List<LignePiece> Lignes { get; init; } = [];
    /// <summary>Propriétés de l'entête (établissement d'origine…).</summary>
    public Dictionary<string, string> Proprietes { get; init; } = [];
    /// <summary>Avancement (situation, facture d'avancement) : lignes copiées du marché, <see cref="Lignes"/> ignorées.</summary>
    public AvancementSource? Avancement { get; init; }
}

/// <summary>
/// Avancement d'une pièce source (lot 11) : marché (pièce reprise au lot 10), avancement par ligne du marché ou global,
/// situation facturée (lien de transformation vers la facture d'avancement).
/// </summary>
public sealed record AvancementSource
{
    /// <summary>Pièce du marché (table et clé de son entête), sinon déduite des lignes citées.</summary>
    public (string Table, string Cle)? Marche { get; init; }
    /// <summary>Table d'entête des pièces dont les lignes sont citées (<see cref="LignePiece.Reference"/>).</summary>
    public required string TableLignes { get; init; }
    /// <summary>Avancement global cumulé en % (eTypeAvancement C / S, ou situation sans ligne) : toutes les lignes du marché.</summary>
    public decimal? PctGlobal { get; init; }
    public List<LigneAvancement> Lignes { get; init; } = [];
    /// <summary>Situation source facturée par cette pièce (table et clé).</summary>
    public (string Table, string Cle)? Situation { get; init; }
}

/// <summary>Avancement d'une ligne : cumulé (montant ou %) ou de la période ; ligne sans marché reprise en ligne libre.</summary>
public sealed record LigneAvancement
{
    public string? LigneMarche { get; init; }
    public decimal? MontantCumul { get; init; }
    public decimal? MontantPeriode { get; init; }
    public decimal? PctCumul { get; init; }
    public string LibelleHtml { get; init; } = "";
    public int? TvaId { get; init; }
}

public sealed record AdressePiece(string? Nom, string? Lignes, string? CodePostal, string? Ville, string? Pays);

/// <summary>
/// Écriture des pièces de vente reprises (plan reprise-mde-optim, lot 10) : entête, lignes traduites calculées par
/// <see cref="MoteurDevisBtp"/> en mode bordereau (B : ouvrages et composantes au PV unitaire de la source, comme
/// l'import d'un devis OptimBTP), PV source imposé aux lignes dont le montant diffère (et à toutes les lignes de prix des
/// pièces verrouillées), ligne d'écart de reprise pour retrouver le total HT source (§ 10.1), TVA recalculée, origine
/// <c>document_origine</c>, compteurs repartant après le plus grand numéro repris (lot 4, R1).
/// </summary>
public sealed class PiecesReprise : IAsyncDisposable
{
    /// <summary>Statuts posés par la reprise.</summary>
    public static class Statut
    {
        public const string Brouillon = "BROUILLON";
        public const string Envoye = "ENVOYE";
        public const string Valide = "VALIDE";
        public const string Remplace = "REMPLACE";
        /// <summary>Situation facturée (lot 11).</summary>
        public const string Facture = "FACTURE";
    }

    /// <summary>Présentation d'un document d'avancement : C cumul (situation), P période (facture d'avancement).</summary>
    public static class Presentation
    {
        public const string Cumul = "C";
        public const string Periode = "P";
    }

    public const string TypeFactureAvancement = "F";
    public const string LienTransformation = "TRANSFORMATION";

    public const string TableDocument = "document";
    public const string LibelleEcart = "Écart de reprise";
    private const string FormatNumeros = """{"separateur":".","niveaux":[{"style":"1"}]}""";
    private const decimal Centime = 0.01m;

    private readonly ContexteReprise ctx;
    private readonly LogiBtpContext db;
    private readonly Dictionary<string, TypeDocument> types;
    private readonly Dictionary<(int, string), int> statuts;
    private readonly List<TauxTva> taux;
    private readonly int? natureOuvrage;
    private readonly int? natureEcart;
    private readonly Dictionary<(int Tyd, int Exercice), int> rangs = [];
    private readonly Dictionary<string, (long Id, int Versions)> groupes = new(StringComparer.Ordinal);
    /// <summary>Lignes reprises citées par les situations : (table d'entête, référence) → (document, ligne).</summary>
    private readonly Dictionary<(string Table, string Reference), (long Ent, long Lig)> lignesMarche = [];
    /// <summary>Cumul du dernier document d'avancement facturé, par ligne du marché (précédent des suivants).</summary>
    private readonly Dictionary<long, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>.Precedent> precedents = [];

    private PiecesReprise(ContexteReprise ctx, LogiBtpContext db, Dictionary<string, TypeDocument> types, Dictionary<(int, string), int> statuts,
        List<TauxTva> taux, int? natureOuvrage, int? natureEcart)
    {
        this.ctx = ctx;
        this.db = db;
        this.types = types;
        this.statuts = statuts;
        this.taux = taux;
        this.natureOuvrage = natureOuvrage;
        this.natureEcart = natureEcart;
    }

    /// <summary>Contexte EF du cœur sur la connexion et la transaction du moteur de reprise.</summary>
    public static async Task<PiecesReprise> OuvrirAsync(ContexteReprise ctx, CancellationToken ct)
    {
        // Types de la base (ltree de lig_chemin) relus : la connexion a pu être ouverte avant leur création (base neuve).
        await ctx.Unite.Connexion.ReloadTypesAsync(ct);
        var options = new DbContextOptionsBuilder<LogiBtpContext>().UseNpgsql(ctx.Unite.Connexion).UseSnakeCaseNamingConvention().Options;
        var db = new LogiBtpContext(options);
        if (ctx.Unite.Transaction is { } tx) await db.Database.UseTransactionAsync(tx, ct);
        var types = await db.TypesDocument.AsNoTracking().ToDictionaryAsync(t => t.TydCode, StringComparer.Ordinal, ct);
        var statuts = await db.StatutsDocument.AsNoTracking().ToDictionaryAsync(s => (s.StdTydId, s.StdCode), s => s.StdId, ct);
        var taux = await db.TauxTva.AsNoTracking().ToListAsync(ct);
        var natures = await SqlReprise.LireAsync(ctx.Unite, "SELECT nat_id, nat_code, coalesce(nat_rgn_code, '') FROM nature_element",
            r => (Id: r.GetInt32(0), Code: r.GetString(1), Rgn: r.GetString(2)), ct);
        int? Nature(params string[] codes) => codes.SelectMany(c => natures.Where(n => n.Code == c)).Select(n => (int?)n.Id).FirstOrDefault();
        return new PiecesReprise(ctx, db, types, statuts, taux, Nature("OUV", "PRE"), Nature("PRE", "OUV"));
    }

    public ValueTask DisposeAsync() => db.DisposeAsync();

    /// <summary>Type de pièce d'avancement (situation, facture d'avancement…) : repris au lot 11, avec son marché.</summary>
    public bool EstAvancement(string typeDocument) => types.TryGetValue(typeDocument, out var t) && t.TydAvancement is not null;

    /// <summary>Enregistrement EF : l'erreur de la base (contrainte…) remonte avec la pièce en cause.</summary>
    private async Task EnregistrerAsync(string emplacement, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException e) when (e.InnerException is { } cause)
        {
            throw new InvalidOperationException($"{emplacement} : {cause.Message}", e);
        }
    }

    /// <summary>Statut d'après un libellé d'état libre (OPTIM) : accepté → VALIDE, envoyé → ENVOYE, sinon brouillon.</summary>
    public static string StatutDe(string? libelle)
    {
        var n = Associations.Normaliser(libelle);
        bool A(params string[] mots) => mots.Any(m => n.Contains(m, StringComparison.Ordinal));
        return A("ACCEPT", "SIGNE", "COMMANDE", "GAGNE", "OBTENU", "VALIDE") ? Statut.Valide
            : A("ENVOY", "TRANSMI", "REMIS", "REFUS", "PERDU", "EDITE", "FACTURE") ? Statut.Envoye
            : Statut.Brouillon;
    }

    /// <summary>Indice d'une version (1 → A, 2 → B… ; 27 → AA).</summary>
    public static string Indice(int rang)
    {
        var s = "";
        for (var n = Math.Max(1, rang); n > 0; n = (n - 1) / 26) s = (char)('A' + (n - 1) % 26) + s;
        return s;
    }

    /// <summary>Rang final d'un numéro source (chiffres de fin), null sans chiffre.</summary>
    public static int? RangDe(string? numero)
    {
        if (string.IsNullOrWhiteSpace(numero)) return null;
        var fin = numero.Length;
        while (fin > 0 && !char.IsAsciiDigit(numero[fin - 1])) fin--;
        var debut = fin;
        while (debut > 0 && char.IsAsciiDigit(numero[debut - 1])) debut--;
        return fin > debut && int.TryParse(numero.AsSpan(debut, Math.Min(fin - debut, 9)), NumberStyles.None, CultureInfo.InvariantCulture, out var r) ? r : null;
    }

    /// <summary>Lignes de document de la pièce : identifiants négatifs, prix selon le mode bordereau.</summary>
    public static List<DocumentLigneBtp> Lignes(PieceSource p, int? natureOuvrage)
    {
        var ids = new Dictionary<string, long>(StringComparer.Ordinal);
        long prochain = -1;
        foreach (var l in p.Lignes) ids[l.Cle] = prochain--;
        var parents = p.Lignes.Where(l => l.ParentCle is not null).Select(l => l.ParentCle!).ToHashSet(StringComparer.Ordinal);
        var ordres = new Dictionary<long, int>();
        var res = new List<DocumentLigneBtp>();
        foreach (var l in p.Lignes)
        {
            long? parent = l.ParentCle is { } pc && ids.TryGetValue(pc, out var pid) ? pid : null;
            var cleOrdre = parent ?? 0;
            var ordre = ordres[cleOrdre] = ordres.GetValueOrDefault(cleOrdre) + 1;
            // Ouvrage sans composante : élément (prix fixe interdit sur un ouvrage vide).
            var type = l.Type == TL.Ouvrage && !parents.Contains(l.Cle) ? TL.Element : l.Type;
            var x = new DocumentLigneBtp
            {
                LigId = ids[l.Cle], LigParentId = parent, LigOrdre = ordre, LigTylId = type, LigCode = l.Code, LigLibelleHtml = l.LibelleHtml,
                LigIsNonEditee = l.NonEditee, LigProprietes = JsonDocument.Parse("{}"),
            };
            if (type is TL.Element or TL.Ouvrage)
            {
                x.LigQte = l.Qte ?? 0;
                x.LigQteType = l.Composante ? (l.QteAbsolue ? "A" : "R") : null;
                x.LigPrecisionQte = l.PrecisionQte;
                x.LigUntCode = l.Unite;
                x.LigNatId = l.NatId ?? (type == TL.Ouvrage || l.Type == TL.Ouvrage ? natureOuvrage : null);
                x.LigTvaId = l.Composante ? null : l.TvaId;
                x.LigCoefBenef = l.CoefBenef <= 0 ? 1 : l.CoefBenef;
                x.LigCoefRemise = l.CoefRemise <= 0 ? 1 : l.CoefRemise;
                x.LigPrecisionPv = 6;
                if (type == TL.Element)
                {
                    x.LigPa = l.Pa ?? 0;
                    x.LigCoefFg = l.CoefFg <= 0 ? 1 : l.CoefFg;
                }
                // Bordereau : ouvrages composés et composantes au PV unitaire de la source ; prix fixes de la source.
                var impose = type == TL.Ouvrage || l.Composante || l.PvFixe;
                if (impose && l.PvUnitaire is { } pv)
                {
                    x.LigPvFixe = true;
                    x.LigPv = pv;
                }
                else if (type == TL.Element && l.Type == TL.Ouvrage && l.PvUnitaire is { } pvo)
                {
                    // Ancien ouvrage vide : son PV devient le prix d'achat (coefficients à 1).
                    x.LigPa = pvo;
                    x.LigCoefFg = x.LigCoefBenef = 1;
                }
            }
            res.Add(x);
        }
        return res;
    }

    private ResultatCalcul Calculer(DocumentBtp doc, List<DocumentLigneBtp> lignes) =>
        MoteurDevisBtp.Calculer(new EntreeCalcul { Document = doc, Lignes = lignes, TauxTva = taux });

    /// <summary>Écrit la pièce ; null si son type est inconnu de la base (signalé).</summary>
    public async Task<long?> EcrireAsync(PieceSource p, CancellationToken ct)
    {
        var emplacement = $"{p.Origine.Table} {p.Origine.Cle}";
        var volume = ctx.Rapport.Volume(p.Origine.Table);
        volume.Lues++;
        if (!types.TryGetValue(p.TypeDocument, out var type) || !statuts.TryGetValue((type.TydId, p.Statut), out var std))
        {
            volume.Ecartees++;
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ValeurInconnue, emplacement,
                $"Type de pièce {p.TypeDocument} ou statut {p.Statut} inconnu de la base : pièce non reprise");
            return null;
        }
        var verrouille = p.Verrouille || p.Statut != Statut.Brouillon;
        var doc = new DocumentBtp
        {
            EntTydId = type.TydId, EntDate = p.Date, EntObjet = p.Objet, EntStdId = std, EntTiersId = p.TiersPerId,
            EntNotreReference = p.NotreReference, EntReferenceExterne = p.ReferenceExterne,
            EntValiditeJours = p.ValiditeJours is > 0 ? p.ValiditeJours : null,
            EntTexteIntroHtml = p.TexteIntroHtml, EntTexteFinHtml = p.TexteFinHtml,
            EntAffaireId = p.AffaireId, EntChantierId = p.ChantierId, EntCpaCode = p.CpaCode, EntModeReglement = p.ModeReglement,
            EntModeCalculOuvrage = "B", EntNumFormat = JsonDocument.Parse(FormatNumeros),
            EntProprietes = JsonSerializer.SerializeToDocument(p.Proprietes), EntEtiquettes = JsonDocument.Parse("[]"),
            EntAdresseFacturation = p.Adresse is { } a ? JsonSerializer.SerializeToDocument(new
            {
                origine = "LIBRE", libelle = a.Nom,
                adresse = new { ligne1 = a.Lignes, ligne2 = (string?)null, ligne3 = (string?)null, code_postal = a.CodePostal, ville = a.Ville, pays = a.Pays ?? "FR" },
            }) : null,
            EntVerrouille = verrouille, EntEnvoyeLe = verrouille ? new DateTimeOffset(p.Date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero) : null,
            EntCreeLe = DateTimeOffset.UtcNow, EntCreePar = ctx.Options.Auteur ?? "reprise",
            // Référence de chaque groupe posée à la fin (TerminerAsync) : une seule par groupe.
            EntIsReference = false,
        };
        // Numéro : celui de la source ; une facture brouillon (numérotation continue) n'en a pas encore.
        if (!(type.TydNumerotationContinue && p.Statut == Statut.Brouillon)) doc.EntNumero = Couper(p.Numero, 30);
        else doc.EntNotreReference ??= Couper(p.Numero, 50);
        if (p.GroupeCle is { } g && groupes.TryGetValue(g, out var groupe))
        {
            doc.EntGroupeId = groupe.Id;
            doc.EntIndice = Indice(groupe.Versions + 1);
        }

        // Avancement : lignes du marché, avancement cumulé ou de la période (lot 11).
        if (p.Avancement is not null)
        {
            doc.EntAvtPresentation = type.TydAvancement == TypeFactureAvancement ? Presentation.Periode : Presentation.Cumul;
        }
        // Calcul : lignes au mode bordereau, PV source imposé aux lignes de prix qui s'en écartent (toutes si la pièce est verrouillée).
        var (lignes, marche) = p.Avancement is { } av ? await LignesAvancementAsync(doc, av, emplacement, ct) : (Lignes(p, natureOuvrage), null);
        var sources = p.Lignes.ToDictionary(l => l.Cle, StringComparer.Ordinal);
        var cles = p.Lignes.Zip(lignes, (s, l) => (l.LigId, s.Cle)).ToDictionary(x => x.LigId, x => x.Cle);
        var r = Calculer(doc, lignes);
        var imposees = 0;
        foreach (var l in lignes.Where(l => p.Avancement is null && TL.EstChiffree(l) && l.LigQteType is null && !l.LigPvFixe))
        {
            var s = sources[cles[l.LigId]];
            if (s.PvUnitaire is not { } pv) continue;
            var calcule = r.Lignes.First(x => x.LigId == l.LigId).LigMontantHt ?? 0;
            var differe = s.MontantHt is { } m && Math.Abs(calcule - m) >= Centime;
            if (!verrouille && !differe) continue;
            l.LigPvFixe = true;
            l.LigPv = pv;
            if (differe) imposees++;
        }
        if (imposees > 0 || lignes.Any(l => l.LigPvFixe)) r = Calculer(doc, lignes);
        if (imposees > 0)
            ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.PrixImpose, emplacement, $"{imposees} ligne(s) au PV unitaire de la source");

        // Écart de reprise : total HT source retrouvé par une ligne au PV fixe (§ 10.1).
        if (p.TotalHt is { } totalSource && Math.Abs(r.Document.EntTotalHt - totalSource) >= Centime)
        {
            var ecart = totalSource - r.Document.EntTotalHt;
            ctx.Rapport.EcartsArrondi.Add(new EcartArrondi($"{p.TypeDocument} {p.Numero ?? p.Origine.Cle}", totalSource, r.Document.EntTotalHt, ecart));
            lignes = r.Lignes.Where(l => !l.LigIsEcartArrondi || l.LigParentId is not null).ToList();
            lignes.Add(new DocumentLigneBtp
            {
                LigId = lignes.Min(l => l.LigId) - 1, LigOrdre = lignes.Where(l => l.LigParentId is null).Select(l => l.LigOrdre).DefaultIfEmpty().Max() + 1,
                LigTylId = TL.Element, LigLibelleHtml = LibelleEcart, LigQte = 1, LigPa = ecart, LigPv = ecart, LigPvFixe = true, LigPrecisionPv = 6,
                LigNatId = natureEcart, LigTvaId = lignes.Where(l => TL.EstChiffree(l) && l.LigTvaId is not null).Select(l => l.LigTvaId).FirstOrDefault(),
                LigIsNonEditee = true, LigProprietes = JsonDocument.Parse("""{"reprise_ecart":true}"""),
            });
            r = Calculer(doc, lignes);
        }
        if (p.TotalTtc is { } ttc && Math.Abs(r.Document.EntTotalTtc - ttc) >= Centime)
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.EcartTtc, emplacement,
                $"TTC calculé {r.Document.EntTotalTtc:0.00} ≠ TTC source {ttc:0.00} (taux de TVA des lignes)");

        // Entête calculé puis écriture (persistance du module Document).
        doc.EntTotalHt = r.Document.EntTotalHt;
        doc.EntTotalTva = r.Document.EntTotalTva;
        doc.EntTotalTtc = r.Document.EntTotalTtc;
        doc.EntNetAPayer = r.Document.EntNetAPayer;
        doc.EntVersionCalcul = r.VersionMoteur;
        db.Documents.Add(doc);
        await EnregistrerAsync(emplacement, ct);
        if (doc.EntGroupeId is null)
        {
            doc.EntGroupeId = doc.EntId;
            groupes[p.GroupeCle ?? $"{p.Origine.Table}|{p.Origine.Cle}"] = (doc.EntId, 1);
        }
        else if (p.GroupeCle is { } gc) groupes[gc] = (groupes[gc].Id, groupes[gc].Versions + 1);
        await EnregistrerAsync(emplacement, ct);
        var complet = new DocumentCompletBtp { Document = r.Document, Lignes = r.Lignes, Tva = r.Tva };
        try
        {
            var corr = await new PersistanceDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>(db, new SpecialisationBtp()).Ecrire(doc.EntId, complet, ct);
            foreach (var (l, x) in p.Lignes.Zip(lignes))
                if (l.Reference is { } reference && corr.Lignes.TryGetValue(x.LigId, out var reel)) lignesMarche[(p.Origine.Table, reference)] = (doc.EntId, reel);
        }
        catch (DbUpdateException e) when (e.InnerException is { } cause)
        {
            throw new InvalidOperationException($"{emplacement} : {cause.Message}", e);
        }
        db.Origines.Add(new DocumentOrigine
        {
            DorEntId = doc.EntId, DorFormat = ctx.Options.Source, DorReference = emplacement, DorDate = DateTimeOffset.UtcNow,
            DorUtilisateur = ctx.Options.Auteur ?? "reprise",
        });
        await EnregistrerAsync(emplacement, ct);
        db.ChangeTracker.Clear();
        if (doc.EntAvtPresentation == Presentation.Periode)
            foreach (var l in r.Lignes.Where(l => l.LigAvtSourceLigId is not null))
                precedents[l.LigAvtSourceLigId!.Value] = new(l.LigAvtMontantCumul ?? 0, l.LigAvtQteCumul ?? 0, l.LigAvtPct ?? 0);
        if (marche is { } mid) await LierAsync(mid, doc.EntId, ct);
        if (p.Avancement?.Situation is { } sit && ctx.Registre.Trouver(sit.Table, sit.Cle) is { } sid) await LierAsync(sid, doc.EntId, ct);

        if (doc.EntNumero is { } numero)
        {
            var exercice = DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>.ExerciceCompteur(type, p.Date.Year);
            var rang = DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>.LireNumero(type, numero, p.Date.Year) is { } lu ? lu.Rang : RangDe(numero);
            if (rang is { } rg && rg > rangs.GetValueOrDefault((type.TydId, exercice))) rangs[(type.TydId, exercice)] = rg;
        }
        ctx.Registre.Inscrire(p.Origine.Table, p.Origine.Cle, TableDocument, doc.EntId);
        volume.Ecrites++;
        return doc.EntId;
    }

    /// <summary>
    /// Lignes d'un document d'avancement : copie des lignes du marché (structure, prix, TVA), chaque ligne de prix suivant sa
    /// ligne du marché (<c>lig_avt_source_lig_id</c>) en montant cumulé (ou en % : avancement global, ligne sans prix) ;
    /// précédent du dernier document facturé repris ; ligne de la source sans ligne du marché : ligne libre au montant de la
    /// source (signalée). Le marché est renvoyé pour le lien de transformation.
    /// </summary>
    private async Task<(List<DocumentLigneBtp> Lignes, long? Marche)> LignesAvancementAsync(DocumentBtp doc, AvancementSource av, string emplacement, CancellationToken ct)
    {
        long? marche = av.Marche is { } m ? ctx.Registre.Trouver(m.Table, m.Cle) : null;
        marche ??= av.Lignes.Select(l => l.LigneMarche is { } r && lignesMarche.TryGetValue((av.TableLignes, r), out var x) ? x.Ent : (long?)null)
            .FirstOrDefault(x => x is not null);
        var parLigne = new Dictionary<long, List<LigneAvancement>>();
        var libres = new List<LigneAvancement>();
        foreach (var l in av.Lignes)
        {
            if (l.LigneMarche is { } r && lignesMarche.TryGetValue((av.TableLignes, r), out var x) && x.Ent == marche)
                (parLigne.TryGetValue(x.Lig, out var liste) ? liste : parLigne[x.Lig] = []).Add(l);
            else if ((l.MontantCumul ?? l.MontantPeriode ?? 0) != 0) libres.Add(l);
        }
        var periode = doc.EntAvtPresentation == Presentation.Periode;
        var res = new List<DocumentLigneBtp>();
        if (marche is { } me)
        {
            var source = await db.Lignes.AsNoTracking().Where(l => l.LigEntId == me).OrderBy(l => l.LigId).ToListAsync(ct);
            var ids = source.Select((l, i) => (l.LigId, Temp: -(i + 1L))).ToDictionary(x => x.LigId, x => x.Temp);
            foreach (var s in source)
            {
                var l = JsonCalcul.Cloner(s);
                l.LigId = ids[s.LigId];
                l.LigEntId = 0;
                l.LigParentId = s.LigParentId is { } pp && ids.TryGetValue(pp, out var tp) ? tp : null;
                l.LigOrigineId = s.LigId;
                if (TL.EstChiffree(l) && l.LigQteType is null)
                {
                    var precedent = precedents.GetValueOrDefault(s.LigId);
                    var marcheHt = s.LigMontantHt ?? 0;
                    l.LigAvtMontantMarche = marcheHt;
                    l.LigAvtQteMarche = s.LigQteVendue ?? s.LigQte;
                    l.LigAvtSourceLigId = s.LigId;
                    DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>.EcrirePrecedent(l, precedent);
                    var saisies = parLigne.GetValueOrDefault(s.LigId);
                    if (saisies?.Any(x => x.MontantCumul is not null || x.MontantPeriode is not null) == true)
                    {
                        l.LigAvtMode = "M";
                        l.LigAvtValeur = saisies.Sum(x => x.MontantCumul ?? (precedent?.Montant ?? 0) + (x.MontantPeriode ?? 0));
                    }
                    else if ((saisies?.FirstOrDefault(x => x.PctCumul is not null)?.PctCumul ?? av.PctGlobal) is { } pct)
                    {
                        l.LigAvtMode = "P";
                        l.LigAvtValeur = pct;
                    }
                    else
                    {
                        // Ligne sans avancement dans la source : avancement du précédent (période nulle).
                        l.LigAvtMode = marcheHt == 0 ? "P" : "M";
                        l.LigAvtValeur = marcheHt == 0 ? precedent?.Pct ?? 0 : precedent?.Montant ?? 0;
                    }
                    var cumul = l.LigAvtMode == "M" ? l.LigAvtValeur ?? 0 : marcheHt * (l.LigAvtValeur ?? 0) / 100;
                    if (Math.Abs(cumul) > Math.Abs(marcheHt) || l.LigAvtMode == "P" && l.LigAvtValeur > 100) doc.EntAvtDepassement = true;
                }
                res.Add(l);
            }
        }
        if (libres.Count > 0 || marche is null)
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.AvancementSansMarche, emplacement, marche is null
                ? "Marché de la situation introuvable : lignes reprises en lignes libres, sans suivi d'avancement"
                : $"{libres.Count} ligne(s) sans ligne du marché : reprises en lignes libres");
        var ordre = res.Where(l => l.LigParentId is null).Select(l => l.LigOrdre).DefaultIfEmpty().Max();
        var prochain = res.Select(l => l.LigId).DefaultIfEmpty().Min() - 1;
        foreach (var l in marche is null ? av.Lignes.Where(x => (x.MontantCumul ?? x.MontantPeriode ?? 0) != 0) : libres)
        {
            var montant = periode ? l.MontantPeriode ?? l.MontantCumul ?? 0 : l.MontantCumul ?? l.MontantPeriode ?? 0;
            res.Add(new DocumentLigneBtp
            {
                LigId = prochain--, LigOrdre = ++ordre, LigTylId = TL.Element, LigLibelleHtml = l.LibelleHtml, LigQte = 1, LigPa = montant, LigPv = montant,
                LigPvFixe = true, LigPrecisionPv = 6, LigNatId = natureEcart, LigTvaId = l.TvaId, LigProprietes = JsonDocument.Parse("""{"reprise_libre":true}"""),
            });
        }
        return (res, marche);
    }

    /// <summary>Lien de transformation (marché → document d'avancement, situation → facture), une fois.</summary>
    private async Task LierAsync(long source, long cible, CancellationToken ct) =>
        await SqlReprise.ExecuterAsync(ctx.Unite, """
            INSERT INTO document_lien (lie_source_ent_id, lie_cible_ent_id, lie_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
            """, ct, source, cible, LienTransformation);

    /// <summary>
    /// Fin des pièces : référence de chaque groupe = sa dernière version, les précédentes non acceptées passent REMPLACE ;
    /// compteurs repartant après le plus grand rang repris.
    /// </summary>
    public async Task TerminerAsync(CancellationToken ct)
    {
        await SqlReprise.ExecuterAsync(ctx.Unite, """
            UPDATE document d SET ent_is_reference = (d.ent_id = g.dernier)
            FROM (SELECT ent_groupe_id, max(ent_id) AS dernier FROM document GROUP BY ent_groupe_id) g
            WHERE g.ent_groupe_id = d.ent_groupe_id AND d.ent_id IN (SELECT dor_ent_id FROM document_origine WHERE dor_format = $1)
            """, ct, ctx.Options.Source);
        await SqlReprise.ExecuterAsync(ctx.Unite, """
            UPDATE document d SET ent_std_id = s.std_id
            FROM statut_document s, statut_document a
            WHERE NOT d.ent_is_reference AND s.std_tyd_id = d.ent_tyd_id AND s.std_code = 'REMPLACE'
              AND a.std_id = d.ent_std_id AND a.std_code <> 'VALIDE'
              AND d.ent_id IN (SELECT dor_ent_id FROM document_origine WHERE dor_format = $1)
            """, ct, ctx.Options.Source);
        foreach (var ((tyd, exercice), rang) in rangs)
            await SqlReprise.ExecuterAsync(ctx.Unite, """
                INSERT INTO compteur_numero (cnu_tyd_id, cnu_exercice, cnu_dernier_numero) VALUES ($1, $2, $3)
                ON CONFLICT (cnu_tyd_id, cnu_exercice) DO UPDATE SET cnu_dernier_numero = greatest(compteur_numero.cnu_dernier_numero, excluded.cnu_dernier_numero)
                """, ct, tyd, exercice, rang);
    }

    /// <summary>Marché d'un chantier rattaché à sa pièce d'origine (devis initial, lot 9).</summary>
    public async Task LierMarcheAsync(int chaId, long entId, CancellationToken ct) =>
        await SqlReprise.ExecuterAsync(ctx.Unite, """
            UPDATE marche SET mar_ent_id = $2 WHERE mar_cha_id = $1 AND mar_sens = 'V' AND mar_ent_id IS NULL
            """, ct, chaId, entId);

    public static string? Couper(string? texte, int longueur) => AnnuaireReprise.Couper(texte, longueur);
}
