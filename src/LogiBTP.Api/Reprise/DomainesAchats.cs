using LogiBTP.Api.Reprise.Mde;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Domaine;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>Aides communes aux pièces d'achat et de sous-traitance (lot 12).</summary>
public static class SourcesAchats
{
    /// <summary>Statut d'une pièce d'achat : facture transférée en comptabilité → ENVOYE (verrouillée) ; autre pièce émise → VALIDE.</summary>
    public static string StatutDe(bool brouillon, bool facture) =>
        brouillon ? PiecesReprise.Statut.Brouillon : facture ? PiecesReprise.Statut.Envoye : PiecesReprise.Statut.Valide;

    /// <summary>Facture d'achat de montant négatif : avoir d'achat (régule OPTIM, avoir MDE).</summary>
    public static string TypeFactureOuAvoir(string typeDocument, decimal? totalHt) =>
        typeDocument == TypesDocument.AFacture && totalHt < 0 ? TypesDocument.AAvoir : typeDocument;

    /// <summary>
    /// Avoir d'achat aux montants négatifs dans la source : montants rendus positifs (le type de pièce porte le sens,
    /// comme les avoirs saisis dans LogiBTP et leur rôle AVOIR_ACHAT de la rentabilité).
    /// </summary>
    public static PieceSource Signe(PieceSource p) => p.TypeDocument != TypesDocument.AAvoir || p.TotalHt is not < 0 ? p : p with
    {
        TotalHt = -p.TotalHt, TotalTtc = -p.TotalTtc,
        Lignes = p.Lignes.Select(l => l with { Pa = -l.Pa, PvUnitaire = -l.PvUnitaire, MontantHt = -l.MontantHt }).ToList(),
    };

    /// <summary>Ligne d'achat en élément : prix d'achat unitaire, coefficients à 1 (le PV est le prix d'achat), remise en coefficient.</summary>
    public static LignePiece Element(string cle, short type, string? code, string? libelle, decimal? qte, decimal? pu, decimal? remisePct, decimal? montant,
        string? unite, int? natId, int? tvaId, int? chantierId) => new()
    {
        Cle = cle, Reference = cle, Type = type, Code = code, LibelleHtml = Rtf.HtmlDe(libelle),
        Qte = qte ?? 0, PrecisionQte = SourcesPieces.Precision(qte ?? 0), Unite = unite, NatId = natId, TvaId = tvaId,
        Pa = pu ?? 0, CoefFg = 1, CoefBenef = 1, CoefRemise = remisePct is > 0 and < 100 ? 1 - remisePct.Value / 100 : 1,
        PvUnitaire = pu is { } p and not 0 ? p : null, MontantHt = montant, ChantierId = chantierId,
    };
}

