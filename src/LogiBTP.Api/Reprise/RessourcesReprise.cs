using System.Globalization;
using LogiBTP.Import;
using LogiBTP.Domaine;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>Salarié lu d'une source, forme commune MDE / OPTIM (plan reprise-mde-optim, lot 7).</summary>
public sealed record SalarieSource
{
    /// <summary>Clé du registre (table source, clé primaire) : PMESALARIE + CODE, ref_salarie + SLR_ID.</summary>
    public required (string Table, string Cle) Origine { get; init; }
    public string? Code { get; init; }
    public string? MatriculePaie { get; init; }
    public string? Civilite { get; init; }
    public required string Nom { get; init; }
    public string? Prenom { get; init; }
    public DateOnly? Naissance { get; init; }
    public string? NumSecu { get; init; }
    /// <summary>CDI, CDD ou INTERIM (<see cref="RessourcesReprise.Statut"/>).</summary>
    public string Statut { get; init; } = RessourcesReprise.Statut.Cdi;
    public string? TypeMo { get; init; }
    public string? Poste { get; init; }
    public string? Qualification { get; init; }
    public DateOnly? Entree { get; init; }
    public DateOnly? Sortie { get; init; }
    public bool Actif { get; init; } = true;
    public decimal? Salaire { get; init; }
    public decimal? HeuresMois { get; init; }
    public decimal? CoutHoraire { get; init; }
    public string? Email { get; init; }
    public string? Telephone { get; init; }
    public string? Adresse { get; init; }
    public string? CodePostal { get; init; }
    public string? Ville { get; init; }
    public string? ContactNom { get; init; }
    public string? ContactTelephone { get; init; }
    public string? Commentaire { get; init; }
    /// <summary>Société de la base ou établissement qui emploie le salarié (rattachement de l'individu).</summary>
    public long? AgencePerId { get; init; }
    public long? CalId { get; init; }
    /// <summary>Agence d'intérim (tiers repris) de la mission d'un intérimaire.</summary>
    public long? AgenceInterimPerId { get; init; }
    /// <summary>Individu déjà repris pour la même personne (chargé d'affaires MDE) : réutilisé au lieu d'en créer un.</summary>
    public long? IndividuExistant { get; init; }
}

/// <summary>Visite réglementaire d'un matériel (contrôle technique, VGP…) : habilitation du matériel.</summary>
public sealed record VisiteSource(string Libelle, DateOnly? Derniere, DateOnly? Prochaine, int? Mois);

/// <summary>Matériel lu d'une source, forme commune MDE / OPTIM (lot 7).</summary>
public sealed record MaterielSource
{
    public required (string Table, string Cle) Origine { get; init; }
    public string? Code { get; init; }
    public required string Designation { get; init; }
    /// <summary>Famille (type de premier niveau de la liste TYPE_MATERIEL) et type (second niveau), par libellé.</summary>
    public string? Famille { get; init; }
    public string? Type { get; init; }
    public string? Marque { get; init; }
    public string? Modele { get; init; }
    public string? NumeroSerie { get; init; }
    public string? Immatriculation { get; init; }
    public string? Energie { get; init; }
    public bool ParNombre { get; init; }
    public decimal Quantite { get; init; } = 1;
    public string Compteurs { get; init; } = RessourcesReprise.Compteur.Heures;
    public long Heures { get; init; }
    public long? Kilometres { get; init; }
    public DateOnly? Entree { get; init; }
    public DateOnly? Sortie { get; init; }
    public DateOnly? FinGarantie { get; init; }
    public decimal? Poids { get; init; }
    public decimal? Hauteur { get; init; }
    public long? LoueurPerId { get; init; }
    public bool Actif { get; init; } = true;
    public string? Observations { get; init; }
    public List<VisiteSource> Visites { get; init; } = [];
}

