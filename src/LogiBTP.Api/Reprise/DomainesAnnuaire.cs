using LogiBTP.Api.Reprise.Mde;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Domaine;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Annuaire MDE (plan reprise-mde-optim, lot 6, Q5) : chaque table de rôle (PMECLIENT, PMEFOURNISSEUR, PMESOUSTRAITANT,
/// PMEARCHITECTE, PMECHARGEAFFAIRE) jointe à COMM_TIERS par CODEGESTION + TYPETIERS ; toutes les adresses
/// (COMM_TIERSADR, principale = IDADRFACTURATION) et tous les contacts de chaque adresse (COMM_TIERSINTERLOC). Le
/// chargé d'affaires devient un individu de la société de la base. Fusion : table COMM_TIERS, clé COMM_TIERS.CODE.
/// </summary>
public sealed class AnnuaireMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Annuaire;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Champs];

    public const string TableFusion = "COMM_TIERS";

    private static readonly (string Table, string Requete)[] Roles =
    [
        ("PMECLIENT", """
            SELECT C.*, T.CODE AS T_CODE, T.COMPTE AS T_COMPTE, T.COMPTETIERS AS T_COMPTETIERS, T.NII AS T_NII, T.DEVISE AS T_DEVISE,
                   T.MODEREG AS T_MODEREG, T.EXCLURERELANCE AS T_EXCLURERELANCE, T.ENCOURSAUTORISE AS T_ENCOURS,
                   T.SITEINTERNET AS T_SITE, T.IDADRFACTURATION AS T_ADRFAC, T.IDADRLIVRAISON AS T_ADRLIV
            FROM PMECLIENT C LEFT JOIN COMM_TIERS T ON T.CODEGESTION = C.CODE AND T.TYPETIERS = C.TYPETIERS ORDER BY C.CODE
            """),
        ("PMEFOURNISSEUR", """
            SELECT C.*, T.CODE AS T_CODE, T.COMPTE AS T_COMPTE, T.COMPTETIERS AS T_COMPTETIERS, T.NII AS T_NII, T.DEVISE AS T_DEVISE,
                   T.MODEREG AS T_MODEREG, T.EXCLURERELANCE AS T_EXCLURERELANCE, T.ENCOURSAUTORISE AS T_ENCOURS,
                   T.SITEINTERNET AS T_SITE, T.IDADRFACTURATION AS T_ADRFAC, T.IDADRLIVRAISON AS T_ADRLIV
            FROM PMEFOURNISSEUR C LEFT JOIN COMM_TIERS T ON T.CODEGESTION = C.CODE AND T.TYPETIERS = C.TYPETIERS ORDER BY C.CODE
            """),
        ("PMESOUSTRAITANT", """
            SELECT C.*, T.CODE AS T_CODE, T.COMPTE AS T_COMPTE, T.COMPTETIERS AS T_COMPTETIERS, T.NII AS T_NII, T.DEVISE AS T_DEVISE,
                   T.MODEREG AS T_MODEREG, T.EXCLURERELANCE AS T_EXCLURERELANCE, T.ENCOURSAUTORISE AS T_ENCOURS,
                   T.SITEINTERNET AS T_SITE, T.IDADRFACTURATION AS T_ADRFAC, T.IDADRLIVRAISON AS T_ADRLIV
            FROM PMESOUSTRAITANT C LEFT JOIN COMM_TIERS T ON T.CODEGESTION = C.CODE AND T.TYPETIERS = C.TYPETIERS ORDER BY C.CODE
            """),
        ("PMEARCHITECTE", """
            SELECT C.*, T.CODE AS T_CODE, T.COMPTE AS T_COMPTE, T.COMPTETIERS AS T_COMPTETIERS, T.NII AS T_NII, T.DEVISE AS T_DEVISE,
                   T.MODEREG AS T_MODEREG, T.EXCLURERELANCE AS T_EXCLURERELANCE, T.ENCOURSAUTORISE AS T_ENCOURS,
                   T.SITEINTERNET AS T_SITE, T.IDADRFACTURATION AS T_ADRFAC, T.IDADRLIVRAISON AS T_ADRLIV
            FROM PMEARCHITECTE C LEFT JOIN COMM_TIERS T ON T.CODEGESTION = C.CODE AND T.TYPETIERS = C.TYPETIERS ORDER BY C.CODE
            """),
        ("PMECHARGEAFFAIRE", """
            SELECT C.*, T.CODE AS T_CODE, T.COMPTE AS T_COMPTE, T.COMPTETIERS AS T_COMPTETIERS, T.NII AS T_NII, T.DEVISE AS T_DEVISE,
                   T.MODEREG AS T_MODEREG, T.EXCLURERELANCE AS T_EXCLURERELANCE, T.ENCOURSAUTORISE AS T_ENCOURS,
                   T.SITEINTERNET AS T_SITE, T.IDADRFACTURATION AS T_ADRFAC, T.IDADRLIVRAISON AS T_ADRLIV
            FROM PMECHARGEAFFAIRE C LEFT JOIN COMM_TIERS T ON T.CODEGESTION = C.CODE AND T.TYPETIERS = C.TYPETIERS ORDER BY C.CODE
            """),
    ];

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var adresses = (await SqlReprise.SourceAsync(ctx,
                "SELECT IDENTIFIANT, CODE, NOM, CIVILITE, IDINTERLOC, ADR, CP, VILLE, PAYS FROM COMM_TIERSADR ORDER BY CODE, IDENTIFIANT", ct))
            .GroupBy(a => a.Texte("CODE") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var interlocs = (await SqlReprise.SourceAsync(ctx,
                "SELECT IDENTIFIANT, IDADR, NOM, TEL, FAX, PORTABLE, EMAIL, QUALIFICATION FROM COMM_TIERSINTERLOC ORDER BY IDADR, IDENTIFIANT", ct))
            .GroupBy(i => i.Texte("IDADR") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var activites = (await SqlReprise.SourceAsync(ctx, "SELECT CLE, LIBELLE FROM PMEACTIVITE", ct))
            .Where(a => a.Texte("CLE") is not null).ToDictionary(a => a.Texte("CLE")!, a => a.Texte("LIBELLE"), StringComparer.Ordinal);
        var societe = (await SqlReprise.LireAsync(ctx.Unite, "SELECT per_id FROM personne WHERE per_societe_base", r => r.GetInt64(0), ct)).FirstOrDefault();

        var tiers = new List<TiersSource>();
        foreach (var (table, requete) in Roles)
            foreach (var l in await SqlReprise.SourceAsync(ctx, requete, ct))
            {
                if (l.Texte("CODE") is not { } code) continue;
                var ou = $"{table} {code}";
                var role = ctx.Correspondre(TablesCorrespondance.TypeTiers, l.Texte("TYPETIERS") ?? "", ou);
                if (l.Texte("T_DEVISE") is { } devise && !devise.Equals("EUR", StringComparison.OrdinalIgnoreCase))
                    ctx.Rapport.Signaler(NiveauAnomalie.Bloquant, CodeAnomalie.DeviseEtrangere, ou, $"Tiers en devise {devise} : la reprise se fait en euros (Q10)");
                if (l.Texte("T_CODE") is null)
                    ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ValeurInconnue, ou, "Tiers sans fiche COMM_TIERS : repris sous son seul code");
                var adrs = l.Texte("T_CODE") is { } tc ? adresses.GetValueOrDefault(tc) ?? [] : [];
                var principale = adrs.FirstOrDefault(a => a.Texte("IDENTIFIANT") == l.Texte("T_ADRFAC")) ?? adrs.FirstOrDefault();
                var contacts = Contacts(ctx, adrs, interlocs, principale?.Texte("IDINTERLOC"));

                if (role is { Ignorer: false, Cible: TypesFiche.Individu })
                {
                    // Chargé d'affaires : individu de notre société (lien au salarié au lot 7).
                    if (societe != 0)
                        await TiersReprise.ContactAsync(ctx, societe, new ContactSource
                        {
                            Origine = (table, code), Nom = principale?.Texte("NOM") ?? code,
                            Civilite = principale?.Texte("CIVILITE") is { } civ ? ctx.Registre.TrouverCode(RegistreMde.Civilite, civ) : null,
                            Coordonnees = contacts.SelectMany(c => c.Coordonnees).ToList(),
                        }, ct);
                    else { var v = ctx.Rapport.Volume(table); v.Lues++; v.Ecartees++; }
                    continue;
                }
                if (role is not { Ignorer: false, Cible: { } casquette }) { ctx.Rapport.Volume(table).Ecartees++; continue; }

                var civilite = principale?.Texte("CIVILITE");
                var t = new TiersSource
                {
                    TableFusion = TableFusion, CleFusion = l.Texte("T_CODE") ?? $"{table}:{code}", Code = code,
                    RaisonSociale = principale?.Texte("NOM") ?? code,
                    Particulier = civilite is not null && ctx.Registre.TrouverCode(RegistreMde.Civilite, civilite) is not null,
                    FormeLibelle = civilite is not null ? ctx.Registre.TrouverCode(RegistreMde.FormeJuridique, civilite) : null,
                    Siret = l.Contient("SIRET") ? Siret(ctx, l.Texte("SIRET"), ou) : null,
                    TvaIntra = l.Texte("T_NII"),
                    NePasRelancer = l.Booleen("T_EXCLURERELANCE") == true,
                    Commentaire = l.Contient("NOTE") ? l.Texte("NOTE") : null,
                    CliCategorie = l.Contient("CLEACTIVITE") && l.Texte("CLEACTIVITE") is { } act ? activites.GetValueOrDefault(act) : null,
                    Pays = Pays(ctx, principale?.Texte("PAYS"), ou) ?? "FR",
                };
                t.Origines.Add((table, code));
                if (l.Texte("T_CODE") is { } tcode) t.Origines.Add((TableFusion, tcode));
                t.Casquettes.Add(casquette);
                var condition = ctx.Registre.TrouverCode(RegistreMde.Condition, l.Texte("T_MODEREG"));
                var mode = ctx.Registre.TrouverCode(RegistreMde.ModeCondition, l.Texte("T_MODEREG"));
                switch (casquette)
                {
                    case "CLIENT":
                        (t.CliCompte, t.CliCollectif, t.CliMode, t.CliDelai) = (l.Texte("T_COMPTETIERS"), l.Texte("T_COMPTE"), mode, condition);
                        t.EncoursMax = l.Decimal("T_ENCOURS") is > 0 and var e ? e : null;
                        break;
                    case "SOUS_TRAITANT":
                        (t.StCompte, t.StCollectif, t.FouMode, t.FouDelai) = (l.Texte("T_COMPTETIERS"), l.Texte("T_COMPTE"), mode, condition);
                        break;
                    case "FOURNISSEUR":
                        (t.FouCompte, t.FouCollectif, t.FouMode, t.FouDelai) = (l.Texte("T_COMPTETIERS"), l.Texte("T_COMPTE"), mode, condition);
                        break;
                }
                foreach (var a in adrs)
                {
                    var id = a.Texte("IDENTIFIANT");
                    var (l1, l2, l3) = AnnuaireReprise.Lignes(a.Texte("ADR"));
                    var usage = id == principale?.Texte("IDENTIFIANT") ? AnnuaireReprise.Usage.Facturation
                        : id == l.Texte("T_ADRLIV") ? AnnuaireReprise.Usage.Livraison : AnnuaireReprise.Usage.Autre;
                    t.Coordonnees.Add(new CoordonneeReprise(AnnuaireReprise.Nature.Adresse, usage, a == principale)
                    {
                        Ligne1 = l1, Ligne2 = l2, Ligne3 = l3, CodePostal = a.Texte("CP"), Ville = a.Texte("VILLE"),
                        Pays = Pays(ctx, a.Texte("PAYS"), $"COMM_TIERSADR {id}"),
                        Libelle = a == principale ? null : a.Texte("NOM"),
                    });
                }
                t.Coordonnees.Add(new CoordonneeReprise(AnnuaireReprise.Nature.Web, AnnuaireReprise.Usage.Site, true) { Valeur = l.Texte("T_SITE") });
                t.Contacts.AddRange(contacts);
                if (l.Contient("TPAYEURCODE") && l.Texte("TPAYEURCODE") is { } payeur
                    && ctx.Correspondre(TablesCorrespondance.TiersPayeur, l.Texte("TPAYEURTYPE") ?? "", ou) is { Ignorer: false, Cible: { } lien } e2)
                    t.Payeurs.Add((("PMECLIENT", payeur), lien, e2.Note));
                tiers.Add(t);
            }
        await TiersReprise.EcrireAsync(ctx, tiers, ct);
    }

    /// <summary>Contacts de toutes les adresses d'un tiers ; principal : le contact de l'adresse principale.</summary>
    private static List<ContactSource> Contacts(ContexteReprise ctx, List<LigneSource> adresses, Dictionary<string, List<LigneSource>> interlocs, string? principal) =>
        adresses.SelectMany(a => interlocs.GetValueOrDefault(a.Texte("IDENTIFIANT") ?? "") ?? []).Select(i => new ContactSource
        {
            Origine = ("COMM_TIERSINTERLOC", i.Texte("IDENTIFIANT")!), Nom = i.Texte("NOM") ?? "?", Fonction = i.Texte("QUALIFICATION"),
            Principal = i.Texte("IDENTIFIANT") == principal,
            Coordonnees =
            [
                new(AnnuaireReprise.Nature.Telephone, AnnuaireReprise.Usage.Fixe, true) { Valeur = i.Texte("TEL") },
                new(AnnuaireReprise.Nature.Telephone, AnnuaireReprise.Usage.Portable, false) { Valeur = i.Texte("PORTABLE") },
                new(AnnuaireReprise.Nature.Telephone, AnnuaireReprise.Usage.Fax, false) { Valeur = i.Texte("FAX") },
                new(AnnuaireReprise.Nature.Email, AnnuaireReprise.Usage.Pro, true) { Valeur = i.Texte("EMAIL") },
            ],
        }).ToList();

    private static string? Pays(ContexteReprise ctx, string? valeur, string ou) =>
        valeur is null ? null : ctx.Registre.TrouverCode(RegistreMde.Pays, valeur) ?? ReferentielsCible.Pays(ctx, valeur, ou);

    /// <summary>SIRET nettoyé (chiffres seuls, 14) ; autre longueur : écarté et signalé.</summary>
    internal static string? Siret(ContexteReprise ctx, string? valeur, string ou)
    {
        if (valeur is null) return null;
        var s = new string(valeur.Where(char.IsAsciiDigit).ToArray());
        if (s.Length == 14) return s;
        ctx.Rapport.Perdre(ou.Split(' ')[0], "SIRET", valeur, "SIRET de longueur différente de 14");
        return null;
    }
}

