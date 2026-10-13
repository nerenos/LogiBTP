using System.Collections.Concurrent;
using System.Data;
using System.Globalization;
using System.Text.Json;
using LogiBTP.Fiches;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Fiches.Web;

/// <summary>Types des colonnes des tables de fiches (information_schema), gardés jusqu'au redémarrage.</summary>
public sealed class CacheTypesColonnes
{
    public ConcurrentDictionary<string, IReadOnlyDictionary<string, string>> Tables { get; } = new(StringComparer.Ordinal);
}

/// <summary>
/// Services du module Fiche (classe mère) : définition complétée par le paramétrage, lecture (confidentiel masqué
/// ou journalisé), verrou de modification (prise, battement, reprise de la main, expiration), enregistrement
/// (verrou détenu, empreinte inchangée, ligne complète validée), création, paramétrage.
/// </summary>
public class ServiceFiche(FicheDbContext db, SpecialisationFiche specialisation, CacheTypesColonnes cache)
{
    protected FicheDbContext Db => db;

    private static ExceptionMetier Invalide(ErreurFiche e) => ExceptionMetier.Invalide(e.Code, e.Message);

    // ------------------------------------------------------------------ type, droits, définition

    public virtual async Task<DroitsFiche> Droits(string type, Utilisateur u, CancellationToken ct)
    {
        var actions = await db.Droits.AsNoTracking().Where(d => d.DrfType == type && d.DrfProfil == u.Profil).Select(d => d.DrfAction).ToListAsync(ct);
        var plus = specialisation.DroitsSupplementaires(type, u);
        return new DroitsFiche(actions.Contains("VOIR") || plus.Voir, actions.Contains("MODIFIER") || plus.Modifier,
            actions.Contains("DEBLOQUER") || plus.Debloquer, actions.Contains("CONFIDENTIEL") || plus.Confidentiel, actions.Contains("SUPPRIMER") || plus.Supprimer);
    }

    protected async Task<DroitsFiche> Exiger(string type, Utilisateur u, Func<DroitsFiche, bool> droit, string action, CancellationToken ct)
    {
        var d = await Droits(type, u, ct);
        if (!droit(d)) throw ExceptionMetier.AccesRefuse(action);
        return d;
    }

    /// <summary>Type résolu : définition du programme, obligations du paramétrage, champs supplémentaires, types des colonnes.</summary>
    public virtual async Task<TypeFicheResolu> Type(string code, CancellationToken ct)
    {
        var t = await db.Types.AsNoTracking().FirstOrDefaultAsync(x => x.TyfCode == code && x.TyfActif, ct)
            ?? throw ExceptionMetier.Introuvable($"Type de fiche {code}");
        var def = t.TyfDefinition.Deserialize<DefinitionFiche>(JsonCalcul.Options) ?? new DefinitionFiche();
        var obligatoires = (await db.Parametres.AsNoTracking().Where(p => p.PcfType == code && p.PcfObligatoire).Select(p => p.PcfChamp).ToListAsync(ct)).ToHashSet();
        foreach (var c in def.Champs) c.ObligatoireParametre = !c.Obligatoire && obligatoires.Contains(c.Code);
        var supplementaires = (await db.Supplementaires.AsNoTracking().Where(s => s.ChsType == code && s.ChsActif).OrderBy(s => s.ChsOrdre).ThenBy(s => s.ChsCode).ToListAsync(ct))
            .Select(VersChamp).ToList();
        return new TypeFicheResolu(code, t.TyfTable, t.TyfCle, t.TyfColonneProprietes, def, supplementaires, await TypesColonnes(t.TyfTable, ct));
    }

    protected static ChampFiche VersChamp(ChampSupplementaire s) => new()
    {
        Code = s.ChsCode, Libelle = s.ChsLibelle, Type = s.ChsTypeDonnee, Format = s.ChsFormat, Longueur = s.ChsLongueur,
        Obligatoire = s.ChsObligatoire, Confidentiel = s.ChsConfidentiel, Aide = s.ChsAide, Ordre = s.ChsOrdre, Actif = s.ChsActif,
        Options = s.ChsOptions?.Deserialize<List<OptionChamp>>(JsonCalcul.Options),
    };

