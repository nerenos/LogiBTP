using System.Text;
using Npgsql;

namespace LogiBTP.Installation;

/// <summary>
/// Résultat du contrôle de publication : écarts entre la base neuve et la base montée, écarts de la base de développement avec la base
/// neuve, ou refus (montée impossible). <paramref name="Reference"/> : version de départ de la base montée.
/// </summary>
public sealed record RapportPublication(string Reference, string BaseDeveloppement, IReadOnlyList<EcartSchema> NeuveContreMontee,
    IReadOnlyList<EcartSchema> DeveloppementContreNeuve, string? Refus)
{
    public bool Conforme => Refus is null && NeuveContreMontee.Count == 0 && DeveloppementContreNeuve.Count == 0;

    public string Formater()
    {
        var sb = new StringBuilder();
        sb.AppendLine($"Contrôle de publication : montée depuis {Reference}, développement {BaseDeveloppement}");
        if (Refus is not null)
        {
            sb.AppendLine($"  REFUS : {Refus}");
            return sb.ToString().TrimEnd();
        }
        Ecrire(sb, "base neuve ↔ base montée (schéma non porté par une mineure ou une création)", NeuveContreMontee, "neuve", "montée");
        Ecrire(sb, "base de développement ↔ base neuve (modification manuelle non portée par un script)", DeveloppementContreNeuve, "neuve", BaseDeveloppement);
        sb.AppendLine(Conforme ? "  Conforme : aucun écart." : "  NON CONFORME : ajouter le script manquant (mineure ou création de majeure), ou annuler la modification manuelle.");
        return sb.ToString().TrimEnd();
    }

    private static void Ecrire(StringBuilder sb, string titre, IReadOnlyList<EcartSchema> ecarts, string attendu, string reel)
    {
        sb.AppendLine($"  {titre} : {(ecarts.Count == 0 ? "identiques" : ecarts.Count + " écart(s)")}");
        foreach (var e in ecarts)
        {
            sb.AppendLine($"    {e.Type} {e.Objet}");
            sb.AppendLine($"        {attendu} : {e.Attendu ?? "(absent)"}");
            sb.AppendLine($"        {reel} : {e.Reel ?? "(absent)"}");
        }
    }
}

/// <summary>
/// Contrôle de publication (plan versionnement-schema, lot 9 ; analyse P37), avant chaque version : (1) une base neuve construite par le
/// plan du dépôt ; (2) une base montée depuis la version précédente publiée (<c>racinePrecedente</c> : dépôt de cette version, ou à défaut
/// le socle 1.0 du manifeste socle-1.0.txt) puis mise à jour par le plan du dépôt ; (3) les deux sont comparées entre elles, puis la base
/// de développement donnée à la base neuve. Tout écart non porté par un script est un échec. Les bases temporaires sont supprimées.
/// </summary>
public static class ControlePublication
{
    public static async Task<RapportPublication> VerifierAsync(string connexionAdmin, string proprietaire, Func<string, string> connexionDe, string baseDeveloppement,
        string racine, string? racinePrecedente, bool demo, TextWriter journal, IReadOnlyList<IMigrationCode>? migrations = null, CancellationToken ct = default)
    {
        var reference = racinePrecedente is null ? "le socle 1.0 (socle-1.0.txt)" : $"la version publiée {racinePrecedente}";
        var suffixe = Guid.NewGuid().ToString("N")[..10];
        var neuve = $"logibtp_pub_{suffixe}_n";
        var montee = $"logibtp_pub_{suffixe}_m";
        var bd = new BaseDonnees(journal);
        var plan = PlanScripts.Calculer(racine, migrations);
        List<ScriptManifeste> Retenus(IEnumerable<ScriptManifeste> scripts) => scripts.Where(s => demo || !s.Demo).ToList();
        try
        {
            await bd.CreerBaseAsync(connexionAdmin, neuve, proprietaire, ct);
            await bd.CreerBaseAsync(connexionAdmin, montee, proprietaire, ct);
            await bd.AppliquerAsync(connexionDe(neuve), racine, Retenus(plan.Scripts), migrations: migrations, ct: ct);

            // Version précédente : son plan (ou le socle 1.0 du dépôt courant), puis mise à jour par le plan courant.
            try
            {
                if (racinePrecedente is not null)
                    await bd.AppliquerAsync(connexionDe(montee), racinePrecedente, Retenus(PlanScripts.Calculer(racinePrecedente).Scripts), ct: ct);
                else
                {
                    var socle = ManifesteScripts.Analyser(File.ReadAllLines(Path.Combine(racine, PlanScripts.CheminSocle))).Scripts;
                    var absents = socle.Select(s => s.Chemin).Where(c => !File.Exists(Path.Combine(racine, c))).Distinct().ToList();
                    if (absents.Count > 0)
                        return new RapportPublication(reference, baseDeveloppement, [], [],
                            $"le socle 1.0 n'est plus complet dans le dépôt (scripts archivés : {string.Join(", ", absents.Take(3))}…) : indiquer la version publiée précédente (--depuis DOSSIER)");
                    await bd.AppliquerAsync(connexionDe(montee), racine, Retenus(socle), ct: ct);
                }
                await bd.AppliquerAsync(connexionDe(montee), racine, Retenus(plan.Scripts), migrations: migrations, ct: ct);
            }
            catch (BaseTropAncienneException e)
            {
                return new RapportPublication(reference, baseDeveloppement, [], [], e.Message);
            }
            catch (EmpreinteModifieeException e)
            {
                return new RapportPublication(reference, baseDeveloppement, [], [], "script déjà publié modifié (immuable) : " + string.Join(", ", e.Scripts));
            }

            var ecartsMontee = DeriveSchema.Comparer(await InstantaneSchema.LireAsync(connexionDe(neuve), ct), await InstantaneSchema.LireAsync(connexionDe(montee), ct), []);
            var ecartsDev = await ControleSchema.ComparerAsync(connexionDe(baseDeveloppement), connexionDe(neuve), ct);
            return new RapportPublication(reference, baseDeveloppement, ecartsMontee, ecartsDev, null);
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var cnx = new NpgsqlConnection(connexionAdmin);
            await cnx.OpenAsync(CancellationToken.None);
            foreach (var nom in new[] { neuve, montee })
            {
                await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS {BaseDonnees.VerifierNom(nom)} WITH (FORCE)", cnx);
                await cmd.ExecuteNonQueryAsync(CancellationToken.None);
            }
        }
    }
}
