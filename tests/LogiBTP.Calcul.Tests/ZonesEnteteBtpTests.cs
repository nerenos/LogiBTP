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
}
