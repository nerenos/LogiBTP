using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Comptabilite.Web;

public class ExportEntite
{
    public long CexId { get; set; }
    public DateTimeOffset CexLe { get; set; } = DateTimeOffset.UtcNow;
    public string CexPar { get; set; } = "";
    public DateOnly? CexDu { get; set; }
    public DateOnly? CexAu { get; set; }
    public string[] CexTypes { get; set; } = [];
    public string CexModele { get; set; } = "{}";
    public int CexNbPieces { get; set; }
    public int CexNbLignes { get; set; }
    public decimal CexTotal { get; set; }
    public string CexNomFichier { get; set; } = "";
    public byte[] CexContenu { get; set; } = [];
    public DateTimeOffset? CexAnnuleLe { get; set; }
    public string? CexAnnulePar { get; set; }
}

public class ExportPieceEntite
{
    public long CepCexId { get; set; }
    public long CepPieceId { get; set; }
    public string? CepNumero { get; set; }
    public string CepEmpreinte { get; set; } = "";
}

/// <summary>Sélection des pièces à transférer : période (date comptable), types comptables, état (A à transférer, T transférée), pièces.</summary>
public sealed record FiltrePieces(DateOnly? Du, DateOnly? Au, List<string> Types, string Etat, List<long>? Ids = null);

/// <summary>Pièce construite par l'application pour la règle d'écriture, avec ce que l'aperçu affiche.</summary>
public sealed record PieceExportee(PieceComptable Piece, string TypeComptable, string TypeDocument, string? Tiers, decimal TotalTtc, string Etat);

public sealed record DemandeExport(DateOnly? Du, DateOnly? Au, List<string>? Types);

public sealed record LigneApercu(string Compte, string? Auxiliaire, string Libelle, decimal Debit, decimal Credit, DateOnly? Echeance);

public sealed record PieceApercu(long Id, string Numero, string TypeDocument, string TypeComptable, string Journal, DateOnly Date, string? Tiers, decimal TotalTtc,
    List<LigneApercu> Lignes, List<string> Erreurs, bool Modifiee);

public sealed record Apercu(List<PieceApercu> Pieces, List<PieceApercu> Modifiees, int Valides, decimal TotalDebit);

public sealed record LotExport(long Id, DateTimeOffset Le, string Par, DateOnly? Du, DateOnly? Au, List<string> Types, string Modele, int NbPieces, int NbLignes,
    decimal Total, string NomFichier, DateTimeOffset? AnnuleLe, string? AnnulePar);

public sealed record ResultatExport(LotExport? Lot, List<PieceApercu> Exclues);

