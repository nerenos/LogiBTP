using System.Globalization;
using LogiBTP.Api.Reprise.Mde;
using LogiBTP.Api.Reprise.Optim;
using LogiBTP.Domaine;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>Aides communes des domaines de ressources.</summary>
internal static class SourcesRessources
{
    public static DateOnly? Jour(LigneSource l, string colonne) => l.Date(colonne) is { } d ? DateOnly.FromDateTime(d) : null;

    /// <summary>Minutes depuis minuit d'une heure source (TIME → TimeSpan, ou texte « hh:mm »), null si vide ou minuit.</summary>
    public static int? Minutes(LigneSource l, string colonne) => l.Brut(colonne) switch
    {
        TimeSpan t when t > TimeSpan.Zero => (int)t.TotalMinutes,
        DateTime d when d.TimeOfDay > TimeSpan.Zero => (int)d.TimeOfDay.TotalMinutes,
        string s when TimeSpan.TryParse(s, CultureInfo.InvariantCulture, out var t) && t > TimeSpan.Zero => (int)t.TotalMinutes,
        _ => null,
    };

    /// <summary>Personne de la société de la base.</summary>
    public static async Task<long?> SocieteAsync(ContexteReprise ctx, CancellationToken ct) =>
        (await SqlReprise.LireAsync(ctx.Unite, "SELECT per_id FROM personne WHERE per_societe_base", r => (long?)r.GetInt64(0), ct)).FirstOrDefault();
}