/// <summary>
/// Achats et sous-traitance MDE (plan reprise-mde-optim, lot 12) : tables ENTETE* / LIGNE* de structure commune
/// (demandes de prix, commandes, réceptions et factures fournisseurs, appels d'offres, commandes et factures de
/// sous-traitance), type par la table « type_document » (avoir si TYPE = A ou montant négatif), lignes par
/// « type_ligne_achat » (remise : ligne au montant de la source), chantier de chaque ligne (CODECHT, sinon l'entête),
/// facture transférée en comptabilité verrouillée.
/// </summary>
public sealed class AchatsMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Achats;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Structure, DomainesReprise.Codes.PiecesVente];

    private static readonly (string Entete, string Lignes, string TypeSource, string Tiers)[] Tables =
    [
        ("ENTETEDEVISFOURNISSEUR", "LIGNEDEVISFOURNISSEUR", "DF", "PMEFOURNISSEUR"),
        ("ENTETECDEFOURNISSEUR", "LIGNECDEFOURNISSEUR", "CF", "PMEFOURNISSEUR"),
        ("ENTETERECEPTIONFOURNISSEUR", "LIGNERECEPTIONFOURNISSEUR", "LF", "PMEFOURNISSEUR"),
        ("ENTETEFACTUREFOURNISSEUR", "LIGNEFACTUREFOURNISSEUR", "FF", "PMEFOURNISSEUR"),
        ("ENTETEAOSSTRAIT", "LIGNEAOSSTRAIT", "OS", "PMESOUSTRAITANT"),
        ("ENTETECDESSTRAIT", "LIGNECDESSTRAIT", "CS", "PMESOUSTRAITANT"),
        ("ENTETEFACTURESSTRAIT", "LIGNEFACTURESSTRAIT", "FS", "PMESOUSTRAITANT"),
    ];
    /// <summary>Code eTypeDocument de l'avoir fournisseur (table « type_document »).</summary>
    private const string AvoirFournisseur = "AF";
    private const string TypeAvoir = "A";

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        await using var pieces = await PiecesReprise.OuvrirAsync(ctx, ct);
        var typesLigne = await SourcesPieces.TypesLigneAsync(ctx, ct);
        var etats = (await SqlReprise.SourceAsync(ctx, "SELECT CLE, ENVOYE, ACCEPTE, NONMODIFIABLE FROM PMEETATDOCUMENT", ct))
            .ToDictionary(l => l.Texte("CLE")!, l => l.Booleen("ENVOYE") == true || l.Booleen("ACCEPTE") == true || l.Booleen("NONMODIFIABLE") == true,
                StringComparer.Ordinal);
        foreach (var (entete, tableLignes, typeSource, tableTiers) in Tables)
        {
            // Requêtes constantes : noms de tables d'une liste fermée.
            var lignes = (await SqlReprise.SourceAsync(ctx, $"SELECT * FROM {tableLignes} ORDER BY CODEDOCUMENT, NUMEROLIGNE", ct))
                .GroupBy(l => l.Texte("CODEDOCUMENT") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
            foreach (var e in await SqlReprise.SourceAsync(ctx, $"SELECT * FROM {entete} ORDER BY DATEDOC, CODE", ct))
            {
                var cle = e.Texte("CODE")!;
                var emplacement = $"{entete} {cle}";
                var totalHt = e.Decimal("TOTHTNET");
                var avoir = typeSource == "FF" && (e.Texte("TYPE") == TypeAvoir || totalHt < 0);
                if (ctx.Correspondre(TablesCorrespondance.TypeDocument, avoir ? AvoirFournisseur : typeSource, emplacement) is not { Ignorer: false, Cible: { } typeDocument })
                {
                    var v = ctx.Rapport.Volume(entete);
                    v.Lues++;
                    v.Ecartees++;
                    continue;
                }
                var chantier = (int?)ctx.Registre.Trouver(StructureMde.Chantier, e.Texte("CODECHT"));
                var facture = typeSource is "FF" or "FS";
                var transfere = e.Contient("TRANSFERECOMPTABLE") && e.Booleen("TRANSFERECOMPTABLE") == true;
                var emise = e.Texte("CLEETATDOC") is { } et && etats.GetValueOrDefault(et) || transfere || e.Booleen("PIECETRANS") == true;
                if (pieces.EstAvancement(typeDocument))
                    ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.AvancementSansMarche, emplacement,
                        "Facture de sous-traitance sans lien vers les lignes de la commande : reprise avec ses lignes, sans suivi d'avancement");
                await pieces.EcrireAsync(SourcesAchats.Signe(new PieceSource
                {
                    Origine = (entete, cle), TypeDocument = typeDocument, Numero = e.Texte("CODEDOCUTIL") ?? cle,
                    Date = SourcesRessources.Jour(e, "DATEDOC") ?? DateOnly.FromDateTime(DateTime.Today),
                    Objet = AnnuaireReprise.Couper(e.Texte("LIBELLE"), 250),
                    TiersPerId = ctx.Registre.Trouver(tableTiers, e.Texte("CODETIERS")),
                    AffaireId = (int?)ctx.Registre.Trouver(StructureMde.Affaire, e.Texte("CODEAFFAIRE")), ChantierId = chantier,
                    Statut = SourcesAchats.StatutDe(!emise, facture), Verrouille = transfere,
                    ReferenceExterne = e.Texte("REFFOURNISSEUR"), NotreReference = e.Texte("REFERENCE"),
                    TexteIntroHtml = e.Texte("LETTREENTETE") is { } intro ? Rtf.HtmlDe(intro) : null,
                    TexteFinHtml = e.Texte("LETTREPIED") is { } pied ? Rtf.HtmlDe(pied) : null,
                    CpaCode = ctx.Registre.TrouverCode(RegistreMde.Condition, e.Texte("CODEREGLEMENT")),
                    ModeReglement = ctx.Registre.TrouverCode(RegistreMde.ModeCondition, e.Texte("CODEREGLEMENT")),
                    TotalHt = totalHt, TotalTtc = e.Decimal("TOTALTTC"),
                    Lignes = Lignes(ctx, lignes.GetValueOrDefault(cle) ?? [], e.Texte("CATEGORIEAV"), chantier, typesLigne, emplacement),
                }), ct);
            }
        }
        await pieces.TerminerAsync(ct);
    }

    private static List<LignePiece> Lignes(ContexteReprise ctx, List<LigneSource> source, string? categorie, int? chantier,
        Dictionary<string, short> typesLigne, string emplacement)
    {
        var res = new List<LignePiece>();
        foreach (var l in source)
        {
            var correspondance = ctx.Correspondre(TablesCorrespondance.TypeLigneAchat, l.Texte("TYPELIGNE") ?? "", emplacement);
            if (correspondance is not { Ignorer: false, Cible: { } code } || !typesLigne.TryGetValue(code, out var type)) continue;
            var cle = l.Texte("IDENTIFIANT")!;
            var libelle = l.Texte("DESCRIPTION") ?? l.Texte("DESIGNATION");
            var tva = (int?)ctx.Registre.Trouver(RegistreMde.Tva, RegistreMde.CleTva(categorie, l.Texte("CODETVA")));
            if (type == typesLigne.GetValueOrDefault("ELEMENT") || type == typesLigne.GetValueOrDefault("PIED_HT"))
            {
                // Remise de la source (poste de pied) : ligne au montant de la ligne.
                var remise = type != typesLigne.GetValueOrDefault("ELEMENT");
                var montant = l.Decimal("TOTALLIGNEHT");
                res.Add(SourcesAchats.Element(cle, typesLigne["ELEMENT"], l.Texte("CODEARTICLE"), libelle,
                    remise ? 1 : l.Decimal("QUANTITE"), remise ? montant : l.Decimal("PRIXUNITAIRE"), remise ? null : l.Decimal("REMISE"), montant,
                    RegistreMde.UniteDe(ctx, l.Texte("UNITEMESURE")),
                    (int?)ctx.Registre.Trouver(BibliothequeMde.Nature, l.Texte("CLENATURE")), tva,
                    (int?)ctx.Registre.Trouver(StructureMde.Chantier, l.Texte("CODECHT")) ?? chantier));
            }
            else res.Add(new LignePiece { Cle = cle, Type = type, LibelleHtml = Rtf.HtmlDe(libelle) });
        }
        return res;
    }
}