/// <summary>Équipe lue d'une source : membres par leur clé de salarié au registre.</summary>
public sealed record EquipeSource
{
    public required (string Table, string Cle) Origine { get; init; }
    public string? Code { get; init; }
    public required string Libelle { get; init; }
    public bool Actif { get; init; } = true;
    public string? Commentaire { get; init; }
    public List<(string Table, string Cle)> Membres { get; init; } = [];
}

/// <summary>
/// Écritures des ressources pendant une reprise (plan reprise-mde-optim, lot 7) : salariés (individu, rattachement à
/// l'agence, mission d'intérim), types d'habilitations et habilitations, équipes et compositions, matériels (types et
/// énergies des listes de valeurs, visites en habilitations du matériel), calendriers. Référentiels rapprochés par code
/// ou libellé normalisés, sinon créés ; valeurs obligatoires absentes posées par défaut et listées (Q13).
/// </summary>
public sealed class RessourcesReprise
{
    public static class Statut
    {
        public const string Cdi = "CDI";
        public const string Cdd = "CDD";
        public const string Interim = "INTERIM";
    }

    public static class Compteur
    {
        public const string Heures = "H";
        public const string Kilometres = "KM";
        public const string Aucun = "AUCUN";
    }

    /// <summary>Cible d'un type d'habilitation (tha_concerne).</summary>
    public static class ConcerneHabilitation
    {
        public const string Salarie = "SALARIE";
        public const string Materiel = "MATERIEL";
        public const string LesDeux = "LES_DEUX";
    }

    /// <summary>Fiches de la liste des valeurs forcées (rapport).</summary>
    public static class Fiche
    {
        public const string Salarie = TypesFiche.Salarie;
        public const string Materiel = TypesFiche.Materiel;
        public const string Mission = "mission_interim";
    }

    private const string ListeTypeMateriel = "TYPE_MATERIEL";
    private const string ListeEnergie = "ENERGIE";
    /// <summary>Famille posée faute de type source (valeur forcée), rapprochée ou créée par son libellé.</summary>
    private const string FamilleDivers = "Divers";
    private const string ServiceDefaut = "CHANTIER";

    private sealed record Valeur(string Liste, string Code, string Libelle, string? Parent);
    private sealed record TypeHabilitation(string Code, string Libelle, string Concerne);

    private readonly ContexteReprise ctx;
    private readonly List<(string Code, string Nature)> services;
    private readonly List<Valeur> valeurs;
    private readonly List<TypeHabilitation> habilitations;
    private readonly List<(int Id, string Code, string Libelle)> calendriers;
    private readonly HashSet<string> codesSalaries = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> codesMateriels = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> codesEquipes = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<long, (string Statut, string Nom)> salaries = [];

    private RessourcesReprise(ContexteReprise ctx, List<(string, string)> services, List<Valeur> valeurs, List<TypeHabilitation> habilitations,
        List<(int, string, string)> calendriers)
    {
        this.ctx = ctx; this.services = services; this.valeurs = valeurs; this.habilitations = habilitations; this.calendriers = calendriers;
    }