/// <summary>
/// Ressources MDE (plan reprise-mde-optim, lot 7) : salariés (PMESALARIE ⋈ COMM_EMPLOYE par CODEGESTION, adresse de la
/// fiche COMM_TIERS de type E), chargés d'affaires reliés au salarié de même nom (individu repris au lot 6), équipes
/// (PMEEQUIPE, PMESALARIEEQUIPE et équipe principale du salarié), matériels (PMEMATERIEL, type PMETYPEMATERIEL). MDE n'a
/// ni habilitations, ni calendriers de salariés, ni comptes utilisateurs lisibles.
/// </summary>
public sealed class RessourcesMde : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Ressources;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Annuaire];

    public const string ChargeAffaires = "PMECHARGEAFFAIRE";
    public const string Salarie = "PMESALARIE";
    public const string Materiel = "PMEMATERIEL";

    private const string RequeteSalaries = """
        SELECT S.CODE, S.COUTH, S.INACTIF, S.INTERIMAIRE, S.CLEEQUIPE, E.CIVILITE, E.PRENOM, E.NOM, E.MATRICULE, E.DATENAISSANCE, E.INSEE,
               E.NOMURGENCE, E.TELURGENCE, E.HEUNORM, E.SALBASE, E.TAUXHORAIRE, E.DATEENTREE, E.DATEDEPART, E.CATEGORIE, E.EMPLOI,
               E.QUALIF, E.TYPECONTRAT, E.NOTE
        FROM PMESALARIE S LEFT JOIN COMM_EMPLOYE E ON E.CODEGESTION = S.CODE ORDER BY S.CODE
        """;

    private const string RequeteAdresses = """
        SELECT T.CODEGESTION, A.ADR, A.CP, A.VILLE, I.TEL, I.PORTABLE, I.EMAIL
        FROM COMM_TIERS T JOIN COMM_TIERSADR A ON A.CODE = T.CODE AND A.IDENTIFIANT = T.IDADRFACTURATION
        LEFT JOIN COMM_TIERSINTERLOC I ON I.IDADR = A.IDENTIFIANT
        WHERE T.TYPETIERS = 'E' ORDER BY T.CODEGESTION, I.IDENTIFIANT
        """;

    private const string RequeteMateriels = """
        SELECT M.CODE, M.LIBELLE, M.MARQUE, M.MODELE, M.SUIVIKM, M.KMCOMPTEUR, M.HORSSERVICE, M.NOTE, T.LIBELLE AS TYPE_LIBELLE, T.VEHICULE
        FROM PMEMATERIEL M LEFT JOIN PMETYPEMATERIEL T ON T.CLE = M.TYPEMAT ORDER BY M.CODE
        """;

    /// <summary>Famille des types MDE marqués « véhicule » (liste TYPE_MATERIEL, rapprochée par libellé).</summary>
    public const string FamilleVehicules = "Véhicules";

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var r = await RessourcesReprise.LireAsync(ctx, ct);
        var societe = await SourcesRessources.SocieteAsync(ctx, ct);
        var adresses = (await SqlReprise.SourceAsync(ctx, RequeteAdresses, ct))
            .Where(a => a.Texte("CODEGESTION") is not null).GroupBy(a => a.Texte("CODEGESTION")!).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);

        // Chargés d'affaires (individus du lot 6) : nom normalisé → individu, pour relier le salarié de même nom.
        var charges = new Dictionary<string, long>(StringComparer.Ordinal);
        var ids = ctx.Registre.Toutes.Where(c => c.TableSource == ChargeAffaires).Select(c => c.IdCible).ToArray();
        if (ids.Length > 0)
            foreach (var (id, nom) in await SqlReprise.LireAsync(ctx.Unite,
                         "SELECT ind_id, concat_ws(' ', ind_nom, ind_prenom) FROM individu WHERE ind_id = ANY($1)", x => (x.GetInt64(0), x.GetString(1)), ct, (object)ids))
                charges.TryAdd(Associations.Normaliser(nom), id);

        var equipesSalaries = new List<(string Cle, string Salarie)>();
        foreach (var l in await SqlReprise.SourceAsync(ctx, RequeteSalaries, ct))
        {
            if (l.Texte("CODE") is not { } code) continue;
            var nom = l.Texte("NOM") ?? code;
            var prenom = l.Texte("PRENOM");
            var sortie = SourcesRessources.Jour(l, "DATEDEPART");
            var actif = l.Booleen("INACTIF") != true && (sortie is null || sortie > ctx.Options.DateReprise);
            var adresse = adresses.GetValueOrDefault(code);
            long? existant = null;
            foreach (var cle in new[] { Associations.Normaliser($"{nom} {prenom}"), Associations.Normaliser($"{prenom} {nom}") })
                if (charges.Remove(cle, out var ind)) { existant = ind; break; }
            await r.SalarieAsync(new SalarieSource
            {
                Origine = ("PMESALARIE", code), Code = code, MatriculePaie = l.Texte("MATRICULE"),
                Civilite = ctx.Registre.TrouverCode(RegistreMde.Civilite, l.Texte("CIVILITE")),
                Nom = nom, Prenom = prenom, Naissance = SourcesRessources.Jour(l, "DATENAISSANCE"), NumSecu = l.Texte("INSEE"),
                Statut = RessourcesReprise.StatutDe(l.Texte("TYPECONTRAT"), l.Booleen("INTERIMAIRE") == true),
                TypeMo = RessourcesReprise.TypeMoDe(l.Texte("CATEGORIE")), Poste = l.Texte("EMPLOI"), Qualification = l.Texte("QUALIF"),
                Entree = SourcesRessources.Jour(l, "DATEENTREE"), Sortie = sortie, Actif = actif,
                Salaire = l.Decimal("SALBASE") is > 0 and var sal ? sal : null, HeuresMois = l.Decimal("HEUNORM"),
                CoutHoraire = l.Decimal("COUTH") is > 0 and var ch ? ch : l.Decimal("TAUXHORAIRE"),
                Adresse = adresse?.Texte("ADR"), CodePostal = adresse?.Texte("CP"), Ville = adresse?.Texte("VILLE"),
                Telephone = adresse?.Texte("PORTABLE") ?? adresse?.Texte("TEL"), Email = adresse?.Texte("EMAIL"),
                ContactNom = l.Texte("NOMURGENCE"), ContactTelephone = l.Texte("TELURGENCE"), Commentaire = l.Texte("NOTE"),
                AgencePerId = societe, IndividuExistant = existant,
            }, ct);
            if (l.Texte("CLEEQUIPE") is { } eq) equipesSalaries.Add((eq, code));
        }

        // Équipes : membres de PMESALARIEEQUIPE et salariés dont c'est l'équipe principale.
        foreach (var m in await SqlReprise.SourceAsync(ctx, "SELECT CLEEQUIPE, CODESAL FROM PMESALARIEEQUIPE ORDER BY CLEEQUIPE, NUMORDRE", ct))
            if (m.Texte("CLEEQUIPE") is { } eq && m.Texte("CODESAL") is { } sal) equipesSalaries.Add((eq, sal));
        var membres = equipesSalaries.GroupBy(e => e.Cle).ToDictionary(g => g.Key, g => g.Select(e => e.Salarie).Distinct().ToList(), StringComparer.Ordinal);
        foreach (var l in await SqlReprise.SourceAsync(ctx, "SELECT CODE, LIBELLE, CLEEQUIPE, INACTIF, NOTE FROM PMEEQUIPE ORDER BY CODE", ct))
        {
            if (l.Texte("CODE") is not { } code) continue;
            await r.EquipeAsync(new EquipeSource
            {
                Origine = ("PMEEQUIPE", code), Code = code, Libelle = l.Texte("LIBELLE") ?? code, Actif = l.Booleen("INACTIF") != true,
                Commentaire = l.Texte("NOTE"),
                Membres = (l.Texte("CLEEQUIPE") is { } cle ? membres.GetValueOrDefault(cle) ?? [] : []).Select(s => ("PMESALARIE", s)).ToList(),
            }, ct);
        }

        foreach (var l in await SqlReprise.SourceAsync(ctx, RequeteMateriels, ct))
        {
            if (l.Texte("CODE") is not { } code) continue;
            var km = l.Booleen("SUIVIKM") == true;
            await r.MaterielAsync(new MaterielSource
            {
                Origine = ("PMEMATERIEL", code), Code = code, Designation = l.Texte("LIBELLE") ?? code,
                Famille = l.Booleen("VEHICULE") == true ? FamilleVehicules : null, Type = l.Texte("TYPE_LIBELLE"),
                Marque = l.Texte("MARQUE"), Modele = l.Texte("MODELE"),
                Compteurs = km ? RessourcesReprise.Compteur.Kilometres : RessourcesReprise.Compteur.Aucun,
                Kilometres = km ? (long?)l.Decimal("KMCOMPTEUR") : null, Actif = l.Booleen("HORSSERVICE") != true, Observations = l.Texte("NOTE"),
            }, ct);
        }
    }
}

