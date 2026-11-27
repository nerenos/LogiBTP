using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Signalements du module Rentabilité suspendus pendant la reprise (premier domaine) : chaque écriture d'une pièce
/// validée signalait ses chantiers à la file de recalcul, réécrivant la même ligne de file des milliers de fois dans
/// une seule transaction (chaîne de versions qui s'allonge, écriture des lignes de plus en plus lente). Réglage local à
/// la transaction de la reprise (<c>f_rentabilite_suspendue</c>, module Rentabilité 099r) : rien ne change pour les
/// autres connexions, ni après la reprise.
/// </summary>
public sealed class SuspensionRentabilite : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.RentabiliteSuspendue;
    public IReadOnlyList<string> Dependances => [];

    public Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct) =>
        SqlReprise.ExecuterAsync(ctx.Unite, "SELECT set_config('logibtp.rentabilite_suspendue', 'on', true)", ct);
}

/// <summary>
/// Dernier domaine : signalements rétablis, puis tous les chantiers repris mis dans la file de recalcul de la
/// rentabilité, vidée ensuite par le planificateur de la base (le calcul ne se fait pas dans la reprise).
/// </summary>
public sealed class RecalculRentabilite : IDomaineReprise
{
    public const string Raison = "Reprise de données";

    public string Code => DomainesReprise.Codes.Rentabilite;
    public IReadOnlyList<string> Dependances => [];

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        await SqlReprise.ExecuterAsync(ctx.Unite, "SELECT set_config('logibtp.rentabilite_suspendue', 'off', true)", ct);
        await SqlReprise.ExecuterAsync(ctx.Unite, "SELECT f_rentabilite_signaler(ARRAY(SELECT cha_id FROM chantier), $1)", ct, Raison);
    }
}
