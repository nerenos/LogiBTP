using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Editions;
using LogiBTP.Socle.Web;
using LogiBTP.Socle;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Editions.Web;

/// <summary>Modèle enregistré (saisie du concepteur, import) : contenu au format du moteur.</summary>
public sealed record SaisieModele(string Libelle, string Genre, string? Cible, string? Source, List<string>? Types, JsonNode Contenu,
    string? NiveauAcces = null, List<string>? AccesProfils = null, string? Charte = null, bool Actif = true, int Ordre = 0);

/// <summary>Résumé d'un modèle dans une liste.</summary>
public sealed record ResumeModele(string Code, string Libelle, string Genre, string? Cible, string? Source, List<string> Types,
    string NiveauAcces, bool Fourni, bool ModifieLocal, bool Actif, int Ordre, int Version, bool Defaut);

/// <summary>Modèle par défaut d'un type.</summary>
public sealed record DefautModele(string Cible, string Type, string Modele);

/// <summary>Charte graphique saisie.</summary>
public sealed record SaisieCharte(string Libelle, JsonNode Contenu, bool Defaut = false);

/// <summary>
/// Tout ce qu'il faut pour éditer un élément, en un appel (§ 3.10) : modèle choisi et modèles disponibles, données,
/// charte, blocs liés et sous-rapports (fermeture des dépendances), ressources images, date du jour.
/// </summary>
public sealed record PreparationEdition(JsonObject Modele, List<ResumeModele> Modeles, JsonObject Donnees, JsonNode Charte,
    JsonObject Blocs, JsonObject Rapports, Dictionary<string, RessourceEdition> Ressources, string Aujourdhui, string Element,
    string? Presentation, string? Type);

/// <summary>Modèles, chartes et défauts ; préparation des éditions et production des PDF (moteur JS dans Jint).</summary>
public sealed class ServiceEdition(EditionDbContext db, SpecialisationEdition specialisation, PoolMoteursEdition pool)
{
    // ------------------------------------------------------------------ modèles

    public async Task<List<ResumeModele>> Modeles(string? cible, string? source, string? type, string? genre, Utilisateur u, CancellationToken ct)
    {
        var q = db.Modeles.AsNoTracking().AsQueryable();
        if (cible is not null) q = q.Where(m => m.MedCible == cible);
        if (source is not null) q = q.Where(m => m.MedSource == source);
        if (genre is not null) q = q.Where(m => m.MedGenre == genre);
        var liste = (await q.OrderBy(m => m.MedOrdre).ThenBy(m => m.MedLibelle).ToListAsync(ct))
            .Where(m => type is null || m.MedTypes.Count == 0 || m.MedTypes.Contains(type))
            .Where(m => specialisation.PeutUtiliser(m, u)).ToList();
        var defauts = await db.Defauts.AsNoTracking().Where(d => type == null || d.MddType == type).Select(d => d.MddMedId).ToListAsync(ct);
        return liste.Select(m => Resume(m, defauts.Contains(m.MedId))).ToList();
    }

    private static ResumeModele Resume(ModeleEdition m, bool defaut) => new(m.MedCode, m.MedLibelle, m.MedGenre, m.MedCible, m.MedSource,
        m.MedTypes, m.MedNiveauAcces, m.MedFourni, m.MedModifieLocal, m.MedActif, m.MedOrdre, m.MedVersion, defaut);

    public async Task<JsonObject> Modele(string code, Utilisateur u, CancellationToken ct)
    {
        var m = await Lire(code, ct);
        if (!specialisation.PeutUtiliser(m, u)) throw ExceptionMetier.AccesRefuse("EDITION");
        return VersJson(m);
    }

    private static JsonObject VersJson(ModeleEdition m) => new()
    {
        ["code"] = m.MedCode, ["libelle"] = m.MedLibelle, ["genre"] = m.MedGenre, ["cible"] = m.MedCible, ["source"] = m.MedSource,
        ["types"] = new JsonArray(m.MedTypes.Select(t => (JsonNode?)t).ToArray()), ["niveau_acces"] = m.MedNiveauAcces,
        ["acces_profils"] = new JsonArray(m.MedAccesProfils.Select(t => (JsonNode?)t).ToArray()), ["charte"] = m.MedCharte,
        ["fourni"] = m.MedFourni, ["modifie_local"] = m.MedModifieLocal, ["actif"] = m.MedActif, ["ordre"] = m.MedOrdre,
        ["version"] = m.MedVersion, ["contenu"] = JsonNode.Parse(m.MedContenu),
    };

    private async Task<ModeleEdition> Lire(string code, CancellationToken ct) =>
        await db.Modeles.FirstOrDefaultAsync(m => m.MedCode == code, ct) ?? throw ExceptionMetier.Introuvable($"Modèle d'édition {code}");