    public static async Task<RessourcesReprise> LireAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var services = await SqlReprise.LireAsync(ctx.Unite, "SELECT srv_code, srv_nature FROM service WHERE srv_actif ORDER BY srv_ordre, srv_id",
            r => (r.GetString(0), r.GetString(1)), ct);
        var valeurs = await SqlReprise.LireAsync(ctx.Unite, "SELECT lva_liste, lva_code, lva_libelle, lva_parent FROM liste_valeur WHERE lva_liste = ANY($1)",
            r => new Valeur(r.GetString(0), r.GetString(1), r.GetString(2), r.IsDBNull(3) ? null : r.GetString(3)), ct,
            (object)new[] { ListeTypeMateriel, ListeEnergie });
        var habilitations = await SqlReprise.LireAsync(ctx.Unite, "SELECT tha_code, tha_libelle, tha_concerne FROM type_habilitation",
            r => new TypeHabilitation(r.GetString(0), r.GetString(1), r.GetString(2)), ct);
        var calendriers = await SqlReprise.LireAsync(ctx.Unite, "SELECT cal_id, cal_code, cal_libelle FROM calendrier",
            r => (r.GetInt32(0), r.GetString(1), r.GetString(2)), ct);
        var r = new RessourcesReprise(ctx, services, valeurs, habilitations, calendriers);
        foreach (var c in await SqlReprise.LireAsync(ctx.Unite, "SELECT sal_code FROM salarie WHERE sal_code IS NOT NULL", x => x.GetString(0), ct)) r.codesSalaries.Add(c);
        foreach (var c in await SqlReprise.LireAsync(ctx.Unite, "SELECT mat_code FROM materiel", x => x.GetString(0), ct)) r.codesMateriels.Add(c);
        foreach (var c in await SqlReprise.LireAsync(ctx.Unite, "SELECT equ_code FROM equipe", x => x.GetString(0), ct)) r.codesEquipes.Add(c);
        return r;
    }

    /// <summary>Statut du contrat d'après un texte libre (CDD, intérim), CDI par défaut.</summary>
    public static string StatutDe(string? contrat, bool interim)
    {
        if (interim) return Statut.Interim;
        var n = Associations.Normaliser(contrat);
        return n.Contains("INTERIM", StringComparison.Ordinal) ? Statut.Interim
            : n.Contains("CDD", StringComparison.Ordinal) || n.Contains("DETERMINEE", StringComparison.Ordinal) && !n.Contains("INDETERMINEE", StringComparison.Ordinal)
                ? Statut.Cdd : Statut.Cdi;
    }

    /// <summary>Type de main-d'œuvre (OUVRIER, ETAM, CADRE) d'après une catégorie libre ; null si inconnue.</summary>
    public static string? TypeMoDe(string? categorie)
    {
        var n = Associations.Normaliser(categorie);
        return n.Length == 0 ? null
            : n.Contains("CADRE", StringComparison.Ordinal) ? "CADRE"
            : n.Contains("ETAM", StringComparison.Ordinal) || n.Contains("EMPLOYE", StringComparison.Ordinal) || n.Contains("TECHNICIEN", StringComparison.Ordinal)
              || n.Contains("MAITRISE", StringComparison.Ordinal) ? "ETAM"
            : n.Contains("OUVRIER", StringComparison.Ordinal) || n.Contains("COMPAGNON", StringComparison.Ordinal) ? "OUVRIER" : null;
    }

    private string CodeService()
    {
        var code = services.FirstOrDefault(s => s.Code == ServiceDefaut).Code
                   ?? services.FirstOrDefault(s => s.Nature == "PRODUCTION").Code ?? services.FirstOrDefault().Code;
        return code ?? throw new InvalidOperationException("Aucun service actif dans la base cible");
    }

    private void Renomme(string table, string souhaite, string obtenu)
    {
        if (!string.Equals(souhaite, obtenu, StringComparison.Ordinal))
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.CodeRenomme, $"{table} {souhaite}",
                $"Code « {souhaite} » trop long ou déjà pris : créé sous « {obtenu} »");
    }

    /// <summary>Salarié : individu (ou celui déjà repris), rattachement à l'agence, fiche salarié, mission d'un intérimaire.</summary>
    public async Task<long> SalarieAsync(SalarieSource s, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(s.Origine.Table);
        volume.Lues++;
        var souhaite = AnnuaireReprise.Couper(s.Code, 20) ?? $"S{s.Origine.Cle}";
        var code = Associations.CodeLibre(souhaite, 20, codesSalaries.Contains);
        codesSalaries.Add(code);
        Renomme(s.Origine.Table, souhaite, code);
        var service = CodeService();
        ctx.Rapport.Forcer(Fiche.Salarie, code, "service", service);
        var prenom = AnnuaireReprise.Couper(s.Prenom, 60);
        if (prenom is null) ctx.Rapport.Forcer(Fiche.Salarie, code, "prenom", "");
        var role = s.Statut == Statut.Interim ? "INTERIMAIRE" : "SALARIE";

        long indId;
        if (s.IndividuExistant is { } existant)
        {
            indId = existant;
            await SqlReprise.ExecuterAsync(ctx.Unite, """
                UPDATE individu SET ind_nom = $2, ind_prenom = $3, ind_actif = $4, ind_date_naissance = coalesce($5, ind_date_naissance),
                    ind_civilite = coalesce($6, ind_civilite),
                    ind_roles = jsonb_build_array($7::text) || coalesce((SELECT jsonb_agg(r) FROM jsonb_array_elements_text(ind_roles) r
                                                                          WHERE r NOT IN ('SALARIE', 'INTERIMAIRE')), '[]'::jsonb)
                WHERE ind_id = $1
                """, ct, indId, AnnuaireReprise.Couper(s.Nom, 80) ?? "?", prenom, s.Actif, s.Naissance, AnnuaireReprise.Couper(s.Civilite, 10), role);
        }
        else
            indId = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
                INSERT INTO individu (ind_civilite, ind_nom, ind_prenom, ind_date_naissance, ind_actif, ind_roles) VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING ind_id
                """, ct, AnnuaireReprise.Couper(s.Civilite, 10), AnnuaireReprise.Couper(s.Nom, 80) ?? "?", prenom, s.Naissance, s.Actif,
                SqlReprise.Json.De(new[] { role })), CultureInfo.InvariantCulture);

        if (s.AgencePerId is { } agence)
        {
            var fonction = AnnuaireReprise.Couper(s.Poste is null ? null : s.Poste + (s.Statut == Statut.Interim ? " (intérim)" : ""), 100);
            if (await SqlReprise.ExecuterAsync(ctx.Unite, """
                    UPDATE rattachement SET rat_fonction = coalesce($3, rat_fonction), rat_service = $4, rat_debut = $5, rat_actif = $6
                    WHERE rat_ind_id = $1 AND rat_per_id = $2
                    """, ct, indId, agence, fonction, service, s.Entree, s.Actif) == 0)
                await SqlReprise.ExecuterAsync(ctx.Unite, """
                    INSERT INTO rattachement (rat_ind_id, rat_per_id, rat_fonction, rat_service, rat_debut, rat_actif) VALUES ($1, $2, $3, $4, $5, $6)
                    """, ct, indId, agence, fonction, service, s.Entree, s.Actif);
        }

        var salId = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO salarie (sal_code, sal_matricule_paie, sal_nom, sal_prenom, sal_date_naissance, sal_num_secu, sal_service, sal_poste,
                sal_qualification, sal_statut, sal_type_mo, sal_date_entree, sal_date_sortie, sal_actif, sal_usage, sal_salaire, sal_heures_mois,
                sal_cout_horaire, sal_email, sal_telephone, sal_adresse, sal_code_postal, sal_ville, sal_contact_nom, sal_contact_telephone,
                sal_commentaire, sal_ind_id, sal_agence_per_id, sal_cal_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, coalesce($17, 151.67), $18, $19, $20, $21, $22, $23, $24,
                $25, $26, $27, $28, $29)
            RETURNING sal_id
            """, ct, code, AnnuaireReprise.Couper(s.MatriculePaie, 30), AnnuaireReprise.Couper(s.Nom, 60) ?? "?", prenom ?? "", s.Naissance,
            AnnuaireReprise.Couper(s.NumSecu?.Replace(" ", "", StringComparison.Ordinal), 25), service, AnnuaireReprise.Couper(s.Poste, 60),
            AnnuaireReprise.Couper(s.Qualification, 60), s.Statut, s.TypeMo, s.Entree, s.Sortie, s.Actif, s.Actif ? "A" : "S", s.Salaire,
            s.HeuresMois is > 0 ? s.HeuresMois : null, s.CoutHoraire is > 0 ? s.CoutHoraire : null, AnnuaireReprise.Couper(s.Email, 100),
            AnnuaireReprise.Couper(s.Telephone, 20), AnnuaireReprise.Couper(s.Adresse, 200), AnnuaireReprise.Couper(s.CodePostal, 5),
            AnnuaireReprise.Couper(s.Ville, 60), AnnuaireReprise.Couper(s.ContactNom, 100), AnnuaireReprise.Couper(s.ContactTelephone, 20),
            s.Commentaire, indId, s.AgencePerId, s.CalId), CultureInfo.InvariantCulture);
        ctx.Registre.Inscrire(s.Origine.Table, s.Origine.Cle, TypesFiche.Salarie, salId);
        salaries[salId] = (s.Statut, string.Join(' ', new[] { prenom, s.Nom }.Where(x => !string.IsNullOrWhiteSpace(x))));
        volume.Ecrites++;

        // Intérimaires : salarié seul, sans mission (souvent d'anciens intérimaires ; 20/11/2026), agence notée perdue.
        if (s.Statut == Statut.Interim && s.AgenceInterimPerId is not null)
            ctx.Rapport.Perdre(Fiche.Mission, "agence", code, "Intérimaire repris sans mission d'intérim");
        return salId;
    }

    /// <summary>Catégorie d'un type d'habilitation créé, d'après son code et son libellé.</summary>
    public static string CategorieHabilitation(string? code, string? libelle)
    {
        var n = Associations.Normaliser(code) + " " + Associations.Normaliser(libelle);
        return n.Contains("CACES", StringComparison.Ordinal) ? "CACES"
            : n.Contains("HAUTEUR", StringComparison.Ordinal) || n.Contains("HARNAIS", StringComparison.Ordinal) ? "HAUTEUR"
            : n.Contains("ELEC", StringComparison.Ordinal) ? "ELECTRIQUE"
            : n.Contains("MEDIC", StringComparison.Ordinal) ? "MEDICAL"
            : n.Contains("VGP", StringComparison.Ordinal) || n.Contains("CONTROLE", StringComparison.Ordinal) || n.Contains("VERIFICATION", StringComparison.Ordinal)
              || n.Contains("VISITE", StringComparison.Ordinal) ? "CONTROLE"
            : n.Contains("SST", StringComparison.Ordinal) || n.Contains("SECOUR", StringComparison.Ordinal) || n.Contains("AIPR", StringComparison.Ordinal)
              || n.Contains("AMIANTE", StringComparison.Ordinal) || n.Contains("SECURITE", StringComparison.Ordinal) ? "SECURITE"
            : "AUTRE";
    }

    /// <summary>Type d'habilitation : rapproché par code ou libellé normalisés (même cible : salarié ou matériel), sinon créé.</summary>
    public async Task<string> TypeHabilitationAsync(string? code, string libelle, int? dureeMois, string concerne, CancellationToken ct)
    {
        var nc = Associations.Normaliser(code);
        var nl = Associations.Normaliser(libelle);
        bool Cible(TypeHabilitation t) => t.Concerne == concerne || t.Concerne == ConcerneHabilitation.LesDeux;
        var trouve = habilitations.FirstOrDefault(t => Cible(t) && nc.Length > 0 && Associations.Normaliser(t.Code) == nc)
                     ?? habilitations.FirstOrDefault(t => Cible(t) && (Associations.Normaliser(t.Libelle) == nl || Associations.Normaliser(t.Code) == nl
                                                         || nc.Length > 0 && Associations.Normaliser(t.Libelle) == nc));
        if (trouve is not null)
        {
            ctx.Rapport.Appliquer("type_habilitation", code ?? libelle, trouve.Code);
            return trouve.Code;
        }
        var souhaite = CodeDe(code ?? libelle, 30);
        var nouveau = Associations.CodeLibre(souhaite, 30, c => habilitations.Any(t => string.Equals(t.Code, c, StringComparison.OrdinalIgnoreCase)));
        await SqlReprise.ExecuterAsync(ctx.Unite, """
            INSERT INTO type_habilitation (tha_code, tha_libelle, tha_categorie, tha_concerne, tha_duree_mois, tha_ordre) VALUES ($1, $2, $3, $4, $5, $6)
            """, ct, nouveau, AnnuaireReprise.Couper(libelle, 120) ?? nouveau, CategorieHabilitation(code, libelle), concerne,
            dureeMois is > 0 ? dureeMois : null, 100 + habilitations.Count);
        habilitations.Add(new TypeHabilitation(nouveau, libelle, concerne));
        ctx.Rapport.Appliquer("type_habilitation", code ?? libelle, $"{nouveau} (créé)");
        return nouveau;
    }

    /// <summary>Code en majuscules sans accents, mots séparés par « _ ».</summary>
    public static string CodeDe(string texte, int longueur)
    {
        var mots = string.Join('_', SansAccentMajuscules(texte).Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return mots.Length == 0 ? "X" : mots.Length > longueur ? mots[..longueur].TrimEnd('_') : mots;
    }

    private static string SansAccentMajuscules(string texte)
    {
        var b = new System.Text.StringBuilder();
        foreach (var c in LogiBTP.Socle.SansAccent.Retirer(texte).ToUpperInvariant())
            b.Append(c is >= 'A' and <= 'Z' or >= '0' and <= '9' ? c : ' ');
        return b.ToString();
    }

    /// <summary>Habilitation d'un salarié ou d'un matériel.</summary>
    public Task HabilitationAsync(string typeElement, long idElement, string thaCode, DateOnly? obtenue, DateOnly? valide, string? organisme,
        string? commentaire, CancellationToken ct)
    {
        var v = ctx.Rapport.Volume("habilitation"); v.Lues++; v.Ecrites++;
        return SqlReprise.ExecuterAsync(ctx.Unite, """
            INSERT INTO habilitation (hab_tha_code, hab_type_element, hab_id_element, hab_obtenue_le, hab_valide_jusqu_au, hab_organisme,
                hab_commentaire, hab_maj_par)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """, ct, thaCode, typeElement, (int)idElement, obtenue, valide, AnnuaireReprise.Couper(organisme, 120), commentaire,
            AnnuaireReprise.Couper(ctx.Options.Auteur, 50));
    }

    /// <summary>Valeur d'une liste (TYPE_MATERIEL, ENERGIE) : rapprochée par code ou libellé normalisés, sinon créée.</summary>
    private async Task<string?> ValeurAsync(string liste, string? libelle, string? parent, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(libelle)) return null;
        var n = Associations.Normaliser(libelle);
        var trouve = valeurs.FirstOrDefault(v => v.Liste == liste && (Associations.Normaliser(v.Code) == n || Associations.Normaliser(v.Libelle) == n));
        if (trouve is not null) return trouve.Code;
        var code = Associations.CodeLibre(CodeDe(libelle, 30), 30, c => valeurs.Any(v => v.Liste == liste && string.Equals(v.Code, c, StringComparison.OrdinalIgnoreCase)));
        await SqlReprise.ExecuterAsync(ctx.Unite, """
            INSERT INTO liste_valeur (lva_liste, lva_code, lva_libelle, lva_parent, lva_ordre) VALUES ($1, $2, $3, $4, $5)
            """, ct, liste, code, AnnuaireReprise.Couper(libelle, 100), parent, 100 + valeurs.Count);
        valeurs.Add(new Valeur(liste, code, libelle.Trim(), parent));
        ctx.Rapport.Appliquer(liste, libelle, $"{code} (créé)");
        return code;
    }

    /// <summary>Type de matériel : le type (second niveau) sous sa famille, sinon la famille, sinon DIVERS (valeur forcée).</summary>
    private async Task<(string Code, bool Force)> TypeMaterielAsync(string? famille, string? type, CancellationToken ct)
    {
        var parent = await ValeurAsync(ListeTypeMateriel, famille, null, ct);
        if (!string.IsNullOrWhiteSpace(type))
        {
            var n = Associations.Normaliser(type);
            var existant = valeurs.FirstOrDefault(v => v.Liste == ListeTypeMateriel && (Associations.Normaliser(v.Code) == n || Associations.Normaliser(v.Libelle) == n));
            return (existant?.Code ?? (await ValeurAsync(ListeTypeMateriel, type, parent, ct))!, false);
        }
        if (parent is not null) return (parent, false);
        return ((await ValeurAsync(ListeTypeMateriel, FamilleDivers, null, ct))!, true);
    }

    /// <summary>Matériel : type et énergie rapprochés, compteur initial, visites en habilitations du matériel.</summary>
    public async Task<long> MaterielAsync(MaterielSource m, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(m.Origine.Table);
        volume.Lues++;
        var souhaite = AnnuaireReprise.Couper(m.Code, 10) ?? $"MAT{m.Origine.Cle}";
        var code = Associations.CodeLibre(souhaite, 10, codesMateriels.Contains);
        codesMateriels.Add(code);
        if (m.Code is not null) Renomme(m.Origine.Table, m.Code.Trim(), code);
        var (famille, force) = await TypeMaterielAsync(m.Famille, m.Type, ct);
        if (force) ctx.Rapport.Forcer(Fiche.Materiel, code, "famille", famille);
        var energie = await ValeurAsync(ListeEnergie, m.Energie, null, ct);
        var matId = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO materiel (mat_code, mat_designation, mat_famille, mat_etat, mat_condition, mat_marque, mat_modele, mat_numero_serie,
                mat_immatriculation, mat_energie, mat_mode, mat_quantite, mat_compteurs, mat_heures, mat_kilometres, mat_date_entree, mat_date_sortie,
                mat_fin_garantie, mat_poids, mat_hauteur, mat_loueur_id, mat_usage, mat_observations, mat_etat_par)
            VALUES ($1, $2, $3, 'DISPO', 'BON', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
            RETURNING mat_id
            """, ct, code, AnnuaireReprise.Couper(m.Designation, 100) ?? code, famille, AnnuaireReprise.Couper(m.Marque, 60),
            AnnuaireReprise.Couper(m.Modele, 60), AnnuaireReprise.Couper(m.NumeroSerie, 40), AnnuaireReprise.Couper(m.Immatriculation, 20), energie,
            m.ParNombre ? "NOMBRE" : "IDENTIFIE", m.ParNombre && m.Quantite > 0 ? m.Quantite : 1m, m.Compteurs, (int)Math.Clamp(m.Heures, 0, int.MaxValue),
            m.Kilometres is > 0 ? (int?)Math.Min(m.Kilometres.Value, int.MaxValue) : null, m.Entree, m.Sortie, m.FinGarantie, m.Poids is > 0 ? m.Poids : null,
            m.Hauteur is > 0 ? m.Hauteur : null, m.LoueurPerId, m.Actif ? "A" : "S", m.Observations, AnnuaireReprise.Couper(ctx.Options.Auteur ?? "reprise", 50)),
            CultureInfo.InvariantCulture);
        ctx.Registre.Inscrire(m.Origine.Table, m.Origine.Cle, TypesFiche.Materiel, matId);
        volume.Ecrites++;
        foreach (var v in m.Visites)
        {
            var tha = await TypeHabilitationAsync(null, v.Libelle, v.Mois, ConcerneHabilitation.Materiel, ct);
            await HabilitationAsync(TypesFiche.Materiel, matId, tha, v.Derniere, v.Prochaine, null, null, ct);
        }
        return matId;
    }

    /// <summary>Équipe et sa composition (membres repris), date de début = date de reprise.</summary>
    public async Task<long> EquipeAsync(EquipeSource e, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(e.Origine.Table);
        volume.Lues++;
        var souhaite = AnnuaireReprise.Couper(e.Code, 10) ?? $"EQ{e.Origine.Cle}";
        var code = Associations.CodeLibre(souhaite, 10, codesEquipes.Contains);
        codesEquipes.Add(code);
        Renomme(e.Origine.Table, souhaite, code);
        var membres = e.Membres.Select(m => ctx.Registre.Trouver(m.Table, m.Cle)).OfType<long>().Distinct().ToList();
        var equId = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO equipe (equ_code, equ_libelle, equ_active, equ_commentaire, equ_effectif) VALUES ($1, $2, $3, $4, $5) RETURNING equ_id
            """, ct, code, AnnuaireReprise.Couper(e.Libelle, 100) ?? code, e.Actif, e.Commentaire, membres.Count), CultureInfo.InvariantCulture);
        foreach (var sal in membres)
        {
            var type = salaries.TryGetValue(sal, out var s) && s.Statut == Statut.Interim ? TypesRessource.Interim : TypesRessource.Salarie;
            await SqlReprise.ExecuterAsync(ctx.Unite, """
                INSERT INTO equipe_composition (eqc_equ_id, eqc_sal_id, eqc_du, eqc_type, eqc_ressource) VALUES ($1, $2, $3, $4, $5)
                """, ct, (int)equId, (int)sal, ctx.Options.DateReprise, type, sal.ToString(CultureInfo.InvariantCulture));
        }
        ctx.Registre.Inscrire(e.Origine.Table, e.Origine.Cle, "equipe", equId);
        volume.Ecrites++;
        return equId;
    }

    /// <summary>Plage horaire d'un calendrier : jour (1 = lundi) et minutes depuis minuit.</summary>
    public sealed record Plage(int Jour, int Debut, int Fin);

    /// <summary>Calendrier : rapproché par code ou libellé normalisés, sinon créé avec ses plages (semaine unique).</summary>
    public async Task<int> CalendrierAsync(string tableSource, string cle, string libelle, IReadOnlyList<Plage> plages, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(tableSource);
        volume.Lues++;
        var n = Associations.Normaliser(libelle);
        var trouve = calendriers.FirstOrDefault(c => Associations.Normaliser(c.Code) == n || Associations.Normaliser(c.Libelle) == n);
        int id;
        if (trouve.Code is not null)
        {
            id = trouve.Id;
            ctx.Rapport.Appliquer("calendrier", libelle, trouve.Code);
        }
        else
        {
            var code = Associations.CodeLibre(CodeDe(libelle, 20), 20, c => calendriers.Any(x => string.Equals(x.Code, c, StringComparison.OrdinalIgnoreCase)));
            id = Convert.ToInt32(await SqlReprise.ScalaireAsync(ctx.Unite, """
                INSERT INTO calendrier (cal_code, cal_libelle, cal_maj_par) VALUES ($1, $2, $3) RETURNING cal_id
                """, ct, code, AnnuaireReprise.Couper(libelle, 80) ?? code, AnnuaireReprise.Couper(ctx.Options.Auteur, 50)), CultureInfo.InvariantCulture);
            foreach (var p in plages.Where(p => p.Jour is >= 1 and <= 7 && p.Debut >= 0 && p.Fin <= 1440 && p.Debut < p.Fin))
                await SqlReprise.ExecuterAsync(ctx.Unite, "INSERT INTO calendrier_plage (plg_cal_id, plg_jour, plg_debut, plg_fin) VALUES ($1, $2, $3, $4)",
                    ct, id, p.Jour, p.Debut, p.Fin);
            calendriers.Add((id, code, libelle));
            ctx.Rapport.Appliquer("calendrier", libelle, $"{code} (créé)");
        }
        ctx.Registre.Inscrire(tableSource, cle, "calendrier", id);
        volume.Ecrites++;
        return id;
    }
}
