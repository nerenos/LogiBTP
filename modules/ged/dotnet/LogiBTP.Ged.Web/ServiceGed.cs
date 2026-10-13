using System.Globalization;
using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

namespace LogiBTP.Ged.Web;

/// <summary>
/// Services du module GED (classe mère), mêmes règles que FournisseurGedMemoire : dépôt (contenu rangé par empreinte),
/// versions (éditions limitées aux N dernières, étapes toutes conservées), coffre-fort (journal chaîné, document
/// verrouillé), suppression par masquage, purge réservée et interdite au coffre-fort, vérification d'intégrité.
/// </summary>
public class ServiceGed(GedDbContext db, SpecialisationGed specialisation, StockageGed stockage)
{
    protected GedDbContext Db => db;

    /// <summary>Fichiers de contenus devenus inutiles, effacés du disque une fois la transaction validée.</summary>
    private readonly List<string> aEffacer = [];

    private static readonly string[] ModifiablesCoffre = ["resume", "notes", "a_envoyer"];
    private static readonly string[] Modifiables = ["titre", "categorie", "date_document", "auteur", "type_element", "id_element", "resume", "notes", "a_envoyer"];

    // ------------------------------------------------------------------ paramètres

    public virtual async Task<ParametresGedDto> Parametres(CancellationToken ct)
    {
        var p = await db.Parametres.AsNoTracking().ToDictionaryAsync(x => x.PgeCle, x => x.PgeValeur.RootElement.Clone(), ct);
        var r = new ParametresGedDto { Categories = JsonSerializer.SerializeToElement(Array.Empty<object>()) };
        if (p.TryGetValue("editions_conservees", out var e) && e.ValueKind == JsonValueKind.Number) r.EditionsConservees = e.GetInt32();
        if (p.TryGetValue("taille_apercu_max", out var t) && t.ValueKind == JsonValueKind.Number) r.TailleApercuMax = t.GetInt64();
        if (p.TryGetValue("adresse_copie_cachee", out var a) && a.ValueKind == JsonValueKind.String) r.AdresseCopieCachee = a.GetString() ?? "";
        if (p.TryGetValue("categories", out var c)) r.Categories = c;
        return r;
    }

    // ------------------------------------------------------------------ lecture

    protected async Task<DocumentGed> Charger(long id, Utilisateur u, CancellationToken ct) =>
        await specialisation.Visibles(db.Documents, u).FirstOrDefaultAsync(d => d.DgeId == id, ct)
        ?? throw ExceptionMetier.Introuvable($"Document {id}");

    private static string Motif(string texte) => "%" + texte.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

