using System.Globalization;
using LogiBTP.Domaine;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>Projet (suivi commercial) lu d'une source (plan reprise-mde-optim, lot 9).</summary>
public sealed record ProjetSource
{
    public required (string Table, string Cle) Origine { get; init; }
    public string? Code { get; init; }
    public required string Libelle { get; init; }
    public long? TiersPerId { get; init; }
    public string? ClientLibre { get; init; }
    public string Statut { get; init; } = StructureReprise.StatutProjet.EnCours;
    public DateOnly? DateRemise { get; init; }
    public decimal? MontantEstime { get; init; }
    public string? Adresse { get; init; }
    public string? CodePostal { get; init; }
    public string? Ville { get; init; }
    public string? Commentaire { get; init; }
}

/// <summary>Affaire lue d'une source (lot 9).</summary>
public sealed record AffaireSource
{
    public required (string Table, string Cle) Origine { get; init; }
    public string? Code { get; init; }
    public required string Libelle { get; init; }
    public long? TiersPerId { get; init; }
    public string Statut { get; init; } = StructureReprise.StatutAffaire.Ouverte;
    public DateOnly? Ouverture { get; init; }
    public DateOnly? Cloture { get; init; }
    public long? ResponsableIndId { get; init; }
    public string? Commentaire { get; init; }
    /// <summary>Établissement d'origine (R1), gardé en propriété « etablissement ».</summary>
    public string? Etablissement { get; init; }
}

/// <summary>Chantier lu d'une source (lot 9).</summary>
public sealed record ChantierSource
{
    public required (string Table, string Cle) Origine { get; init; }
    public string? Code { get; init; }
    public required string Libelle { get; init; }
    public long? AffId { get; init; }
    public long? TiersPerId { get; init; }
    public string? Adresse { get; init; }
    public string? CodePostal { get; init; }
    public string? Ville { get; init; }
    public string Statut { get; init; } = StructureReprise.StatutChantier.Ouvert;
    public DateOnly? Ouverture { get; init; }
    public DateOnly? DebutPrevu { get; init; }
    public DateOnly? FinPrevue { get; init; }
    public DateOnly? DebutReel { get; init; }
    public DateOnly? FinReelle { get; init; }
    public long? ConducteurIndId { get; init; }
    public long? ChargeIndId { get; init; }
    public string? Commentaire { get; init; }
    /// <summary>Chantier interne (gestion, matériel… : <c>CHT_IsChantier = 0</c>, Q14).</summary>
    public bool Interne { get; init; }
    public string? CodeAnalytique { get; init; }
    public string? Etablissement { get; init; }
}

/// <summary>Marché de vente d'un chantier lu d'une source (lot 9) : la commande de base est rattachée au lot 10.</summary>
public sealed record MarcheSource
{
    public required (string Table, string Cle) Origine { get; init; }
    public required long ChaId { get; init; }
    public required string ChaCode { get; init; }
    public required string Libelle { get; init; }
    public long? TiersPerId { get; init; }
    public bool Public { get; init; }
    public decimal? MontantHt { get; init; }
    public DateOnly? Date { get; init; }
    public string Statut { get; init; } = StructureReprise.StatutMarche.EnCours;
    public string? Commentaire { get; init; }
}

/// <summary>Objet de la structure qui porte un intervenant.</summary>
public enum ObjetStructure { Projet, Affaire, Chantier, Marche }

/// <summary>
/// Écritures de la structure pendant une reprise (plan reprise-mde-optim, lot 9) : projets, affaires, chantiers
/// (internes, Q14), marchés de vente, intervenants, indices et formules de révision. Codes libres (20 caractères),
/// établissement d'origine en propriété (R1).
/// </summary>
public sealed class StructureReprise
{
    public static class StatutProjet
    {
        public const string EnCours = "EN_COURS";
        public const string Remis = "REMIS";
        public const string Obtenu = "OBTENU";
        public const string Perdu = "PERDU";
        public const string Abandonne = "ABANDONNE";
    }

    public static class StatutAffaire
    {
        public const string Ouverte = "OUVERTE";
        public const string Close = "CLOSE";
    }

