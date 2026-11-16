using System.Globalization;
using LogiBTP.Api.Reprise.Mde;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle;

namespace LogiBTP.Api.Reprise;

/// <summary>Aides communes aux pièces de vente des deux sources.</summary>
public static class SourcesPieces
{
    /// <summary>Types de ligne de la base (code → tyl_id) : les correspondances donnent des codes, jamais des identifiants.</summary>
    public static async Task<Dictionary<string, short>> TypesLigneAsync(ContexteReprise ctx, CancellationToken ct) =>
        (await SqlReprise.LireAsync(ctx.Unite, "SELECT tyl_id, tyl_code FROM type_ligne", r => (Id: r.GetInt16(0), Code: r.GetString(1)), ct))
            .ToDictionary(x => x.Code, x => x.Id, StringComparer.Ordinal);

    /// <summary>Lignes d'une pièce dans l'ordre de l'arbre (parents avant enfants, frères par ordre).</summary>
    public static IEnumerable<LigneSource> Arbre(IReadOnlyList<LigneSource> lignes, Func<LigneSource, string> cle, Func<LigneSource, string?> parent,
        Func<LigneSource, decimal> ordre)
    {
        var cles = lignes.Select(cle).ToHashSet(StringComparer.Ordinal);
        var enfants = lignes.GroupBy(l => parent(l) is { } p && cles.Contains(p) ? p : "")
            .ToDictionary(g => g.Key, g => g.OrderBy(ordre).ThenBy(cle, StringComparer.Ordinal).ToList(), StringComparer.Ordinal);
        IEnumerable<LigneSource> Parcourir(string p)
        {
            foreach (var l in enfants.GetValueOrDefault(p) ?? [])
            {
                yield return l;
                foreach (var e in Parcourir(cle(l))) yield return e;
            }
        }
        return Parcourir("");
    }

    /// <summary>Nombre de décimales d'une quantité (2 à 6).</summary>
    public static short Precision(decimal qte)
    {
        var texte = qte.ToString("0.######", CultureInfo.InvariantCulture);
        var point = texte.IndexOf('.', StringComparison.Ordinal);
        return (short)Math.Clamp(point < 0 ? 0 : texte.Length - point - 1, 2, 6);
    }

    /// <summary>Durée de validité en jours (période J, S, M, A).</summary>
    public static short? ValiditeJours(long? nombre, string? periode) => nombre is > 0 and < 1000
        ? (short)(nombre.Value * (periode?.Trim().ToUpperInvariant() switch { "S" => 7, "M" => 30, "A" => 365, _ => 1 }))
        : null;
}

