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

    /// <summary>Chaîne de connexion de la base cible (rôle du schéma) ; vide quand l'unité d'écriture est fournie.</summary>
    public string ConnexionCible { get; init; } = "";

    public IReadOnlyList<string> Societes { get; init; } = [];
    public bool Simulation { get; init; } = true;

    /// <summary>Fichier de correspondances fourni (JSON), sinon celui par défaut de la source.</summary>
    public string? Correspondances { get; init; }

    public string? Auteur { get; init; }

    /// <summary>Répertoire de stockage de la GED de la société (déjà sous le nom de sa base) ; null : fichiers non repris.</summary>
    public string? StockageGed { get; init; }

    /// <summary>Décimales des quantités des lignes reprises (null : défaut de la source, <see cref="DecimalesParDefaut"/>).</summary>
    public short? DecimalesQte { get; init; }

    /// <summary>Décimales des prix unitaires des lignes reprises (null : défaut de la source).</summary>
    public short? DecimalesPrix { get; init; }

    /// <summary>MDE : la colonne VOLUME des données techniques en surface (défaut) ou en volume (<see cref="VolumeMde"/>).</summary>
    public string? VolumeMde { get; init; }

    /// <summary>
    /// Décimales par défaut d'une source : MDE affiche les quantités à 3 et les prix à 2 (demande du 19/11/2026) ;
    /// OPTIM : null (décimales de la quantité source, prix à 6).
    /// </summary>
    public static (short? Qte, short? Prix) DecimalesParDefaut(string source) =>
        source.Equals(SourceReprise.Mde, StringComparison.OrdinalIgnoreCase) ? ((short)3, (short)2) : (null, null);
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
        await using var unite = new UniteEcriture(new ConnexionRequete(demande.ConnexionCible));
        return await ExecuterAsync(demande, unite, ct);
    }

    /// <summary>Reprise dans la base de l'unité d'écriture (écran : celle de la société courante ; <c>ConnexionCible</c> ignorée).</summary>
    public static async Task<ResultatReprise> ExecuterAsync(DemandeReprise demande, UniteEcriture unite, CancellationToken ct)
    {
        var source = demande.Source.ToUpperInvariant();
        var (fichier, erreurLecture) = demande.Correspondances is null
            ? (CorrespondancesReprise.ParDefaut(source), null)
            : FichierCorrespondances.Lire(demande.Correspondances);
        if (fichier is null)
            throw new RepriseRefuseeException(ErreurReprise.CorrespondancesInvalides,
                $"Correspondances illisibles : {erreurLecture?.Emplacement} {erreurLecture?.Valeur}");

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
        var moteur = new MoteurReprise(DomainesReprise.Pour(source, demande.StockageGed), BaseCibleReprise.EstVideAsync);
        return await moteur.ExecuterAsync(new OptionsReprise
        {
            Source = source, Societes = demande.Societes, Simulation = demande.Simulation, Auteur = demande.Auteur,
            DecimalesQte = Decimales(demande.DecimalesQte ?? DemandeReprise.DecimalesParDefaut(source).Qte),
            DecimalesPrix = Decimales(demande.DecimalesPrix ?? DemandeReprise.DecimalesParDefaut(source).Prix),
            VolumeMde = demande.VolumeMde?.Trim().ToUpperInvariant() switch
            {
                null or "" or VolumeMde.Surface => VolumeMde.Surface,
                VolumeMde.Volume => VolumeMde.Volume,
                var v => throw new RepriseRefuseeException(ErreurReprise.OptionInvalide, $"Option VOLUME de MDE inconnue : {v} ({VolumeMde.Surface} ou {VolumeMde.Volume})"),
            },
        }, lecteur, fichier, unite, ct);
    }

    /// <summary>Décimales bornées à celles d'une ligne de pièce (0 à 6).</summary>
    private static short? Decimales(short? n) => n is { } d ? (short)Math.Clamp((int)d, 0, 6) : null;
}
