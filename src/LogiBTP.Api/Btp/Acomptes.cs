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

/// <summary>Acompte demandé depuis le marché : % du montant HT du marché (P) ou montant (M), mode de déduction.</summary>
public sealed record DemandeAcompte(string? Libelle, string Saisie, decimal Valeur, string Deduction);

/// <summary>Mode d'acompte de la société : TRESORERIE (avance de trésorerie) ou CA (chiffre d'affaires).</summary>
public sealed record ModeAcomptes(string Mode);

/// <summary>
/// Acomptes des marchés (CONCEPTION-MARCHES-REGLEMENTS.md, Q10 à Q13, 11.1, 11.2 ; db/174) : mode de la société, demande
/// d'acompte (document V_DEMANDE_ACOMPTE au tiers du marché), émission de la facture (mode CA, avec TVA) ou du reçu
/// (trésorerie, sans TVA), déductions des factures d'avancement à leur validation (lignes système
/// lig_proprietes.poste_marche = « A&lt;mac_id&gt; ») : PREMIERE (en entier sur la première facture, plafonné à sa
/// période), DERNIERE (sur la facture qui atteint 100 % du marché), LINEAIRE (acompte × avancement cumulé − déjà
/// déduit). Trésorerie : poste TTC du pied global ; CA : poste HT dans le pied de chaque commande, au prorata de sa période.
/// </summary>
public static class Acomptes
{
    public const string Cle = "acomptes";
    private static readonly HashSet<string> Deductions = ["PREMIERE", "DERNIERE", "LINEAIRE"];

    public static async Task<ModeAcomptes> Mode(LogiBtpContext db, CancellationToken ct)
    {
        var p = await db.ParametresDocument.AsNoTracking().FirstOrDefaultAsync(x => x.PdoCle == Cle, ct);
        return p?.PdoValeur.Deserialize<ModeAcomptes>(JsonCalcul.Options) ?? new ModeAcomptes("TRESORERIE");
    }

    /// <summary>Mode de la société (administrateur) ; modifiable tant qu'aucun acompte n'existe (11.1).</summary>
    public static async Task<ModeAcomptes> EnregistrerMode(LogiBtpContext db, ModeAcomptes m, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        if (m.Mode is not ("TRESORERIE" or "CA")) throw ExceptionMetier.Invalide("MODE_ACOMPTE", "Mode TRESORERIE ou CA");
        var actuel = await Mode(db, ct);
        if (actuel.Mode != m.Mode && await db.Database.SqlQuery<int>($"SELECT count(*)::int AS \"Value\" FROM marche_acompte").FirstAsync(ct) > 0)
        {
            throw ExceptionMetier.Conflit("MODE_ACOMPTE", "Des acomptes existent déjà : le mode d'acompte ne change plus");
        }
        var valeur = JsonSerializer.SerializeToDocument(m, JsonCalcul.Options);
        var p = await db.ParametresDocument.FirstOrDefaultAsync(x => x.PdoCle == Cle, ct);
        if (p is null) db.ParametresDocument.Add(new ParametreDocument { PdoCle = Cle, PdoValeur = valeur });
        else p.PdoValeur = valeur;
        await db.SaveChangesAsync(ct);
        return m;
    }

