using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Documents.Web;

/// <summary>
/// Conditions de paiement et échéancier des pièces (CONCEPTION-MARCHES-REGLEMENTS.md, Q19 à Q22) : condition du
/// document, sinon du tiers (<see cref="SpecialisationDocument{TDoc, TLigne, TComplet}.ReglementTiersAsync"/>), sinon par
/// défaut (ventes / achats) ; échéances calculées par <see cref="Echeances"/> à la validation des pièces à numérotation
/// continue ; retenue de garantie (postes de pied lig_pied_retenue dans le net) en échéance RETENUE sans date.
/// </summary>
public sealed class EcheancierDocument<TDoc, TLigne, TComplet>(DocumentDbContext<TDoc, TLigne> db, SpecialisationDocument<TDoc, TLigne, TComplet> specialisation)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
    where TComplet : DocumentComplet<TDoc, TLigne>, new()
{
    private const string CleDefauts = "conditions_paiement";
    private static readonly HashSet<string> Bases = ["NET", "FIN_MOIS", "JOUR"];

    private static List<LigneCondition> Lignes(ConditionPaiement c) =>
        c.CpaLignes.Deserialize<List<LigneCondition>>(JsonCalcul.Options) ?? [];

    public async Task<List<ConditionPaiementDto>> Conditions(bool toutes, CancellationToken ct) =>
        (await db.ConditionsPaiement.AsNoTracking().Where(c => toutes || c.CpaActif).OrderBy(c => c.CpaOrdre).ThenBy(c => c.CpaCode).ToListAsync(ct))
        .Select(c => new ConditionPaiementDto(c.CpaCode, c.CpaLibelle, Lignes(c), c.CpaOrdre, c.CpaActif)).ToList();

    public async Task<ConditionsDefaut> Defauts(CancellationToken ct)
    {
        var p = await db.ParametresDocument.AsNoTracking().FirstOrDefaultAsync(x => x.PdoCle == CleDefauts, ct);
        return p?.PdoValeur.Deserialize<ConditionsDefaut>(JsonCalcul.Options) ?? new ConditionsDefaut();
    }

    /// <summary>Conditions (administrateur) : une condition absente est supprimée, ou désactivée si un document l'utilise.</summary>
    public async Task<List<ConditionPaiementDto>> EnregistrerConditions(List<ConditionPaiementDto> conditions, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        var erreurs = new List<string>();
        foreach (var c in conditions)
        {
            if (string.IsNullOrWhiteSpace(c.Code) || c.Code.Length > 20) erreurs.Add("Code de condition obligatoire (20 caractères au plus)");
            if (string.IsNullOrWhiteSpace(c.Libelle)) erreurs.Add($"{c.Code} : libellé obligatoire");
            if (c.Lignes.Count > 0 && c.Lignes.Sum(l => l.Pct) != 100) erreurs.Add($"{c.Code} : la somme des pourcentages fait 100");
            foreach (var l in c.Lignes)
            {
                if (l.Pct <= 0 || l.Delai < 0) erreurs.Add($"{c.Code} : pourcentage positif et délai positif ou nul");
                if (!Bases.Contains(l.Base)) erreurs.Add($"{c.Code} : base {l.Base} inconnue (NET, FIN_MOIS, JOUR)");
                if (l.Base == "JOUR" && l.Jour is not (>= 1 and <= 31)) erreurs.Add($"{c.Code} : jour du mois entre 1 et 31");
            }
        }
        if (conditions.GroupBy(c => c.Code).Any(g => g.Count() > 1)) erreurs.Add("Codes de condition en double");
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide("CONDITION_PAIEMENT", string.Join(" ; ", erreurs.Distinct()));

        var existantes = await db.ConditionsPaiement.ToListAsync(ct);
        foreach (var c in conditions)
        {
            var e = existantes.FirstOrDefault(x => x.CpaCode == c.Code);
            if (e is null) db.ConditionsPaiement.Add(e = new ConditionPaiement { CpaCode = c.Code });
            e.CpaLibelle = c.Libelle;
            e.CpaLignes = JsonSerializer.SerializeToDocument(c.Lignes, JsonCalcul.Options);
            e.CpaOrdre = c.Ordre;
            e.CpaActif = c.Actif;
        }
        foreach (var e in existantes.Where(x => conditions.All(c => c.Code != x.CpaCode)))
        {
            if (await db.Documents.AnyAsync(d => d.EntCpaCode == e.CpaCode, ct)) e.CpaActif = false;
            else db.ConditionsPaiement.Remove(e);
        }
        await db.SaveChangesAsync(ct);
        return await Conditions(true, ct);
    }

    public async Task<ConditionsDefaut> EnregistrerDefauts(ConditionsDefaut d, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        foreach (var code in new[] { d.Vente, d.Achat }.Where(c => !string.IsNullOrEmpty(c)))
        {
            if (!await db.ConditionsPaiement.AnyAsync(c => c.CpaCode == code, ct)) throw ExceptionMetier.Invalide("CONDITION_PAIEMENT", $"Condition {code} inconnue");
        }
        var valeur = JsonSerializer.SerializeToDocument(d, JsonCalcul.Options);
        var p = await db.ParametresDocument.FirstOrDefaultAsync(x => x.PdoCle == CleDefauts, ct);
        if (p is null) db.ParametresDocument.Add(new ParametreDocument { PdoCle = CleDefauts, PdoValeur = valeur });
        else p.PdoValeur = valeur;
        await db.SaveChangesAsync(ct);
        return d;
    }

    /// <summary>Condition par défaut de la famille (A : achats, sinon ventes).</summary>
    public async Task<string?> Defaut(string famille, CancellationToken ct)
    {
        var d = await Defauts(ct);
        return famille == "A" ? d.Achat : d.Vente;
    }

    /// <summary>
    /// Condition et mode figés sur la pièce à la validation : ceux du document, sinon du tiers, sinon la condition par
    /// défaut ; une condition inconnue ou inactive du tiers est ignorée.
    /// </summary>
    public async Task Figer(TDoc doc, TypeDocument type, CancellationToken ct)
    {
        var tiers = doc.EntCpaCode is null || doc.EntModeReglement is null ? await specialisation.ReglementTiersAsync(db, doc, ct) : null;
        if (doc.EntCpaCode is null && tiers?.Condition is string c && await db.ConditionsPaiement.AnyAsync(x => x.CpaCode == c && x.CpaActif, ct)) doc.EntCpaCode = c;
        doc.EntCpaCode ??= await Defaut(type.TydFamille, ct);
        doc.EntModeReglement ??= tiers?.Mode;
    }

    /// <summary>Échéancier recalculé depuis la pièce enregistrée (net à payer, retenues, condition figée).</summary>
    public async Task Ecrire(long entId, CancellationToken ct)
    {
        var doc = await db.Documents.AsNoTracking().FirstAsync(d => d.EntId == entId, ct);
        var retenue = -(await db.Lignes.AsNoTracking()
            .Where(l => l.LigEntId == entId && l.LigPiedRetenue && l.LigTypePrix != "M")
            .SumAsync(l => l.LigMontantHt ?? 0, ct));
        var condition = doc.EntCpaCode is null ? null : await db.ConditionsPaiement.AsNoTracking().FirstOrDefaultAsync(c => c.CpaCode == doc.EntCpaCode, ct);
        // Départ : date de la pièce externe (facture du fournisseur), sinon date du document.
        var calcul = Echeances.Calculer(doc.EntDateExterne ?? doc.EntDate, doc.EntNetAPayer, condition is null ? [] : Lignes(condition), retenue, doc.EntModeReglement, doc.EntPrecisionMontant);
        // Mise à jour en place par rang : une échéance déjà pointée (nouvelle version d'une pièce dévalidée) garde son
        // identifiant ; les échéances en trop sont retirées (refus si elles sont pointées).
        var existantes = await db.Echeances.Where(x => x.EchEntId == entId).ToListAsync(ct);
        foreach (var e in calcul)
        {
            var x = existantes.FirstOrDefault(y => y.EchRang == e.Rang);
            if (x is null) db.Echeances.Add(x = new DocumentEcheance { EchEntId = entId, EchRang = (short)e.Rang });
            x.EchDate = e.Date;
            x.EchMontant = e.Montant;
            x.EchMode = e.Mode;
            x.EchNature = e.Nature;
            x.EchManuel = false;
        }
        db.Echeances.RemoveRange(existantes.Where(y => y.EchRang > calcul.Count));
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            throw ExceptionMetier.Conflit("ECHEANCES_POINTEES", "Échéance déjà pointée par un règlement : retirez d'abord le pointage");
        }
    }

    /// <summary>
    /// Échéancier modifié à la main (pièce validée) : dates, modes, découpage ; les totaux par nature (net à payer,
    /// retenue) restent ceux du calcul ; une retenue reçoit sa date de libération.
    /// </summary>
    public async Task<List<DocumentEcheance>> Modifier(long entId, List<EcheanceSaisie> saisie, CancellationToken ct)
    {
        var actuelles = await db.Echeances.Where(x => x.EchEntId == entId).ToListAsync(ct);
        if (actuelles.Count == 0) throw ExceptionMetier.Invalide("ECHEANCIER", "Échéancier calculé à la validation de la pièce");
        foreach (var nature in new[] { "NORMALE", "RETENUE" })
        {
            if (actuelles.Where(x => x.EchNature == nature).Sum(x => x.EchMontant) != saisie.Where(x => x.Nature == nature).Sum(x => x.Montant))
            {
                throw ExceptionMetier.Invalide("ECHEANCIER", nature == "NORMALE" ? "Le total des échéances reste égal au net à payer" : "Le total des retenues reste celui de la pièce");
            }
        }
        if (saisie.Any(x => x.Nature == "NORMALE" && x.Date is null)) throw ExceptionMetier.Invalide("ECHEANCIER", "Chaque échéance a une date");
        db.Echeances.RemoveRange(actuelles);
        short rang = 0;
        db.Echeances.AddRange(saisie.Select(x => new DocumentEcheance
        {
            EchEntId = entId, EchRang = ++rang, EchDate = x.Date, EchMontant = x.Montant, EchMode = x.Mode, EchNature = x.Nature, EchManuel = true,
        }));
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Une application peut référencer les échéances (pointages des règlements) : elles ne se suppriment plus.
            throw ExceptionMetier.Conflit("ECHEANCES_POINTEES", "Échéancier déjà pointé par des règlements : il ne se modifie plus");
        }
        return await db.Echeances.AsNoTracking().Where(x => x.EchEntId == entId).OrderBy(x => x.EchRang).ToListAsync(ct);
    }
}