    /// <summary>
    /// Enregistrement d'un modèle (création ou modification) : formules et format contrôlés par le moteur, blocs et
    /// sous-rapports existants, aucun cycle d'inclusion ; dépendances tenues dans modele_edition_lien.
    /// </summary>
    public async Task<JsonObject> Enregistrer(string code, SaisieModele s, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.ParametrageRefuse();
        if (string.IsNullOrWhiteSpace(code) || code.Length > 80) throw ExceptionMetier.Invalide("MODELE_CODE", "Code de modèle obligatoire (80 caractères au plus)");
        var genre = s.Genre == "BLOC" ? "BLOC" : "RAPPORT";
        if (genre == "RAPPORT" && string.IsNullOrWhiteSpace(s.Cible)) throw ExceptionMetier.Invalide("MODELE_CIBLE", "Cible obligatoire pour un rapport");
        var json = s.Contenu.ToJsonString();
        var erreurs = await pool.ExecuterAsync(m => m.VerifierModele(json), ct);
        if (erreurs != "[]") throw ExceptionMetier.Invalide("MODELE_INVALIDE", "Modèle invalide", JsonNode.Parse(erreurs));
        var deps = Dependances.Lire(s.Contenu);
        await ControlerDependances(code, deps, ct);

        var m = await db.Modeles.FirstOrDefaultAsync(x => x.MedCode == code, ct);
        var maintenant = DateTimeOffset.UtcNow;
        if (m is null)
        {
            m = new ModeleEdition { MedCode = code, MedCreeLe = maintenant, MedCreePar = u.Code };
            db.Modeles.Add(m);
        }
        else if (m.MedFourni && m.MedContenu != json) m.MedModifieLocal = true;
        m.MedLibelle = s.Libelle;
        m.MedGenre = genre;
        m.MedCible = genre == "BLOC" ? null : s.Cible;
        m.MedSource = genre == "BLOC" ? null : s.Source;
        m.MedTypes = s.Types ?? [];
        m.MedContenu = json;
        m.MedNiveauAcces = NiveauConfidentialite.Tous.Contains(s.NiveauAcces) ? s.NiveauAcces : NiveauConfidentialite.Interne;
        m.MedAccesProfils = s.AccesProfils ?? [];
        m.MedCharte = string.IsNullOrWhiteSpace(s.Charte) ? null : s.Charte;
        m.MedActif = s.Actif;
        m.MedOrdre = s.Ordre;
        m.MedModifieLe = maintenant;
        m.MedModifiePar = u.Code;
        await db.SaveChangesAsync(ct);
        await EcrireLiens(m.MedId, deps, ct);
        return VersJson(await Lire(code, ct));
    }

