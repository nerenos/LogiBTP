namespace LogiBTP.Documents;

/// <summary>Unité d'option ou de variante : ligne la plus haute du bloc, type O ou A, ligne de base d'une variante.</summary>
public sealed record UniteOption(long LigId, string TypePrix, long? BaseId);

/// <summary>
/// Options et variantes à la transformation (options.js côté client, jeu modules/document/tests/options/01_unites.json) :
/// une unité est une ligne O ou A dont le parent est absent ou vendu (V) ; la base d'une variante est sa ligne
/// lig_variante_de_id, proposée elle aussi au choix. Ordre : identifiants croissants.
/// </summary>
public static class Options
{
    public static List<UniteOption> Unites<TLigne>(IReadOnlyCollection<TLigne> lignes) where TLigne : DocumentLigne
    {
        var parId = lignes.ToDictionary(l => l.LigId);
        return lignes
            .Where(l => l.LigTypePrix is "O" or "A"
                && (l.LigParentId is not long p || !parId.TryGetValue(p, out var parent) || parent.LigTypePrix == "V"))
            .Select(l => new UniteOption(l.LigId, l.LigTypePrix,
                l.LigTypePrix == "A" && l.LigVarianteDeId is long b && parId.ContainsKey(b) ? b : null))
            .OrderBy(u => u.LigId)
            .ToList();
    }
}
