using System.Text.Json;
using System.Text.RegularExpressions;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Documents.Web;

/// <summary>
/// Services d'un document (classe mère générique) : définition du type, création, enregistrement en un seul
/// appel avec recalcul et détection des écarts, validation et numérotation légale, indices, copies, historique,
/// cas de test. Les spécificités passent par <see cref="SpecialisationDocument{TDoc, TLigne, TComplet}"/> et les handlers.
/// </summary>
public class DocumentService<TDoc, TLigne, TComplet>(
    DocumentDbContext<TDoc, TLigne> db,
    PersistanceDocument<TDoc, TLigne, TComplet> persistance,
    RegistreHandlers<TDoc, TLigne> handlers,
    SpecialisationDocument<TDoc, TLigne, TComplet> specialisation,
    NettoyageHtml html,
    IDroits? droits = null)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
    where TComplet : DocumentComplet<TDoc, TLigne>, new()
{
    protected DocumentDbContext<TDoc, TLigne> Db => db;
    protected SpecialisationDocument<TDoc, TLigne, TComplet> Specialisation => specialisation;
    /// <summary>Conditions de paiement et échéancier des pièces.</summary>
    public EcheancierDocument<TDoc, TLigne, TComplet> Echeancier => field ??= new(db, specialisation);
    /// <summary>Règles des documents à trois niveaux (global, famille, type).</summary>
    public ReglesDocuments<TDoc, TLigne, TComplet> Regles => field ??= new(db, specialisation);

    // ------------------------------------------------------------------ paramétrage

    public virtual async Task<DefinitionType> Definition(string code, Utilisateur u, CancellationToken ct)
    {
        var type = await db.TypesDocument.AsNoTracking().FirstOrDefaultAsync(t => t.TydCode == code, ct)
            ?? throw ExceptionMetier.Introuvable($"Type de document {code}");
        return new DefinitionType
        {
            Type = type,
            Proprietes = await db.ProprietesDefinition.AsNoTracking().Where(p => p.PrdTydId == type.TydId).OrderBy(p => p.PrdOrdre).ToListAsync(ct),
            Statuts = await db.StatutsDocument.AsNoTracking().Where(s => s.StdTydId == type.TydId).OrderBy(s => s.StdOrdre).ToListAsync(ct),
            TypesLigne = await db.TypesLigne.AsNoTracking().OrderBy(t => t.TylId).ToListAsync(ct),
            TauxTva = await db.TauxTva.AsNoTracking().Where(t => t.TtvActif).OrderBy(t => t.TtvOrdre).ThenBy(t => t.TtvCode).ToListAsync(ct),
            Unites = await db.Unites.AsNoTracking().Where(x => x.UntActif).OrderBy(x => x.UntOrdre).ThenBy(x => x.UntCode).ToListAsync(ct),
            Transformations = await db.TransformationsAutorisees.AsNoTracking().Where(t => t.TraSourceTydId == type.TydId).ToListAsync(ct),
            Droits = await ActionsAsync(u, type, ct),
            Etiquettes = (await db.Set<EtiquetteLigne>().AsNoTracking().Where(e => e.EtlActif).OrderBy(e => e.EtlOrdre).ToListAsync(ct))
                .Select(e => new EtiquetteDto(e.EtlCode, e.EtlLibelle, e.EtlCouleur, e.EtlOrdre, e.EtlActif)).ToList(),
            CouleursTypePrix = (await db.Set<CouleurTypePrix>().AsNoTracking().ToListAsync(ct)).Select(c => new CouleurTypePrixDto(c.CtpType, c.CtpLibelle, c.CtpCouleur)).ToList(),
            Modeles = (await db.Set<ModeleDocument>().AsNoTracking().Where(m => m.ModActif).OrderBy(m => m.ModOrdre).ToListAsync(ct)).Select(m => new ModeleDto(m.ModCode, m.ModLibelle)).ToList(),
            ConditionsPaiement = await Echeancier.Conditions(false, ct),
            ModesReglement = await new ReferentielsDocument<TDoc, TLigne>(db).Modes(false, ct),
            ConditionDefaut = await Echeancier.Defaut(type.TydFamille, ct),
            Regles = await Regles.Resolues(type, ct),
        };
    }

    /// <summary>Actions du type employées par le module (noms historiques de droit_document).</summary>
    public static readonly string[] ActionsDocument = [ActionsDroits.Consulter, ActionsDroits.Creer, ActionsDroits.Modifier, ActionsDroits.Valider,
        ActionsDroits.Transformer, ActionsDroits.Supprimer, ActionsDroits.Approuver, ActionsDroits.Devalider, ActionsDroits.Forcer];

    /// <summary>Nœud du type dans l'arbre des droits (module Droits) : documents/{famille}/{code}.</summary>
    public static string NoeudDroits(TypeDocument t) => FamillesDocument.NoeudDroits(t.TydFamille, t.TydCode);

    /// <summary>
    /// Droit d'une action sur un type : par le module Droits s'il est branché (IDroits, alias des noms historiques), sinon
    /// par droit_document (sans module Droits, la consultation n'est pas contrôlée).
    /// </summary>
    protected internal async Task<bool> PeutAsync(Utilisateur u, TypeDocument type, string action, CancellationToken ct) =>
        droits is not null ? await droits.AutoriseAsync(u, NoeudDroits(type), action, ct)
        : action == ActionsDroits.Consulter || await db.DroitsDocument.AnyAsync(d => d.DrtProfil == u.Profil && d.DrtTydId == type.TydId && d.DrtAction == action, ct);

    protected async Task<List<string>> ActionsAsync(Utilisateur u, TypeDocument type, CancellationToken ct)
    {
        if (droits is null) return await db.DroitsDocument.AsNoTracking().Where(d => d.DrtProfil == u.Profil && d.DrtTydId == type.TydId).Select(d => d.DrtAction).ToListAsync(ct);
        var actions = new List<string>();
        foreach (var a in ActionsDocument) if (await droits.AutoriseAsync(u, NoeudDroits(type), a, ct)) actions.Add(a);
        return actions;
    }

    protected internal async Task VerifierDroit(Utilisateur u, int tydId, string action, CancellationToken ct)
    {
        if (!await PeutAsync(u, await Type(tydId, ct), action, ct)) throw ExceptionMetier.AccesRefuse(action);
    }

    protected internal async Task<TypeDocument> Type(int tydId, CancellationToken ct) =>
        await db.TypesDocument.AsNoTracking().FirstOrDefaultAsync(t => t.TydId == tydId, ct)
        ?? throw ExceptionMetier.Introuvable($"Type de document {tydId}");

    private async Task<StatutDocument> Statut(int tydId, string code, CancellationToken ct) =>
        await db.StatutsDocument.AsNoTracking().FirstOrDefaultAsync(s => s.StdTydId == tydId && s.StdCode == code, ct)
        ?? throw ExceptionMetier.Introuvable($"Statut {code}");

    /// <summary>
    /// Numéro d'un document au format du type (<see cref="NumeroDocument"/> : défaut préfixe, année, rang sur 5 chiffres,
    /// DV2026-00012) pour l'année donnée.
    /// </summary>
    public static string FormaterNumero(TypeDocument type, int annee, int rang) => NumeroDocument.Formater(type.TydFormatNumero, type.TydPrefixeNumero, annee, rang);

    /// <summary>Exercice du compteur : l'année, ou 0 pour un rang jamais remis à zéro (tyd_raz_numero J).</summary>
    public static int ExerciceCompteur(TypeDocument type, int annee) => NumeroDocument.Exercice(type.TydRazNumero, annee);

    /// <summary>
    /// Exercice du compteur, rang et année d'un numéro au format du type, null s'il ne le suit pas ; sans année dans le
    /// numéro, celle donnée par <paramref name="anneeDefaut"/>.
    /// </summary>
    public static (int Exercice, int Rang, int Annee)? LireNumero(TypeDocument type, string? numero, int anneeDefaut = 0)
    {
        var lu = NumeroDocument.Lire(type.TydFormatNumero, type.TydPrefixeNumero, numero);
        if (lu is null) return null;
        var annee = lu.Annee ?? anneeDefaut;
        return (ExerciceCompteur(type, annee), lu.Rang, annee);
    }

    /// <summary>Numéro déjà porté par un document (tous types), hors des documents exclus (les indices renommés).</summary>
    private Task<bool> NumeroPris(string numero, IReadOnlyCollection<long> exclus, CancellationToken ct) =>
        db.Documents.AnyAsync(d => d.EntNumero == numero && !exclus.Contains(d.EntId), ct);

    /// <summary>
    /// Numéro légal : rang suivant du compteur (incrément dans la transaction, pas de SEQUENCE) ; un rang déjà pris
    /// (numéro changé à la main) est sauté. Le compteur a pu être replacé sur un trou (<see cref="RecalerCompteur"/>).
    /// </summary>
    protected internal async Task<string> AttribuerNumero(TypeDocument type, DateOnly date, CancellationToken ct)
    {
        while (true)
        {
            var exercice = ExerciceCompteur(type, date.Year);
            var n = await db.Database.SqlQuery<int>($"""
                INSERT INTO compteur_numero (cnu_tyd_id, cnu_exercice, cnu_dernier_numero)
                VALUES ({type.TydId}, {exercice}, 1)
                ON CONFLICT (cnu_tyd_id, cnu_exercice)
                DO UPDATE SET cnu_dernier_numero = compteur_numero.cnu_dernier_numero + 1
                RETURNING cnu_dernier_numero AS "Value"
                """).ToListAsync(ct);
            var numero = FormaterNumero(type, date.Year, n[0]);
            if (!await NumeroPris(numero, [], ct)) return numero;
        }
    }

    /// <summary>Compteur d'un exercice replacé avant le premier rang libre (les trous sont comblés : il peut redescendre).</summary>
    private async Task RecalerCompteur(TypeDocument type, int exercice, CancellationToken ct)
    {
        var debut = NumeroDocument.Debut(type.TydFormatNumero, type.TydPrefixeNumero, exercice == 0 ? null : exercice);
        var pris = (await db.Documents.Where(d => d.EntNumero != null && d.EntNumero.StartsWith(debut)).Select(d => d.EntNumero).ToListAsync(ct))
            .Select(n => LireNumero(type, n)).Where(x => x is not null && x.Value.Exercice == exercice).Select(x => x!.Value.Rang).ToHashSet();
        var libre = 1;
        while (pris.Contains(libre)) libre++;
        await db.Database.ExecuteSqlAsync($"""
            INSERT INTO compteur_numero (cnu_tyd_id, cnu_exercice, cnu_dernier_numero) VALUES ({type.TydId}, {exercice}, {libre - 1})
            ON CONFLICT (cnu_tyd_id, cnu_exercice) DO UPDATE SET cnu_dernier_numero = {libre - 1}
            """, ct);
    }

    /// <summary>
    /// Changement du numéro d'un document modifiable (brouillon ; un document validé se dévalide d'abord) : droit de
    /// déverrouillage, et FORCER avec motif pour une numérotation continue ; refusé si une version est transférée en
    /// comptabilité. Le numéro suit le format du type ; s'il est pris, le prochain rang libre est retenu (avertissement).
    /// Tous les indices sont renommés (historique NUMERO : ancien numéro et motif) ; les compteurs des exercices
    /// concernés sont replacés sur le premier rang libre.
    /// </summary>
    public async Task<ReponseNumero<TComplet>> ChangerNumero(long id, DemandeNumero demande, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Unite().CommencerAsync(ct);
        var avant = await persistance.Charger(id, ct);
        var doc = avant.Document;
        var type = await Type(doc.EntTydId, ct);
        if (!specialisation.PeutDeverrouiller(u)) throw ExceptionMetier.AccesRefuse(ActionsDroits.Deverrouiller);
        var motif = demande.Motif?.Trim();
        if (type.TydNumerotationContinue)
        {
            await VerifierDroit(u, type.TydId, ActionsDroits.Forcer, ct);
            if (string.IsNullOrEmpty(motif)) throw ExceptionMetier.Invalide("NUMERO_MOTIF", "Numérotation continue : motif du changement de numéro obligatoire");
        }
        await VerifierModifiable(doc, ct);
        var groupe = await db.Documents.Where(d => doc.EntGroupeId == null ? d.EntId == id : d.EntGroupeId == doc.EntGroupeId).ToListAsync(ct);
        if (groupe.Any(d => d.EntEtatCompta == "T"))
        {
            throw ExceptionMetier.Conflit("NUMERO_TRANSFERE", "Pièce transférée en comptabilité : son numéro ne peut plus changer");
        }
        var lu = LireNumero(type, demande.Numero, doc.EntDate.Year)
            ?? throw ExceptionMetier.Invalide("NUMERO_FORMAT", $"Numéro attendu au format {FormaterNumero(type, doc.EntDate.Year, 1)} (format du type)");
        var (exercice, rang, annee) = lu;
        var ids = groupe.Select(d => d.EntId).ToList();
        while (await NumeroPris(FormaterNumero(type, annee, rang), ids, ct)) rang++;
        var numero = FormaterNumero(type, annee, rang);
        var avertissement = rang == lu.Rang ? null : $"Le numéro {FormaterNumero(type, annee, lu.Rang)} est déjà pris : {numero} retenu";
        var ancien = doc.EntNumero;
        if (numero == ancien) return new ReponseNumero<TComplet> { Document = avant, Numero = numero, Avertissement = avertissement };

        var trace = $"{ancien ?? "sans numéro"} → {numero}{(string.IsNullOrEmpty(motif) ? "" : $" : {motif}")}";
        trace = trace[..Math.Min(300, trace.Length)];
        foreach (var d in groupe) await Historiser(d.EntId == id ? avant : await persistance.Charger(d.EntId, ct), "NUMERO", u, ct, trace);
        await db.Documents.Where(d => ids.Contains(d.EntId)).ExecuteUpdateAsync(s => s.SetProperty(d => d.EntNumero, numero), ct);
        if (LireNumero(type, ancien, doc.EntDate.Year) is { } a && a.Exercice != exercice) await RecalerCompteur(type, a.Exercice, ct);
        await RecalerCompteur(type, exercice, ct);
        await tx.CommitAsync(ct);
        return new ReponseNumero<TComplet> { Document = await persistance.Charger(id, ct), Numero = numero, Avertissement = avertissement };
    }

    private async Task Historiser(TComplet avant, string action, Utilisateur u, CancellationToken ct, string? motif = null)
    {
        db.Historiques.Add(new DocumentHistorique
        {
            HisMotif = motif,
            HisEntId = avant.Document.EntId,
            HisVersion = avant.Document.EntVersion,
            HisAction = action,
            HisDate = DateTimeOffset.UtcNow,
            HisUtilisateur = u.Code,
            HisInstantane = PersistanceDocument<TDoc, TLigne, TComplet>.Instantane(avant),
        });
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ calcul

    public async Task<EntreeDocument<TDoc, TLigne>> Entree(TComplet d, CancellationToken ct)
    {
        var modifiable = await db.StatutsDocument.Where(s => s.StdId == d.Document.EntStdId).Select(s => s.StdModifiable).FirstOrDefaultAsync(ct);
        var taux = await db.TauxTva.AsNoTracking().ToListAsync(ct);
        // Le libellé affiché est figé à la validation du document.
        return specialisation.CreerEntree(d, taux, new OptionsCalcul { LibellesFiges = d.Document.EntStdId != 0 && !modifiable });
    }

    /// <summary>Calcul serveur sans enregistrement, avec comparaison si le client transmet ses résultats.</summary>
    public async Task<ReponseEnregistrement<TComplet>> Recalculer(TComplet d, CancellationToken ct)
    {
        var type = await Type(d.Document.EntTydId, ct);
        var r = handlers.Pour(type).Calculer(await Entree(d, ct));
        return new ReponseEnregistrement<TComplet>
        {
            Document = specialisation.VersComplet(r),
            Ecarts = specialisation.Comparateur.Comparer(d.Document, d.Lignes, r.Document, r.Lignes),
            Erreurs = r.Erreurs,
            Avertissements = r.Avertissements,
            VersionMoteurServeur = specialisation.VersionMoteur,
        };
    }

    /// <summary>
    /// Résultat du calcul d'un document (structure du pied, pieds de section, TVA, libellés affichés) sans
    /// enregistrement : éditions. Libellés figés d'un document validé conservés.
    /// </summary>
    public async Task<ResultatDocument<TDoc, TLigne>> Resultat(TComplet d, CancellationToken ct)
    {
        var type = await Type(d.Document.EntTydId, ct);
        return handlers.Pour(type).Calculer(await Entree(d, ct));
    }

    // ------------------------------------------------------------------ lecture, création

    /// <summary>
    /// Document complet ; avancement non verrouillé : précédents relus (un document d'avancement a pu être validé ou
    /// annulé depuis l'enregistrement), un document verrouillé gardant ceux de sa validation.
    /// </summary>
    public async Task<TComplet> Charger(long id, CancellationToken ct)
    {
        var d = await persistance.Charger(id, ct);
        if (RelirePrecedents(d.Document) && !d.Document.EntVerrouille) await AppliquerPrecedents(d.Lignes, id, ct);
        return d;
    }

    /// <summary>Modèles des textes d'introduction et de conclusion d'un type de document.</summary>
    public async Task<TextesType> TextesType(string code, CancellationToken ct)
    {
        var t = await db.TypesDocument.AsNoTracking().FirstOrDefaultAsync(x => x.TydCode == code, ct) ?? throw ExceptionMetier.Introuvable($"Type de document {code}");
        return new TextesType(t.TydTexteIntroHtml, t.TydTexteFinHtml);
    }

    /// <summary>Modèles des textes d'un type (administrateur) : recopiés dans les documents créés ensuite.</summary>
    public async Task<TextesType> EnregistrerTextesType(string code, TextesType textes, Utilisateur u, CancellationToken ct)
    {
        u.ExigerParametres();
        var t = await db.TypesDocument.FirstOrDefaultAsync(x => x.TydCode == code, ct) ?? throw ExceptionMetier.Introuvable($"Type de document {code}");
        t.TydTexteIntroHtml = string.IsNullOrWhiteSpace(textes.IntroHtml) ? null : html.Nettoyer(textes.IntroHtml);
        t.TydTexteFinHtml = string.IsNullOrWhiteSpace(textes.FinHtml) ? null : html.Nettoyer(textes.FinHtml);
        await db.SaveChangesAsync(ct);
        return new TextesType(t.TydTexteIntroHtml, t.TydTexteFinHtml);
    }

    public async Task<List<TDoc>> Lister(string? type, CancellationToken ct)
    {
        var q = db.Documents.AsNoTracking();
        if (type is not null)
        {
            var tyd = await db.TypesDocument.Where(t => t.TydCode == type).Select(t => t.TydId).FirstOrDefaultAsync(ct);
            q = q.Where(d => d.EntTydId == tyd);
        }
        return await q.OrderByDescending(d => d.EntId).Take(200).ToListAsync(ct);
    }

    public async Task<TComplet> Creer(CreationDocument c, Utilisateur u, CancellationToken ct)
    {
        var type = await Type(c.EntTydId, ct);
        await VerifierDroit(u, type.TydId, ActionsDroits.Creer, ct);
        await using var tx = await db.Unite().CommencerAsync(ct);
        var doc = new TDoc
        {
            EntTydId = type.TydId,
            EntDate = c.EntDate ?? DateOnly.FromDateTime(DateTime.Today),
            EntObjet = c.EntObjet,
            EntNotreReference = c.EntNotreReference,
            EntReferenceExterne = c.EntReferenceExterne,
            EntValiditeJours = c.EntValiditeJours ?? type.TydValiditeJours,
            // Textes d'introduction et de conclusion : modèles du type, modifiables ensuite dans le document.
            EntTexteIntroHtml = type.TydTexteIntroHtml,
            EntTexteFinHtml = type.TydTexteFinHtml,
            EntStdId = (await Statut(type.TydId, "BROUILLON", ct)).StdId,
            EntTiersId = c.EntTiersId,
            EntAdresseFacturation = c.EntAdresseFacturation,
            EntAdresseLivraison = c.EntAdresseLivraison,
            EntNumFormat = c.EntNumFormat ?? JsonDocument.Parse("""{"separateur":".","niveaux":[{"style":"1"}]}"""),
            EntVersionCalcul = specialisation.VersionMoteur,
            EntCreeLe = DateTimeOffset.UtcNow,
            EntCreePar = u.Code,
        };
        handlers.Pour(type).Initialiser(doc, type);
        // Numéro légal des factures et avoirs attribué à la validation ; les autres types sont numérotés à la création.
        if (!type.TydNumerotationContinue) doc.EntNumero = await AttribuerNumero(type, doc.EntDate, ct);
        db.Documents.Add(doc);
        await db.SaveChangesAsync(ct);
        doc.EntGroupeId = doc.EntId;
        await db.SaveChangesAsync(ct);
        var complet = await persistance.Charger(doc.EntId, ct);
        await Historiser(complet, "CREATION", u, ct);
        await tx.CommitAsync(ct);
        return complet;
    }

    /// <summary>
    /// Création et premier enregistrement du contenu (import d'un devis…) en une seule transaction : une erreur de
    /// l'enregistrement annule aussi la création (plus de document vide à supprimer après coup).
    /// </summary>
    public async Task<ReponseEnregistrement<TComplet>> CreerAvecContenu(CreationAvecContenu<TComplet> c, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Unite().CommencerAsync(ct);
        var cree = await Creer(c.Creation, u, ct);
        c.Contenu.Document.EntVersion = cree.Document.EntVersion;
        var reponse = await EnregistrerDans(cree.Document.EntId, c.Contenu, u, ct);
        await tx.CommitAsync(ct);
        return reponse;
    }

    // ------------------------------------------------------------------ enregistrement

    /// <summary>
    /// Enregistrement en un seul appel : contrôles, recalcul définitif, détection des écarts,
    /// historisation de l'état précédent et persistance. Verrouillage optimiste sur ent_version (409).
    /// </summary>
    public async Task<ReponseEnregistrement<TComplet>> Enregistrer(long id, TComplet d, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Unite().CommencerAsync(ct);
        var reponse = await EnregistrerDans(id, d, u, ct);
        await tx.CommitAsync(ct);
        return reponse;
    }

    /// <summary>Enregistrement dans la transaction de l'appelant (ajout de documents sources…).</summary>
    protected internal async Task<ReponseEnregistrement<TComplet>> EnregistrerDans(long id, TComplet d, Utilisateur u, CancellationToken ct)
    {
        var avant = await persistance.Charger(id, ct);
        var type = await Type(avant.Document.EntTydId, ct);
        await VerifierDroit(u, type.TydId, ActionsDroits.Modifier, ct);
        await VerifierModifiable(avant.Document, ct);
        if (d.Document.EntVersion != avant.Document.EntVersion)
        {
            throw ExceptionMetier.Conflit("VERSION", "Le document a été modifié par un autre utilisateur",
                new { version_client = d.Document.EntVersion, version_serveur = avant.Document.EntVersion });
        }

        // Entête : seuls les champs saisis sont repris ; numéro, statut, indice et traçabilité restent côté serveur.
        var e = JsonCalcul.Cloner(avant.Document); // « avant » reste intact pour l'historique
        e.EntDate = d.Document.EntDate == default ? e.EntDate : d.Document.EntDate;
        e.EntObjet = d.Document.EntObjet;
        e.EntNotreReference = d.Document.EntNotreReference;
        e.EntReferenceExterne = d.Document.EntReferenceExterne;
        e.EntDateExterne = d.Document.EntDateExterne;
        e.EntConsultation = string.IsNullOrWhiteSpace(d.Document.EntConsultation) ? null : d.Document.EntConsultation.Trim();
        // Document issu d'une transformation : son tiers ne change plus (P12) ; payeur et coordonnées restent modifiables.
        if (avant.Document.EntTiersId is long tiersFige && d.Document.EntTiersId != tiersFige && avant.Lignes.Any(l => l.LigOrigineId is not null))
        {
            throw ExceptionMetier.Invalide("TIERS_FIGE", "Document issu d'une transformation : le tiers ne change plus");
        }
        e.EntValiditeJours = d.Document.EntValiditeJours;
        e.EntTvaId = d.Document.EntTvaId;
        e.EntTexteIntroHtml = string.IsNullOrWhiteSpace(d.Document.EntTexteIntroHtml) ? null : html.Nettoyer(d.Document.EntTexteIntroHtml);
        e.EntTexteFinHtml = string.IsNullOrWhiteSpace(d.Document.EntTexteFinHtml) ? null : html.Nettoyer(d.Document.EntTexteFinHtml);
        e.EntTiersId = d.Document.EntTiersId;
        e.EntAdresseFacturation = d.Document.EntAdresseFacturation;
        e.EntAdresseLivraison = d.Document.EntAdresseLivraison;
        e.EntNumFormat = d.Document.EntNumFormat ?? e.EntNumFormat;
        e.EntPrecisionMontant = d.Document.EntPrecisionMontant;
        e.EntProprietes = d.Document.EntProprietes ?? e.EntProprietes;
        e.EntModele = d.Document.EntModele;
        e.EntEtiquettes = d.Document.EntEtiquettes ?? e.EntEtiquettes;
        e.EntRangAvancement = d.Document.EntRangAvancement;
        e.EntCpaCode = string.IsNullOrEmpty(d.Document.EntCpaCode) ? null : d.Document.EntCpaCode;
        e.EntModeReglement = string.IsNullOrEmpty(d.Document.EntModeReglement) ? null : d.Document.EntModeReglement;
        specialisation.CopierEnteteSaisie(e, d.Document, type);
        foreach (var l in d.Lignes)
        {
            l.LigEntId = id;
            l.LigLibelleHtml = html.Nettoyer(l.LigLibelleHtml);
        }

        var saisie = JsonCalcul.Cloner(d);
        saisie.Document = e;
        // Avancement : précédents relus (un autre document d'avancement a pu être validé entre-temps).
        if (RelirePrecedents(e)) await AppliquerPrecedents(saisie.Lignes, id, ct);
        var entree = await Entree(saisie, ct);
        var handler = handlers.Pour(type);
        var controles = new List<MessageCalcul>();
        // Type de ligne connu (serveur seul : sinon refus de la clé étrangère, sans la ligne en cause).
        var typesLigne = (await db.TypesLigne.AsNoTracking().Select(t => t.TylId).ToListAsync(ct)).ToHashSet();
        controles.AddRange(saisie.Lignes.Where(l => !typesLigne.Contains(l.LigTylId))
            .Select(l => new MessageCalcul(l.LigId, "TYPE_LIGNE", $"Type de ligne {l.LigTylId} inconnu")));
        if (controles.Count > 0) throw ExceptionMetier.Invalide(ErreursEnregistrement.Validation, "Lignes incorrectes", controles);
        handler.Controler(new ContexteDocument<TDoc, TLigne> { Type = type, Proprietes = await Proprietes(type.TydId, ct), Entree = entree }, controles);
        if (controles.Count > 0) throw ExceptionMetier.Invalide("CONTROLES", "Le document ne respecte pas le paramétrage", controles);

        var r = handler.Calculer(entree);
        var ecarts = specialisation.Comparateur.Comparer(d.Document, d.Lignes, r.Document, r.Lignes);

        await Historiser(avant, "MODIFICATION", u, ct);
        var reponse = await Persister(id, r, u, ct);
        reponse.Ecarts = ecarts.Select(x => x with { LigId = x.LigId is long l ? reponse.CorrespondanceLignes.GetValueOrDefault(l, l) : null }).ToList();
        return reponse;
    }

    private async Task<List<ProprieteDefinition>> Proprietes(int tydId, CancellationToken ct) =>
        await db.ProprietesDefinition.AsNoTracking().Where(p => p.PrdTydId == tydId).ToListAsync(ct);

    private async Task VerifierModifiable(TDoc d, CancellationToken ct)
    {
        var modifiable = await db.StatutsDocument.Where(s => s.StdId == d.EntStdId).Select(s => s.StdModifiable).FirstAsync(ct);
        // Un statut non modifiable bloque la modification quel que soit le profil.
        if (!modifiable || d.EntVerrouille) throw ExceptionMetier.Conflit("DOCUMENT_BLOQUE", "Le statut du document ne permet pas la modification");
    }

    /// <summary>Écrit l'entête et le contenu calculés, incrémente la version d'enregistrement.</summary>
    private async Task<ReponseEnregistrement<TComplet>> Persister(long id, ResultatDocument<TDoc, TLigne> r, Utilisateur u, CancellationToken ct)
    {
        var entite = await db.Documents.FirstAsync(x => x.EntId == id, ct);
        var versionAvant = entite.EntVersion;
        db.Entry(entite).CurrentValues.SetValues(r.Document);
        entite.EntId = id;
        entite.EntVersion = versionAvant + 1;
        entite.EntModifieLe = DateTimeOffset.UtcNow;
        entite.EntModifiePar = u.Code;
        entite.EntProprietes ??= JsonDocument.Parse("{}");
        entite.EntEtiquettes ??= JsonDocument.Parse("[]");
        db.Entry(entite).Property(x => x.EntVersion).OriginalValue = versionAvant;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw ExceptionMetier.Conflit("VERSION", "Le document a été modifié par un autre utilisateur");
        }

        var corr = await persistance.Ecrire(id, specialisation.VersComplet(r), ct);
        await RecalculerLiens(id, ct);
        await specialisation.ApresRecalculLiensAsync(db, id, ct);
        static Dictionary<long, long> Nouveaux(Dictionary<long, long> d) => d.Where(kv => kv.Key != kv.Value).ToDictionary();
        return new ReponseEnregistrement<TComplet>
        {
            Document = await persistance.Charger(id, ct),
            CorrespondanceLignes = Nouveaux(corr.Lignes),
            Correspondances = corr.Complements.ToDictionary(kv => kv.Key, kv => Nouveaux(kv.Value)),
            Erreurs = r.Erreurs,
            Avertissements = r.Avertissements,
            VersionMoteurServeur = specialisation.VersionMoteur,
        };
    }

    // ------------------------------------------------------------------ validation, suppression

    public async Task<ReponseEnregistrement<TComplet>> Valider(long id, DemandeVersion v, Utilisateur u, CancellationToken ct)
    {
        await ControlerMontantAsync(id, u, ct);
        await using var tx = await db.Unite().CommencerAsync(ct);
        var avant = await persistance.Charger(id, ct);
        await VerifierDroit(u, avant.Document.EntTydId, ActionsDroits.Valider, ct);
        if (v.EntVersion != avant.Document.EntVersion) throw ExceptionMetier.Conflit("VERSION", "Le document a été modifié par un autre utilisateur");
        var reponse = await ValiderDans(id, u, ct);
        await tx.CommitAsync(ct);
        return reponse;
    }

    /// <summary>
    /// Montants de validation (module Droits, D10 à D12) : HT de la pièce et cumul des pièces du même type validées par le
    /// même utilisateur pour le même tiers sur la période ; dépassés sans le droit FORCER : demande de validation par la
    /// spécialisation (hors transaction : elle reste quand la validation est refusée), puis 422 MONTANT_VALIDATION.
    /// </summary>
    protected async Task ControlerMontantAsync(long id, Utilisateur u, CancellationToken ct)
    {
        if (droits is null) return;
        var doc = await persistance.Charger(id, ct);
        var type = await Type(doc.Document.EntTydId, ct);
        var noeud = NoeudDroits(type);
        if (await droits.LimiteAsync(u, noeud, ct) is not { } limite || await droits.AutoriseAsync(u, noeud, ActionsDroits.Forcer, ct)) return;
        var montant = doc.Document.EntTotalHt;
        var depuis = DateTimeOffset.UtcNow.AddDays(-limite.Jours);
        var cumul = limite.Cumul < 0 ? 0m : await db.Database.SqlQuery<decimal>($"""
            SELECT COALESCE(SUM(d.ent_total_ht), 0) AS "Value" FROM document d
            WHERE d.ent_tyd_id = {type.TydId} AND d.ent_id <> {id} AND d.ent_is_reference
              AND d.ent_tiers_id IS NOT DISTINCT FROM {doc.Document.EntTiersId}
              AND EXISTS (SELECT 1 FROM document_historique h WHERE h.his_ent_id = d.ent_id AND h.his_action = 'VALIDATION'
                          AND h.his_utilisateur = {u.Code} AND h.his_date >= {depuis})
            """).FirstAsync(ct);
        if (limite.Depassement(montant, cumul) is not { } motif) return;
        var depassement = new DepassementValidation(motif, montant, cumul, limite);
        await specialisation.MontantDepasseAsync(db, doc, type, u, depassement, ct);
        throw ExceptionMetier.Invalide("MONTANT_VALIDATION", motif == "PIECE"
            ? $"Montant de la pièce ({montant:0.00} € HT) au-delà de votre limite de validation ({limite.Piece:0.00} €) : une demande de validation est transmise"
            : $"Cumul validé pour ce tiers sur {limite.Jours} jours ({cumul + montant:0.00} € HT) au-delà de votre limite ({limite.Cumul:0.00} €) : une demande de validation est transmise",
            depassement);
    }

    /// <summary>
    /// Validation automatique (<see cref="ValiderDans"/>) par un agent IA : permise seulement avec le droit VALIDER effectif
    /// de l'agent sur le nœud (module Droits : profil ∩ plafond) ; sans module Droits, jamais. Humain : rien n'est contrôlé.
    /// </summary>
    public static async Task ExigerValidationAgent(IDroits? droits, Utilisateur u, string noeud, CancellationToken ct)
    {
        if (u.Agent is null) return;
        if (droits is null || !await droits.AutoriseAsync(u, noeud, ActionsDroits.Valider, ct))
            throw ExceptionMetier.AgentInterdit($"{ActionsDroits.Valider} {noeud}");
    }

    /// <summary>
    /// Validation dans la transaction de l'appelant, sans contrôle du droit VALIDER : document intermédiaire validé
    /// automatiquement par une transformation (le droit TRANSFORMER de la source suffit). Agent IA sans VALIDER effectif
    /// sur le type : refus 403 AGENT_INTERDIT (rien n'est validé, l'appelant annule sa transaction).
    /// </summary>
    protected internal async Task<ReponseEnregistrement<TComplet>> ValiderDans(long id, Utilisateur u, CancellationToken ct)
    {
        var avant = await persistance.Charger(id, ct);
        var type = await Type(avant.Document.EntTydId, ct);
        await ExigerValidationAgent(droits, u, NoeudDroits(type), ct);
        await VerifierModifiable(avant.Document, ct);

        var saisie = JsonCalcul.Cloner(avant);
        // Avancement : précédents relus, comme à l'enregistrement (validation d'un autre document entre-temps).
        if (RelirePrecedents(saisie.Document)) await AppliquerPrecedents(saisie.Lignes, id, ct);
        await specialisation.CompleterValidationAsync(db, saisie, type, ct);
        var entree = await Entree(saisie, ct);
        var handler = handlers.Pour(type);
        var controles = new List<MessageCalcul>();
        var ctx = new ContexteDocument<TDoc, TLigne> { Type = type, Proprietes = await Proprietes(type.TydId, ct), Entree = entree };
        handler.Controler(ctx, controles);
        handler.AvantValidation(ctx, controles);
        specialisation.ControlerValidation(entree, controles);
        await specialisation.ControlerValidationAsync(db, avant, type, controles, ct);
        var r = handler.Calculer(entree);
        controles.AddRange(r.Erreurs);
        // Un brouillon peut attendre son tiers ; un document validé l'a toujours (stock : notre société, posée par la spécialisation).
        if (saisie.Document.EntTiersId is null && await Regles.Booleen("TIERS_OBLIGATOIRE", type, ct)) controles.Add(new MessageCalcul(null, "TIERS_OBLIGATOIRE", "Tiers du document à choisir avant la validation"));
        await ControlerRegles(saisie.Document, type, controles, ct);
        if (controles.Count > 0) throw ExceptionMetier.Invalide(ErreursEnregistrement.Validation, "Le document comporte des erreurs", controles);

        await Historiser(avant, "VALIDATION", u, ct);
        // Facture d'avancement dont la période est négative (retour en arrière) : elle devient un avoir d'avancement (Q26).
        if (type.TydAvancement == "F" && r.Document.EntTotalHt < 0 && type.TydAvoirTydId is int avoir)
        {
            var facture = type;
            type = await Type(avoir, ct);
            r.Document.EntTydId = type.TydId;
            r.Document.EntNatureAvoir = NaturesAvoir.Avancement;
            // Compteur interne (achats, sous-traitance) : numéro pris à la création dans celui de la facture ; l'avoir
            // prend le sien (AVS… plutôt que FST…), sauf un indice suivant (numéro conservé). Numérotation continue :
            // attribuée plus bas, au type de l'avoir.
            if (!facture.TydNumerotationContinue && !type.TydNumerotationContinue && type.TydId != facture.TydId && r.Document.EntIndice == "A")
            {
                r.Document.EntNumero = await AttribuerNumero(type, r.Document.EntDate, ct);
            }
        }
        // Pièce comptable (factures, avoirs) : à transférer à la comptabilité, sans écriture si le total est nul (13.9).
        // Une pièce déjà transférée (nouvelle version après dévalidation) reste transférée : le comptable corrige (P22).
        // Pièce comptable (règle PIECE_COMPTABLE, P9) : état comptable ; échéancier pour les ventes et les achats.
        var comptable = await Regles.Booleen("PIECE_COMPTABLE", type, ct);
        var echeancier = comptable && FamillesDocument.EstCommerciale(type.TydFamille);
        if (comptable && r.Document.EntEtatCompta != "T") r.Document.EntEtatCompta = r.Document.EntTotalTtc == 0 ? "S" : "A";
        if (type.TydNumerotationContinue && r.Document.EntNumero is null)
        {
            r.Document.EntNumero = await AttribuerNumero(type, r.Document.EntDate, ct);
        }
        r.Document.EntStdId = (await Statut(type.TydId, "VALIDE", ct)).StdId;
        r.Document.EntVerrouille = true;
        // Cycle de vie (P17) : approbation interne si la règle l'active, sinon envoi (validation de l'entreprise) ; sans
        // validation du tiers attendue, le document est aussitôt validé. Statut calculé après l'enregistrement.
        var maintenant = DateTimeOffset.UtcNow;
        if (await Regles.Booleen("APPROBATION", type, ct)) r.Document.EntApprouveLe = maintenant;
        else
        {
            r.Document.EntEnvoyeLe = maintenant;
            if (!await Regles.Booleen("VALIDATION_TIERS", type, ct)) r.Document.EntValideTiersLe = maintenant;
        }
        // Fin de validité : à partir du jour de la validation.
        r.Document.EntDateValidite = r.Document.EntValiditeJours is short jours ? DateOnly.FromDateTime(DateTime.Today).AddDays(jours) : null;
        // Pièce comptable : condition et mode de règlement figés (document, tiers ou défaut), échéancier après l'écriture.
        if (echeancier) await Echeancier.Figer(r.Document, type, ct);
        specialisation.PreparerValidation(r);
        var reponse = await Persister(id, r, u, ct);
        if (echeancier) await Echeancier.Ecrire(id, ct);
        await EcrireSoldes(id, type, u, ct);
        await specialisation.ApresValidationAsync(db, id, type, ct);
        // Statut du document et de ses documents d'origine (facturation, solde : P4).
        await RecalculerStatuts([id, .. await Origines(id, ct)], ct);
        // Relu après les soldes et le point d'accroche (lignes soldées, numéro de situation…).
        reponse.Document = await persistance.Charger(id, ct);
        return reponse;
    }

    // ------------------------------------------------------------------ contrôles de gestion (CONCEPTION-REGLES-DOCUMENTS.md, lot 6)

    private static DateOnly Aujourdhui => DateOnly.FromDateTime(DateTime.Today);

    /// <summary>Règles bloquantes de la validation : chronologie des pièces (R7), référence externe (R12), quantité dépassée (R17).</summary>
    private async Task ControlerRegles(TDoc d, TypeDocument type, List<MessageCalcul> controles, CancellationToken ct)
    {
        if (await Regles.Booleen("DATE_PIECE", type, ct))
        {
            if (d.EntDate > Aujourdhui) controles.Add(new MessageCalcul(null, "DATE_FUTURE", "La date du document est dans le futur"));
            if (d.EntDateExterne > Aujourdhui) controles.Add(new MessageCalcul(null, "DATE_FUTURE", "La date du fournisseur est dans le futur"));
            // Numérotation continue : pas avant la dernière pièce numérotée du même type (hors REMPLACE et groupe d'indices).
            if (type.TydNumerotationContinue && d.EntNumero is null)
            {
                var candidates = await (from x in db.Documents.AsNoTracking()
                                        join s in db.StatutsDocument.AsNoTracking() on x.EntStdId equals s.StdId
                                        where x.EntTydId == type.TydId && x.EntNumero != null && x.EntId != d.EntId && x.EntDate > d.EntDate
                                        select new PieceChronologie(x.EntId, x.EntNumero, x.EntDate, x.EntGroupeId, s.StdCode)).ToListAsync(ct);
                var derniere = ChronologiePieces.Derniere(candidates, d.EntId, d.EntGroupeId, d.EntDate);
                if (derniere is not null)
                {
                    controles.Add(new MessageCalcul(null, "DATE_ANTERIEURE",
                        $"La pièce {derniere.Numero} est datée du {derniere.Date:dd/MM/yyyy} : la date du document ne peut pas la précéder"));
                }
            }
        }
        if (string.IsNullOrWhiteSpace(d.EntReferenceExterne) && await Regles.Booleen("REFERENCE_EXTERNE_OBLIGATOIRE", type, ct))
        {
            controles.Add(new MessageCalcul(null, "REFERENCE_EXTERNE_OBLIGATOIRE", "Référence externe à saisir avant la validation"));
        }
        if (type.TydAvancement is null && await Regles.Texte("QUANTITE_DEPASSEE", type, ct) == "REFUS")
        {
            controles.AddRange(await Depassements(d.EntId, "QUANTITE_DEPASSEE", ct));
        }
    }

    private static string Quantite(decimal q) => q.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture).Replace('.', ',');

    private sealed record DepassementSql(long LigId, string? Numero, decimal Qte, decimal Reste);

    /// <summary>
    /// Lignes transformées au-delà du reste de leur parent (R17) : quantité du parent moins celles des autres documents
    /// validés non annulés à la même étape et les soldes écrits ailleurs (valeurs absolues : retours et avoirs).
    /// </summary>
    public async Task<List<MessageCalcul>> Depassements(long entId, string code, CancellationToken ct)
    {
        var lignes = await db.Database.SqlQuery<DepassementSql>($"""
            SELECT DISTINCT ON (l.lig_id) l.lig_id AS lig_id, l.lig_numerotation AS numero, abs(coalesce(l.lig_qte_vendue, 0)) AS qte,
                   abs(coalesce(p.lig_qte_vendue, 0))
                   - coalesce((SELECT abs(sum(x2.lil_qte)) FROM document_ligne_lien x2
                               JOIN document_ligne l2 ON l2.lig_id = x2.lil_cible_lig_id
                               JOIN document d2 ON d2.ent_id = l2.lig_ent_id
                               JOIN statut_document s2 ON s2.std_id = d2.ent_std_id
                               WHERE x2.lil_source_lig_id = x.lil_source_lig_id AND x2.lil_etape = x.lil_etape
                                 AND l2.lig_ent_id <> l.lig_ent_id AND d2.ent_verrouille AND s2.std_code NOT IN ('ANNULE', 'REMPLACE')), 0)
                   - coalesce((SELECT sum(s.lso_qte) FROM document_ligne_solde s
                               WHERE s.lso_lig_id = x.lil_source_lig_id AND s.lso_etape = x.lil_etape
                                 AND (s.lso_cible_lig_id IS NULL OR s.lso_cible_lig_id NOT IN (SELECT lig_id FROM document_ligne WHERE lig_ent_id = l.lig_ent_id))), 0) AS reste
            FROM document_ligne l
            JOIN document_ligne_lien x ON x.lil_cible_lig_id = l.lig_id AND x.lil_source_lig_id = l.lig_origine_id
            JOIN document_ligne p ON p.lig_id = x.lil_source_lig_id
            WHERE l.lig_ent_id = {entId} AND l.lig_tyl_id IN (2, 3)
            ORDER BY l.lig_id, x.lil_id
            """).ToListAsync(ct);
        return lignes.Where(l => l.Qte > Math.Max(l.Reste, 0))
            .Select(l => new MessageCalcul(l.LigId, code, $"Ligne {l.Numero} : quantité {Quantite(l.Qte)} au-delà du reste du parent ({Quantite(Math.Max(l.Reste, 0))})"))
            .ToList();
    }

    /// <summary>
    /// Avertissements de gestion (non bloquants) avant une action : VALIDER (total nul R8, référence externe en double
    /// R12, quantité dépassée R17, puis ceux du cœur) ou TRANSFORMER (fin de validité R3, document rejeté P25).
    /// </summary>
    public async Task<List<MessageCalcul>> Avertissements(long id, string action, CancellationToken ct)
    {
        var complet = await persistance.Charger(id, ct);
        var d = complet.Document;
        var type = await Type(d.EntTydId, ct);
        var res = new List<MessageCalcul>();
        if (action == ActionsDroits.Transformer)
        {
            if (d.EntRejeteLe is not null) res.Add(new MessageCalcul(null, "DOCUMENT_REJETE", $"Document rejeté par le tiers : {d.EntRejetMotif}"));
            if (d.EntDateValidite is DateOnly fin && fin < Aujourdhui && await Regles.Booleen("VALIDITE_ALERTE", type, ct))
            {
                res.Add(new MessageCalcul(null, "VALIDITE_DEPASSEE", $"Validité dépassée depuis le {fin:dd/MM/yyyy}"));
            }
        }
        else if (action == ActionsDroits.Valider)
        {
            if (d.EntTotalHt == 0 && await Regles.Texte("MONTANT_NUL", type, ct) == "AVERTISSEMENT")
            {
                res.Add(new MessageCalcul(null, "MONTANT_NUL", "Le total du document est nul"));
            }
            if (!string.IsNullOrWhiteSpace(d.EntReferenceExterne) && d.EntTiersId is not null && await Regles.Booleen("REFERENCE_EXTERNE_UNIQUE", type, ct))
            {
                var reference = d.EntReferenceExterne.Trim();
                var doublons = await (from x in db.Documents.AsNoTracking()
                                      join s in db.StatutsDocument.AsNoTracking() on x.EntStdId equals s.StdId
                                      where x.EntTydId == d.EntTydId && x.EntTiersId == d.EntTiersId && x.EntGroupeId != d.EntGroupeId
                                            && x.EntReferenceExterne != null && x.EntReferenceExterne.Trim() == reference && s.StdCode != "ANNULE" && s.StdCode != "REMPLACE"
                                      select x.EntNumero ?? "(brouillon)").ToListAsync(ct);
                if (doublons.Count > 0)
                {
                    res.Add(new MessageCalcul(null, "REFERENCE_EXTERNE_DOUBLE", $"Référence externe « {reference} » déjà portée par {string.Join(", ", doublons)}"));
                }
            }
            if (type.TydAvancement is null && await Regles.Texte("QUANTITE_DEPASSEE", type, ct) == "AVERTISSEMENT")
            {
                res.AddRange(await Depassements(id, "QUANTITE_DEPASSEE", ct));
            }
        }
        await specialisation.AvertissementsAsync(db, complet, type, await Regles.Resolues(type, ct), action, res, ct);
        return res;
    }

    // ------------------------------------------------------------------ cycle de vie (CONCEPTION-REGLES-DOCUMENTS.md, P17 à P25)

    /// <summary>Statuts recalculés (f_document_statut : étapes datées, facturation, solde, paiement).</summary>
    public async Task RecalculerStatuts(IEnumerable<long> ids, CancellationToken ct)
    {
        foreach (var id in ids.Distinct())
        {
            await db.Database.SqlQuery<string>($"SELECT coalesce(f_document_statut({id}), '') AS \"Value\"").ToListAsync(ct);
        }
    }

    /// <summary>Documents d'origine d'un document : sources de ses lignes (à toute étape) et de ses liens de transformation.</summary>
    public async Task<List<long>> Origines(long id, CancellationToken ct) =>
        await db.Database.SqlQuery<long>($"""
            SELECT DISTINCT s.lig_ent_id AS "Value" FROM document_ligne_lien x
            JOIN document_ligne c ON c.lig_id = x.lil_cible_lig_id JOIN document_ligne s ON s.lig_id = x.lil_source_lig_id
            WHERE c.lig_ent_id = {id} AND s.lig_ent_id <> {id}
            UNION SELECT lie_source_ent_id FROM document_lien WHERE lie_cible_ent_id = {id} AND lie_type = 'TRANSFORMATION'
            """).ToListAsync(ct);

    /// <summary>Étape datée du cycle de vie (envoi après approbation, validation du tiers), historisée, puis statut recalculé.</summary>
    private async Task<ReponseEnregistrement<TComplet>> Etape(long id, Utilisateur u, string action, Func<TDoc, TypeDocument, Task> appliquer, CancellationToken ct)
    {
        await using var tx = await db.Unite().CommencerAsync(ct);
        var avant = await persistance.Charger(id, ct);
        await VerifierDroit(u, avant.Document.EntTydId, ActionsDroits.Valider, ct);
        var type = await Type(avant.Document.EntTydId, ct);
        var doc = await db.Documents.FirstAsync(d => d.EntId == id, ct);
        await appliquer(doc, type);
        await Historiser(avant, action, u, ct);
        await db.SaveChangesAsync(ct);
        await RecalculerStatuts([id], ct);
        await tx.CommitAsync(ct);
        return new ReponseEnregistrement<TComplet> { Document = await persistance.Charger(id, ct) };
    }

    /// <summary>
    /// Dévalidation (P2, P18, P22, P23) : l'indice suivant devient la référence, en brouillon, avec tout le contenu ;
    /// l'ancienne version passe au statut REMPLACE (sans retour possible). Les liens (documents aval et parents), soldes,
    /// échéances (et leurs pointages) et données de la spécialisation sont reportés sur la nouvelle version. Droit
    /// DEVALIDER, ou FORCER pour une pièce comptable ou un document dont un document aval est validé ; motif obligatoire,
    /// historisé (DEVALIDATION ou FORCAGE).
    /// </summary>
    public async Task<TComplet> Devalider(long id, string motif, Utilisateur u, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(motif)) throw ExceptionMetier.Invalide("DEVALIDATION", "Motif de la dévalidation obligatoire");
        await using var tx = await db.Unite().CommencerAsync(ct);
        var avant = await persistance.Charger(id, ct);
        var type = await Type(avant.Document.EntTydId, ct);
        var statut = await db.StatutsDocument.AsNoTracking().FirstAsync(s => s.StdId == avant.Document.EntStdId, ct);
        if (!avant.Document.EntVerrouille || statut.StdCode is "ANNULE" or "REMPLACE")
        {
            throw ExceptionMetier.Invalide("DEVALIDATION", "Seul un document validé, ni annulé ni remplacé, se dévalide");
        }
        var avalValide = (await db.Database.SqlQuery<long>($"""
            SELECT DISTINCT dc.ent_id AS "Value" FROM document_ligne_lien x
            JOIN document_ligne s ON s.lig_id = x.lil_source_lig_id JOIN document_ligne c ON c.lig_id = x.lil_cible_lig_id
            JOIN document dc ON dc.ent_id = c.lig_ent_id JOIN statut_document sc ON sc.std_id = dc.ent_std_id
            WHERE s.lig_ent_id = {id} AND dc.ent_id <> {id} AND dc.ent_verrouille AND sc.std_code NOT IN ('ANNULE', 'REMPLACE')
            """).ToListAsync(ct)).Count > 0;
        var forcer = avalValide || await Regles.Booleen("PIECE_COMPTABLE", type, ct);
        await VerifierDroit(u, type.TydId, forcer ? ActionsDroits.Forcer : ActionsDroits.Devalider, ct);

        var indices = await db.Documents.Where(d => d.EntGroupeId == avant.Document.EntGroupeId).Select(d => d.EntIndice).ToListAsync(ct);
        var suivant = Numerotation.FormaterRang(indices.Select(i => Numerotation.LireDepart(i) ?? 0).Max() + 1, "A");
        await db.Documents.Where(d => d.EntGroupeId == avant.Document.EntGroupeId).ExecuteUpdateAsync(s => s.SetProperty(d => d.EntIsReference, false), ct);
        // Nouvelle version : mêmes parents (lig_origine_id de l'ancienne), correspondance ancienne ligne → ligne temporaire.
        var origines = avant.Lignes.ToDictionary(l => l.LigId, l => l.LigOrigineId);
        var versTemporaire = new Dictionary<long, long>();
        var copie = await Dupliquer(avant, d =>
        {
            d.EntIndice = suivant;
            d.EntIsReference = true;
            d.EntGroupeId = avant.Document.EntGroupeId;
            d.EntNumero = avant.Document.EntNumero;
            d.EntRangAvancement = avant.Document.EntRangAvancement;
            d.EntApprouveLe = null;
            d.EntEnvoyeLe = null;
            d.EntValideTiersLe = null;
            d.EntRejeteLe = null;
            d.EntRejetMotif = null;
        }, u, ct, contenu =>
        {
            foreach (var l in contenu.Lignes.Where(l => l.LigOrigineId is long))
            {
                versTemporaire[l.LigOrigineId!.Value] = l.LigId;
                l.LigOrigineId = origines.GetValueOrDefault(l.LigOrigineId!.Value);
            }
            return contenu;
        });
        var nouveau = copie.Document.Document.EntId;
        var lignes = versTemporaire.Where(kv => copie.CorrespondanceLignes.ContainsKey(kv.Value))
            .ToDictionary(kv => kv.Key, kv => copie.CorrespondanceLignes[kv.Value]);
        await ReporterVersion(id, nouveau, lignes, ct);
        await specialisation.ReporterVersionAsync(db, id, nouveau, lignes, ct);

        var remplace = (await Statut(type.TydId, "REMPLACE", ct)).StdId;
        await db.Documents.Where(d => d.EntId == id).ExecuteUpdateAsync(s => s.SetProperty(d => d.EntStdId, remplace), ct);
        await Historiser(avant, forcer ? "FORCAGE" : "DEVALIDATION", u, ct, motif.Trim()[..Math.Min(300, motif.Trim().Length)]);
        await RecalculerStatuts([nouveau, .. await Origines(nouveau, ct)], ct);
        await tx.CommitAsync(ct);
        return await persistance.Charger(nouveau, ct);
    }

    /// <summary>Report des données du module de l'ancienne version sur la nouvelle (liens, soldes, échéances).</summary>
    private async Task ReporterVersion(long ancien, long nouveau, Dictionary<long, long> lignes, CancellationToken ct)
    {
        foreach (var (a, b) in lignes)
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_ligne_lien SET lil_source_lig_id = {b} WHERE lil_source_lig_id = {a}", ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_ligne_lien SET lil_cible_lig_id = {b} WHERE lil_cible_lig_id = {a}", ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_ligne_solde SET lso_lig_id = {b} WHERE lso_lig_id = {a}", ct);
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_ligne_solde SET lso_cible_lig_id = {b} WHERE lso_cible_lig_id = {a}", ct);
        }
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_lien SET lie_source_ent_id = {nouveau} WHERE lie_source_ent_id = {ancien} AND lie_type <> 'COPIE'", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_lien SET lie_cible_ent_id = {nouveau} WHERE lie_cible_ent_id = {ancien} AND lie_type <> 'COPIE'", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE document_echeance SET ech_ent_id = {nouveau} WHERE ech_ent_id = {ancien}", ct);
    }

    /// <summary>Envoi d'un document approuvé (validation de l'entreprise) ; sans validation du tiers : validé aussitôt.</summary>
    public Task<ReponseEnregistrement<TComplet>> Envoyer(long id, Utilisateur u, CancellationToken ct) => Etape(id, u, "ENVOI", async (d, type) =>
    {
        if (!d.EntVerrouille || d.EntApprouveLe is null || d.EntEnvoyeLe is not null) throw ExceptionMetier.Invalide("CYCLE", "Seul un document approuvé, pas encore envoyé, s'envoie");
        d.EntEnvoyeLe = DateTimeOffset.UtcNow;
        if (!await Regles.Booleen("VALIDATION_TIERS", type, ct)) d.EntValideTiersLe = d.EntEnvoyeLe;
    }, ct);

    /// <summary>Validation du tiers (devis accepté, situation visée, facture acceptée…) d'un document envoyé.</summary>
    public Task<ReponseEnregistrement<TComplet>> ValiderTiers(long id, Utilisateur u, CancellationToken ct) => Etape(id, u, "VALIDATION_TIERS", (d, _) =>
    {
        if (d.EntEnvoyeLe is null || d.EntValideTiersLe is not null) throw ExceptionMetier.Invalide("CYCLE", "Seul un document envoyé, pas encore validé par le tiers, se valide");
        d.EntValideTiersLe = DateTimeOffset.UtcNow;
        d.EntRejeteLe = null;
        d.EntRejetMotif = null;
        return Task.CompletedTask;
    }, ct);

    /// <summary>Rejet d'un document envoyé (plateforme, tiers) : noté avec son motif ; il reste ENVOYE jusqu'à l'avoir.</summary>
    public Task<ReponseEnregistrement<TComplet>> Rejeter(long id, string motif, Utilisateur u, CancellationToken ct) => Etape(id, u, "REJET", (d, _) =>
    {
        if (d.EntEnvoyeLe is null || d.EntValideTiersLe is not null) throw ExceptionMetier.Invalide("CYCLE", "Seul un document envoyé, pas encore validé par le tiers, se rejette");
        if (string.IsNullOrWhiteSpace(motif)) throw ExceptionMetier.Invalide("CYCLE", "Motif du rejet obligatoire");
        d.EntRejeteLe = DateTimeOffset.UtcNow;
        d.EntRejetMotif = motif.Trim()[..Math.Min(300, motif.Trim().Length)];
        return Task.CompletedTask;
    }, ct);

    // ------------------------------------------------------------------ liens de transformation et soldes

    /// <summary>
    /// Quantités des liens de transformation recalculées depuis les lignes du document cible (quantité modifiée après
    /// la transformation) ; une ligne supprimée a emporté ses liens. Une situation (état cumulé, présentation C) ne
    /// consomme pas de reste : quantité 0 ; une facture d'avancement : quantité de la période.
    /// </summary>
    private async Task RecalculerLiens(long id, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE document_ligne_lien x
            SET lil_qte = CASE WHEN d.ent_avt_presentation = 'C' THEN 0
                               WHEN EXISTS (SELECT 1 FROM document_ligne_lien y
                                            WHERE y.lil_cible_lig_id = x.lil_cible_lig_id AND y.lil_etape IN ('RETOUR', 'AVOIR'))
                               THEN -coalesce(l.lig_qte_vendue, 0) ELSE coalesce(l.lig_qte_vendue, 0) END,
                lil_montant_ht = l.lig_montant_ht
            FROM document_ligne l JOIN document d ON d.ent_id = l.lig_ent_id
            WHERE l.lig_id = x.lil_cible_lig_id AND l.lig_ent_id = {id} AND x.lil_avancement_pct IS NULL
            """, ct);
    }

    /// <summary>Précédent d'une ligne du marché : montant, quantité et % cumulés du dernier document d'avancement.</summary>
    public sealed record Precedent(decimal Montant, decimal Qte, decimal Pct);

    /// <summary>
    /// Précédents des lignes du marché (lig_avt_source_lig_id) : dernier document valable (PerimetreDocuments : ni
    /// remplacé par un indice suivant, ni annulé) qui facture
    /// l'avancement (présentation P) ou le reprend d'un autre logiciel (type R), hors le document lui-même (Q31, 13.11).
    /// </summary>
    protected internal async Task<Dictionary<long, Precedent>> Precedents(IReadOnlyCollection<long> sources, long? exclure, CancellationToken ct)
    {
        if (sources.Count == 0) return [];
        var lignes = await (from l in db.Lignes.AsNoTracking()
                            join d in db.Documents.AsNoTracking().Valables(db) on l.LigEntId equals d.EntId
                            join t in db.TypesDocument.AsNoTracking() on d.EntTydId equals t.TydId
                            where l.LigAvtSourceLigId != null && sources.Contains(l.LigAvtSourceLigId.Value)
                                && d.EntId != (exclure ?? 0)
                                && (d.EntAvtPresentation == "P" || t.TydAvancement == "R")
                            select new { Source = l.LigAvtSourceLigId!.Value, d.EntId, l.LigAvtMontantCumul, l.LigAvtQteCumul, l.LigAvtPct })
            .ToListAsync(ct);
        return lignes.GroupBy(x => x.Source).ToDictionary(g => g.Key, g =>
        {
            var x = g.OrderByDescending(y => y.EntId).First();
            return new Precedent(x.LigAvtMontantCumul ?? 0, x.LigAvtQteCumul ?? 0, x.LigAvtPct ?? 0);
        });
    }

    /// <summary>Saisie d'avancement d'une ligne : mode (P, Q, M, A) et valeur cumulée.</summary>
    public sealed record SaisieAvancement(string Mode, decimal? Valeur);

    /// <summary>
    /// Saisies de la dernière situation validée de référence, non annulée, par ligne du marché (lig_avt_source_lig_id) :
    /// point de départ d'une nouvelle situation (aide à la saisie). <paramref name="avancement"/> : situations de travaux
    /// (S) ou de production (D), chacune partant de la dernière de son type.
    /// </summary>
    protected internal async Task<Dictionary<long, SaisieAvancement>> DernieresSituations(IReadOnlyCollection<long> sources, CancellationToken ct,
        string avancement = TypesAvancement.Situation)
    {
        if (sources.Count == 0) return [];
        var lignes = await (from l in db.Lignes.AsNoTracking()
                            join d in db.Documents.AsNoTracking().Valables(db) on l.LigEntId equals d.EntId
                            join t in db.TypesDocument.AsNoTracking() on d.EntTydId equals t.TydId
                            where l.LigAvtSourceLigId != null && sources.Contains(l.LigAvtSourceLigId.Value) && l.LigAvtMode != null
                                && t.TydAvancement == avancement
                            select new { Source = l.LigAvtSourceLigId!.Value, d.EntId, l.LigAvtMode, l.LigAvtValeur })
            .ToListAsync(ct);
        return lignes.GroupBy(x => x.Source).ToDictionary(g => g.Key, g =>
        {
            var x = g.OrderByDescending(y => y.EntId).First();
            return new SaisieAvancement(x.LigAvtMode!, x.LigAvtValeur);
        });
    }

    /// <summary>Précédents écrits sur les lignes d'avancement (0 sans document précédent).</summary>
    protected internal async Task AppliquerPrecedents(IEnumerable<TLigne> lignes, long? exclure, CancellationToken ct)
    {
        var avt = lignes.Where(l => l.LigAvtSourceLigId is not null).ToList();
        var p = await Precedents(avt.Select(l => l.LigAvtSourceLigId!.Value).Distinct().ToList(), exclure, ct);
        foreach (var l in avt) EcrirePrecedent(l, p.GetValueOrDefault(l.LigAvtSourceLigId!.Value));
    }

    /// <summary>
    /// Précédents à relire avant l'enregistrement ou la validation : document d'avancement, sauf l'avoir d'annulation, qui
    /// garde ceux de la pièce annulée (relus, ils prendraient la pièce annulée elle-même et l'avoir tomberait à zéro).
    /// </summary>
    public static bool RelirePrecedents(TDoc d) => d.EntAvtPresentation is not null && d.EntNatureAvoir != NaturesAvoir.Annulation;

    public static void EcrirePrecedent(TLigne l, Precedent? p)
    {
        l.LigAvtMontantPrecedent = p?.Montant ?? 0;
        l.LigAvtQtePrecedent = p?.Qte ?? 0;
        l.LigAvtPctPrecedent = p?.Pct ?? 0;
    }

    /// <summary>Seuils de solde automatique d'une famille (achats et sous-traitance, sinon ventes) : (% de la quantité du parent, quantité).</summary>
    public async Task<(decimal Pct, decimal Qte)> SeuilsSolde(string famille, CancellationToken ct)
    {
        var s = await LireSeuilsSolde(ct);
        var f = FamillesDocument.EstAchat(famille) ? s.Achat : s.Vente;
        return (f.Pct, f.Qte);
    }

    /// <summary>Seuils de solde (parametre_document « seuils_solde ») ; 0 par défaut.</summary>
    public async Task<SeuilsSolde> LireSeuilsSolde(CancellationToken ct)
    {
        var p = await db.ParametresDocument.AsNoTracking().FirstOrDefaultAsync(x => x.PdoCle == "seuils_solde", ct);
        return p?.PdoValeur.Deserialize<SeuilsSolde>(JsonCalcul.Options) ?? new SeuilsSolde();
    }

    /// <summary>Seuils de solde (administrateur) : valeurs positives, % au plus 100.</summary>
    public async Task<SeuilsSolde> EnregistrerSeuilsSolde(SeuilsSolde s, Utilisateur u, CancellationToken ct)
    {
        u.ExigerParametres();
        foreach (var f in new[] { s.Achat, s.Vente })
        {
            if (f.Pct < 0 || f.Qte < 0) throw ExceptionMetier.Invalide("SEUIL", "Un seuil de solde est positif ou nul");
            if (f.Pct > 100) throw ExceptionMetier.Invalide("SEUIL", "Un seuil en % ne dépasse pas 100");
        }
        var valeur = JsonSerializer.SerializeToDocument(s, JsonCalcul.Options);
        var p = await db.ParametresDocument.FirstOrDefaultAsync(x => x.PdoCle == "seuils_solde", ct);
        if (p is null) db.ParametresDocument.Add(new ParametreDocument { PdoCle = "seuils_solde", PdoValeur = valeur });
        else p.PdoValeur = valeur;
        await db.SaveChangesAsync(ct);
        return s;
    }

    /// <summary>
    /// Validation d'un document issu d'une transformation : chaque ligne liée à sa ligne parente (lig_origine_id) dont
    /// la case Soldé est cochée, ou dont le reste passe sous le seuil, solde la ligne parente pour l'étape
    /// (document_ligne_solde rattaché à la ligne : retiré avec elle). Renvoie vrai si une ligne a été marquée soldée.
    /// </summary>
    private async Task<bool> EcrireSoldes(long id, TypeDocument type, Utilisateur u, CancellationToken ct)
    {
        // Document d'avancement : état cumulé ou période d'un marché, il ne solde pas les lignes de la commande.
        if (type.TydAvancement is not null) return false;
        var lignes = await db.Lignes.Where(l => l.LigEntId == id && l.LigOrigineId != null).ToListAsync(ct);
        if (lignes.Count == 0) return false;
        var ids = lignes.Select(l => l.LigId).ToList();
        var facultatives = TransformationService<TDoc, TLigne, TComplet>.EtapesFacultatives;
        var directs = (await db.LignesLien.AsNoTracking().Where(x => ids.Contains(x.LilCibleLigId)).ToListAsync(ct))
            .Where(x => !facultatives.Contains(x.LilEtape) && lignes.Any(l => l.LigId == x.LilCibleLigId && l.LigOrigineId == x.LilSourceLigId))
            .ToList();
        if (directs.Count == 0) return false;
        var parentsIds = directs.Select(x => x.LilSourceLigId).Distinct().ToList();
        var parents = await db.Lignes.AsNoTracking().Where(l => parentsIds.Contains(l.LigId)).ToDictionaryAsync(l => l.LigId, ct);
        var liens = await db.LignesLien.AsNoTracking().Where(x => parentsIds.Contains(x.LilSourceLigId)).ToListAsync(ct);
        var soldes = await db.LignesSolde.AsNoTracking().Where(x => parentsIds.Contains(x.LsoLigId)).ToListAsync(ct);
        var (pct, qte) = await SeuilsSolde(type.TydFamille, ct);
        var marquee = false;
        foreach (var l in lignes)
        {
            // Étape principale : la première écrite à la transformation (une facture qui vaut réception en a deux).
            var lien = directs.Where(x => x.LilCibleLigId == l.LigId).OrderBy(x => x.LilId).FirstOrDefault();
            if (lien is null || !parents.TryGetValue(lien.LilSourceLigId, out var parent)) continue;
            var transforme = liens.Where(x => x.LilSourceLigId == parent.LigId && x.LilEtape == lien.LilEtape).Sum(x => x.LilQte);
            var solde = soldes.Where(x => x.LsoLigId == parent.LigId && x.LsoEtape == lien.LilEtape).Sum(x => x.LsoQte);
            var etat = Soldes.Etat(parent.LigQteVendue ?? 0, transforme, solde, pct, qte, l.LigSolde);
            if (!etat.Soldee) continue;
            if (etat.ASolder != 0)
            {
                db.LignesSolde.Add(new DocumentLigneSolde
                {
                    LsoLigId = parent.LigId, LsoEtape = lien.LilEtape, LsoQte = etat.ASolder, LsoDate = DateTimeOffset.UtcNow,
                    LsoUtilisateur = u.Code, LsoMotif = l.LigSolde ? "Soldé à la main" : "Soldé sous le seuil", LsoCibleLigId = l.LigId,
                });
            }
            if (!l.LigSolde)
            {
                l.LigSolde = true;
                marquee = true;
            }
        }
        await db.SaveChangesAsync(ct);
        return marquee;
    }

    /// <summary>Échéancier d'une pièce validée modifié à la main (droit MODIFIER du type).</summary>
    public async Task<List<DocumentEcheance>> ModifierEcheances(long id, List<EcheanceSaisie> saisie, Utilisateur u, CancellationToken ct)
    {
        var doc = await db.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.EntId == id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        await VerifierDroit(u, doc.EntTydId, ActionsDroits.Modifier, ct);
        return await Echeancier.Modifier(id, saisie, ct);
    }

    /// <summary>Échéancier d'une pièce validée recalculé depuis sa condition (droit MODIFIER du type).</summary>
    public async Task<List<DocumentEcheance>> RecalculerEcheances(long id, Utilisateur u, CancellationToken ct)
    {
        var doc = await db.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.EntId == id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        await VerifierDroit(u, doc.EntTydId, ActionsDroits.Modifier, ct);
        return await Echeancier.Recalculer(id, ct);
    }

    public async Task Supprimer(long id, Utilisateur u, CancellationToken ct)
    {
        var doc = await db.Documents.FirstOrDefaultAsync(d => d.EntId == id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        await VerifierDroit(u, doc.EntTydId, ActionsDroits.Supprimer, ct);
        await VerifierModifiable(doc, ct);
        // Un document déjà transformé (source) ne se supprime pas ; un brouillon issu d'une transformation (cible) se
        // supprime avec ses liens (ses quantités ne comptent plus dans le reste de ses sources). Copie : simple trace.
        if (await db.DocumentsLien.AnyAsync(l => l.LieSourceEntId == id && l.LieType != "COPIE", ct))
        {
            throw ExceptionMetier.Conflit("DOCUMENT_LIE", "Le document a été transformé en d'autres documents");
        }
        // Liens de copie retirés avant le document (pas de navigation EF entre eux : ordre explicite).
        await using var tx = await db.Unite().CommencerAsync(ct);
        db.DocumentsLien.RemoveRange(await db.DocumentsLien.Where(l => l.LieSourceEntId == id || l.LieCibleEntId == id).ToListAsync(ct));
        await db.SaveChangesAsync(ct);
        db.Documents.Remove(doc);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    // ------------------------------------------------------------------ indices, référence, copie

    /// <summary>Nouvel indice (A, B, C…) : même groupe et même numéro, contenu recopié, ses propres versions.</summary>
    public async Task<TComplet> CreerIndice(long id, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Unite().CommencerAsync(ct);
        var source = await persistance.Charger(id, ct);
        await VerifierDroit(u, source.Document.EntTydId, ActionsDroits.Creer, ct);
        var typeSource = await Type(source.Document.EntTydId, ct);
        // Situation de travaux ou de production (non comptables, Q29) : une situation validée se révise par un nouvel indice,
        // qui devient la référence, tant qu'aucune facture non annulée n'en est issue.
        var revision = source.Document.EntVerrouille && TypesAvancement.EstSituation(typeSource.TydAvancement);
        if (!revision && !await Regles.Booleen("INDICE", typeSource, ct))
        {
            throw ExceptionMetier.Invalide("INDICE_INTERDIT", "Pas d'indice pour ce type de document (règle Indices)");
        }
        if (source.Document.EntVerrouille && !revision)
        {
            throw ExceptionMetier.Conflit("DOCUMENT_VALIDE", "Document validé et bloqué : créez une copie plutôt qu'un indice");
        }
        if (revision && await (from l in db.DocumentsLien
                               join d in db.Documents on l.LieCibleEntId equals d.EntId
                               join s in db.StatutsDocument on d.EntStdId equals s.StdId
                               where l.LieSourceEntId == id && l.LieType == "TRANSFORMATION" && s.StdCode != "ANNULE"
                               select l).AnyAsync(ct))
        {
            throw ExceptionMetier.Conflit("SITUATION_FACTUREE", "Situation déjà facturée : la correction passe par la situation suivante");
        }
        var indices = await db.Documents.Where(d => d.EntGroupeId == source.Document.EntGroupeId).Select(d => d.EntIndice).ToListAsync(ct);
        var suivant = Numerotation.FormaterRang(indices.Select(i => Numerotation.LireDepart(i) ?? 0).Max() + 1, "A");
        // Révision : l'ancienne référence cède sa place avant l'insertion (une seule référence par groupe).
        if (revision)
        {
            await db.Documents.Where(d => d.EntGroupeId == source.Document.EntGroupeId)
                .ExecuteUpdateAsync(s => s.SetProperty(d => d.EntIsReference, false), ct);
        }
        var copie = await Dupliquer(source, d =>
        {
            d.EntIndice = suivant;
            d.EntIsReference = revision;
            d.EntGroupeId = source.Document.EntGroupeId;
            d.EntNumero = source.Document.EntNumero;
            d.EntRangAvancement = source.Document.EntRangAvancement;
        }, u, ct);
        await tx.CommitAsync(ct);
        return revision ? await persistance.Charger(copie.Document.Document.EntId, ct) : copie.Document;
    }

    /// <summary>Désigne l'indice de référence du groupe (transformations, statistiques).</summary>
    public async Task<TComplet> DesignerReference(long id, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Unite().CommencerAsync(ct);
        var doc = await db.Documents.FirstOrDefaultAsync(d => d.EntId == id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        await VerifierDroit(u, doc.EntTydId, ActionsDroits.Modifier, ct);
        await db.Documents.Where(d => d.EntGroupeId == doc.EntGroupeId && d.EntId != id)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.EntIsReference, false), ct);
        await db.Documents.Where(d => d.EntId == id).ExecuteUpdateAsync(s => s.SetProperty(d => d.EntIsReference, true), ct);
        await tx.CommitAsync(ct);
        return await persistance.Charger(id, ct);
    }

    /// <summary>Copie : nouveau document, nouveau numéro, lien COPIE vers l'origine.</summary>
    public async Task<TComplet> Copier(long id, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Unite().CommencerAsync(ct);
        var source = await persistance.Charger(id, ct);
        var type = await Type(source.Document.EntTydId, ct);
        await VerifierDroit(u, type.TydId, ActionsDroits.Creer, ct);
        var numero = type.TydNumerotationContinue ? null : await AttribuerNumero(type, DateOnly.FromDateTime(DateTime.Today), ct);
        var copie = await Dupliquer(source, d =>
        {
            d.EntIndice = "A";
            d.EntIsReference = true;
            d.EntGroupeId = null;
            d.EntNumero = numero;
            d.EntCopieDeId = id;
            d.EntDate = DateOnly.FromDateTime(DateTime.Today);
            // Copie d'une pièce transférée en comptabilité : la copie, brouillon, n'est pas transférée.
            d.EntEtatCompta = null;
        }, u, ct);
        db.DocumentsLien.Add(new DocumentLien { LieSourceEntId = id, LieCibleEntId = copie.Document.Document.EntId, LieType = "COPIE" });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return copie.Document;
    }

    /// <summary>Résultat d'une duplication : document créé et correspondance ID temporaire → ID définitif.</summary>
    public sealed record Duplication(TComplet Document, Dictionary<long, long> CorrespondanceLignes);

    /// <summary>Crée un document à partir d'un contenu existant, avec de nouveaux ID (temporaires puis définitifs).</summary>
    protected internal async Task<Duplication> Dupliquer(TComplet source, Action<TDoc> preparer, Utilisateur u, CancellationToken ct,
        Func<TComplet, TComplet>? transformerContenu = null)
    {
        var contenu = RenumeroterTemporaire(JsonCalcul.Cloner(source));
        if (transformerContenu is not null) contenu = transformerContenu(contenu);
        var doc = JsonCalcul.Cloner(source.Document);
        doc.EntId = 0;
        doc.EntVersion = 1;
        doc.EntVerrouille = false;
        doc.EntCopieDeId = null;
        doc.EntIntermediaire = false;
        doc.EntDateValidite = null;
        doc.EntCreeLe = DateTimeOffset.UtcNow;
        doc.EntCreePar = u.Code;
        doc.EntModifieLe = null;
        doc.EntModifiePar = null;
        preparer(doc);
        // Brouillon du type de la copie, connu après la préparation (une transformation ou un avoir change de type).
        doc.EntStdId = (await Statut(doc.EntTydId, StatutsDocument.Brouillon, ct)).StdId;
        doc.EntProprietes ??= JsonDocument.Parse("{}");
        doc.EntEtiquettes ??= JsonDocument.Parse("[]");
        db.Documents.Add(doc);
        await db.SaveChangesAsync(ct);
        if (doc.EntGroupeId is null)
        {
            doc.EntGroupeId = doc.EntId;
            await db.SaveChangesAsync(ct);
        }
        contenu.Document = doc;
        var type = await Type(doc.EntTydId, ct);
        var r = handlers.Pour(type).Calculer(await Entree(contenu, ct));
        var reponse = await Persister(doc.EntId, r, u, ct);
        await Historiser(reponse.Document!, "CREATION", u, ct);
        return new Duplication(reponse.Document!, reponse.CorrespondanceLignes);
    }

    /// <summary>Remplace tous les ID par des ID temporaires négatifs ; lig_origine_id garde la ligne source.</summary>
    protected TComplet RenumeroterTemporaire(TComplet d)
    {
        long n = 0;
        return RenumeroterTemporaire(d, ref n);
    }

    /// <summary>Renumérotation temporaire à partir de n (contenus de plusieurs sources réunis dans un document).</summary>
    protected internal TComplet RenumeroterTemporaire(TComplet d, ref long n)
    {
        var lig = new Dictionary<long, long>();
        foreach (var l in d.Lignes) lig[l.LigId] = --n;
        long? Map(long? id) => id is long v && lig.TryGetValue(v, out var r) ? r : null;
        foreach (var l in d.Lignes)
        {
            l.LigOrigineId = l.LigId;
            l.LigId = lig[l.LigId];
            l.LigParentId = Map(l.LigParentId);
            l.LigStDepuisId = Map(l.LigStDepuisId);
            l.LigVarianteDeId = Map(l.LigVarianteDeId);
            l.LigPiedBaseId = Map(l.LigPiedBaseId);
        }
        specialisation.RenumeroterComplements(d, lig, ref n);
        return d;
    }

    // ------------------------------------------------------------------ cas de test

    /// <summary>Capture d'un écart arbitré dans calcul_cas_test, rejoué ensuite par les deux suites de tests.</summary>
    public async Task<long> EnregistrerCasTest(ArbitrageEcarts a, Utilisateur u, CancellationToken ct)
    {
        if (a.CasDecision is not ("S" or "A")) throw ExceptionMetier.Invalide("DECISION", "Décision S (serveur validé) ou A (anomalie)");
        var cas = new CalculCasTest
        {
            CasEntId = a.EntId,
            CasDate = DateTimeOffset.UtcNow,
            CasUtilisateur = u.Code,
            CasVersionClient = a.VersionClient,
            CasVersionServeur = specialisation.VersionMoteur,
            CasDocumentEntree = JsonDocument.Parse(a.DocumentEntree.GetRawText()),
            CasResultatClient = JsonDocument.Parse(a.ResultatClient.GetRawText()),
            CasResultatServeur = JsonDocument.Parse(a.ResultatServeur.GetRawText()),
            CasEcarts = JsonSerializer.SerializeToDocument(a.Ecarts, JsonCalcul.Options),
            CasDecision = a.CasDecision,
            CasResultatAttendu = a.ResultatAttendu is JsonElement att ? JsonDocument.Parse(att.GetRawText()) : null,
            CasCommentaire = a.CasCommentaire,
        };
        db.CasTest.Add(cas);
        await db.SaveChangesAsync(ct);
        return cas.CasId;
    }

    /// <summary>Export d'un cas au format des jeux de test partagés (tests/cas/*.json).</summary>
    public async Task<object> ExporterCasTest(long casId, CancellationToken ct)
    {
        var cas = await db.CasTest.AsNoTracking().FirstOrDefaultAsync(c => c.CasId == casId, ct) ?? throw ExceptionMetier.Introuvable($"Cas {casId}");
        return new
        {
            nom = $"Cas {cas.CasId} – arbitrage {(cas.CasDecision == "S" ? "serveur validé" : "anomalie")}",
            description = cas.CasCommentaire ?? "",
            entree = cas.CasDocumentEntree.RootElement,
            attendu = cas.CasResultatAttendu?.RootElement ?? cas.CasResultatServeur.RootElement,
        };
    }
}
