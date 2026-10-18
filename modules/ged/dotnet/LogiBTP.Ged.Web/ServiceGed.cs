using System.Globalization;
using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;
using Npgsql;

namespace LogiBTP.Ged.Web;

/// <summary>
/// Services du module GED (classe mère), mêmes règles que FournisseurGedMemoire : dépôt (contenu rangé par empreinte,
/// texte extrait et classification automatique), versions (éditions limitées aux N dernières, étapes toutes conservées),
/// répertoires, confidentialité et accès (AccesGed), dérivations, coffre-fort (journal chaîné, document verrouillé),
/// suppression par masquage, purge réservée et interdite au coffre-fort, rétention et archive séparée.
/// </summary>
public class ServiceGed(GedDbContext db, SpecialisationGed specialisation, StockageGed stockage)
{
    protected GedDbContext Db => db;

    /// <summary>Fichiers de contenus devenus inutiles, effacés du disque une fois la transaction validée.</summary>
    private readonly List<string> aEffacer = [];

    /// <summary>Informations de classement modifiables même au coffre-fort (le contenu et l'élément lié restent figés).</summary>
    private static readonly string[] ModifiablesCoffre = ["resume", "notes", "a_envoyer", "confidentialite", "acces_profils", "acces_utilisateurs", "mots_cles", "langue", "repertoire_id"];
    private static readonly string[] Modifiables = [.. ModifiablesCoffre, "titre", "categorie", "date_document", "auteur", "type_element", "id_element"];
    private static readonly string[] CleAcces = ["confidentialite", "acces_profils", "acces_utilisateurs"];
    private static readonly string[] TypesDerivation = ["VERSION", "TRADUCTION", "ADAPTATION", "EXTRAIT", "ANNOTATION"];
    private const int ExtraitMax = 2000;

    /// <summary>Documents visibles : accès (confidentialité, accès listés) puis règle de l'application.</summary>
    protected IQueryable<DocumentGed> Visibles(IQueryable<DocumentGed> documents, Utilisateur u) =>
        specialisation.Visibles(documents.Where(AccesGed.Filtre(u)), u);

    private static DateOnly Aujourdhui => DateOnly.FromDateTime(DateTime.UtcNow);

    // ------------------------------------------------------------------ paramètres et règles

    public virtual async Task<ParametresGedDto> Parametres(CancellationToken ct)
    {
        var p = await db.Parametres.AsNoTracking().ToDictionaryAsync(x => x.PgeCle, x => x.PgeValeur.RootElement.Clone(), ct);
        var r = new ParametresGedDto { Categories = JsonSerializer.SerializeToElement(Array.Empty<object>()) };
        if (p.TryGetValue("editions_conservees", out var e) && e.ValueKind == JsonValueKind.Number) r.EditionsConservees = e.GetInt32();
        if (p.TryGetValue("taille_apercu_max", out var t) && t.ValueKind == JsonValueKind.Number) r.TailleApercuMax = t.GetInt64();
        if (p.TryGetValue("adresse_copie_cachee", out var a) && a.ValueKind == JsonValueKind.String) r.AdresseCopieCachee = a.GetString() ?? "";
        if (p.TryGetValue("categories", out var c)) r.Categories = c;
        r.ReglesClassification = (await db.ReglesClassification.AsNoTracking().OrderBy(x => x.RcgPriorite).ThenBy(x => x.RcgId).ToListAsync(ct)).Select(VersDto).ToList();
        return r;
    }

    private static RegleRetentionDto VersDto(RetentionGed r) => new(r.RrgId, r.RrgLibelle, r.RrgCategorie, r.RrgTypeElement, r.RrgDureeActiveMois,
        r.RrgDureeConservationMois, r.RrgActionFin, r.RrgPriorite, r.RrgActif);

    private static RegleClassificationDto VersDto(ClassementGed r) => new(r.RcgId, r.RcgLibelle, r.RcgPriorite, r.RcgActif, r.RcgExtensions, r.RcgTypesMime,
        r.RcgMots, r.RcgExpediteur, r.RcgTypeElement, r.RcgCategorie, r.RcgConfidentialite, r.RcgMotsCles);

    public virtual async Task<ReglesGedDto> Regles(CancellationToken ct) => new(
        (await db.ReglesRetention.AsNoTracking().OrderBy(x => x.RrgPriorite).ThenBy(x => x.RrgId).ToListAsync(ct)).Select(VersDto).ToList(),
        (await db.ReglesClassification.AsNoTracking().OrderBy(x => x.RcgPriorite).ThenBy(x => x.RcgId).ToListAsync(ct)).Select(VersDto).ToList());

    private async Task<List<RegleRetentionGed>> ReglesRetention(CancellationToken ct) =>
        (await db.ReglesRetention.AsNoTracking().ToListAsync(ct)).Select(r => r.VersRegle()).ToList();

    private async Task<List<RegleClassificationGed>> ReglesClassification(CancellationToken ct) =>
        (await db.ReglesClassification.AsNoTracking().ToListAsync(ct)).Select(r => r.VersRegle()).ToList();

