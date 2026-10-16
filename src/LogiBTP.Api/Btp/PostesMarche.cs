using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Poste de pied d'un marché (db/173) : portée G (pied global des factures, après TVA) ou C (modèle de pied des
/// commandes) ; type PAIEMENT_DIRECT (valeur saisie sur chaque facture, sous-traitant), PRORATA, REMISE, AUTRE.
/// </summary>
public sealed record PosteMarche(int? Id, string Portee, string Type, string Libelle, string Niveau, string Mode, decimal Valeur, short Sens,
    long? PerId, short Ordre, bool Actif);

/// <summary>
/// Postes de pied du marché (CONCEPTION-MARCHES-REGLEMENTS.md, Q5 à Q9, 11.3, 11.4) : lecture, enregistrement et
/// application aux pièces. Pied global des factures du marché : retenue de garantie (mar_retenue_pct, % du cumul TTC,
/// échéance RETENUE de l'échéancier) puis postes de portée G ; commandes : postes de portée C (modèle de pied). Lignes
/// système repérées par lig_proprietes.poste_marche ('R' ou l'identifiant du poste), synchronisées à la création depuis le
/// marché et à la validation ; un paiement direct garde la valeur saisie sur la facture.
/// </summary>
public static class PostesMarche
{
    public const string Marqueur = "poste_marche";
    public const string CleRetenue = "R";
    private static readonly HashSet<string> Types = ["PAIEMENT_DIRECT", "PRORATA", "REMISE", "AUTRE"];

    private const string SqlPostes = """
        SELECT coalesce(json_agg(json_build_object('id', mpo_id, 'portee', mpo_portee, 'type', mpo_type, 'libelle', mpo_libelle,
          'niveau', mpo_niveau, 'mode', mpo_mode, 'valeur', mpo_valeur, 'sens', mpo_sens, 'per_id', mpo_per_id, 'ordre', mpo_ordre,
          'actif', mpo_actif) ORDER BY mpo_ordre, mpo_id), '[]') AS "Value"
        FROM marche_poste WHERE mpo_mar_id = @id
        """;

    public static async Task<List<PosteMarche>> Lire(DbContext db, int marche, CancellationToken ct)
    {
        var json = await db.Database.SqlQueryRaw<string>(SqlPostes, new NpgsqlParameter("id", marche)).FirstAsync(ct);
        return JsonSerializer.Deserialize<List<PosteMarche>>(json, JsonCalcul.Options) ?? [];
    }

