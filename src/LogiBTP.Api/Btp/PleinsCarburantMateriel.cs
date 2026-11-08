using System.Globalization;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>Plein lu dans le fichier d'une carte carburant (nombres en texte décimal à point, lu par le module Import).</summary>
public sealed record PleinFichier(int Rang, string? Date, string? Carte, string? Immatriculation, string? Litres, string? Montant, string? Kilometrage);
public sealed record PleinsCarburantSaisis(List<PleinFichier>? Pleins);
public sealed record MaterielCarte(int Id, string? Carte, string? Immatriculation, string Compteurs);

/// <summary>
/// Écriture des pleins d'un fichier de cartes carburant (plan materiel-suites, lot 10, MO6) : rapprochement par numéro de
/// carte de la fiche matériel (db/281), sinon par immatriculation ; plein écrit en événement CARBURANT
/// (<see cref="CompteursMateriel.EnregistrerEvenementAsync"/>) avec relevé kilométrique si le matériel suit les kilomètres ;
/// plein déjà présent (même matériel, jour, litres et montant) ignoré.
/// </summary>
public static class PleinsCarburantMateriel
{
    /// <summary>Clé de comparaison d'une carte ou d'une immatriculation : majuscules, sans espace ni tiret.</summary>
    public static string Cle(string? v) => new([.. (v ?? "").Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant)]);

    /// <summary>Matériel d'un plein : la carte désigne un seul matériel, sinon l'immatriculation ; nul si aucun ou ambigu.</summary>
    public static int? Rapprocher(string? carte, string? immatriculation, IReadOnlyList<MaterielCarte> materiels)
    {
        if (Cle(carte) is { Length: > 0 } c && materiels.Where(m => Cle(m.Carte) == c).Select(m => m.Id).Distinct().ToList() is [var seul]) return seul;
        if (Cle(immatriculation) is { Length: > 0 } i && materiels.Where(m => Cle(m.Immatriculation) == i).Select(m => m.Id).Distinct().ToList() is [var un]) return un;
        return null;
    }

    private static decimal? Decimal(string? v) =>
        decimal.TryParse(v?.Trim(), NumberStyles.Number | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var d) ? d : null;

    public sealed record Rapport(int Ecrits, List<int> Doublons, List<int> NonRapproches, List<ErreurPlein> Erreurs);
    public sealed record ErreurPlein(int Rang, string Code);

    public static async Task<Rapport> EcrireAsync(LogiBtpContext db, IEnumerable<PleinFichier> pleins, string utilisateur, CancellationToken ct)
    {
        var materiels = await db.Database.SqlQueryRaw<MaterielCarte>("""
            SELECT mat_id AS id, mat_numero_carte AS carte, mat_immatriculation AS immatriculation, mat_compteurs AS compteurs FROM materiel
            """).ToListAsync(ct);
        var ecrits = 0;
        List<int> doublons = [], nonRapproches = [];
        List<ErreurPlein> erreurs = [];
        foreach (var p in pleins)
        {
            var date = DateOnly.TryParseExact(p.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var j) ? j : (DateOnly?)null;
            var litres = Decimal(p.Litres);
            var montant = Decimal(p.Montant);
            if (date is null || litres is not > 0 || montant is < 0) { erreurs.Add(new(p.Rang, date is null ? "EVT_DATE" : litres is not > 0 ? "EVT_LITRES" : "EVT_COUT")); continue; }
            if (Rapprocher(p.Carte, p.Immatriculation, materiels) is not { } id) { nonRapproches.Add(p.Rang); continue; }
            var existe = await db.Database.SqlQueryRaw<bool>("""
                SELECT EXISTS (SELECT 1 FROM materiel_evenement WHERE mev_mat_id = @m AND mev_type = 'CARBURANT' AND mev_date = @d
                    AND mev_litres = @l AND coalesce(mev_cout, 0) = @c) AS "Value"
                """, new NpgsqlParameter("m", id), new NpgsqlParameter("d", date.Value), new NpgsqlParameter("l", litres.Value), new NpgsqlParameter("c", montant ?? 0m)).FirstAsync(ct);
            if (existe) { doublons.Add(p.Rang); continue; }
            var km = Decimal(p.Kilometrage);
            var suitKm = materiels.First(m => m.Id == id).Compteurs is "KM" or "H_KM";
            var releve = suitKm && km is not null ? new ReleveSaisi(date, "KM", km, false, null) : null;
            var libelle = string.IsNullOrWhiteSpace(p.Carte) ? null : p.Carte.Trim();
            try
            {
                await CompteursMateriel.EnregistrerEvenementAsync(db, id, null, new EvenementSaisi("CARBURANT", date, null, libelle, null, montant, litres, null, releve), utilisateur, ct);
            }
            catch (ExceptionMetier) when (releve is not null)
            {
                // Kilométrage incohérent avec l'historique : le plein est écrit sans relevé.
                await CompteursMateriel.EnregistrerEvenementAsync(db, id, null, new EvenementSaisi("CARBURANT", date, null, libelle, null, montant, litres, null, null), utilisateur, ct);
            }
            ecrits++;
        }
        return new Rapport(ecrits, doublons, nonRapproches, erreurs);
    }
}
