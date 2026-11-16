using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Structure MDE (plan reprise-mde-optim, lot 9) : affaires (PMEAFFAIRE, état PMEETATAFFAIRE : non modifiable ou date de
/// clôture → close), chantiers (PMECHANTIER, état PMEETATCHANTIER : terminé, non modifiable → clos), marché de vente
/// d'un chantier qui porte un montant ou une signature (type PMETYPEMARCHE : public si son libellé le dit),
/// intervenants cités par colonne (table « fonction_intervenant »). MDE n'a ni projets ni révision de prix.
/// </summary>
public sealed class StructureMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Structure;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Annuaire, DomainesReprise.Codes.Ressources];

    public const string Affaire = "PMEAFFAIRE";
    public const string Chantier = "PMECHANTIER";

    /// <summary>Table source des fiches citées par une colonne de code d'une affaire ou d'un chantier.</summary>
    private static readonly IReadOnlyDictionary<string, string> TiersCites = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["CODEARCHI"] = "PMEARCHITECTE",
        ["CODECHARGEAFF"] = RessourcesMde.ChargeAffaires,
    };

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var s = await StructureReprise.LireAsync(ctx, ct);
        var etatsAffaire = (await SqlReprise.SourceAsync(ctx, "SELECT CLE, NONMODIFIABLE FROM PMEETATAFFAIRE", ct))
            .ToDictionary(l => l.Texte("CLE")!, l => l.Booleen("NONMODIFIABLE") == true, StringComparer.Ordinal);
        var etatsChantier = (await SqlReprise.SourceAsync(ctx, "SELECT CLE, TERMINE, NONMODIFIABLE FROM PMEETATCHANTIER", ct))
            .ToDictionary(l => l.Texte("CLE")!, l => (Termine: l.Booleen("TERMINE") == true, Clos: l.Booleen("NONMODIFIABLE") == true), StringComparer.Ordinal);
        var publics = (await SqlReprise.SourceAsync(ctx, "SELECT CLE, LIBELLE FROM PMETYPEMARCHE", ct))
            .Where(l => Associations.Normaliser(l.Texte("LIBELLE")).Contains("PUBLIC", StringComparison.Ordinal)).Select(l => l.Texte("CLE")!)
            .ToHashSet(StringComparer.Ordinal);
        var fonctions = ctx.Correspondances.Tables[TablesCorrespondance.FonctionIntervenant].Entrees;

        async Task IntervenantsAsync(LigneSource l, ObjetStructure objet, long id, string emplacement)
        {
            foreach (var f in fonctions.Where(f => l.Contient(f.Source) && l.Texte(f.Source) is not null))
            {
                ctx.Rapport.Appliquer(TablesCorrespondance.FonctionIntervenant, f.Source, f.Ignorer ? $"ignoré : {f.Motif}" : f.Cible!);
                if (f.Ignorer || !TiersCites.TryGetValue(f.Source, out var table)) continue;
                var fiche = ctx.Registre.Trouver(table, l.Texte(f.Source));
                if (fiche is null)
                {
                    ctx.Rapport.Perdre(emplacement, f.Source, l.Texte(f.Source), "Fiche citée non reprise");
                    continue;
                }
                var individu = table == RessourcesMde.ChargeAffaires;
                await s.IntervenantAsync(objet, id, f.Cible!, individu ? null : fiche, individu ? fiche : null, false, ct);
            }
        }

        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMEAFFAIRE ORDER BY CODE", ct))
        {
            var cle = l.Texte("CODE")!;
            var cloture = SourcesRessources.Jour(l, "DATECLOTURE");
            var close = cloture is not null || l.Texte("CLEETAT") is { } e && etatsAffaire.GetValueOrDefault(e);
            var id = await s.AffaireAsync(new AffaireSource
            {
                Origine = (Affaire, cle), Code = cle, Libelle = l.Texte("LIBELLE") ?? cle,
                TiersPerId = ctx.Registre.Trouver("PMECLIENT", l.Texte("CODECLIENT")),
                Statut = close ? StructureReprise.StatutAffaire.Close : StructureReprise.StatutAffaire.Ouverte,
                Ouverture = SourcesRessources.Jour(l, "DATEAFFAIRE"), Cloture = cloture,
                ResponsableIndId = ctx.Registre.Trouver(RessourcesMde.ChargeAffaires, l.Texte("CODECHARGEAFF")),
                Commentaire = Joindre(l.Texte("DESCRIPTIF"), l.Texte("NOTE")),
            }, ct);
            await IntervenantsAsync(l, ObjetStructure.Affaire, id, $"{Affaire} {cle}");
        }

        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM PMECHANTIER ORDER BY CODE", ct))
        {
            var cle = l.Texte("CODE")!;
            var etat = l.Texte("CLEETAT") is { } e ? etatsChantier.GetValueOrDefault(e) : default;
            var fin = SourcesRessources.Jour(l, "DATEFIN");
            var aff = ctx.Registre.Trouver(Affaire, l.Texte("CODEAFFAIRE"));
            var client = ctx.Registre.Trouver("PMECLIENT", l.Texte("CODECLIENT"));
            var statut = StructureReprise.StatutChantierDe(etat.Termine, etat.Clos, fin);
            var id = await s.ChantierAsync(new ChantierSource
            {
                Origine = (Chantier, cle), Code = cle, Libelle = l.Texte("LIBELLE") ?? cle, AffId = aff, TiersPerId = client,
                Adresse = l.Texte("ADR"), CodePostal = l.Texte("CP"), Ville = l.Texte("VILLE"), Statut = statut,
                Ouverture = SourcesRessources.Jour(l, "DATEDEBUT") ?? SourcesRessources.Jour(l, "DATECREATION"),
                DebutPrevu = SourcesRessources.Jour(l, "DATEDEBUT"), FinPrevue = SourcesRessources.Jour(l, "DATEFINPREV"), FinReelle = fin,
                ConducteurIndId = await s.IndividuSalarieAsync(ctx.Registre.Trouver("PMESALARIE", l.Texte("CODESALRESP")), ct),
                ChargeIndId = ctx.Registre.Trouver(RessourcesMde.ChargeAffaires, l.Texte("CODECHARGEAFF")),
                Commentaire = Joindre(l.Texte("DESCRIPTIF"), l.Texte("NOTE")),
            }, ct);
            await IntervenantsAsync(l, ObjetStructure.Chantier, id, $"{Chantier} {cle}");

            var montant = l.Decimal("MTHTTOTALPREV") is > 0 and var total ? total : (l.Decimal("MTHTMARCHEPREV") ?? 0) + (l.Decimal("MTHTAVENANTPREV") ?? 0);
            var signature = SourcesRessources.Jour(l, "DATESIGNATURE");
            if (montant > 0 || signature is not null)
                await s.MarcheAsync(new MarcheSource
                {
                    Origine = ($"{Chantier}.MARCHE", cle), ChaId = id, ChaCode = cle, Libelle = l.Texte("LIBELLE") ?? cle, TiersPerId = client,
                    Public = l.Texte("CLETYPEMARCHE") is { } t && publics.Contains(t), MontantHt = montant, Date = signature,
                    Statut = statut == StructureReprise.StatutChantier.Clos ? StructureReprise.StatutMarche.Solde : StructureReprise.StatutMarche.EnCours,
                    Commentaire = l.Texte("ORIGINEMARCHE"),
                }, ct);
        }
    }

    internal static string? Joindre(params string?[] textes) =>
        string.Join("\n", textes.Where(t => !string.IsNullOrWhiteSpace(t))) is { Length: > 0 } j ? j : null;
}