/// <summary>
/// Annuaire OPTIM (lot 6) : <c>bib_tiers</c> (fiches de tiers seulement : les fiches des sociétés sont reprises au lot 4),
/// casquettes par <c>bib_tiers_categ</c> → <c>ref_categ</c> (table « categorie_tiers »), adresses <c>z_adresse</c> (TRS),
/// contacts <c>bib_personne</c>, payeurs (compte de facturation, de paiement), RIB. Fusion : table bib_tiers, clé TRS_ID.
/// </summary>
public sealed class AnnuaireOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Annuaire;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Champs];

    private const string RequeteTiers = """
        SELECT TRS_ID, TRS_Code, TRS_RaisonSociale, TRS_NomReduit, TRS_IsParticulier, TRS_Siret, TRS_CompteTiers, TRS_IsDesactive,
               TRS_EncoursMax, TRS_EmailAchat, TRS_EmailVente, TRS_Observation, TRS_ObsReglement, TRS_TvaIntra, TRS_ModeReglement,
               TRS_ModeReglementVte, TRS_TRS_ID_CompteFact, TRS_TRS_ID_ComptePaie, TRS_NumCpteBq, TRS_NumCpteBic
        FROM bib_tiers WHERE TRS_IsTiers = 1 ORDER BY TRS_ID
        """;

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var regles = ctx.Correspondances.Tables[TablesCorrespondance.CategorieTiers].Entrees;
        var categories = (await SqlReprise.SourceAsync(ctx,
                "SELECT tc.TRC_TRS_ID, c.* FROM bib_tiers_categ tc JOIN ref_categ c ON c.CAT_ID = tc.TRC_CAT_ID ORDER BY tc.TRC_ID", ct))
            .GroupBy(c => c.Texte("TRC_TRS_ID") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var adresses = (await SqlReprise.SourceAsync(ctx, """
                SELECT ADR_Id, ADR_Entite_Id, ADR_Libelle, ADR_Ligne1, ADR_Ligne2, ADR_CP, ADR_Ville, ADR_Pays, ADR_NumTel1, ADR_NumPort, ADR_Email
                FROM z_adresse WHERE ADR_TypeEntite = 'TRS' AND ADR_IsDesactive = 0 ORDER BY ADR_Id
                """, ct))
            .GroupBy(a => a.Texte("ADR_Entite_Id") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var personnes = (await SqlReprise.SourceAsync(ctx, """
                SELECT PRS_ID, PRS_TRS_ID, PRS_Nom, PRS_Prenom, PRS_Civilite, PRS_LibFct, PRS_IsPrincipal, PRS_IsDesactive,
                       PRS_NumTel, PRS_NumPort, PRS_Email
                FROM bib_personne ORDER BY PRS_ID
                """, ct))
            .GroupBy(p => p.Texte("PRS_TRS_ID") ?? "").ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

        var tiers = new List<TiersSource>();
        foreach (var l in await SqlReprise.SourceAsync(ctx, RequeteTiers, ct))
        {
            var id = l.Texte("TRS_ID")!;
            if (ctx.Registre.Trouver(RegistreOptim.Tiers, id) is not null) continue; // fiche d'une société reprise (lot 4)
            var ou = $"bib_tiers {id}";
            var t = new TiersSource
            {
                TableFusion = RegistreOptim.Tiers, CleFusion = id, Code = l.Texte("TRS_Code"),
                RaisonSociale = l.Texte("TRS_RaisonSociale") ?? l.Texte("TRS_NomReduit") ?? id,
                Particulier = l.Booleen("TRS_IsParticulier") == true, Siret = AnnuaireMde.Siret(ctx, l.Texte("TRS_Siret"), ou),
                TvaIntra = l.Texte("TRS_TvaIntra"), Actif = l.Booleen("TRS_IsDesactive") != true,
                EncoursMax = l.Decimal("TRS_EncoursMax") is > 0 and var e ? e : null,
                Commentaire = string.Join("\n", new[] { l.Texte("TRS_Observation"), l.Texte("TRS_ObsReglement") }.OfType<string>()) is { Length: > 0 } n ? n : null,
                Iban = l.Texte("TRS_NumCpteBq"), Bic = l.Texte("TRS_NumCpteBic"),
                CliMode = ctx.Registre.TrouverCode(RegistreOptim.Mode, l.Texte("TRS_ModeReglementVte")),
                FouMode = ctx.Registre.TrouverCode(RegistreOptim.Mode, l.Texte("TRS_ModeReglement")),
            };
            t.Origines.Add((RegistreOptim.Tiers, id));
            foreach (var c in categories.GetValueOrDefault(id) ?? [])
                foreach (var r in regles.Where(r => c.Contient(r.Source) && c.Booleen(r.Source) == true))
                {
                    ctx.Rapport.Appliquer(TablesCorrespondance.CategorieTiers, r.Source, r.Ignorer ? $"ignoré : {r.Motif}" : r.Cible!);
                    if (!r.Ignorer) t.Casquettes.Add(r.Cible!);
                }
            var compte = l.Texte("TRS_CompteTiers");
            if (t.Casquettes.Contains("CLIENT")) t.CliCompte = compte;
            if (t.Casquettes.Contains("SOUS_TRAITANT")) t.StCompte = compte;
            if (t.Casquettes.Overlaps(["FOURNISSEUR", "LOUEUR", "INTERIM"])) t.FouCompte = compte;

            var premiere = true;
            foreach (var a in adresses.GetValueOrDefault(id) ?? [])
            {
                var libelle = Associations.Normaliser(a.Texte("ADR_Libelle"));
                var usage = libelle.Contains("FACTUR", StringComparison.Ordinal) ? AnnuaireReprise.Usage.Facturation
                    : libelle.Contains("LIVR", StringComparison.Ordinal) ? AnnuaireReprise.Usage.Livraison
                    : premiere ? AnnuaireReprise.Usage.Principale : AnnuaireReprise.Usage.Autre;
                t.Coordonnees.Add(new CoordonneeReprise(AnnuaireReprise.Nature.Adresse, usage, premiere)
                {
                    Libelle = a.Texte("ADR_Libelle"), Ligne1 = a.Texte("ADR_Ligne1"), Ligne2 = a.Texte("ADR_Ligne2"),
                    CodePostal = a.Texte("ADR_CP"), Ville = a.Texte("ADR_Ville"),
                    Pays = ReferentielsCible.Pays(ctx, a.Texte("ADR_Pays"), $"z_adresse {a.Texte("ADR_Id")}"),
                });
                t.Coordonnees.Add(new CoordonneeReprise(AnnuaireReprise.Nature.Telephone, AnnuaireReprise.Usage.Standard, premiere) { Valeur = a.Texte("ADR_NumTel1") });
                t.Coordonnees.Add(new CoordonneeReprise(AnnuaireReprise.Nature.Telephone, AnnuaireReprise.Usage.Portable, false) { Valeur = a.Texte("ADR_NumPort") });
                t.Coordonnees.Add(new CoordonneeReprise(AnnuaireReprise.Nature.Email, AnnuaireReprise.Usage.Pro, premiere) { Valeur = a.Texte("ADR_Email") });
                if (premiere && a.Texte("ADR_Pays") is { } pays && ReferentielsCible.Pays(ctx, pays, ou) is { } iso) t.Pays = iso;
                premiere = false;
            }
            t.Coordonnees.Add(new CoordonneeReprise(AnnuaireReprise.Nature.Email, AnnuaireReprise.Usage.Facturation, false) { Valeur = l.Texte("TRS_EmailVente") });
            t.Coordonnees.Add(new CoordonneeReprise(AnnuaireReprise.Nature.Email, AnnuaireReprise.Usage.Commande, false) { Valeur = l.Texte("TRS_EmailAchat") });

            foreach (var p in personnes.GetValueOrDefault(id) ?? [])
                t.Contacts.Add(new ContactSource
                {
                    Origine = ("bib_personne", p.Texte("PRS_ID")!), Nom = p.Texte("PRS_Nom") ?? "?", Prenom = p.Texte("PRS_Prenom"),
                    Civilite = ctx.Registre.TrouverCode(RegistreOptim.Civilite, p.Texte("PRS_Civilite")),
                    Fonction = p.Texte("PRS_LibFct"), Principal = p.Booleen("PRS_IsPrincipal") == true, Actif = p.Booleen("PRS_IsDesactive") != true,
                    Coordonnees =
                    [
                        new(AnnuaireReprise.Nature.Telephone, AnnuaireReprise.Usage.Fixe, true) { Valeur = p.Texte("PRS_NumTel") },
                        new(AnnuaireReprise.Nature.Telephone, AnnuaireReprise.Usage.Portable, false) { Valeur = p.Texte("PRS_NumPort") },
                        new(AnnuaireReprise.Nature.Email, AnnuaireReprise.Usage.Pro, true) { Valeur = p.Texte("PRS_Email") },
                    ],
                });
            foreach (var payeur in new[] { l.Id("TRS_TRS_ID_CompteFact"), l.Id("TRS_TRS_ID_ComptePaie") }.OfType<long>().Distinct())
                t.Payeurs.Add(((RegistreOptim.Tiers, payeur.ToString(System.Globalization.CultureInfo.InvariantCulture)), TiersReprise.TypeLienFacturerA, null));
            tiers.Add(t);
        }
        await TiersReprise.EcrireAsync(ctx, tiers, ct);
    }
}
