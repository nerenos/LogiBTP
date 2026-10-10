using System.Text.Json;
using LogiBTP.Api.Donnees;
using LogiBTP.Api.Infrastructure;
using LogiBTP.Calcul;
using LogiBTP.Domaine;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Documents;

public sealed class DocumentService(LogiBtpContext db, PersistanceDocument persistance, RegistreHandlers handlers, NettoyageHtml html)
{
    // ------------------------------------------------------------------ paramétrage

    public async Task<DefinitionType> Definition(string code, Utilisateur u, CancellationToken ct)
    {
        var type = await db.TypesDocument.AsNoTracking().FirstOrDefaultAsync(t => t.TydCode == code, ct)
            ?? throw ExceptionMetier.Introuvable($"Type de document {code}");
        return new DefinitionType
        {
            Type = type,
            Proprietes = await db.ProprietesDefinition.AsNoTracking().Where(p => p.PrdTydId == type.TydId).OrderBy(p => p.PrdOrdre).ToListAsync(ct),
            Statuts = await db.StatutsDocument.AsNoTracking().Where(s => s.StdTydId == type.TydId).OrderBy(s => s.StdOrdre).ToListAsync(ct),
            TypesLigne = await db.TypesLigne.AsNoTracking().OrderBy(t => t.TylId).ToListAsync(ct),
            TauxTva = await db.TauxTva.AsNoTracking().Where(t => t.TtvActif).OrderBy(t => t.TtvCode).ToListAsync(ct),
            Unites = await db.Unites.AsNoTracking().Where(x => x.UntActif).OrderBy(x => x.UntOrdre).ThenBy(x => x.UntCode).ToListAsync(ct),
            Transformations = await db.TransformationsAutorisees.AsNoTracking().Where(t => t.TraSourceTydId == type.TydId).ToListAsync(ct),
            Droits = await db.DroitsDocument.AsNoTracking().Where(d => d.DrtProfil == u.Profil && d.DrtTydId == type.TydId).Select(d => d.DrtAction).ToListAsync(ct),
        };
    }

    private async Task VerifierDroit(Utilisateur u, int tydId, string action, CancellationToken ct)
    {
        if (!await db.DroitsDocument.AnyAsync(d => d.DrtProfil == u.Profil && d.DrtTydId == tydId && d.DrtAction == action, ct))
        {
            throw ExceptionMetier.AccesRefuse(action);
        }
    }

    private async Task<TypeDocument> Type(int tydId, CancellationToken ct) =>
        await db.TypesDocument.AsNoTracking().FirstOrDefaultAsync(t => t.TydId == tydId, ct)
        ?? throw ExceptionMetier.Introuvable($"Type de document {tydId}");

    private async Task<StatutDocument> Statut(int tydId, string code, CancellationToken ct) =>
        await db.StatutsDocument.AsNoTracking().FirstOrDefaultAsync(s => s.StdTydId == tydId && s.StdCode == code, ct)
        ?? throw ExceptionMetier.Introuvable($"Statut {code}");

    /// <summary>Numéro légal sans trou : incrément du compteur dans la transaction (pas de SEQUENCE).</summary>
    private async Task<string> AttribuerNumero(TypeDocument type, DateOnly date, CancellationToken ct)
    {
        var n = await db.Database.SqlQuery<int>($"""
            INSERT INTO compteur_numero (cnu_tyd_id, cnu_exercice, cnu_dernier_numero)
            VALUES ({type.TydId}, {date.Year}, 1)
            ON CONFLICT (cnu_tyd_id, cnu_exercice)
            DO UPDATE SET cnu_dernier_numero = compteur_numero.cnu_dernier_numero + 1
            RETURNING cnu_dernier_numero AS "Value"
            """).ToListAsync(ct);
        return $"{type.TydPrefixeNumero}{date.Year}-{n[0]:00000}";
    }