/// <summary>
/// Export des écritures (lot 3) : aperçu des pièces à transférer (écritures par ReglesEcritures, erreurs), pièces déjà
/// transférées dont l'écriture a changé, lot d'export (pièces sans erreur seulement, fichier au modèle retenu, pièces
/// marquées transférées), téléchargement, annulation d'un lot (pièces remises à transférer).
/// </summary>
public sealed class ServiceExport(ComptabiliteDbContext db, SpecialisationComptabilite specialisation)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<ModeleExport> ModeleAsync(CancellationToken ct)
    {
        var v = await db.Parametres.AsNoTracking().Where(x => x.PcpCle == "modele_export").Select(x => x.PcpValeur).FirstOrDefaultAsync(ct);
        if (v is null) return FormatExport.Sage100;
        try
        {
            using var d = JsonDocument.Parse(v);
            if (d.RootElement.ValueKind == JsonValueKind.String)
                return FormatExport.Modeles.FirstOrDefault(m => m.Code == d.RootElement.GetString()) ?? FormatExport.Sage100;
            return JsonSerializer.Deserialize<ModeleExport>(v, Json) is { } m && FormatExport.Controler(m) is null ? m : FormatExport.Sage100;
        }
        catch (JsonException) { return FormatExport.Sage100; }
    }

    /// <summary>Modèle retenu : un modèle fourni (par son code) ou un modèle complet contrôlé.</summary>
    public async Task<ModeleExport> EnregistrerModeleAsync(ModeleExport m, Utilisateur u, CancellationToken ct)
    {
        // Modèle fourni désigné par son code (colonnes vides ou identiques), sinon modèle personnalisé.
        var fourni = FormatExport.Modeles.FirstOrDefault(x => x.Code == m.Code
            && (m.Colonnes is not { Count: > 0 } || JsonSerializer.Serialize(x, Json) == JsonSerializer.Serialize(m, Json)));
        if (fourni is null && FormatExport.Controler(m) is string e) throw ExceptionMetier.Invalide("EXPORT_MODELE", e);
        var p = await db.Parametres.FindAsync(["modele_export"], ct);
        if (p is null) db.Parametres.Add(p = new ParametreEntite { PcpCle = "modele_export" });
        p.PcpValeur = fourni is not null ? JsonSerializer.Serialize(fourni.Code) : JsonSerializer.Serialize(m, Json);
        p.PcpMajPar = u.Code;
        p.PcpMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await ModeleAsync(ct);
    }

    private static string Empreinte(Ecriture e) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\n", e.Lignes.Select(l =>
            $"{l.Journal}|{l.Date:yyyyMMdd}|{l.Piece}|{l.Compte}|{l.Auxiliaire}|{l.Debit:0.00}|{l.Credit:0.00}|{l.Echeance:yyyyMMdd}"))))).ToLowerInvariant();

    private static PieceApercu Vue(PieceExportee p, Ecriture e, bool modifiee) => new(p.Piece.Id, p.Piece.Numero, p.TypeDocument, p.TypeComptable, p.Piece.Journal,
        p.Piece.Date, p.Tiers, p.TotalTtc, e.Lignes.Select(l => new LigneApercu(l.Compte, l.Auxiliaire, l.Libelle, l.Debit, l.Credit, l.Echeance)).ToList(),
        e.Erreurs.Select(x => ReglesEcritures.Messages.GetValueOrDefault(x, x)
            + (e.Details.TryGetValue(x, out var d) && d.Count > 0 ? $" : {string.Join(", ", d)}" : "")).ToList(), modifiee);

    private async Task<List<string>> TypesAsync(List<string>? types, CancellationToken ct) =>
        types is { Count: > 0 } ? types : await db.TypesComptables.Where(t => t.TcoActif).Select(t => t.TcoCode).ToListAsync(ct);

    public async Task<Apercu> ApercuAsync(DemandeExport d, CancellationToken ct)
    {
        var types = await TypesAsync(d.Types, ct);
        var pieces = await specialisation.PiecesAsync(db, new FiltrePieces(d.Du, d.Au, types, "A"), ct);
        var vues = pieces.Select(p => Vue(p, ReglesEcritures.Ecrire(p.Piece), false)).ToList();
        // Pièces transférées de la période dont l'écriture a changé depuis leur dernier export (M12).
        var transferees = await specialisation.PiecesAsync(db, new FiltrePieces(d.Du, d.Au, types, "T"), ct);
        var ids = transferees.Select(p => p.Piece.Id).ToList();
        var dernieres = (await db.Set<ExportPieceEntite>().AsNoTracking().Where(x => ids.Contains(x.CepPieceId))
                .Join(db.Set<ExportEntite>().Where(x => x.CexAnnuleLe == null), p => p.CepCexId, x => x.CexId, (p, x) => new { p.CepPieceId, p.CepEmpreinte, x.CexLe })
                .ToListAsync(ct))
            .GroupBy(x => x.CepPieceId).ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.CexLe).First().CepEmpreinte);
        var modifiees = transferees.Select(p => (p, e: ReglesEcritures.Ecrire(p.Piece)))
            .Where(x => !dernieres.TryGetValue(x.p.Piece.Id, out var empreinte) || empreinte != Empreinte(x.e))
            .Select(x => Vue(x.p, x.e, true)).ToList();
        var valides = vues.Where(v => v.Erreurs.Count == 0).ToList();
        return new(vues, modifiees, valides.Count, valides.Sum(v => v.Lignes.Sum(l => l.Debit)));
    }

    private static LotExport Lot(ExportEntite x) => new(x.CexId, x.CexLe, x.CexPar, x.CexDu, x.CexAu, x.CexTypes.ToList(),
        JsonDocument.Parse(x.CexModele).RootElement.TryGetProperty("libelle", out var l) ? l.GetString() ?? "" : "", x.CexNbPieces, x.CexNbLignes, x.CexTotal,
        x.CexNomFichier, x.CexAnnuleLe, x.CexAnnulePar);

    /// <summary>Lot d'export : pièces à transférer sans erreur ; les autres sont rendues (exclues) ; aucune pièce : pas de lot.</summary>
    public async Task<ResultatExport> ExporterAsync(DemandeExport d, Utilisateur u, CancellationToken ct)
    {
        var types = await TypesAsync(d.Types, ct);
        var modele = await ModeleAsync(ct);
        var pieces = (await specialisation.PiecesAsync(db, new FiltrePieces(d.Du, d.Au, types, "A"), ct))
            .Select(p => (p, e: ReglesEcritures.Ecrire(p.Piece))).ToList();
        var exclues = pieces.Where(x => x.e.Erreurs.Count > 0).Select(x => Vue(x.p, x.e, false)).ToList();
        var bonnes = pieces.Where(x => x.e.Erreurs.Count == 0).OrderBy(x => x.p.Piece.Journal).ThenBy(x => x.p.Piece.Date).ThenBy(x => x.p.Piece.Numero).ToList();
        if (bonnes.Count == 0) return new(null, exclues);
        var lignes = bonnes.SelectMany(x => x.e.Lignes).ToList();
        var maintenant = DateTimeOffset.Now;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var lot = new ExportEntite
        {
            CexPar = u.Code, CexDu = d.Du, CexAu = d.Au, CexTypes = types.ToArray(), CexModele = JsonSerializer.Serialize(modele, Json),
            CexNbPieces = bonnes.Count, CexNbLignes = lignes.Count, CexTotal = lignes.Sum(l => l.Debit),
            CexNomFichier = $"ecritures-{maintenant:yyyyMMdd-HHmmss}.{(modele.Separateur == "\t" ? "txt" : "csv")}",
            CexContenu = FormatExport.Fichier(lignes, modele),
        };
        db.Add(lot);
        await db.SaveChangesAsync(ct);
        db.AddRange(bonnes.Select(x => new ExportPieceEntite { CepCexId = lot.CexId, CepPieceId = x.p.Piece.Id, CepNumero = x.p.Piece.Numero, CepEmpreinte = Empreinte(x.e) }));
        await db.SaveChangesAsync(ct);
        await specialisation.MarquerAsync(db, bonnes.Select(x => x.p.Piece.Id).ToList(), true, ct);
        await tx.CommitAsync(ct);
        return new(Lot(lot), exclues);
    }

    public async Task<List<LotExport>> LotsAsync(CancellationToken ct) =>
        (await db.Set<ExportEntite>().AsNoTracking().OrderByDescending(x => x.CexId).Take(200)
            .Select(x => new ExportEntite
            {
                CexId = x.CexId, CexLe = x.CexLe, CexPar = x.CexPar, CexDu = x.CexDu, CexAu = x.CexAu, CexTypes = x.CexTypes, CexModele = x.CexModele,
                CexNbPieces = x.CexNbPieces, CexNbLignes = x.CexNbLignes, CexTotal = x.CexTotal, CexNomFichier = x.CexNomFichier, CexAnnuleLe = x.CexAnnuleLe,
                CexAnnulePar = x.CexAnnulePar,
            }).ToListAsync(ct)).Select(Lot).ToList();

    public async Task<(string Nom, byte[] Contenu, string Type)> FichierAsync(long id, CancellationToken ct)
    {
        var x = await db.Set<ExportEntite>().AsNoTracking().FirstOrDefaultAsync(e => e.CexId == id, ct) ?? throw ExceptionMetier.Introuvable($"Lot d'export {id}");
        return (x.CexNomFichier, x.CexContenu, "text/csv");
    }

    /// <summary>Annulation d'un lot (le comptable ne l'a pas importé) : ses pièces redeviennent à transférer.</summary>
    public async Task<LotExport> AnnulerAsync(long id, Utilisateur u, CancellationToken ct)
    {
        var x = await db.Set<ExportEntite>().FirstOrDefaultAsync(e => e.CexId == id, ct) ?? throw ExceptionMetier.Introuvable($"Lot d'export {id}");
        if (x.CexAnnuleLe is not null) throw ExceptionMetier.Conflit("EXPORT_ANNULE", "Lot déjà annulé");
        // Une pièce exportée ensuite dans un autre lot non annulé reste transférée.
        var pieces = await db.Set<ExportPieceEntite>().Where(p => p.CepCexId == id).Select(p => p.CepPieceId).ToListAsync(ct);
        var ailleurs = await db.Set<ExportPieceEntite>().Where(p => pieces.Contains(p.CepPieceId) && p.CepCexId > id)
            .Join(db.Set<ExportEntite>().Where(e => e.CexAnnuleLe == null), p => p.CepCexId, e => e.CexId, (p, e) => p.CepPieceId).ToListAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        x.CexAnnuleLe = DateTimeOffset.UtcNow;
        x.CexAnnulePar = u.Code;
        await db.SaveChangesAsync(ct);
        await specialisation.MarquerAsync(db, pieces.Except(ailleurs).ToList(), false, ct);
        await tx.CommitAsync(ct);
        return Lot(x);
    }
}
