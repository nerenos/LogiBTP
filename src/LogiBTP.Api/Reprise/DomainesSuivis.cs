using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Premier domaine : suivis tenus par triggers suspendus pendant la reprise, réglages locaux à sa transaction (rien ne
/// change pour les autres connexions, ni après). Chantiers des pièces (<c>document_chantier</c>, db/257) : chaque
/// instruction d'écriture des lignes recalculait les chantiers de la pièce (écriture 6 fois plus lente, de plus en
/// plus) ; signalements de la rentabilité (<c>f_rentabilite_signaler</c>, module Rentabilité 099r) : chaque écriture
/// d'une pièce validée réécrivait la même ligne de file des milliers de fois dans la transaction ; clé des métrés vers
/// leur ligne différée à la fin de la transaction (db/1.6).
/// </summary>
public sealed class SuspensionSuivis : IDomaineReprise
{
    public string Code => DomainesReprise.Codes.SuivisSuspendus;
    public IReadOnlyList<string> Dependances => [];

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        await SqlReprise.ExecuterAsync(ctx.Unite, "SELECT set_config('logibtp.document_chantier_suspendu', 'on', true)", ct);
        await SqlReprise.ExecuterAsync(ctx.Unite, "SELECT set_config('logibtp.rentabilite_suspendue', 'on', true)", ct);
        // Clé métré → ligne contrôlée à la fin (db/1.6) : sinon chaque métré verrouille sa ligne juste avant que la ligne
        // reçoive lig_mtr_id, et ce verrou suivi d'une mise à jour ralentit l'écriture au fil de la transaction.
        await SqlReprise.ExecuterAsync(ctx.Unite, "SET CONSTRAINTS fk_mtr_ligne DEFERRED", ct);
    }
}

/// <summary>
/// Dernier domaine : suivis rétablis, chantiers de toutes les pièces recalculés en une fois, puis tous les chantiers mis
/// dans la file de recalcul de la rentabilité, vidée ensuite par le planificateur de la base (pas de calcul ici).
/// </summary>
public sealed class RecalculSuivis : IDomaineReprise
{
    public const string Raison = "Reprise de données";

    public string Code => DomainesReprise.Codes.Suivis;
    public IReadOnlyList<string> Dependances => [];

    public async Task ExecuterAsync(ContexteReprise ctx, CancellationToken ct)
    {
        await SqlReprise.ExecuterAsync(ctx.Unite, "SELECT set_config('logibtp.document_chantier_suspendu', 'off', true)", ct);
        await SqlReprise.ExecuterAsync(ctx.Unite, "SELECT f_document_chantier_maj(ARRAY(SELECT ent_id FROM document))", ct);
        await SqlReprise.ExecuterAsync(ctx.Unite, "SELECT set_config('logibtp.rentabilite_suspendue', 'off', true)", ct);
        await SqlReprise.ExecuterAsync(ctx.Unite, "SELECT f_rentabilite_signaler(ARRAY(SELECT cha_id FROM chantier), $1)", ct, Raison);
    }
}
