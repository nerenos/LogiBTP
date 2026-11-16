using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Import.Reprise.Lecteurs;
using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Reprise;

/// <summary>Demande de reprise d'une base source vers une base LogiBTP neuve.</summary>
public sealed record DemandeReprise
{
    /// <summary>Logiciel source (<see cref="SourceReprise"/>).</summary>
    public required string Source { get; init; }

    /// <summary>Chaîne de connexion de la base source (jamais enregistrée ni affichée).</summary>
    public required string ConnexionSource { get; init; }

    /// <summary>Chaîne de connexion de la base cible (rôle du schéma).</summary>
    public required string ConnexionCible { get; init; }

    public IReadOnlyList<string> Societes { get; init; } = [];
    public bool Simulation { get; init; } = true;

    /// <summary>Fichier de correspondances fourni (JSON), sinon celui par défaut de la source.</summary>
    public string? Correspondances { get; init; }

    public string? Auteur { get; init; }
}

/// <summary>
/// Reprise d'une base MDE ou OptimBTP (plan reprise-mde-optim), commune à la commande de l'installeur et à l'écran
/// d'administration : lecteur de la source, correspondances validées contre les listes de la base cible, domaines du
/// cœur (<see cref="DomainesReprise"/>), moteur du module Import.
/// </summary>
public static class RepriseBase
{
    public static ILecteurSource Lecteur(string source, string connexion) => source switch
    {
        SourceReprise.Mde => new LecteurSqlServer(connexion),
        SourceReprise.Optim => new LecteurMariaDb(connexion),
        _ => throw new ArgumentException($"Source de reprise inconnue : {source} (MDE ou OPTIM)"),
    };

    public static async Task<ResultatReprise> ExecuterAsync(DemandeReprise demande, CancellationToken ct)
    {
        var source = demande.Source.ToUpperInvariant();
        var (fichier, erreurLecture) = demande.Correspondances is null
            ? (CorrespondancesReprise.ParDefaut(source), null)
            : FichierCorrespondances.Lire(demande.Correspondances);
        if (fichier is null)
            throw new RepriseRefuseeException(ErreurReprise.CorrespondancesInvalides,
                $"Correspondances illisibles : {erreurLecture?.Emplacement} {erreurLecture?.Valeur}");

        await using var unite = new UniteEcriture(new ConnexionRequete(demande.ConnexionCible));
        IReadOnlyDictionary<string, IReadOnlyCollection<string>> cibles;
        await using (var lecture = await unite.CommencerAsync(ct))
        {
            cibles = await CiblesReprise.LireAsync(unite.Connexion, unite.Transaction, ct);
            await lecture.RollbackAsync(ct);
        }
        var erreurs = fichier.Valider(CorrespondancesReprise.TablesAttendues(source), cibles, source);
        if (erreurs.Count > 0)
            throw new RepriseRefuseeException(ErreurReprise.CorrespondancesInvalides,
                "Correspondances invalides : " + string.Join(" ; ", erreurs.Select(e => $"{e.Code} {e.Emplacement} {e.Valeur}".TrimEnd())));

        await using var lecteur = Lecteur(source, demande.ConnexionSource);
        var moteur = new MoteurReprise(DomainesReprise.Pour(source), BaseCibleReprise.EstVideAsync);
        return await moteur.ExecuterAsync(new OptionsReprise
        {
            Source = source, Societes = demande.Societes, Simulation = demande.Simulation, Auteur = demande.Auteur,
        }, lecteur, fichier, unite, ct);
    }
}
