using System.Text.Json.Nodes;
using LogiBTP.Api.Btp;
using LogiBTP.Documents;
using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace LogiBTP.Calcul.Tests;

/// <summary>
/// Zones d'entête des documents (plan fiches-lignes-documents, lot 11) sur la base jetable (LOGIBTP_TEST_PG_JETABLE, mineure
/// 1.2 du module Document appliquée) : zone de la famille V saisie dans un devis, relue avec lui, reprise à la copie et au
/// nouvel indice, refusée si la valeur est incorrecte, contrôlée « obligatoire » à la validation ; la zone et les documents
/// d'essai sont retirés à la fin.
/// </summary>
[Collection(EnvoiFactureBtpTests.CollectionBase)]
public class ZonesEnteteBtpTests
{
    private static readonly Utilisateur Admin = new("admin.test", Profils.Admin);
    private const string Colonne = "x_essai_lot11";

    [Fact]
    public async Task Zone_famille_V_saisie_dans_un_devis_reprise_a_la_copie_et_au_nouvel_indice()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_JETABLE");
        if (string.IsNullOrEmpty(connexion)) return;
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        async Task<object?> Scalaire(string sql, params (string, object)[] p)
        {
            await using var k = new NpgsqlCommand(sql, cnx);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            var r = await k.ExecuteScalarAsync();
            return r is DBNull ? null : r;
        }
        if (await Scalaire("SELECT to_regclass('document_zone_entete')::text") is null) return;
        await using var services = EnvoiFactureBtpTests.Services(connexion);
        var creees = new List<long>();
        using var scope = services.CreateScope();
        var documents = scope.ServiceProvider.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
        var zones = scope.ServiceProvider.GetRequiredService<ZonesEnteteDocument<DocumentBtp, DocumentLigneBtp>>();
        try
        {
            await zones.Creer(new DemandeZoneEntete { Colonne = Colonne, Type = "texte", Libelle = "Essai lot 11", Famille = "V", Obligatoire = true }, Admin, default);
            var devis = (int)(await Scalaire("SELECT tyd_id FROM type_document WHERE tyd_code = 'V_DEVIS'"))!;

            var d = await documents.Creer(new CreationDocument { EntTydId = devis, EntObjet = "Essai zones" }, Admin, default);
            creees.Add(d.Document.EntId);
            var definition = await documents.Definition("V_DEVIS", Admin, default);
            Assert.Contains(definition.Zones, z => z.Colonne == Colonne && z.Obligatoire);
            Assert.DoesNotContain((await documents.Definition("A_COMMANDE", Admin, default)).Zones, z => z.Colonne == Colonne);

            // Valeur incorrecte : refusée.
            d.Zones = new() { [Colonne] = 12 };
            var refus = await Assert.ThrowsAsync<ExceptionMetier>(() => documents.Enregistrer(d.Document.EntId, d, Admin, default));
            Assert.Equal(422, refus.Statut);

            // Saisie, relue avec le document.
            d.Zones = new() { [Colonne] = "  Chantier Dupont " };
            var enregistre = (await documents.Enregistrer(d.Document.EntId, d, Admin, default)).Document!;
            Assert.Equal("Chantier Dupont", enregistre.Zones![Colonne]!.GetValue<string>());
            Assert.Equal("Chantier Dupont", (await documents.Charger(d.Document.EntId, default)).Zones![Colonne]!.GetValue<string>());

            // Un document enregistré sans ses zones (null) les garde.
            enregistre.Zones = null;
            var sans = (await documents.Enregistrer(d.Document.EntId, enregistre, Admin, default)).Document!;
            Assert.Equal("Chantier Dupont", sans.Zones![Colonne]!.GetValue<string>());

            // Copie et nouvel indice : la zone existe dans le type cible (famille V), elle est reprise.
            var copie = await documents.Copier(d.Document.EntId, Admin, default);
            creees.Add(copie.Document.EntId);
            Assert.Equal("Chantier Dupont", copie.Zones![Colonne]!.GetValue<string>());
            var indice = await documents.CreerIndice(d.Document.EntId, Admin, default);
            creees.Add(indice.Document.EntId);
            Assert.Equal("Chantier Dupont", indice.Zones![Colonne]!.GetValue<string>());

            // Obligatoire à la validation : vide, le document est refusé avec ZONE_OBLIGATOIRE.
            copie.Zones = new() { [Colonne] = null };
            var vide = (await documents.Enregistrer(copie.Document.EntId, copie, Admin, default)).Document!;
            var refusee = await Assert.ThrowsAsync<ExceptionMetier>(() => documents.Valider(copie.Document.EntId, new DemandeVersion { EntVersion = vide.Document.EntVersion }, Admin, default));
            Assert.Contains("ZONE_OBLIGATOIRE", System.Text.Json.JsonSerializer.Serialize(refusee.Details, JsonCalcul.Options), StringComparison.Ordinal);
        }
        finally
        {
            foreach (var id in creees.AsEnumerable().Reverse())
            {
                await Scalaire("DELETE FROM document_historique WHERE his_ent_id = @e", ("e", id));
                await Scalaire("DELETE FROM document_lien WHERE lie_source_ent_id = @e OR lie_cible_ent_id = @e", ("e", id));
                await Scalaire("DELETE FROM document WHERE ent_id = @e", ("e", id));
            }
            await zones.Supprimer(Colonne, Admin, default);
        }
    }

    /// <summary>
    /// Lot 12 : zone de la famille V et zone propre au devis saisies dans un devis ; transformation en commande : seule la
    /// zone qui s'applique au type cible est reprise ; colonnes x_ de la liste des documents (affichées, filtrées, retirées
    /// avec la zone) ; valeurs imprimées (document.x_…) et zones du dictionnaire de l'éditeur de modèles.
    /// </summary>
    [Fact]
    public async Task Transformation_reprise_selon_la_portee_colonnes_de_liste_et_edition()
    {
        var connexion = Environment.GetEnvironmentVariable("LOGIBTP_TEST_PG_JETABLE");
        if (string.IsNullOrEmpty(connexion)) return;
        await using var cnx = new NpgsqlConnection(connexion);
        await cnx.OpenAsync();
        async Task<object?> Scalaire(string sql, params (string, object)[] p)
        {
            await using var k = new NpgsqlCommand(sql, cnx);
            foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v);
            var r = await k.ExecuteScalarAsync();
            return r is DBNull ? null : r;
        }
        if (await Scalaire("SELECT to_regclass('document_zone_entete')::text") is null) return;
        if (await Scalaire("SELECT to_regclass('v_liste_documents_zones')::text") is null) return;
        const string famille = "x_essai_lot12", devisSeul = "x_essai_lot12d", achats = "x_essai_lot12a";
        await using var services = EnvoiFactureBtpTests.Services(connexion);
        var creees = new List<long>();
        using var scope = services.CreateScope();
        var documents = scope.ServiceProvider.GetRequiredService<DocumentService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
        var zones = scope.ServiceProvider.GetRequiredService<ZonesEnteteDocument<DocumentBtp, DocumentLigneBtp>>();
        var transformations = scope.ServiceProvider.GetRequiredService<TransformationService<DocumentBtp, DocumentLigneBtp, DocumentCompletBtp>>();
        try
        {
            await zones.Creer(new DemandeZoneEntete { Colonne = famille, Type = "texte", Libelle = "Famille V essai", Famille = "V" }, Admin, default);
            await zones.Creer(new DemandeZoneEntete { Colonne = devisSeul, Type = "texte", Libelle = "Devis seul essai", TypeDocument = "V_DEVIS" }, Admin, default);
            await zones.Creer(new DemandeZoneEntete { Colonne = achats, Type = "texte", Libelle = "Achats essai", Famille = "A" }, Admin, default);

            // La vue de liste suit le registre.
            await Scalaire($"SELECT {famille} FROM v_liste_documents_zones LIMIT 1");

            var client = (long)(await Scalaire("SELECT per_id FROM personne WHERE NOT per_societe_base ORDER BY per_id LIMIT 1"))!;
            var devis = (long)(await Scalaire("""
                WITH d AS (INSERT INTO document (ent_tyd_id, ent_date, ent_std_id, ent_tiers_id, ent_cree_par, ent_total_ht, ent_total_tva,
                                                 ent_total_ttc, ent_net_a_payer, ent_cpa_code, ent_mode_reglement, ent_objet)
                    SELECT t.tyd_id, current_date, (SELECT std_id FROM statut_document WHERE std_code = 'BROUILLON' AND std_tyd_id = t.tyd_id),
                           @tiers, 'test', 150, 30, 180, 180, '30J', 'CHEQUE', 'Essai lot 12'
                    FROM type_document t WHERE t.tyd_code = 'V_DEVIS' RETURNING ent_id),
                l AS (INSERT INTO document_ligne (lig_ent_id, lig_ordre, lig_tyl_id, lig_libelle_html, lig_libelle_brut, lig_qte, lig_qte_vendue, lig_pv,
                                                  lig_pv_remise, lig_montant_ht, lig_tva_id, lig_taux_tva, lig_type_prix, lig_unt_code, lig_pv_fixe, lig_nat_id)
                    SELECT ent_id, 1, 3, 'Travaux', 'Travaux', 3, 3, 50, 50, 150, 1, 20, 'V', 'h', TRUE, (SELECT nat_id FROM nature_element ORDER BY nat_id LIMIT 1) FROM d RETURNING lig_ent_id),
                t AS (INSERT INTO document_tva (tva_ent_id, tva_ttv_id, tva_code, tva_taux, tva_categorie, tva_base_ht, tva_montant, tva_montant_annulation, tva_montant_net)
                    SELECT DISTINCT lig_ent_id, 1, 'T20', 20, 'N', 150, 30, 0, 30 FROM l RETURNING tva_ent_id)
                SELECT tva_ent_id FROM t
                """, ("tiers", client)))!;
            creees.Add(devis);
            await Scalaire($"UPDATE document SET {famille} = 'Valeur V', {devisSeul} = 'Valeur devis', {achats} = 'Valeur achats' WHERE ent_id = @e", ("e", devis));

            // Liste : colonne x_ affichée et filtrée ; ses libellés sont proposés comme titres.
            Assert.Equal("Valeur V", await Scalaire($"SELECT {famille} FROM v_liste_documents_zones WHERE id = @e AND {devisSeul} = 'Valeur devis'", ("e", devis)));
            Assert.Null(await Scalaire($"SELECT id FROM v_liste_documents_zones WHERE id = @e AND {famille} = 'autre'", ("e", devis)));

            // Édition : valeurs imprimées selon la portée, zones et libellés du dictionnaire.
            var donnees = (await SourceDocumentEdition.Lire(services, devis, default))!;
            var docJson = donnees["document"]!.AsObject();
            Assert.Equal("Valeur V", docJson[famille]!.GetValue<string>());
            Assert.Equal("Valeur devis", docJson[devisSeul]!.GetValue<string>());
            Assert.Null(docJson[achats]);
            var dico = await new SpecialisationEditionBtp().DictionnaireAsync(services, "document", default);
            Assert.Contains(dico, e => e!["chemin"]!.GetValue<string>() == "document." + famille && e["libelle"]!.GetValue<string>() == "Famille V essai");

            // Transformation devis -> commande : la zone de famille V est reprise, pas celle du seul devis ni celle des achats.
            var version = (int)(await Scalaire("SELECT ent_version FROM document WHERE ent_id = @e", ("e", devis)))!;
            await documents.Valider(devis, new DemandeVersion { EntVersion = version }, Admin, default);
            var commande = (int)(await Scalaire("SELECT tyd_id FROM type_document WHERE tyd_code = 'V_COMMANDE'"))!;
            var cible = await transformations.Transformer(devis, new DemandeTransformation { CibleTydId = commande }, Admin, default);
            creees.Add(cible.Document.EntId);
            Assert.Equal("Valeur V", await Scalaire($"SELECT {famille} FROM document WHERE ent_id = @e", ("e", cible.Document.EntId)));
            Assert.Null(await Scalaire($"SELECT {devisSeul} FROM document WHERE ent_id = @e", ("e", cible.Document.EntId)));
            Assert.Null(await Scalaire($"SELECT {achats} FROM document WHERE ent_id = @e", ("e", cible.Document.EntId)));
        }
        finally
        {
            foreach (var id in creees.AsEnumerable().Reverse())
            {
                await Scalaire("DELETE FROM document_historique WHERE his_ent_id = @e", ("e", id));
                await Scalaire("DELETE FROM document_lien WHERE lie_source_ent_id = @e OR lie_cible_ent_id = @e", ("e", id));
                await Scalaire("DELETE FROM document WHERE ent_id = @e", ("e", id));
            }
            foreach (var c in new[] { famille, devisSeul, achats })
                if (await Scalaire("SELECT 1 FROM document_zone_entete WHERE zed_colonne = @c", ("c", c)) is not null) await zones.Supprimer(c, Admin, default);
        }
        // Retirée avec la zone : la vue de liste n'a plus la colonne (et le retrait n'a pas été bloqué par la vue).
        Assert.Null(await Scalaire("SELECT 1 FROM information_schema.columns WHERE table_name = 'v_liste_documents_zones' AND column_name = 'x_essai_lot12'"));
    }
}
