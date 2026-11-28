using System.Diagnostics;
using System.Text.Json;
using LogiBTP.Socle.Donnees;
using Npgsql;
using NpgsqlTypes;

namespace LogiBTP.Import.Reprise;

/// <summary>Refus du moteur avant ou pendant la reprise (code <see cref="ErreurReprise"/>).</summary>
public sealed class RepriseRefuseeException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>Résultat d'une exécution : identifiant dans <c>import_reprise</c> et rapport.</summary>
public sealed record ResultatReprise(long RepriseId, RapportReprise Rapport);

/// <summary>
/// Moteur de la reprise (plan reprise-mde-optim, lot 1) : ordonne les domaines par leurs dépendances, vérifie que la base
/// cible ne contient pas de données métier (contrôle fourni par le cœur), puis exécute tous les domaines dans une seule
/// transaction de l'unité d'écriture. Simulation : la transaction est annulée à la fin ; reprise réelle : validée, sauf
/// anomalie bloquante ou erreur (alors annulée, la base reste vide). Dans tous les cas le rapport est enregistré dans
/// <c>import_reprise</c> (une transaction à part, après coup pour une simulation ou un échec).
/// </summary>
public sealed class MoteurReprise(IReadOnlyList<IDomaineReprise> domaines, Func<NpgsqlConnection, NpgsqlTransaction?, CancellationToken, Task<bool>> baseVide)
{
    /// <summary>Domaines dans l'ordre d'exécution : dépendances d'abord, ordre de déclaration sinon (stable).</summary>
    public IReadOnlyList<IDomaineReprise> Ordre()
    {
        var parCode = new Dictionary<string, IDomaineReprise>(StringComparer.Ordinal);
        foreach (var d in domaines)
            if (!parCode.TryAdd(d.Code, d))
                throw new RepriseRefuseeException(ErreurReprise.DomaineEnDouble, $"Domaine de reprise en double : {d.Code}");
        foreach (var d in domaines)
            foreach (var dep in d.Dependances.Where(x => !parCode.ContainsKey(x)))
                throw new RepriseRefuseeException(ErreurReprise.DependanceInconnue, $"Domaine {d.Code} : dépendance inconnue {dep}");

        var ordre = new List<IDomaineReprise>();
        var etat = new Dictionary<string, bool>(StringComparer.Ordinal); // false : en cours de visite, true : placé
        void Visiter(IDomaineReprise d, Stack<string> chemin)
        {
            if (etat.TryGetValue(d.Code, out var place))
            {
                if (place) return;
                throw new RepriseRefuseeException(ErreurReprise.Cycle,
                    $"Dépendances circulaires : {string.Join(" → ", chemin.Reverse().Append(d.Code))}");
            }
            etat[d.Code] = false;
            chemin.Push(d.Code);
            foreach (var dep in d.Dependances) Visiter(parCode[dep], chemin);
            chemin.Pop();
            etat[d.Code] = true;
            ordre.Add(d);
        }
        foreach (var d in domaines) Visiter(d, new Stack<string>());
        return ordre;
    }

