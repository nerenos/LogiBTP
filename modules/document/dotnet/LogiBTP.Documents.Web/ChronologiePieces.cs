namespace LogiBTP.Documents.Web;

/// <summary>Pièce numérotée candidate au contrôle de chronologie (règle DATE_PIECE).</summary>
public sealed record PieceChronologie(long Id, string? Numero, DateOnly Date, long? GroupeId, string StatutCode);

/// <summary>Règle de numérotation continue : la date d'une pièce ne précède pas la dernière pièce numérotée du même type.
/// Sont écartées les pièces REMPLACE (versions d'origine d'une pièce dévalidée) et celles du même groupe d'indices
/// que le document validé ; les pièces ANNULE restent dans la chronologie.</summary>
public static class ChronologiePieces
{
    public static PieceChronologie? Derniere(IEnumerable<PieceChronologie> pieces, long documentId, long? groupeId, DateOnly date) =>
        pieces
            .Where(p => p.Numero is not null && p.Id != documentId && p.Date > date
                        && p.StatutCode != StatutsDocument.Remplace
                        && !(groupeId is not null && p.GroupeId == groupeId))
            .OrderByDescending(p => p.Date)
            .FirstOrDefault();
}