    private const string SqlListe = """
        SELECT coalesce(json_agg(json_build_object(
          'id', a.mac_id, 'rang', a.mac_rang, 'libelle', a.mac_libelle, 'mode', a.mac_mode, 'saisie', a.mac_saisie, 'valeur', a.mac_valeur,
          'montant', a.mac_montant, 'deduction', a.mac_deduction,
          'demande', CASE WHEN dm.ent_id IS NULL THEN NULL ELSE json_build_object('ent_id', dm.ent_id, 'numero', dm.ent_numero, 'statut', sd.std_libelle, 'valide', dm.ent_verrouille) END,
          'piece', CASE WHEN pc.ent_id IS NULL THEN NULL ELSE json_build_object('ent_id', pc.ent_id, 'numero', pc.ent_numero, 'statut', sp.std_libelle,
                   'valide', pc.ent_verrouille, 'annule', sp.std_code = 'ANNULE', 'type', tp.tyd_libelle) END,
          'deduit', (SELECT coalesce(sum(x.acd_montant), 0) FROM acompte_deduction x JOIN document f ON f.ent_id = x.acd_ent_id
                     JOIN statut_document s ON s.std_id = f.ent_std_id WHERE x.acd_mac_id = a.mac_id AND s.std_code <> 'ANNULE'))
          ORDER BY a.mac_rang), '[]') AS "Value"
        FROM marche_acompte a
        LEFT JOIN document dm ON dm.ent_id = a.mac_demande_ent_id LEFT JOIN statut_document sd ON sd.std_id = dm.ent_std_id
        LEFT JOIN document pc ON pc.ent_id = a.mac_piece_ent_id LEFT JOIN statut_document sp ON sp.std_id = pc.ent_std_id
        LEFT JOIN type_document tp ON tp.tyd_id = pc.ent_tyd_id
        WHERE a.mac_mar_id = @id
        """;