    protected async Task<IReadOnlyDictionary<string, string>> TypesColonnes(string table, CancellationToken ct)
    {
        // Clé propre à la base (une base par société).
        var cle = $"{db.Database.GetConnectionString()}|{table}";
        if (cache.Tables.TryGetValue(cle, out var connus)) return connus;
        var lignes = await Lire(new RequeteFiche(
            "SELECT column_name AS c, data_type AS t FROM information_schema.columns WHERE table_schema = 'public' AND table_name = @p0",
            [new ParametreFiche("p0", table)]), ct);
        IReadOnlyDictionary<string, string> types = lignes.ToDictionary(l => (string)l["c"]!, l => (string)l["t"]!, StringComparer.Ordinal);
        cache.Tables[cle] = types;
        return types;
    }

    public virtual async Task<DefinitionFicheDto> Definition(string code, Utilisateur u, CancellationToken ct)
    {
        var droits = await Exiger(code, u, d => d.Voir, "VOIR", ct);
        var t = await Type(code, ct);
        return new DefinitionFicheDto
        {
            Type = code, Libelle = t.Definition.Libelle, Titre = t.Definition.Titre, SousTitre = t.Definition.SousTitre,
            Sections = t.Definition.Sections, Champs = t.Definition.Champs.Select(c => { var copie = JsonCalcul.Cloner(c); copie.Colonne = null; return copie; }).ToList(),
            Supplementaires = t.Supplementaires.ToList(), Droits = droits,
        };
    }

    // ------------------------------------------------------------------ lecture

    /// <summary>Valeur lue pour le client : date au format ISO, colonne jsonb en JSON (comme le fournisseur en mémoire), le reste tel quel.</summary>
    protected static object? PourClient(ChampFiche c, object? v) => v switch
    {
        null or DBNull => null,
        string s when c.Type == "json" => JsonDocument.Parse(s).RootElement.Clone(),
        DateTime d when c.Type == "date" => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        _ => v,
    };

    private static Dictionary<string, JsonElement> Proprietes(object? v) => v switch
    {
        string s when s.Length > 0 => JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(s) ?? [],
        JsonDocument d => d.Deserialize<Dictionary<string, JsonElement>>() ?? [],
        _ => [],
    };

    /// <summary>Ligne complète (confidentiel compris) : valeurs du programme, champs supplémentaires, empreinte.</summary>
    protected async Task<(Dictionary<string, object?> Valeurs, Dictionary<string, JsonElement> Proprietes, string H, string Id)> LigneComplete(
        TypeFicheResolu t, string id, NpgsqlConnection? cnx, NpgsqlTransaction? tx, CancellationToken ct)
    {
        var r = Requete(() => specialisation.Constructeur(t).Lire(id));
        var lignes = cnx is null ? await Lire(r, ct) : await LireDans(cnx, tx!, r, ct);
        var l = lignes.FirstOrDefault() ?? throw ExceptionMetier.Introuvable($"Fiche {t.Code} {id}");
        var valeurs = t.Definition.Champs.Where(c => c.Colonne is not null).ToDictionary(c => c.Code, c => PourClient(c, l.GetValueOrDefault(c.Code)));
        return (valeurs, Proprietes(l["_proprietes"]), (string)l["_h"]!, (string)l["_id"]!);
    }

