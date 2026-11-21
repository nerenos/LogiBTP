using System.Text.Json;
using LogiBTP.Socle;
using LogiBTP.Socle.Donnees;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Documents.Web;

/// <summary>Registre des zones supplémentaires d'entête (document_zone_entete, module Document 1.2) : écrit par document_zone_creer / document_zone_retirer.</summary>
public class ZoneEnteteParametre
{
    public string ZedColonne { get; set; } = "";
    public string ZedType { get; set; } = "";
    public string ZedLibelle { get; set; } = "";
    public string? ZedGroupe { get; set; }
    public int ZedOrdre { get; set; }
    public bool ZedObligatoire { get; set; }
    public JsonDocument? ZedValeurs { get; set; }
    public string? ZedFamille { get; set; }
    public int? ZedTydId { get; set; }
    public bool ZedActif { get; set; } = true;
    public DateTimeOffset ZedCreeLe { get; set; }
    public DateTimeOffset ZedModifieLe { get; set; }
}

/// <summary>Demande de création d'une zone d'entête : famille et type de document (code) nuls = global ; un seul des deux au plus.</summary>
public sealed class DemandeZoneEntete
{
    public string Colonne { get; set; } = "";
    public string Type { get; set; } = "";
    public string Libelle { get; set; } = "";
    public string? Groupe { get; set; }
    public int Ordre { get; set; }
    public bool Obligatoire { get; set; }
    public List<OptionZone>? Valeurs { get; set; }
    public string? Famille { get; set; }
    public string? TypeDocument { get; set; }
}

/// <summary>Modification : libellé, groupe, ordre, obligatoire, valeurs d'une liste, portée, actif (le type et la colonne ne changent jamais).</summary>
public sealed class ModificationZoneEntete
{
    public string Libelle { get; set; } = "";
    public string? Groupe { get; set; }
    public int Ordre { get; set; }
    public bool Obligatoire { get; set; }
    public List<OptionZone>? Valeurs { get; set; }
    public string? Famille { get; set; }
    public string? TypeDocument { get; set; }
    public bool Actif { get; set; } = true;
}