    /// <summary>Postes du marché remplacés (mêmes identifiants mis à jour : les lignes des pièces restent reliées).</summary>
    public static async Task<List<PosteMarche>> Enregistrer(DbContext db, int marche, List<PosteMarche> postes, CancellationToken ct)
    {
        var erreurs = new List<string>();
        foreach (var p in postes)
        {
            if (string.IsNullOrWhiteSpace(p.Libelle)) erreurs.Add("Libellé du poste obligatoire");
            if (!Types.Contains(p.Type)) erreurs.Add($"Type de poste {p.Type} inconnu");
            if (p.Portee is not ("G" or "C")) erreurs.Add("Portée G (factures) ou C (commandes)");
            if (p.Portee == "G" && p.Niveau != "TTC") erreurs.Add($"{p.Libelle} : le pied global des factures ne reçoit que des postes après TVA (TTC)");
            if (p.Niveau is not ("HT" or "TTC") || p.Mode is not ("P" or "M") || p.Sens is not (1 or -1)) erreurs.Add($"{p.Libelle} : niveau, mode ou sens invalide");
            if (p.Valeur < 0 || (p.Mode == "P" && p.Valeur > 100)) erreurs.Add($"{p.Libelle} : valeur positive (100 % au plus)");
        }
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide("POSTES_MARCHE", string.Join(" ; ", erreurs.Distinct()));

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var gardes = postes.Where(p => p.Id is not null).Select(p => p.Id!.Value).ToArray();
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM marche_poste WHERE mpo_mar_id = {marche} AND NOT (mpo_id = ANY({gardes}))", ct);
        short ordre = 0;
        foreach (var p in postes)
        {
            ordre++;
            if (p.Id is int id)
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE marche_poste SET mpo_portee = {p.Portee}, mpo_type = {p.Type}, mpo_libelle = {p.Libelle}, mpo_niveau = {p.Niveau},
                      mpo_mode = {p.Mode}, mpo_valeur = {p.Valeur}, mpo_sens = {p.Sens}, mpo_per_id = {p.PerId}, mpo_ordre = {ordre}, mpo_actif = {p.Actif}
                    WHERE mpo_id = {id} AND mpo_mar_id = {marche}
                    """, ct);
            }
            else
            {
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO marche_poste (mpo_mar_id, mpo_portee, mpo_type, mpo_libelle, mpo_niveau, mpo_mode, mpo_valeur, mpo_sens, mpo_per_id, mpo_ordre, mpo_actif)
                    VALUES ({marche}, {p.Portee}, {p.Type}, {p.Libelle}, {p.Niveau}, {p.Mode}, {p.Valeur}, {p.Sens}, {p.PerId}, {ordre}, {p.Actif})
                    """, ct);
            }
        }
        await tx.CommitAsync(ct);
        return await Lire(db, marche, ct);
    }

    /// <summary>
    /// Portée des postes pour un type de pièce : G pour les factures de vente (numérotation continue, hors avoirs), C pour
    /// une commande client (hors commande intermédiaire) ; null sinon.
    /// </summary>
    public static string? Portee(TypeDocument type, DocumentBtp doc)
    {
        if (doc.EntMarcheId is null || doc.EntNatureAvoir is not null) return null;
        if (type.TydCode == "V_COMMANDE") return doc.EntIntermediaire ? null : "C";
        // Avoirs (V_AVOIR…) : ils reprennent les lignes de la pièce qu'ils corrigent.
        return type.TydFamille == "V" && type.TydNumerotationContinue && !type.TydCode.EndsWith("_AVOIR", StringComparison.Ordinal) ? "G" : null;
    }

    /// <summary>Postes de la portée appliqués au document du marché (lignes système ajoutées, mises à jour ou retirées).</summary>
    public static async Task<bool> Appliquer(DbContext db, DocumentCompletBtp d, string portee, CancellationToken ct)
    {
        var marche = d.Document.EntMarcheId!.Value;
        var postes = (await Lire(db, marche, ct)).Where(p => p.Actif && p.Portee == portee).ToList();
        decimal? retenue = portee == "G"
            ? (await db.Database.SqlQuery<decimal?>($"SELECT mar_retenue_pct AS \"Value\" FROM marche WHERE mar_id = {marche}").ToListAsync(ct)).FirstOrDefault()
            : null;
        return Appliquer(d, postes, retenue);
    }

    /// <summary>Synchronisation des lignes système (règle pure, testable) ; vrai si le document a changé.</summary>
    public static bool Appliquer(DocumentCompletBtp d, IReadOnlyList<PosteMarche> postes, decimal? retenuePct)
    {
        var voulus = new List<(string Cle, PosteMarche Poste, bool Retenue)>();
        if (retenuePct is > 0)
        {
            voulus.Add((CleRetenue, new PosteMarche(null, "G", "AUTRE", "Retenue de garantie", "TTC", "P", retenuePct.Value, -1, null, 0, true), true));
        }
        voulus.AddRange(postes.Select(p => (p.Id!.Value.ToString(System.Globalization.CultureInfo.InvariantCulture), p, false)));

        var change = false;
        var systeme = d.Lignes.Where(l => l.LigParentId is null && Cle(l) is not null).ToList();
        foreach (var l in systeme.Where(l => voulus.All(v => v.Cle != Cle(l))))
        {
            d.Lignes.Remove(l);
            change = true;
        }
        var prochainId = Math.Min(0, d.Lignes.Count == 0 ? 0 : d.Lignes.Min(l => l.LigId)) - 1;
        foreach (var (cle, p, estRetenue) in voulus)
        {
            var l = systeme.FirstOrDefault(x => Cle(x) == cle && d.Lignes.Contains(x));
            if (l is null)
            {
                l = new DocumentLigneBtp { LigId = prochainId--, LigEntId = d.Document.EntId, LigParentId = null, LigTypePrix = "V" };
                l.LigProprietes = JsonSerializer.SerializeToDocument(new Dictionary<string, string> { [Marqueur] = cle });
                Placer(d, l, p.Niveau == "HT");
                change = true;
            }
            var tyl = p.Niveau == "HT" ? TL.PiedHt : TL.PiedTtc;
            var valeur = p.Type == "PAIEMENT_DIRECT" && l.LigPiedValeur is decimal saisie && l.LigId > 0 ? saisie : p.Valeur;
            var avant = (l.LigTylId, l.LigLibelleHtml, l.LigPiedMode, l.LigPiedBase, l.LigPiedSens, l.LigPiedValeur, l.LigPiedRetenue);
            l.LigTylId = tyl;
            l.LigLibelleHtml = p.Libelle;
            l.LigPiedMode = p.Mode;
            // % du cumul : TTC net (après remises et TVA) pour la retenue, premier poste du pied global ; TOTAL_TTC serait le TTC
            // du corps avant remises.
            l.LigPiedBase = p.Mode == "P" ? "CUMUL" : null;
            l.LigPiedSens = p.Sens;
            l.LigPiedValeur = valeur;
            l.LigPiedRetenue = estRetenue;
            change |= avant != (l.LigTylId, l.LigLibelleHtml, l.LigPiedMode, l.LigPiedBase, l.LigPiedSens, l.LigPiedValeur, l.LigPiedRetenue);
        }
        return change;
    }

    private static string? Cle(DocumentLigneBtp l) =>
        l.LigProprietes is { } p && p.RootElement.ValueKind == JsonValueKind.Object && p.RootElement.TryGetProperty(Marqueur, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() : null;

    /// <summary>Nouvelle ligne à la racine : HT avant la première ligne de TVA de la racine, TTC à la fin.</summary>
    private static void Placer(DocumentCompletBtp d, DocumentLigneBtp l, bool avantTva)
    {
        var racine = d.Lignes.Where(x => x.LigParentId is null).OrderBy(x => x.LigOrdre).ToList();
        var tva = avantTva ? racine.FirstOrDefault(x => x.LigTylId == TL.Tva) : null;
        if (tva is null)
        {
            l.LigOrdre = racine.Count == 0 ? 1 : racine.Max(x => x.LigOrdre) + 1;
        }
        else
        {
            l.LigOrdre = tva.LigOrdre;
            foreach (var x in racine.Where(x => x.LigOrdre >= tva.LigOrdre)) x.LigOrdre++;
        }
        d.Lignes.Add(l);
    }
}