/// <summary>
/// Pièces de vente MDE (plan reprise-mde-optim, lot 10) : devis (versions par CODEDEVINIT), commandes, BL, factures,
/// avoirs et factures d'acompte (PMEDOCFACCLI.TYPE, table « type_facture » ; les factures d'avancement suivent, avec les situations : DomainesAvancement.cs),
/// statut par l'état (PMEETATDOCUMENT : accepté → VALIDE, envoyé → ENVOYE, non modifiable → verrouillé), lignes par la
/// table « type_ligne_vente » (élément composé → ouvrage, NIVCOMPO > 0 → composante), marché du chantier rattaché à son
/// devis initial (PMECHANTIER.CLEDOCINIT).
/// </summary>
public sealed partial class PiecesVenteMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.PiecesVente;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Structure, DomainesReprise.Codes.Bibliotheque];

    public const string Devis = "PMEDOCDEVCLI";
    public const string Facture = "PMEDOCFACCLI";

    /// <summary>Tables d'entête et code <c>eTypeDocument</c> de la source (rapproché par la table « type_document »).</summary>
    private static readonly (string Table, string TypeSource, string Requete, string RequeteLignes)[] Tables =
    [
        (Devis, "DC", "SELECT * FROM PMEDOCDEVCLI ORDER BY DATEDOC, CLEDOC", "SELECT * FROM PMEDOCDEVCLILIG ORDER BY CLEDOC, NUMORDRE"),
        ("PMEDOCCDECLI", "CC", "SELECT * FROM PMEDOCCDECLI ORDER BY DATEDOC, CLEDOC", "SELECT * FROM PMEDOCCDECLILIG ORDER BY CLEDOC, NUMORDRE"),
        ("PMEDOCBLCLI", "LC", "SELECT * FROM PMEDOCBLCLI ORDER BY DATEDOC, CLEDOC", "SELECT * FROM PMEDOCBLCLILIG ORDER BY CLEDOC, NUMORDRE"),
        (Facture, "FC", "SELECT * FROM PMEDOCFACCLI ORDER BY DATEDOC, CLEDOC", "SELECT * FROM PMEDOCFACCLILIG ORDER BY CLEDOC, NUMORDRE"),
    ];

    /// <summary>État d'une pièce MDE (PMEETATDOCUMENT).</summary>
    private readonly record struct Etat(bool Envoye, bool Accepte, bool Fige);

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        await using var pieces = await PiecesReprise.OuvrirAsync(ctx, ct);
        var typesLigne = await SourcesPieces.TypesLigneAsync(ctx, ct);
        var etats = (await SqlReprise.SourceAsync(ctx, "SELECT CLE, ENVOYE, ACCEPTE, NONMODIFIABLE FROM PMEETATDOCUMENT", ct))
            .ToDictionary(l => l.Texte("CLE")!, l => new Etat(l.Booleen("ENVOYE") == true, l.Booleen("ACCEPTE") == true, l.Booleen("NONMODIFIABLE") == true),
                StringComparer.Ordinal);
        var facturesAvancement = new List<(LigneSource Entete, string TypeDocument, List<LigneSource> Lignes)>();

        foreach (var (table, typeSource, requete, requeteLignes) in Tables)
        {
            var lignes = (await SqlReprise.SourceAsync(ctx, requeteLignes, ct)).GroupBy(l => l.Texte("CLEDOC") ?? "")
                .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
            foreach (var e in await SqlReprise.SourceAsync(ctx, requete, ct))
            {
                var cle = e.Texte("CLEDOC")!;
                var emplacement = $"{table} {cle}";
                var type = table == Facture
                    ? ctx.Correspondre(TablesCorrespondance.TypeFacture, e.Texte("TYPE") ?? "F", emplacement)
                    : ctx.Correspondre(TablesCorrespondance.TypeDocument, typeSource, emplacement);
                if (type is not { Ignorer: false, Cible: { } typeDocument })
                {
                    var v = ctx.Rapport.Volume(table);
                    v.Lues++;
                    v.Ecartees++;
                    continue;
                }
                // Factures d'avancement : reprises après les pièces, avec les situations et leur marché (lot 11).
                if (pieces.EstAvancement(typeDocument))
                {
                    facturesAvancement.Add((e, typeDocument, lignes.GetValueOrDefault(cle) ?? []));
                    continue;
                }
                var p = Entete(ctx, e, table, typeDocument, etats) with
                {
                    GroupeCle = table == Devis ? $"{table}|{e.Texte("CODEDEVINIT") ?? e.Texte("CODE")}" : null,
                    Lignes = Lignes(ctx, lignes.GetValueOrDefault(cle) ?? [], e.Texte("CODECATEGORIE"), typesLigne, emplacement),
                };
                await pieces.EcrireAsync(p, ct);
            }
        }

        // Marché de vente d'un chantier : rattaché à son devis initial.
        var devisInitiaux = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var c in await SqlReprise.SourceAsync(ctx, "SELECT CODE, CLEDOCINIT FROM PMECHANTIER WHERE CLEDOCINIT IS NOT NULL", ct))
        {
            devisInitiaux[c.Texte("CODE")!] = c.Texte("CLEDOCINIT")!;
            if (ctx.Registre.Trouver(StructureMde.Chantier, c.Texte("CODE")) is { } cha && ctx.Registre.Trouver(Devis, c.Texte("CLEDOCINIT")) is { } ent)
                await pieces.LierMarcheAsync((int)cha, ent, ct);
        }
        await AvancementAsync(ctx, pieces, etats, facturesAvancement, devisInitiaux, ct);
        await pieces.TerminerAsync(ct);
    }

    /// <summary>Entête commun des pièces MDE (statut par l'état, verrouillage, tiers, adresse, structure, conditions, totaux).</summary>
    private static PieceSource Entete(ContexteReprise ctx, LigneSource e, string table, string typeDocument, Dictionary<string, Etat> etats)
    {
        var etat = e.Texte("CLEETATDOC") is { } ce ? etats.GetValueOrDefault(ce) : default;
        var definitive = e.Contient("EDITIONDEFINITIVE") && e.Booleen("EDITIONDEFINITIVE") == true
            || e.Contient("TRANSCPT") && e.Booleen("TRANSCPT") == true;
        var statut = etat.Accepte ? PiecesReprise.Statut.Valide
            : etat.Envoye || etat.Fige || definitive ? PiecesReprise.Statut.Envoye : PiecesReprise.Statut.Brouillon;
        var postes = e.Contient("MTPOSTESHT") && (e.Decimal("MTPOSTESHT") is not (null or 0) || e.Decimal("MTPOSTESTTC") is not (null or 0));
        if (postes) ctx.Rapport.Perdre(table, "MTPOSTESHT/MTPOSTESTTC", e.Texte("CODE"), "Postes de pied non repris : total HT et TTC hors postes");
        return new PieceSource
        {
            Origine = (table, e.Texte("CLEDOC")!), TypeDocument = typeDocument, Numero = e.Texte("CODE"),
            Date = SourcesRessources.Jour(e, "DATEDOC") ?? DateOnly.FromDateTime(DateTime.Today),
            Objet = AnnuaireReprise.Couper(e.Texte("LIBELLE") ?? Rtf.TexteDe(Rtf.HtmlDe(e.Texte("DESCRIPTIF"))), 250),
            TiersPerId = ctx.Registre.Trouver("PMECLIENT", e.Texte("CODECLIENT")),
            Adresse = e.Texte("NOM") is null && e.Texte("ADR") is null ? null
                : new AdressePiece(e.Texte("NOM"), e.Texte("ADR"), e.Texte("CP"), e.Texte("VILLE"), ctx.Registre.TrouverCode(RegistreMde.Pays, e.Texte("PAYS"))),
            AffaireId = (int?)ctx.Registre.Trouver(StructureMde.Affaire, e.Texte("CODEAFFAIRE")),
            ChantierId = (int?)ctx.Registre.Trouver(StructureMde.Chantier, e.Texte("CODECHT")),
            Statut = statut, Verrouille = etat.Fige || definitive,
            ValiditeJours = e.Contient("VALIDITENB") ? SourcesPieces.ValiditeJours(e.Entier("VALIDITENB"), e.Texte("VALIDITEPER")) : null,
            TexteIntroHtml = e.Texte("LETTREENTETE") is { } intro ? Rtf.HtmlDe(intro) : null,
            TexteFinHtml = e.Texte("LETTREPIED") is { } pied ? Rtf.HtmlDe(pied) : null,
            CpaCode = ctx.Registre.TrouverCode(RegistreMde.Condition, e.Texte("MODREG")),
            ModeReglement = ctx.Registre.TrouverCode(RegistreMde.ModeCondition, e.Texte("MODREG")),
            TotalHt = e.Decimal("MTHT"),
            TotalTtc = postes ? null : e.Decimal("MTTTC"),
        };
    }

    private static List<LignePiece> Lignes(ContexteReprise ctx, List<LigneSource> source, string? categorie, Dictionary<string, short> typesLigne, string emplacement)
    {
        string Cle(LigneSource l) => l.Texte("IDLIG") ?? l.Texte("CLE")!;
        var composees = source.Where(l => (l.Entier("NIVCOMPO") ?? 0) > 0).Select(l => l.Texte("IDPARENT")).OfType<string>().ToHashSet(StringComparer.Ordinal);
        var res = new List<LignePiece>();
        var retenues = new HashSet<string>(StringComparer.Ordinal);
        foreach (var l in SourcesPieces.Arbre(source, Cle, l => l.Texte("IDPARENT"), l => l.Decimal("NUMORDRE") ?? 0))
        {
            var cle = Cle(l);
            var parent = l.Texte("IDPARENT") is { } p && retenues.Contains(p) ? p : null;
            if (l.Texte("IDPARENT") is { } absent && !retenues.Contains(absent) && source.Any(x => Cle(x) == absent)) continue; // parent écarté
            var correspondance = ctx.Correspondre(TablesCorrespondance.TypeLigneVente, l.Texte("TYPELIG") ?? "", emplacement);
            if (correspondance is not { Ignorer: false, Cible: { } codeType } || !typesLigne.TryGetValue(codeType, out var type))
            {
                if (l.Texte("TYPELIG") is { } t) ctx.Rapport.Perdre(TablesCorrespondance.TypeLigneVente, "TYPELIG", t, "Ligne sans équivalent (récapitulatif) : recalculée par l'édition");
                continue;
            }
            var composante = (l.Entier("NIVCOMPO") ?? 0) > 0;
            if (type == typesLigne.GetValueOrDefault("ELEMENT") && composees.Contains(cle)) type = typesLigne["OUVRAGE"];
            var qte = l.Decimal("QUANTITE") ?? 0;
            var remise = l.Decimal("REMISE") ?? 0;
            var pv = l.Decimal("PV") is { } x and not 0 ? x : (decimal?)null;
            res.Add(new LignePiece
            {
                Cle = cle, Reference = l.Texte("CLE"), ParentCle = parent, Type = type, Composante = composante && parent is not null, Code = l.Texte("CODEELEM"),
                LibelleHtml = Rtf.HtmlDe(l.Texte("LIBELLECOM") ?? l.Texte("LIBELLE")), NonEditee = l.Contient("EDITEE") && l.Entier("EDITEE") == 0,
                Qte = qte, PrecisionQte = l.Entier("DECUNITE") is { } dec and >= 0 ? (short)Math.Clamp((int)dec, 2, 6) : SourcesPieces.Precision(qte),
                Unite = l.Texte("UNITE") is { } u ? ctx.Registre.TrouverCode(RegistreMde.Unite, u.Trim()) : null,
                NatId = (int?)ctx.Registre.Trouver(BibliothequeMde.Nature, l.Texte("CLENATURE")),
                TvaId = (int?)ctx.Registre.Trouver(RegistreMde.Tva, RegistreMde.CleTva(categorie, l.Texte("CODETVA"))),
                Pa = l.Decimal("DEBOURSE"), CoefFg = l.Decimal("COEFFG") ?? 1, CoefBenef = l.Decimal("COEFBEN") ?? 1,
                CoefRemise = remise is > 0 and < 100 ? 1 - remise / 100 : 1, PvUnitaire = pv, PvFixe = l.Booleen("PVIMPOSE") == true,
                MontantHt = l.Decimal("MONTANTHT"),
            });
            retenues.Add(cle);
        }
        return res;
    }
}