    public async Task<ResultatReprise> ExecuterAsync(OptionsReprise options, ILecteurSource lecteur, FichierCorrespondances correspondances,
        UniteEcriture unite, CancellationToken ct)
    {
        if (lecteur.Source != options.Source || correspondances.Source != options.Source)
            throw new RepriseRefuseeException(ErreurReprise.SourceIncompatible,
                $"Source de la reprise {options.Source}, du lecteur {lecteur.Source}, des correspondances {correspondances.Source}");
        var ordre = Ordre();
        string? domaineCourant = null;
        int rangCourant = 0;
        long lignesAvantDomaine = 0;
        var chronos = new ChronosReprise();
        ChronosReprise.Courant = chronos;
        var compte = new LecteurCompte(lecteur, chronos);
        lecteur = compte;
        var rapport = new RapportReprise { Source = options.Source, Societes = options.Societes, Simulation = options.Simulation };
        var contexte = new ContexteReprise
        {
            Options = options, Lecteur = lecteur, Correspondances = correspondances, Unite = unite, Rapport = rapport,
        };

        long ecrites = 0;
        void Signaler(string etape, string? element, int faits, int total, long lignes = 0, long lignesTotal = 0)
        {
            // Le suivi ne doit jamais faire échouer la reprise.
            try
            {
                ecrites = rapport.EcritesTotal() ?? ecrites;
                options.Avancement?.Invoke(new AvancementReprise(etape, element, faits, total, lignes, lignesTotal, ecrites, contexte.Details)
                {
                    Chronos = chronos.Postes(),
                });
            }
            catch { /* suivi ignoré */ }
        }

        // Compteurs du domaine en cours signalés à intervalle régulier (autre fil) jusqu'à la fin de l'exécution.
        using var finSuivi = CancellationTokenSource.CreateLinkedTokenSource(ct);
        using var arretSuivi = new ArretALaFin(finSuivi); // suivi arrêté quelle que soit la sortie (refus, erreur)
        var suivi = options.Avancement is null ? Task.CompletedTask : Task.Run(async () =>
        {
            try
            {
                while (true)
                {
                    await Task.Delay(options.IntervalleAvancement, finSuivi.Token);
                    if (domaineCourant is { } d)
                        Signaler(EtapeReprise.Domaine, d, rangCourant, ordre.Count, compte.Lignes - lignesAvantDomaine, compte.Lignes);
                }
            }
            catch (OperationCanceledException) { /* fin du suivi */ }
        });

        Signaler(EtapeReprise.Preparation, null, 0, ordre.Count);
        await using (var tx = await unite.CommencerAsync(ct))
        {
            if (!await baseVide(unite.Connexion, unite.Transaction, ct))
                throw new RepriseRefuseeException(ErreurReprise.BaseNonVide,
                    "La base cible contient déjà des données métier : la reprise se fait dans une base neuve");
            contexte.Fusions = await LireFusionsAsync(unite, options.Source, ct);
            try
            {
                var tables = await lecteur.TablesAsync(ct);
                for (var i = 0; i < tables.Count; i++)
                {
                    Signaler(EtapeReprise.Comptage, tables[i], i, tables.Count);
                    rapport.TablesSource[tables[i]] = await lecteur.CompterAsync(tables[i], ct);
                }
                contexte.RepriseId = await InsererAsync(unite.Connexion, unite.Transaction!, rapport, options, ct);
                for (var i = 0; i < ordre.Count; i++)
                {
                    var domaine = ordre[i];
                    ct.ThrowIfCancellationRequested();
                    domaineCourant = domaine.Code;
                    rangCourant = i;
                    lignesAvantDomaine = compte.Lignes;
                    Signaler(EtapeReprise.Domaine, domaine.Code, i, ordre.Count, 0, lignesAvantDomaine);
                    var chrono = Stopwatch.StartNew();
                    await domaine.ExecuterAsync(contexte, ct);
                    await contexte.Registre.EnregistrerAsync(unite.Connexion, unite.Transaction!, contexte.RepriseId, ct);
                    rapport.Domaines.Add(new DomaineExecute(domaine.Code, chrono.ElapsedMilliseconds));
                }
                domaineCourant = null;
                await finSuivi.CancelAsync();
                await suivi;
                Signaler(EtapeReprise.Enregistrement, null, ordre.Count, ordre.Count, 0, compte.Lignes);
                rapport.Etat = rapport.Bloque ? EtatReprise.Echec : EtatReprise.Terminee;
                rapport.Fin = DateTimeOffset.UtcNow;
                rapport.Chronos.AddRange(chronos.Postes());
                if (options.Simulation || rapport.Bloque)
                    await tx.RollbackAsync(ct);
                else
                {
                    await MettreAJourAsync(unite.Connexion, unite.Transaction!, contexte.RepriseId, rapport, ct);
                    await tx.CommitAsync(ct);
                    return new ResultatReprise(contexte.RepriseId, rapport);
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                var enEchec = domaineCourant;
                domaineCourant = null;
                await finSuivi.CancelAsync();
                await tx.RollbackAsync(CancellationToken.None);
                rapport.Etat = EtatReprise.Echec;
                rapport.Fin = DateTimeOffset.UtcNow;
                rapport.Chronos.Clear();
                rapport.Chronos.AddRange(chronos.Postes());
                rapport.Signaler(NiveauAnomalie.Bloquant, e is RepriseRefuseeException r ? r.Code : CodeErreur(e), enEchec, MessageErreur(e));
            }
        }

        // Simulation, anomalie bloquante ou échec : rien n'est écrit dans la base, sauf le rapport.
        await using var trace = await unite.CommencerAsync(ct);
        var id = await InsererAsync(unite.Connexion, unite.Transaction!, rapport, options, ct);
        await trace.CommitAsync(ct);
        return new ResultatReprise(id, rapport);
    }

    private sealed class ArretALaFin(CancellationTokenSource source) : IDisposable
    {
        public void Dispose() => source.Cancel();
    }

    /// <summary>Lecteur qui compte les lignes lues (toutes requêtes) ; ne libère pas le lecteur enveloppé.</summary>
    private sealed class LecteurCompte(ILecteurSource interne, ChronosReprise chronos) : ILecteurSource
    {
        private long lignes;
        public long Lignes => Interlocked.Read(ref lignes);
        public string Source => interne.Source;
        public Task<IReadOnlyList<string>> TablesAsync(CancellationToken ct) => interne.TablesAsync(ct);
        public Task<long> CompterAsync(string table, CancellationToken ct) => interne.CompterAsync(table, ct);

        public async IAsyncEnumerable<LigneSource> LireAsync(string requete, IReadOnlyDictionary<string, object?>? parametres,
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
        {
            // Temps passé à attendre la source (requête et lignes suivantes), hors traitement des lignes par le domaine.
            await using var e = interne.LireAsync(requete, parametres, ct).GetAsyncEnumerator(ct);
            while (true)
            {
                var debut = System.Diagnostics.Stopwatch.GetTimestamp();
                var suivante = await e.MoveNextAsync();
                chronos.Ajouter(ChronosReprise.LectureSource, System.Diagnostics.Stopwatch.GetTimestamp() - debut, suivante ? 1 : 0);
                if (!suivante) yield break;
                Interlocked.Increment(ref lignes);
                yield return e.Current;
            }
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    /// <summary>
    /// Code d'une erreur inattendue : type de l'exception d'origine (une enveloppe comme « likely due to a transient
    /// failure » d'EF ne dit rien de la cause), précédé de celui de l'enveloppe s'il diffère.
    /// </summary>
    public static string CodeErreur(Exception e)
    {
        var origine = e;
        while (origine.InnerException is not null) origine = origine.InnerException;
        return origine == e ? e.GetType().Name : $"{e.GetType().Name} / {origine.GetType().Name}";
    }

    /// <summary>Message d'une erreur inattendue avec ceux des exceptions internes (cause réelle), sans répétition.</summary>
    public static string MessageErreur(Exception e)
    {
        var messages = new List<string>();
        for (var x = e; x is not null; x = x.InnerException)
            if (!string.IsNullOrWhiteSpace(x.Message) && !messages.Contains(x.Message)) messages.Add(x.Message);
        return string.Join(" → ", messages);
    }

    private static async Task<IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>> LireFusionsAsync(
        UniteEcriture unite, string source, CancellationToken ct)
    {
        var fusions = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
        await using var cmd = new NpgsqlCommand(
            "SELECT ifu_table_source, ifu_cle_conservee, ifu_cles_fusionnees::text FROM import_fusion WHERE ifu_source = $1 ORDER BY ifu_id",
            unite.Connexion, unite.Transaction);
        cmd.Parameters.Add(new() { Value = source });
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            var table = r.GetString(0);
            if (!fusions.TryGetValue(table, out var t)) fusions[table] = t = new(StringComparer.Ordinal);
            foreach (var cle in JsonSerializer.Deserialize<List<string>>(r.GetString(2)) ?? [])
                t[cle.TrimEnd()] = r.GetString(1).TrimEnd();
        }
        return fusions.ToDictionary(f => f.Key, f => (IReadOnlyDictionary<string, string>)f.Value, StringComparer.Ordinal);
    }

    private static async Task<long> InsererAsync(NpgsqlConnection c, NpgsqlTransaction tx, RapportReprise rapport, OptionsReprise options, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "INSERT INTO import_reprise (irp_source, irp_societes, irp_simulation, irp_etat, irp_debut, irp_fin, irp_auteur, irp_rapport) " +
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING irp_id", c, tx);
        cmd.Parameters.Add(new() { Value = options.Source });
        cmd.Parameters.Add(new() { Value = JsonSerializer.Serialize(options.Societes), NpgsqlDbType = NpgsqlDbType.Jsonb });
        cmd.Parameters.Add(new() { Value = options.Simulation });
        cmd.Parameters.Add(new() { Value = rapport.Etat });
        cmd.Parameters.Add(new() { Value = rapport.Debut });
        cmd.Parameters.Add(new() { Value = (object?)rapport.Fin ?? DBNull.Value, NpgsqlDbType = NpgsqlDbType.TimestampTz });
        cmd.Parameters.Add(new() { Value = (object?)options.Auteur ?? DBNull.Value, NpgsqlDbType = NpgsqlDbType.Varchar });
        cmd.Parameters.Add(new() { Value = rapport.EnJson(), NpgsqlDbType = NpgsqlDbType.Jsonb });
        return (long)(await cmd.ExecuteScalarAsync(ct))!;
    }

    private static async Task MettreAJourAsync(NpgsqlConnection c, NpgsqlTransaction tx, long id, RapportReprise rapport, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "UPDATE import_reprise SET irp_etat = $2, irp_fin = $3, irp_rapport = $4 WHERE irp_id = $1", c, tx);
        cmd.Parameters.Add(new() { Value = id });
        cmd.Parameters.Add(new() { Value = rapport.Etat });
        cmd.Parameters.Add(new() { Value = (object?)rapport.Fin ?? DBNull.Value, NpgsqlDbType = NpgsqlDbType.TimestampTz });
        cmd.Parameters.Add(new() { Value = rapport.EnJson(), NpgsqlDbType = NpgsqlDbType.Jsonb });
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