    protected async Task<FicheDto> VersFiche(TypeFicheResolu t, (Dictionary<string, object?> Valeurs, Dictionary<string, JsonElement> Proprietes, string H, string Id) l,
        bool confidentiel, DroitsFiche droits, Utilisateur u, Guid? jeton, CancellationToken ct)
    {
        var visible = confidentiel && droits.Confidentiel;
        var fiche = new FicheDto { Id = l.Id, H = l.H, Verrou = await Verrou(t.Code, l.Id, jeton, ct, u.Code) };
        foreach (var c in t.Definition.Champs.Where(c => c.Colonne is not null))
        {
            if (c.Confidentiel && !visible) { fiche.Valeurs[c.Code] = null; fiche.Masques.Add(c.Code); }
            else fiche.Valeurs[c.Code] = l.Valeurs.GetValueOrDefault(c.Code);
        }
        foreach (var c in t.Supplementaires)
        {
            object? v = l.Proprietes.TryGetValue(c.Code, out var e) ? ValidationFiche.Normaliser(e) : null;
            if (c.Confidentiel && !visible) { fiche.Proprietes[c.Code] = null; fiche.Masques.Add("+" + c.Code); }
            else fiche.Proprietes[c.Code] = v;
        }
        if (t.Definition.Champs.Any(c => c.Gere))
        {
            var geres = await specialisation.LireGeresAsync(t.Code, l.Id, u, ct);
            foreach (var c in t.Definition.Champs.Where(c => c.Gere)) fiche.Valeurs[c.Code] = geres.GetValueOrDefault(c.Code);
        }
        if (visible) await Journaliser(t, l.Id, u, ct);
        return fiche;
    }

