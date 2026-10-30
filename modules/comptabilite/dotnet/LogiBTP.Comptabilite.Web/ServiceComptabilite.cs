using System.Text.Json;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace LogiBTP.Comptabilite.Web;

/// <summary>
/// Module Comptabilité (base, lot 1) : paramètres, plan comptable, collectifs, catégories de TVA, taux de TVA et comptes
/// des tiers (par la spécialisation). Tout compte écrit passe par ReglesComptes (longueur, complétion, caractères).
/// </summary>
public sealed class ServiceComptabilite(ComptabiliteDbContext db, SpecialisationComptabilite specialisation)
{
    private static readonly string[] Types = ["GENERAL", "COLLECTIF", "TVA", "TRESORERIE"];
    private static readonly string[] Sens = ["VENTE", "ACHAT", "LES_DEUX", "AUCUN"];
    private static readonly JsonSerializerOptions Json = JsonSerializerOptions.Web;

    // ---- Paramètres ----

    private static T? Valeur<T>(Dictionary<string, string> p, string cle, T? defaut)
    {
        if (!p.TryGetValue(cle, out var v)) return defaut;
        try { return JsonSerializer.Deserialize<T>(v, Json) ?? defaut; } catch (JsonException) { return defaut; }
    }

    public async Task<ParametresComptabilite> ParametresAsync(CancellationToken ct)
    {
        var p = await db.Parametres.AsNoTracking().ToDictionaryAsync(x => x.PcpCle, x => x.PcpValeur, ct);
        return new(Valeur<int?>(p, "longueur_comptes_generaux", null), Valeur<int?>(p, "longueur_comptes_tiers", null),
            Valeur(p, "completer_zeros", false), Valeur(p, "prefixes_tiers", new Dictionary<string, string>()) ?? [], Valeur(p, "tva_sur_debits", false));
    }

    public async Task<ParametresComptabilite> EnregistrerParametresAsync(ParametresComptabilite s, Utilisateur u, CancellationToken ct)
    {
        if (s.LongueurComptesGeneraux is < 3 or > 20) throw ExceptionMetier.Invalide("CPT_PARAMETRE", "Longueur des comptes généraux : de 3 à 20");
        if (s.LongueurComptesTiers is < 3 or > ReglesComptes.LongueurTiersMax)
            throw ExceptionMetier.Invalide("CPT_PARAMETRE", $"Longueur des comptes de tiers : de 3 à {ReglesComptes.LongueurTiersMax}");
        var prefixes = new Dictionary<string, string>();
        foreach (var (type, prefixe) in s.PrefixesTiers ?? [])
        {
            var p = (prefixe ?? "").Trim().ToUpperInvariant();
            if (p.Length > 5 || p.Any(c => !char.IsAsciiLetterOrDigit(c))) throw ExceptionMetier.Invalide("CPT_PARAMETRE", $"Préfixe {type} : 5 lettres ou chiffres au plus");
            prefixes[type] = p;
        }
        var valeurs = new Dictionary<string, object?>
        {
            ["longueur_comptes_generaux"] = s.LongueurComptesGeneraux, ["longueur_comptes_tiers"] = s.LongueurComptesTiers,
            ["completer_zeros"] = s.CompleterZeros, ["prefixes_tiers"] = prefixes, ["tva_sur_debits"] = s.TvaSurDebits,
        };
        var existants = await db.Parametres.ToDictionaryAsync(x => x.PcpCle, ct);
        foreach (var (cle, v) in valeurs)
        {
            if (!existants.TryGetValue(cle, out var x)) db.Parametres.Add(x = new ParametreEntite { PcpCle = cle });
            x.PcpValeur = JsonSerializer.Serialize(v, Json);
            x.PcpMajPar = u.Code;
            x.PcpMajLe = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);
        return await ParametresAsync(ct);
    }

    // ---- Plan comptable ----

    private static string Message(string erreur) => ReglesComptes.Messages.GetValueOrDefault(erreur, erreur);

    private static bool Conforme(string code, ParametresComptabilite p) =>
        ReglesComptes.Normaliser(code, p.LongueurComptesGeneraux, p.CompleterZeros).Code == code;

