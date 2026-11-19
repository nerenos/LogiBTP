using LogiBTP.Api.Reprise.Mde;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Avancement MDE (plan reprise-mde-optim, lot 11) : situations de travaux PMEDOCSITTX (cumul, eTypeAvancement D par
/// ligne, C et S global) et factures d'avancement PMEDOCFACCLI de type T (période), dans l'ordre des dates pour que chaque
/// facture parte du cumul de la précédente. Lignes du marché citées par CLEDEVBASE (lignes du devis reprises au lot 10),
/// marché d'un avancement global : devis initial du chantier (PMECHANTIER.CLEDOCINIT). Facture liée à sa situation
/// (CODESITTX) : cumul de la situation ; sans situation : montants de ses lignes en période.
/// </summary>
public sealed partial class PiecesVenteMde
{
    public const string Situation = "PMEDOCSITTX";
    /// <summary>eTypeAvancement : D détaillé par ligne, C global en cumul, S global par situation.</summary>
    private const string AvancementDetaille = "D";

    /// <summary>Pièces de facturation d'un chantier MDE : devis et avenants retenus pour le marché (base = NUMORDRE le plus petit).</summary>
    public const string MarcheBase = "PMEAFFBASEDOC";

    /// <summary>
    /// Marchés MDE (19/11/2026) : MDE n'a pas de marché mais garde les devis et avenants servant à la facturation dans
    /// PMEAFFBASEDOC / PMEAFFBASEDOCLIG, reliés au chantier par CODECHT ; NUMORDRE donne l'ordre, le premier est le marché.
    /// Chacun est repris en commande validée (verrouillée) inscrite au marché de vente du chantier : base puis avenants.
    /// Rend, par code de chantier, les clés (CLEDOC) des pièces reprises dans l'ordre.
    /// </summary>
    private static async Task<Dictionary<string, List<string>>> MarchesAsync(ContexteReprise ctx, PiecesReprise pieces, Dictionary<string, Etat> etats,
        Dictionary<string, short> typesLigne, CancellationToken ct)
    {
        var res = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var volume = ctx.Rapport.Volume(MarcheBase);
        if (ctx.Correspondre(TablesCorrespondance.TypeDocument, "CC", MarcheBase) is not { Ignorer: false, Cible: { } typeCommande }) return res;
        var lignes = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMEAFFBASEDOCLIG ORDER BY CLEDOC, NUMORDRE", ct))
            .GroupBy(l => l.Texte("CLEDOC") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        // PMEAFFBASEDOC n'a ni affaire ni lettres : affaire du chantier, textes vides (colonnes attendues par Entete).
        var bases = await SqlReprise.SourceAsync(ctx, """
            SELECT B.*, C.CODEAFFAIRE AS CODEAFFAIRE, CAST(NULL AS varchar(1)) AS LETTREENTETE, CAST(NULL AS varchar(1)) AS LETTREPIED
            FROM PMEAFFBASEDOC B LEFT JOIN PMECHANTIER C ON C.CODE = B.CODECHT
            ORDER BY B.CODECHT, B.NUMORDRE, B.CLEDOC
            """, ct);
        foreach (var e in bases)
        {
            var cle = e.Texte("CLEDOC")!;
            var emplacement = $"{MarcheBase} {cle}";
            if (e.Texte("CODECHT") is not { } cht || ctx.Registre.Trouver(StructureMde.Chantier, cht) is not { } chaId)
            {
                volume.Lues++;
                volume.Ecartees++;
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.AvancementSansMarche, emplacement, "Pièce de marché sans chantier repris : écartée");
                continue;
            }
            var p = Entete(ctx, e, MarcheBase, typeCommande, etats) with
            {
                Statut = PiecesReprise.Statut.Valide, Verrouille = true,
                Lignes = Lignes(ctx, lignes.GetValueOrDefault(cle) ?? [], e.Texte("CODECATEGORIE"), typesLigne, emplacement),
            };
            await pieces.EcrireAsync(p, ct);
            if (ctx.Registre.Trouver(MarcheBase, cle) is not { } ent) continue;
            if (!await pieces.InscrireMarcheAsync((int)chaId, ent, ct))
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.AvancementSansMarche, emplacement, $"Chantier {cht} sans marché de vente : commande reprise hors marché");
            (res.TryGetValue(cht, out var liste) ? liste : res[cht] = []).Add(cle);
        }
        return res;
    }

    private static async Task AvancementAsync(ContexteReprise ctx, PiecesReprise pieces, Dictionary<string, Etat> etats,
        List<(LigneSource Entete, string TypeDocument, List<LigneSource> Lignes)> factures, Dictionary<string, string> devisInitiaux,
        Dictionary<string, List<string>> marches, CancellationToken ct)
    {
        // Marché d'un chantier : base de PMEAFFBASEDOC et ses avenants, sinon devis initial (avancement global seulement).
        (string Table, string Cle)? Marche(string? cht, bool global) =>
            cht is not null && marches.TryGetValue(cht, out var m) ? (MarcheBase, m[0])
            : global && cht is not null && devisInitiaux.TryGetValue(cht, out var di) ? (Devis, di) : null;
        List<(string, string)> Avenants(string? cht) =>
            cht is not null && marches.TryGetValue(cht, out var m) ? m.Skip(1).Select(c => (MarcheBase, c)).ToList() : [];
        string TableLignes(string? cht) => cht is not null && marches.ContainsKey(cht) ? MarcheBase : Devis;

        var lignes = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMEDOCSITTXLIG ORDER BY CLEDOC, NUMORDRE", ct))
            .GroupBy(l => l.Texte("CLEDOC") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var situations = await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMEDOCSITTX ORDER BY DATEDOC, NUMERO, CLEDOC", ct);
        var parCode = situations.Where(s => s.Texte("CODE") is not null).ToDictionary(s => s.Texte("CODE")!, StringComparer.Ordinal);
        var facturees = factures.Select(f => f.Entete.Texte("CODESITTX")).Concat(situations.Select(s => s.Texte("CODEFACAVT") is not null ? s.Texte("CODE") : null))
            .OfType<string>().ToHashSet(StringComparer.Ordinal);

        AvancementSource Avancement(LigneSource sit, (string, string)? situationFacturee)
        {
            var global = sit.Texte("TYPEAVT") is { } t && t != AvancementDetaille;
            var categorie = sit.Texte("CODECATEGORIE");
            return new AvancementSource
            {
                TableLignes = TableLignes(sit.Texte("CODECHT")), TableLignesRepli = Devis, Situation = situationFacturee,
                Marche = Marche(sit.Texte("CODECHT"), global), Avenants = Avenants(sit.Texte("CODECHT")),
                PctGlobal = global ? sit.Decimal("PCAVTCUMUL") ?? 0 : null,
                Lignes = global ? [] : (lignes.GetValueOrDefault(sit.Texte("CLEDOC")!) ?? [])
                    .Where(l => (l.Entier("NIVCOMPO") ?? 0) == 0)
                    .Select(l => new LigneAvancement
                    {
                        LigneMarche = l.Texte("CLEDEVBASE"), MontantCumul = l.Decimal("MTSITUATION") ?? 0, PctCumul = l.Decimal("PCAVT"),
                        LibelleHtml = Rtf.HtmlDe(l.Texte("LIBELLECOM") ?? l.Texte("LIBELLE")),
                        TvaId = (int?)ctx.Registre.Trouver(RegistreMde.Tva, RegistreMde.CleTva(categorie, l.Texte("CODETVA"))),
                    }).ToList(),
            };
        }

        // Situations puis factures du même jour : la facture se lie à sa situation déjà reprise.
        var ordre = situations.Select(s => (Date: SourcesRessources.Jour(s, "DATEDOC") ?? DateOnly.MinValue, Rang: 0, Situation: (LigneSource?)s, Facture: default((LigneSource, string, List<LigneSource>)?)))
            .Concat(factures.Select(f => (Date: SourcesRessources.Jour(f.Entete, "DATEDOC") ?? DateOnly.MinValue, Rang: 1, Situation: (LigneSource?)null, Facture: ((LigneSource, string, List<LigneSource>)?)f)))
            .OrderBy(x => x.Date).ThenBy(x => x.Rang).ToList();
        foreach (var x in ordre)
        {
            if (x.Situation is { } s)
            {
                var emplacement = $"{Situation} {s.Texte("CLEDOC")}";
                if (ctx.Correspondre(TablesCorrespondance.TypeDocument, "ST", emplacement) is not { Ignorer: false, Cible: { } typeSituation })
                {
                    var v = ctx.Rapport.Volume(Situation);
                    v.Lues++;
                    v.Ecartees++;
                    continue;
                }
                var p = Entete(ctx, s, Situation, typeSituation, etats);
                await pieces.EcrireAsync(p with
                {
                    Objet = AnnuaireReprise.Couper(s.Texte("LIBELLESIT") ?? p.Objet, 250),
                    Statut = s.Texte("CODE") is { } code && facturees.Contains(code) ? PiecesReprise.Statut.Facture : p.Statut,
                    TotalHt = s.Decimal("MTHTCUMUL"), TotalTtc = p.TotalTtc is null ? null : s.Decimal("MTTTCCUMUL"),
                    Avancement = Avancement(s, null),
                }, ct);
            }
            else if (x.Facture is var (e, typeDocument, lignesFacture))
            {
                var p = Entete(ctx, e, Facture, typeDocument, etats);
                var categorie = e.Texte("CODECATEGORIE");
                var avancement = e.Texte("CODESITTX") is { } cs && parCode.TryGetValue(cs, out var sit)
                    ? Avancement(sit, (Situation, sit.Texte("CLEDOC")!))
                    : new AvancementSource
                    {
                        TableLignes = TableLignes(e.Texte("CODECHT")), TableLignesRepli = Devis,
                        Marche = Marche(e.Texte("CODECHT"), false), Avenants = Avenants(e.Texte("CODECHT")),
                        Lignes = lignesFacture.Where(l => (l.Entier("NIVCOMPO") ?? 0) == 0).Select(l => new LigneAvancement
                        {
                            LigneMarche = l.Texte("CLEDEVBASE"), MontantPeriode = l.Decimal("MONTANTHT") ?? 0,
                            LibelleHtml = Rtf.HtmlDe(l.Texte("LIBELLECOM") ?? l.Texte("LIBELLE")),
                            TvaId = (int?)ctx.Registre.Trouver(RegistreMde.Tva, RegistreMde.CleTva(categorie, l.Texte("CODETVA"))),
                        }).ToList(),
                    };
                await pieces.EcrireAsync(p with { Avancement = avancement }, ct);
            }
        }
    }
}

/// <summary>
/// Avancement OPTIM (lot 11) : vte_situation (cumul, VSL_MtHT par ligne du marché VSL_VDL_ID, sinon % global VSI_Pct_Avct)
/// en situations, pièces « SIT » de vte_doc_entete (VDE_VSI_ID) en factures d'avancement de la période, liées à leur
/// situation ; marché VSI_VDE_ID_Marche (devis repris au lot 10) ; situations désactivées ou de sauvegarde écartées, et
/// celles dont le marché n'est pas repris (société écartée).
/// </summary>
public sealed partial class PiecesVenteOptim
{
    public const string Situation = "vte_situation";
    /// <summary>Code de la table « type_document_vente » pour les situations vte_situation (propre à la reprise).</summary>
    public const string CodeSituation = "VSI";

    private static async Task AvancementAsync(ContexteReprise ctx, PiecesReprise pieces, List<(LigneSource Entete, PieceSource Piece)> factures,
        IReadOnlyDictionary<string, (string? Code, string? Libelle, string? Type)> parametres, CancellationToken ct)
    {
        var lignes = (await SqlReprise.SourceAsync(ctx, "SELECT * FROM vte_situation_ligne WHERE VSL_IsDesactive = 0 ORDER BY VSL_VSI_ID, VSL_ID", ct))
            .GroupBy(l => l.Texte("VSL_VSI_ID") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var marches = (await SqlReprise.SourceAsync(ctx, "SELECT VDE_ID, VDE_TRS_ID_Client, VDE_AFF_ID, VDE_CHT_ID, VDE_SCT_ID FROM vte_doc_entete", ct))
            .ToDictionary(l => l.Texte("VDE_ID")!, StringComparer.Ordinal);
        var situations = await SqlReprise.SourceAsync(ctx, "SELECT * FROM vte_situation ORDER BY VSI_Date, VSI_Numero, VSI_ID", ct);
        var parId = situations.ToDictionary(s => s.Texte("VSI_ID")!, StringComparer.Ordinal);
        var facturees = factures.Select(f => f.Entete.Texte("VDE_VSI_ID")).OfType<string>().Where(x => x != "0").ToHashSet(StringComparer.Ordinal);

        AvancementSource Avancement(LigneSource sit, (string, string)? situationFacturee)
        {
            var detail = lignes.GetValueOrDefault(sit.Texte("VSI_ID")!) ?? [];
            return new AvancementSource
            {
                TableLignes = Entete, Situation = situationFacturee,
                Marche = sit.Texte("VSI_VDE_ID_Marche") is { } m and not "0" ? (Entete, m) : null,
                PctGlobal = detail.Count == 0 ? sit.Decimal("VSI_Pct_Avct") ?? 0 : null,
                Lignes = detail.Select(l => new LigneAvancement
                {
                    LigneMarche = l.Texte("VSL_VDL_ID"), MontantCumul = l.Decimal("VSL_MtHT") ?? 0, PctCumul = l.Decimal("VSL_Pct_Avct"),
                    LibelleHtml = Rtf.HtmlDe(l.Texte("VSL_LibelleCompRTF") ?? l.Texte("VSL_LibelleComp")),
                    TvaId = (int?)ctx.Registre.Trouver(RegistreOptim.Tva, l.Texte("VSL_PRM_TVA")),
                }).ToList(),
            };
        }

        var ordre = situations.Select(s => (Date: SourcesRessources.Jour(s, "VSI_Date") ?? DateOnly.MinValue, Rang: 0, Situation: (LigneSource?)s, Facture: default((LigneSource, PieceSource)?)))
            .Concat(factures.Select(f => (Date: f.Piece.Date, Rang: 1, Situation: (LigneSource?)null, Facture: ((LigneSource, PieceSource)?)f)))
            .OrderBy(x => x.Date).ThenBy(x => x.Rang).ToList();
        foreach (var x in ordre)
        {
            if (x.Situation is { } s)
            {
                var cle = s.Texte("VSI_ID")!;
                var marche = s.Texte("VSI_VDE_ID_Marche") is { } m ? marches.GetValueOrDefault(m) : null;
                var type = ctx.Correspondre(TablesCorrespondance.TypeDocumentVente, CodeSituation, $"{Situation} {cle}");
                if (s.Booleen("VSI_IsDesactive") == true || s.Booleen("VSI_IsBkp") == true || type is not { Ignorer: false, Cible: { } typeSituation }
                    || marche is null || ctx.Registre.Trouver(Entete, marche.Texte("VDE_ID")) is null)
                {
                    var v = ctx.Rapport.Volume(Situation);
                    v.Lues++;
                    v.Ecartees++;
                    continue;
                }
                var etat = s.Texte("VSI_Etat") is { } et ? parametres.GetValueOrDefault(et).Libelle : null;
                await pieces.EcrireAsync(new PieceSource
                {
                    Origine = (Situation, cle), TypeDocument = typeSituation,
                    Numero = s.Texte("VSI_Reference") ?? $"S{cle}", Date = x.Date,
                    Objet = AnnuaireReprise.Couper(s.Texte("VSI_Libelle") ?? (s.Texte("VSI_LibelleRTF") is { } rtf ? Rtf.TexteDe(Rtf.HtmlDe(rtf)) : null), 250),
                    TiersPerId = marche.Texte("VDE_TRS_ID_Client") is { } trs and not "0" ? ctx.Registre.Trouver(RegistreOptim.Tiers, ctx.CleConservee(RegistreOptim.Tiers, trs)) : null,
                    AffaireId = (int?)ctx.Registre.Trouver(StructureOptim.Affaire, marche.Texte("VDE_AFF_ID")),
                    ChantierId = (int?)ctx.Registre.Trouver(StructureOptim.Chantier, marche.Texte("VDE_CHT_ID")),
                    Statut = facturees.Contains(cle) ? PiecesReprise.Statut.Facture : PiecesReprise.StatutDe(etat),
                    TexteFinHtml = s.Texte("VSI_Observation") is { } obs ? Rtf.HtmlDe(obs) : null,
                    TotalHt = s.Decimal("VSI_MtHT"), TotalTtc = s.Decimal("VSI_MtTTC"),
                    Avancement = Avancement(s, null),
                }, ct);
            }
            else if (x.Facture is var (e, p))
            {
                // Facture de situation sans situation : reprise avec ses propres lignes, sans suivi d'avancement.
                if (e.Texte("VDE_VSI_ID") is { } vsi && parId.TryGetValue(vsi, out var sit))
                    await pieces.EcrireAsync(p with { Avancement = Avancement(sit, (Situation, vsi)) }, ct);
                else
                {
                    ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.AvancementSansMarche, $"{p.Origine.Table} {p.Origine.Cle}",
                        "Facture de situation sans situation : reprise avec ses lignes, sans suivi d'avancement");
                    await pieces.EcrireAsync(p, ct);
                }
            }
        }
    }
}