    private async Task Historiser(DocumentComplet avant, string action, Utilisateur u, CancellationToken ct)
    {
        db.Historiques.Add(new DocumentHistorique
        {
            HisEntId = avant.Document.EntId,
            HisVersion = avant.Document.EntVersion,
            HisAction = action,
            HisDate = DateTimeOffset.UtcNow,
            HisUtilisateur = u.Code,
            HisInstantane = PersistanceDocument.Instantane(avant),
        });
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ calcul

    public async Task<EntreeCalcul> Entree(DocumentComplet d, CancellationToken ct)
    {
        var modifiable = await db.StatutsDocument.Where(s => s.StdId == d.Document.EntStdId).Select(s => s.StdModifiable).FirstOrDefaultAsync(ct);
        return new EntreeCalcul
        {
            Document = d.Document,
            Lignes = d.Lignes,
            Metres = d.Metres,
            MetreLignes = d.MetreLignes,
            Variables = d.Variables,
            TauxTva = await db.TauxTva.AsNoTracking().ToListAsync(ct),
            // Le libellé affiché est figé à la validation du document.
            Options = new OptionsCalcul { LibellesFiges = d.Document.EntStdId != 0 && !modifiable },
        };
    }

    /// <summary>Calcul serveur sans enregistrement, avec comparaison si le client transmet ses résultats.</summary>
    public async Task<ReponseEnregistrement> Recalculer(EnregistrementDocument d, CancellationToken ct)
    {
        var type = await Type(d.Document.EntTydId, ct);
        var entree = await Entree(d, ct);
        var r = handlers.Pour(type).Calculer(entree);
        return new ReponseEnregistrement
        {
            Document = VersComplet(r),
            Ecarts = ComparateurCalcul.Comparer(d.Document, d.Lignes, r.Document, r.Lignes),
            Erreurs = r.Erreurs,
            Avertissements = r.Avertissements,
        };
    }

    private static DocumentComplet VersComplet(ResultatCalcul r) => new()
    {
        Document = r.Document, Lignes = r.Lignes, Metres = r.Metres, MetreLignes = r.MetreLignes, Variables = r.Variables, Tva = r.Tva,
    };

    // ------------------------------------------------------------------ lecture, création

    public Task<DocumentComplet> Charger(long id, CancellationToken ct) => persistance.Charger(id, ct);

    public async Task<List<Document>> Lister(string? type, CancellationToken ct)
    {
        var q = db.Documents.AsNoTracking();
        if (type is not null)
        {
            var tyd = await db.TypesDocument.Where(t => t.TydCode == type).Select(t => t.TydId).FirstOrDefaultAsync(ct);
            q = q.Where(d => d.EntTydId == tyd);
        }
        return await q.OrderByDescending(d => d.EntId).Take(200).ToListAsync(ct);
    }

    public async Task<DocumentComplet> Creer(CreationDocument c, Utilisateur u, CancellationToken ct)
    {
        var type = await Type(c.EntTydId, ct);
        await VerifierDroit(u, type.TydId, "CREER", ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var doc = new Document
        {
            EntTydId = type.TydId,
            EntDate = c.EntDate ?? DateOnly.FromDateTime(DateTime.Today),
            EntObjet = c.EntObjet,
            EntStdId = (await Statut(type.TydId, "BROUILLON", ct)).StdId,
            EntTiersId = c.EntTiersId,
            EntAdresseFacturation = c.EntAdresseFacturation,
            EntAdresseLivraison = c.EntAdresseLivraison,
            EntModeCalculOuvrage = c.EntModeCalculOuvrage ?? "V",
            EntNumFormat = c.EntNumFormat ?? JsonDocument.Parse("""{"separateur":".","niveaux":[{"style":"1"}]}"""),
            EntVersionCalcul = MoteurCalcul.Version,
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

    // ------------------------------------------------------------------ enregistrement

    /// <summary>
    /// Enregistrement en un seul appel : contrôles, recalcul définitif, détection des écarts,
    /// historisation de l'état précédent et persistance. Verrouillage optimiste sur ent_version (409).
    /// </summary>
    public async Task<ReponseEnregistrement> Enregistrer(long id, EnregistrementDocument d, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var avant = await persistance.Charger(id, ct);
        var type = await Type(avant.Document.EntTydId, ct);
        await VerifierDroit(u, type.TydId, "MODIFIER", ct);
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
        e.EntTiersId = d.Document.EntTiersId;
        e.EntAdresseFacturation = d.Document.EntAdresseFacturation;
        e.EntAdresseLivraison = d.Document.EntAdresseLivraison;
        e.EntModeCalculOuvrage = d.Document.EntModeCalculOuvrage;
        e.EntNumFormat = d.Document.EntNumFormat ?? e.EntNumFormat;
        e.EntPrecisionMontant = d.Document.EntPrecisionMontant;
        e.EntProprietes = d.Document.EntProprietes ?? e.EntProprietes;
        foreach (var l in d.Lignes)
        {
            l.LigEntId = id;
            l.LigLibelleHtml = html.Nettoyer(l.LigLibelleHtml);
        }

        var saisie = new DocumentComplet
        {
            Document = e, Lignes = d.Lignes, Metres = d.Metres, MetreLignes = d.MetreLignes, Variables = d.Variables,
        };
        var entree = await Entree(saisie, ct);
        var handler = handlers.Pour(type);
        var controles = new List<MessageCalcul>();
        handler.Controler(new ContexteDocument { Type = type, Proprietes = await Proprietes(type.TydId, ct), Entree = entree }, controles);
        if (controles.Count > 0) throw ExceptionMetier.Invalide("CONTROLES", "Le document ne respecte pas le paramétrage", controles);

        var r = handler.Calculer(entree);
        var ecarts = ComparateurCalcul.Comparer(d.Document, d.Lignes, r.Document, r.Lignes);

        await Historiser(avant, "MODIFICATION", u, ct);
        var reponse = await Persister(id, r, u, ct);
        reponse.Ecarts = ecarts.Select(x => x with { LigId = x.LigId is long l ? reponse.CorrespondanceLignes.GetValueOrDefault(l, l) : null }).ToList();
        await tx.CommitAsync(ct);
        return reponse;
    }

    private async Task<List<ProprieteDefinition>> Proprietes(int tydId, CancellationToken ct) =>
        await db.ProprietesDefinition.AsNoTracking().Where(p => p.PrdTydId == tydId).ToListAsync(ct);

    private async Task VerifierModifiable(Document d, CancellationToken ct)
    {
        var modifiable = await db.StatutsDocument.Where(s => s.StdId == d.EntStdId).Select(s => s.StdModifiable).FirstAsync(ct);
        // Un statut non modifiable bloque la modification quel que soit le profil.
        if (!modifiable || d.EntVerrouille) throw ExceptionMetier.Conflit("DOCUMENT_BLOQUE", "Le statut du document ne permet pas la modification");
    }

    /// <summary>Écrit l'entête et le contenu calculés, incrémente la version d'enregistrement.</summary>
    private async Task<ReponseEnregistrement> Persister(long id, ResultatCalcul r, Utilisateur u, CancellationToken ct)
    {
        var entite = await db.Documents.FirstAsync(x => x.EntId == id, ct);
        var versionAvant = entite.EntVersion;
        db.Entry(entite).CurrentValues.SetValues(r.Document);
        entite.EntId = id;
        entite.EntVersion = versionAvant + 1;
        entite.EntModifieLe = DateTimeOffset.UtcNow;
        entite.EntModifiePar = u.Code;
        entite.EntProprietes ??= JsonDocument.Parse("{}");
        db.Entry(entite).Property(x => x.EntVersion).OriginalValue = versionAvant;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw ExceptionMetier.Conflit("VERSION", "Le document a été modifié par un autre utilisateur");
        }

        var corr = await persistance.Ecrire(id, r, ct);
        static Dictionary<long, long> Nouveaux(Dictionary<long, long> d) => d.Where(kv => kv.Key != kv.Value).ToDictionary();
        return new ReponseEnregistrement
        {
            Document = await persistance.Charger(id, ct),
            CorrespondanceLignes = Nouveaux(corr.Lignes),
            CorrespondanceMetres = Nouveaux(corr.Metres),
            CorrespondanceMetreLignes = Nouveaux(corr.MetreLignes),
            CorrespondanceVariables = Nouveaux(corr.Variables),
            Erreurs = r.Erreurs,
            Avertissements = r.Avertissements,
        };
    }

    // ------------------------------------------------------------------ validation, suppression

    public async Task<ReponseEnregistrement> Valider(long id, DemandeVersion v, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var avant = await persistance.Charger(id, ct);
        var type = await Type(avant.Document.EntTydId, ct);
        await VerifierDroit(u, type.TydId, "VALIDER", ct);
        await VerifierModifiable(avant.Document, ct);
        if (v.EntVersion != avant.Document.EntVersion) throw ExceptionMetier.Conflit("VERSION", "Le document a été modifié par un autre utilisateur");

        var entree = await Entree(JsonCalcul.Cloner(avant), ct);
        var handler = handlers.Pour(type);
        var controles = new List<MessageCalcul>();
        var ctx = new ContexteDocument { Type = type, Proprietes = await Proprietes(type.TydId, ct), Entree = entree };
        handler.Controler(ctx, controles);
        handler.AvantValidation(ctx, controles);
        var r = handler.Calculer(entree);
        controles.AddRange(r.Erreurs);
        if (controles.Count > 0) throw ExceptionMetier.Invalide("VALIDATION", "Le document comporte des erreurs", controles);

        await Historiser(avant, "VALIDATION", u, ct);
        if (type.TydNumerotationContinue && r.Document.EntNumero is null)
        {
            r.Document.EntNumero = await AttribuerNumero(type, r.Document.EntDate, ct);
        }
        r.Document.EntStdId = (await Statut(type.TydId, "VALIDE", ct)).StdId;
        r.Document.EntVerrouille = true;
        var reponse = await Persister(id, r, u, ct);
        await tx.CommitAsync(ct);
        return reponse;
    }

    public async Task Supprimer(long id, Utilisateur u, CancellationToken ct)
    {
        var doc = await db.Documents.FirstOrDefaultAsync(d => d.EntId == id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        await VerifierDroit(u, doc.EntTydId, "SUPPRIMER", ct);
        await VerifierModifiable(doc, ct);
        if (await db.DocumentsLien.AnyAsync(l => l.LieSourceEntId == id || l.LieCibleEntId == id, ct))
        {
            throw ExceptionMetier.Conflit("DOCUMENT_LIE", "Le document est lié à d'autres documents");
        }
        db.Documents.Remove(doc);
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ indices, référence, copie

    /// <summary>Nouvel indice (A, B, C…) : même groupe et même numéro, contenu recopié, ses propres versions.</summary>
    public async Task<DocumentComplet> CreerIndice(long id, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var source = await persistance.Charger(id, ct);
        await VerifierDroit(u, source.Document.EntTydId, "CREER", ct);
        if (source.Document.EntVerrouille)
        {
            throw ExceptionMetier.Conflit("DOCUMENT_VALIDE", "Document validé et bloqué : créez une copie plutôt qu'un indice");
        }
        var indices = await db.Documents.Where(d => d.EntGroupeId == source.Document.EntGroupeId).Select(d => d.EntIndice).ToListAsync(ct);
        var suivant = Numerotation.FormaterRang(indices.Select(i => Numerotation.LireDepart(i) ?? 0).Max() + 1, "A");
        var copie = await Dupliquer(source, d =>
        {
            d.EntIndice = suivant;
            d.EntIsReference = false;
            d.EntGroupeId = source.Document.EntGroupeId;
            d.EntNumero = source.Document.EntNumero;
        }, u, ct);
        await tx.CommitAsync(ct);
        return copie;
    }

    /// <summary>Désigne l'indice de référence du groupe (transformations, statistiques).</summary>
    public async Task<DocumentComplet> DesignerReference(long id, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var doc = await db.Documents.FirstOrDefaultAsync(d => d.EntId == id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        await VerifierDroit(u, doc.EntTydId, "MODIFIER", ct);
        await db.Documents.Where(d => d.EntGroupeId == doc.EntGroupeId && d.EntId != id)
            .ExecuteUpdateAsync(s => s.SetProperty(d => d.EntIsReference, false), ct);
        await db.Documents.Where(d => d.EntId == id).ExecuteUpdateAsync(s => s.SetProperty(d => d.EntIsReference, true), ct);
        await tx.CommitAsync(ct);
        return await persistance.Charger(id, ct);
    }

    /// <summary>Copie : nouveau document, nouveau numéro, lien COPIE vers l'origine.</summary>
    public async Task<DocumentComplet> Copier(long id, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var source = await persistance.Charger(id, ct);
        var type = await Type(source.Document.EntTydId, ct);
        await VerifierDroit(u, type.TydId, "CREER", ct);
        var numero = type.TydNumerotationContinue ? null : await AttribuerNumero(type, DateOnly.FromDateTime(DateTime.Today), ct);
        var copie = await Dupliquer(source, d =>
        {
            d.EntIndice = "A";
            d.EntIsReference = true;
            d.EntGroupeId = null;
            d.EntNumero = numero;
            d.EntCopieDeId = id;
            d.EntDate = DateOnly.FromDateTime(DateTime.Today);
        }, u, ct);
        db.DocumentsLien.Add(new DocumentLien { LieSourceEntId = id, LieCibleEntId = copie.Document.EntId, LieType = "COPIE" });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return copie;
    }

    /// <summary>Crée un document à partir d'un contenu existant, avec de nouveaux ID (temporaires puis définitifs).</summary>
    internal async Task<DocumentComplet> Dupliquer(DocumentComplet source, Action<Document> preparer, Utilisateur u, CancellationToken ct,
        Func<DocumentComplet, DocumentComplet>? transformerContenu = null)
    {
        var contenu = RenumeroterTemporaire(JsonCalcul.Cloner(source));
        if (transformerContenu is not null) contenu = transformerContenu(contenu);
        var doc = JsonCalcul.Cloner(source.Document);
        doc.EntId = 0;
        doc.EntVersion = 1;
        doc.EntVerrouille = false;
        doc.EntCopieDeId = null;
        doc.EntStdId = (await Statut(doc.EntTydId, "BROUILLON", ct)).StdId;
        doc.EntCreeLe = DateTimeOffset.UtcNow;
        doc.EntCreePar = u.Code;
        doc.EntModifieLe = null;
        doc.EntModifiePar = null;
        preparer(doc);
        doc.EntProprietes ??= JsonDocument.Parse("{}");
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
        await Historiser(reponse.Document, "CREATION", u, ct);
        Correspondance = reponse.CorrespondanceLignes;
        return reponse.Document;
    }

    /// <summary>Correspondance des ID de la dernière duplication (ID temporaire → ID définitif).</summary>
    internal Dictionary<long, long> Correspondance { get; private set; } = [];

    /// <summary>Remplace tous les ID par des ID temporaires négatifs ; lig_origine_id garde la ligne source.</summary>
    internal static DocumentComplet RenumeroterTemporaire(DocumentComplet d)
    {
        var lig = new Dictionary<long, long>();
        var mtr = new Dictionary<long, long>();
        var mli = new Dictionary<long, long>();
        long n = 0;
        foreach (var l in d.Lignes) lig[l.LigId] = --n;
        foreach (var m in d.Metres) mtr[m.MtrId] = --n;
        foreach (var x in d.MetreLignes) mli[x.MliId] = --n;
        long? Map(Dictionary<long, long> t, long? id) => id is long v && t.TryGetValue(v, out var r) ? r : null;
        foreach (var l in d.Lignes)
        {
            l.LigOrigineId = l.LigId;
            l.LigId = lig[l.LigId];
            l.LigParentId = Map(lig, l.LigParentId);
            l.LigStDepuisId = Map(lig, l.LigStDepuisId);
            l.LigVarianteDeId = Map(lig, l.LigVarianteDeId);
            l.LigMtrId = Map(mtr, l.LigMtrId);
        }
        foreach (var m in d.Metres)
        {
            m.MtrId = mtr[m.MtrId];
            m.MtrLigId = lig[m.MtrLigId];
        }
        foreach (var x in d.MetreLignes)
        {
            x.MliId = mli[x.MliId];
            x.MliMtrId = mtr[x.MliMtrId];
            x.MliParentId = Map(mli, x.MliParentId);
            x.MliStDepuisId = Map(mli, x.MliStDepuisId);
        }
        foreach (var v in d.Variables)
        {
            v.VarLigId = Map(lig, v.VarLigId);
            v.VarMtrId = Map(mtr, v.VarMtrId);
        }
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
            CasVersionServeur = MoteurCalcul.Version,
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
