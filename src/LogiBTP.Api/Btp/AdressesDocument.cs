using System.Text.Json;
using LogiBTP.Documents;
using LogiBTP.Domaine;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Adresse des travaux (ventes) ou de livraison (achats) d'un document, figée dans ent_adresse_livraison
/// (CONCEPTION-DOCUMENTS-EVOLUTIONS.md, lot F) : { origine CHANTIER | DEPOT | COMPTOIR | LIBRE, source_id, libelle,
/// adresse { ligne1, ligne2, ligne3, code_postal, ville, pays }, contact { ind_id, nom }, telephone, instructions,
/// mention, releve_le }. Ventes : le payeur et l'adresse des travaux restent vides s'ils sont identiques au client
/// (comparaison à l'enregistrement, répliquée par client/src/app/structure/adresses.js). Valeur par défaut : celle du
/// document parent (entête copié), sinon celle du chantier.
/// </summary>
public static class AdressesDocument
{
    private const string ChampContact = "contact";
    private const string ChampTelephone = "telephone";
    private const string ChampIndividuId = "ind_id";

    private const string SqlChantier = """
        SELECT json_build_object('origine', 'CHANTIER', 'source_id', c.cha_id, 'libelle', c.cha_code || ' – ' || c.cha_libelle,
          'adresse', json_build_object('ligne1', c.cha_adresse, 'ligne2', NULL, 'ligne3', NULL, 'code_postal', c.cha_code_postal, 'ville', c.cha_ville, 'pays', 'FR'),
          'contact', (SELECT json_build_object('ind_id', i.ind_id, 'nom', concat_ws(' ', i.ind_civilite, i.ind_prenom, i.ind_nom)) FROM individu i WHERE i.ind_id = c.cha_contact_ind_id),
          'telephone', (SELECT co.coo_valeur FROM usage_coordonnee u JOIN coordonnee co ON co.coo_id = u.uco_coo_id
                        WHERE u.uco_ind_id = c.cha_contact_ind_id AND co.coo_nature = 'TELEPHONE' ORDER BY u.uco_principal DESC, co.coo_id LIMIT 1),
          'instructions', NULL, 'mention', NULL, 'releve_le', current_date)::text AS "Value"
        FROM chantier c WHERE c.cha_id = @id
        """;

    /// <summary>Adresse d'un chantier et son contact sur place (null : chantier introuvable).</summary>
    public static async Task<JsonDocument?> Chantier(DbContext db, int chaId, CancellationToken ct)
    {
        var json = await db.Database.SqlQueryRaw<string>(SqlChantier, new NpgsqlParameter("id", NpgsqlDbType.Integer) { Value = chaId }).ToListAsync(ct);
        return json.Count == 0 ? null : JsonDocument.Parse(json[0]);
    }

    /// <summary>Adresse d'une personne de l'annuaire (dépôt de notre société, comptoir d'un fournisseur).</summary>
    public static async Task<JsonDocument?> Personne(DbContext db, long perId, string origine, CancellationToken ct)
    {
        if (await ContactsDocument.Instantane(db, perId, null, ct) is not { } c) return null;
        var p = c.RootElement;
        var o = new Dictionary<string, object?>
        {
            ["origine"] = origine,
            ["source_id"] = perId,
            ["libelle"] = Texte(p, "raison_sociale"),
            ["adresse"] = p.TryGetProperty("adresse", out var a) && a.ValueKind == JsonValueKind.Object ? a.Clone() : null,
            [ChampContact] = null,
            [ChampTelephone] = Texte(p, ChampTelephone),
            ["instructions"] = null,
            ["mention"] = origine == "COMPTOIR" ? "Retrait au comptoir" : null,
            ["releve_le"] = DateOnly.FromDateTime(DateTime.Today),
        };
        return JsonSerializer.SerializeToDocument(o);
    }

