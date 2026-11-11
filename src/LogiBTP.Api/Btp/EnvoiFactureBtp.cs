using System.Globalization;
using System.Text.Json.Nodes;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Editions.Web;
using LogiBTP.FactureElectronique;
using LogiBTP.FactureElectronique.Formats;
using LogiBTP.FactureElectronique.Web;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Api.Btp;

/// <summary>
/// État de l'émission d'une pièce (GET /api/facture-electronique/documents/{id}/envoi) : type émis (applicable), état et
/// motif (document_fe_emission), syntaxe, flux et son état, statut du cycle de vie affiché, pastille (comme la colonne
/// statut_fe de v_liste_documents), erreur, bouton « Émettre » proposé.
/// </summary>
public sealed record EtatEnvoiFe(bool Applicable, string? Etat, string? Motif, string? Syntaxe, long? FluxId, string? EtatFlux, string? Statut,
    string? Pastille, string? Erreur, bool Emettable);

/// <summary>Option de la société : émission automatique à la validation (Q23), sinon bouton « Émettre ».</summary>
public sealed record OptionEmissionFe(bool Automatique);

/// <summary>
/// Émission des factures électroniques à la validation (plans/facturation-electronique.md, lot 24 ; Q5, Q23) :
/// - contrôle à la validation d'une pièce d'un type émis (module actif) pour un tiers B2B ou B2G présent dans l'annuaire :
///   écart bloquant de la complétude (lot 16) ou de l'émission (lot 22) → validation refusée (FE_INCOMPLETE), sauf droit
///   FORCER sur le type (la pièce validée reste alors à émettre, en échec INCOMPLETE tant que les données manquent) ;
/// - à la validation (dans sa transaction) : document_fe_emission A_EMETTRE, ou DIFFEREE (option « Envoyer plus tard » de la
///   pièce, émission automatique désactivée) ; tâche de fond <see cref="PassageEnvoiFe"/> ;
/// - émission : tiers particulier, international ou absent de l'annuaire → HORS_FLUX (envoi habituel, aucun flux 2) ;
///   sinon facture construite (<see cref="EmissionFactureBtp"/>), écrite en CII, UBL ou Factur-X selon le format du tiers
///   (per_fe_format), à défaut celui des paramètres du module ; Factur-X = PDF/A-3 de l'édition de la pièce (module
///   Édition, option pdf.pdfa) avec le CII en fichier associé « factur-x.xml » (relation Alternative) et le schéma
///   d'extension XMP Factur-X ; mise en file du module (étape PRODUCTION, fichier rangé en GED de la pièce à l'étape ENVOI
///   et au coffre) → EMISE ; dépôt, accusé et statuts par la file et la relève du module (chronologie de la pièce) ;
/// - bouton « Émettre » (POST …/documents/{id}/envoi) pour une pièce validée avant l'activation, différée, en échec ou hors flux.
/// </summary>
public static class EnvoiFactureBtp
{
    /// <summary>Compte de la tâche de fond (production de l'édition, mise en file).</summary>
    public static readonly Utilisateur Systeme = new("facture_electronique", Profils.Admin);

    /// <summary>Nom du fichier associé d'un Factur-X (norme Factur-X 1.0).</summary>
    public const string NomXmlFacturX = "factur-x.xml";
    public const string EspaceFacturX = "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#";

    /// <summary>Essais automatiques d'une production en échec (édition indisponible…), une minute au moins entre deux.</summary>
    public const int EssaisProduction = 3;

    private static readonly HashSet<string> SyntaxesEmises = [Syntaxe.Cii, Syntaxe.Ubl, Syntaxe.FacturX];
    private static readonly HashSet<string> EtatsEmettables = [EtatsEmissionFe.AEmettre, EtatsEmissionFe.Differee, EtatsEmissionFe.Echec, EtatsEmissionFe.HorsFlux];

    // ---------------------------------------------------------------- règles sans base

    /// <summary>
    /// Pièce hors flux 2 (envoi habituel) : particulier (B2C), tiers étranger ou international (e-reporting), professionnel
    /// absent de l'annuaire (vérifié, non trouvé) ; null : émise par la plateforme (B2B, B2G, type non saisi ; jamais vérifié
    /// compris, l'adresse de facturation retombe sur le SIREN).
    /// </summary>
    public static string? MotifHorsFlux(string? feType, string? pays, bool? dansAnnuaire)
    {
        if (feType == "B2C") return MotifsEmissionFe.B2C;
        if (feType == "INTERNATIONAL" || (!string.IsNullOrWhiteSpace(pays) && !pays.Trim().Equals("FR", StringComparison.OrdinalIgnoreCase)))
            return MotifsEmissionFe.International;
        return dansAnnuaire == false ? MotifsEmissionFe.HorsAnnuaire : null;
    }

