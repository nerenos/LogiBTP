using System.Collections.Concurrent;
using System.Text.Json;
using LogiBTP.FactureElectronique.Web.Connecteurs;
using LogiBTP.Socle.Web;
using Microsoft.Extensions.Options;
using Npgsql;

namespace LogiBTP.FactureElectronique.Web;

/// <summary>
/// Flux tenus en base (table fe_magasin) pour la plateforme simulée ou le dépôt manuel d'une société : chargés une fois,
/// puis gardés en mémoire et écrits à chaque enregistrement (le redémarrage retrouve les dépôts, accusés à venir,
/// statuts programmés et imports). Rang par la séquence fe_magasin_rang. Une seule instance de l'API par base (comme le
/// <c>Diffuseur</c> du socle) : deux processus ne partagent pas le cache.
/// </summary>
public sealed class MagasinFluxBase : IMagasinFlux
{
    private static readonly JsonSerializerOptions Json = new();

    private readonly NpgsqlDataSource source;
    private readonly string magasin;
    private readonly Lazy<ConcurrentDictionary<string, FluxLocal>> flux;

    /// <param name="source">Source de connexions de la base de la société.</param>
    /// <param name="magasin">Nom du magasin (<see cref="ConnecteurFe.Simule"/> ou <see cref="ConnecteurFe.Manuel"/>).</param>
    public MagasinFluxBase(NpgsqlDataSource source, string magasin)
    {
        this.source = source;
        this.magasin = magasin;
        flux = new(Charger, LazyThreadSafetyMode.ExecutionAndPublication);
    }

    private sealed record StatutAVenir(string Statut, string Emetteur, DateTimeOffset Echeance);

    private sealed record EtatMagasin(Flux Flux, AccuseFlux? AccuseFinal, DateTimeOffset? AccuseLe, List<StatutAVenir> AVenir, List<string> Historique);

    public long RangSuivant()
    {
        using var c = source.CreateCommand("SELECT nextval('fe_magasin_rang')");
        return (long)c.ExecuteScalar()!;
    }

    public void Enregistrer(FluxLocal f)
    {
        var etat = new EtatMagasin(f.Flux, f.AccuseFinal, f.AccuseLe, [.. f.AVenir.Select(a => new StatutAVenir(a.Statut.Statut, a.Statut.Emetteur, a.Echeance))],
            [.. f.Historique]);
        using var c = source.CreateCommand("""
            INSERT INTO fe_magasin (fma_magasin, fma_id_flux, fma_rang, fma_etat, fma_original, fma_modifie_le)
            VALUES ($1, $2, $3, $4::jsonb, $5, now())
            ON CONFLICT (fma_magasin, fma_id_flux) DO UPDATE
               SET fma_rang = EXCLUDED.fma_rang, fma_etat = EXCLUDED.fma_etat, fma_original = EXCLUDED.fma_original, fma_modifie_le = now()
            """);
        c.Parameters.Add(new() { Value = magasin });
        c.Parameters.Add(new() { Value = f.Flux.IdFlux });
        c.Parameters.Add(new() { Value = f.Rang });
        c.Parameters.Add(new() { Value = JsonSerializer.Serialize(etat, Json) });
        c.Parameters.Add(new() { Value = f.Original });
        c.ExecuteNonQuery();
        flux.Value[f.Flux.IdFlux] = f;
    }

    public FluxLocal? Trouver(string idFlux) => flux.Value.GetValueOrDefault(idFlux);

    public IReadOnlyList<FluxLocal> Tous() => [.. flux.Value.Values.OrderBy(f => f.Rang)];

    private ConcurrentDictionary<string, FluxLocal> Charger()
    {
        var resultat = new ConcurrentDictionary<string, FluxLocal>();
        using var c = source.CreateCommand("SELECT fma_id_flux, fma_rang, fma_etat::text, fma_original FROM fe_magasin WHERE fma_magasin = $1");
        c.Parameters.Add(new() { Value = magasin });
        using var r = c.ExecuteReader();
        while (r.Read())
        {
            var e = JsonSerializer.Deserialize<EtatMagasin>(r.GetString(2), Json)!;
            resultat[r.GetString(0)] = new FluxLocal(e.Flux, (byte[])r[3], r.GetInt64(1))
            {
                AccuseFinal = e.AccuseFinal, AccuseLe = e.AccuseLe,
                AVenir = [.. e.AVenir.Select(a => (new StatutProgramme(a.Statut, a.Emetteur), a.Echeance))],
                Historique = e.Historique,
            };
        }
        return resultat;
    }
}

/// <summary>
/// Magasins en base de chaque société, par nom de base (<see cref="SocieteCourante.Base"/>) et par magasin : la
/// connexion est celle de la société configurée (<see cref="OptionsSocietes"/>) dont la base porte ce nom.
/// </summary>
public sealed class MagasinsFluxBase(IOptions<OptionsSocietes> societes) : IDisposable
{
    private readonly ConcurrentDictionary<string, NpgsqlDataSource> sources = new();
    private readonly ConcurrentDictionary<(string, string), MagasinFluxBase> magasins = new();

    public IMagasinFlux Pour(string base_, string magasin) => magasins.GetOrAdd((base_, magasin), _ => new MagasinFluxBase(Source(base_), magasin));

    private NpgsqlDataSource Source(string base_) => sources.GetOrAdd(base_, b =>
    {
        var societe = societes.Value.Societes().FirstOrDefault(s => s.Base == b)
            ?? throw new InvalidOperationException($"Aucune société configurée pour la base {b}");
        return NpgsqlDataSource.Create(societe.Connexion);
    });

    public void Dispose()
    {
        foreach (var s in sources.Values) s.Dispose();
    }
}
