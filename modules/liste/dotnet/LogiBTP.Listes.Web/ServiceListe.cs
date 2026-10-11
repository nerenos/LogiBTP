using System.Collections.Concurrent;
using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using LogiBTP.Listes;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Listes.Web;

/// <summary>Colonnes des sources déjà interrogées (le schéma d'une vue change rarement ; vidé au redémarrage).</summary>
public sealed class CacheSchemas
{
    public ConcurrentDictionary<string, IReadOnlyList<ColonneSource>> Colonnes { get; } = new(StringComparer.Ordinal);
}

/// <summary>
/// Services du module Liste (classe mère) : vues (lecture, enregistrement, partage), sources, et données
/// (lots, segments, contrôle, lignes ciblées). Toute requête de données s'exécute dans une transaction en
/// lecture seule, avec un délai maximal, sur une source encadrée en sous-requête.
/// </summary>
public partial class ServiceListe(ListeDbContext db, SpecialisationListe specialisation, CacheSchemas cache)
{
    protected ListeDbContext Db => db;
    protected SpecialisationListe Specialisation => specialisation;

    [GeneratedRegex(@"^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$")]
    private static partial Regex NomVue();

    private static ExceptionMetier Invalide(ErreurListe e) => ExceptionMetier.Invalide(e.Code, e.Message);

    // ------------------------------------------------------------------ vues

    public virtual async Task<List<ResumeVue>> Vues(string? contexte, string? theme, Utilisateur u, CancellationToken ct)
    {
        var vues = await db.Vues.AsNoTracking()
            .Where(v => (contexte == null || v.VliContexte == contexte) && (theme == null || v.VliTheme == theme))
            .OrderBy(v => v.VliNom).ToListAsync(ct);
        return vues.Where(v => specialisation.PeutVoir(v, u))
            .Select(v => new ResumeVue(v.VliId, v.VliNom, v.VliContexte, v.VliTheme, v.VliPartage, v.VliProprietaire, specialisation.PeutModifier(v, u))).ToList();
    }

    // ------------------------------------------------------------------ thèmes

    protected static ThemeListeDto VersDto(ThemeListe t) => new()
    {
        ThlCode = t.ThlCode, ThlLibelle = t.ThlLibelle, ThlIcone = t.ThlIcone, ThlOrdre = t.ThlOrdre, ThlActif = t.ThlActif,
        ThlTypes = t.ThlTypes.Deserialize<List<TypeElementTheme>>(JsonCalcul.Options) ?? [],
    };

    public virtual async Task<List<ThemeListeDto>> Themes(CancellationToken ct) =>
        (await db.Themes.AsNoTracking().Where(t => t.ThlActif).OrderBy(t => t.ThlOrdre).ThenBy(t => t.ThlLibelle).ToListAsync(ct)).Select(VersDto).ToList();

