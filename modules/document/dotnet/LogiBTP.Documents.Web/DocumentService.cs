using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;

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
    NettoyageHtml html)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
    where TComplet : DocumentComplet<TDoc, TLigne>, new()
{
    protected DocumentDbContext<TDoc, TLigne> Db => db;
    protected SpecialisationDocument<TDoc, TLigne, TComplet> Specialisation => specialisation;

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
            TauxTva = await db.TauxTva.AsNoTracking().Where(t => t.TtvActif).OrderBy(t => t.TtvCode).ToListAsync(ct),
            Unites = await db.Unites.AsNoTracking().Where(x => x.UntActif).OrderBy(x => x.UntOrdre).ThenBy(x => x.UntCode).ToListAsync(ct),
            Transformations = await db.TransformationsAutorisees.AsNoTracking().Where(t => t.TraSourceTydId == type.TydId).ToListAsync(ct),
            Droits = await db.DroitsDocument.AsNoTracking().Where(d => d.DrtProfil == u.Profil && d.DrtTydId == type.TydId).Select(d => d.DrtAction).ToListAsync(ct),
            Etiquettes = (await db.Set<EtiquetteLigne>().AsNoTracking().Where(e => e.EtlActif).OrderBy(e => e.EtlOrdre).ToListAsync(ct))
                .Select(e => new EtiquetteDto(e.EtlCode, e.EtlLibelle, e.EtlCouleur, e.EtlOrdre, e.EtlActif)).ToList(),
            CouleursTypePrix = (await db.Set<CouleurTypePrix>().AsNoTracking().ToListAsync(ct)).Select(c => new CouleurTypePrixDto(c.CtpType, c.CtpLibelle, c.CtpCouleur)).ToList(),
            Modeles = (await db.Set<ModeleDocument>().AsNoTracking().Where(m => m.ModActif).OrderBy(m => m.ModOrdre).ToListAsync(ct)).Select(m => new ModeleDto(m.ModCode, m.ModLibelle)).ToList(),
        };
    }

    protected internal async Task VerifierDroit(Utilisateur u, int tydId, string action, CancellationToken ct)
    {
        if (!await db.DroitsDocument.AnyAsync(d => d.DrtProfil == u.Profil && d.DrtTydId == tydId && d.DrtAction == action, ct))
        {
            throw ExceptionMetier.AccesRefuse(action);
        }
    }

    protected internal async Task<TypeDocument> Type(int tydId, CancellationToken ct) =>
        await db.TypesDocument.AsNoTracking().FirstOrDefaultAsync(t => t.TydId == tydId, ct)
        ?? throw ExceptionMetier.Introuvable($"Type de document {tydId}");

    private async Task<StatutDocument> Statut(int tydId, string code, CancellationToken ct) =>
        await db.StatutsDocument.AsNoTracking().FirstOrDefaultAsync(s => s.StdTydId == tydId && s.StdCode == code, ct)
        ?? throw ExceptionMetier.Introuvable($"Statut {code}");

    /// <summary>Numéro légal sans trou : incrément du compteur dans la transaction (pas de SEQUENCE).</summary>
    protected internal async Task<string> AttribuerNumero(TypeDocument type, DateOnly date, CancellationToken ct)
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

    private async Task Historiser(TComplet avant, string action, Utilisateur u, CancellationToken ct)
    {
        db.Historiques.Add(new DocumentHistorique
        {
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

    // ------------------------------------------------------------------ lecture, création

    public Task<TComplet> Charger(long id, CancellationToken ct) => persistance.Charger(id, ct);

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
        await VerifierDroit(u, type.TydId, "CREER", ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var doc = new TDoc
        {
            EntTydId = type.TydId,
            EntDate = c.EntDate ?? DateOnly.FromDateTime(DateTime.Today),
            EntObjet = c.EntObjet,
            EntNotreReference = c.EntNotreReference,
            EntReferenceExterne = c.EntReferenceExterne,
            EntValiditeJours = c.EntValiditeJours ?? type.TydValiditeJours,
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

    // ------------------------------------------------------------------ enregistrement

    /// <summary>
    /// Enregistrement en un seul appel : contrôles, recalcul définitif, détection des écarts,
    /// historisation de l'état précédent et persistance. Verrouillage optimiste sur ent_version (409).
    /// </summary>
    public async Task<ReponseEnregistrement<TComplet>> Enregistrer(long id, TComplet d, Utilisateur u, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var reponse = await EnregistrerDans(id, d, u, ct);
        await tx.CommitAsync(ct);
        return reponse;
    }

    /// <summary>Enregistrement dans la transaction de l'appelant (ajout de documents sources…).</summary>
    protected internal async Task<ReponseEnregistrement<TComplet>> EnregistrerDans(long id, TComplet d, Utilisateur u, CancellationToken ct)
    {
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
        e.EntNotreReference = d.Document.EntNotreReference;
        e.EntReferenceExterne = d.Document.EntReferenceExterne;
        e.EntValiditeJours = d.Document.EntValiditeJours;
        e.EntTiersId = d.Document.EntTiersId;
        e.EntAdresseFacturation = d.Document.EntAdresseFacturation;
        e.EntAdresseLivraison = d.Document.EntAdresseLivraison;
        e.EntNumFormat = d.Document.EntNumFormat ?? e.EntNumFormat;
        e.EntPrecisionMontant = d.Document.EntPrecisionMontant;
        e.EntProprietes = d.Document.EntProprietes ?? e.EntProprietes;
        e.EntModele = d.Document.EntModele;
        e.EntEtiquettes = d.Document.EntEtiquettes ?? e.EntEtiquettes;
        specialisation.CopierEnteteSaisie(e, d.Document);
        foreach (var l in d.Lignes)
        {
            l.LigEntId = id;
            l.LigLibelleHtml = html.Nettoyer(l.LigLibelleHtml);
        }

        var saisie = JsonCalcul.Cloner(d);
        saisie.Document = e;
        // Avancement : précédents relus (un autre document d'avancement a pu être validé entre-temps).
        if (e.EntAvtPresentation is not null) await AppliquerPrecedents(saisie.Lignes, id, ct);
        var entree = await Entree(saisie, ct);
        var handler = handlers.Pour(type);
        var controles = new List<MessageCalcul>();
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
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var avant = await persistance.Charger(id, ct);
        await VerifierDroit(u, avant.Document.EntTydId, "VALIDER", ct);
        if (v.EntVersion != avant.Document.EntVersion) throw ExceptionMetier.Conflit("VERSION", "Le document a été modifié par un autre utilisateur");
        var reponse = await ValiderDans(id, u, ct);
        await tx.CommitAsync(ct);
        return reponse;
    }

    /// <summary>
    /// Validation dans la transaction de l'appelant, sans contrôle du droit VALIDER : document intermédiaire validé
    /// automatiquement par une transformation (le droit TRANSFORMER de la source suffit).
    /// </summary>
    protected internal async Task<ReponseEnregistrement<TComplet>> ValiderDans(long id, Utilisateur u, CancellationToken ct)
    {
        var avant = await persistance.Charger(id, ct);
        var type = await Type(avant.Document.EntTydId, ct);
        await VerifierModifiable(avant.Document, ct);

        var entree = await Entree(JsonCalcul.Cloner(avant), ct);
        var handler = handlers.Pour(type);
        var controles = new List<MessageCalcul>();
        var ctx = new ContexteDocument<TDoc, TLigne> { Type = type, Proprietes = await Proprietes(type.TydId, ct), Entree = entree };
        handler.Controler(ctx, controles);
        handler.AvantValidation(ctx, controles);
        specialisation.ControlerValidation(entree, controles);
        await specialisation.ControlerValidationAsync(db, avant, type, controles, ct);
        var r = handler.Calculer(entree);
        controles.AddRange(r.Erreurs);
        // Un brouillon peut attendre son tiers ; un document validé l'a toujours.
        if (avant.Document.EntTiersId is null) controles.Add(new MessageCalcul(null, "TIERS_OBLIGATOIRE", "Tiers du document à choisir avant la validation"));
        if (controles.Count > 0) throw ExceptionMetier.Invalide("VALIDATION", "Le document comporte des erreurs", controles);

        await Historiser(avant, "VALIDATION", u, ct);
        if (type.TydNumerotationContinue && r.Document.EntNumero is null)
        {
            r.Document.EntNumero = await AttribuerNumero(type, r.Document.EntDate, ct);
        }
        r.Document.EntStdId = (await Statut(type.TydId, "VALIDE", ct)).StdId;
        r.Document.EntVerrouille = true;
        // Fin de validité : à partir du jour de la validation.
        r.Document.EntDateValidite = r.Document.EntValiditeJours is short jours ? DateOnly.FromDateTime(DateTime.Today).AddDays(jours) : null;
        specialisation.PreparerValidation(r);
        var reponse = await Persister(id, r, u, ct);
        if (await EcrireSoldes(id, type, u, ct)) reponse.Document = await persistance.Charger(id, ct);
        await specialisation.ApresValidationAsync(db, id, type, ct);
        return reponse;
    }

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
    /// Précédents des lignes du marché (lig_avt_source_lig_id) : dernier document validé, non annulé, qui facture
    /// l'avancement (présentation P) ou le reprend d'un autre logiciel (type R), hors le document lui-même (Q31, 13.11).
    /// </summary>
    protected internal async Task<Dictionary<long, Precedent>> Precedents(IReadOnlyCollection<long> sources, long? exclure, CancellationToken ct)
    {
        if (sources.Count == 0) return [];
        var lignes = await (from l in db.Lignes.AsNoTracking()
                            join d in db.Documents.AsNoTracking() on l.LigEntId equals d.EntId
                            join t in db.TypesDocument.AsNoTracking() on d.EntTydId equals t.TydId
                            join s in db.StatutsDocument.AsNoTracking() on d.EntStdId equals s.StdId
                            where l.LigAvtSourceLigId != null && sources.Contains(l.LigAvtSourceLigId.Value) && d.EntVerrouille
                                && d.EntId != (exclure ?? 0) && s.StdCode != "ANNULE"
                                && (d.EntAvtPresentation == "P" || t.TydAvancement == "R")
                            select new { Source = l.LigAvtSourceLigId!.Value, d.EntId, l.LigAvtMontantCumul, l.LigAvtQteCumul, l.LigAvtPct })
            .ToListAsync(ct);
        return lignes.GroupBy(x => x.Source).ToDictionary(g => g.Key, g =>
        {
            var x = g.OrderByDescending(y => y.EntId).First();
            return new Precedent(x.LigAvtMontantCumul ?? 0, x.LigAvtQteCumul ?? 0, x.LigAvtPct ?? 0);
        });
    }

    /// <summary>Précédents écrits sur les lignes d'avancement (0 sans document précédent).</summary>
    protected internal async Task AppliquerPrecedents(IEnumerable<TLigne> lignes, long? exclure, CancellationToken ct)
    {
        var avt = lignes.Where(l => l.LigAvtSourceLigId is not null).ToList();
        var p = await Precedents(avt.Select(l => l.LigAvtSourceLigId!.Value).Distinct().ToList(), exclure, ct);
        foreach (var l in avt) EcrirePrecedent(l, p.GetValueOrDefault(l.LigAvtSourceLigId!.Value));
    }

    public static void EcrirePrecedent(TLigne l, Precedent? p)
    {
        l.LigAvtMontantPrecedent = p?.Montant ?? 0;
        l.LigAvtQtePrecedent = p?.Qte ?? 0;
        l.LigAvtPctPrecedent = p?.Pct ?? 0;
    }

    /// <summary>Seuils de solde automatique d'une famille (A achats, sinon ventes) : (% de la quantité du parent, quantité).</summary>
    public async Task<(decimal Pct, decimal Qte)> SeuilsSolde(string famille, CancellationToken ct)
    {
        var s = await LireSeuilsSolde(ct);
        var f = famille == "A" ? s.Achat : s.Vente;
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
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
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

    public async Task Supprimer(long id, Utilisateur u, CancellationToken ct)
    {
        var doc = await db.Documents.FirstOrDefaultAsync(d => d.EntId == id, ct) ?? throw ExceptionMetier.Introuvable($"Document {id}");
        await VerifierDroit(u, doc.EntTydId, "SUPPRIMER", ct);
        await VerifierModifiable(doc, ct);
        // Un document déjà transformé (source) ne se supprime pas ; un brouillon issu d'une transformation (cible) se
        // supprime avec ses liens (ses quantités ne comptent plus dans le reste de ses sources). Copie : simple trace.
        if (await db.DocumentsLien.AnyAsync(l => l.LieSourceEntId == id && l.LieType != "COPIE", ct))
        {
            throw ExceptionMetier.Conflit("DOCUMENT_LIE", "Le document a été transformé en d'autres documents");
        }
        // Liens de copie retirés avant le document (pas de navigation EF entre eux : ordre explicite).
        await using var tx = await db.Database.BeginTransactionAsync(ct);
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
        return copie.Document;
    }

    /// <summary>Désigne l'indice de référence du groupe (transformations, statistiques).</summary>
    public async Task<TComplet> DesignerReference(long id, Utilisateur u, CancellationToken ct)
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
    public async Task<TComplet> Copier(long id, Utilisateur u, CancellationToken ct)
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
        doc.EntStdId = (await Statut(doc.EntTydId, "BROUILLON", ct)).StdId;
        doc.EntCreeLe = DateTimeOffset.UtcNow;
        doc.EntCreePar = u.Code;
        doc.EntModifieLe = null;
        doc.EntModifiePar = null;
        preparer(doc);
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