/// <summary>
/// Administration des zones supplémentaires d'entête, en colonnes « x_ » de la seule table document (administrateur
/// seulement, <c>u.ExigerAdmin()</c>). Le DDL n'est jamais émis ici : il passe par les fonctions SQL SECURITY DEFINER
/// document_zone_creer / document_zone_retirer (module Document 1.2), dans l'unité d'écriture ; après création ou
/// suppression, les caches des colonnes de la base (<see cref="IPurgeCacheBase"/> : schémas des listes) sont vidés.
/// <see cref="Zones"/> sert la lecture par le document (sans droit particulier : les zones d'un type se déduisent de leur portée).
/// </summary>
public class ZonesEnteteDocument<TDoc, TLigne>(DocumentDbContext<TDoc, TLigne> db, IEnumerable<IPurgeCacheBase> purges)
    where TDoc : Document, new()
    where TLigne : DocumentLigne, new()
{
    private static readonly JsonSerializerOptions JsonValeurs = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    private static ExceptionMetier Refus(IEnumerable<ErreurZone> erreurs) =>
        Controles.Refus(erreurs.Select(e => new ChampEnErreur(e.Champ, e.Code, Message(e.Code))).ToList());

    private static ExceptionMetier Refus(string champ, string code) => Refus([new ErreurZone(champ, code)]);

    private static string Message(string code) => code switch
    {
        ErreursZoneEntete.NomInvalide => "Nom de colonne invalide : « x_ », puis minuscules, chiffres et _ (43 caractères au plus)",
        ErreursZoneEntete.TypeInvalide => "Type de zone non permis",
        ErreursZoneEntete.LibelleObligatoire => $"Libellé obligatoire ({ZonesEntete.LongueurLibelle} caractères au plus)",
        ErreursZoneEntete.Valeurs => $"Une liste demande au moins une valeur, sans doublon ({ZonesEntete.LongueurValeur} caractères au plus)",
        ErreursZoneEntete.PorteeInvalide => "Portée invalide : une famille ou un type de document connu, pas les deux",
        ErreursZoneEntete.Existe => "Cette colonne existe déjà dans le document",
        ErreursZoneEntete.Inconnue => "Zone d'entête inconnue",
        _ => "Zone d'entête refusée",
    };

    private static List<OptionZone>? LireValeurs(JsonDocument? json)
    {
        if (json is null) return null;
        try { return json.Deserialize<List<OptionZone>>(JsonValeurs) ?? []; }
        catch (JsonException) { return []; }
    }

    private static string? Valeurs(string type, IEnumerable<OptionZone>? valeurs) => type != TypesZoneEntete.Liste ? null
        : JsonSerializer.Serialize((valeurs ?? []).Select(v => new OptionZone { Valeur = v.Valeur, Libelle = string.IsNullOrWhiteSpace(v.Libelle) ? v.Valeur : v.Libelle }), JsonValeurs);

    /// <summary>Zones du registre (actives ou non) dans l'ordre famille, type, groupe, ordre, colonne ; le type de document par son code.</summary>
    public virtual async Task<List<ZoneEntete>> Zones(CancellationToken ct)
    {
        var types = (await db.TypesDocument.AsNoTracking().Select(t => new { t.TydId, t.TydCode }).ToListAsync(ct)).ToDictionary(t => t.TydId, t => t.TydCode);
        return (await db.Set<ZoneEnteteParametre>().AsNoTracking().OrderBy(z => z.ZedGroupe).ThenBy(z => z.ZedOrdre).ThenBy(z => z.ZedColonne).ToListAsync(ct))
            .Select(z => new ZoneEntete(z.ZedColonne, z.ZedType, z.ZedLibelle, z.ZedGroupe, z.ZedOrdre, z.ZedObligatoire, LireValeurs(z.ZedValeurs),
                z.ZedFamille, z.ZedTydId is int t ? types.GetValueOrDefault(t) : null, z.ZedActif)).ToList();
    }

    public virtual async Task<List<ZoneEntete>> Lister(Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        return await Zones(ct);
    }

    /// <summary>Identifiant du type de document d'un code ; null si le code est absent, refus 422 s'il est inconnu.</summary>
    private async Task<int?> TypeId(string? code, string champ, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(code)) return null;
        return await db.TypesDocument.AsNoTracking().Where(t => t.TydCode == code).Select(t => (int?)t.TydId).FirstOrDefaultAsync(ct)
            ?? throw Refus(champ, ErreursZoneEntete.PorteeInvalide);
    }

    public virtual async Task<ZoneEntete> Creer(DemandeZoneEntete d, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        var erreurs = ZonesEntete.ErreursCreation(d.Colonne, d.Type, d.Libelle, d.Valeurs, d.Famille, d.TypeDocument);
        if (erreurs.Count > 0) throw Refus(erreurs);
        var tydId = await TypeId(d.TypeDocument, d.Colonne, ct);
        var valeurs = Valeurs(d.Type, d.Valeurs);
        try
        {
            await db.Unite().ExecuterAsync(async ctu =>
            {
                var unite = db.Unite();
                await using var cmd = new NpgsqlCommand("SELECT document_zone_creer(@c, @y, @l, @g, @o, @ob, CAST(@v AS jsonb), @f, @t)", unite.Connexion, unite.Transaction);
                cmd.Parameters.AddWithValue("c", d.Colonne);
                cmd.Parameters.AddWithValue("y", d.Type);
                cmd.Parameters.AddWithValue("l", d.Libelle);
                cmd.Parameters.Add(new NpgsqlParameter("g", NpgsqlDbType.Text) { Value = (object?)d.Groupe ?? DBNull.Value });
                cmd.Parameters.AddWithValue("o", d.Ordre);
                cmd.Parameters.AddWithValue("ob", d.Obligatoire);
                cmd.Parameters.Add(new NpgsqlParameter("v", NpgsqlDbType.Text) { Value = (object?)valeurs ?? DBNull.Value });
                cmd.Parameters.Add(new NpgsqlParameter("f", NpgsqlDbType.Text) { Value = (object?)d.Famille ?? DBNull.Value });
                cmd.Parameters.Add(new NpgsqlParameter("t", NpgsqlDbType.Integer) { Value = (object?)tydId ?? DBNull.Value });
                await cmd.ExecuteNonQueryAsync(ctu);
                return true;
            }, ct);
        }
        catch (PostgresException e) when (Traduire(e, d.Colonne) is { } erreur)
        {
            throw Refus([erreur]);
        }
        PurgerCaches();
        return (await Zones(ct)).First(z => z.Colonne == d.Colonne);
    }

    public virtual async Task<ZoneEntete> Modifier(string colonne, ModificationZoneEntete m, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        var zone = await db.Set<ZoneEnteteParametre>().AsNoTracking().FirstOrDefaultAsync(z => z.ZedColonne == colonne, ct)
            ?? throw ExceptionMetier.Introuvable($"Zone d'entête {colonne}");
        var erreurs = ZonesEntete.ErreursModification(colonne, zone.ZedType, m.Libelle, m.Valeurs, m.Famille, m.TypeDocument);
        if (erreurs.Count > 0) throw Refus(erreurs);
        var tydId = await TypeId(m.TypeDocument, colonne, ct);
        var valeurs = Valeurs(zone.ZedType, m.Valeurs);
        await db.Unite().ExecuterAsync(async ctu =>
        {
            var unite = db.Unite();
            await using var cmd = new NpgsqlCommand("""
                UPDATE document_zone_entete
                   SET zed_libelle = @l, zed_groupe = nullif(btrim(coalesce(@g, '')), ''), zed_ordre = @o, zed_obligatoire = @ob,
                       zed_valeurs = CAST(@v AS jsonb), zed_famille = @f, zed_tyd_id = @t, zed_actif = @a, zed_modifie_le = now()
                 WHERE zed_colonne = @c
                """, unite.Connexion, unite.Transaction);
            cmd.Parameters.AddWithValue("l", m.Libelle.Trim());
            cmd.Parameters.Add(new NpgsqlParameter("g", NpgsqlDbType.Text) { Value = (object?)m.Groupe ?? DBNull.Value });
            cmd.Parameters.AddWithValue("o", m.Ordre);
            cmd.Parameters.AddWithValue("ob", m.Obligatoire && zone.ZedType != TypesZoneEntete.CaseACocher);
            cmd.Parameters.Add(new NpgsqlParameter("v", NpgsqlDbType.Text) { Value = (object?)valeurs ?? DBNull.Value });
            cmd.Parameters.Add(new NpgsqlParameter("f", NpgsqlDbType.Text) { Value = (object?)m.Famille ?? DBNull.Value });
            cmd.Parameters.Add(new NpgsqlParameter("t", NpgsqlDbType.Integer) { Value = (object?)tydId ?? DBNull.Value });
            cmd.Parameters.AddWithValue("a", m.Actif);
            cmd.Parameters.AddWithValue("c", colonne);
            await cmd.ExecuteNonQueryAsync(ctu);
            return true;
        }, ct);
        return (await Zones(ct)).First(z => z.Colonne == colonne);
    }

    /// <summary>Retire la colonne et son inscription (les valeurs saisies sont perdues : l'interface demande confirmation).</summary>
    public virtual async Task Supprimer(string colonne, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        if (!ZonesEntete.NomValide(colonne)) throw Refus(colonne, ErreursZoneEntete.NomInvalide);
        if (!await db.Set<ZoneEnteteParametre>().AnyAsync(z => z.ZedColonne == colonne, ct)) throw ExceptionMetier.Introuvable($"Zone d'entête {colonne}");
        try
        {
            await db.Unite().ExecuterAsync(async ctu =>
            {
                var unite = db.Unite();
                await using var cmd = new NpgsqlCommand("SELECT document_zone_retirer(@c)", unite.Connexion, unite.Transaction);
                cmd.Parameters.AddWithValue("c", colonne);
                await cmd.ExecuteNonQueryAsync(ctu);
                return true;
            }, ct);
        }
        catch (PostgresException e) when (Traduire(e, colonne) is { } erreur)
        {
            throw Refus([erreur]);
        }
        PurgerCaches();
    }

    /// <summary>Erreur d'une fonction SQL (« CODE : message ») traduite en erreur de zone ; null si ce n'est pas l'une des nôtres.</summary>
    private static ErreurZone? Traduire(PostgresException e, string colonne)
    {
        var code = e.MessageText.Split(' ', 2)[0];
        return code.StartsWith("ZONE_", StringComparison.Ordinal) ? new ErreurZone(colonne, code) : null;
    }

    /// <summary>Colonnes de la base de la société courante modifiées : caches des colonnes vidés (listes).</summary>
    private void PurgerCaches()
    {
        var connexion = db.Database.GetConnectionString();
        if (connexion is null) return;
        foreach (var p in purges) p.Purger(connexion);
    }
}