    public virtual async Task<ThemeListeDto> EnregistrerTheme(string code, ThemeListeDto dto, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutGererThemes(u)) throw ExceptionMetier.AccesRefuse("THEMES");
        if (string.IsNullOrWhiteSpace(code) || code.Length > 50) throw ExceptionMetier.Invalide("THEME", "Code de thème obligatoire (50 caractères au plus)");
        if (string.IsNullOrWhiteSpace(dto.ThlLibelle)) throw ExceptionMetier.Invalide("THEME", "Libellé du thème obligatoire");
        var types = dto.ThlTypes.Where(t => !string.IsNullOrWhiteSpace(t.Code))
            .Select(t => new TypeElementTheme { Code = t.Code.Trim(), Libelle = string.IsNullOrWhiteSpace(t.Libelle) ? t.Code.Trim() : t.Libelle.Trim() })
            .DistinctBy(t => t.Code).ToList();
        var theme = await db.Themes.FirstOrDefaultAsync(t => t.ThlCode == code, ct);
        if (theme is null)
        {
            theme = new ThemeListe { ThlCode = code.Trim() };
            db.Themes.Add(theme);
        }
        theme.ThlLibelle = dto.ThlLibelle.Trim();
        theme.ThlIcone = string.IsNullOrWhiteSpace(dto.ThlIcone) ? null : dto.ThlIcone.Trim();
        theme.ThlOrdre = dto.ThlOrdre;
        theme.ThlActif = dto.ThlActif;
        theme.ThlTypes = JsonSerializer.SerializeToDocument(types, JsonCalcul.Options);
        await db.SaveChangesAsync(ct);
        return VersDto(theme);
    }

    /// <summary>Suppression d'un thème : ses vues restent, sans thème (vli_theme à NULL par la clé étrangère).</summary>
    public virtual async Task SupprimerTheme(string code, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutGererThemes(u)) throw ExceptionMetier.AccesRefuse("THEMES");
        var theme = await db.Themes.FirstOrDefaultAsync(t => t.ThlCode == code, ct) ?? throw ExceptionMetier.Introuvable($"Thème {code}");
        db.Themes.Remove(theme);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Types d'élément d'un thème (vide = tous, ou thème inconnu).</summary>
    protected async Task<IReadOnlyList<string>> TypesTheme(string? code, CancellationToken ct)
    {
        if (code is null) return [];
        var theme = await db.Themes.AsNoTracking().FirstOrDefaultAsync(t => t.ThlCode == code, ct);
        return theme is null ? [] : VersDto(theme).ThlTypes.Select(t => t.Code).ToList();
    }

    protected async Task<VueListe> Charger(long id, Utilisateur u, CancellationToken ct)
    {
        var v = await db.Vues.AsNoTracking().FirstOrDefaultAsync(x => x.VliId == id, ct) ?? throw ExceptionMetier.Introuvable($"Vue {id}");
        if (!specialisation.PeutVoir(v, u)) throw ExceptionMetier.AccesRefuse("VOIR");
        return v;
    }

    protected VueListeDto VersDto(VueListe v, Utilisateur u) => new()
    {
        VliId = v.VliId, VliNom = v.VliNom, VliContexte = v.VliContexte, VliTheme = v.VliTheme, VliPartage = v.VliPartage, VliProprietaire = v.VliProprietaire,
        VliGroupe = v.VliGroupe, VliVersion = v.VliVersion, Modifiable = specialisation.PeutModifier(v, u),
        Definition = v.VliDefinition.RootElement.Clone(),
    };

    public virtual async Task<VueListeDto> Vue(long id, Utilisateur u, CancellationToken ct) => VersDto(await Charger(id, u, ct), u);

    public static DefinitionVue LireDefinition(JsonElement json)
    {
        try
        {
            return json.Deserialize<DefinitionVue>(JsonCalcul.Options) ?? throw new ErreurListe("DEFINITION", "Définition de vue vide");
        }
        catch (JsonException e)
        {
            throw new ErreurListe("DEFINITION", $"Définition de vue illisible : {e.Message}");
        }
    }

    public virtual async Task<VueListeDto> Enregistrer(VueListeDto dto, Utilisateur u, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(dto.VliNom)) throw ExceptionMetier.Invalide("NOM", "Nom de la vue obligatoire");
        if (dto.VliPartage is not ("P" or "G" or "T")) throw ExceptionMetier.Invalide("PARTAGE", "Partage P, G ou T");
        DefinitionVue def;
        try
        {
            def = LireDefinition(dto.Definition);
            if (def.Source.Mode == "requete")
            {
                // Une requête manuelle ne s'écrit que par un ADMIN ; une vue existante peut garder la sienne.
                var existante = dto.VliId is long vid ? await db.Vues.AsNoTracking().FirstOrDefaultAsync(x => x.VliId == vid, ct) : null;
                var avant = existante is null ? null : LireDefinition(existante.VliDefinition.RootElement).Source.Requete;
                if (!specialisation.PeutSaisirRequete(u) && avant != def.Source.Requete) throw ExceptionMetier.AccesRefuse("REQUETE");
                ValidationRequete.Valider(def.Source.Requete);
            }
            else if (def.Source.Vue is null || !await db.Sources.AnyAsync(s => s.SliCode == def.Source.Vue && s.SliActif, ct))
            {
                throw new ErreurListe("SOURCE", $"Source {def.Source.Vue} inconnue");
            }
            if (def.Theme is not null && !await db.Themes.AnyAsync(t => t.ThlCode == def.Theme, ct))
            {
                throw new ErreurListe("THEME", $"Thème {def.Theme} inconnu");
            }
        }
        catch (ErreurListe e)
        {
            throw Invalide(e);
        }

        VueListe v;
        if (dto.VliId is long id)
        {
            v = await db.Vues.FirstOrDefaultAsync(x => x.VliId == id, ct) ?? throw ExceptionMetier.Introuvable($"Vue {id}");
            if (!specialisation.PeutModifier(v, u)) throw ExceptionMetier.AccesRefuse("MODIFIER");
            if (v.VliVersion != dto.VliVersion) throw ExceptionMetier.Conflit("VERSION", "La vue a été modifiée par ailleurs : rechargez-la");
            v.VliVersion++;
            v.VliModifieLe = DateTimeOffset.UtcNow;
        }
        else
        {
            v = new VueListe { VliProprietaire = u.Code, VliCreeLe = DateTimeOffset.UtcNow };
            db.Vues.Add(v);
        }
        v.VliNom = dto.VliNom.Trim();
        v.VliContexte = dto.VliContexte;
        v.VliTheme = def.Theme;
        v.VliPartage = dto.VliPartage;
        v.VliGroupe = dto.VliPartage == "G" ? dto.VliGroupe ?? u.Groupe : null;
        v.VliDefinition = JsonDocument.Parse(dto.Definition.GetRawText());
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw ExceptionMetier.Conflit("VERSION", "La vue a été modifiée par ailleurs : rechargez-la");
        }
        return VersDto(v, u);
    }

    public virtual async Task Supprimer(long id, Utilisateur u, CancellationToken ct)
    {
        var v = await db.Vues.FirstOrDefaultAsync(x => x.VliId == id, ct) ?? throw ExceptionMetier.Introuvable($"Vue {id}");
        if (!specialisation.PeutModifier(v, u)) throw ExceptionMetier.AccesRefuse("SUPPRIMER");
        db.Vues.Remove(v);
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ sources

    protected static string SqlSource(SourceListe s)
    {
        if (!NomVue().IsMatch(s.SliVue)) throw new ErreurListe("SOURCE", $"Nom de vue invalide : {s.SliVue}");
        return "SELECT * FROM " + string.Join(".", s.SliVue.Split('.').Select(ConstructeurRequete.Identifiant));
    }

    public virtual async Task<List<SourceDto>> Sources(CancellationToken ct)
    {
        var res = new List<SourceDto>();
        foreach (var s in await db.Sources.AsNoTracking().Where(x => x.SliActif).OrderBy(x => x.SliLibelle).ToListAsync(ct))
        {
            try
            {
                res.Add(new SourceDto(s.SliCode, s.SliLibelle, await Colonnes(SqlSource(s), ct), s.SliColonneId, s.SliColonneType, s.SliTypeElement));
            }
            catch (ExceptionMetier)
            {
                // Source déclarée mais vue SQL absente ou invalide : non proposée.
            }
        }
        return res;
    }

    public virtual async Task<IReadOnlyList<ColonneSource>> ColonnesRequete(string? requete, Utilisateur u, CancellationToken ct)
    {
        if (!specialisation.PeutSaisirRequete(u)) throw ExceptionMetier.AccesRefuse("REQUETE");
        try
        {
            return await Colonnes(ValidationRequete.Valider(requete), ct);
        }
        catch (ErreurListe e)
        {
            throw Invalide(e);
        }
    }

    /// <summary>Colonnes et types d'une source, lus sans aucune ligne (LIMIT 0).</summary>
    protected async Task<IReadOnlyList<ColonneSource>> Colonnes(string sql, CancellationToken ct)
    {
        if (cache.Colonnes.TryGetValue(sql, out var connues)) return connues;
        var colonnes = await Executer(ConstructeurRequete.Schema(sql), async cmd =>
        {
            await using var rd = await cmd.ExecuteReaderAsync(CommandBehavior.SchemaOnly, ct);
            return Enumerable.Range(0, rd.FieldCount).Select(i => new ColonneSource(rd.GetName(i), rd.GetDataTypeName(i))).ToList();
        }, ct);
        if (colonnes.Select(c => c.Code).Distinct(StringComparer.Ordinal).Count() != colonnes.Count)
            throw ExceptionMetier.Invalide("COLONNES_DOUBLES", "La source contient des colonnes de même nom : donnez-leur un alias");
        cache.Colonnes[sql] = colonnes;
        return colonnes;
    }

    /// <summary>
    /// Source effective d'une demande : définition fournie (concepteur) ou enregistrée. Une requête manuelle
    /// non enregistrée telle quelle n'est exécutée que pour un utilisateur autorisé à la saisir.
    /// </summary>
    protected virtual async Task<(SourceResolue Source, DefinitionVue Definition)> Resoudre(DemandeListe d, Utilisateur u, CancellationToken ct)
    {
        try
        {
            DefinitionVue? enregistree = null;
            if (d.VueId is long id) enregistree = LireDefinition((await Charger(id, u, ct)).VliDefinition.RootElement);
            var def = d.Definition is { ValueKind: JsonValueKind.Object } json ? LireDefinition(json) : enregistree
                ?? throw new ErreurListe("VUE", "Vue ou définition attendue");
            string sql;
            string? colonneId = def.Source.ColonneId, colonneType = def.Source.ColonneType, typeElement = def.Source.TypeElement;
            if (def.Source.Mode == "requete")
            {
                var autorisee = specialisation.PeutSaisirRequete(u)
                    || (enregistree?.Source.Mode == "requete" && enregistree.Source.Requete == def.Source.Requete);
                if (!autorisee) throw ExceptionMetier.AccesRefuse("REQUETE");
                sql = ValidationRequete.Valider(def.Source.Requete);
            }
            else
            {
                var s = await db.Sources.AsNoTracking().FirstOrDefaultAsync(x => x.SliCode == def.Source.Vue && x.SliActif, ct)
                    ?? throw new ErreurListe("SOURCE", $"Source {def.Source.Vue} inconnue");
                sql = SqlSource(s);
                colonneId ??= s.SliColonneId;
                if (colonneType is null && typeElement is null) { colonneType = s.SliColonneType; typeElement = s.SliTypeElement; }
            }
            if (colonneId is null) throw new ErreurListe("COLONNE_ID", "Colonne identifiant obligatoire");
            if (colonneType is null && typeElement is null) throw new ErreurListe("TYPE_ELEMENT", "Type d'élément obligatoire");
            return (new SourceResolue(sql, await Colonnes(sql, ct), colonneId, colonneType, typeElement), def);
        }
        catch (ErreurListe e)
        {
            throw Invalide(e);
        }
    }

    protected async Task<ConstructeurRequete> Constructeur(DemandeListe d, Utilisateur u, CancellationToken ct)
    {
        var (source, def) = await Resoudre(d, u, ct);
        var types = await TypesTheme(def.Theme, ct);
        try
        {
            var c = specialisation.Constructeur(source, def, d);
            c.TypesTheme = types;
            return c;
        }
        catch (ErreurListe e)
        {
            throw Invalide(e);
        }
    }

    // ------------------------------------------------------------------ données

    public virtual async Task<ReponseLot> Lot(DemandeListe d, Utilisateur u, CancellationToken ct)
    {
        var c = await Constructeur(d, u, ct);
        var taille = Math.Clamp(d.Taille, 1, specialisation.TailleLotMax);
        var tri = c.Tri();
        var lignes = await Lignes(Requete(() => c.Lot(taille)), ct);
        List<string?>? suite = null;
        if (lignes.Count > taille)
        {
            lignes.RemoveAt(lignes.Count - 1);
            var derniere = lignes[^1];
            suite = [.. Enumerable.Range(0, tri.Count).Select(i => derniere[$"_t{i}"] as string), derniere["_tid"] as string];
        }
        foreach (var l in lignes)
        {
            for (var i = 0; i < tri.Count; i++) l.Remove($"_t{i}");
            l.Remove("_tid");
        }
        return new ReponseLot(lignes, suite);
    }

    public virtual async Task<List<CompteSegment>> Segments(DemandeListe d, Utilisateur u, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(d.Colonne)) throw ExceptionMetier.Invalide("COLONNE", "Colonne de segment attendue");
        var c = await Constructeur(d, u, ct);
        var lignes = await Lignes(Requete(() => c.Segments(d.Colonne)), ct);
        return lignes.Select(l => new CompteSegment(l["valeur"] as string, Convert.ToInt64(l["nombre"]))).ToList();
    }

    public virtual async Task<List<EtatLigne>> Controle(DemandeListe d, Utilisateur u, CancellationToken ct)
    {
        var c = await Constructeur(d, u, ct);
        var lignes = await Lignes(Requete(c.Controle), ct);
        return lignes.Select(l => new EtatLigne((string)l["id"]!, (string)l["h"]!)).ToList();
    }

    public virtual async Task<List<Dictionary<string, object?>>> LignesCiblees(DemandeListe d, Utilisateur u, CancellationToken ct)
    {
        var ids = (d.Ids ?? []).Distinct().Take(specialisation.IdsMax).ToList();
        if (ids.Count == 0) return [];
        var c = await Constructeur(d, u, ct);
        return await Lignes(Requete(() => c.Lignes(ids)), ct);
    }

    private static RequeteSql Requete(Func<RequeteSql> f)
    {
        try
        {
            return f();
        }
        catch (ErreurListe e)
        {
            throw Invalide(e);
        }
    }

    // ------------------------------------------------------------------ exécution en lecture seule

    protected Task<List<Dictionary<string, object?>>> Lignes(RequeteSql r, CancellationToken ct) => Executer(r, async cmd =>
    {
        var res = new List<Dictionary<string, object?>>();
        await using var rd = await cmd.ExecuteReaderAsync(ct);
        while (await rd.ReadAsync(ct))
        {
            var l = new Dictionary<string, object?>(rd.FieldCount, StringComparer.Ordinal);
            for (var i = 0; i < rd.FieldCount; i++) l[rd.GetName(i)] = rd.IsDBNull(i) ? null : rd.GetValue(i);
            res.Add(l);
        }
        return res;
    }, ct);

    protected async Task<T> Executer<T>(RequeteSql r, Func<NpgsqlCommand, Task<T>> lire, CancellationToken ct)
    {
        var cnx = (NpgsqlConnection)db.Database.GetDbConnection();
        var ouverte = cnx.State == ConnectionState.Open;
        if (!ouverte) await cnx.OpenAsync(ct);
        try
        {
            await using var tx = await cnx.BeginTransactionAsync(ct);
            await using (var cadre = new NpgsqlCommand($"SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = {specialisation.DelaiRequeteMs}", cnx, tx))
            {
                await cadre.ExecuteNonQueryAsync(ct);
            }
            await using var cmd = new NpgsqlCommand(r.Texte, cnx, tx);
            foreach (var p in r.Parametres) cmd.Parameters.Add(Parametre(p));
            var res = await lire(cmd);
            await tx.RollbackAsync(ct);
            return res;
        }
        catch (PostgresException e)
        {
            throw ExceptionMetier.Invalide(e.SqlState == "57014" ? "REQUETE_DELAI" : "REQUETE", e.SqlState == "57014"
                ? $"Requête interrompue après {specialisation.DelaiRequeteMs / 1000} s"
                : $"Erreur de requête : {e.MessageText}");
        }
        finally
        {
            if (!ouverte) await cnx.CloseAsync();
        }
    }

    private static NpgsqlParameter Parametre(ParametreSql p) => p.Valeur switch
    {
        int n => new NpgsqlParameter(p.Nom, NpgsqlDbType.Integer) { Value = n },
        string[] t => new NpgsqlParameter(p.Nom, NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = t },
        null => new NpgsqlParameter(p.Nom, NpgsqlDbType.Text) { Value = DBNull.Value },
        var v => new NpgsqlParameter(p.Nom, NpgsqlDbType.Text) { Value = v.ToString() },
    };
}