/// <summary>
/// Pièces de vente OPTIM (lot 10) : vte_doc_entete des sociétés retenues hors modèles, pièces virtuelles, sauvegardes
/// et budgets (Q16), type par la table « type_document_vente » (factures de situation avec les situations : DomainesAvancement.cs), statut par le libellé de l'état,
/// facture comptabilisée ou numérotée verrouillée, versions par chrono et indice, lignes vte_doc_ligne selon les règles
/// de <c>convertirOptim</c> (frais indirects écartés, sous-détail en composantes, quantité fixe absolue, coefficient de
/// vente de la ligne de prix), marché rattaché (VDE_IsMarche), établissement d'origine en propriété.
/// </summary>
public sealed partial class PiecesVenteOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.PiecesVente;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Structure, DomainesReprise.Codes.Bibliotheque];

    public const string Entete = "vte_doc_entete";
    /// <summary>Types de ligne OPTIM (TypeLigne) : 4 et 3 titres, 2 ouvrage, 1 élément (règle de convertirOptim).</summary>
    public static string? TypeOptim(long? typeLigne) => typeLigne switch { 4 or 3 => "TITRE", 2 => "OUVRAGE", 1 => "ELEMENT", _ => null };

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        await using var pieces = await PiecesReprise.OuvrirAsync(ctx, ct);
        var typesLigne = await SourcesPieces.TypesLigneAsync(ctx, ct);
        var (retenue, etablissement) = await StructureOptim.EtablissementsAsync(ctx, ct);
        var parametres = (await SqlReprise.SourceAsync(ctx, "SELECT PRM_ID, PRM_Code, PRM_Libelle, PRM_TypeParam FROM z_parametre", ct))
            .ToDictionary(l => l.Texte("PRM_ID")!, l => (Code: l.Texte("PRM_Code"), Libelle: l.Texte("PRM_Libelle"), Type: l.Texte("PRM_TypeParam")), StringComparer.Ordinal);
        var facturesAvancement = new List<(LigneSource Entete, PieceSource Piece)>();
        var lignes = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM vte_doc_ligne WHERE VDL_IsDesactive = 0 ORDER BY VDL_VDE_ID, VDL_Ordre, VDL_ID", ct))
            .GroupBy(l => l.Texte("VDL_VDE_ID") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var volume = ctx.Rapport.Volume(Entete);

        foreach (var e in await SqlReprise.SourceAsync(ctx, """
            SELECT * FROM vte_doc_entete
            WHERE VDE_IsModele = 0 AND VDE_IsVirtuel = 0 AND VDE_IsSauvegarde = 0 AND VDE_IsProjetBudget = 0 AND VDE_IsDesactive = 0
            ORDER BY VDE_Chrono, VDE_Indice, VDE_DateDoc, VDE_ID
            """, ct))
        {
            var cle = e.Texte("VDE_ID")!;
            var emplacement = $"{Entete} {cle}";
            var codeType = e.Texte("VDE_Type_ID") is { } t ? parametres.GetValueOrDefault(t).Code : null;
            var type = ctx.Correspondre(TablesCorrespondance.TypeDocumentVente, codeType, emplacement);
            if (!retenue(e, "VDE_SCT_ID") || type is not { Ignorer: false, Cible: { } typeDocument })
            {
                volume.Lues++;
                volume.Ecartees++;
                continue;
            }
            var etat = e.Texte("VDE_Etat") is { } et ? parametres.GetValueOrDefault(et).Libelle : null;
            var comptable = e.Booleen("VDE_IsComptabilise") == true;
            var statut = comptable ? PiecesReprise.Statut.Envoye : PiecesReprise.StatutDe(etat);
            var chrono = e.Entier("VDE_Chrono");
            var proprietes = new Dictionary<string, string>();
            if (etablissement(e, "VDE_SCT_ID") is { } etab) proprietes[StructureReprise.ProprieteEtablissement] = etab;
            var p = new PieceSource
            {
                Origine = (Entete, cle), TypeDocument = typeDocument, Numero = e.Texte("VDE_Reference") ?? e.Texte("VDE_RefUnique") ?? cle,
                Date = SourcesRessources.Jour(e, "VDE_DateDoc") ?? DateOnly.FromDateTime(DateTime.Today),
                Objet = AnnuaireReprise.Couper(e.Texte("VDE_Libelle") ?? (e.Texte("VDE_LibelleRTF") is { } rtf ? Rtf.TexteDe(Rtf.HtmlDe(rtf)) : null), 250),
                TiersPerId = e.Texte("VDE_TRS_ID_Client") is { } trs and not "0" ? ctx.Registre.Trouver(RegistreOptim.Tiers, ctx.CleConservee(RegistreOptim.Tiers, trs)) : null,
                AffaireId = (int?)ctx.Registre.Trouver(StructureOptim.Affaire, e.Texte("VDE_AFF_ID")),
                ChantierId = (int?)ctx.Registre.Trouver(StructureOptim.Chantier, e.Texte("VDE_CHT_ID")),
                Statut = statut, Verrouille = comptable,
                GroupeCle = chrono is > 0 ? $"{Entete}|{codeType}|{chrono}" : null,
                NotreReference = e.Texte("VDE_NosRef"), ReferenceExterne = e.Texte("VDE_RefExt"),
                TexteFinHtml = e.Texte("VDE_Observation") is { } obs ? Rtf.HtmlDe(obs) : null,
                ModeReglement = ctx.Registre.TrouverCode(RegistreOptim.Mode, e.Texte("VDE_PRM_ModeRegl")),
                TotalHt = e.Decimal("VDE_MtHT"), TotalTtc = e.Decimal("VDE_MtTTC"), Proprietes = proprietes,
                Lignes = Lignes(ctx, lignes.GetValueOrDefault(cle) ?? [], typesLigne, emplacement),
            };
            // Factures de situation : reprises après les pièces, avec les situations et leur marché (lot 11).
            if (pieces.EstAvancement(typeDocument)) facturesAvancement.Add((e, p));
            else if (await pieces.EcrireAsync(p, ct) is { } ent && e.Booleen("VDE_IsMarche") == true && p.ChantierId is { } cha)
                await pieces.LierMarcheAsync(cha, ent, ct);
        }
        await AvancementAsync(ctx, pieces, facturesAvancement, parametres, ct);
        await pieces.TerminerAsync(ct);
    }

    private static List<LignePiece> Lignes(ContexteReprise ctx, List<LigneSource> source, Dictionary<string, short> typesLigne, string emplacement)
    {
        string Cle(LigneSource l) => l.Texte("VDL_ID")!;
        var res = new List<LignePiece>();
        var retenues = new Dictionary<string, (LignePiece Ligne, decimal? CoefVente)>(StringComparer.Ordinal);
        var ecartees = new HashSet<string>(StringComparer.Ordinal);
        var exclues = 0;
        var sautPage = typesLigne.GetValueOrDefault("SAUT_PAGE");
        foreach (var l in SourcesPieces.Arbre(source, Cle, l => l.Texte("VDL_VDL_ID"), l => l.Decimal("VDL_Ordre") ?? 0))
        {
            var cle = Cle(l);
            var parentCle = l.Texte("VDL_VDL_ID");
            if (parentCle is not null && ecartees.Contains(parentCle)) { ecartees.Add(cle); exclues++; continue; }
            var parent = parentCle is not null && retenues.TryGetValue(parentCle, out var pr) ? pr : default;
            // Frais indirects (globalisations) hors ouvrage : coût déjà réparti par PGU, branche non reprise.
            if (l.Booleen("VDL_IsFraisIndirect") == true && parent.Ligne?.Type != typesLigne.GetValueOrDefault("OUVRAGE") && parent.Ligne?.Composante != true)
            {
                ecartees.Add(cle);
                exclues++;
                continue;
            }
            if (l.Booleen("VDL_IsOption") == true) ctx.Rapport.Perdre("vte_doc_ligne", "VDL_IsOption", cle, "Option : reprise en ligne vendue");
            if (l.Booleen("VDL_IsSautPageAvant") == true && sautPage != 0)
                res.Add(new LignePiece { Cle = $"{cle}-saut", ParentCle = parent.Ligne?.Cle, Type = sautPage });
            var composante = l.Booleen("VDL_IsSousDetail") == true && parent.Ligne is not null;
            var code = l.Booleen("VDL_IsVideTexte") == true ? "TEXTE" : TypeOptim(l.Entier("VDL_TypeLigne"));
            if (code is null)
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ValeurInconnue, emplacement, $"Ligne {cle} : type {l.Texte("VDL_TypeLigne")} inconnu, reprise en texte");
            var type = typesLigne[code ?? "TEXTE"];
            var chiffree = code is "OUVRAGE" or "ELEMENT";
            var qte = l.Decimal("VDL_Qte") ?? 0;
            var absolue = composante && (l.Decimal("VDL_QteFixe") ?? 0) > 0 && parent.Ligne?.Qte is { } qp;
            if (absolue) qte = ArrondiCalcul.Arr6(qte * parent.Ligne!.Qte!.Value);
            var pctVte = l.Decimal("VDL_PctVte") ?? 0;
            var coefVente = composante ? parent.CoefVente : pctVte > -1 ? ArrondiCalcul.Arr6(1 + pctVte) : 1;
            decimal? pa = null;
            decimal coefFg = 1;
            if (code == "ELEMENT")
            {
                var pau = l.Decimal("VDL_PAU") ?? 0;
                var cout = (l.Decimal("VDL_PRU") ?? 0) + (l.Decimal("VDL_PGU") ?? 0);
                if (pau > 0) { pa = pau; coefFg = ArrondiCalcul.Arr6(cout / pau); }
                else pa = ArrondiCalcul.Arr6(cout);
            }
            var x = new LignePiece
            {
                Cle = cle, Reference = cle, ParentCle = parent.Ligne?.Cle, Type = type, Composante = composante, QteAbsolue = absolue, Code = l.Texte("VDL_Code"),
                LibelleHtml = Rtf.HtmlDe(l.Texte("VDL_LibelleRTF") ?? l.Texte("VDL_Libelle")), NonEditee = l.Booleen("VDL_IsNonEdite") == true,
                Qte = chiffree ? qte : null, PrecisionQte = SourcesPieces.Precision(qte),
                Unite = l.Texte("VDL_UNT_ID") is { } u and not "0" ? ctx.Registre.TrouverCode(RegistreOptim.Unite, u) : null,
                NatId = (int?)ctx.Registre.Trouver(RegistreOptim.Nature, l.Texte("VDL_FTY_ID")),
                TvaId = (int?)ctx.Registre.Trouver(RegistreOptim.Tva, l.Texte("VDL_PRM_TVA")),
                Pa = pa, CoefFg = coefFg, CoefBenef = coefVente ?? 1,
                PvUnitaire = l.Decimal("VDL_PVU") is { } pv and not 0 ? pv : null, PvFixe = l.Booleen("VDL_IsMtFixe") == true && !composante,
                MontantHt = l.Decimal("VDL_MtHT"),
            };
            res.Add(x);
            retenues[cle] = (x, chiffree ? coefVente : parent.CoefVente);
        }
        if (exclues > 0) ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.LigneNonReprise, emplacement, $"{exclues} ligne(s) de frais indirects (globalisations) non reprises : coût réparti dans les prix");
        return res;
    }
}
