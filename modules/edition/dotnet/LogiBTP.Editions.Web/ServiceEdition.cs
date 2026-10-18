using System.Text.Json;
using System.Text.Json.Nodes;
using LogiBTP.Socle.Web;
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
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.AccesRefuse("PARAMETRER");
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
        m.MedNiveauAcces = s.NiveauAcces is "PUBLIC" or "INTERNE" or "CONFIDENTIEL" or "SECRET" ? s.NiveauAcces : "INTERNE";
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
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.AccesRefuse("PARAMETRER");
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
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.AccesRefuse("PARAMETRER");
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
        if (!specialisation.PeutParametrer(u)) throw ExceptionMetier.AccesRefuse("PARAMETRER");
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
    /// (dernier modèle retenu sur l'élément, Q13), sinon simple téléchargement.
    /// </summary>
    public async Task<(PdfEdition Pdf, string Nom, PreparationEdition Preparation)> Pdf(IServiceProvider services, DemandeEdition d, bool imprimer, Utilisateur u, CancellationToken ct)
    {
        var p = await Preparer(services, d, u, ct);
        var env = Env(p, d, u);
        var modele = p.Modele["contenu"]!.ToJsonString();
        var donnees = p.Donnees.ToJsonString();
        var pdf = await pool.ExecuterAsync(m => m.Pdf(modele, donnees, env), ct);
        var code = p.Modele["code"]!.GetValue<string>();
        if (imprimer) await specialisation.ApresImpressionAsync(services, d, code, pdf.Presentation ?? p.Presentation, u, ct);
        return (pdf, NomFichier(p.Element), p);
    }

    /// <summary>Environnement du moteur : charte, blocs, sous-rapports, paramètres, format, ressources, propriétés du PDF.</summary>
    public string Env(PreparationEdition p, DemandeEdition d, Utilisateur u)
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
        return env.ToJsonString();
    }

    /// <summary>Nom de fichier sûr (lettres, chiffres, tirets) à partir du libellé de l'élément.</summary>
    public static string NomFichier(string libelle)
    {
        var s = new string(libelle.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : ' ').ToArray());
        s = string.Join('-', s.Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return (s.Length == 0 ? "edition" : s.Length > 80 ? s[..80] : s) + ".pdf";
    }

    /// <summary>Contrôle d'un modèle sans l'enregistrer (concepteur, import) : [{ chemin, code, message }].</summary>
    public async Task<JsonNode> Verifier(JsonNode contenu, CancellationToken ct)
    {
        var json = contenu.ToJsonString();
        return JsonNode.Parse(await pool.ExecuterAsync(m => m.VerifierModele(json), ct))!;
    }
}

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
