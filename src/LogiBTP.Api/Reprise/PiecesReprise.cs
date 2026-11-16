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
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Reprise;

/// <summary>Ligne d'une pièce source traduite (pivot commun MDE / OPTIM, comme la ligne du devis neutre du module Import).</summary>
public sealed record LignePiece
{
    public required string Cle { get; init; }
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
    }

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

        // Calcul : lignes au mode bordereau, PV source imposé aux lignes de prix qui s'en écartent (toutes si la pièce est verrouillée).
        var lignes = Lignes(p, natureOuvrage);
        var sources = p.Lignes.ToDictionary(l => l.Cle, StringComparer.Ordinal);
        var cles = p.Lignes.Zip(lignes, (s, l) => (l.LigId, s.Cle)).ToDictionary(x => x.LigId, x => x.Cle);
        var r = Calculer(doc, lignes);
        var imposees = 0;
        foreach (var l in lignes.Where(l => TL.EstChiffree(l) && l.LigQteType is null && !l.LigPvFixe))
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
            await new PersistanceDocument<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>(db, new SpecialisationBtp()).Ecrire(doc.EntId, complet, ct);
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