    public async Task<List<CompteDto>> PlanAsync(CancellationToken ct)
    {
        var p = await ParametresAsync(ct);
        return (await db.Comptes.AsNoTracking().OrderBy(x => x.CptCode).ToListAsync(ct))
            .Select(x => new CompteDto(x.CptCode, x.CptLibelle, x.CptType, x.CptSens, x.CptLibelleCourt, x.CptLettrable, x.CptActif,
                ReglesComptes.Classe(x.CptCode), Conforme(x.CptCode, p)))
            .ToList();
    }

    /// <summary>Crée ou modifie un compte (le code saisi est normalisé ; un compte existant ne change pas de code).</summary>
    public async Task<CompteDto> EnregistrerCompteAsync(string? existant, CompteDto s, Utilisateur u, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(s.Libelle)) throw ExceptionMetier.Invalide("CPT_LIBELLE", "Libellé du compte obligatoire");
        if (!Types.Contains(s.Type)) throw ExceptionMetier.Invalide("CPT_TYPE", $"Type de compte inconnu : {s.Type}");
        if (!Sens.Contains(s.Sens)) throw ExceptionMetier.Invalide("CPT_SENS", $"Sens d'usage inconnu : {s.Sens}");
        CompteEntite? x;
        if (existant is not null)
        {
            x = await db.Comptes.FindAsync([existant], ct) ?? throw ExceptionMetier.Introuvable($"Compte {existant}");
        }
        else
        {
            var p = await ParametresAsync(ct);
            var r = ReglesComptes.Normaliser(s.Code, p.LongueurComptesGeneraux, p.CompleterZeros);
            if (r.Erreur is string e) throw ExceptionMetier.Invalide(e, $"{s.Code} : {Message(e)}");
            if (await db.Comptes.AnyAsync(c => c.CptCode == r.Code, ct)) throw ExceptionMetier.Conflit("CPT_EXISTE", $"Le compte {r.Code} existe déjà");
            db.Comptes.Add(x = new CompteEntite { CptCode = r.Code! });
        }
        x.CptLibelle = s.Libelle.Trim();
        x.CptType = s.Type;
        x.CptSens = s.Sens;
        x.CptLibelleCourt = string.IsNullOrWhiteSpace(s.LibelleCourt) ? null : s.LibelleCourt.Trim();
        x.CptLettrable = s.Lettrable;
        x.CptActif = s.Actif;
        x.CptMajPar = u.Code;
        x.CptMajLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return (await PlanAsync(ct)).First(c => c.Code == x.CptCode);
    }

    /// <summary>Supprime un compte jamais utilisé ; un compte utilisé se désactive.</summary>
    public async Task SupprimerCompteAsync(string code, CancellationToken ct)
    {
        var x = await db.Comptes.FindAsync([code], ct) ?? throw ExceptionMetier.Introuvable($"Compte {code}");
        var usages = await specialisation.UtilisationsCompteAsync(db, code, ct);
        if (await db.Collectifs.AnyAsync(c => c.ColCptCode == code, ct)) usages.Insert(0, "collectif d'un type de tiers");
        if (await db.Ventilations.AnyAsync(v => v.VcoCptCode == code, ct)) usages.Insert(0, "clés de ventilation");
        if (await db.TypesComptables.AnyAsync(t => t.TcoCptDefaut == code || t.TcoCptRemise == code || t.TcoCptRetenue == code || t.TcoCptAcompte == code
            || t.TcoCptPaiementDirect == code || t.TcoCptProrata == code || t.TcoCptEcartDebit == code || t.TcoCptEcartCredit == code, ct))
            usages.Insert(0, "types comptables");
        if (usages.Count > 0) throw ExceptionMetier.Conflit("CPT_UTILISE", $"Compte {code} utilisé ({string.Join(", ", usages)}) : désactivez-le plutôt");
        db.Comptes.Remove(x);
        await db.SaveChangesAsync(ct);
    }

    private async Task ControlerComptesExistent(IEnumerable<string?> codes, string quoi, CancellationToken ct)
    {
        var l = codes.Where(c => !string.IsNullOrWhiteSpace(c)).Select(c => c!).Distinct().ToList();
        var connus = await db.Comptes.Where(c => l.Contains(c.CptCode)).Select(c => c.CptCode).ToListAsync(ct);
        var inconnus = l.Except(connus).ToList();
        if (inconnus.Count > 0) throw ExceptionMetier.Invalide("CPT_INCONNU", $"{quoi} : compte absent du plan comptable ({string.Join(", ", inconnus)})");
    }

    // ---- Collectifs ----

    public async Task<List<CollectifDto>> CollectifsAsync(CancellationToken ct) =>
        await db.Collectifs.AsNoTracking().OrderBy(x => x.ColOrdre).Select(x => new CollectifDto(x.ColCode, x.ColLibelle, x.ColCptCode, x.ColOrdre)).ToListAsync(ct);

    /// <summary>Comptes des collectifs (les types de tiers sont déclarés par l'application).</summary>
    public async Task<List<CollectifDto>> EnregistrerCollectifsAsync(List<CollectifDto> l, CancellationToken ct)
    {
        await ControlerComptesExistent(l.Select(c => c.Compte), "Collectifs", ct);
        var existants = await db.Collectifs.ToDictionaryAsync(x => x.ColCode, ct);
        foreach (var c in l)
        {
            if (!existants.TryGetValue(c.Code, out var x)) throw ExceptionMetier.Introuvable($"Collectif {c.Code}");
            x.ColCptCode = string.IsNullOrWhiteSpace(c.Compte) ? null : c.Compte;
        }
        await db.SaveChangesAsync(ct);
        return await CollectifsAsync(ct);
    }

    // ---- Catégories et taux de TVA ----

    public async Task<List<CategorieTvaDto>> CategoriesTvaAsync(CancellationToken ct) =>
        await db.CategoriesTva.AsNoTracking().OrderBy(x => x.CtvOrdre).ThenBy(x => x.CtvCode)
            .Select(x => new CategorieTvaDto(x.CtvCode, x.CtvLibelle, x.CtvComportement, x.CtvMention, x.CtvExigibilite, x.CtvOrdre, x.CtvActif)).ToListAsync(ct);

    /// <summary>Liste complète : une catégorie retirée est supprimée si aucun taux ne s'y rattache.</summary>
    public async Task<List<CategorieTvaDto>> EnregistrerCategoriesTvaAsync(List<CategorieTvaDto> l, CancellationToken ct)
    {
        foreach (var c in l)
        {
            if (string.IsNullOrWhiteSpace(c.Code) || string.IsNullOrWhiteSpace(c.Libelle)) throw ExceptionMetier.Invalide("TVA_CATEGORIE", "Code et libellé de la catégorie obligatoires");
            if (c.Comportement is not ("N" or "A" or "I" or "E")) throw ExceptionMetier.Invalide("TVA_COMPORTEMENT", $"{c.Libelle} : comportement inconnu");
            if (c.Exigibilite is not (null or "E" or "D")) throw ExceptionMetier.Invalide("TVA_EXIGIBILITE", $"{c.Libelle} : exigibilité inconnue");
        }
        var codes = l.Select(c => c.Code.Trim().ToUpperInvariant()).ToList();
        if (codes.Distinct().Count() != codes.Count) throw ExceptionMetier.Invalide("TVA_DOUBLON", "Même catégorie deux fois");
        var existants = await db.CategoriesTva.ToDictionaryAsync(x => x.CtvCode, ct);
        foreach (var retiree in existants.Keys.Except(codes))
        {
            if (await specialisation.TauxDeCategorieAsync(db, retiree, ct) > 0)
                throw ExceptionMetier.Conflit("TVA_CATEGORIE_UTILISEE", $"Catégorie {retiree} rattachée à des taux : désactivez-la plutôt");
            db.CategoriesTva.Remove(existants[retiree]);
        }
        for (var i = 0; i < l.Count; i++)
        {
            var c = l[i];
            if (!existants.TryGetValue(codes[i], out var x)) db.CategoriesTva.Add(x = new CategorieTvaEntite { CtvCode = codes[i] });
            x.CtvLibelle = c.Libelle.Trim();
            x.CtvComportement = c.Comportement;
            x.CtvMention = string.IsNullOrWhiteSpace(c.Mention) ? null : c.Mention.Trim();
            x.CtvExigibilite = c.Exigibilite;
            x.CtvOrdre = (i + 1) * 10;
            x.CtvActif = c.Actif;
        }
        await db.SaveChangesAsync(ct);
        return await CategoriesTvaAsync(ct);
    }

    public Task<List<TauxTvaDto>> TauxAsync(CancellationToken ct) => specialisation.TauxAsync(db, ct);

    /// <summary>
    /// Catégorie connue et comportement repris d'elle ; comptes du plan comptable ; ordre = position dans la liste ;
    /// un seul taux par défaut, actif.
    /// </summary>
    public async Task<List<TauxTvaDto>> EnregistrerTauxAsync(List<TauxTvaDto> l, CancellationToken ct)
    {
        var defauts = l.Where(t => t.Defaut).ToList();
        if (defauts.Count > 1) throw ExceptionMetier.Invalide("TVA_DEFAUT", "Un seul taux de TVA par défaut");
        if (defauts.Count == 1 && !defauts[0].Actif) throw ExceptionMetier.Invalide("TVA_DEFAUT", $"{defauts[0].Code} : le taux par défaut doit être actif");
        var categories = await db.CategoriesTva.AsNoTracking().ToDictionaryAsync(x => x.CtvCode, ct);
        var corriges = new List<TauxTvaDto>();
        foreach (var (t, i) in l.Select((t, i) => (t with { Ordre = (i + 1) * 10 }, i)))
        {
            if (t.Categorie is null) { corriges.Add(t); continue; }
            if (!categories.TryGetValue(t.Categorie, out var c)) throw ExceptionMetier.Invalide("TVA_CATEGORIE", $"{t.Code} : catégorie inconnue");
            corriges.Add(t with { Comportement = c.CtvComportement });
        }
        await ControlerComptesExistent(corriges.SelectMany(t => new[] { t.CompteCollectee, t.CompteCollecteeEncaissement, t.CompteDeductible, t.CompteAutoliquidee }), "Taux de TVA", ct);
        await specialisation.EnregistrerTauxAsync(db, corriges, ct);
        return await TauxAsync(ct);
    }

    // ---- Types comptables et ventilation ----

    private static TypeComptableDto Dto(TypeComptableEntite x) => new(x.TcoCode, x.TcoLibelle, x.TcoParent, x.TcoSens, x.TcoJournal, x.TcoJournalLibelle,
        x.TcoCptDefaut, x.TcoCptRemise, x.TcoCptRetenue, x.TcoRetenueCompteTiers, x.TcoCptAcompte, x.TcoCptPaiementDirect, x.TcoCptProrata,
        x.TcoCptEcartDebit, x.TcoCptEcartCredit, x.TcoOrdre, x.TcoActif);

    public async Task<List<TypeComptableDto>> TypesComptablesAsync(CancellationToken ct) =>
        (await db.TypesComptables.AsNoTracking().OrderBy(x => x.TcoOrdre).ToListAsync(ct)).Select(Dto).ToList();

    private static string? Vide(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>Types existants modifiés (les codes sont déclarés par l'application) ; parent connu, sans boucle.</summary>
    public async Task<List<TypeComptableDto>> EnregistrerTypesComptablesAsync(List<TypeComptableDto> l, CancellationToken ct)
    {
        var existants = await db.TypesComptables.ToDictionaryAsync(x => x.TcoCode, ct);
        foreach (var t in l)
        {
            if (!existants.ContainsKey(t.Code)) throw ExceptionMetier.Introuvable($"Type comptable {t.Code}");
            if (string.IsNullOrWhiteSpace(t.Libelle)) throw ExceptionMetier.Invalide("TCO_LIBELLE", "Libellé du type comptable obligatoire");
            if (t.Sens is not ("VENTE" or "ACHAT")) throw ExceptionMetier.Invalide("TCO_SENS", $"{t.Libelle} : sens inconnu");
            if (Vide(t.Journal) is { Length: > 10 }) throw ExceptionMetier.Invalide("TCO_JOURNAL", $"{t.Libelle} : code journal de 10 caractères au plus");
            if (Vide(t.Parent) is string p && !existants.ContainsKey(p)) throw ExceptionMetier.Invalide("TCO_PARENT", $"{t.Libelle} : type parent inconnu");
        }
        // Boucle : la chaîne d'un type s'arrête sur un type déjà vu alors que le dernier a encore un parent.
        var parents = existants.ToDictionary(x => x.Key, x => x.Value.TcoParent);
        foreach (var t in l) parents[t.Code] = Vide(t.Parent);
        var types = parents.Select(p => new TypeVentilation(p.Key, p.Value, null)).ToList();
        foreach (var t in l)
        {
            var chaine = ReglesVentilation.ChaineTypes(t.Code, types);
            if (parents.GetValueOrDefault(chaine[^1]) is not null)
                throw ExceptionMetier.Invalide("TCO_BOUCLE", $"{t.Libelle} : les types parents forment une boucle");
        }
        await ControlerComptesExistent(l.SelectMany(t => new[] { t.CompteDefaut, t.CompteRemise, t.CompteRetenue, t.CompteAcompte, t.ComptePaiementDirect,
            t.CompteProrata, t.CompteEcartDebit, t.CompteEcartCredit }), "Types comptables", ct);
        foreach (var t in l)
        {
            var x = existants[t.Code];
            x.TcoLibelle = t.Libelle.Trim();
            x.TcoParent = Vide(t.Parent);
            x.TcoSens = t.Sens;
            x.TcoJournal = Vide(t.Journal)?.ToUpperInvariant();
            x.TcoJournalLibelle = Vide(t.JournalLibelle);
            x.TcoCptDefaut = Vide(t.CompteDefaut);
            x.TcoCptRemise = Vide(t.CompteRemise);
            x.TcoCptRetenue = Vide(t.CompteRetenue);
            x.TcoRetenueCompteTiers = t.RetenueCompteTiers;
            x.TcoCptAcompte = Vide(t.CompteAcompte);
            x.TcoCptPaiementDirect = Vide(t.ComptePaiementDirect);
            x.TcoCptProrata = Vide(t.CompteProrata);
            x.TcoCptEcartDebit = Vide(t.CompteEcartDebit);
            x.TcoCptEcartCredit = Vide(t.CompteEcartCredit);
            x.TcoActif = t.Actif;
        }
        await db.SaveChangesAsync(ct);
        return await TypesComptablesAsync(ct);
    }

    public async Task<List<CleVentilationDto>> VentilationAsync(CancellationToken ct) =>
        await db.Ventilations.AsNoTracking().OrderBy(x => x.VcoTcoCode).ThenBy(x => x.VcoNature).ThenBy(x => x.VcoTaux)
            .Select(x => new CleVentilationDto(x.VcoTcoCode, x.VcoNature, x.VcoTaux, x.VcoCptCode)).ToListAsync(ct);

    /// <summary>Clés d'un type comptable, liste complète (une clé sans compte est retirée) : nature et taux connus, sans doublon.</summary>
    public async Task<List<CleVentilationDto>> EnregistrerVentilationAsync(string type, List<CleVentilationDto> l, CancellationToken ct)
    {
        if (!await db.TypesComptables.AnyAsync(x => x.TcoCode == type, ct)) throw ExceptionMetier.Introuvable($"Type comptable {type}");
        var cles = l.Select(c => c with { Type = type, Nature = Vide(c.Nature), Taux = Vide(c.Taux), Compte = Vide(c.Compte) ?? "" })
            .Where(c => c.Compte != "").ToList();
        if (cles.Any(c => c.Nature is null && c.Taux is null))
            throw ExceptionMetier.Invalide("VCO_CLE", "Une clé porte une nature, un taux de TVA ou les deux (sinon : compte par défaut du type)");
        if (cles.GroupBy(c => (c.Nature, c.Taux)).FirstOrDefault(g => g.Count() > 1) is { } d)
            throw ExceptionMetier.Invalide("VCO_DOUBLON", $"Même clé deux fois ({d.Key.Nature ?? "toutes natures"} × {d.Key.Taux ?? "tous taux"})");
        var natures = (await specialisation.NaturesAsync(db, ct)).Select(n => n.Code).ToHashSet();
        var taux = (await specialisation.TauxAsync(db, ct)).Select(t => t.Code).ToHashSet();
        if (cles.FirstOrDefault(c => c.Nature is not null && !natures.Contains(c.Nature)) is { } n) throw ExceptionMetier.Invalide("VCO_NATURE", $"Nature inconnue : {n.Nature}");
        if (cles.FirstOrDefault(c => c.Taux is not null && !taux.Contains(c.Taux)) is { } x) throw ExceptionMetier.Invalide("VCO_TAUX", $"Taux de TVA inconnu : {x.Taux}");
        await ControlerComptesExistent(cles.Select(c => c.Compte), "Ventilation", ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Ventilations.Where(v => v.VcoTcoCode == type).ExecuteDeleteAsync(ct);
        db.Ventilations.AddRange(cles.Select(c => new VentilationEntite { VcoTcoCode = type, VcoNature = c.Nature, VcoTaux = c.Taux, VcoCptCode = c.Compte }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await VentilationAsync(ct);
    }

    public Task<List<NatureVentilation>> NaturesAsync(CancellationToken ct) => specialisation.NaturesAsync(db, ct);

    public Task<List<TypeDocumentComptable>> TypesDocumentsAsync(CancellationToken ct) => specialisation.TypesDocumentsAsync(db, ct);

    public async Task<List<TypeDocumentComptable>> EnregistrerTypesDocumentsAsync(List<TypeDocumentSaisi> l, CancellationToken ct)
    {
        var types = await db.TypesComptables.Select(x => x.TcoCode).ToListAsync(ct);
        if (l.FirstOrDefault(t => Vide(t.TypeComptable) is string c && !types.Contains(c)) is { } inconnu)
            throw ExceptionMetier.Invalide("TCO_INCONNU", $"{inconnu.Code} : type comptable inconnu");
        await specialisation.EnregistrerTypesDocumentsAsync(db, l.Select(t => t with { TypeComptable = Vide(t.TypeComptable) }).ToList(), ct);
        return await TypesDocumentsAsync(ct);
    }

    /// <summary>Paramétrage de la règle de ventilation (saisie des documents : compte hérité des lignes).</summary>
    public async Task<RegleVentilation> RegleAsync(CancellationToken ct)
    {
        var types = (await db.TypesComptables.AsNoTracking().Where(x => x.TcoActif).ToListAsync(ct))
            .Select(x => new TypeVentilationDto(x.TcoCode, x.TcoParent, x.TcoCptDefaut)).ToList();
        var documents = (await specialisation.TypesDocumentsAsync(db, ct)).ToDictionary(t => t.Code, t => t.TypeEffectif);
        return new(types, await VentilationAsync(ct), documents);
    }

    // ---- Tiers ----

    public async Task<List<TiersCompteDto>> TiersAsync(CancellationToken ct)
    {
        var collectifs = await db.Collectifs.AsNoTracking().ToDictionaryAsync(x => x.ColCode, x => x.ColCptCode, ct);
        var l = await specialisation.TiersAsync(db, ct);
        // Doublon : un même compte auxiliaire porté par deux tiers différents.
        var doublons = l.Where(t => t.Compte is not null).GroupBy(t => t.Compte!).Where(g => g.Select(t => t.TiersId).Distinct().Count() > 1).Select(g => g.Key).ToHashSet();
        return l.OrderBy(t => t.Compte is null).ThenBy(t => t.Compte).ThenBy(t => t.RaisonSociale)
            .Select(t => new TiersCompteDto(t.TiersId, t.TypeCompte, t.CodeTiers, t.RaisonSociale, t.Particulier, t.Actif, t.Compte, t.CompteSaisi is null && t.Compte is not null,
                t.CollectifType, t.CollectifSaisi ?? collectifs.GetValueOrDefault(t.CollectifType), t.CollectifSaisi is not null, t.Siret, t.TvaIntra,
                t.Compte is not null && doublons.Contains(t.Compte)))
            .ToList();
    }

    /// <summary>Comptes auxiliaires et collectifs saisis : normalisés, sans doublon entre tiers, collectifs du plan.</summary>
    public async Task<List<TiersCompteDto>> EnregistrerComptesTiersAsync(List<CompteTiersSaisi> l, CancellationToken ct)
    {
        var p = await ParametresAsync(ct);
        var normalises = new List<CompteTiersSaisi>();
        foreach (var s in l)
        {
            string? compte = null;
            if (!string.IsNullOrWhiteSpace(s.Compte))
            {
                var r = ReglesComptes.NormaliserTiers(s.Compte, p.LongueurComptesTiers);
                if (r.Erreur is string e) throw ExceptionMetier.Invalide(e, $"{s.Compte} : {Message(e)}");
                compte = r.Code;
            }
            normalises.Add(s with { Compte = compte, Collectif = string.IsNullOrWhiteSpace(s.Collectif) ? null : s.Collectif.Trim() });
        }
        await ControlerComptesExistent(normalises.Select(s => s.Collectif), "Collectif du tiers", ct);
        // Comptes après l'enregistrement (les saisies remplacent les comptes actuels) : un compte, un seul tiers. Un compte
        // retiré redevient hérité du même tiers, sans risque de doublon.
        var actuels = await specialisation.TiersAsync(db, ct);
        var noms = actuels.GroupBy(t => t.TiersId).ToDictionary(g => g.Key, g => g.First().RaisonSociale);
        var apres = actuels.Where(t => !normalises.Any(s => s.TiersId == t.TiersId && s.TypeCompte == t.TypeCompte))
            .Select(t => (t.TiersId, t.Compte)).Concat(normalises.Select(s => (s.TiersId, s.Compte)))
            .Where(x => x.Compte is not null);
        // Seuls les comptes saisis sont contrôlés : un doublon ancien n'empêche pas d'enregistrer autre chose.
        if (apres.GroupBy(x => x.Compte).FirstOrDefault(g => normalises.Any(s => s.Compte == g.Key) && g.Select(x => x.TiersId).Distinct().Count() > 1) is { } doublon)
            throw ExceptionMetier.Conflit("CPT_TIERS_DOUBLON", $"Le compte {doublon.Key} serait celui de plusieurs tiers : "
                + string.Join(", ", doublon.Select(x => noms.GetValueOrDefault(x.TiersId, x.TiersId.ToString())).Distinct()));
        await specialisation.EnregistrerComptesTiersAsync(db, normalises, ct);
        return await TiersAsync(ct);
    }

    /// <summary>
    /// Comptes auxiliaires manquants proposés (préfixe du type de compte + code du tiers) et enregistrés ; un compte déjà
    /// pris ou impossible à former est refusé et signalé. typeCompte : un seul type, sinon tous.
    /// </summary>
    public async Task<ResultatGeneration> GenererComptesTiersAsync(string? typeCompte, CancellationToken ct)
    {
        var p = await ParametresAsync(ct);
        var l = await specialisation.TiersAsync(db, ct);
        var pris = l.Where(t => t.Compte is not null).Select(t => t.Compte!).ToHashSet();
        var saisis = new List<CompteTiersSaisi>();
        var refus = new List<string>();
        foreach (var t in l.Where(t => t.Compte is null && t.Actif && (typeCompte is null || t.TypeCompte == typeCompte)))
        {
            // Type qui hérite d'un autre type du même tiers (sous-traitant → fournisseur) : le compte de l'autre suffit.
            if (specialisation.TypeHerite(t.TypeCompte) is string parent && l.Any(x => x.TiersId == t.TiersId && x.TypeCompte == parent)) continue;
            var r = ReglesComptes.Proposer(p.PrefixesTiers.GetValueOrDefault(t.TypeCompte), t.CodeTiers, p.LongueurComptesTiers);
            if (r.Erreur is string e) { refus.Add($"{t.RaisonSociale} : {Message(e)}"); continue; }
            if (!pris.Add(r.Code!)) { refus.Add($"{t.RaisonSociale} : compte {r.Code} déjà pris"); continue; }
            saisis.Add(new CompteTiersSaisi(t.TiersId, t.TypeCompte, r.Code, t.CollectifSaisi));
        }
        if (saisis.Count > 0) await specialisation.EnregistrerComptesTiersAsync(db, saisis, ct);
        return new(saisis.Count, refus);
    }
}

public sealed record DemandeGeneration(string? TypeCompte);

/// <summary>Branchement du module Comptabilité dans une application ASP.NET Core.</summary>
public static class Extensions
{
    public static IServiceCollection AddModuleComptabilite<TSpecialisation>(this IServiceCollection services, Action<IServiceProvider, DbContextOptionsBuilder> options)
        where TSpecialisation : SpecialisationComptabilite
    {
        services.AddDbContext<ComptabiliteDbContext>(options);
        services.AddSingleton<SpecialisationComptabilite, TSpecialisation>();
        services.AddScoped<ServiceComptabilite>();
        services.AddScoped<ServiceExport>();
        return services;
    }

    /// <summary>Routes HTTP du module, sous /comptabilite.</summary>
    public static RouteGroupBuilder MapModuleComptabilite(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/comptabilite");
        g.MapGet("/parametres", (ServiceComptabilite s, CancellationToken ct) => s.ParametresAsync(ct));
        g.MapPut("/parametres", (ParametresComptabilite p, HttpContext http, ServiceComptabilite s, CancellationToken ct) => s.EnregistrerParametresAsync(p, Utilisateur.Depuis(http), ct));
        g.MapGet("/plan", (ServiceComptabilite s, CancellationToken ct) => s.PlanAsync(ct));
        g.MapPost("/plan", (CompteDto c, HttpContext http, ServiceComptabilite s, CancellationToken ct) => s.EnregistrerCompteAsync(null, c, Utilisateur.Depuis(http), ct));
        g.MapPut("/plan/{code}", (string code, CompteDto c, HttpContext http, ServiceComptabilite s, CancellationToken ct) => s.EnregistrerCompteAsync(code, c, Utilisateur.Depuis(http), ct));
        g.MapDelete("/plan/{code}", async (string code, ServiceComptabilite s, CancellationToken ct) => { await s.SupprimerCompteAsync(code, ct); return Results.NoContent(); });
        g.MapGet("/collectifs", (ServiceComptabilite s, CancellationToken ct) => s.CollectifsAsync(ct));
        g.MapPut("/collectifs", (List<CollectifDto> l, ServiceComptabilite s, CancellationToken ct) => s.EnregistrerCollectifsAsync(l, ct));
        g.MapGet("/categories-tva", (ServiceComptabilite s, CancellationToken ct) => s.CategoriesTvaAsync(ct));
        g.MapPut("/categories-tva", (List<CategorieTvaDto> l, ServiceComptabilite s, CancellationToken ct) => s.EnregistrerCategoriesTvaAsync(l, ct));
        g.MapGet("/taux-tva", (ServiceComptabilite s, CancellationToken ct) => s.TauxAsync(ct));
        g.MapPut("/taux-tva", (List<TauxTvaDto> l, ServiceComptabilite s, CancellationToken ct) => s.EnregistrerTauxAsync(l, ct));
        g.MapGet("/types-comptables", (ServiceComptabilite s, CancellationToken ct) => s.TypesComptablesAsync(ct));
        g.MapPut("/types-comptables", (List<TypeComptableDto> l, ServiceComptabilite s, CancellationToken ct) => s.EnregistrerTypesComptablesAsync(l, ct));
        g.MapGet("/ventilation", (ServiceComptabilite s, CancellationToken ct) => s.VentilationAsync(ct));
        g.MapPut("/ventilation/{type}", (string type, List<CleVentilationDto> l, ServiceComptabilite s, CancellationToken ct) => s.EnregistrerVentilationAsync(type, l, ct));
        g.MapGet("/ventilation/regle", (ServiceComptabilite s, CancellationToken ct) => s.RegleAsync(ct));
        g.MapGet("/natures", (ServiceComptabilite s, CancellationToken ct) => s.NaturesAsync(ct));
        g.MapGet("/types-documents", (ServiceComptabilite s, CancellationToken ct) => s.TypesDocumentsAsync(ct));
        g.MapPut("/types-documents", (List<TypeDocumentSaisi> l, ServiceComptabilite s, CancellationToken ct) => s.EnregistrerTypesDocumentsAsync(l, ct));
        g.MapGet("/export/modeles", () => FormatExport.Modeles);
        g.MapGet("/export/modele", (ServiceExport s, CancellationToken ct) => s.ModeleAsync(ct));
        g.MapPut("/export/modele", (ModeleExport m, HttpContext http, ServiceExport s, CancellationToken ct) => s.EnregistrerModeleAsync(m, Utilisateur.Depuis(http), ct));
        g.MapPost("/export/apercu", (DemandeExport d, ServiceExport s, CancellationToken ct) => s.ApercuAsync(d, ct));
        g.MapPost("/export", (DemandeExport d, HttpContext http, ServiceExport s, CancellationToken ct) => s.ExporterAsync(d, Utilisateur.Depuis(http), ct));
        g.MapGet("/export", (ServiceExport s, CancellationToken ct) => s.LotsAsync(ct));
        g.MapGet("/export/{id:long}/fichier", async (long id, ServiceExport s, CancellationToken ct) =>
        {
            var (nom, contenu, type) = await s.FichierAsync(id, ct);
            return Results.File(contenu, type, nom);
        });
        g.MapPost("/export/{id:long}/annuler", (long id, HttpContext http, ServiceExport s, CancellationToken ct) => s.AnnulerAsync(id, Utilisateur.Depuis(http), ct));
        g.MapGet("/tiers", (ServiceComptabilite s, CancellationToken ct) => s.TiersAsync(ct));
        g.MapPut("/tiers", (List<CompteTiersSaisi> l, ServiceComptabilite s, CancellationToken ct) => s.EnregistrerComptesTiersAsync(l, ct));
        g.MapPost("/tiers/generer", (DemandeGeneration d, ServiceComptabilite s, CancellationToken ct) => s.GenererComptesTiersAsync(d.TypeCompte, ct));
        return api;
    }
}