/// <summary>
/// Structure OPTIM (lot 9) : projets (afc_dossier), affaires et chantiers des sociétés retenues (afc_affaire,
/// afc_chantier ; <c>CHT_IsChantier = 0</c> → chantier interne, Q14 ; états par le libellé de z_parametre), adresse du
/// chantier (z_adresse CHT), marché de vente d'un chantier qui porte un montant, intervenants (afc_affaire_tiers par la
/// table « fonction_intervenant », contacts afc_affaire_tiers_personne), indices, valeurs et formules de révision
/// (vte_indice, vte_indice_valeur, vte_revision_formule). Établissement d'origine en propriété (R1).
/// </summary>
public sealed class StructureOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Structure;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Annuaire, DomainesReprise.Codes.Ressources];

    public const string Projet = "afc_dossier";
    public const string Affaire = "afc_affaire";
    public const string Chantier = "afc_chantier";
    public const string Indice = "vte_indice";
    public const string Formule = "vte_revision_formule";

    /// <summary>
    /// Sociétés retenues : filtre d'une ligne par sa colonne de société, et établissement d'origine (raison sociale)
    /// quand ce n'est pas la société de la base (R1).
    /// </summary>
    internal static async Task<(Func<LigneSource, string, bool> Retenue, Func<LigneSource, string, string?> Etablissement)> EtablissementsAsync(
        ContexteReprise ctx, CancellationToken ct)
    {
        var societes = SocietesOptim.Ids(ctx).ToHashSet();
        var etablissements = new Dictionary<long, string?>();
        foreach (var sct in societes)
            etablissements[sct] = ctx.Registre.Trouver(RegistreOptim.Societe, sct.ToString(System.Globalization.CultureInfo.InvariantCulture)) is { } per
                ? (await SqlReprise.LireAsync(ctx.Unite, "SELECT per_raison_sociale FROM personne WHERE per_id = $1 AND NOT per_societe_base",
                    r => r.GetString(0), ct, per)).FirstOrDefault()
                : null;
        return ((l, colonne) => societes.Count == 0 || l.Entier(colonne) is { } v && societes.Contains(v),
            (l, colonne) => l.Entier(colonne) is { } v ? etablissements.GetValueOrDefault(v) : null);
    }

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var s = await StructureReprise.LireAsync(ctx, ct);
        var parametres = (await SqlReprise.SourceAsync(ctx, "SELECT PRM_ID, PRM_Libelle, PRM_Code FROM z_parametre", ct))
            .ToDictionary(l => l.Texte("PRM_ID")!, l => l.Texte("PRM_Libelle") ?? l.Texte("PRM_Code"), StringComparer.Ordinal);
        string? Etat(LigneSource l, string colonne) => l.Id(colonne) is { } id ? parametres.GetValueOrDefault(id.ToString(System.Globalization.CultureInfo.InvariantCulture)) : null;
        long? Tiers(string? trs) => trs is null or "0" ? null : ctx.Registre.Trouver(RegistreOptim.Tiers, ctx.CleConservee(RegistreOptim.Tiers, trs));
        async Task<long?> IndividuAsync(string? slr) => slr is null or "0" ? null : await s.IndividuSalarieAsync(ctx.Registre.Trouver("ref_salarie", slr), ct);

        var (Retenue, Etablissement) = await EtablissementsAsync(ctx, ct);

        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM afc_dossier WHERE DOS_IsDesactive = 0 ORDER BY DOS_ID", ct))
        {
            var id = await s.ProjetAsync(new ProjetSource
            {
                Origine = (Projet, l.Texte("DOS_ID")!), Libelle = l.Texte("DOS_Designation") ?? l.Texte("DOS_ID")!,
                TiersPerId = Tiers(l.Texte("DOS_TRS_ID_MOU")), ClientLibre = l.Texte("DOS_LibelleMOU"),
                Statut = StructureReprise.StatutProjetDe(Etat(l, "DOS_Etat")), DateRemise = SourcesRessources.Jour(l, "DOS_DateAO"),
                MontantEstime = l.Decimal("DOS_Cout"), Adresse = StructureMde.Joindre(l.Texte("DOS_Adr1MOU"), l.Texte("DOS_Adr2MOU")),
                CodePostal = l.Texte("DOS_CPMOU"), Ville = l.Texte("DOS_Commune") ?? l.Texte("DOS_VilleMOU"), Commentaire = l.Texte("DOS_Observation"),
            }, ct);
            await s.IntervenantAsync(ObjetStructure.Projet, id, "MOE", Tiers(l.Texte("DOS_TRS_ID_MOE")), null, false, ct);
        }

        var volumeAffaires = ctx.Rapport.Volume(Affaire);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM afc_affaire ORDER BY AFF_ID", ct))
        {
            if (!Retenue(l, "AFF_SCT_ID")) { volumeAffaires.Lues++; volumeAffaires.Ecartees++; continue; }
            var (termine, clos) = StructureReprise.EtatDe(Etat(l, "AFF_Etat"));
            var fin = SourcesRessources.Jour(l, "AFF_DateFinReel");
            await s.AffaireAsync(new AffaireSource
            {
                Origine = (Affaire, l.Texte("AFF_ID")!), Code = l.Texte("AFF_Code"), Libelle = l.Texte("AFF_Libelle") ?? l.Texte("AFF_Code") ?? l.Texte("AFF_ID")!,
                TiersPerId = Tiers(l.Texte("AFF_TRS_ID")),
                Statut = clos || termine || l.Booleen("AFF_IsDesactive") == true ? StructureReprise.StatutAffaire.Close : StructureReprise.StatutAffaire.Ouverte,
                Ouverture = SourcesRessources.Jour(l, "AFF_DateSignature") ?? SourcesRessources.Jour(l, "AFF_DateDebutReel") ?? SourcesRessources.Jour(l, "AFF_DateDebutPrev"),
                Cloture = fin, ResponsableIndId = await IndividuAsync(l.Texte("AFF_ChargeAff")),
                Commentaire = StructureMde.Joindre(l.Texte("AFF_Reference"), l.Texte("AFF_Commentaire")), Etablissement = Etablissement(l, "AFF_SCT_ID"),
            }, ct);
        }

        var adresses = (await SqlReprise.SourceAsync(ctx, """
                SELECT ADR_Entite_Id, ADR_Ligne1, ADR_Ligne2, ADR_CP, ADR_Ville FROM z_adresse WHERE ADR_TypeEntite = 'CHT' AND ADR_IsDesactive = 0 ORDER BY ADR_Id
                """, ct))
            .GroupBy(a => a.Texte("ADR_Entite_Id") ?? "").ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var publiques = (await SqlReprise.SourceAsync(ctx, "SELECT AFF_ID, AFF_IsPublic, AFF_DateSignature FROM afc_affaire", ct))
            .ToDictionary(l => l.Texte("AFF_ID")!, l => (Public: l.Booleen("AFF_IsPublic") == true, Signature: SourcesRessources.Jour(l, "AFF_DateSignature")),
                StringComparer.Ordinal);
        var volumeChantiers = ctx.Rapport.Volume(Chantier);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM afc_chantier ORDER BY CHT_ID", ct))
        {
            if (!Retenue(l, "CHT_SCT_ID")) { volumeChantiers.Lues++; volumeChantiers.Ecartees++; continue; }
            var cle = l.Texte("CHT_ID")!;
            var (termine, clos) = StructureReprise.EtatDe(Etat(l, "CHT_ETAT"));
            var fin = SourcesRessources.Jour(l, "CHT_DateFinReel");
            var statut = StructureReprise.StatutChantierDe(termine, clos || l.Booleen("CHT_IsDesactive") == true, fin);
            var adresse = adresses.GetValueOrDefault(cle);
            var client = Tiers(l.Texte("CHT_TRS_ID"));
            var affaire = l.Texte("CHT_AFF_ID");
            var id = await s.ChantierAsync(new ChantierSource
            {
                Origine = (Chantier, cle), Code = l.Texte("CHT_Code"), Libelle = l.Texte("CHT_Libelle") ?? l.Texte("CHT_Code") ?? cle,
                AffId = ctx.Registre.Trouver(Affaire, affaire), TiersPerId = client,
                Adresse = adresse is null ? null : StructureMde.Joindre(adresse.Texte("ADR_Ligne1"), adresse.Texte("ADR_Ligne2")),
                CodePostal = adresse?.Texte("ADR_CP"), Ville = adresse?.Texte("ADR_Ville"), Statut = statut,
                DebutPrevu = SourcesRessources.Jour(l, "CHT_DateDebPrev"), FinPrevue = SourcesRessources.Jour(l, "CHT_DateFinPrev"),
                DebutReel = SourcesRessources.Jour(l, "CHT_DateDebutReel"), FinReelle = fin,
                ConducteurIndId = await IndividuAsync(l.Texte("CHT_ConducTvx")), Commentaire = l.Texte("CHT_Observation"),
                Interne = l.Booleen("CHT_IsChantier") != true, CodeAnalytique = l.Texte("CHT_CodeAna"), Etablissement = Etablissement(l, "CHT_SCT_ID"),
            }, ct);
            if (l.Decimal("CHT_TotPVT_Marche") is > 0 and var montant && l.Booleen("CHT_IsChantier") == true)
            {
                var aff = affaire is null ? default : publiques.GetValueOrDefault(affaire);
                await s.MarcheAsync(new MarcheSource
                {
                    Origine = ($"{Chantier}.MARCHE", cle), ChaId = id, ChaCode = l.Texte("CHT_Code") ?? cle,
                    Libelle = l.Texte("CHT_LibelleEdition") ?? l.Texte("CHT_Libelle") ?? cle, TiersPerId = client, Public = aff.Public,
                    MontantHt = montant, Date = aff.Signature,
                    Statut = statut == StructureReprise.StatutChantier.Clos ? StructureReprise.StatutMarche.Solde : StructureReprise.StatutMarche.EnCours,
                }, ct);
            }
        }

        // Intervenants : tiers d'affaire (fonction par le premier indicateur vrai), sur le chantier s'il est cité ; contacts.
        var regles = ctx.Correspondances.Tables[TablesCorrespondance.FonctionIntervenant].Entrees;
        var fonctionsTiers = new Dictionary<string, (ObjetStructure Objet, long Id, string Fonction)>(StringComparer.Ordinal);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM afc_affaire_tiers ORDER BY AFT_ID", ct))
        {
            var cible = l.Id("AFT_CHT_ID") is { } cht && ctx.Registre.Trouver(Chantier, cht.ToString(System.Globalization.CultureInfo.InvariantCulture)) is { } cha
                ? (ObjetStructure.Chantier, cha) : ctx.Registre.Trouver(Affaire, l.Texte("AFT_AFF_ID")) is { } aff ? (ObjetStructure.Affaire, aff) : ((ObjetStructure, long)?)null;
            var regle = regles.FirstOrDefault(r => l.Contient(r.Source) && l.Booleen(r.Source) == true);
            var volume = ctx.Rapport.Volume("afc_affaire_tiers");
            volume.Lues++;
            if (cible is not { } c || regle is null || regle.Ignorer) { volume.Ecartees++; continue; }
            volume.Ecrites++;
            ctx.Rapport.Appliquer(TablesCorrespondance.FonctionIntervenant, regle.Source, regle.Cible!);
            fonctionsTiers[l.Texte("AFT_ID")!] = (c.Item1, c.Item2, regle.Cible!);
            await s.IntervenantAsync(c.Item1, c.Item2, regle.Cible!, Tiers(l.Texte("AFT_TRS_ID")), null, false, ct);
        }
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM afc_affaire_tiers_personne ORDER BY AFP_ID", ct))
            if (fonctionsTiers.TryGetValue(l.Texte("AFP_AFT_ID") ?? "", out var f) && ctx.Registre.Trouver("bib_personne", l.Texte("AFP_PRS_ID")) is { } ind)
                await s.IntervenantAsync(f.Objet, f.Id, f.Fonction, null, ind, l.Booleen("AFP_IsPrincipal") == true, ct);

        // Révision : indices rapprochés (BT01…), valeurs mensuelles, formules.
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM vte_indice ORDER BY VID_ID", ct))
            await s.IndiceAsync(Indice, l.Texte("VID_ID")!, l.Texte("VID_Reference"), l.Texte("VID_Description") ?? l.Texte("VID_ID")!,
                l.Booleen("VID_IsDesactive") != true, ct);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM vte_indice_valeur WHERE VIV_IsDesactive = 0 ORDER BY VIV_VID_ID, VIV_DateValeur", ct))
            if (ctx.Registre.Trouver(Indice, l.Texte("VIV_VID_ID")) is { } ipx && SourcesRessources.Jour(l, "VIV_DateValeur") is { } date)
                await s.ValeurIndiceAsync("vte_indice_valeur", (int)ipx, date, l.Decimal("VIV_Valeur") ?? 0, ct);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT * FROM vte_revision_formule ORDER BY VRF_ID", ct))
        {
            var termes = new List<(string, decimal)>();
            foreach (var n in new[] { "01", "02", "03", "04", "05" })
            {
                // La source nomme le 5e pourcentage VRG_Pct05 (coquille du schéma OPTIM).
                var poids = StructureReprise.Fraction(l.Decimal(l.Contient($"VRF_Pct{n}") ? $"VRF_Pct{n}" : $"VRG_Pct{n}"));
                if (poids > 0 && s.CodeIndice(ctx.Registre.Trouver(Indice, l.Texte($"VRF_VID_ID_{n}"))) is { } code) termes.Add((code, poids));
            }
            var cle = l.Texte("VRF_ID")!;
            await s.FormuleAsync(Formule, cle, l.Texte("VRF_Observation") ?? $"Formule {cle}", StructureReprise.Fraction(l.Decimal("VRF_PctFixe")), termes,
                (int)(l.Entier("VRF_NbDecimale") is > 0 and var d ? d : 3), l.Booleen("VRF_IsDesactive") != true, ct);
        }
    }
}