/// <summary>
/// Achats et sous-traitance OPTIM (lot 12) : ach_doc_entete (type par « type_document_achat », sociétés retenues, hors
/// sauvegardes), fournisseur ach_doc_tiers, lignes ach_ligne_achat (propres ou liées par ach_doc_lien_ligne_achat ;
/// réception : quantité livrée), factures par ach_export_facture_entete / _ligne (chantier de chaque ligne, transférée →
/// verrouillée, montant négatif → avoir), liens commande → réception → facture ; sous-traitance : afc_prestation_st en
/// commandes (lignes afc_prestation_st_ligne), situations afc_prestation_st_situation en factures d'avancement (cumul
/// PSI_MtHT_Avct par ligne de la commande), consultations en appels d'offres.
/// </summary>
public sealed class AchatsOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Achats;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Structure, DomainesReprise.Codes.PiecesVente];

    public const string Entete = "ach_doc_entete";
    public const string Prestation = "afc_prestation_st";
    public const string SituationSt = "afc_prestation_st_situation";
    public const string Consultation = "afc_prestation_st_consultation";
    /// <summary>Codes propres à la reprise de la table « type_document_achat » pour la sous-traitance.</summary>
    public const string CodePrestation = "PST";
    public const string CodeSituation = "PSS";
    public const string CodeConsultation = "PSC";

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        await using var pieces = await PiecesReprise.OuvrirAsync(ctx, ct);
        var typesLigne = await SourcesPieces.TypesLigneAsync(ctx, ct);
        var (retenue, etablissement) = await StructureOptim.EtablissementsAsync(ctx, ct);
        var codes = (await SqlReprise.SourceAsync(ctx, "SELECT PRM_ID, PRM_Code FROM z_parametre", ct))
            .ToDictionary(l => l.Texte("PRM_ID")!, l => l.Texte("PRM_Code"), StringComparer.Ordinal);
        await AchatsAsync(ctx, pieces, typesLigne, retenue, etablissement, codes, ct);
        await SousTraitanceAsync(ctx, pieces, typesLigne, retenue, etablissement, ct);
        await pieces.TerminerAsync(ct);
    }

    private static int? Chantier(ContexteReprise ctx, LigneSource l, string colonne) => (int?)ctx.Registre.Trouver(StructureOptim.Chantier, l.Texte(colonne));
    private static long? Tiers(ContexteReprise ctx, string? trs) =>
        trs is null or "0" ? null : ctx.Registre.Trouver(RegistreOptim.Tiers, ctx.CleConservee(RegistreOptim.Tiers, trs));

    private static async Task AchatsAsync(ContexteReprise ctx, PiecesReprise pieces, Dictionary<string, short> typesLigne,
        Func<LigneSource, string, bool> retenue, Func<LigneSource, string, string?> etablissement, Dictionary<string, string?> codes, CancellationToken ct)
    {
        var tiers = (await SqlReprise.SourceAsync(ctx, "SELECT DOT_DOE_ID, DOT_TRS_ID FROM ach_doc_tiers ORDER BY DOT_ID", ct))
            .GroupBy(l => l.Texte("DOT_DOE_ID") ?? "").ToDictionary(g => g.Key, g => g.First().Texte("DOT_TRS_ID"), StringComparer.Ordinal);
        var lga = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM ach_ligne_achat WHERE LGA_IsDesactive = 0 ORDER BY LGA_Ordre, LGA_ID", ct)).ToList();
        var parLga = lga.ToDictionary(l => l.Texte("LGA_ID")!, StringComparer.Ordinal);
        var lignesDoc = lga.GroupBy(l => l.Texte("LGA_DOE_ID") ?? "").ToDictionary(g => g.Key, g => g.Select(l => l.Texte("LGA_ID")!).ToList(), StringComparer.Ordinal);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT DOL_DOE_ID, DOL_LGA_ID FROM ach_doc_lien_ligne_achat WHERE DOL_IsDesactive = 0 ORDER BY DOL_ID", ct))
            if (l.Texte("DOL_DOE_ID") is { } doe && l.Texte("DOL_LGA_ID") is { } id && parLga.ContainsKey(id))
                (lignesDoc.TryGetValue(doe, out var liste) ? liste : lignesDoc[doe] = []).Add(id);
        var factures = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM ach_export_facture_entete WHERE FAC_IsDesactive = 0 ORDER BY FAC_ID", ct))
            .GroupBy(l => l.Texte("FAC_DOE_ID") ?? "").ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var lignesFacture = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM ach_export_facture_ligne WHERE FAL_IsDesactive = 0 ORDER BY FAL_FAC_ID, FAL_Ordre, FAL_ID", ct))
            .GroupBy(l => l.Texte("FAL_FAC_ID") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var titre = typesLigne.GetValueOrDefault("TITRE");
        var element = typesLigne["ELEMENT"];

        var ecrites = new List<LigneSource>();
        foreach (var e in await SqlReprise.SourceAsync(ctx, "SELECT * FROM ach_doc_entete WHERE DOE_IsBkp = 0 ORDER BY DOE_Date, DOE_ID", ct))
        {
            var cle = e.Texte("DOE_ID")!;
            var emplacement = $"{Entete} {cle}";
            var code = e.Texte("DOE_Type") is { } t ? codes.GetValueOrDefault(t) : null;
            var fac = factures.GetValueOrDefault(cle);
            // Facture d'une situation de sous-traitance : reprise par la situation (pas de double coût).
            var deSituation = fac?.Texte("FAC_PSS_ID") is { } pss and not "0";
            if (!retenue(e, "DOE_SCT_ID") || deSituation
                || ctx.Correspondre(TablesCorrespondance.TypeDocumentAchat, code, emplacement) is not { Ignorer: false, Cible: { } type })
            {
                if (deSituation) ctx.Rapport.Perdre(Entete, "FAC_PSS_ID", cle, "Facture d'une situation de sous-traitance : reprise par la situation");
                var v = ctx.Rapport.Volume(Entete);
                v.Lues++;
                v.Ecartees++;
                continue;
            }
            var chantier = Chantier(ctx, e, "DOE_CHT_ID");
            var tvaEntete = (int?)ctx.Registre.Trouver(RegistreOptim.Tva, e.Texte("DOE_PRM_ID_TVA"));
            List<LignePiece> lignes;
            decimal? totalHt, totalTtc;
            if (fac is not null)
            {
                lignes = (lignesFacture.GetValueOrDefault(fac.Texte("FAC_ID")!) ?? []).Select(l => l.Booleen("FAL_IsTitre") == true && titre != 0
                    ? new LignePiece { Cle = $"FAL{l.Texte("FAL_ID")}", Type = titre, LibelleHtml = Rtf.HtmlDe(l.Texte("FAL_Libelle")) }
                    : SourcesAchats.Element($"FAL{l.Texte("FAL_ID")}", element, l.Texte("FAL_Code"), l.Texte("FAL_Libelle"), l.Decimal("FAL_Qte"), l.Decimal("FAL_PAU"),
                        null, l.Decimal("FAL_PAT"), l.Texte("FAL_UNT_ID") is { } u and not "0" ? ctx.Registre.TrouverCode(RegistreOptim.Unite, u) : null,
                        (int?)ctx.Registre.Trouver(RegistreOptim.Nature, l.Texte("FAL_FTY_ID")),
                        (int?)ctx.Registre.Trouver(RegistreOptim.Tva, l.Texte("FAL_TVA")) ?? tvaEntete, Chantier(ctx, l, "FAL_CHT_ID") ?? chantier)).ToList();
                totalHt = fac.Decimal("FAC_MontantHT");
                totalTtc = fac.Decimal("FAC_MontantTTC");
            }
            else
            {
                var reception = type == TypesDocument.AReception;
                lignes = (lignesDoc.GetValueOrDefault(cle) ?? []).Distinct().Select(id => parLga[id]).Select(l => l.Booleen("LGA_IsTitre") == true && titre != 0
                    ? new LignePiece { Cle = l.Texte("LGA_ID")!, Type = titre, LibelleHtml = Rtf.HtmlDe(l.Texte("LGA_LibelleExt")) }
                    : SourcesAchats.Element(l.Texte("LGA_ID")!, element, l.Texte("LGA_CodeExt"), l.Texte("LGA_LibelleExt"),
                        reception && l.Decimal("LGA_QteLivre") is > 0 ? l.Decimal("LGA_QteLivre") : l.Decimal("LGA_Qte"), l.Decimal("LGA_PAU"), l.Decimal("LGA_TxRemise"),
                        null, l.Texte("LGA_UNT_ID") is { } u and not "0" ? ctx.Registre.TrouverCode(RegistreOptim.Unite, u) : null, null, tvaEntete, chantier)).ToList();
                totalHt = e.Decimal("DOE_PAT");
                totalTtc = e.Decimal("DOE_MtTTC");
            }
            var transfere = e.Booleen("DOE_IsTransfereCompta") == true || fac?.Booleen("FAC_IsTransfere") == true;
            var proprietes = new Dictionary<string, string>();
            if (etablissement(e, "DOE_SCT_ID") is { } etab) proprietes[StructureReprise.ProprieteEtablissement] = etab;
            await pieces.EcrireAsync(SourcesAchats.Signe(new PieceSource
            {
                Origine = (Entete, cle), TypeDocument = SourcesAchats.TypeFactureOuAvoir(type, totalHt),
                Numero = fac?.Texte("FAC_Code") ?? e.Texte("DOE_Code") ?? cle,
                Date = (fac is not null ? SourcesRessources.Jour(fac, "FAC_Date") : null) ?? SourcesRessources.Jour(e, "DOE_Date") ?? DateOnly.FromDateTime(DateTime.Today),
                Objet = AnnuaireReprise.Couper(fac?.Texte("FAC_Libelle") ?? e.Texte("DOE_TPP_Libelle"), 250),
                TiersPerId = Tiers(ctx, tiers.GetValueOrDefault(cle) ?? fac?.Texte("FAC_TRS_ID_Payeur")),
                ChantierId = chantier, Statut = SourcesAchats.StatutDe(false, fac is not null), Verrouille = transfere,
                ReferenceExterne = e.Texte("DOE_NumeroAR"), TexteFinHtml = e.Texte("DOE_Commentaire") is { } c ? Rtf.HtmlDe(c) : null,
                ModeReglement = ctx.Registre.TrouverCode(RegistreOptim.Mode, fac?.Texte("FAC_ModeRegl") ?? e.Texte("DOE_ModeReglement")),
                TotalHt = totalHt, TotalTtc = totalTtc, Proprietes = proprietes, Lignes = lignes,
            }), ct);
            ecrites.Add(e);
        }
        // Chaîne commande → réception → facture.
        foreach (var e in ecrites)
        {
            var cible = (Entete, e.Texte("DOE_ID"));
            foreach (var colonne in new[] { "DOE_DOE_ID_Cde", "DOE_DOE_ID_BL" })
                if (e.Texte(colonne) is { } source and not "0") await pieces.LierAsync((Entete, source), cible, ct);
        }
    }

    private static async Task SousTraitanceAsync(ContexteReprise ctx, PiecesReprise pieces, Dictionary<string, short> typesLigne,
        Func<LigneSource, string, bool> retenue, Func<LigneSource, string, string?> etablissement, CancellationToken ct)
    {
        var lignes = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM afc_prestation_st_ligne WHERE PSL_IsDesactive = 0 ORDER BY PSL_PST_ID, PSL_Ordre, PSL_ID", ct))
            .GroupBy(l => l.Texte("PSL_PST_ID") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var prestations = new Dictionary<string, (LigneSource Ligne, PieceSource Piece)>(StringComparer.Ordinal);
        foreach (var e in await SqlReprise.SourceAsync(ctx, "SELECT * FROM afc_prestation_st WHERE PST_IsModele = 0 AND PST_IsDesactive = 0 ORDER BY PST_DateCreat, PST_ID", ct))
        {
            var cle = e.Texte("PST_ID")!;
            var emplacement = $"{Prestation} {cle}";
            if (!retenue(e, "PST_SCT_ID") || ctx.Correspondre(TablesCorrespondance.TypeDocumentAchat, CodePrestation, emplacement) is not { Ignorer: false, Cible: { } type })
            {
                var v = ctx.Rapport.Volume(Prestation);
                v.Lues++;
                v.Ecartees++;
                continue;
            }
            if (e.Booleen("PST_IsPaieDirect") == true) ctx.Rapport.Perdre(Prestation, "PST_IsPaieDirect", e.Texte("PST_Code"), "Paiement direct : repris avec les règlements (lot 13)");
            var chantier = Chantier(ctx, e, "PST_CHT_ID");
            var tva = (int?)ctx.Registre.Trouver(RegistreOptim.Tva, e.Texte("PST_PRM_ID_TVA"));
            var proprietes = new Dictionary<string, string>();
            if (etablissement(e, "PST_SCT_ID") is { } etab) proprietes[StructureReprise.ProprieteEtablissement] = etab;
            var p = new PieceSource
            {
                Origine = (Prestation, cle), TypeDocument = type, Numero = e.Texte("PST_Code") ?? cle,
                Date = SourcesRessources.Jour(e, "PST_DateMarcheST") ?? SourcesRessources.Jour(e, "PST_DateCreat") ?? DateOnly.FromDateTime(DateTime.Today),
                Objet = AnnuaireReprise.Couper(e.Texte("PST_Libelle"), 250), TiersPerId = Tiers(ctx, e.Texte("PST_TRS_ID")),
                AffaireId = (int?)ctx.Registre.Trouver(StructureOptim.Affaire, e.Texte("PST_AFF_ID")), ChantierId = chantier,
                Statut = PiecesReprise.Statut.Valide, ReferenceExterne = e.Texte("PST_RefDevisST"),
                TexteFinHtml = e.Texte("PST_Commentaire") is { } c ? Rtf.HtmlDe(c) : null,
                TotalHt = e.Decimal("PST_TotPAT"), Proprietes = proprietes,
                Lignes = LignesPrestation(ctx, lignes.GetValueOrDefault(cle) ?? [], typesLigne, tva, chantier),
            };
            await pieces.EcrireAsync(p, ct);
            prestations[cle] = (e, p);
        }

        // Situations de sous-traitance : factures d'avancement (cumul par ligne de la commande ; période = écart au cumul précédent).
        var avancements = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM afc_prestation_st_situation_ligne WHERE PSI_IsDesactive = 0 ORDER BY PSI_PSS_ID, PSI_ID", ct))
            .GroupBy(l => l.Texte("PSI_PSS_ID") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var situations = await SqlReprise.SourceAsync(ctx, "SELECT * FROM afc_prestation_st_situation WHERE PSS_IsDesactive = 0 ORDER BY PSS_Date, PSS_Numero, PSS_ID", ct);
        var cumuls = situations.ToDictionary(s => s.Texte("PSS_ID")!, s => s.Decimal("PSS_MtHT") ?? 0, StringComparer.Ordinal);
        foreach (var s in situations)
        {
            var cle = s.Texte("PSS_ID")!;
            var emplacement = $"{SituationSt} {cle}";
            if (s.Texte("PSS_PST_ID") is not { } pst || !prestations.TryGetValue(pst, out var prestation)
                || ctx.Correspondre(TablesCorrespondance.TypeDocumentAchat, CodeSituation, emplacement) is not { Ignorer: false, Cible: { } type })
            {
                var v = ctx.Rapport.Volume(SituationSt);
                v.Lues++;
                v.Ecartees++;
                continue;
            }
            var detail = avancements.GetValueOrDefault(cle) ?? [];
            var precedent = s.Texte("PSS_PSS_ID_Prec") is { } prec ? cumuls.GetValueOrDefault(prec) : 0;
            await pieces.EcrireAsync(prestation.Piece with
            {
                Origine = (SituationSt, cle), TypeDocument = type,
                Numero = s.Texte("PSS_Reference") ?? $"{prestation.Piece.Numero}-S{s.Texte("PSS_Numero")}",
                Date = SourcesRessources.Jour(s, "PSS_Date") ?? prestation.Piece.Date, Objet = AnnuaireReprise.Couper(s.Texte("PSS_Libelle"), 250) ?? prestation.Piece.Objet,
                Statut = s.Booleen("PSS_IsValid") == true ? PiecesReprise.Statut.Envoye : PiecesReprise.Statut.Brouillon,
                ReferenceExterne = null, TexteFinHtml = s.Texte("PSS_Obervation") is { } obs ? Rtf.HtmlDe(obs) : null,
                TotalHt = (s.Decimal("PSS_MtHT") ?? 0) - precedent, TotalTtc = null, Lignes = [],
                Avancement = new AvancementSource
                {
                    Marche = (Prestation, pst), TableLignes = Prestation,
                    PctGlobal = detail.Count == 0 ? s.Decimal("PSS_Pct_Avct") ?? 0 : null,
                    Lignes = detail.Select(l => new LigneAvancement
                    {
                        LigneMarche = l.Texte("PSI_PSL_ID"), MontantCumul = l.Decimal("PSI_MtHT_Avct") ?? 0, PctCumul = l.Decimal("PSI_Pct_Avct"),
                        LibelleHtml = Rtf.HtmlDe(l.Texte("PSI_Commentaire")),
                    }).ToList(),
                },
            }, ct);
        }

        // Consultations : appels d'offres au montant de l'offre.
        foreach (var c in await SqlReprise.SourceAsync(ctx, "SELECT * FROM afc_prestation_st_consultation WHERE PSC_IsDesactive = 0 ORDER BY PSC_PST_ID, PSC_Ordre, PSC_ID", ct))
        {
            var cle = c.Texte("PSC_ID")!;
            var emplacement = $"{Consultation} {cle}";
            if (c.Texte("PSC_PST_ID") is not { } pst || !prestations.TryGetValue(pst, out var prestation)
                || ctx.Correspondre(TablesCorrespondance.TypeDocumentAchat, CodeConsultation, emplacement) is not { Ignorer: false, Cible: { } type })
            {
                var v = ctx.Rapport.Volume(Consultation);
                v.Lues++;
                v.Ecartees++;
                continue;
            }
            var montant = c.Decimal("PSC_MtHTOffre");
            await pieces.EcrireAsync(prestation.Piece with
            {
                Origine = (Consultation, cle), TypeDocument = type,
                Numero = $"{prestation.Piece.Numero}-C{c.Texte("PSC_Ordre") ?? cle}", ReferenceExterne = c.Texte("PSC_RefOffre"),
                Date = SourcesRessources.Jour(c, "PSC_DateConsultation") ?? prestation.Piece.Date, TiersPerId = Tiers(ctx, c.Texte("PSC_TRS_ID")),
                Statut = PiecesReprise.Statut.Envoye, TotalHt = montant, TotalTtc = null, TexteFinHtml = null,
                Lignes = montant is null or 0 ? [] :
                [
                    SourcesAchats.Element($"PSC{cle}", typesLigne["ELEMENT"], null, prestation.Piece.Objet, 1, montant, null, montant, null, null,
                        prestation.Piece.Lignes.Select(l => l.TvaId).FirstOrDefault(t => t is not null), null) with { Reference = null },
                ],
            }, ct);
        }
    }

    private static List<LignePiece> LignesPrestation(ContexteReprise ctx, List<LigneSource> source, Dictionary<string, short> typesLigne, int? tva, int? chantier)
    {
        string Cle(LigneSource l) => l.Texte("PSL_ID")!;
        var res = new List<LignePiece>();
        var retenues = new Dictionary<string, LignePiece>(StringComparer.Ordinal);
        foreach (var l in SourcesPieces.Arbre(source, Cle, l => l.Texte("PSL_PSL_ID"), l => l.Decimal("PSL_Ordre") ?? 0))
        {
            var cle = Cle(l);
            var parent = l.Texte("PSL_PSL_ID") is { } pc && retenues.TryGetValue(pc, out var pr) ? pr : null;
            var code = PiecesVenteOptim.TypeOptim(l.Entier("PSL_TypeLigne")) ?? "TEXTE";
            var composante = l.Booleen("PSL_IsSousDetail") == true && parent is not null;
            var chiffree = code is "OUVRAGE" or "ELEMENT";
            var x = chiffree
                ? SourcesAchats.Element(cle, typesLigne[code], l.Texte("PSL_Code"), l.Texte("PSL_Libelle"), l.Decimal("PSL_Qte"), l.Decimal("PSL_PAU"), null,
                    l.Decimal("PSL_PAT"), l.Texte("PSL_UNT_ID") is { } u and not "0" ? ctx.Registre.TrouverCode(RegistreOptim.Unite, u) : null, null, tva, chantier)
                    with { ParentCle = parent?.Cle, Composante = composante }
                : new LignePiece { Cle = cle, Reference = cle, ParentCle = parent?.Cle, Type = typesLigne[code], LibelleHtml = Rtf.HtmlDe(l.Texte("PSL_Libelle")) };
            res.Add(x);
            retenues[cle] = x;
        }
        return res;
    }
}