    public static class StatutChantier
    {
        public const string Ouvert = "OUVERT";
        public const string Termine = "TERMINE";
        public const string Clos = "CLOS";
    }

    public static class StatutMarche
    {
        public const string EnCours = "EN_COURS";
        public const string Solde = "SOLDE";
    }

    /// <summary>Nature d'un marché (mar_nature) : privé ou public.</summary>
    public static class NatureMarche
    {
        public const string Prive = "P";
        public const string Public = "U";
    }

    /// <summary>Propriété (aff_proprietes, cha_proprietes) qui garde l'établissement d'origine (R1).</summary>
    public const string ProprieteEtablissement = "etablissement";
    /// <summary>Fonction d'intervenant du client d'une affaire.</summary>
    public const string FonctionClient = "CLIENT";
    private const int Longueur = 20;

    private readonly ContexteReprise ctx;
    private readonly HashSet<string> codesProjets = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> codesAffaires = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> codesChantiers = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> codesMarches = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<(int Id, string Code, string Libelle)> indices;
    private readonly HashSet<(ObjetStructure, long, string, long?, long?)> intervenants = [];
    private readonly Dictionary<long, long?> individusSalaries = [];

    private StructureReprise(ContexteReprise ctx, List<(int, string, string)> indices) { this.ctx = ctx; this.indices = indices; }

    public static async Task<StructureReprise> LireAsync(ContexteReprise ctx, CancellationToken ct)
    {
        var s = new StructureReprise(ctx, await SqlReprise.LireAsync(ctx.Unite, "SELECT ipx_id, ipx_code, ipx_libelle FROM index_prix",
            r => (r.GetInt32(0), r.GetString(1), r.GetString(2)), ct));
        foreach (var c in await SqlReprise.LireAsync(ctx.Unite, "SELECT prj_code FROM projet", r => r.GetString(0), ct)) s.codesProjets.Add(c);
        foreach (var c in await SqlReprise.LireAsync(ctx.Unite, "SELECT aff_code FROM affaire", r => r.GetString(0), ct)) s.codesAffaires.Add(c);
        foreach (var c in await SqlReprise.LireAsync(ctx.Unite, "SELECT cha_code FROM chantier", r => r.GetString(0), ct)) s.codesChantiers.Add(c);
        foreach (var c in await SqlReprise.LireAsync(ctx.Unite, "SELECT mar_code FROM marche", r => r.GetString(0), ct)) s.codesMarches.Add(c);
        return s;
    }

    /// <summary>Individu d'un salarié repris (chef, conducteur, chargé d'affaires).</summary>
    public async Task<long?> IndividuSalarieAsync(long? salId, CancellationToken ct)
    {
        if (salId is not { } id) return null;
        if (individusSalaries.TryGetValue(id, out var ind)) return ind;
        ind = (await SqlReprise.LireAsync(ctx.Unite, "SELECT sal_ind_id FROM salarie WHERE sal_id = $1", r => r.IsDBNull(0) ? (long?)null : r.GetInt64(0), ct,
            (int)id)).FirstOrDefault();
        individusSalaries[id] = ind;
        return ind;
    }