    /// <summary>
    /// Adresses proposées pour un document : le chantier, les dépôts (notre société et ses niveaux inférieurs dans
    /// l'annuaire) et, pour un achat, les comptoirs du fournisseur (le fournisseur et ses niveaux inférieurs).
    /// </summary>
    public static async Task<object> Proposees(DbContext db, int? chantier, long? fournisseur, CancellationToken ct)
    {
        async Task<List<JsonDocument>> Arbre(string origine)
        {
            string racine = origine switch
            {
                "DEPOT" => "SELECT per_id FROM personne WHERE per_societe_base",
                "COMPTOIR" => "SELECT per_id FROM personne WHERE per_id = @f",
                _ => throw new ArgumentException("Origine non supportée", nameof(origine))
            };
            var query = $"""
            WITH RECURSIVE a AS (
                {racine} 
                UNION 
                SELECT p.per_id FROM personne p JOIN a ON p.per_parent_id = a.per_id WHERE p.per_actif
            )
            SELECT per_id AS "Value" FROM a ORDER BY per_id LIMIT 50
            """;
            var param = new NpgsqlParameter("f", NpgsqlDbType.Bigint) { Value = (object?)fournisseur ?? DBNull.Value };
    
            // On récupère d'abord les IDs pour libérer la connexion EF Core
            var ids = await db.Database.SqlQueryRaw<long>(query, param).ToListAsync(ct);
            var res = new List<JsonDocument>();
            foreach (var id in ids) if (await Personne(db, id, origine, ct) is { } x) res.Add(x);
            return res;
        }
        return new
        {
            chantier = chantier is int c ? await Chantier(db, c, ct) : null,
            depots = await Arbre("DEPOT"),
            comptoirs = fournisseur is null ? [] : await Arbre("COMPTOIR"),
        };
    }

    // ------------------------------------------------------------------ comparaison avec le client

    private static string? Texte(JsonElement e, string nom) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(nom, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long? Entier(JsonElement e, string nom) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(nom, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : null;

    private static JsonElement Objet(JsonElement e, string nom) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(nom, out var v) && v.ValueKind == JsonValueKind.Object ? v : default;

    /// <summary>Texte comparé : espaces réduits, sans casse ; vide = null.</summary>
    public static string Normaliser(string? t) => string.Join(' ', (t ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToUpperInvariant();

    private static readonly string[] ChampsAdresse = ["ligne1", "ligne2", "ligne3", "code_postal", "ville"];

    /// <summary>Même adresse postale (lignes, code postal, ville, pays FR par défaut).</summary>
    public static bool MemeAdresse(JsonElement a, JsonElement b) =>
        ChampsAdresse.All(c => Normaliser(Texte(a, c)) == Normaliser(Texte(b, c)))
        && Normaliser(Texte(a, "pays") ?? "FR") == Normaliser(Texte(b, "pays") ?? "FR");

    /// <summary>
    /// Adresse des travaux identique au client : même adresse, sans instructions ni mention, contact absent ou celui du
    /// client, téléphone absent ou celui du client.
    /// </summary>
    public static bool AdresseIdentiqueAuClient(JsonDocument? adresse, JsonDocument? client)
    {
        if (adresse is null || client is null) return false;
        var a = adresse.RootElement;
        var c = client.RootElement;
        if (!MemeAdresse(Objet(a, "adresse"), Objet(c, "adresse"))) return false;
        if (Normaliser(Texte(a, "instructions")) != "" || Normaliser(Texte(a, "mention")) != "") return false;
        var contact = Entier(Objet(a, ChampContact), ChampIndividuId);
        if (contact is not null && contact != Entier(Objet(c, ChampContact), ChampIndividuId)) return false;
        var tel = Normaliser(Texte(a, ChampTelephone));
        return tel == "" || tel == Normaliser(Texte(c, ChampTelephone));
    }

    /// <summary>Payeur identique au client : même personne et même contact.</summary>
    public static bool PayeurIdentiqueAuClient(JsonDocument? payeur, JsonDocument? client)
    {
        if (payeur is null || client is null) return false;
        var p = payeur.RootElement;
        var c = client.RootElement;
        return Entier(p, "per_id") == Entier(c, "per_id") && Entier(Objet(p, ChampContact), ChampIndividuId) == Entier(Objet(c, ChampContact), ChampIndividuId);
    }

    /// <summary>Ventes : payeur et adresse des travaux vidés s'ils sont identiques au client (enregistrement, validation).</summary>
    public static void ViderIdentiques(DocumentBtp d, string famille)
    {
        if (famille != FamillesDocument.Vente) return;
        if (PayeurIdentiqueAuClient(d.EntContactPayeur, d.EntContactClient)) d.EntContactPayeur = null;
        if (AdresseIdentiqueAuClient(d.EntAdresseLivraison, d.EntContactClient)) d.EntAdresseLivraison = null;
    }

    /// <summary>Adresse vide d'un document rattaché à un chantier : celle du chantier (validation).</summary>
    public static async Task Completer(DbContext db, DocumentBtp d, string famille, CancellationToken ct)
    {
        if (d.EntAdresseLivraison is null && d.EntChantierId is int c) d.EntAdresseLivraison = await Chantier(db, c, ct);
        ViderIdentiques(d, famille);
    }
}