/// <summary>
/// Ressources OPTIM (plan reprise-mde-optim, lot 7) : calendriers (svhz_profil_horaire, première période hors absence),
/// salariés des sociétés retenues (ref_salarie, poste par ref_salarie_fonction, agence = société ou établissement,
/// mission d'intérim chez l'agence SLR_TRS_ID), habilitations (bib_habilitation, ref_salarie_habilitation), équipes
/// (svh_equipe, svh_equipe_salarie), matériels (bib_materiel, famille / type / énergie lus dans z_parametre, visites
/// bib_materiel_visite en habilitations du matériel), liste des utilisateurs avec leur fiche (Q20).
/// </summary>
public sealed class RessourcesOptim : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.Ressources;
    public IReadOnlyList<string> Dependances => [DomainesReprise.Codes.Annuaire];

    public const string Salarie = "ref_salarie";
    public const string Materiel = "bib_materiel";

    private static readonly string[] Jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

    private const string RequeteCalendriers = """
        SELECT P.PRH_ID, P.PRH_Libelle, H.*
        FROM svhz_profil_horaire P LEFT JOIN svhz_profil_horaire_periode H ON H.PHP_PRH_ID = P.PRH_ID AND H.PHP_IsAbsence = 0
        ORDER BY P.PRH_ID, H.PHP_ID
        """;

    private const string RequeteSalaries = """
        SELECT S.SLR_ID, S.SLR_SCT_ID, S.SLR_Matricule, S.SLR_MatriculePaye, S.SLR_Nom, S.SLR_Prenom, S.SLR_PRH_ID, S.SLR_TRS_ID, S.SLR_NumSecu,
               S.SLR_Observation, S.SLR_IsDesactive, S.SLR_DateEntree, S.SLR_DateSortie, S.SLR_IsInterim, S.SLR_Adresse, S.SLR_CodePostal,
               S.SLR_Ville, S.SLR_Telephone, S.SLR_Portable, S.SLR_Email, F.SFN_Libelle
        FROM ref_salarie S LEFT JOIN ref_salarie_fonction F ON F.SFN_ID = S.SLR_SFN_ID ORDER BY S.SLR_ID
        """;

    private const string RequeteMateriels = """
        SELECT M.MTR_ID, M.MTR_Numero, M.MTR_Designation, M.MTR_Marque, M.MTR_Modele, M.MTR_NumSerie, M.MTR_Immatriculation, M.MTR_IsGenerique,
               M.MTR_Qte, M.MTR_IsLocation, M.MTR_TRS_ID, M.MTR_Poid, M.MTR_Hauteur, M.MTR_UniteCompteur, M.MTR_Compteur, M.MTR_DateEntree,
               M.MTR_DateSortie, M.MTR_DateGarantie, M.MTR_Commentaire, M.MTR_IsDesactive,
               F.PRM_Libelle AS FAMILLE, T.PRM_Libelle AS TYPE_MAT, E.PRM_Libelle AS ENERGIE
        FROM bib_materiel M LEFT JOIN z_parametre F ON F.PRM_ID = M.MTR_FamilleMateriel_ID
        LEFT JOIN z_parametre T ON T.PRM_ID = M.MTR_TypeMateriel_ID LEFT JOIN z_parametre E ON E.PRM_ID = M.MTR_Energie_ID
        ORDER BY M.MTR_ID
        """;

    private const string RequeteUtilisateurs = """
        SELECT U.UTL_ID, U.UTL_Login, U.UTL_NomReduit, U.UTL_Nom, U.UTL_Prenom, U.UTL_Email, U.UTL_PRS_ID, U.UTL_SLR_ID, U.UTL_SCT_ID,
               U.UTL_IsDesactive, P.PRF_Libelle
        FROM z_utilisateur U LEFT JOIN z_profil P ON P.PRF_ID = U.UTL_PRF_ID ORDER BY U.UTL_ID
        """;

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var r = await RessourcesReprise.LireAsync(ctx, ct);
        var societe = await SourcesRessources.SocieteAsync(ctx, ct);

        // Calendriers : première période de travail de chaque profil horaire (jusqu'à trois plages par jour).
        foreach (var g in (await SqlReprise.SourceAsync(ctx, RequeteCalendriers, ct)).GroupBy(l => l.Texte("PRH_ID") ?? ""))
        {
            var l = g.First();
            var plages = new List<RessourcesReprise.Plage>();
            for (var j = 0; j < Jours.Length; j++)
                for (var n = 1; n <= 3; n++)
                    if (SourcesRessources.Minutes(l, $"PHP_Horaire{Jours[j]}Deb{n}") is { } debut
                        && SourcesRessources.Minutes(l, $"PHP_Horaire{Jours[j]}Fin{n}") is { } fin && fin > debut)
                        plages.Add(new(j + 1, debut, fin));
            if (g.Key.Length > 0)
                await r.CalendrierAsync("svhz_profil_horaire", g.Key, l.Texte("PRH_Libelle") ?? $"Profil {g.Key}", plages, ct);
            if (g.Count() > 1)
                ctx.Rapport.Perdre("svhz_profil_horaire_periode", "PHP_DateDebut", l.Texte("PRH_Libelle"), "périodes saisonnières : seule la première est reprise");
        }

        var volume = ctx.Rapport.Volume("ref_salarie");
        foreach (var l in await SqlReprise.SourceAsync(ctx, RequeteSalaries, ct))
        {
            var id = l.Texte("SLR_ID")!;
            // Société du salarié : retenue (société de la base ou établissement), sinon écarté ; 0 = société de la base.
            var agence = l.Id("SLR_SCT_ID") is { } sct ? ctx.Registre.Trouver(RegistreOptim.Societe, sct.ToString(CultureInfo.InvariantCulture)) : societe;
            if (agence is null) { volume.Lues++; volume.Ecartees++; continue; }
            var sortie = SourcesRessources.Jour(l, "SLR_DateSortie");
            var interim = l.Booleen("SLR_IsInterim") == true;
            await r.SalarieAsync(new SalarieSource
            {
                Origine = ("ref_salarie", id), Code = l.Texte("SLR_Matricule"), MatriculePaie = l.Texte("SLR_MatriculePaye"),
                Nom = l.Texte("SLR_Nom") ?? id, Prenom = l.Texte("SLR_Prenom"), NumSecu = l.Texte("SLR_NumSecu"),
                Statut = interim ? RessourcesReprise.Statut.Interim : RessourcesReprise.Statut.Cdi, Poste = l.Texte("SFN_Libelle"),
                Entree = SourcesRessources.Jour(l, "SLR_DateEntree"), Sortie = sortie,
                Actif = l.Booleen("SLR_IsDesactive") != true && (sortie is null || sortie > ctx.Options.DateReprise),
                Adresse = l.Texte("SLR_Adresse"), CodePostal = l.Texte("SLR_CodePostal"), Ville = l.Texte("SLR_Ville"),
                Telephone = l.Texte("SLR_Portable") ?? l.Texte("SLR_Telephone"), Email = l.Texte("SLR_Email"), Commentaire = l.Texte("SLR_Observation"),
                AgencePerId = agence, CalId = ctx.Registre.Trouver("svhz_profil_horaire", l.Texte("SLR_PRH_ID")),
                AgenceInterimPerId = interim && l.Texte("SLR_TRS_ID") is { } trs ? ctx.Registre.Trouver(RegistreOptim.Tiers, ctx.CleConservee(RegistreOptim.Tiers, trs)) : null,
            }, ct);
        }

        // Habilitations : types rapprochés (durée en années → mois), puis habilitations des salariés repris.
        foreach (var l in await SqlReprise.SourceAsync(ctx,
                     "SELECT HAB_ID, HAB_Code, HAB_Libelle, HAB_DureeAn, HAB_IsSansLimite FROM bib_habilitation WHERE HAB_IsDesactive = 0 ORDER BY HAB_ID", ct))
        {
            var duree = l.Booleen("HAB_IsSansLimite") == true ? null : l.Decimal("HAB_DureeAn") is > 0 and var an ? (int?)Math.Round(an * 12) : null;
            var tha = await r.TypeHabilitationAsync(l.Texte("HAB_Code"), l.Texte("HAB_Libelle") ?? l.Texte("HAB_Code") ?? l.Texte("HAB_ID")!, duree,
                RessourcesReprise.ConcerneHabilitation.Salarie, ct);
            ctx.Registre.InscrireCode("bib_habilitation", l.Texte("HAB_ID")!, tha);
        }
        var volumeHab = ctx.Rapport.Volume("ref_salarie_habilitation");
        foreach (var l in await SqlReprise.SourceAsync(ctx, """
                     SELECT SHA_ID, SHA_SLR_ID, SHA_HAB_ID, SHA_DateObtention, SHA_OrgaObtention, SHA_DateRecycl, SHA_DateValidite, SHA_Commentaire
                     FROM ref_salarie_habilitation WHERE SHA_IsDesactive = 0 ORDER BY SHA_ID
                     """, ct))
        {
            volumeHab.Lues++;
            if (ctx.Registre.Trouver("ref_salarie", l.Texte("SHA_SLR_ID")) is not { } sal
                || ctx.Registre.TrouverCode("bib_habilitation", l.Texte("SHA_HAB_ID")) is not { } tha) { volumeHab.Ecartees++; continue; }
            await r.HabilitationAsync(TypesFiche.Salarie, sal, tha, SourcesRessources.Jour(l, "SHA_DateObtention"),
                SourcesRessources.Jour(l, "SHA_DateValidite") ?? SourcesRessources.Jour(l, "SHA_DateRecycl"), l.Texte("SHA_OrgaObtention"),
                l.Texte("SHA_Commentaire"), ct);
            volumeHab.Ecrites++;
        }

        var membres = (await SqlReprise.SourceAsync(ctx, "SELECT EQS_EQP_ID, EQS_SLR_ID FROM svh_equipe_salarie ORDER BY EQS_ID", ct))
            .Where(m => m.Texte("EQS_EQP_ID") is not null && m.Texte("EQS_SLR_ID") is not null)
            .GroupBy(m => m.Texte("EQS_EQP_ID")!).ToDictionary(g => g.Key, g => g.Select(m => ("ref_salarie", m.Texte("EQS_SLR_ID")!)).ToList(), StringComparer.Ordinal);
        var societes = SocietesOptim.Ids(ctx).ToHashSet();
        foreach (var l in await SqlReprise.SourceAsync(ctx,
                     "SELECT EQP_ID, EQP_Code, EQP_Libelle, EQP_Observation, EQP_SCT_ID, EQP_IsDesactive FROM svh_equipe ORDER BY EQP_ID", ct))
        {
            var id = l.Texte("EQP_ID")!;
            if (l.Id("EQP_SCT_ID") is { } sct && !societes.Contains(sct)) { var v = ctx.Rapport.Volume("svh_equipe"); v.Lues++; v.Ecartees++; continue; }
            await r.EquipeAsync(new EquipeSource
            {
                Origine = ("svh_equipe", id), Code = l.Texte("EQP_Code"), Libelle = l.Texte("EQP_Libelle") ?? l.Texte("EQP_Code") ?? id,
                Actif = l.Booleen("EQP_IsDesactive") != true, Commentaire = l.Texte("EQP_Observation"), Membres = membres.GetValueOrDefault(id) ?? [],
            }, ct);
        }

        var visites = (await SqlReprise.SourceAsync(ctx, """
                SELECT MTV_MTR_ID, MTV_Libelle, MTV_Frequence, MTV_DateDernier, MTV_DateProchain FROM bib_materiel_visite
                WHERE MTV_IsDesactive = 0 ORDER BY MTV_MTR_ID, MTV_Ordre, MTV_ID
                """, ct))
            .Where(v => v.Texte("MTV_MTR_ID") is not null && v.Texte("MTV_Libelle") is not null)
            .GroupBy(v => v.Texte("MTV_MTR_ID")!).ToDictionary(g => g.Key, g => g.Select(v => new VisiteSource(v.Texte("MTV_Libelle")!,
                SourcesRessources.Jour(v, "MTV_DateDernier"), SourcesRessources.Jour(v, "MTV_DateProchain"),
                v.Entier("MTV_Frequence") is > 0 and var f ? (int?)f : null)).ToList(), StringComparer.Ordinal);
        foreach (var l in await SqlReprise.SourceAsync(ctx, RequeteMateriels, ct))
        {
            var id = l.Texte("MTR_ID")!;
            var unite = Associations.Normaliser(l.Texte("MTR_UniteCompteur"));
            var km = unite.Contains("KM", StringComparison.Ordinal);
            var compteur = l.Decimal("MTR_Compteur") ?? 0;
            await r.MaterielAsync(new MaterielSource
            {
                Origine = ("bib_materiel", id), Code = l.Texte("MTR_Numero"), Designation = l.Texte("MTR_Designation") ?? l.Texte("MTR_Numero") ?? id,
                Famille = l.Texte("FAMILLE"), Type = l.Texte("TYPE_MAT"), Energie = l.Texte("ENERGIE"), Marque = l.Texte("MTR_Marque"),
                Modele = l.Texte("MTR_Modele"), NumeroSerie = l.Texte("MTR_NumSerie"), Immatriculation = l.Texte("MTR_Immatriculation"),
                ParNombre = l.Booleen("MTR_IsGenerique") == true, Quantite = l.Decimal("MTR_Qte") ?? 1,
                Compteurs = km ? RessourcesReprise.Compteur.Kilometres : RessourcesReprise.Compteur.Heures,
                Heures = km ? 0 : (long)compteur, Kilometres = km ? (long)compteur : null,
                Entree = SourcesRessources.Jour(l, "MTR_DateEntree"), Sortie = SourcesRessources.Jour(l, "MTR_DateSortie"),
                FinGarantie = SourcesRessources.Jour(l, "MTR_DateGarantie"), Poids = l.Decimal("MTR_Poid"), Hauteur = l.Decimal("MTR_Hauteur"),
                LoueurPerId = l.Booleen("MTR_IsLocation") == true && l.Texte("MTR_TRS_ID") is { } trs
                    ? ctx.Registre.Trouver(RegistreOptim.Tiers, ctx.CleConservee(RegistreOptim.Tiers, trs)) : null,
                Actif = l.Booleen("MTR_IsDesactive") != true, Observations = l.Texte("MTR_Commentaire"), Visites = visites.GetValueOrDefault(id) ?? [],
            }, ct);
        }

        await UtilisateursAsync(ctx, ct);
    }

    /// <summary>Utilisateurs (Q20) : liste au rapport, avec la fiche salarié (SLR) ou individu (PRS) quand le lien existe.</summary>
    private static async Task UtilisateursAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var fiches = new Dictionary<string, (string Type, long Id)>(StringComparer.Ordinal);
        (string? Type, long? Id) Fiche(string? slr, string? prs) =>
            ctx.Registre.Trouver("ref_salarie", slr) is { } s ? (TypesFiche.Salarie, s)
            : ctx.Registre.Trouver("bib_personne", prs) is { } p ? (TypesFiche.Individu, p) : (null, null);
        foreach (var l in await SqlReprise.SourceAsync(ctx, RequeteUtilisateurs, ct))
        {
            if (l.Booleen("UTL_IsDesactive") == true) continue;
            var (type, id) = Fiche(l.Texte("UTL_SLR_ID"), l.Texte("UTL_PRS_ID"));
            if (type is not null) fiches[l.Texte("UTL_ID")!] = (type, id!.Value);
            ctx.Rapport.Utilisateurs.Add(new UtilisateurSource(l.Texte("UTL_Login") ?? l.Texte("UTL_NomReduit") ?? l.Texte("UTL_ID")!,
                string.Join(' ', new[] { l.Texte("UTL_Prenom"), l.Texte("UTL_Nom") }.Where(x => x is not null)), l.Texte("UTL_Email"),
                l.Texte("PRF_Libelle"), type, id));
        }
        // Accès des applications mobiles et atelier : salarié (SLR), interlocuteur (PRS) ou utilisateur (UTL).
        foreach (var l in await SqlReprise.SourceAsync(ctx,
                     "SELECT UTX_ID, UTX_TypeEntite, UTX_Entite_Id FROM z_utilisateur_externe WHERE UTX_IsDesactive = 0 ORDER BY UTX_ID", ct))
        {
            var entite = l.Texte("UTX_TypeEntite");
            var cle = l.Texte("UTX_Entite_Id");
            var (type, id) = entite switch
            {
                "SLR" => Fiche(cle, null),
                "PRS" => Fiche(null, cle),
                "UTL" when cle is not null && fiches.TryGetValue(cle, out var f) => (f.Type, f.Id),
                _ => (null, null),
            };
            ctx.Rapport.Utilisateurs.Add(new UtilisateurSource($"{entite}-{cle}", null, null, "Application mobile / atelier", type, id));
        }
    }
}