    public virtual async Task<List<DocumentDto>> Lister(FiltreGed f, Utilisateur u, CancellationToken ct)
    {
        var q = specialisation.Visibles(db.Documents.AsNoTracking(), u);
        if (!f.Supprimes) q = q.Where(d => !d.DgeSupprime);
        if (!string.IsNullOrEmpty(f.TypeElement)) q = q.Where(d => d.DgeTypeElement == f.TypeElement && d.DgeIdElement == f.IdElement);
        if (f.Coffre) q = q.Where(d => d.DgeCoffre);
        // Recherche : chaque mot dans le titre, la catégorie, l'auteur, le résumé, les notes ou le mail (sans accent ni casse).
        foreach (var mot in (f.Recherche ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var motif = Motif(mot);
            q = q.Where(d => EF.Functions.ILike(EF.Functions.Unaccent(
                d.DgeTitre + " " + (d.DgeCategorie ?? "") + " " + (d.DgeAuteur ?? "") + " " + (d.DgeResume ?? "") + " " + (d.DgeNotes ?? "") + " "
                + (d.DgeMail!.RootElement.GetProperty("objet").GetString() ?? "") + " " + (d.DgeMail!.RootElement.GetProperty("de").GetString() ?? "") + " "
                + (d.DgeMail!.RootElement.GetProperty("a").GetString() ?? "")), EF.Functions.Unaccent(motif)));
        }
        var documents = await q.OrderByDescending(d => d.DgeDateDocument).ThenByDescending(d => d.DgeId).Take(1000).ToListAsync(ct);
        return await VersDtos(documents, ct);
    }

    protected async Task<List<DocumentDto>> VersDtos(List<DocumentGed> documents, CancellationToken ct)
    {
        var ids = documents.Select(d => d.DgeId).ToList();
        var courantes = (await db.Versions.AsNoTracking().Where(v => ids.Contains(v.VgeDocument))
                .GroupBy(v => v.VgeDocument).Select(g => g.OrderByDescending(v => v.VgeNumero).First()).ToListAsync(ct))
            .ToDictionary(v => v.VgeDocument);
        var pieces = await db.Documents.AsNoTracking().Where(d => d.DgeParentId != null && ids.Contains(d.DgeParentId.Value) && !d.DgeSupprime)
            .GroupBy(d => d.DgeParentId!.Value).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        return documents.Select(d => Remplir(new DocumentDto(), d, courantes.GetValueOrDefault(d.DgeId), pieces.GetValueOrDefault(d.DgeId))).ToList();
    }

    protected static T Remplir<T>(T dto, DocumentGed d, VersionGed? v, int nbPieces) where T : DocumentDto
    {
        dto.Id = d.DgeId; dto.Titre = d.DgeTitre; dto.Categorie = d.DgeCategorie; dto.Nature = d.DgeNature;
        dto.TypeElement = d.DgeTypeElement; dto.IdElement = d.DgeIdElement; dto.Auteur = d.DgeAuteur;
        dto.DateDocument = d.DgeDateDocument?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); dto.ParentId = d.DgeParentId;
        dto.Mail = d.DgeMail?.RootElement.Clone(); dto.Resume = d.DgeResume; dto.Notes = d.DgeNotes; dto.Etat = d.DgeEtat;
        dto.Coffre = d.DgeCoffre; dto.CoffreLe = d.DgeCoffreLe; dto.AEnvoyer = d.DgeAEnvoyer; dto.Supprime = d.DgeSupprime; dto.SupprimeLe = d.DgeSupprimeLe;
        dto.SupprimePar = d.DgeSupprimePar; dto.CreeLe = d.DgeCreeLe; dto.CreePar = d.DgeCreePar; dto.ModifieLe = d.DgeModifieLe;
        dto.Version = v is null ? null : new(v.VgeId, v.VgeNumero, v.VgeNomFichier, v.VgeTypeMime, v.VgeTaille, v.VgeGenre);
        dto.NbPieces = nbPieces;
        return dto;
    }

    private static VersionDto VersDto(VersionGed v) => new(v.VgeId, v.VgeDocument, v.VgeNumero, v.VgeGenre, v.VgeEtape, v.VgeEtat, v.VgeEmpreinte,
        v.VgeNomFichier, v.VgeTypeMime, v.VgeTaille, v.VgeAuteur, v.VgeDate, v.VgeCommentaire);

    private static EntreeCoffreDto VersDto(EntreeCoffreGed e) => new(e.CofId, e.CofDocument, e.CofVersion, e.CofEmpreinteDocument,
        ChaineCoffre.Horodatage(e.CofHorodatage), e.CofUtilisateur, e.CofMotif, e.CofEmpreintePrecedente, e.CofEmpreinteEntree);

    public virtual async Task<DocumentDetailDto> Document(long id, Utilisateur u, CancellationToken ct)
    {
        var d = await specialisation.Visibles(db.Documents.AsNoTracking(), u).FirstOrDefaultAsync(x => x.DgeId == id, ct)
            ?? throw ExceptionMetier.Introuvable($"Document {id}");
        var versions = await db.Versions.AsNoTracking().Where(v => v.VgeDocument == id).OrderBy(v => v.VgeNumero).ToListAsync(ct);
        var pieces = await VersDtos(await specialisation.Visibles(db.Documents.AsNoTracking(), u)
            .Where(x => x.DgeParentId == id && !x.DgeSupprime).OrderBy(x => x.DgeId).ToListAsync(ct), ct);
        var dto = Remplir(new DocumentDetailDto(), d, versions.LastOrDefault(), pieces.Count);
        dto.Versions = versions.Select(VersDto).ToList();
        dto.Pieces = pieces;
        if (d.DgeParentId is { } parent)
        {
            var p = await specialisation.Visibles(db.Documents.AsNoTracking(), u).Where(x => x.DgeId == parent).ToListAsync(ct);
            dto.Parent = (await VersDtos(p, ct)).FirstOrDefault();
        }
        dto.JournalCoffre = (await db.Coffre.AsNoTracking().Where(e => e.CofDocument == id).OrderBy(e => e.CofId).ToListAsync(ct)).Select(VersDto).ToList();
        return dto;
    }