    /// <summary>Acomptes du marché : demande, pièce (facture ou reçu), déduit (pièces non annulées), mode.</summary>
    public static async Task<JsonElement> Lire(LogiBtpContext db, int marche, CancellationToken ct)
    {
        var json = await db.Database.SqlQueryRaw<string>(SqlListe, new NpgsqlParameter("id", marche)).FirstAsync(ct);
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    /// <summary>
    /// Nouvel acompte : rang suivant, montant (% du marché HT, ou montant), demande d'acompte au tiers du marché (une
    /// ligne d'acompte, TVA du marché en mode CA, exonérée en trésorerie), à valider puis émettre.
    /// </summary>
    public static async Task<DocumentCompletBtp> Creer(LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents,
        int marche, DemandeAcompte d, Utilisateur u, CancellationToken ct)
    {
        if (d.Saisie is not ("P" or "M") || d.Valeur <= 0 || (d.Saisie == "P" && d.Valeur > 100)) throw ExceptionMetier.Invalide("ACOMPTE", "Acompte : % (100 au plus) ou montant positif");
        if (!Deductions.Contains(d.Deduction)) throw ExceptionMetier.Invalide("ACOMPTE", "Déduction PREMIERE, DERNIERE ou LINEAIRE");
        var mode = (await Mode(db, ct)).Mode;
        var m = await db.Database.SqlQuery<MarcheAcompteSql>($"""
            SELECT mar_libelle AS libelle, mar_code AS code, mar_tiers_id AS tiers, mar_montant_ht AS montant, mar_cha_id AS chantier,
                   (SELECT coalesce(max(mac_rang), 0) + 1 FROM marche_acompte WHERE mac_mar_id = mar_id)::int AS rang
            FROM marche WHERE mar_id = {marche}
            """).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Marché {marche}");
        if (m.Tiers is null) throw ExceptionMetier.Invalide("ACOMPTE", "Client du marché à renseigner avant un acompte");
        var montant = ArrondiCalcul.Arrondir(d.Saisie == "P" ? (m.Montant ?? 0) * d.Valeur / 100 : d.Valeur, 2);
        if (montant <= 0) throw ExceptionMetier.Invalide("ACOMPTE", "Montant du marché nul : saisir un montant");
        var libelle = string.IsNullOrWhiteSpace(d.Libelle) ? $"Acompte n° {m.Rang} – marché {m.Code}" : d.Libelle.Trim();

        var tyd = await TypesDocumentBtp.IdAsync(db, TypesDocument.VDemandeAcompte, ct);
        var cree = await documents.Creer(new CreationDocument { EntTydId = tyd, EntTiersId = m.Tiers, EntObjet = libelle }, u, ct);
        var c = await documents.Charger(cree.Document.EntId, ct);
        c.Document.EntMarcheId = marche;
        c.Document.EntChantierId = m.Chantier;
        // Mode CA : une ligne par taux de TVA du marché, au prorata du HT des lignes vendues de ses commandes (la dernière
        // prend l'arrondi) ; trésorerie : une ligne exonérée. Nature Prestation (P10).
        var taux = mode == "CA"
            ? await db.Database.SqlQuery<TauxAcompteSql>($"""
                SELECT l.lig_tva_id AS tva, sum(coalesce(l.lig_montant_ht, 0)) AS montant
                FROM marche_document x JOIN document_ligne l ON l.lig_ent_id = x.mdo_ent_id
                LEFT JOIN document_ligne p ON p.lig_id = l.lig_parent_id
                WHERE x.mdo_mar_id = {marche} AND l.lig_tva_id IS NOT NULL AND l.lig_tyl_id IN (2, 3) AND coalesce(l.lig_type_prix, 'V') = 'V'
                  AND (p.lig_id IS NULL OR p.lig_tyl_id <> 2)
                GROUP BY l.lig_tva_id HAVING sum(coalesce(l.lig_montant_ht, 0)) <> 0 ORDER BY 2 DESC
                """).ToListAsync(ct)
            : [];
        if (taux.Count == 0)
        {
            var exo = mode == "CA" ? null : await db.TauxTva.Where(t => t.TtvCategorie == "E" && t.TtvActif).Select(t => (int?)t.TtvId).FirstOrDefaultAsync(ct);
            exo ??= await db.TauxTva.Where(t => t.TtvActif).OrderByDescending(t => t.TtvDefaut).ThenByDescending(t => t.TtvTaux).Select(t => (int?)t.TtvId).FirstOrDefaultAsync(ct);
            taux = [new TauxAcompteSql(exo, 1)];
        }
        var totalBase = taux.Sum(t => t.Montant);
        var nature = await db.Database.SqlQuery<int?>($"SELECT nat_id AS \"Value\" FROM nature_element WHERE nat_code = 'PRE'").ToListAsync(ct);
        var ordre = c.Lignes.Where(l => l.LigParentId is null).Select(l => l.LigOrdre).DefaultIfEmpty(0).Max();
        foreach (var l in c.Lignes.Where(l => l.LigParentId is null)) l.LigOrdre += taux.Count;
        var reste = montant;
        for (var i = 0; i < taux.Count; i++)
        {
            var part = i == taux.Count - 1 ? reste : ArrondiCalcul.Arrondir(montant * taux[i].Montant / totalBase, 2);
            reste -= part;
            c.Lignes.Add(new DocumentLigneBtp
            {
                LigId = -1 - i, LigEntId = c.Document.EntId, LigOrdre = 1 + i, LigTylId = TL.Element, LigLibelleHtml = libelle, LigQte = 1, LigPv = part,
                LigPvFixe = true, LigTvaId = taux[i].Tva, LigNatId = nature.FirstOrDefault(), LigTypePrix = "V",
            });
        }
        ordre += taux.Count;
        if (!c.Lignes.Any(l => l.LigParentId is null && l.LigTylId == TL.Tva))
        {
            c.Lignes.Add(new DocumentLigneBtp { LigId = -100, LigEntId = c.Document.EntId, LigOrdre = ordre + 1, LigTylId = TL.Tva, LigLibelleHtml = "TVA", LigTypePrix = "V" });
        }
        var r = await documents.Enregistrer(c.Document.EntId, c, u, ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO marche_acompte (mac_mar_id, mac_rang, mac_libelle, mac_mode, mac_saisie, mac_valeur, mac_montant, mac_deduction, mac_demande_ent_id)
            VALUES ({marche}, {m.Rang}, {libelle}, {mode}, {d.Saisie}, {d.Valeur}, {montant}, {d.Deduction}, {c.Document.EntId})
            """, ct);
        return r.Document ?? c;
    }

    /// <summary>Facture (mode CA) ou reçu (trésorerie) de l'acompte : la demande validée est transformée.</summary>
    public static async Task<DocumentCompletBtp> Emettre(LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents,
        TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> transformations, int acompte, Utilisateur u, CancellationToken ct)
    {
        var a = await db.Database.SqlQuery<AcompteSql>($"""
            SELECT mac_mode AS mode, mac_demande_ent_id AS demande, mac_piece_ent_id AS piece FROM marche_acompte WHERE mac_id = {acompte}
            """).FirstOrDefaultAsync(ct) ?? throw ExceptionMetier.Introuvable($"Acompte {acompte}");
        if (a.Piece is not null && await db.Database.SqlQuery<string>($"""
                SELECT s.std_code AS "Value" FROM document d JOIN statut_document s ON s.std_id = d.ent_std_id WHERE d.ent_id = {a.Piece}
                """).FirstOrDefaultAsync(ct) is string statut && statut != "ANNULE")
        {
            throw ExceptionMetier.Conflit("ACOMPTE_EMIS", "La facture ou le reçu de cet acompte existe déjà");
        }
        if (a.Demande is not long demande) throw ExceptionMetier.Invalide("ACOMPTE", "Demande d'acompte introuvable");
        var doc = await db.Documents.AsNoTracking().FirstAsync(x => x.EntId == demande, ct);
        if (!doc.EntVerrouille) await documents.Valider(demande, new DemandeVersion { EntVersion = doc.EntVersion }, u, ct);
        var code = a.Mode == "CA" ? "V_FACTURE_ACOMPTE" : "V_RECU_ACOMPTE";
        var cible = await TypesDocumentBtp.IdAsync(db, code, ct);
        var piece = await transformations.Transformer(demande, new DemandeTransformation { CibleTydId = cible }, u, ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE marche_acompte SET mac_piece_ent_id = {piece.Document.EntId} WHERE mac_id = {acompte}", ct);
        return piece;
    }

    // ------------------------------------------------------------------ déductions

    /// <summary>Montant à déduire d'une facture d'avancement (positif ; négatif : reprise d'une déduction linéaire).</summary>
    public static decimal Montant(string deduction, decimal acompte, decimal dejaDeduit, decimal periode, decimal cumul, decimal marche)
    {
        var reste = acompte - dejaDeduit;
        var ratio = marche <= 0 ? 0 : Math.Min(1, cumul / marche);
        return deduction switch
        {
            "PREMIERE" => Math.Max(0, Math.Min(reste, periode)),
            "DERNIERE" => marche > 0 && cumul >= marche ? reste : 0,
            _ => ArrondiCalcul.Arrondir(acompte * ratio, 2) - dejaDeduit,
        };
    }

    /// <summary>Déduction calculée d'un acompte émis : acompte, déjà déduit par d'autres pièces, montant à déduire.</summary>
    private sealed record DeductionCalculee(AcompteEmisSql Acompte, decimal Montant);

    /// <summary>
    /// Déductions des acomptes émis du marché pour une facture d'avancement (montants de la période et du cumul lus sur
    /// ses lignes) : utilisées par <see cref="Appliquer"/> à la validation et par l'aperçu avant validation.
    /// </summary>
    private static async Task<(List<DeductionCalculee> Deductions, decimal Periode)> CalculerAsync(LogiBtpContext db, DocumentCompletBtp d, CancellationToken ct)
    {
        var marche = d.Document.EntMarcheId!.Value;
        var acomptes = await db.Database.SqlQuery<AcompteEmisSql>($"""
            SELECT a.mac_id AS id, a.mac_rang AS rang, a.mac_mode AS mode, a.mac_montant AS montant, a.mac_deduction AS deduction,
              (SELECT coalesce(sum(x.acd_montant), 0) FROM acompte_deduction x JOIN document f ON f.ent_id = x.acd_ent_id
               JOIN statut_document s ON s.std_id = f.ent_std_id WHERE x.acd_mac_id = a.mac_id AND s.std_code <> 'ANNULE' AND f.ent_id <> {d.Document.EntId}) AS deduit,
              a.mac_libelle AS libelle
            FROM marche_acompte a JOIN document p ON p.ent_id = a.mac_piece_ent_id JOIN statut_document sp ON sp.std_id = p.ent_std_id
            WHERE a.mac_mar_id = {marche} AND f_document_valable(p.ent_id, FALSE) ORDER BY a.mac_rang
            """).ToListAsync(ct);
        var avancees = d.Lignes.Where(l => l.LigAvtMode is not null && !TL.EstPied(l)).ToList();
        var periode = avancees.Sum(l => l.LigMontantHt ?? 0);
        var cumul = avancees.Sum(l => l.LigAvtMontantCumul ?? 0);
        var total = avancees.Sum(l => l.LigAvtMontantMarche ?? 0);
        var res = new List<DeductionCalculee>();
        foreach (var a in acomptes)
        {
            // Trésorerie : déduction TTC (plafond PREMIERE : TTC de la période, au taux moyen du document).
            var base_ = a.Mode == "CA" || d.Document.EntTotalHt == 0 ? periode : ArrondiCalcul.Arrondir(periode * d.Document.EntTotalTtc / d.Document.EntTotalHt, 2);
            res.Add(new DeductionCalculee(a, Montant(a.Deduction, a.Montant, a.Deduit, base_, cumul, total)));
        }
        return (res, periode);
    }

    /// <summary>
    /// Aperçu des déductions d'acompte d'une facture d'avancement d'un marché (onglet Règlements) : validée, les
    /// déductions écrites ; sinon celles que la validation posera, calculées sur la saisie enregistrée.
    /// </summary>
    public static async Task<object> ApercuAsync(LogiBtpContext db, DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp> documents, long id, CancellationToken ct)
    {
        var d = await documents.Charger(id, ct);
        var mode = (await Mode(db, ct)).Mode;
        if (d.Document.EntMarcheId is null || d.Document.EntNatureAvoir is not null) return new { mode, valide = d.Document.EntVerrouille, deductions = Array.Empty<object>() };
        var (calcul, _) = await CalculerAsync(db, d, ct);
        var ecrites = d.Document.EntVerrouille
            ? await db.Database.SqlQuery<DeductionEcriteSql>($"SELECT acd_mac_id AS acompte, acd_montant AS montant FROM acompte_deduction WHERE acd_ent_id = {id}").ToListAsync(ct)
            : null;
        return new
        {
            mode, valide = d.Document.EntVerrouille,
            deductions = calcul.Select(x => new
            {
                acompte = x.Acompte.Id, rang = x.Acompte.Rang, libelle = x.Acompte.Libelle, mode = x.Acompte.Mode, deduction = x.Acompte.Deduction,
                montant_acompte = x.Acompte.Montant, deja_deduit = x.Acompte.Deduit,
                a_deduire = ecrites is null ? x.Montant : ecrites.Where(e => e.Acompte == x.Acompte.Id).Sum(e => e.Montant),
                reste = x.Acompte.Montant - x.Acompte.Deduit - (ecrites is null ? x.Montant : ecrites.Where(e => e.Acompte == x.Acompte.Id).Sum(e => e.Montant)),
            }).Where(x => x.a_deduire != 0 || x.montant_acompte != x.deja_deduit).ToList(),
        };
    }

    /// <summary>
    /// Déductions des acomptes émis du marché posées dans une facture d'avancement avant le calcul de sa validation
    /// (montants de la période et du cumul lus sur les lignes enregistrées).
    /// </summary>
    public static async Task Appliquer(LogiBtpContext db, DocumentCompletBtp d, CancellationToken ct)
    {
        foreach (var l in d.Lignes.Where(l => (CleDe(l) ?? "").StartsWith('A')).ToList()) d.Lignes.Remove(l);
        var (deductions, periode) = await CalculerAsync(db, d, ct);
        if (deductions.Count == 0) return;
        var avancees = d.Lignes.Where(l => l.LigAvtMode is not null && !TL.EstPied(l)).ToList();
        var prochainId = Math.Min(0, d.Lignes.Count == 0 ? 0 : d.Lignes.Min(l => l.LigId)) - 1;
        foreach (var (a, montant) in deductions)
        {
            if (montant == 0) continue;
            var libelle = $"Déduction de l'acompte n° {a.Rang}";
            if (a.Mode != "CA")
            {
                var racine = d.Lignes.Where(x => x.LigParentId is null).Select(x => x.LigOrdre).DefaultIfEmpty(0).Max();
                d.Lignes.Add(Ligne(prochainId--, d, null, racine + 1, TL.PiedTtc, libelle, montant, $"A{a.Id}"));
                continue;
            }
            // Chiffre d'affaires : poste HT dans le pied de chaque commande (section), au prorata de sa période (11.2 a).
            var parents = d.Lignes.ToDictionary(l => l.LigId);
            long? Section(DocumentLigneBtp l)
            {
                var x = l;
                while (x.LigParentId is long p && parents.TryGetValue(p, out var parent)) x = parent;
                return x.LigTylId == TL.Section ? x.LigId : null;
            }
            var parSection = avancees.GroupBy(Section).Select(g => (Section: g.Key, Periode: g.Sum(l => l.LigMontantHt ?? 0))).Where(g => g.Periode != 0).ToList();
            if (parSection.Count == 0) parSection = [(null, periode)];
            var reste = montant;
            for (var i = 0; i < parSection.Count; i++)
            {
                var (section, p) = parSection[i];
                var part = i == parSection.Count - 1 || periode == 0 ? reste : ArrondiCalcul.Arrondir(montant * p / periode, 2);
                reste -= part;
                var freres = d.Lignes.Where(x => x.LigParentId == section).OrderBy(x => x.LigOrdre).ToList();
                var tva = freres.FirstOrDefault(x => x.LigTylId == TL.Tva);
                var ordre = tva?.LigOrdre ?? freres.Select(x => x.LigOrdre).DefaultIfEmpty(0).Max() + 1;
                if (tva is not null) foreach (var x in freres.Where(x => x.LigOrdre >= ordre)) x.LigOrdre++;
                d.Lignes.Add(Ligne(prochainId--, d, section, ordre, TL.PiedHt, libelle, part, $"A{a.Id}"));
            }
        }
    }

    /// <summary>Déductions de la facture validée écrites par acompte (montant positif = déduit).</summary>
    public static async Task Ecrire(LogiBtpContext db, long entId, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM acompte_deduction WHERE acd_ent_id = {entId}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO acompte_deduction (acd_mac_id, acd_ent_id, acd_montant)
            SELECT substr(l.lig_proprietes->>'poste_marche', 2)::int, l.lig_ent_id, -sum(coalesce(l.lig_montant_ht, 0))
            FROM document_ligne l
            WHERE l.lig_ent_id = {entId} AND l.lig_proprietes->>'poste_marche' LIKE 'A%'
            GROUP BY 1, 2
            """, ct);
    }

    private static DocumentLigneBtp Ligne(long id, DocumentCompletBtp d, long? parent, int ordre, short tyl, string libelle, decimal montant, string cle) => new()
    {
        LigId = id, LigEntId = d.Document.EntId, LigParentId = parent, LigOrdre = ordre, LigTylId = tyl, LigLibelleHtml = libelle, LigTypePrix = "V",
        LigPiedMode = "M", LigPiedSens = (short)(montant > 0 ? -1 : 1), LigPiedValeur = Math.Abs(montant),
        LigProprietes = JsonSerializer.SerializeToDocument(new Dictionary<string, string> { [PostesMarche.Marqueur] = cle }),
    };

    private static string? CleDe(DocumentLigneBtp l) =>
        l.LigProprietes is { } p && p.RootElement.ValueKind == JsonValueKind.Object && p.RootElement.TryGetProperty(PostesMarche.Marqueur, out var v)
            && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private sealed record MarcheAcompteSql(string Libelle, string Code, long? Tiers, decimal? Montant, int? Chantier, int Rang);
    private sealed record AcompteSql(string Mode, long? Demande, long? Piece);
    private sealed record TauxAcompteSql(int? Tva, decimal Montant);
    private sealed record AcompteEmisSql(int Id, short Rang, string Mode, decimal Montant, string Deduction, decimal Deduit, string? Libelle);
    private sealed record DeductionEcriteSql(int Acompte, decimal Montant);
}