    /// <summary>Syntaxe émise : format de la fiche du tiers (FACTURX, UBL, CII), sinon celle des paramètres du module, sinon CII.</summary>
    public static string SyntaxeDe(string? formatTiers, string? defaut) => formatTiers?.Trim().ToUpperInvariant() switch
    {
        "FACTURX" or "FACTUR-X" => Syntaxe.FacturX,
        "UBL" => Syntaxe.Ubl,
        "CII" => Syntaxe.Cii,
        _ => defaut is not null && SyntaxesEmises.Contains(defaut) ? defaut : Syntaxe.Cii,
    };

    /// <summary>Pastille d'une pièce (comme statut_fe de v_liste_documents, db/300) ; null hors facturation électronique.</summary>
    public static string? Pastille(string? etat, string? etatFlux, string? statut) =>
        etat is null ? null
        : statut is not null ? statut
        : etat == EtatsEmissionFe.Echec || etatFlux == EtatFlux.Erreur ? PastillesEmissionFe.Erreur
        : etat == EtatsEmissionFe.Emise ? PastillesEmissionFe.EnFile
        : etat;

    /// <summary>État initial à la validation : différé par l'option de la pièce ou de la société, sinon à émettre.</summary>
    public static string EtatALaValidation(bool differe, bool automatique) => differe || !automatique ? EtatsEmissionFe.Differee : EtatsEmissionFe.AEmettre;

    /// <summary>Bouton « Émettre » : type émis, pièce validée valable, jamais émise ou émission à reprendre (flux en erreur compris).</summary>
    public static bool Emettable(bool applicable, bool valable, string? etat, string? etatFlux) =>
        applicable && valable && (etat is null || EtatsEmettables.Contains(etat) || (etat == EtatsEmissionFe.Emise && etatFlux == EtatFlux.Erreur));

    /// <summary>Écarts bloquants d'un contrôle (complétude et émission).</summary>
    public static List<EcartCompletude> Bloquants(ControleEmissionFe c) =>
        [.. c.Completude.Concat(c.Emission).Where(e => e.Niveau == NiveauCompletude.Bloquant)];

    /// <summary>Texte des écarts bloquants (validation refusée, échec de l'émission).</summary>
    public static string TexteEcarts(IEnumerable<EcartCompletude> ecarts) =>
        string.Join(" ; ", ecarts.Select(e => e.Ligne is null ? $"{e.Regle} ({e.Donnee})" : $"{e.Regle} ({e.Donnee}, ligne {e.Ligne})"));

    /// <summary>
    /// Option PDF/A-3 du module Édition pour un Factur-X : XML CII en fichier associé « factur-x.xml » (relation
    /// Alternative, profil EN 16931) et schéma d'extension XMP Factur-X (DocumentType, DocumentFileName, Version, ConformanceLevel).
    /// </summary>
    public static JsonObject OptionFacturX(byte[] xml, string? profil)
    {
        var niveau = profil == ProfilFacture.ExtendedCtcFr ? "EXTENDED" : "EN 16931";
        JsonObject P(string nom, string description, string valeur) =>
            new() { ["nom"] = nom, ["type"] = "Text", ["categorie"] = "external", ["description"] = description, ["valeur"] = valeur };
        return new JsonObject
        {
            ["conformite"] = "B",
            ["fichiers"] = new JsonArray(new JsonObject
            {
                ["nom"] = NomXmlFacturX, ["type"] = "text/xml", ["relation"] = "Alternative",
                ["description"] = "Factur-X Invoice", ["base64"] = Convert.ToBase64String(xml),
            }),
            ["schemas"] = new JsonArray(new JsonObject
            {
                ["schema"] = "Factur-X PDFA Extension Schema", ["espace"] = EspaceFacturX, ["prefixe"] = "fx",
                ["proprietes"] = new JsonArray(
                    P("DocumentFileName", "name of the embedded XML invoice file", NomXmlFacturX),
                    P("DocumentType", "INVOICE", "INVOICE"),
                    P("Version", "The actual version of the Factur-X XML schema", "1.0"),
                    P("ConformanceLevel", "The conformance level of the embedded Factur-X data", niveau)),
            }),
        };
    }