    // ------------------------------------------------------------------ dépôt et versions

    /// <summary>Formulaire multipart : « fichier » (facultatif pour une étape) et « donnees » (JSON).</summary>
    protected async Task<(IFormFile? Fichier, MetaDepot Meta)> LireFormulaire(HttpRequest requete, CancellationToken ct)
    {
        if (!requete.HasFormContentType) throw ExceptionMetier.Invalide("FORMULAIRE", "Formulaire multipart attendu");
        var formulaire = await requete.ReadFormAsync(ct);
        var meta = string.IsNullOrEmpty(formulaire["donnees"]) ? new MetaDepot()
            : JsonSerializer.Deserialize<MetaDepot>(formulaire["donnees"].ToString(), JsonCalcul.Options) ?? new MetaDepot();
        var fichier = formulaire.Files.GetFile("fichier");
        if (fichier is not null && fichier.Length > specialisation.TailleMaxDepot)
            throw ExceptionMetier.Invalide("TAILLE", $"Fichier trop volumineux (maximum {specialisation.TailleMaxDepot / 1024 / 1024} Mo)");
        return (fichier, meta);
    }

    /// <summary>Contenu écrit sur le disque puis déclaré (un dépôt identique réutilise le contenu existant).</summary>
    protected async Task<ContenuStocke> Stocker(IFormFile fichier, CancellationToken ct)
    {
        await using var flux = fichier.OpenReadStream();
        var c = await stockage.Enregistrer(flux, ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO contenu_ged (cge_empreinte, cge_taille, cge_chemin) VALUES ({c.Empreinte}, {c.Taille}, {c.Chemin}) ON CONFLICT DO NOTHING", ct);
        return c;
    }

    private static string TypeMime(IFormFile f) => string.IsNullOrEmpty(f.ContentType) ? "application/octet-stream" : f.ContentType;

    private static DateOnly? Date(string? texte) =>
        string.IsNullOrWhiteSpace(texte) ? null : DateOnly.ParseExact(texte.Trim()[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string? Texte(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    public virtual async Task<DocumentDetailDto> Deposer(HttpRequest requete, Utilisateur u, CancellationToken ct)
    {
        var (fichier, meta) = await LireFormulaire(requete, ct);
        if (fichier is null) throw ExceptionMetier.Invalide("FICHIER", "Fichier attendu");
        if (string.IsNullOrWhiteSpace(meta.Titre)) throw ExceptionMetier.Invalide("TITRE", "Titre obligatoire");
        if (!specialisation.PeutDeposer(u, meta.TypeElement, meta.IdElement)) throw ExceptionMetier.AccesRefuse("DEPOSER");
        if (meta.Nature is not (null or "fichier" or "mail")) throw ExceptionMetier.Invalide("NATURE", "Nature fichier ou mail attendue");
        specialisation.ControlerDepot(meta, fichier.FileName, fichier.Length, u);
        if (meta.ParentId is { } parent) await Charger(parent, u, ct);

        var c = await Stocker(fichier, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var maintenant = DateTimeOffset.UtcNow;
        var d = new DocumentGed
        {
            DgeTitre = meta.Titre.Trim(), DgeCategorie = Texte(meta.Categorie), DgeNature = meta.Nature ?? "fichier",
            DgeTypeElement = Texte(meta.TypeElement), DgeIdElement = Texte(meta.IdElement), DgeAuteur = Texte(meta.Auteur) ?? u.Code,
            DgeDateDocument = Date(meta.DateDocument) ?? DateOnly.FromDateTime(DateTime.Today), DgeParentId = meta.ParentId,
            DgeMail = meta.Mail is { ValueKind: JsonValueKind.Object } m ? JsonDocument.Parse(m.GetRawText()) : null,
            DgeResume = Texte(meta.Resume), DgeNotes = Texte(meta.Notes), DgeCreeLe = maintenant, DgeCreePar = u.Code,
        };
        db.Documents.Add(d);
        await db.SaveChangesAsync(ct);
        await AjouterVersion(d, c.Empreinte, c.Taille, fichier.FileName, TypeMime(fichier), RegleVersions.Edition, null, null, "Dépôt", u, ct);
        if (meta.Coffre) await Coffrer(d, $"Dépôt {meta.Categorie ?? ""}".Trim(), u, ct);
        await Valider(tx, ct);
        return await Document(d.DgeId, u, ct);
    }

    /// <summary>Nouvelle version puis purge des éditions au-delà des N dernières (contenus orphelins supprimés).</summary>
    protected async Task AjouterVersion(DocumentGed d, string empreinte, long taille, string nomFichier, string? typeMime, string genre,
        string? etape, string? etat, string? commentaire, Utilisateur u, CancellationToken ct)
    {
        var numero = (await db.Versions.Where(v => v.VgeDocument == d.DgeId).MaxAsync(v => (int?)v.VgeNumero, ct) ?? 0) + 1;
        var v = new VersionGed
        {
            VgeDocument = d.DgeId, VgeNumero = numero, VgeGenre = genre, VgeEtape = etape, VgeEtat = etat, VgeEmpreinte = empreinte,
            VgeNomFichier = nomFichier, VgeTypeMime = typeMime, VgeTaille = taille, VgeAuteur = u.Code, VgeDate = DateTimeOffset.UtcNow,
            VgeCommentaire = commentaire,
        };
        db.Versions.Add(v);
        if (etat is not null) d.DgeEtat = etat;
        d.DgeModifieLe = v.VgeDate;
        await db.SaveChangesAsync(ct);

        var conservees = (await Parametres(ct)).EditionsConservees;
        var versions = await db.Versions.Where(x => x.VgeDocument == d.DgeId).ToListAsync(ct);
        var purge = RegleVersions.EditionsAPurger(versions.Select(x => new VersionResume(x.VgeNumero, x.VgeGenre)), conservees, d.DgeCoffre).ToHashSet();
        if (purge.Count == 0) return;
        var purgees = versions.Where(x => purge.Contains(x.VgeNumero)).ToList();
        db.Versions.RemoveRange(purgees);
        await db.SaveChangesAsync(ct);
        await NettoyerContenus(purgees.Select(x => x.VgeEmpreinte), ct);
    }

    /// <summary>Contenus devenus inutilisés : ligne supprimée, fichier effacé par Effacer() après validation.</summary>
    protected async Task NettoyerContenus(IEnumerable<string> empreintes, CancellationToken ct)
    {
        var candidates = empreintes.Distinct().ToList();
        var orphelins = await db.Contenus.Where(c => candidates.Contains(c.CgeEmpreinte) && !db.Versions.Any(v => v.VgeEmpreinte == c.CgeEmpreinte)).ToListAsync(ct);
        if (orphelins.Count == 0) return;
        db.Contenus.RemoveRange(orphelins);
        await db.SaveChangesAsync(ct);
        aEffacer.AddRange(orphelins.Select(o => o.CgeChemin));
    }

    protected async Task Valider(Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction tx, CancellationToken ct)
    {
        await tx.CommitAsync(ct);
        foreach (var chemin in aEffacer) stockage.Supprimer(chemin);
        aEffacer.Clear();
    }

    public virtual async Task<DocumentDetailDto> NouvelleVersion(long id, HttpRequest requete, Utilisateur u, CancellationToken ct)
    {
        var (fichier, meta) = await LireFormulaire(requete, ct);
        var d = await Charger(id, u, ct);
        Modifiable(d, u);
        if (d.DgeCoffre) throw ExceptionMetier.Invalide("COFFRE", "Document du coffre-fort : verrouillé, aucune nouvelle version");
        if (d.DgeSupprime) throw ExceptionMetier.Invalide("SUPPRIME", "Document supprimé : restaurez-le d'abord");
        if (fichier is null) throw ExceptionMetier.Invalide("FICHIER", "Fichier attendu");
        var genre = meta.Genre ?? RegleVersions.Edition;
        if (genre is not (RegleVersions.Edition or RegleVersions.Etape)) throw ExceptionMetier.Invalide("GENRE", "Genre edition ou etape attendu");
        var c = await Stocker(fichier, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await AjouterVersion(d, c.Empreinte, c.Taille, fichier.FileName, TypeMime(fichier), genre, Texte(meta.Etape), Texte(meta.Etat), Texte(meta.Commentaire), u, ct);
        await Valider(tx, ct);
        return await Document(id, u, ct);
    }

    /// <summary>Étape sans nouveau fichier (envoi, validation…) : nouvelle version de genre etape sur le contenu courant.</summary>
    public virtual async Task<DocumentDetailDto> Etape(long id, DemandeEtape e, Utilisateur u, CancellationToken ct)
    {
        var d = await Charger(id, u, ct);
        Modifiable(d, u);
        if (d.DgeCoffre) throw ExceptionMetier.Invalide("COFFRE", "Document du coffre-fort : verrouillé");
        if (string.IsNullOrWhiteSpace(e.Etape)) throw ExceptionMetier.Invalide("ETAPE", "Étape obligatoire");
        var derniere = await db.Versions.Where(v => v.VgeDocument == id).OrderByDescending(v => v.VgeNumero).FirstOrDefaultAsync(ct)
            ?? throw ExceptionMetier.Invalide("FICHIER", "Fichier attendu");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await AjouterVersion(d, derniere.VgeEmpreinte, derniere.VgeTaille, derniere.VgeNomFichier, derniere.VgeTypeMime, RegleVersions.Etape,
            e.Etape.Trim(), Texte(e.Etat) ?? e.Etape.Trim(), Texte(e.Commentaire), u, ct);
        await Valider(tx, ct);
        return await Document(id, u, ct);
    }

    private void Modifiable(DocumentGed d, Utilisateur u)
    {
        if (!specialisation.PeutModifier(u, d)) throw ExceptionMetier.AccesRefuse("MODIFIER");
    }

    /// <summary>Informations du document ; au coffre-fort, seuls le résumé et les notes changent.</summary>
    public virtual async Task<DocumentDetailDto> Modifier(long id, Dictionary<string, JsonElement> meta, Utilisateur u, CancellationToken ct)
    {
        var d = await Charger(id, u, ct);
        Modifiable(d, u);
        var autorises = d.DgeCoffre ? ModifiablesCoffre : Modifiables;
        foreach (var (cle, valeur) in meta)
        {
            var texte = valeur.ValueKind switch { JsonValueKind.Null or JsonValueKind.Undefined => null, JsonValueKind.String => valeur.GetString(), _ => valeur.GetRawText() };
            if (!autorises.Contains(cle))
            {
                if (d.DgeCoffre && Modifiables.Contains(cle) && Texte(texte) != Texte(Actuel(d, cle)))
                    throw ExceptionMetier.Invalide("COFFRE", "Document du coffre-fort : seuls le résumé et les notes sont modifiables");
                continue;
            }
            switch (cle)
            {
                case "titre": d.DgeTitre = Texte(texte) ?? throw ExceptionMetier.Invalide("TITRE", "Titre obligatoire"); break;
                case "categorie": d.DgeCategorie = Texte(texte); break;
                case "date_document": d.DgeDateDocument = Date(texte); break;
                case "auteur": d.DgeAuteur = Texte(texte); break;
                case "type_element": d.DgeTypeElement = Texte(texte); break;
                case "id_element": d.DgeIdElement = Texte(texte); break;
                case "resume": d.DgeResume = Texte(texte); break;
                case "notes": d.DgeNotes = Texte(texte); break;
                case "a_envoyer": d.DgeAEnvoyer = texte == "true"; break;
            }
        }
        d.DgeModifieLe = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return await Document(id, u, ct);
    }

    private static string? Actuel(DocumentGed d, string cle) => cle switch
    {
        "titre" => d.DgeTitre, "categorie" => d.DgeCategorie, "auteur" => d.DgeAuteur, "type_element" => d.DgeTypeElement,
        "id_element" => d.DgeIdElement, "date_document" => d.DgeDateDocument?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), _ => null,
    };

    // ------------------------------------------------------------------ contenu

    public virtual async Task<IResult> Contenu(long versionId, bool telecharger, HttpContext http, Utilisateur u, CancellationToken ct)
    {
        var v = await db.Versions.AsNoTracking().FirstOrDefaultAsync(x => x.VgeId == versionId, ct) ?? throw ExceptionMetier.Introuvable($"Version {versionId}");
        await Charger(v.VgeDocument, u, ct);
        var c = await db.Contenus.AsNoTracking().FirstOrDefaultAsync(x => x.CgeEmpreinte == v.VgeEmpreinte, ct);
        if (c is null || !stockage.Existe(c.CgeChemin)) throw ExceptionMetier.Introuvable("Contenu");
        var disposition = new ContentDispositionHeaderValue(telecharger ? "attachment" : "inline");
        disposition.SetHttpFileName(v.VgeNomFichier);
        http.Response.Headers.ContentDisposition = disposition.ToString();
        http.Response.Headers.CacheControl = "private, max-age=3600";
        return Results.Stream(stockage.Ouvrir(c.CgeChemin), v.VgeTypeMime ?? "application/octet-stream", enableRangeProcessing: true);
    }

    // ------------------------------------------------------------------ coffre-fort

    /// <summary>Entrée chaînée au journal (verrou exclusif sur le journal pour une chaîne sans fourche), document verrouillé.</summary>
    protected async Task Coffrer(DocumentGed d, string? motif, Utilisateur u, CancellationToken ct)
    {
        var v = await db.Versions.Where(x => x.VgeDocument == d.DgeId).OrderByDescending(x => x.VgeNumero).FirstAsync(ct);
        var c = await db.Contenus.AsNoTracking().FirstAsync(x => x.CgeEmpreinte == v.VgeEmpreinte, ct);
        // Le fichier doit correspondre à son empreinte au moment du scellement.
        if (await stockage.Recalculer(c.CgeChemin, ct) != v.VgeEmpreinte) throw ExceptionMetier.Invalide("INTEGRITE", "Contenu altéré : mise au coffre impossible");
        await db.Database.ExecuteSqlRawAsync("LOCK TABLE coffre_ged IN EXCLUSIVE MODE", ct);
        var precedente = await db.Coffre.AsNoTracking().OrderByDescending(e => e.CofId).FirstOrDefaultAsync(ct);
        var e = ChaineCoffre.Chainer(precedente?.VersEntree(), v.VgeEmpreinte, DateTimeOffset.UtcNow, d.DgeId, v.VgeId, u.Code, Texte(motif));
        db.Coffre.Add(new EntreeCoffreGed
        {
            CofDocument = e.Document, CofVersion = e.Version, CofEmpreinteDocument = e.EmpreinteDocument, CofHorodatage = e.Horodatage,
            CofUtilisateur = e.Utilisateur, CofMotif = e.Motif, CofEmpreintePrecedente = e.EmpreintePrecedente, CofEmpreinteEntree = e.EmpreinteEntree,
        });
        d.DgeCoffre = true;
        d.DgeCoffreLe = e.Horodatage;
        await db.SaveChangesAsync(ct);
    }

    public virtual async Task<DocumentDetailDto> MettreAuCoffre(long id, DemandeCoffre demande, Utilisateur u, CancellationToken ct)
    {
        var d = await Charger(id, u, ct);
        if (d.DgeCoffre) return await Document(id, u, ct);
        Modifiable(d, u);
        if (d.DgeSupprime) throw ExceptionMetier.Invalide("SUPPRIME", "Document supprimé : restaurez-le d'abord");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await Coffrer(d, demande.Motif, u, ct);
        await Valider(tx, ct);
        return await Document(id, u, ct);
    }

    /// <summary>Intégrité du contenu courant (recalculé depuis le disque) et, au coffre-fort, du journal complet.</summary>
    public virtual async Task<VerificationDto> Verifier(long id, Utilisateur u, CancellationToken ct)
    {
        var d = await Charger(id, u, ct);
        var v = await db.Versions.AsNoTracking().Where(x => x.VgeDocument == id).OrderByDescending(x => x.VgeNumero).FirstAsync(ct);
        var c = await db.Contenus.AsNoTracking().FirstOrDefaultAsync(x => x.CgeEmpreinte == v.VgeEmpreinte, ct);
        var calculee = c is null ? null : await stockage.Recalculer(c.CgeChemin, ct);
        var entree = await db.Coffre.AsNoTracking().Where(e => e.CofDocument == id).OrderBy(e => e.CofId).FirstOrDefaultAsync(ct);
        return new VerificationDto(
            calculee == v.VgeEmpreinte && (entree is null || entree.CofEmpreinteDocument == calculee),
            entree?.CofEmpreinteDocument ?? v.VgeEmpreinte, calculee, entree is null ? null : ChaineCoffre.Horodatage(entree.CofHorodatage),
            d.DgeCoffre ? await VerifierCoffre(ct) : null);
    }

    public virtual async Task<ResultatChaine> VerifierCoffre(CancellationToken ct)
    {
        var entrees = await db.Coffre.AsNoTracking().OrderBy(e => e.CofId).ToListAsync(ct);
        return ChaineCoffre.Verifier(entrees.Select(e => e.VersEntree()).ToList());
    }

    // ------------------------------------------------------------------ suppression

    /// <summary>Masquage (avec les pièces jointes hors coffre) ; au coffre-fort, réservé à un administrateur.</summary>
    public virtual async Task<DocumentDetailDto> Supprimer(long id, Utilisateur u, CancellationToken ct)
    {
        var d = await Charger(id, u, ct);
        Modifiable(d, u);
        if (d.DgeCoffre && !specialisation.PeutSupprimerCoffre(u))
            throw new ExceptionMetier(StatusCodes.Status403Forbidden, "ACCES_REFUSE", "Document du coffre-fort : suppression réservée à un administrateur");
        var maintenant = DateTimeOffset.UtcNow;
        var pieces = await db.Documents.Where(x => x.DgeParentId == id && !x.DgeCoffre && !x.DgeSupprime).ToListAsync(ct);
        foreach (var x in pieces.Prepend(d)) { x.DgeSupprime = true; x.DgeSupprimeLe = maintenant; x.DgeSupprimePar = u.Code; }
        await db.SaveChangesAsync(ct);
        return await Document(id, u, ct);
    }

    public virtual async Task<DocumentDetailDto> Restaurer(long id, Utilisateur u, CancellationToken ct)
    {
        var d = await Charger(id, u, ct);
        Modifiable(d, u);
        d.DgeSupprime = false; d.DgeSupprimeLe = null; d.DgeSupprimePar = null;
        await db.SaveChangesAsync(ct);
        return await Document(id, u, ct);
    }

    /// <summary>Suppression définitive d'un document masqué : administrateur seulement, jamais au coffre-fort.</summary>
    public virtual async Task Purger(long id, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutPurger(u))
            throw new ExceptionMetier(StatusCodes.Status403Forbidden, "ACCES_REFUSE", "Suppression définitive réservée à un administrateur");
        var d = await Charger(id, u, ct);
        if (d.DgeCoffre) throw ExceptionMetier.Invalide("COFFRE", "Un document du coffre-fort ne peut pas être supprimé définitivement");
        if (!d.DgeSupprime) throw ExceptionMetier.Invalide("NON_SUPPRIME", "Seul un document marqué comme supprimé peut être purgé");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Documents.Where(x => x.DgeParentId == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.DgeParentId, (long?)null), ct);
        var versions = await db.Versions.AsNoTracking().Where(v => v.VgeDocument == id).ToListAsync(ct);
        await db.Versions.Where(v => v.VgeDocument == id).ExecuteDeleteAsync(ct);
        db.Documents.Remove(d);
        await db.SaveChangesAsync(ct);
        await NettoyerContenus(versions.Select(v => v.VgeEmpreinte), ct);
        await Valider(tx, ct);
    }
}