    private async Task EcrireLiens(long medId, Dependances deps, CancellationToken ct)
    {
        await db.Liens.Where(l => l.MelMedId == medId).ExecuteDeleteAsync(ct);
        db.Liens.AddRange(deps.Blocs.Select(c => new ModeleEditionLien { MelMedId = medId, MelGenre = "BLOC", MelCode = c }));
        db.Liens.AddRange(deps.Rapports.Select(c => new ModeleEditionLien { MelMedId = medId, MelGenre = "RAPPORT", MelCode = c }));
        db.Liens.AddRange(deps.Ressources.Select(c => new ModeleEditionLien { MelMedId = medId, MelGenre = "RESSOURCE", MelCode = c }));
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Blocs et sous-rapports existants ; aucun cycle (A inclut B qui inclut A).</summary>
    private async Task ControlerDependances(string code, Dependances deps, CancellationToken ct)
    {
        var inclus = deps.Blocs.Concat(deps.Rapports).ToList();
        var existants = await db.Modeles.AsNoTracking().Where(m => inclus.Contains(m.MedCode)).Select(m => m.MedCode).ToListAsync(ct);
        var manquants = inclus.Except(existants).Where(c => c != code).ToList();
        if (manquants.Count > 0) throw ExceptionMetier.Invalide("BLOC_INTROUVABLE", $"Bloc ou sous-rapport introuvable : {string.Join(", ", manquants)}");
        var graphe = await Graphe(ct);
        graphe[code] = inclus;
        var chemin = Cycle(code, graphe, []);
        if (chemin is not null) throw ExceptionMetier.Invalide("MODELE_CYCLE", $"Inclusion circulaire : {string.Join(" → ", chemin)}");
    }

    private async Task<Dictionary<string, List<string>>> Graphe(CancellationToken ct)
    {
        var liens = await (from l in db.Liens.AsNoTracking()
                           join m in db.Modeles.AsNoTracking() on l.MelMedId equals m.MedId
                           where l.MelGenre != "RESSOURCE"
                           select new { m.MedCode, l.MelCode }).ToListAsync(ct);
        return liens.GroupBy(x => x.MedCode).ToDictionary(g => g.Key, g => g.Select(x => x.MelCode).ToList());
    }

    private static List<string>? Cycle(string code, Dictionary<string, List<string>> graphe, List<string> pile)
    {
        if (pile.Contains(code)) return [.. pile.Skip(pile.IndexOf(code)), code];
        pile.Add(code);
        foreach (var s in graphe.GetValueOrDefault(code) ?? [])
        {
            var r = Cycle(s, graphe, pile);
            if (r is not null) return r;
        }
        pile.RemoveAt(pile.Count - 1);
        return null;
    }

    /// <summary>Rapports et blocs qui utilisent ce modèle, directement ou non (avant de modifier un bloc lié).</summary>
    public async Task<List<ResumeModele>> Impacts(string code, CancellationToken ct)
    {
        var graphe = await Graphe(ct);
        var touches = new HashSet<string>();
        var aVoir = new Queue<string>([code]);
        while (aVoir.TryDequeue(out var c))
            foreach (var (parent, enfants) in graphe)
                if (enfants.Contains(c) && touches.Add(parent)) aVoir.Enqueue(parent);
        var modeles = await db.Modeles.AsNoTracking().Where(m => touches.Contains(m.MedCode)).ToListAsync(ct);
        return modeles.OrderBy(m => m.MedLibelle).Select(m => Resume(m, false)).ToList();
    }

    public async Task Supprimer(string code, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.ParametrageRefuse();
        var m = await Lire(code, ct);
        var utilisateurs = await (from l in db.Liens join p in db.Modeles on l.MelMedId equals p.MedId
                                  where l.MelCode == code && l.MelGenre != "RESSOURCE" select p.MedLibelle).ToListAsync(ct);
        if (utilisateurs.Count > 0) throw ExceptionMetier.Conflit("MODELE_UTILISE", $"Modèle utilisé par : {string.Join(", ", utilisateurs)}");
        if (await db.Defauts.AnyAsync(d => d.MddMedId == m.MedId, ct)) throw ExceptionMetier.Conflit("MODELE_DEFAUT", "Modèle par défaut d'un type : choisir un autre modèle par défaut avant de le supprimer");
        db.Modeles.Remove(m);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Copie d'un modèle (copie d'un bloc lié = bloc détaché, Q5) : nouveau modèle non fourni.</summary>
    public async Task<JsonObject> Copier(string code, string nouveau, string? libelle, Utilisateur u, CancellationToken ct)
    {
        var m = await Lire(code, ct);
        if (await db.Modeles.AnyAsync(x => x.MedCode == nouveau, ct)) throw ExceptionMetier.Conflit("MODELE_EXISTE", $"Le code {nouveau} existe déjà");
        return await Enregistrer(nouveau, new SaisieModele(libelle ?? $"{m.MedLibelle} (copie)", m.MedGenre, m.MedCible, m.MedSource, m.MedTypes,
            JsonNode.Parse(m.MedContenu)!, m.MedNiveauAcces, m.MedAccesProfils, m.MedCharte, m.MedActif, m.MedOrdre), u, ct);
    }

    public async Task<List<JsonObject>> Versions(string code, CancellationToken ct)
    {
        var m = await Lire(code, ct);
        var v = await db.Versions.AsNoTracking().Where(x => x.MevMedId == m.MedId).OrderByDescending(x => x.MevVersion).ToListAsync(ct);
        return v.Select(x => new JsonObject { ["version"] = x.MevVersion, ["le"] = x.MevLe, ["par"] = x.MevPar }).ToList();
    }

    // ------------------------------------------------------------------ chartes, défauts

    public async Task<List<JsonObject>> Chartes(CancellationToken ct) =>
        (await db.Chartes.AsNoTracking().OrderByDescending(c => c.CheDefaut).ThenBy(c => c.CheLibelle).ToListAsync(ct))
        .Select(c => new JsonObject { ["code"] = c.CheCode, ["libelle"] = c.CheLibelle, ["defaut"] = c.CheDefaut, ["contenu"] = JsonNode.Parse(c.CheContenu) }).ToList();

    public async Task<JsonObject> EnregistrerCharte(string code, SaisieCharte s, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.ParametrageRefuse();
        var json = s.Contenu.ToJsonString();
        var erreurs = await pool.ExecuterAsync(m => m.VerifierCharte(json), ct);
        if (erreurs != "[]") throw ExceptionMetier.Invalide("CHARTE_INVALIDE", "Charte invalide", JsonNode.Parse(erreurs));
        var c = await db.Chartes.FirstOrDefaultAsync(x => x.CheCode == code, ct);
        if (c is null) { c = new CharteEdition { CheCode = code }; db.Chartes.Add(c); }
        if (s.Defaut) await db.Chartes.Where(x => x.CheDefaut && x.CheCode != code).ExecuteUpdateAsync(x => x.SetProperty(y => y.CheDefaut, false), ct);
        c.CheLibelle = s.Libelle;
        c.CheContenu = json;
        c.CheDefaut = s.Defaut || c.CheDefaut;
        c.CheModifieLe = DateTimeOffset.UtcNow;
        c.CheModifiePar = u.Code;
        await db.SaveChangesAsync(ct);
        return new JsonObject { ["code"] = c.CheCode, ["libelle"] = c.CheLibelle, ["defaut"] = c.CheDefaut, ["contenu"] = JsonNode.Parse(c.CheContenu) };
    }

    public async Task<List<DefautModele>> Defauts(CancellationToken ct) =>
        await (from d in db.Defauts.AsNoTracking() join m in db.Modeles.AsNoTracking() on d.MddMedId equals m.MedId
               orderby d.MddCible, d.MddType select new DefautModele(d.MddCible, d.MddType, m.MedCode)).ToListAsync(ct);

    public async Task<DefautModele> EnregistrerDefaut(DefautModele d, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.ParametrageRefuse();
        var m = await Lire(d.Modele, ct);
        if (m.MedGenre != "RAPPORT" || m.MedCible != d.Cible) throw ExceptionMetier.Invalide("MODELE_CIBLE", $"Le modèle {d.Modele} n'édite pas la cible {d.Cible}");
        var e = await db.Defauts.FirstOrDefaultAsync(x => x.MddCible == d.Cible && x.MddType == d.Type, ct);
        if (e is null) db.Defauts.Add(new ModeleEditionDefaut { MddCible = d.Cible, MddType = d.Type, MddMedId = m.MedId });
        else e.MddMedId = m.MedId;
        await db.SaveChangesAsync(ct);
        return d;
    }

    // ------------------------------------------------------------------ éditions

    /// <summary>
    /// Préparation d'une édition : modèle (demandé, sinon dernier imprimé, sinon défaut du type, sinon le premier
    /// autorisé), données de la source, fermeture des blocs et sous-rapports, charte, ressources images.
    /// </summary>
    public async Task<PreparationEdition> Preparer(IServiceProvider services, DemandeEdition d, Utilisateur u, CancellationToken ct)
    {
        var source = specialisation.Sources.FirstOrDefault(s => s.Code == d.Source) ?? throw ExceptionMetier.Introuvable($"Source d'édition {d.Source}");
        var element = await specialisation.ElementAsync(services, d.Source, d.Id, u, ct) ?? throw ExceptionMetier.Introuvable("Élément à éditer");
        var modeles = await Modeles(source.Cible, source.Code, element.Type, "RAPPORT", u, ct);
        modeles = modeles.Where(m => m.Actif).ToList();
        if (modeles.Count == 0) throw ExceptionMetier.Invalide("AUCUN_MODELE", $"Aucun modèle d'édition pour {element.Libelle}");
        var choisi = (d.Modele is not null ? modeles.FirstOrDefault(m => m.Code == d.Modele) : null)
                     ?? (element.DernierModele is not null ? modeles.FirstOrDefault(m => m.Code == element.DernierModele) : null)
                     ?? modeles.FirstOrDefault(m => m.Defaut) ?? modeles[0];
        if (d.Modele is not null && choisi.Code != d.Modele) throw ExceptionMetier.AccesRefuse("EDITION");
        var m = await Lire(choisi.Code, ct);
        var contenu = JsonNode.Parse(m.MedContenu)!.AsObject();

        var donnees = await specialisation.DonneesAsync(services, d with { Modele = m.MedCode }, u, ct) ?? throw ExceptionMetier.Introuvable("Données de l'édition");
        // Fermeture des dépendances (blocs liés, sous-rapports), ressources de tous les modèles utilisés.
        var blocs = new JsonObject();
        var rapports = new JsonObject();
        var ressources = new HashSet<string>();
        var annexes = new HashSet<string>();
        var aVoir = new Queue<JsonObject>([contenu]);
        while (aVoir.TryDequeue(out var c))
        {
            var deps = Dependances.Lire(c);
            ressources.UnionWith(deps.Ressources);
            annexes.UnionWith(deps.SourcesAnnexes);
            foreach (var (code, cible) in deps.Blocs.Select(x => (x, blocs)).Concat(deps.Rapports.Select(x => (x, rapports))))
            {
                if (cible.ContainsKey(code)) continue;
                var inclus = await db.Modeles.AsNoTracking().FirstOrDefaultAsync(x => x.MedCode == code, ct);
                if (inclus is null) continue; // alerte du moteur (BLOC_INTROUVABLE)
                var json = JsonNode.Parse(inclus.MedContenu)!.AsObject();
                cible[code] = json;
                aVoir.Enqueue(json);
            }
        }
        if (annexes.Count > 0)
        {
            var sources = new JsonObject();
            foreach (var nom in annexes) sources[nom] = await specialisation.SourceAnnexeAsync(services, nom, donnees, u, ct);
            donnees["sources"] = sources;
        }
        var charte = await Charte(m.MedCharte ?? contenu["charte"]?.GetValue<string>(), ct);
        var images = ressources.Count > 0 ? await specialisation.RessourcesAsync(services, ressources, donnees, u, ct) : [];
        var resume = new JsonObject { ["code"] = m.MedCode, ["libelle"] = m.MedLibelle, ["version"] = m.MedVersion, ["niveau_acces"] = m.MedNiveauAcces, ["contenu"] = contenu };
        var presentation = d.Presentation ?? (choisi.Code == element.DernierModele ? element.DernierePresentation : null);
        return new PreparationEdition(resume, modeles, donnees, charte, blocs, rapports, images, specialisation.Aujourdhui().ToString("yyyy-MM-dd"),
            element.Libelle, presentation, element.Type);
    }

    private async Task<JsonNode> Charte(string? code, CancellationToken ct)
    {
        var c = (code is not null ? await db.Chartes.AsNoTracking().FirstOrDefaultAsync(x => x.CheCode == code, ct) : null)
                ?? await db.Chartes.AsNoTracking().FirstOrDefaultAsync(x => x.CheDefaut, ct);
        return c is null ? new JsonObject() : JsonNode.Parse(c.CheContenu)!;
    }

    /// <summary>
    /// PDF d'une édition produit par le serveur (même moteur que l'aperçu, dans Jint) ; `imprimer` : impression
    /// (dernier modèle retenu sur l'élément, Q13), sinon simple téléchargement ; `pdfa` : option PDF/A-3 de l'hôte
    /// (env.pdf.pdfa du moteur, pdfa.js : fichiers associés, schémas d'extension XMP), absente : PDF habituel.
    /// </summary>
    public async Task<(PdfEdition Pdf, string Nom, PreparationEdition Preparation)> Pdf(IServiceProvider services, DemandeEdition d, bool imprimer, Utilisateur u,
        CancellationToken ct, JsonNode? pdfa = null)
    {
        var p = await Preparer(services, d, u, ct);
        var env = Env(p, d, u, pdfa);
        var modele = p.Modele["contenu"]!.ToJsonString();
        var donnees = p.Donnees.ToJsonString();
        var pdf = await pool.ExecuterAsync(m => m.Pdf(modele, donnees, env), ct);
        var code = p.Modele["code"]!.GetValue<string>();
        if (imprimer) await specialisation.ApresImpressionAsync(services, d, code, pdf.Presentation ?? p.Presentation, u, ct);
        return (pdf, NomFichier(p.Element), p);
    }

    /// <summary>Environnement du moteur : charte, blocs, sous-rapports, paramètres, format, ressources, propriétés du PDF.</summary>
    public string Env(PreparationEdition p, DemandeEdition d, Utilisateur u, JsonNode? pdfa = null)
    {
        var parametres = new JsonObject();
        foreach (var (k, v) in d.Parametres ?? []) parametres[k] = JsonNode.Parse(v.GetRawText());
        var ressources = new JsonObject();
        foreach (var (k, r) in p.Ressources)
            ressources[k] = new JsonObject { ["type"] = r.Type, ["base64"] = r.Base64, ["largeur"] = r.Largeur, ["hauteur"] = r.Hauteur, ["dpi"] = r.Dpi, ["orientation"] = r.Orientation };
        var env = new JsonObject
        {
            ["charte"] = p.Charte.DeepClone(), ["blocs"] = p.Blocs.DeepClone(), ["rapports"] = p.Rapports.DeepClone(), ["parametres"] = parametres,
            ["presentation"] = p.Presentation, ["format"] = d.Format, ["orientation"] = d.Orientation, ["aujourdhui"] = p.Aujourdhui,
            ["ressources"] = ressources,
            ["pdf"] = new JsonObject { ["titre"] = p.Element, ["auteur"] = u.Code, ["date"] = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ") },
        };
        if (pdfa is not null) env["pdf"]!["pdfa"] = pdfa.DeepClone();
        return env.ToJsonString();
    }

    /// <summary>Nom de fichier sûr (lettres, chiffres, tirets) à partir du libellé de l'élément.</summary>
    public static string NomFichier(string libelle)
    {
        var s = new string(libelle.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : ' ').ToArray());
        s = string.Join('-', s.Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return (s.Length == 0 ? "edition" : s.Length > 80 ? s[..80] : s) + ".pdf";
    }

    // ------------------------------------------------------------------ export et import (Q17)

    /// <summary>
    /// Paquet d'un modèle : le modèle, les blocs et sous-rapports qu'il inclut (fermeture), sa charte et ses images
    /// (base64) ; format « logibtp-edition » versionné, à importer dans une autre base.
    /// </summary>
    public async Task<JsonObject> Exporter(IServiceProvider services, string code, Utilisateur u, CancellationToken ct)
    {
        var m = await Lire(code, ct);
        if (!specialisation.PeutUtiliser(m, u)) throw ExceptionMetier.AccesRefuse("EDITION");
        var inclus = new JsonArray();
        var vus = new HashSet<string> { code };
        var ressources = new HashSet<string>();
        var aVoir = new Queue<ModeleEdition>([m]);
        while (aVoir.TryDequeue(out var x))
        {
            var deps = Dependances.Lire(JsonNode.Parse(x.MedContenu));
            ressources.UnionWith(deps.Ressources);
            foreach (var c in deps.Blocs.Concat(deps.Rapports).Where(vus.Add))
            {
                var dep = await db.Modeles.AsNoTracking().FirstOrDefaultAsync(y => y.MedCode == c, ct);
                if (dep is null) continue;
                inclus.Add(VersJson(dep));
                aVoir.Enqueue(dep);
            }
        }
        var codeCharte = m.MedCharte ?? JsonNode.Parse(m.MedContenu)?["charte"]?.GetValue<string>();
        var charte = codeCharte is null ? null : await db.Chartes.AsNoTracking().FirstOrDefaultAsync(c => c.CheCode == codeCharte, ct);
        var images = ressources.Count > 0 ? await specialisation.RessourcesAsync(services, ressources, new JsonObject(), u, ct) : [];
        var r = new JsonObject();
        foreach (var (k, v) in images) r[k] = new JsonObject { ["type"] = v.Type, ["base64"] = v.Base64, ["largeur"] = v.Largeur, ["hauteur"] = v.Hauteur, ["dpi"] = v.Dpi };
        return new JsonObject
        {
            ["format"] = "logibtp-edition", ["version"] = 1, ["exporte_le"] = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"),
            ["modele"] = VersJson(m), ["inclus"] = inclus,
            ["charte"] = charte is null ? null : new JsonObject { ["code"] = charte.CheCode, ["libelle"] = charte.CheLibelle, ["contenu"] = JsonNode.Parse(charte.CheContenu) },
            ["ressources"] = r,
        };
    }

    /// <summary>
    /// Import d'un paquet (administrateur) : inclus d'abord (les blocs avant ceux qui les lient), puis le modèle ; code
    /// existant : LIER (l'existant est gardé), REMPLACER, ou RENOMMER (nouveau code, références réécrites) ; charte
    /// créée si absente ; images : celle de l'application par défaut, sinon créée depuis le paquet (Q17).
    /// </summary>
    public async Task<JsonObject> Importer(IServiceProvider services, DemandeImport d, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.ParametrageRefuse();
        var p = d.Paquet;
        if (p["format"]?.GetValue<string>() != "logibtp-edition") throw ExceptionMetier.Invalide("IMPORT_FORMAT", "Paquet de modèles d'édition attendu (format logibtp-edition)");
        if ((p["version"]?.GetValue<int>() ?? 0) > 1) throw ExceptionMetier.Invalide("IMPORT_VERSION", "Paquet d'une version plus récente de l'application");
        var conflits = d.Conflits is "REMPLACER" or "RENOMMER" ? d.Conflits : "LIER";
        var compteRendu = new JsonArray();

        // Charte : créée si elle n'existe pas (celle de la base est gardée sinon).
        if (p["charte"] is JsonObject ch && ch["code"]?.GetValue<string>() is { } codeCharte && !await db.Chartes.AnyAsync(c => c.CheCode == codeCharte, ct))
            await EnregistrerCharte(codeCharte, new SaisieCharte(ch["libelle"]?.GetValue<string>() ?? codeCharte, ch["contenu"]!.DeepClone()), u, ct);

        // Ordre : un modèle après ceux qu'il inclut.
        var tous = (p["inclus"] as JsonArray ?? []).OfType<JsonObject>().Append(p["modele"]!.AsObject()).ToList();
        var parCode = tous.ToDictionary(x => x["code"]!.GetValue<string>());
        var ordre = new List<string>();
        void Placer(string c, HashSet<string> pile)
        {
            if (ordre.Contains(c) || !parCode.ContainsKey(c) || !pile.Add(c)) return;
            var deps = Dependances.Lire(parCode[c]["contenu"]);
            foreach (var x in deps.Blocs.Concat(deps.Rapports)) Placer(x, pile);
            ordre.Add(c);
        }
        foreach (var c in parCode.Keys) Placer(c, []);

        var renommes = new Dictionary<string, string>();
        foreach (var c in ordre)
        {
            var x = parCode[c];
            var contenu = Renommer(x["contenu"]!.DeepClone(), renommes);
            var existe = await db.Modeles.AnyAsync(m => m.MedCode == c, ct);
            var cible = c;
            string action;
            if (!existe) action = "CREE";
            else if (conflits == "LIER") { compteRendu.Add(new JsonObject { ["code"] = c, ["action"] = "LIE" }); continue; }
            else if (conflits == "REMPLACER") action = "REMPLACE";
            else
            {
                var n = 1;
                cible = $"{c}_IMPORT";
                while (await db.Modeles.AnyAsync(m => m.MedCode == cible, ct)) cible = $"{c}_IMPORT{++n}";
                renommes[c] = cible;
                action = "RENOMME";
            }
            await Enregistrer(cible, new SaisieModele(x["libelle"]!.GetValue<string>(), x["genre"]?.GetValue<string>() ?? "RAPPORT", x["cible"]?.GetValue<string>(),
                x["source"]?.GetValue<string>(), (x["types"] as JsonArray)?.Select(t => t!.GetValue<string>()).ToList(), contenu,
                x["niveau_acces"]?.GetValue<string>(), (x["acces_profils"] as JsonArray)?.Select(t => t!.GetValue<string>()).ToList(),
                x["charte"]?.GetValue<string>(), x["actif"]?.GetValue<bool>() ?? true, x["ordre"]?.GetValue<int>() ?? 0), u, ct);
            compteRendu.Add(new JsonObject { ["code"] = c, ["action"] = action, ["nouveau_code"] = cible == c ? null : cible });
        }

        // Images : celle de l'application si elle existe, sinon créée depuis le paquet.
        var images = new JsonArray();
        if (p["ressources"] is JsonObject res && res.Count > 0)
        {
            var existantes = await specialisation.RessourcesAsync(services, res.Select(r => r.Key).ToList(), new JsonObject(), u, ct);
            foreach (var (code, r) in res)
            {
                if (existantes.ContainsKey(code)) { images.Add(new JsonObject { ["code"] = code, ["action"] = "EXISTANTE" }); continue; }
                var ressource = new RessourceEdition(r!["type"]!.GetValue<string>(), r["base64"]!.GetValue<string>(), r["largeur"]?.GetValue<int>() ?? 0, r["hauteur"]?.GetValue<int>() ?? 0);
                var creee = await specialisation.CreerRessourceAsync(services, code, ressource, u, ct);
                images.Add(new JsonObject { ["code"] = code, ["action"] = creee ? "CREEE" : "IGNOREE" });
            }
        }
        return new JsonObject { ["modeles"] = compteRendu, ["ressources"] = images };
    }

    /// <summary>Références renommées (blocs liés, sous-rapports) dans un contenu importé.</summary>
    private static JsonNode Renommer(JsonNode contenu, Dictionary<string, string> renommes)
    {
        if (renommes.Count == 0) return contenu;
        void Visiter(JsonNode? n)
        {
            if (n is JsonObject o)
            {
                foreach (var cle in new[] { "bloc", "rapport" })
                    if (o[cle] is JsonValue v && v.TryGetValue<string>(out var s) && renommes.TryGetValue(s, out var nouveau)) o[cle] = nouveau;
                foreach (var (_, x) in o.ToList()) Visiter(x);
            }
            else if (n is JsonArray a) foreach (var x in a) Visiter(x);
        }
        Visiter(contenu);
        return contenu;
    }

    // ------------------------------------------------------------------ production en GED (Q15)

    /// <summary>Production demandée (tâche de la file traitée en fond) ; même règle d'accès que l'aperçu.</summary>
    public async Task<EtatTache> Planifier(IServiceProvider services, DemandeProduction d, Utilisateur u, CancellationToken ct)
    {
        _ = await specialisation.ElementAsync(services, d.Edition.Source, d.Edition.Id, u, ct) ?? throw ExceptionMetier.Introuvable("Élément à éditer");
        var t = new TacheEdition
        {
            EttSource = d.Edition.Source, EttIdElement = d.Edition.Id, EttModele = d.Edition.Modele, EttPresentation = d.Edition.Presentation,
            EttMotif = d.Motif is "VALIDATION" or "ENVOI" or "LOT" ? d.Motif : "DEMANDE", EttCoffre = d.Coffre, EttDemandePar = u.Code,
            EttCreeLe = DateTimeOffset.UtcNow,
        };
        db.Taches.Add(t);
        await db.SaveChangesAsync(ct);
        return Etat(t);
    }

    private static EtatTache Etat(TacheEdition t) => new(t.EttId, t.EttMotif, t.EttEtat, t.EttModele, t.EttGedId, t.EttPages, t.EttErreur, t.EttCreeLe, t.EttTraiteLe);

    public async Task<List<EtatTache>> Taches(string source, string id, CancellationToken ct) =>
        (await db.Taches.AsNoTracking().Where(t => t.EttSource == source && t.EttIdElement == id).OrderByDescending(t => t.EttId).Take(20).ToListAsync(ct))
        .Select(Etat).ToList();

    /// <summary>
    /// Traite les tâches en attente de la base courante (au plus `max`) : préparation, PDF dans Jint, dépôt par
    /// l'application ; trois essais au plus, l'erreur est gardée sur la tâche. Renvoie le nombre de tâches traitées.
    /// </summary>
    public async Task<int> TraiterEnAttente(IServiceProvider services, int max, CancellationToken ct)
    {
        var traitees = 0;
        while (traitees < max)
        {
            // Prise exclusive d'une tâche (plusieurs serveurs sur la même base) : verrou sans attente, état EN_COURS.
            var ids = await db.Database.SqlQueryRaw<long>("""
                UPDATE edition_tache SET ett_etat = 'EN_COURS', ett_essais = ett_essais + 1
                WHERE ett_id = (SELECT ett_id FROM edition_tache
                                WHERE ett_etat = 'A_FAIRE' OR (ett_etat = 'ECHEC' AND ett_essais < 3 AND ett_traite_le < now() - interval '1 minute')
                                ORDER BY ett_id LIMIT 1 FOR UPDATE SKIP LOCKED)
                RETURNING ett_id AS "Value"
                """).ToListAsync(ct);
            if (ids.Count == 0) break;
            traitees++;
            var t = await db.Taches.FirstAsync(x => x.EttId == ids[0], ct);
            try
            {
                // Utilisateur de la production : le demandeur, avec les droits d'une tâche système (comme l'archivage de la GED).
                var u = new Utilisateur(string.IsNullOrEmpty(t.EttDemandePar) ? "editions_fond" : t.EttDemandePar, Profils.Admin);
                var d = new DemandeEdition(t.EttSource, t.EttIdElement, t.EttModele, t.EttPresentation);
                var p = await Preparer(services, d, u, ct);
                var env = Env(p, d, u);
                var modele = p.Modele["contenu"]!.ToJsonString();
                var donnees = p.Donnees.ToJsonString();
                var pdf = await pool.ExecuterAsync(m => m.Pdf(modele, donnees, env), ct);
                t.EttModele = p.Modele["code"]!.GetValue<string>();
                t.EttPresentation = pdf.Presentation ?? p.Presentation;
                t.EttPages = pdf.Pages;
                t.EttGedId = await specialisation.DeposerAsync(services, t, pdf, p, u, ct);
                t.EttEtat = "FAIT";
                t.EttErreur = null;
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                db.ChangeTracker.Clear();
                db.Taches.Attach(t);
                t.EttEtat = "ECHEC";
                t.EttErreur = e.Message;
            }
            t.EttTraiteLe = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
        }
        return traitees;
    }

    public Task<EditionRangee?> DerniereEdition(IServiceProvider services, string source, string id, Utilisateur u, CancellationToken ct) =>
        specialisation.DerniereEditionAsync(services, source, id, u, ct);

    /// <summary>Contrôle d'un modèle sans l'enregistrer (concepteur, import) : [{ chemin, code, message }].</summary>
    public async Task<JsonNode> Verifier(JsonNode contenu, CancellationToken ct)
    {
        var json = contenu.ToJsonString();
        return JsonNode.Parse(await pool.ExecuterAsync(m => m.VerifierModele(json), ct))!;
    }
}

/// <summary>Import d'un paquet de modèles : conflits de codes LIER (garder l'existant), REMPLACER, RENOMMER.</summary>
public sealed record DemandeImport(JsonObject Paquet, string Conflits = "LIER");

/// <summary>Demande de production en GED (bouton « Ranger en GED », lot).</summary>
public sealed record DemandeProduction(DemandeEdition Edition, string Motif = "DEMANDE", bool Coffre = false);

/// <summary>État d'une production.</summary>
public sealed record EtatTache(long Id, string Motif, string Etat, string? Modele, long? GedId, int? Pages, string? Erreur, DateTimeOffset CreeLe, DateTimeOffset? TraiteLe);

/// <summary>Dépendances d'un modèle lues dans son JSON : blocs liés, sous-rapports, ressources images, sources annexes.</summary>
public sealed record Dependances(List<string> Blocs, List<string> Rapports, List<string> Ressources, List<string> SourcesAnnexes)
{
    public static Dependances Lire(JsonNode? contenu)
    {
        var blocs = new SortedSet<string>(StringComparer.Ordinal);
        var rapports = new SortedSet<string>(StringComparer.Ordinal);
        var ressources = new SortedSet<string>(StringComparer.Ordinal);
        var annexes = new SortedSet<string>(StringComparer.Ordinal);
        void Visiter(JsonNode? n)
        {
            switch (n)
            {
                case JsonObject o:
                    var type = o["type"] is JsonValue t && t.TryGetValue<string>(out var s) ? s : null;
                    if (type == "bloc" && o["bloc"] is JsonValue b && b.TryGetValue<string>(out var cb)) blocs.Add(cb);
                    if (type == "sous_rapport" && o["rapport"] is JsonValue r && r.TryGetValue<string>(out var cr)) rapports.Add(cr);
                    if (type == "image" && o["ressource"] is JsonValue i && i.TryGetValue<string>(out var ci) && !ci.StartsWith('=') && !ci.Contains("{{")) ressources.Add(ci);
                    if (o["ressources"] is JsonArray lr) foreach (var x in lr) if (x is JsonValue v && v.TryGetValue<string>(out var cx)) ressources.Add(cx);
                    if (o["sources_annexes"] is JsonArray la) foreach (var x in la) if (x is JsonValue v && v.TryGetValue<string>(out var cx)) annexes.Add(cx);
                    foreach (var (_, v) in o) Visiter(v);
                    break;
                case JsonArray a:
                    foreach (var x in a) Visiter(x);
                    break;
            }
        }
        Visiter(contenu);
        return new([.. blocs], [.. rapports], [.. ressources], [.. annexes]);
    }
}