    private string Code(string table, string? souhaite, string defaut, HashSet<string> pris)
    {
        var voulu = AnnuaireReprise.Couper(souhaite, Longueur) ?? defaut;
        var obtenu = Associations.CodeLibre(voulu, Longueur, pris.Contains);
        pris.Add(obtenu);
        if (souhaite is not null && !string.Equals(souhaite.Trim(), obtenu, StringComparison.Ordinal))
            ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.CodeRenomme, $"{table} {souhaite.Trim()}",
                $"Code « {souhaite.Trim()} » trop long ou déjà pris : créé sous « {obtenu} »");
        return obtenu;
    }

    private static SqlReprise.Json Proprietes(string? etablissement) =>
        SqlReprise.Json.De(etablissement is null ? new Dictionary<string, string>() : new Dictionary<string, string> { [ProprieteEtablissement] = etablissement });

    public async Task<long> ProjetAsync(ProjetSource p, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(p.Origine.Table);
        volume.Lues++;
        var code = Code(p.Origine.Table, p.Code, $"PRJ-{p.Origine.Cle}", codesProjets);
        var id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO projet (prj_code, prj_libelle, prj_tiers_id, prj_client_libre, prj_statut, prj_date_remise, prj_montant_estime, prj_adresse,
                prj_code_postal, prj_ville, prj_commentaire)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING prj_id
            """, ct, code, AnnuaireReprise.Couper(p.Libelle, 150) ?? code, p.TiersPerId, p.TiersPerId is null ? AnnuaireReprise.Couper(p.ClientLibre, 300) : null,
            p.Statut, p.DateRemise, p.MontantEstime is > 0 ? p.MontantEstime : null, AnnuaireReprise.Couper(p.Adresse, 200),
            AnnuaireReprise.Couper(p.CodePostal, 10), AnnuaireReprise.Couper(p.Ville, 100), p.Commentaire), CultureInfo.InvariantCulture);
        ctx.Registre.Inscrire(p.Origine.Table, p.Origine.Cle, TypesFiche.Projet, id);
        volume.Ecrites++;
        return id;
    }

    /// <summary>Affaire (nature C) ; son client est aussi intervenant CLIENT principal.</summary>
    public async Task<long> AffaireAsync(AffaireSource a, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(a.Origine.Table);
        volume.Lues++;
        var code = Code(a.Origine.Table, a.Code, $"AFF-{a.Origine.Cle}", codesAffaires);
        var id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO affaire (aff_code, aff_libelle, aff_nature, aff_tiers_id, aff_statut, aff_date_ouverture, aff_date_cloture, aff_commentaire,
                aff_proprietes, aff_responsable_ind_id)
            VALUES ($1, $2, 'C', $3, $4, $5, $6, $7, $8, $9) RETURNING aff_id
            """, ct, code, AnnuaireReprise.Couper(a.Libelle, 150) ?? code, a.TiersPerId, a.Statut, a.Ouverture ?? ctx.Options.DateReprise,
            a.Statut == StatutAffaire.Close ? a.Cloture ?? ctx.Options.DateReprise : a.Cloture, a.Commentaire, Proprietes(a.Etablissement),
            a.ResponsableIndId), CultureInfo.InvariantCulture);
        ctx.Registre.Inscrire(a.Origine.Table, a.Origine.Cle, TypesFiche.Affaire, id);
        volume.Ecrites++;
        if (a.TiersPerId is { } client) await IntervenantAsync(ObjetStructure.Affaire, id, FonctionClient, client, null, true, ct);
        return id;
    }

    public async Task<long> ChantierAsync(ChantierSource c, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(c.Origine.Table);
        volume.Lues++;
        var code = Code(c.Origine.Table, c.Code, $"CH-{c.Origine.Cle}", codesChantiers);
        var id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO chantier (cha_code, cha_libelle, cha_aff_id, cha_tiers_id, cha_adresse, cha_code_postal, cha_ville, cha_statut, cha_date_ouverture,
                cha_date_fin_prevue, cha_conducteur_ind_id, cha_commentaire, cha_proprietes, cha_interne, cha_code_analytique, cha_debut_prevu,
                cha_debut_reel, cha_fin_reelle, cha_charge_ind_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING cha_id
            """, ct, code, AnnuaireReprise.Couper(c.Libelle, 150) ?? code, c.AffId is { } aff ? (int?)aff : null, c.TiersPerId,
            AnnuaireReprise.Couper(c.Adresse, 200), AnnuaireReprise.Couper(c.CodePostal, 10), AnnuaireReprise.Couper(c.Ville, 100), c.Statut,
            c.Ouverture ?? c.DebutReel ?? c.DebutPrevu ?? ctx.Options.DateReprise, c.FinPrevue, c.ConducteurIndId, c.Commentaire,
            Proprietes(c.Etablissement), c.Interne, AnnuaireReprise.Couper(c.CodeAnalytique, 30), c.DebutPrevu, c.DebutReel,
            c.FinReelle, c.ChargeIndId), CultureInfo.InvariantCulture);
        ctx.Registre.Inscrire(c.Origine.Table, c.Origine.Cle, TypesFiche.Chantier, id);
        volume.Ecrites++;
        return id;
    }

    /// <summary>Marché de vente du chantier (code M-&lt;chantier&gt;), client intervenant du marché.</summary>
    public async Task<long> MarcheAsync(MarcheSource m, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume("marche");
        volume.Lues++;
        var code = Code("marche", null, AnnuaireReprise.Couper($"M-{m.ChaCode}", Longueur)!, codesMarches);
        var id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO marche (mar_code, mar_libelle, mar_cha_id, mar_tiers_id, mar_nature, mar_montant_ht, mar_date, mar_statut, mar_commentaire, mar_sens)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'V') RETURNING mar_id
            """, ct, code, AnnuaireReprise.Couper(m.Libelle, 150) ?? code, (int)m.ChaId, m.TiersPerId, m.Public ? NatureMarche.Public : NatureMarche.Prive,
            m.MontantHt is > 0 ? m.MontantHt : null, m.Date ?? ctx.Options.DateReprise, m.Statut, m.Commentaire), CultureInfo.InvariantCulture);
        ctx.Registre.Inscrire(m.Origine.Table, m.Origine.Cle, TypesFiche.Marche, id);
        volume.Ecrites++;
        return id;
    }

    /// <summary>Intervenant d'un objet (tiers ou contact), sans doublon (même objet, fonction et fiche).</summary>
    public async Task IntervenantAsync(ObjetStructure objet, long objetId, string fonction, long? perId, long? indId, bool principal, CancellationToken ct)
    {
        if (perId is null && indId is null) return;
        if (!intervenants.Add((objet, objetId, fonction, perId, indId))) return;
        var volume = ctx.Rapport.Volume("intervenant");
        volume.Lues++;
        int? Si(ObjetStructure o) => o == objet ? (int)objetId : null;
        await SqlReprise.ExecuterAsync(ctx.Unite, """
            INSERT INTO intervenant (itv_prj_id, itv_aff_id, itv_cha_id, itv_mar_id, itv_fin_code, itv_per_id, itv_ind_id, itv_principal, itv_ordre)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """, ct, Si(ObjetStructure.Projet), Si(ObjetStructure.Affaire), Si(ObjetStructure.Chantier), Si(ObjetStructure.Marche), fonction, perId, indId,
            principal, intervenants.Count);
        volume.Ecrites++;
    }

    /// <summary>Indice de prix : rapproché par code normalisé (BT01…), sinon créé.</summary>
    public async Task<int> IndiceAsync(string tableSource, string cle, string? reference, string libelle, bool actif, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(tableSource);
        volume.Lues++;
        var n = Associations.Normaliser(reference ?? libelle);
        var trouve = indices.FirstOrDefault(i => Associations.Normaliser(i.Code) == n);
        int id;
        if (trouve.Code is not null)
        {
            id = trouve.Id;
            ctx.Rapport.Appliquer("index_prix", reference ?? libelle, trouve.Code);
        }
        else
        {
            var code = Associations.CodeLibre(n.Length > 0 ? n : "INDICE", Longueur, c => indices.Any(i => string.Equals(i.Code, c, StringComparison.OrdinalIgnoreCase)));
            id = Convert.ToInt32(await SqlReprise.ScalaireAsync(ctx.Unite, "INSERT INTO index_prix (ipx_code, ipx_libelle, ipx_actif) VALUES ($1, $2, $3) RETURNING ipx_id",
                ct, code, AnnuaireReprise.Couper(libelle, 150) ?? code, actif), CultureInfo.InvariantCulture);
            indices.Add((id, code, libelle));
            ctx.Rapport.Appliquer("index_prix", reference ?? libelle, $"{code} (créé)");
        }
        ctx.Registre.Inscrire(tableSource, cle, "index_prix", id);
        volume.Ecrites++;
        return id;
    }

    public string? CodeIndice(long? ipxId) => ipxId is { } id ? indices.FirstOrDefault(i => i.Id == id).Code : null;

    /// <summary>Valeur mensuelle d'un indice (mois de la date) ; une valeur déjà connue de la base est gardée.</summary>
    public async Task ValeurIndiceAsync(string tableSource, int ipxId, DateOnly date, decimal valeur, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(tableSource);
        volume.Lues++;
        if (valeur <= 0) { volume.Ecartees++; return; }
        var n = await SqlReprise.ExecuterAsync(ctx.Unite, """
            INSERT INTO index_valeur (ixv_ipx_id, ixv_mois, ixv_valeur, ixv_source, ixv_maj_par) VALUES ($1, $2, $3, 'IMPORT', $4)
            ON CONFLICT (ixv_ipx_id, ixv_mois) DO NOTHING
            """, ct, ipxId, new DateOnly(date.Year, date.Month, 1), valeur, AnnuaireReprise.Couper(ctx.Options.Auteur, 50));
        if (n == 0) volume.Ecartees++; else volume.Ecrites++;
    }

    /// <summary>Formule de révision (partie fixe, termes indice / poids) ; liée aux marchés avec les pièces (lot 10).</summary>
    public async Task<long> FormuleAsync(string tableSource, string cle, string libelle, decimal partieFixe, IReadOnlyList<(string Indice, decimal Poids)> termes,
        int precision, bool actif, CancellationToken ct)
    {
        var volume = ctx.Rapport.Volume(tableSource);
        volume.Lues++;
        var id = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO formule_revision (frv_libelle, frv_partie_fixe, frv_termes, frv_precision, frv_actif) VALUES ($1, $2, $3, $4, $5) RETURNING frv_id
            """, ct, AnnuaireReprise.Couper(libelle, 150), partieFixe, SqlReprise.Json.De(termes.Select(t => new { index = t.Indice, poids = t.Poids })),
            (short)Math.Clamp(precision, 0, 6), actif), CultureInfo.InvariantCulture);
        ctx.Registre.Inscrire(tableSource, cle, "formule_revision", id);
        volume.Ecrites++;
        return id;
    }

    /// <summary>Part en fraction d'une valeur source : au-delà de 1, pourcentage (85 → 0,85).</summary>
    public static decimal Fraction(decimal? valeur) => valeur switch
    {
        null or <= 0 => 0m,
        > 1 => valeur.Value / 100,
        _ => valeur.Value,
    };

    /// <summary>Statut d'un chantier d'après les indicateurs source et la date de fin réelle.</summary>
    public static string StatutChantierDe(bool termine, bool clos, DateOnly? finReelle) =>
        clos ? StatutChantier.Clos : termine || finReelle is not null ? StatutChantier.Termine : StatutChantier.Ouvert;

    /// <summary>Statut d'après un libellé d'état libre (OPTIM : z_parametre) : clos, terminé, sinon ouvert.</summary>
    public static (bool Termine, bool Clos) EtatDe(string? libelle)
    {
        var n = Associations.Normaliser(libelle);
        bool A(params string[] mots) => mots.Any(m => n.Contains(m, StringComparison.Ordinal));
        return (A("TERMIN", "ACHEV", "FINI", "RECEPTION"), A("CLOS", "CLOTUR", "SOLDE", "ARCHIV", "ANNUL"));
    }

    /// <summary>Statut d'un projet d'après un libellé d'état libre.</summary>
    public static string StatutProjetDe(string? libelle)
    {
        var n = Associations.Normaliser(libelle);
        return n.Contains("OBTENU", StringComparison.Ordinal) || n.Contains("GAGNE", StringComparison.Ordinal) || n.Contains("ACCEPT", StringComparison.Ordinal) ? StatutProjet.Obtenu
            : n.Contains("PERDU", StringComparison.Ordinal) || n.Contains("REFUS", StringComparison.Ordinal) ? StatutProjet.Perdu
            : n.Contains("ABANDON", StringComparison.Ordinal) || n.Contains("ANNUL", StringComparison.Ordinal) ? StatutProjet.Abandonne
            : n.Contains("REMIS", StringComparison.Ordinal) || n.Contains("DEPOSE", StringComparison.Ordinal) ? StatutProjet.Remis
            : StatutProjet.EnCours;
    }
}