    /// <summary>Nom de fichier sûr d'un flux : numéro de la pièce, suffixe de la syntaxe.</summary>
    public static string NomFichier(string numero, string syntaxe)
    {
        var s = new string(numero.Select(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' ? c : '_').ToArray());
        if (s.Length == 0) s = "facture";
        if (s.Length > 80) s = s[..80];
        return syntaxe switch { Syntaxe.FacturX => $"{s}_FX.pdf", Syntaxe.Ubl => $"{s}_UBL.xml", _ => $"{s}_CII.xml" };
    }

    // ---------------------------------------------------------------- lecture en base

    private sealed record LignePiece(long Id, string? Numero, bool Verrouille, bool Valable, string? TypeFacture, int TydId, string Famille, string Code,
        string? FeType, string? Pays, bool? DansAnnuaire, string? Format, bool Differe);

    private const string SqlPiece = """
        SELECT d.ent_id AS id, d.ent_numero AS numero, d.ent_verrouille AS verrouille, f_document_valable(d.ent_id, FALSE) AS valable,
               t.tyd_fe_type_facture AS type_facture, t.tyd_id, t.tyd_famille::text AS famille, t.tyd_code AS code,
               p.per_fe_type AS fe_type, p.per_pays::text AS pays, p.per_fe_dans_annuaire AS dans_annuaire, p.per_fe_format AS format,
               d.ent_fe_differe AS differe
        FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id LEFT JOIN personne p ON p.per_id = d.ent_tiers_id
        WHERE d.ent_id = @id
        """;

    private static async Task<LignePiece?> PieceAsync(DbContext db, long id, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<LignePiece>(SqlPiece, new NpgsqlParameter("id", id)).ToListAsync(ct)).FirstOrDefault();

    /// <summary>Module actif dans la base (lu en SQL : aussi hors requête HTTP, dans la transaction de la validation).</summary>
    public static async Task<bool> ModuleActifAsync(DbContext db, CancellationToken ct) =>
        (await db.Database.SqlQueryRaw<bool>(
            "SELECT coalesce((SELECT mod_actif FROM module_societe WHERE mod_code = @c), FALSE) AS \"Value\"",
            new NpgsqlParameter("c", ModulesFacultatifs.FactureElectronique)).ToListAsync(ct)).FirstOrDefault();

    public static async Task<OptionEmissionFe> OptionAsync(DbContext db, CancellationToken ct) =>
        new((await db.Database.SqlQueryRaw<bool?>(
            "SELECT (SELECT feo_automatique FROM facture_electronique_emission_option WHERE feo_id = 1) AS \"Value\"").ToListAsync(ct)).FirstOrDefault() ?? true);

    public static async Task<OptionEmissionFe> EnregistrerOptionAsync(DbContext db, bool automatique, CancellationToken ct)
    {
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO facture_electronique_emission_option (feo_id, feo_automatique) VALUES (1, @a)
            ON CONFLICT (feo_id) DO UPDATE SET feo_automatique = EXCLUDED.feo_automatique
            """, [new NpgsqlParameter("a", automatique)], ct);
        return await OptionAsync(db, ct);
    }

    private sealed record LigneEmission(string Etat, string? Motif, string? Syntaxe, long? FluxId, string? EtatFlux, string? Statut, string? Erreur);

    /// <summary>État de l'émission d'une pièce ; pièce introuvable : 404.</summary>
    public static async Task<EtatEnvoiFe> EtatAsync(DbContext db, long id, CancellationToken ct)
    {
        var p = await PieceAsync(db, id, ct) ?? throw ExceptionMetier.Introuvable("Document");
        var e = (await db.Database.SqlQueryRaw<LigneEmission>("""
            SELECT e.dfe_etat AS etat, e.dfe_motif AS motif, e.dfe_syntaxe AS syntaxe, e.dfe_flux_id AS flux_id, f.ffl_etat AS etat_flux,
                   e.dfe_statut AS statut, e.dfe_erreur AS erreur
            FROM document_fe_emission e LEFT JOIN fe_flux f ON f.ffl_id = e.dfe_flux_id WHERE e.dfe_ent_id = @id
            """, new NpgsqlParameter("id", id)).ToListAsync(ct)).FirstOrDefault();
        var applicable = p.TypeFacture is not null;
        return new EtatEnvoiFe(applicable, e?.Etat, e?.Motif, e?.Syntaxe, e?.FluxId, e?.EtatFlux, e?.Statut, Pastille(e?.Etat, e?.EtatFlux, e?.Statut),
            e?.Erreur, Emettable(applicable, p.Verrouille && p.Valable, e?.Etat, e?.EtatFlux));
    }

    // ---------------------------------------------------------------- validation (points d'accroche de SpecialisationBtp)

    /// <summary>
    /// Contrôle Q5 à la validation (pièce enregistrée) : type émis, module actif, tiers B2B ou B2G émis par la plateforme ;
    /// écarts bloquants → FE_INCOMPLETE, sauf droit FORCER de l'utilisateur de la requête sur le type.
    /// </summary>
    public static async Task ControlerAsync(LogiBtpContext db, long id, TypeDocument type, Utilisateur? u, IDroits? droits, List<MessageCalcul> erreurs,
        CancellationToken ct)
    {
        if (type.TydFamille != "V" || !await ModuleActifAsync(db, ct)) return;
        var p = await PieceAsync(db, id, ct);
        if (p?.TypeFacture is null || MotifHorsFlux(p.FeType, p.Pays, p.DansAnnuaire) is not null) return;
        var entree = await EmissionFactureBtp.EntreeAsync(db, id, ct);
        if (entree is null || !EmissionFactureBtp.Bloquant(entree.Acheteur)) return;
        var bloquants = Bloquants(EmissionFactureBtp.Controler(entree));
        if (bloquants.Count == 0 || await ForceAsync(type, u, droits, ct)) return;
        foreach (var e in bloquants)
        {
            erreurs.Add(new MessageCalcul(null, ErreursEmissionFe.Incomplete,
                $"Facture électronique incomplète : {TexteEcarts([e])} (tiers {entree.Acheteur!.TypeFe ?? "B2B"} : à compléter avant la validation)"));
        }
    }

    /// <summary>Droit FORCER de l'utilisateur sur le type (module Droits ; sans lui, administrateur).</summary>
    public static async Task<bool> ForceAsync(TypeDocument type, Utilisateur? u, IDroits? droits, CancellationToken ct) =>
        u is not null && (droits is null ? u.EstAdmin : await droits.AutoriseAsync(u, FamillesDocument.NoeudDroits(type.TydFamille, type.TydCode), ActionsDroits.Forcer, ct));

    /// <summary>
    /// Avertissements avant la validation (type émis, module actif) : tiers absent de l'annuaire ou jamais vérifié (lot 20) ;
    /// écarts bloquants passés par le droit FORCER (la pièce ne partira qu'une fois complétée).
    /// </summary>
    public static async Task AvertirAsync(LogiBtpContext db, DocumentBtp d, TypeDocument type, Utilisateur? u, IDroits? droits, List<MessageCalcul> avertissements,
        CancellationToken ct)
    {
        if (type.TydFamille != "V" || d.EntId <= 0 || !await ModuleActifAsync(db, ct)) return;
        var p = await PieceAsync(db, d.EntId, ct);
        if (p?.TypeFacture is null) return;
        if (AnnuaireFeBtp.Avertissement(p.FeType, p.Pays, p.DansAnnuaire) is { } a)
        {
            avertissements.Add(new MessageCalcul(null, a, a == AvertissementAnnuaireFe.HorsAnnuaire
                ? "Facture électronique : tiers absent de l'annuaire des plateformes, la pièce suivra l'envoi habituel (aucun flux)"
                : "Facture électronique : tiers jamais vérifié dans l'annuaire des plateformes (fiche du tiers, « Vérifier dans l'annuaire »)"));
        }
        if (MotifHorsFlux(p.FeType, p.Pays, p.DansAnnuaire) is not null || !await ForceAsync(type, u, droits, ct)) return;
        var entree = await EmissionFactureBtp.EntreeAsync(db, d.EntId, ct);
        if (entree is null || !EmissionFactureBtp.Bloquant(entree.Acheteur)) return;
        var bloquants = Bloquants(EmissionFactureBtp.Controler(entree));
        if (bloquants.Count > 0)
        {
            avertissements.Add(new MessageCalcul(null, ErreursEmissionFe.Incomplete,
                $"Facture électronique incomplète, validation par forçage : la pièce ne sera émise qu'une fois complétée ({TexteEcarts(bloquants)})"));
        }
    }

    /// <summary>
    /// Après la validation, dans sa transaction : pièce d'un type émis (module actif) inscrite à émettre, ou différée.
    /// Une pièce déjà inscrite n'est pas touchée.
    /// </summary>
    public static async Task PlanifierAsync(DbContext db, long id, TypeDocument type, string? utilisateur, CancellationToken ct)
    {
        if (type.TydFamille != "V" || !await ModuleActifAsync(db, ct)) return;
        var p = await PieceAsync(db, id, ct);
        if (p?.TypeFacture is null) return;
        var etat = EtatALaValidation(p.Differe, (await OptionAsync(db, ct)).Automatique);
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO document_fe_emission (dfe_ent_id, dfe_etat, dfe_demande_par) VALUES (@id, @etat, @par) ON CONFLICT (dfe_ent_id) DO NOTHING
            """, [new NpgsqlParameter("id", id), new NpgsqlParameter("etat", etat), new NpgsqlParameter("par", utilisateur ?? "validation")], ct);
    }

    // ---------------------------------------------------------------- émission

    private static async Task EcrireEtatAsync(DbContext db, long id, string etat, string? motif, string? syntaxe, long? flux, string? erreur, string? par,
        CancellationToken ct) =>
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO document_fe_emission (dfe_ent_id, dfe_etat, dfe_motif, dfe_syntaxe, dfe_flux_id, dfe_erreur, dfe_demande_par, dfe_traite_le)
            VALUES (@id, @etat, @motif, @syntaxe, @flux, @erreur, coalesce(@par, ''), now())
            ON CONFLICT (dfe_ent_id) DO UPDATE SET dfe_etat = EXCLUDED.dfe_etat, dfe_motif = EXCLUDED.dfe_motif,
                dfe_syntaxe = coalesce(EXCLUDED.dfe_syntaxe, document_fe_emission.dfe_syntaxe),
                dfe_flux_id = coalesce(EXCLUDED.dfe_flux_id, document_fe_emission.dfe_flux_id),
                dfe_statut = CASE WHEN EXCLUDED.dfe_flux_id IS NOT NULL THEN NULL ELSE document_fe_emission.dfe_statut END,
                dfe_erreur = EXCLUDED.dfe_erreur, dfe_traite_le = now(),
                dfe_demande_par = CASE WHEN @par IS NULL THEN document_fe_emission.dfe_demande_par ELSE @par END
            """,
            [new NpgsqlParameter("id", id), new NpgsqlParameter("etat", etat), SqlBtp.P("motif", motif, NpgsqlTypes.NpgsqlDbType.Varchar),
             SqlBtp.P("syntaxe", syntaxe, NpgsqlTypes.NpgsqlDbType.Varchar), SqlBtp.P("flux", flux, NpgsqlTypes.NpgsqlDbType.Bigint),
             SqlBtp.P("erreur", erreur, NpgsqlTypes.NpgsqlDbType.Text), SqlBtp.P("par", par, NpgsqlTypes.NpgsqlDbType.Varchar)], ct);

    /// <summary>
    /// Émet une pièce (tâche de fond : <paramref name="u"/> null, compte système ; bouton « Émettre » : l'utilisateur) et
    /// rend son état. Refus : type non émis ou pièce non validée (FE_NON_EMETTABLE), déjà émise (FE_DEJA_EMISE), plateforme
    /// non active (FE_NON_EMETTABLE). Hors flux 2 : HORS_FLUX ; écarts bloquants : ECHEC INCOMPLETE (bouton : 422 FE_INCOMPLETE).
    /// </summary>
    public static async Task<EtatEnvoiFe> EmettreAsync(IServiceProvider services, long id, Utilisateur? u, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        var p = await PieceAsync(db, id, ct) ?? throw ExceptionMetier.Introuvable("Document");
        var avant = await EtatAsync(db, id, ct);
        if (!avant.Applicable || !p.Verrouille || !p.Valable)
            throw ExceptionMetier.Invalide(ErreursEmissionFe.NonEmettable, "Seule une pièce de vente validée d'un type émis peut partir en facture électronique");
        if (!avant.Emettable)
            throw ExceptionMetier.Conflit(ErreursEmissionFe.DejaEmise, "Facture électronique déjà émise : suivez-la dans l'onglet Chronologie");
        var fe = services.GetRequiredService<ServiceFactureElectronique>();
        var parametres = await fe.ParametreAsync(ct);
        if (!parametres.FpaActif)
            throw ExceptionMetier.Invalide(ErreursEmissionFe.NonEmettable, "Plateforme de facturation électronique non activée (paramètres du module)");
        var par = u?.Code;

        if (MotifHorsFlux(p.FeType, p.Pays, p.DansAnnuaire) is { } motif)
        {
            await EcrireEtatAsync(db, id, EtatsEmissionFe.HorsFlux, motif, null, null, null, par, ct);
            return await EtatAsync(db, id, ct);
        }
        var entree = await EmissionFactureBtp.EntreeAsync(db, id, ct) ?? throw ExceptionMetier.Introuvable("Document");
        var construite = EmissionFactureBtp.Construire(entree);
        var bloquants = Bloquants(EmissionFactureBtp.Controler(entree));
        if (bloquants.Count > 0)
        {
            var texte = TexteEcarts(bloquants);
            await EcrireEtatAsync(db, id, EtatsEmissionFe.Echec, MotifsEmissionFe.Incomplete, null, null, texte, par, ct);
            if (u is not null) throw ExceptionMetier.Invalide(ErreursEmissionFe.Incomplete, $"Facture électronique incomplète : {texte}", bloquants);
            return await EtatAsync(db, id, ct);
        }

        var f = construite.Facture;
        var syntaxe = SyntaxeDe(p.Format, parametres.FpaSyntaxe);
        byte[] contenu;
        try
        {
            contenu = syntaxe switch
            {
                Syntaxe.Ubl => EcritureUbl.Ecrire(f),
                Syntaxe.FacturX => await FacturXAsync(services, id, EcritureCii.Ecrire(f), f.Profil, u ?? Systeme, ct),
                _ => EcritureCii.Ecrire(f),
            };
        }
        catch (Exception x) when (x is not OperationCanceledException)
        {
            await EcrireEtatAsync(db, id, EtatsEmissionFe.Echec, MotifsEmissionFe.Production, syntaxe, null, Masquage.Texte(x.Message), par, ct);
            if (u is not null) throw;
            return await EtatAsync(db, id, ct);
        }
        var flux = await fe.MettreEnFileAsync(new FluxAEmettre(contenu, NomFichier(f.Numero, syntaxe))
        {
            Syntaxe = syntaxe, Profil = f.Profil, Numero = f.Numero,
            TypeElement = TypesElementFe.Document, IdElement = id.ToString(CultureInfo.InvariantCulture),
        }, u, ct);
        await EcrireEtatAsync(db, id, EtatsEmissionFe.Emise, null, syntaxe, flux.Id, null, par, ct);
        return await EtatAsync(db, id, ct);
    }

    /// <summary>Factur-X : PDF de l'édition de la pièce (modèle par défaut) en PDF/A-3b, XML CII associé.</summary>
    public static async Task<byte[]> FacturXAsync(IServiceProvider services, long id, byte[] xml, string? profil, Utilisateur u, CancellationToken ct)
    {
        var edition = services.GetRequiredService<ServiceEdition>();
        var (pdf, _, _) = await edition.Pdf(services, new DemandeEdition("document", id.ToString(CultureInfo.InvariantCulture)), false, u, ct, OptionFacturX(xml, profil));
        return pdf.Octets;
    }

    /// <summary>
    /// Pièces à émettre de la base de la portée (au plus <paramref name="max"/>) : module et plateforme actifs ; une pièce
    /// prise n'est pas reprise par un autre serveur avant cinq minutes ; échec de production repris trois fois. Rend le nombre traité.
    /// </summary>
    public static async Task<int> TraiterAsync(IServiceProvider services, int max, CancellationToken ct)
    {
        var db = services.GetRequiredService<LogiBtpContext>();
        if (!await ModuleActifAsync(db, ct)) return 0;
        if (!(await services.GetRequiredService<ServiceFactureElectronique>().ParametreAsync(ct)).FpaActif) return 0;
        var n = 0;
        while (n < max)
        {
            var ids = await db.Database.SqlQueryRaw<long>("""
                UPDATE document_fe_emission SET dfe_essais = dfe_essais + 1, dfe_traite_le = now()
                WHERE dfe_ent_id = (SELECT dfe_ent_id FROM document_fe_emission
                                    WHERE (dfe_etat = 'A_EMETTRE' AND (dfe_traite_le IS NULL OR dfe_traite_le < now() - interval '5 minutes'))
                                       OR (dfe_etat = 'ECHEC' AND dfe_motif = 'PRODUCTION' AND dfe_essais < @essais AND dfe_traite_le < now() - interval '1 minute')
                                    ORDER BY dfe_cree_le LIMIT 1 FOR UPDATE SKIP LOCKED)
                RETURNING dfe_ent_id AS "Value"
                """, new NpgsqlParameter("essais", EssaisProduction)).ToListAsync(ct);
            if (ids.Count == 0) break;
            n++;
            try
            {
                await EmettreAsync(services, ids[0], null, ct);
            }
            catch (ExceptionMetier e)
            {
                await EcrireEtatAsync(db, ids[0], EtatsEmissionFe.Echec, MotifsEmissionFe.Production, null, null, $"{e.Code} : {e.Message}", null, ct);
            }
        }
        return n;
    }

    /// <summary>Statut reçu d'une facture émise : statut affiché recopié sur l'émission de la pièce (pastille, colonne des listes).</summary>
    public static async Task StatutRecuAsync(DbContext db, long ent, long flux, string? affiche, CancellationToken ct) =>
        await db.Database.ExecuteSqlRawAsync("UPDATE document_fe_emission SET dfe_statut = @s WHERE dfe_ent_id = @e AND dfe_flux_id = @f",
            [SqlBtp.P("s", affiche, NpgsqlTypes.NpgsqlDbType.Varchar), new NpgsqlParameter("e", ent), new NpgsqlParameter("f", flux)], ct);

    // ---------------------------------------------------------------- routes

    /// <summary>
    /// Routes sous le groupe du module : état de l'émission d'une pièce (Consulter), bouton « Émettre » (Modifier), option
    /// de la société (lecture ; écriture : paramétrage).
    /// </summary>
    public static RouteGroupBuilder MapEnvoiFe(this RouteGroupBuilder api)
    {
        api.MapGet("/facture-electronique/documents/{id:long}/envoi", (long id, HttpContext http, CancellationToken ct) =>
            EtatAsync(http.RequestServices.GetRequiredService<LogiBtpContext>(), id, ct));
        api.MapPost("/facture-electronique/documents/{id:long}/envoi", (long id, HttpContext http, CancellationToken ct) =>
            EmettreAsync(http.RequestServices, id, Utilisateur.Depuis(http), ct));
        api.MapGet("/facture-electronique/emission/option", (HttpContext http, CancellationToken ct) =>
            OptionAsync(http.RequestServices.GetRequiredService<LogiBtpContext>(), ct));
        api.MapPut("/facture-electronique/emission/option", async (OptionEmissionFe o, HttpContext http, CancellationToken ct) =>
        {
            http.RequestServices.GetRequiredService<SpecialisationFactureElectronique>().ExigerParametrage(Utilisateur.Depuis(http));
            return await EnregistrerOptionAsync(http.RequestServices.GetRequiredService<LogiBtpContext>(), o.Automatique, ct);
        });
        return api;
    }
}

/// <summary>Tâche de fond : pièces validées à émettre, base par base, toutes les 15 secondes (section « FactureElectronique »).</summary>
public sealed class PassageEnvoiFe(IServiceProvider services, Microsoft.Extensions.Options.IOptions<OptionsSocietes> societes,
    Microsoft.Extensions.Options.IOptions<OptionsFactureElectronique> options, ILogger<PassageEnvoiFe> journal) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!options.Value.Actif) return;
        while (!ct.IsCancellationRequested)
        {
            await PasserAsync(ct);
            try { await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, options.Value.IntervalleSecondes)), ct); }
            catch (OperationCanceledException) { return; }
        }
    }

    public async Task<int> PasserAsync(CancellationToken ct)
    {
        var total = 0;
        foreach (var societe in societes.Value.Societes())
        {
            try
            {
                await using var portee = services.CreerPorteeSociete(societe);
                var n = await EnvoiFactureBtp.TraiterAsync(portee.ServiceProvider, options.Value.FluxParPassage, ct);
                if (n > 0) journal.LogInformation("Factures électroniques ({Base}) : {Nombre} pièce(s) émise(s)", societe.Code ?? "principale", n);
                total += n;
            }
            catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UndefinedTable) { }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                journal.LogWarning("Factures électroniques ({Base}) : émission non faite ({Erreur})", societe.Code ?? "principale", Masquage.Texte(e.Message));
            }
        }
        return total;
    }
}