    /// <summary>Accès aux informations confidentielles journalisé (RGPD : qui, quoi, quand).</summary>
    protected async Task Journaliser(TypeFicheResolu t, string id, Utilisateur u, CancellationToken ct)
    {
        var champs = t.Definition.Champs.Where(c => c.Confidentiel).Select(c => c.Code).Concat(t.Supplementaires.Where(c => c.Confidentiel).Select(c => "+" + c.Code)).ToArray();
        if (champs.Length == 0) return;
        db.Journal.Add(new JournalConfidentiel { JcfType = t.Code, JcfElement = id, JcfUtilisateur = u.Code, JcfChamps = champs, JcfDate = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync(ct);
    }

    public virtual async Task<FicheDto> Charger(string code, string id, bool confidentiel, Utilisateur u, CancellationToken ct)
    {
        var droits = await Exiger(code, u, d => d.Voir, "VOIR", ct);
        var t = await Type(code, ct);
        return await VersFiche(t, await LigneComplete(t, id, null, null, ct), confidentiel, droits, u, null, ct);
    }

    public virtual async Task<ReponseConfidentiel> Reveler(string code, string id, Utilisateur u, CancellationToken ct)
    {
        await Exiger(code, u, d => d.Voir && d.Confidentiel, "CONFIDENTIEL", ct);
        var t = await Type(code, ct);
        var l = await LigneComplete(t, id, null, null, ct);
        await Journaliser(t, l.Id, u, ct);
        return new ReponseConfidentiel(
            t.Definition.Champs.Where(c => c.Confidentiel && c.Colonne is not null).ToDictionary(c => c.Code, c => l.Valeurs.GetValueOrDefault(c.Code)),
            t.Supplementaires.Where(c => c.Confidentiel).ToDictionary(c => c.Code, c => l.Proprietes.TryGetValue(c.Code, out var e) ? ValidationFiche.Normaliser(e) : null));
    }

    // ------------------------------------------------------------------ verrou

    /// <summary>Verrou actif (non expiré) d'une fiche, ou null.</summary>
    public virtual async Task<EtatVerrou?> Verrou(string type, string id, Guid? jeton, CancellationToken ct, string? utilisateur = null)
    {
        var limite = DateTimeOffset.UtcNow - specialisation.ExpirationVerrou;
        var v = await db.Verrous.AsNoTracking().FirstOrDefaultAsync(x => x.VefType == type && x.VefId == id && x.VefRenouvele > limite, ct);
        return v is null ? null : new EtatVerrou(v.VefUtilisateur, v.VefDepuis, jeton is not null && v.VefJeton == jeton, utilisateur is not null && v.VefUtilisateur == utilisateur);
    }

    /// <summary>
    /// Prise, renouvellement (battement) ou reprise de la main, en une instruction : le verrou est pris s'il est libre,
    /// expiré, déjà détenu par ce jeton, ou si l'utilisateur force la reprise (droit DEBLOQUER exigé).
    /// </summary>
    public virtual async Task<ReponseVerrou> Verrouiller(string code, string id, DemandeVerrou d, Utilisateur u, CancellationToken ct)
    {
        var droits = await Exiger(code, u, x => x.Modifier, "MODIFIER", ct);
        if (d.Forcer && !droits.Debloquer) throw ExceptionMetier.AccesRefuse("DEBLOQUER");
        var t = await Type(code, ct);
        await LigneComplete(t, id, null, null, ct);
        var expiration = (int)specialisation.ExpirationVerrou.TotalSeconds;
        await PurgerVerrous(ct);
        var pris = await Lire(new RequeteFiche($"""
            INSERT INTO verrou_fiche (vef_type, vef_id, vef_utilisateur, vef_jeton, vef_depuis, vef_renouvele)
            VALUES (@p0, @p1, @p2, CAST(@p3 AS uuid), now(), now())
            ON CONFLICT (vef_type, vef_id) DO UPDATE SET
                vef_utilisateur = EXCLUDED.vef_utilisateur, vef_jeton = EXCLUDED.vef_jeton, vef_renouvele = now(),
                vef_depuis = CASE WHEN verrou_fiche.vef_jeton = EXCLUDED.vef_jeton THEN verrou_fiche.vef_depuis ELSE now() END
            WHERE verrou_fiche.vef_jeton = EXCLUDED.vef_jeton
               OR verrou_fiche.vef_utilisateur = EXCLUDED.vef_utilisateur
               OR verrou_fiche.vef_renouvele < now() - make_interval(secs => {expiration})
               OR CAST(@p4 AS boolean)
            RETURNING vef_utilisateur, vef_depuis
            """, [new("p0", code), new("p1", id), new("p2", u.Code), new("p3", d.Jeton.ToString()), new("p4", d.Forcer ? "true" : "false")]), ct, ecriture: true);
        return new ReponseVerrou(pris.Count > 0, await Verrou(code, id, d.Jeton, ct, u.Code));
    }

    /// <summary>
    /// Libération automatique des utilisateurs fantômes (connexion perdue, navigateur fermé) : les verrous sans battement
    /// depuis ExpirationVerrou sont supprimés (ils sont déjà considérés comme libres).
    /// </summary>
    public virtual async Task PurgerVerrous(CancellationToken ct)
    {
        var limite = DateTimeOffset.UtcNow - specialisation.ExpirationVerrou;
        await db.Verrous.Where(v => v.VefRenouvele < limite).ExecuteDeleteAsync(ct);
    }

    public virtual async Task Deverrouiller(string code, string id, Guid jeton, CancellationToken ct) =>
        await db.Verrous.Where(v => v.VefType == code && v.VefId == id && v.VefJeton == jeton).ExecuteDeleteAsync(ct);

    // ------------------------------------------------------------------ enregistrement et création

    private static string? Texte(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        JsonValueKind.String => v.GetString() is { } s && s.Trim().Length > 0 ? s : null,
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        _ => v.GetRawText(),
    };

    /// <summary>Champs supplémentaires saisis : seuls les champs déclarés sont acceptés ; vides retirés.</summary>
    private static string? ProprietesJson(TypeFicheResolu t, Dictionary<string, JsonElement> saisies)
    {
        if (saisies.Count == 0) return null;
        var connus = t.Supplementaires.Select(c => c.Code).ToHashSet();
        foreach (var k in saisies.Keys) if (!connus.Contains(k)) throw new ErreurFiche("CHAMP", $"Champ supplémentaire inconnu : {k}");
        // Saisie vide : null (la clé est conservée pour effacer la valeur précédente dans la fusion JSONB).
        return JsonSerializer.Serialize(saisies.ToDictionary(kv => kv.Key,
            kv => kv.Value.ValueKind == JsonValueKind.String && kv.Value.GetString()!.Trim().Length == 0 ? (JsonElement?)null : kv.Value));
    }

    /// <summary>Valeurs saisies des champs gérés par la spécialisation (hors table).</summary>
    protected static Dictionary<string, JsonElement> Geres(TypeFicheResolu t, Dictionary<string, JsonElement> saisies) =>
        saisies.Where(kv => t.Definition.Champs.Any(c => c.Code == kv.Key && c.Gere)).ToDictionary(kv => kv.Key, kv => kv.Value);

    protected void Valider(TypeFicheResolu t, Dictionary<string, object?> valeurs, Dictionary<string, object?> proprietes)
    {
        var erreurs = ValidationFiche.ValiderFiche(t, valeurs, proprietes);
        erreurs.AddRange(specialisation.ValiderMetier(t.Code, valeurs, proprietes));
        if (erreurs.Count > 0) throw ExceptionMetier.Invalide("VALIDATION", "Fiche incomplète ou incorrecte", erreurs);
    }

    public virtual async Task<FicheDto> Enregistrer(string code, string id, DemandeEnregistrement d, Utilisateur u, CancellationToken ct)
    {
        var droits = await Exiger(code, u, x => x.Modifier, "MODIFIER", ct);
        var t = await Type(code, ct);
        var c = specialisation.Constructeur(t);
        foreach (var k in d.Valeurs.Keys)
        {
            var champ = t.Definition.Champs.FirstOrDefault(x => x.Code == k);
            if (champ is null || champ.LectureSeule || champ.Saisie == "creation") throw ExceptionMetier.Invalide("CHAMP", $"Champ {k} non modifiable");
        }
        // Champs gérés par la spécialisation : contrôlés avant l'écriture, écrits après celle de la ligne.
        var geres = Geres(t, d.Valeurs);
        IReadOnlyDictionary<string, object?> valide = new Dictionary<string, object?>();
        await Ecrire(async (cnx, tx) =>
        {
            var limite = DateTimeOffset.UtcNow - specialisation.ExpirationVerrou;
            var verrou = (await LireDans(cnx, tx, new RequeteFiche(
                "SELECT vef_utilisateur, vef_depuis, vef_jeton::text AS jeton, vef_renouvele FROM verrou_fiche WHERE vef_type = @p0 AND vef_id = @p1 FOR UPDATE",
                [new("p0", code), new("p1", id)]), ct)).FirstOrDefault();
            var actif = verrou is not null && (DateTime)verrou["vef_renouvele"]! > limite.UtcDateTime;
            if (!actif || (string)verrou!["jeton"]! != d.Jeton.ToString())
            {
                var etat = actif ? new EtatVerrou((string)verrou!["vef_utilisateur"]!, new DateTimeOffset((DateTime)verrou["vef_depuis"]!), false) : null;
                throw ExceptionMetier.Conflit("VERROU_PERDU", etat is null ? "Verrou de modification expiré : reprenez la modification" : $"Fiche reprise en modification par {etat.Utilisateur}", etat);
            }
            var h = (await LireDans(cnx, tx, Requete(() => c.Verrou(id)), ct)).FirstOrDefault()?["h"] as string ?? throw ExceptionMetier.Introuvable($"Fiche {code} {id}");
            if (d.H is not null && d.H != h) throw ExceptionMetier.Conflit("FICHE_MODIFIEE", "La fiche a été modifiée par ailleurs : rechargez-la");

            // Ligne complète après modification (confidentiel compris) : c'est elle qui est validée.
            var actuelle = await LigneComplete(t, id, cnx, tx, ct);
            var valeurs = new Dictionary<string, object?>(actuelle.Valeurs);
            foreach (var (k, v) in d.Valeurs) valeurs[k] = ValidationFiche.Normaliser(v);
            var proprietes = actuelle.Proprietes.ToDictionary(kv => kv.Key, kv => ValidationFiche.Normaliser(kv.Value));
            foreach (var (k, v) in d.Proprietes) proprietes[k] = ValidationFiche.Normaliser(v);
            Valider(t, valeurs, proprietes);
            await specialisation.ValiderGeresAsync(code, id, geres, valeurs, u, ct);
            valide = valeurs;

            var aEcrire = d.Valeurs.Where(kv => !geres.ContainsKey(kv.Key)).ToDictionary(kv => kv.Key, kv => Texte(kv.Value));
            await specialisation.AvantEcritureAsync(code, false, id, aEcrire, valeurs, proprietes, u, ct);
            var calcules = aEcrire.Keys.Except(d.Valeurs.Keys).ToHashSet();
            var json = Requete(() => ProprietesJson(t, d.Proprietes));
            if (aEcrire.Count > 0 || json is not null)
            {
                await using var cmd = Commande(cnx, tx, Requete(() => c.MiseAJour(id, aEcrire, json, calcules)));
                await cmd.ExecuteNonQueryAsync(ct);
            }
            await using (var renouveler = Commande(cnx, tx, new RequeteFiche("UPDATE verrou_fiche SET vef_renouvele = now() WHERE vef_type = @p0 AND vef_id = @p1", [new("p0", code), new("p1", id)])))
            {
                await renouveler.ExecuteNonQueryAsync(ct);
            }
            return true;
        }, ct);
        if (geres.Count > 0) await specialisation.EcrireGeresAsync(code, id, false, geres, valide, u, ct);
        return await VersFiche(t, await LigneComplete(t, id, null, null, ct), d.Confidentiel, droits, u, d.Jeton, ct);
    }

    public virtual async Task<FicheDto> Creer(string code, DemandeEnregistrement d, Utilisateur u, CancellationToken ct)
    {
        var droits = await Exiger(code, u, x => x.Modifier, "MODIFIER", ct);
        var t = await Type(code, ct);
        var valeurs = t.Definition.Champs.Where(c => c.Colonne is not null).ToDictionary(c => c.Code, c => d.Valeurs.TryGetValue(c.Code, out var v) ? ValidationFiche.Normaliser(v) : null);
        var proprietes = d.Proprietes.ToDictionary(kv => kv.Key, kv => ValidationFiche.Normaliser(kv.Value));
        var geres = Geres(t, d.Valeurs);
        foreach (var (k, v) in geres) valeurs[k] = ValidationFiche.Normaliser(v);
        Valider(t, valeurs, proprietes);
        await specialisation.ValiderGeresAsync(code, null, geres, valeurs, u, ct);
        var aEcrire = d.Valeurs.Where(kv => !geres.ContainsKey(kv.Key) && Texte(kv.Value) is not null).ToDictionary(kv => kv.Key, kv => Texte(kv.Value));
        await specialisation.AvantEcritureAsync(code, true, null, aEcrire, valeurs, proprietes, u, ct);
        var calcules = aEcrire.Keys.Except(d.Valeurs.Keys).ToHashSet();
        var json = Requete(() => ProprietesJson(t, d.Proprietes));
        var id = await Ecrire(async (cnx, tx) =>
            (string)(await LireDans(cnx, tx, Requete(() => specialisation.Constructeur(t).Insertion(aEcrire, json, calcules)), ct)).First()["id"]!, ct);
        if (geres.Count > 0) await specialisation.EcrireGeresAsync(code, id, true, geres, valeurs, u, ct);
        return await VersFiche(t, await LigneComplete(t, id, null, null, ct), d.Confidentiel, droits, u, null, ct);
    }

    /// <summary>
    /// Suppression d'une fiche (droit SUPPRIMER) : refusée si quelqu'un la modifie (verrou actif d'un autre utilisateur)
    /// ou si elle est utilisée ailleurs (clé étrangère). La spécialisation contrôle et nettoie avant (AvantSuppressionAsync).
    /// </summary>
    public virtual async Task Supprimer(string code, string id, Utilisateur u, CancellationToken ct)
    {
        await Exiger(code, u, x => x.Supprimer, "SUPPRIMER", ct);
        var t = await Type(code, ct);
        await specialisation.AvantSuppressionAsync(code, id, u, ct);
        try
        {
            await Ecrire(async (cnx, tx) =>
            {
                var limite = DateTimeOffset.UtcNow - specialisation.ExpirationVerrou;
                var verrou = (await LireDans(cnx, tx, new RequeteFiche(
                    "SELECT vef_utilisateur, vef_renouvele FROM verrou_fiche WHERE vef_type = @p0 AND vef_id = @p1 FOR UPDATE",
                    [new("p0", code), new("p1", id)]), ct)).FirstOrDefault();
                if (verrou is not null && (DateTime)verrou["vef_renouvele"]! > limite.UtcDateTime && (string)verrou["vef_utilisateur"]! != u.Code)
                    throw ExceptionMetier.Conflit("FICHE_EN_MODIFICATION", $"Fiche en cours de modification par {verrou["vef_utilisateur"]} : suppression impossible");
                await using (var cmd = Commande(cnx, tx, Requete(() => specialisation.Constructeur(t).Suppression(id))))
                {
                    if (await cmd.ExecuteNonQueryAsync(ct) == 0) throw ExceptionMetier.Introuvable($"Fiche {code} {id}");
                }
                await using (var lib = Commande(cnx, tx, new RequeteFiche("DELETE FROM verrou_fiche WHERE vef_type = @p0 AND vef_id = @p1", [new("p0", code), new("p1", id)])))
                {
                    await lib.ExecuteNonQueryAsync(ct);
                }
                return true;
            }, ct);
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.ForeignKeyViolation)
        {
            throw ExceptionMetier.Conflit("FICHE_UTILISEE", "Cet élément est utilisé ailleurs : suppression impossible");
        }
    }

    // ------------------------------------------------------------------ paramétrage

    public virtual async Task<ParametrageFicheDto> Parametrage(string code, Utilisateur u, CancellationToken ct)
    {
        await Exiger(code, u, d => d.Voir, "VOIR", ct);
        return new ParametrageFicheDto
        {
            Obligatoires = await db.Parametres.AsNoTracking().Where(p => p.PcfType == code && p.PcfObligatoire).Select(p => p.PcfChamp).ToListAsync(ct),
            Supplementaires = (await db.Supplementaires.AsNoTracking().Where(s => s.ChsType == code).OrderBy(s => s.ChsOrdre).ToListAsync(ct)).Select(VersChamp).ToList(),
        };
    }

    public virtual async Task<ParametrageFicheDto> EnregistrerParametrage(string code, ParametrageFicheDto p, Utilisateur u, CancellationToken ct)
    {
        if (!u.EstAdmin) throw ExceptionMetier.AccesRefuse("PARAMETRER");
        var t = await Type(code, ct);
        var codes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in p.Supplementaires)
        {
            if (!System.Text.RegularExpressions.Regex.IsMatch(c.Code ?? "", "^[a-z][a-z0-9_]{0,62}$"))
                throw ExceptionMetier.Invalide("CODE", $"Code de champ invalide : {c.Code} (minuscules, chiffres, _)");
            if (!codes.Add(c.Code!) || t.Definition.Champs.Any(x => x.Code == c.Code)) throw ExceptionMetier.Invalide("CODE", $"Code de champ déjà utilisé : {c.Code}");
            if (c.Type is not ("texte" or "nombre" or "booleen" or "date" or "liste")) throw ExceptionMetier.Invalide("TYPE", $"Type de champ invalide : {c.Type}");
            if (string.IsNullOrWhiteSpace(c.Libelle)) throw ExceptionMetier.Invalide("LIBELLE", $"Libellé obligatoire pour le champ {c.Code}");
        }
        var programme = t.Definition.Champs.Select(c => c.Code).ToHashSet();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Parametres.Where(x => x.PcfType == code).ExecuteDeleteAsync(ct);
        db.Parametres.AddRange(p.Obligatoires.Where(programme.Contains).Distinct().Select(c => new ParametreChampFiche { PcfType = code, PcfChamp = c, PcfObligatoire = true }));
        await db.Supplementaires.Where(x => x.ChsType == code).ExecuteDeleteAsync(ct);
        db.Supplementaires.AddRange(p.Supplementaires.Select(c => new ChampSupplementaire
        {
            ChsType = code, ChsCode = c.Code, ChsLibelle = c.Libelle.Trim(), ChsTypeDonnee = c.Type, ChsFormat = c.Format, ChsLongueur = c.Longueur,
            ChsObligatoire = c.Obligatoire, ChsConfidentiel = c.Confidentiel, ChsAide = c.Aide, ChsOrdre = c.Ordre, ChsActif = c.Actif,
            ChsOptions = c.Options is null ? null : JsonSerializer.SerializeToDocument(c.Options, JsonCalcul.Options),
        }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return await Parametrage(code, u, ct);
    }

    // ------------------------------------------------------------------ exécution

    private static T Requete<T>(Func<T> f)
    {
        try
        {
            return f();
        }
        catch (ErreurFiche e)
        {
            throw Invalide(e);
        }
    }

    private static NpgsqlCommand Commande(NpgsqlConnection cnx, NpgsqlTransaction? tx, RequeteFiche r)
    {
        var cmd = new NpgsqlCommand(r.Texte, cnx, tx);
        foreach (var p in r.Parametres) cmd.Parameters.Add(new NpgsqlParameter(p.Nom, NpgsqlDbType.Text) { Value = (object?)p.Valeur ?? DBNull.Value });
        return cmd;
    }

    private static async Task<List<Dictionary<string, object?>>> LireDans(NpgsqlConnection cnx, NpgsqlTransaction? tx, RequeteFiche r, CancellationToken ct)
    {
        await using var cmd = Commande(cnx, tx, r);
        var res = new List<Dictionary<string, object?>>();
        await using var rd = await cmd.ExecuteReaderAsync(ct);
        while (await rd.ReadAsync(ct))
        {
            var l = new Dictionary<string, object?>(rd.FieldCount, StringComparer.Ordinal);
            for (var i = 0; i < rd.FieldCount; i++) l[rd.GetName(i)] = rd.IsDBNull(i) ? null : rd.GetValue(i);
            res.Add(l);
        }
        return res;
    }

    /// <summary>Lecture hors transaction (ou écriture d'une instruction : verrou).</summary>
    protected async Task<List<Dictionary<string, object?>>> Lire(RequeteFiche r, CancellationToken ct, bool ecriture = false)
    {
        var cnx = (NpgsqlConnection)db.Database.GetDbConnection();
        var ouverte = cnx.State == ConnectionState.Open;
        if (!ouverte) await cnx.OpenAsync(ct);
        try
        {
            return await LireDans(cnx, null, r, ct);
        }
        catch (PostgresException e)
        {
            throw ExceptionMetier.Invalide("REQUETE", $"Erreur de requête : {e.MessageText}");
        }
        finally
        {
            if (!ouverte) await cnx.CloseAsync();
        }
    }

    protected async Task<T> Ecrire<T>(Func<NpgsqlConnection, NpgsqlTransaction, Task<T>> ecrire, CancellationToken ct)
    {
        var cnx = (NpgsqlConnection)db.Database.GetDbConnection();
        var ouverte = cnx.State == ConnectionState.Open;
        if (!ouverte) await cnx.OpenAsync(ct);
        try
        {
            await using var tx = await cnx.BeginTransactionAsync(ct);
            await using (var cadre = new NpgsqlCommand($"SET LOCAL statement_timeout = {specialisation.DelaiRequeteMs}", cnx, tx))
            {
                await cadre.ExecuteNonQueryAsync(ct);
            }
            var res = await ecrire(cnx, tx);
            await tx.CommitAsync(ct);
            return res;
        }
        catch (PostgresException e)
        {
            // Valeur refusée par la base : conversion (22P02…), contrainte (23502 NOT NULL, 23505 unicité, 23514 CHECK…).
            throw ExceptionMetier.Invalide("VALEUR", e.SqlState == "23505" ? "Cette valeur existe déjà (doublon)" : $"Valeur refusée par la base : {e.MessageText}");
        }
        finally
        {
            if (!ouverte) await cnx.CloseAsync();
        }
    }
}