    /// <summary>Règles de rétention remplacées en bloc (administrateur).</summary>
    public virtual async Task<ReglesGedDto> RemplacerReglesRetention(List<RegleRetentionDto> regles, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutPurger(u)) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        foreach (var r in regles)
        {
            if (string.IsNullOrWhiteSpace(r.Libelle)) throw ExceptionMetier.Invalide("LIBELLE", "Libellé de règle obligatoire");
            if (r.DureeActiveMois < 0 || r.DureeConservationMois < 0) throw ExceptionMetier.Invalide("DUREE", $"Durées positives attendues ({r.Libelle})");
            if (r.DureeActiveMois is { } a && r.DureeConservationMois is { } c && c < a)
                throw ExceptionMetier.Invalide("DUREE", $"La conservation ne peut pas être plus courte que la durée active ({r.Libelle})");
            if (r.ActionFin is not ("REVOIR" or "DETRUIRE")) throw ExceptionMetier.Invalide("ACTION", "Action de fin REVOIR ou DETRUIRE attendue");
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.ReglesRetention.ExecuteDeleteAsync(ct);
        db.ReglesRetention.AddRange(regles.Select(r => new RetentionGed
        {
            RrgId = r.Id > 0 ? r.Id : 0, RrgLibelle = r.Libelle.Trim(), RrgCategorie = Texte(r.Categorie), RrgTypeElement = Texte(r.TypeElement),
            RrgDureeActiveMois = r.DureeActiveMois, RrgDureeConservationMois = r.DureeConservationMois, RrgActionFin = r.ActionFin, RrgPriorite = r.Priorite, RrgActif = r.Actif,
        }));
        await db.SaveChangesAsync(ct);
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('regle_retention_ged', 'rrg_id'), greatest((SELECT max(rrg_id) FROM regle_retention_ged), 1))", ct);
        await tx.CommitAsync(ct);
        return await Regles(ct);
    }

    /// <summary>Règles de classification remplacées en bloc (administrateur).</summary>
    public virtual async Task<ReglesGedDto> RemplacerReglesClassification(List<RegleClassificationDto> regles, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutPurger(u)) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        foreach (var r in regles)
        {
            if (string.IsNullOrWhiteSpace(r.Libelle)) throw ExceptionMetier.Invalide("LIBELLE", "Libellé de règle obligatoire");
            if (r.Extensions.Length + r.TypesMime.Length + r.Mots.Length == 0 && Texte(r.Expediteur) is null && Texte(r.TypeElement) is null)
                throw ExceptionMetier.Invalide("CRITERE", $"Au moins un critère attendu ({r.Libelle})");
            if (Texte(r.Categorie) is null && Texte(r.Confidentialite) is null && r.MotsCles.Length == 0)
                throw ExceptionMetier.Invalide("RESULTAT", $"Catégorie, confidentialité ou mots-clés attendus ({r.Libelle})");
            if (Texte(r.Confidentialite) is { } n && !AccesGed.Niveaux.Contains(n)) throw ExceptionMetier.Invalide("CONFIDENTIALITE", $"Confidentialité inconnue : {n}");
        }
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.ReglesClassification.ExecuteDeleteAsync(ct);
        static string[] Propre(string[] l) => l.Select(x => x.Trim()).Where(x => x.Length > 0).Distinct().ToArray();
        db.ReglesClassification.AddRange(regles.Select(r => new ClassementGed
        {
            RcgId = r.Id > 0 ? r.Id : 0, RcgLibelle = r.Libelle.Trim(), RcgPriorite = r.Priorite, RcgActif = r.Actif, RcgExtensions = Propre(r.Extensions).Select(x => x.TrimStart('.').ToLowerInvariant()).ToArray(),
            RcgTypesMime = Propre(r.TypesMime), RcgMots = Propre(r.Mots), RcgExpediteur = Texte(r.Expediteur), RcgTypeElement = Texte(r.TypeElement),
            RcgCategorie = Texte(r.Categorie), RcgConfidentialite = Texte(r.Confidentialite), RcgMotsCles = Propre(r.MotsCles),
        }));
        await db.SaveChangesAsync(ct);
        await db.Database.ExecuteSqlRawAsync("SELECT setval(pg_get_serial_sequence('regle_classification_ged', 'rcg_id'), greatest((SELECT max(rcg_id) FROM regle_classification_ged), 1))", ct);
        await tx.CommitAsync(ct);
        return await Regles(ct);
    }

    // ------------------------------------------------------------------ lecture

    protected async Task<DocumentGed> Charger(long id, Utilisateur u, CancellationToken ct) =>
        await Visibles(db.Documents, u).FirstOrDefaultAsync(d => d.DgeId == id, ct)
        ?? throw ExceptionMetier.Introuvable($"Document {id}");

    private static string Motif(string texte) => "%" + texte.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

    private static string[] Mots(string? recherche) => (recherche ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    public virtual async Task<List<DocumentDto>> Lister(FiltreGed f, Utilisateur u, CancellationToken ct)
    {
        if (f.Archives) return await ListerArchives(f, u, ct);
        var q = Visibles(db.Documents.AsNoTracking(), u).Where(d => !d.DgeArchive);
        if (!f.Supprimes) q = q.Where(d => !d.DgeSupprime);
        if (!string.IsNullOrEmpty(f.TypeElement)) q = q.Where(d => d.DgeTypeElement == f.TypeElement && d.DgeIdElement == f.IdElement);
        else if (f.SansElement) q = q.Where(d => d.DgeTypeElement == null);
        if (f.Coffre) q = q.Where(d => d.DgeCoffre);
        // Recherche : chaque mot dans les métadonnées (titre, catégorie, auteur, résumé, notes, mail : colonne normalisée
        // dge_recherche) ou dans le nom d'un fichier déposé, sans accent ni casse (index trigrammes) ; ou bien la recherche
        // entière en plein texte (titre, mots-clés, résumé, notes, mail, texte extrait du contenu ; index GIN).
        var mots = Mots(f.Recherche);
        if (mots.Length > 0)
        {
            var parMots = db.Documents.AsQueryable();
            foreach (var mot in mots)
            {
                var motif = Motif(NormalisationGed.Normaliser(mot));
                parMots = parMots.Where(d => EF.Functions.Like(d.DgeRecherche!, motif)
                    || db.Versions.Any(v => v.VgeDocument == d.DgeId && EF.Functions.Like(GedDbContext.Normaliser(v.VgeNomFichier), motif)));
            }
            var ids = parMots.Select(d => d.DgeId);
            var requete = NormalisationGed.Normaliser(f.Recherche);
            q = q.Where(d => ids.Contains(d.DgeId) || d.DgePleinTexte!.Matches(EF.Functions.WebSearchToTsQuery("french", requete)));
        }
        var documents = await q.OrderByDescending(d => d.DgeDateDocument).ThenByDescending(d => d.DgeId).Take(1000).ToListAsync(ct);
        return await VersDtos(documents, ct);
    }

    /// <summary>Documents archivés : du coffre-fort archivés sur place, et déplacés dans l'archive (accès vérifiés).</summary>
    protected async Task<List<DocumentDto>> ListerArchives(FiltreGed f, Utilisateur u, CancellationToken ct)
    {
        var surPlace = Visibles(db.Documents.AsNoTracking(), u).Where(d => d.DgeArchive);
        var deplaces = db.Archives.AsNoTracking();
        if (!string.IsNullOrEmpty(f.TypeElement))
        {
            surPlace = surPlace.Where(d => d.DgeTypeElement == f.TypeElement && d.DgeIdElement == f.IdElement);
            deplaces = deplaces.Where(d => d.DgeTypeElement == f.TypeElement && d.DgeIdElement == f.IdElement);
        }
        else if (f.SansElement)
        {
            surPlace = surPlace.Where(d => d.DgeTypeElement == null);
            deplaces = deplaces.Where(d => d.DgeTypeElement == null);
        }
        var mots = Mots(f.Recherche);
        if (mots.Length > 0)
        {
            var requete = NormalisationGed.Normaliser(f.Recherche);
            foreach (var mot in mots)
            {
                var motif = Motif(NormalisationGed.Normaliser(mot));
                surPlace = surPlace.Where(d => EF.Functions.Like(d.DgeRecherche!, motif) || d.DgePleinTexte!.Matches(EF.Functions.WebSearchToTsQuery("french", requete)));
                deplaces = deplaces.Where(d => EF.Functions.Like(d.DgeRecherche!, motif) || d.DgePleinTexte!.Matches(EF.Functions.WebSearchToTsQuery("french", requete)));
            }
        }
        var liste = await VersDtos(await surPlace.OrderByDescending(d => d.DgeDateDocument).Take(1000).ToListAsync(ct), ct);
        var archives = (await deplaces.OrderByDescending(d => d.DgeDateDocument).ThenByDescending(d => d.DgeId).Take(1000).ToListAsync(ct))
            .Where(d => AccesGed.Autorise(d.DgeCreePar, d.DgeConfidentialite, d.DgeAccesProfils, d.DgeAccesUtilisateurs, u)).ToList();
        liste.AddRange(await VersDtosArchive(archives, ct));
        return liste.OrderByDescending(d => d.DateDocument).ThenByDescending(d => d.Id).ToList();
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

    protected async Task<List<DocumentDto>> VersDtosArchive(List<DocumentArchiveGed> documents, CancellationToken ct)
    {
        var ids = documents.Select(d => d.DgeId).ToList();
        var courantes = (await db.VersionsArchive.AsNoTracking().Where(v => ids.Contains(v.VgeDocument)).ToListAsync(ct))
            .GroupBy(v => v.VgeDocument).ToDictionary(g => g.Key, g => g.MaxBy(v => v.VgeNumero)!.VersVersion());
        var pieces = documents.Where(d => d.DgeParentId is not null).GroupBy(d => d.DgeParentId!.Value).ToDictionary(g => g.Key, g => g.Count());
        return documents.Select(d => RemplirArchive(new DocumentDto(), d, courantes.GetValueOrDefault(d.DgeId), pieces.GetValueOrDefault(d.DgeId))).ToList();
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
        dto.NbConsultations = d.DgeNbConsultations;
        dto.ConsulteLe = d.DgeConsulteLe;
        dto.RepertoireId = d.DgeRepertoireId; dto.Confidentialite = d.DgeConfidentialite; dto.AccesProfils = d.DgeAccesProfils;
        dto.AccesUtilisateurs = d.DgeAccesUtilisateurs; dto.MotsCles = d.DgeMotsCles; dto.Langue = d.DgeLangue; dto.IndexEtat = d.DgeIndexEtat;
        dto.NbVersions = d.DgeNbVersions; dto.Archive = d.DgeArchive; dto.ArchiveLe = d.DgeArchiveLe;
        return dto;
    }

    protected static T RemplirArchive<T>(T dto, DocumentArchiveGed d, VersionGed? v, int nbPieces) where T : DocumentDto
    {
        dto.Id = d.DgeId; dto.Titre = d.DgeTitre; dto.Categorie = d.DgeCategorie; dto.Nature = d.DgeNature;
        dto.TypeElement = d.DgeTypeElement; dto.IdElement = d.DgeIdElement; dto.Auteur = d.DgeAuteur;
        dto.DateDocument = d.DgeDateDocument?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); dto.ParentId = d.DgeParentId;
        dto.Mail = d.DgeMail?.RootElement.Clone(); dto.Resume = d.DgeResume; dto.Notes = d.DgeNotes; dto.Etat = d.DgeEtat;
        dto.CreeLe = d.DgeCreeLe; dto.CreePar = d.DgeCreePar; dto.ModifieLe = d.DgeModifieLe;
        dto.Version = v is null ? null : new(v.VgeId, v.VgeNumero, v.VgeNomFichier, v.VgeTypeMime, v.VgeTaille, v.VgeGenre);
        dto.NbPieces = nbPieces; dto.NbConsultations = d.DgeNbConsultations; dto.RepertoireId = d.DgeRepertoireId;
        dto.Confidentialite = d.DgeConfidentialite; dto.AccesProfils = d.DgeAccesProfils; dto.AccesUtilisateurs = d.DgeAccesUtilisateurs;
        dto.MotsCles = d.DgeMotsCles; dto.Langue = d.DgeLangue; dto.IndexEtat = d.DgeIndexEtat; dto.NbVersions = d.DgeNbVersions;
        dto.Archive = true; dto.ArchiveLe = d.DgaArchiveLe;
        return dto;
    }

    private static VersionDto VersDto(VersionGed v) => new(v.VgeId, v.VgeDocument, v.VgeNumero, v.VgeGenre, v.VgeEtape, v.VgeEtat, v.VgeEmpreinte,
        v.VgeNomFichier, v.VgeTypeMime, v.VgeTaille, v.VgeAuteur, v.VgeDate, v.VgeCommentaire);

    private static EntreeCoffreDto VersDto(EntreeCoffreGed e) => new(e.CofId, e.CofDocument, e.CofVersion, e.CofEmpreinteDocument,
        ChaineCoffre.Horodatage(e.CofHorodatage), e.CofUtilisateur, e.CofMotif, e.CofEmpreintePrecedente, e.CofEmpreinteEntree);

    private static EcheancesDto VersDto(EcheancesRetention e, IEnumerable<RegleRetentionGed> regles) => new(e.Regle, regles.FirstOrDefault(r => r.Id == e.Regle)?.Libelle,
        RegleRetention.Iso(e.Base), e.ArchiverLe is null ? null : RegleRetention.Iso(e.ArchiverLe), e.FinLe is null ? null : RegleRetention.Iso(e.FinLe), e.ActionFin, e.Statut);

    private static string? Extrait(string? texte) => texte is null ? null : texte.Length > ExtraitMax ? texte[..ExtraitMax] + "…" : texte;

    public virtual async Task<DocumentDetailDto> Document(long id, Utilisateur u, CancellationToken ct)
    {
        var d = await Visibles(db.Documents.AsNoTracking(), u).FirstOrDefaultAsync(x => x.DgeId == id, ct);
        if (d is null) return await DocumentArchive(id, u, ct);
        var versions = await db.Versions.AsNoTracking().Where(v => v.VgeDocument == id).OrderBy(v => v.VgeNumero).ToListAsync(ct);
        var pieces = await VersDtos(await Visibles(db.Documents.AsNoTracking(), u)
            .Where(x => x.DgeParentId == id && !x.DgeSupprime).OrderBy(x => x.DgeId).ToListAsync(ct), ct);
        var dto = Remplir(new DocumentDetailDto(), d, versions.LastOrDefault(), pieces.Count);
        dto.Versions = versions.Select(VersDto).ToList();
        dto.Pieces = pieces;
        if (d.DgeParentId is { } parent)
        {
            var p = await Visibles(db.Documents.AsNoTracking(), u).Where(x => x.DgeId == parent).ToListAsync(ct);
            dto.Parent = (await VersDtos(p, ct)).FirstOrDefault();
        }
        dto.JournalCoffre = (await db.Coffre.AsNoTracking().Where(e => e.CofDocument == id).OrderBy(e => e.CofId).ToListAsync(ct)).Select(VersDto).ToList();
        dto.Derivations = await Derivations(id, u, ct);
        dto.Classification = d.DgeClassification?.RootElement.Clone();
        dto.ExtraitTexte = Extrait(d.DgeTexteContenu);
        var regles = await ReglesRetention(ct);
        dto.Retention = VersDto(RegleRetention.Echeances(new DocumentRetention(d.DgeCategorie, d.DgeTypeElement, d.DgeDateDocument, d.DgeCreeLe), regles, Aujourdhui), regles);
        return dto;
    }

    /// <summary>Document déplacé dans l'archive : lecture seule (versions de l'archive, pièces jointes archivées avec lui).</summary>
    protected async Task<DocumentDetailDto> DocumentArchive(long id, Utilisateur u, CancellationToken ct)
    {
        var a = await db.Archives.AsNoTracking().FirstOrDefaultAsync(x => x.DgeId == id, ct);
        if (a is null || !AccesGed.Autorise(a.DgeCreePar, a.DgeConfidentialite, a.DgeAccesProfils, a.DgeAccesUtilisateurs, u))
            throw ExceptionMetier.Introuvable($"Document {id}");
        var versions = (await db.VersionsArchive.AsNoTracking().Where(v => v.VgeDocument == id).OrderBy(v => v.VgeNumero).ToListAsync(ct)).Select(v => v.VersVersion()).ToList();
        var pieces = await VersDtosArchive(await db.Archives.AsNoTracking().Where(x => x.DgeParentId == id).OrderBy(x => x.DgeId).ToListAsync(ct), ct);
        var dto = RemplirArchive(new DocumentDetailDto(), a, versions.LastOrDefault(), pieces.Count);
        dto.Versions = versions.Select(VersDto).ToList();
        dto.Pieces = pieces;
        if (a.DgeParentId is { } parent)
            dto.Parent = (await VersDtosArchive(await db.Archives.AsNoTracking().Where(x => x.DgeId == parent).ToListAsync(ct), ct)).FirstOrDefault();
        dto.ExtraitTexte = Extrait(a.DgeTexteContenu);
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

    /// <summary>Texte d'un contenu stocké (indexation, classification).</summary>
    protected (string? Texte, string Etat) ExtraireTexte(string chemin, string nomFichier, string? typeMime)
    {
        if (!stockage.Existe(chemin)) return (null, ExtractionTexte.Echec);
        using var flux = stockage.Ouvrir(chemin);
        return ExtractionTexte.Extraire(flux, nomFichier, typeMime);
    }

    private static string TypeMime(IFormFile f) => string.IsNullOrEmpty(f.ContentType) ? "application/octet-stream" : f.ContentType;

    private static DateOnly? Date(string? texte) =>
        string.IsNullOrWhiteSpace(texte) ? null : DateOnly.ParseExact(texte.Trim()[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string? Texte(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    private static string[] Liste(IEnumerable<string>? l) => (l ?? []).Select(x => x?.Trim() ?? "").Where(x => x.Length > 0).Distinct().ToArray();

    private static string Confidentialite(string? v)
    {
        var n = Texte(v)?.ToUpperInvariant() ?? AccesGed.Interne;
        return AccesGed.Niveaux.Contains(n) ? n : throw ExceptionMetier.Invalide("CONFIDENTIALITE", $"Confidentialité inconnue : {v}");
    }

    private static string? Champ(JsonElement? mail, string cle) =>
        mail is { ValueKind: JsonValueKind.Object } m && m.TryGetProperty(cle, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public virtual async Task<DocumentDetailDto> Deposer(HttpRequest requete, Utilisateur u, CancellationToken ct)
    {
        var (fichier, meta) = await LireFormulaire(requete, ct);
        return await DeposerFichier(fichier, meta, u, ct);
    }

    /// <summary>
    /// Dépôt d'un fichier déjà lu (formulaire, ou production de l'application : éditions PDF du serveur) ; mêmes
    /// contrôles, classification, indexation et mise au coffre que le dépôt par formulaire.
    /// </summary>
    public virtual async Task<DocumentDetailDto> DeposerFichier(IFormFile? fichier, MetaDepot meta, Utilisateur u, CancellationToken ct)
    {
        if (fichier is null) throw ExceptionMetier.Invalide("FICHIER", "Fichier attendu");
        if (string.IsNullOrWhiteSpace(meta.Titre)) throw ExceptionMetier.Invalide("TITRE", "Titre obligatoire");
        // Répertoire de dépôt : le document est lié à l'élément du répertoire (même si ce n'est pas celui affiché).
        if (meta.RepertoireId is { } rid)
        {
            var rep = await db.Repertoires.AsNoTracking().FirstOrDefaultAsync(r => r.RgeId == rid, ct) ?? throw ExceptionMetier.Introuvable($"Répertoire {rid}");
            meta.TypeElement = rep.RgeTypeElement;
            meta.IdElement = rep.RgeIdElement;
        }
        if (!specialisation.PeutDeposer(u, meta.TypeElement, meta.IdElement)) throw ExceptionMetier.AccesRefuse("DEPOSER");
        if (meta.Nature is not (null or "fichier" or "mail")) throw ExceptionMetier.Invalide("NATURE", "Nature fichier ou mail attendue");
        specialisation.ControlerDepot(meta, fichier.FileName, fichier.Length, u);
        await ControlerElement(Texte(meta.TypeElement), Texte(meta.IdElement), ct);
        if (meta.ParentId is { } parent) await ControlerParent(null, parent, u, ct);
        var confidentialiteSaisie = Texte(meta.Confidentialite) is null ? null : Confidentialite(meta.Confidentialite);

        var c = await Stocker(fichier, ct);
        var mime = TypeMime(fichier);
        // Indexation et classification automatique (catégorie proposée quand elle n'est pas saisie).
        var (texte, etat) = ExtraireTexte(c.Chemin, fichier.FileName, mime);
        var classe = ClassificationGed.Classer(new DocumentAClasser(fichier.FileName, mime, meta.Titre, texte ?? Champ(meta.Mail, "message"),
            Champ(meta.Mail, "de"), Texte(meta.TypeElement)), await ReglesClassification(ct));
        var maintenant = DateTimeOffset.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var d = new DocumentGed
        {
            DgeTitre = meta.Titre.Trim(), DgeCategorie = Texte(meta.Categorie) ?? classe.Categorie, DgeNature = meta.Nature ?? "fichier",
            DgeTypeElement = Texte(meta.TypeElement), DgeIdElement = Texte(meta.IdElement), DgeAuteur = Texte(meta.Auteur) ?? u.Code,
            DgeDateDocument = Date(meta.DateDocument) ?? DateOnly.FromDateTime(DateTime.Today), DgeParentId = meta.ParentId,
            DgeMail = meta.Mail is { ValueKind: JsonValueKind.Object } m ? JsonDocument.Parse(m.GetRawText()) : null,
            DgeResume = Texte(meta.Resume), DgeNotes = Texte(meta.Notes), DgeCreeLe = maintenant, DgeCreePar = u.Code,
            DgeRepertoireId = meta.RepertoireId, DgeConfidentialite = confidentialiteSaisie ?? classe.Confidentialite ?? AccesGed.Interne,
            DgeAccesProfils = Liste(meta.AccesProfils), DgeAccesUtilisateurs = Liste(meta.AccesUtilisateurs),
            DgeMotsCles = Liste([.. meta.MotsCles ?? [], .. classe.MotsCles]),
            DgeTexteContenu = texte, DgeIndexEtat = etat, DgeIndexeLe = maintenant,
            DgeClassification = classe.Regles.Count == 0 ? null : JsonSerializer.SerializeToDocument(new
            {
                regles = classe.Regles, categorie = classe.Categorie, confidentialite = classe.Confidentialite,
                le = maintenant.ToString("O", CultureInfo.InvariantCulture),
            }),
        };
        db.Documents.Add(d);
        await Enregistrer(ct);
        await AjouterVersion(d, c.Empreinte, c.Taille, fichier.FileName, mime, RegleVersions.Edition, null, null, "Dépôt", u, ct);
        if (meta.Coffre) await Coffrer(d, $"Dépôt {d.DgeCategorie ?? ""}".Trim(), u, ct);
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

    /// <summary>Contenus devenus inutilisés (ni version active ni version archivée) : ligne supprimée, fichier effacé après validation.</summary>
    protected async Task NettoyerContenus(IEnumerable<string> empreintes, CancellationToken ct)
    {
        var candidates = empreintes.Distinct().ToList();
        var orphelins = await db.Contenus.Where(c => candidates.Contains(c.CgeEmpreinte) && !db.Versions.Any(v => v.VgeEmpreinte == c.CgeEmpreinte)
            && !db.VersionsArchive.Any(v => v.VgeEmpreinte == c.CgeEmpreinte)).ToListAsync(ct);
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
        // Le texte indexé suit le contenu courant.
        (d.DgeTexteContenu, d.DgeIndexEtat) = ExtraireTexte(c.Chemin, fichier.FileName, TypeMime(fichier));
        d.DgeIndexeLe = DateTimeOffset.UtcNow;
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

    private static string? TexteJson(JsonElement valeur) =>
        valeur.ValueKind switch { JsonValueKind.Null or JsonValueKind.Undefined => null, JsonValueKind.String => valeur.GetString(), _ => valeur.GetRawText() };

    private static string[] TableauJson(JsonElement valeur) => valeur.ValueKind switch
    {
        JsonValueKind.Array => Liste(valeur.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String ? x.GetString() ?? "" : x.GetRawText())),
        JsonValueKind.String => Liste((valeur.GetString() ?? "").Split(',')),
        _ => [],
    };

    /// <summary>
    /// Informations du document ; au coffre-fort, seules les informations de classement changent (résumé, notes, accès,
    /// mots-clés, répertoire du même élément). Confidentialité et accès : auteur du dépôt ou administrateur. Un document
    /// classé dans un répertoire d'un autre élément y est lié (avec les pièces jointes du mail).
    /// </summary>
    public virtual async Task<DocumentDetailDto> Modifier(long id, Dictionary<string, JsonElement> meta, Utilisateur u, CancellationToken ct)
    {
        var d = await Charger(id, u, ct);
        Modifiable(d, u);
        var autorises = d.DgeCoffre ? ModifiablesCoffre : Modifiables;
        var avant = (d.DgeTypeElement, d.DgeIdElement);
        foreach (var (cle, valeur) in meta)
        {
            var texte = TexteJson(valeur);
            if (!autorises.Contains(cle))
            {
                if (d.DgeCoffre && Modifiables.Contains(cle) && Texte(texte) != Texte(Actuel(d, cle)))
                    throw ExceptionMetier.Invalide("COFFRE", "Document du coffre-fort : seules les informations de classement sont modifiables");
                continue;
            }
            if (CleAcces.Contains(cle) && !AccesGed.PeutChanger(d.DgeCreePar, u)) throw ExceptionMetier.AccesRefuse("CONFIDENTIALITE");
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
                case "confidentialite": d.DgeConfidentialite = Confidentialite(texte); break;
                case "acces_profils": d.DgeAccesProfils = TableauJson(valeur); break;
                case "acces_utilisateurs": d.DgeAccesUtilisateurs = TableauJson(valeur); break;
                case "mots_cles": d.DgeMotsCles = TableauJson(valeur); break;
                case "langue": d.DgeLangue = Texte(texte) ?? "fr"; break;
                case "repertoire_id": await Classer(d, long.TryParse(texte, CultureInfo.InvariantCulture, out var r) ? r : null, ct); break;
            }
        }
        var elementChange = (d.DgeTypeElement, d.DgeIdElement) != avant;
        if (elementChange)
        {
            await ControlerElement(d.DgeTypeElement, d.DgeIdElement, ct);
            // Répertoire d'un autre élément : le document n'y est plus classé.
            if (d.DgeRepertoireId is { } rep && !await db.Repertoires.AnyAsync(x => x.RgeId == rep && x.RgeTypeElement == d.DgeTypeElement && x.RgeIdElement == d.DgeIdElement, ct))
                d.DgeRepertoireId = null;
            // Pièces jointes d'un mail (hors coffre) : suivent leur mail.
            var pieces = await db.Documents.Where(x => x.DgeParentId == id && !x.DgeCoffre && x.DgeTypeElement == avant.DgeTypeElement && x.DgeIdElement == avant.DgeIdElement).ToListAsync(ct);
            foreach (var p in pieces) { p.DgeTypeElement = d.DgeTypeElement; p.DgeIdElement = d.DgeIdElement; p.DgeRepertoireId = d.DgeRepertoireId; }
        }
        d.DgeModifieLe = DateTimeOffset.UtcNow;
        await Enregistrer(ct);
        return await Document(id, u, ct);
    }

    /// <summary>Classement dans un répertoire (null : racine de l'élément) ; un répertoire d'un autre élément y lie le document.</summary>
    private async Task Classer(DocumentGed d, long? repertoireId, CancellationToken ct)
    {
        if (repertoireId is null) { d.DgeRepertoireId = null; return; }
        var r = await db.Repertoires.AsNoTracking().FirstOrDefaultAsync(x => x.RgeId == repertoireId, ct) ?? throw ExceptionMetier.Introuvable($"Répertoire {repertoireId}");
        if (r.RgeTypeElement != d.DgeTypeElement || r.RgeIdElement != d.DgeIdElement)
        {
            if (d.DgeCoffre) throw ExceptionMetier.Invalide("COFFRE", "Document du coffre-fort : il reste lié à son élément");
            d.DgeTypeElement = r.RgeTypeElement;
            d.DgeIdElement = r.RgeIdElement;
        }
        d.DgeRepertoireId = r.RgeId;
    }

    // ------------------------------------------------------------------ intégrité (mêmes règles que les déclencheurs)

    /// <summary>Enregistrement : erreurs des contraintes et déclencheurs de la base traduites en erreurs métier.</summary>
    protected async Task Enregistrer(CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException p) { throw Traduire(p); }
    }

    /// <summary>Message « GED_CODE : texte » des déclencheurs → ExceptionMetier (code sans le préfixe GED_).</summary>
    protected static Exception Traduire(PostgresException p)
    {
        var texte = p.MessageText;
        var i = texte.IndexOf(" : ", StringComparison.Ordinal);
        var code = texte.StartsWith("GED_", StringComparison.Ordinal) && i > 0 ? texte[4..i] : null;
        var message = i > 0 ? texte[(i + 3)..] : texte;
        return p.SqlState switch
        {
            "23505" => ExceptionMetier.Invalide("DOUBLON", "Cet élément existe déjà"),
            "23514" or "23503" when code is not null => ExceptionMetier.Invalide(code, char.ToUpperInvariant(message[0]) + message[1..]),
            "P0002" => ExceptionMetier.Introuvable(message),
            _ => p,
        };
    }

    /// <summary>
    /// Élément lié : type et identifiant ensemble, élément existant (f_ged_element_existe, remplacée par l'application).
    /// Le déclencheur tr_ged_element_existe le garantit aussi en base ; le contrôle ici donne un message clair avant le dépôt.
    /// </summary>
    protected async Task ControlerElement(string? type, string? id, CancellationToken ct)
    {
        if (type is null && id is null) return;
        if (type is null || id is null) throw ExceptionMetier.Invalide("ELEMENT", "Élément lié incomplet : type et identifiant vont ensemble");
        var existe = await db.Database.SqlQuery<bool?>($"SELECT f_ged_element_existe({type}, {id}) AS \"Value\"").SingleAsync(ct);
        if (existe is null) throw ExceptionMetier.Invalide("ELEMENT_TYPE", $"Type d'élément inconnu : {type}");
        if (existe is false) throw ExceptionMetier.Invalide("ELEMENT_INEXISTANT", $"Élément lié inexistant : {type} {id}");
    }

    /// <summary>
    /// Pièce jointe : parent visible, ni le document lui-même ni l'une de ses pièces jointes (pas de boucle dans la
    /// hiérarchie ; le déclencheur tr_ged_parent_sans_boucle l'interdit aussi en base).
    /// </summary>
    protected async Task ControlerParent(long? documentId, long parentId, Utilisateur u, CancellationToken ct)
    {
        await Charger(parentId, u, ct);
        if (documentId is null) return;
        var vus = new HashSet<long>();
        for (long? x = parentId; x is { } courant; x = await db.Documents.AsNoTracking().Where(d => d.DgeId == courant).Select(d => d.DgeParentId).FirstOrDefaultAsync(ct))
        {
            if (courant == documentId) throw ExceptionMetier.Invalide("BOUCLE", "Un document ne peut pas être une pièce jointe de lui-même ou de ses pièces jointes");
            if (!vus.Add(courant)) break;
        }
    }

    /// <summary>Statistiques d'utilisation d'un élément lié, ou de toute la GED sans élément précisé.</summary>
    public virtual async Task<StatistiquesGedDto> Statistiques(string? typeElement, string? idElement, CancellationToken ct)
    {
        var q = db.Statistiques.AsNoTracking();
        if (!string.IsNullOrEmpty(typeElement)) q = q.Where(s => s.SgeTypeElement == typeElement && s.SgeIdElement == (idElement ?? ""));
        var l = await q.ToListAsync(ct);
        return new StatistiquesGedDto(l.Sum(s => s.SgeNbDocuments), l.Sum(s => s.SgeNbSupprimes), l.Sum(s => s.SgeNbCoffre), l.Sum(s => s.SgeNbVersions),
            l.Sum(s => s.SgeTaille), l.Sum(s => s.SgeNbConsultations), l.Max(s => s.SgeDerniereActivite));
    }

    private static string? Actuel(DocumentGed d, string cle) => cle switch
    {
        "titre" => d.DgeTitre, "categorie" => d.DgeCategorie, "auteur" => d.DgeAuteur, "type_element" => d.DgeTypeElement,
        "id_element" => d.DgeIdElement, "date_document" => d.DgeDateDocument?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), _ => null,
    };

    // ------------------------------------------------------------------ répertoires

    /// <summary>Répertoires d'un élément lié (ou globaux, sans élément) et nombre de documents actifs visibles de chacun.</summary>
    public virtual async Task<List<RepertoireDto>> Repertoires(string? typeElement, string? idElement, Utilisateur u, CancellationToken ct)
    {
        var type = Texte(typeElement);
        var id = Texte(idElement);
        var reps = await db.Repertoires.AsNoTracking().Where(r => r.RgeTypeElement == type && r.RgeIdElement == id).OrderBy(r => r.RgeNom).ToListAsync(ct);
        var ids = reps.Select(r => r.RgeId).ToList();
        var nb = await Visibles(db.Documents.AsNoTracking(), u).Where(d => !d.DgeSupprime && !d.DgeArchive && d.DgeRepertoireId != null && ids.Contains(d.DgeRepertoireId.Value))
            .GroupBy(d => d.DgeRepertoireId!.Value).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        return reps.Select(r => new RepertoireDto(r.RgeId, r.RgeNom, r.RgeParentId, r.RgeTypeElement, r.RgeIdElement, nb.GetValueOrDefault(r.RgeId))).ToList();
    }

    private static string NomRepertoire(string? nom)
    {
        var n = Texte(nom) ?? throw ExceptionMetier.Invalide("NOM", "Nom de répertoire obligatoire");
        if (n.Length > 150 || n.IndexOfAny(['/', '\\']) >= 0) throw ExceptionMetier.Invalide("NOM", "Nom de répertoire invalide (150 caractères, sans / ni \\)");
        return n;
    }

    public virtual async Task<RepertoireDto> CreerRepertoire(DemandeRepertoire demande, Utilisateur u, CancellationToken ct)
    {
        var nom = NomRepertoire(demande.Nom);
        string? type = Texte(demande.TypeElement), id = Texte(demande.IdElement);
        if (demande.ParentId is { } p)
        {
            var parent = await db.Repertoires.AsNoTracking().FirstOrDefaultAsync(r => r.RgeId == p, ct) ?? throw ExceptionMetier.Introuvable($"Répertoire {p}");
            (type, id) = (parent.RgeTypeElement, parent.RgeIdElement);
        }
        else await ControlerElement(type, id, ct);
        if (!specialisation.PeutDeposer(u, type, id)) throw ExceptionMetier.AccesRefuse("DEPOSER");
        var r = new RepertoireGed { RgeNom = nom, RgeParentId = demande.ParentId, RgeTypeElement = type, RgeIdElement = id, RgeCreeLe = DateTimeOffset.UtcNow, RgeCreePar = u.Code };
        db.Repertoires.Add(r);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" })
        {
            throw ExceptionMetier.Invalide("DOUBLON", $"Un répertoire « {nom} » existe déjà à cet endroit");
        }
        return new RepertoireDto(r.RgeId, r.RgeNom, r.RgeParentId, r.RgeTypeElement, r.RgeIdElement, 0);
    }

    /// <summary>Renommage (nom) ou déplacement (parent_id, null = racine de l'élément), sans changer d'élément lié.</summary>
    public virtual async Task<RepertoireDto> ModifierRepertoire(long id, Dictionary<string, JsonElement> demande, Utilisateur u, CancellationToken ct)
    {
        var r = await db.Repertoires.FirstOrDefaultAsync(x => x.RgeId == id, ct) ?? throw ExceptionMetier.Introuvable($"Répertoire {id}");
        if (!specialisation.PeutDeposer(u, r.RgeTypeElement, r.RgeIdElement)) throw ExceptionMetier.AccesRefuse("DEPOSER");
        if (demande.TryGetValue("nom", out var nom)) r.RgeNom = NomRepertoire(TexteJson(nom));
        if (demande.TryGetValue("parent_id", out var pv))
        {
            long? parent = long.TryParse(TexteJson(pv), CultureInfo.InvariantCulture, out var x) ? x : null;
            if (parent is { } p)
            {
                var cible = await db.Repertoires.AsNoTracking().FirstOrDefaultAsync(y => y.RgeId == p, ct) ?? throw ExceptionMetier.Introuvable($"Répertoire {p}");
                if (cible.RgeTypeElement != r.RgeTypeElement || cible.RgeIdElement != r.RgeIdElement)
                    throw ExceptionMetier.Invalide("REPERTOIRE_ELEMENT", "Un répertoire se déplace sous le même élément");
            }
            r.RgeParentId = parent;
        }
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" })
        {
            throw ExceptionMetier.Invalide("DOUBLON", $"Un répertoire « {r.RgeNom} » existe déjà à cet endroit");
        }
        catch (DbUpdateException e) when (e.InnerException is PostgresException p) { throw Traduire(p); }
        return (await Repertoires(r.RgeTypeElement, r.RgeIdElement, u, ct)).First(x => x.Id == id);
    }

    /// <summary>Suppression d'un répertoire vide (ni sous-répertoire ni document, même masqué).</summary>
    public virtual async Task SupprimerRepertoire(long id, Utilisateur u, CancellationToken ct)
    {
        var r = await db.Repertoires.FirstOrDefaultAsync(x => x.RgeId == id, ct) ?? throw ExceptionMetier.Introuvable($"Répertoire {id}");
        if (!specialisation.PeutDeposer(u, r.RgeTypeElement, r.RgeIdElement)) throw ExceptionMetier.AccesRefuse("DEPOSER");
        if (await db.Repertoires.AnyAsync(x => x.RgeParentId == id, ct) || await db.Documents.AnyAsync(d => d.DgeRepertoireId == id, ct))
            throw ExceptionMetier.Invalide("REPERTOIRE_NON_VIDE", "Le répertoire n'est pas vide");
        db.Repertoires.Remove(r);
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ dérivations

    protected async Task<List<DerivationDto>> Derivations(long id, Utilisateur u, CancellationToken ct)
    {
        var liens = await db.Derivations.AsNoTracking().Where(x => x.DrgSourceId == id || x.DrgCibleId == id).OrderBy(x => x.DrgId).ToListAsync(ct);
        var autres = liens.Select(x => x.DrgSourceId == id ? x.DrgCibleId : x.DrgSourceId).Distinct().ToList();
        var docs = (await VersDtos(await Visibles(db.Documents.AsNoTracking(), u).Where(d => autres.Contains(d.DgeId)).ToListAsync(ct), ct)).ToDictionary(d => d.Id);
        return liens.Where(x => docs.ContainsKey(x.DrgSourceId == id ? x.DrgCibleId : x.DrgSourceId))
            .Select(x => new DerivationDto(x.DrgId, x.DrgType, x.DrgLangue, x.DrgCommentaire, x.DrgSourceId == id ? "cible" : "source",
                docs[x.DrgSourceId == id ? x.DrgCibleId : x.DrgSourceId], x.DrgCreeLe, x.DrgCreePar)).ToList();
    }

    /// <summary>Le document CibleId dérive du document id (version, traduction, adaptation, extrait, annotation).</summary>
    public virtual async Task<DocumentDetailDto> AjouterDerivation(long id, DemandeDerivation demande, Utilisateur u, CancellationToken ct)
    {
        var type = (demande.Type ?? "").Trim().ToUpperInvariant();
        if (!TypesDerivation.Contains(type)) throw ExceptionMetier.Invalide("TYPE", $"Type de dérivation inconnu : {demande.Type}");
        await Charger(id, u, ct);
        var cible = await Charger(demande.CibleId, u, ct);
        Modifiable(cible, u);
        if (demande.CibleId == id) throw ExceptionMetier.Invalide("DERIVATION_BOUCLE", "Un document ne dérive pas de lui-même");
        db.Derivations.Add(new DerivationGed
        {
            DrgSourceId = id, DrgCibleId = demande.CibleId, DrgType = type, DrgLangue = Texte(demande.Langue), DrgCommentaire = Texte(demande.Commentaire),
            DrgCreeLe = DateTimeOffset.UtcNow, DrgCreePar = u.Code,
        });
        await Enregistrer(ct);
        return await Document(id, u, ct);
    }

    public virtual async Task SupprimerDerivation(long derivationId, Utilisateur u, CancellationToken ct)
    {
        var x = await db.Derivations.FirstOrDefaultAsync(r => r.DrgId == derivationId, ct) ?? throw ExceptionMetier.Introuvable($"Dérivation {derivationId}");
        Modifiable(await Charger(x.DrgCibleId, u, ct), u);
        db.Derivations.Remove(x);
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ indexation

    /// <summary>Texte du contenu courant extrait de nouveau (après un changement de règle d'extraction, ou un échec).</summary>
    public virtual async Task<DocumentDetailDto> Indexer(long id, Utilisateur u, CancellationToken ct)
    {
        var d = await Charger(id, u, ct);
        await IndexerDocument(d, ct);
        await db.SaveChangesAsync(ct);
        return await Document(id, u, ct);
    }

    private async Task IndexerDocument(DocumentGed d, CancellationToken ct)
    {
        var v = await db.Versions.AsNoTracking().Where(x => x.VgeDocument == d.DgeId).OrderByDescending(x => x.VgeNumero).FirstOrDefaultAsync(ct);
        var c = v is null ? null : await db.Contenus.AsNoTracking().FirstOrDefaultAsync(x => x.CgeEmpreinte == v.VgeEmpreinte, ct);
        (d.DgeTexteContenu, d.DgeIndexEtat) = c is null ? (null, ExtractionTexte.Echec) : ExtraireTexte(c.CgeChemin, v!.VgeNomFichier, v.VgeTypeMime);
        d.DgeIndexeLe = DateTimeOffset.UtcNow;
    }

    /// <summary>Documents en attente d'indexation (bases existantes, 200 par appel) : administrateur.</summary>
    public virtual async Task<ResultatIndexationDto> IndexerEnAttente(Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutPurger(u)) throw ExceptionMetier.AccesRefuse("INDEXER");
        var lot = await db.Documents.Where(d => d.DgeIndexEtat == ExtractionTexte.AFaire).OrderBy(d => d.DgeId).Take(200).ToListAsync(ct);
        foreach (var d in lot) await IndexerDocument(d, ct);
        await db.SaveChangesAsync(ct);
        return new ResultatIndexationDto(lot.Count, await db.Documents.CountAsync(d => d.DgeIndexEtat == ExtractionTexte.AFaire, ct));
    }

    // ------------------------------------------------------------------ contenu

    public virtual async Task<IResult> Contenu(long versionId, bool telecharger, HttpContext http, Utilisateur u, CancellationToken ct)
    {
        var v = await db.Versions.AsNoTracking().FirstOrDefaultAsync(x => x.VgeId == versionId, ct);
        if (v is null)
        {
            // Version d'un document archivé : lecture seule, sans consultation enregistrée.
            var a = await db.VersionsArchive.AsNoTracking().FirstOrDefaultAsync(x => x.VgeId == versionId, ct) ?? throw ExceptionMetier.Introuvable($"Version {versionId}");
            await DocumentArchive(a.VgeDocument, u, ct);
            v = a.VersVersion();
        }
        else
        {
            await Charger(v.VgeDocument, u, ct);
            // Consultation enregistrée : le déclencheur tient le compteur du document et les statistiques.
            db.Consultations.Add(new ConsultationGed { CogDocument = v.VgeDocument, CogVersion = v.VgeId, CogUtilisateur = u.Code, CogTelechargement = telecharger, CogDate = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync(ct);
        }
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
        await db.Derivations.Where(x => x.DrgSourceId == id || x.DrgCibleId == id).ExecuteDeleteAsync(ct);
        var versions = await db.Versions.AsNoTracking().Where(v => v.VgeDocument == id).ToListAsync(ct);
        await db.Versions.Where(v => v.VgeDocument == id).ExecuteDeleteAsync(ct);
        db.Documents.Remove(d);
        await db.SaveChangesAsync(ct);
        await NettoyerContenus(versions.Select(v => v.VgeEmpreinte), ct);
        await Valider(tx, ct);
    }

    // ------------------------------------------------------------------ rétention et archive

    /// <summary>Documents actifs (non masqués, hors pièces jointes) dont l'archivage ou la fin de conservation est atteint.</summary>
    public virtual async Task<List<EcheanceDocumentDto>> Echeances(Utilisateur u, CancellationToken ct)
    {
        var regles = await ReglesRetention(ct);
        var docs = await Visibles(db.Documents.AsNoTracking(), u).Where(d => !d.DgeSupprime && !d.DgeArchive && d.DgeParentId == null).ToListAsync(ct);
        var dues = docs.Select(d => (d, e: RegleRetention.Echeances(new DocumentRetention(d.DgeCategorie, d.DgeTypeElement, d.DgeDateDocument, d.DgeCreeLe), regles, Aujourdhui)))
            .Where(x => x.e.Statut != RegleRetention.Actif).ToList();
        var dtos = (await VersDtos(dues.Select(x => x.d).ToList(), ct)).ToDictionary(x => x.Id);
        return dues.Select(x => new EcheanceDocumentDto(dtos[x.d.DgeId], VersDto(x.e, regles))).ToList();
    }

    /// <summary>Archivage des documents arrivés à échéance (administrateur) : déplacés, ou archivés sur place au coffre-fort.</summary>
    public virtual async Task<ResultatRetentionDto> AppliquerRetention(Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutPurger(u)) throw ExceptionMetier.AccesRefuse("ARCHIVER");
        var dues = await Echeances(u, ct);
        var archives = 0;
        foreach (var e in dues) archives += await ArchiverFamille(e.Document.Id, u, $"Rétention : {e.Echeances.Libelle}", ct);
        return new ResultatRetentionDto(dues.Count, archives, dues.Select(e => e.Document.Id).ToList());
    }

    private async Task<int> ArchiverFamille(long id, Utilisateur u, string? motif, CancellationToken ct)
    {
        try
        {
            return await db.Database.SqlQuery<int>($"SELECT f_ged_archiver({id}, {u.Code}, {motif}) AS \"Value\"").SingleAsync(ct);
        }
        catch (PostgresException p) { throw Traduire(p); }
    }

    /// <summary>Archivage manuel d'un document (et des pièces jointes de son mail).</summary>
    public virtual async Task<int> Archiver(long id, DemandeArchivage demande, Utilisateur u, CancellationToken ct)
    {
        var d = await Charger(id, u, ct);
        Modifiable(d, u);
        if (d.DgeSupprime) throw ExceptionMetier.Invalide("SUPPRIME", "Document supprimé : restaurez-le d'abord");
        if (d.DgeParentId is not null) throw ExceptionMetier.Invalide("ARCHIVE_PIECE", "Une pièce jointe s'archive avec son mail");
        return await ArchiverFamille(id, u, Texte(demande.Motif), ct);
    }

    /// <summary>Restauration d'un document archivé (et de sa famille).</summary>
    public virtual async Task<DocumentDetailDto> RestaurerArchive(long id, Utilisateur u, CancellationToken ct)
    {
        var d = await Document(id, u, ct);
        if (!d.Archive) throw ExceptionMetier.Invalide("NON_ARCHIVE", "Ce document n'est pas archivé");
        if (!specialisation.PeutDeposer(u, d.TypeElement, d.IdElement)) throw ExceptionMetier.AccesRefuse("DEPOSER");
        try
        {
            await db.Database.SqlQuery<int>($"SELECT f_ged_restaurer_archive({id}) AS \"Value\"").SingleAsync(ct);
        }
        catch (PostgresException p) { throw Traduire(p); }
        return await Document(id, u, ct);
    }
}
