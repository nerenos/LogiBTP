using System.Reflection;
using LogiBTP.Crm;
using LogiBTP.Domaine;
using Npgsql;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Listes de cibles des correspondances (plan reprise-mde-optim, lot 2), lues dans la base cible : types de documents,
/// types de lignes, casquettes, liens, regroupements de natures, modes de règlement et civilités du paramétrage, types de fiches et natures de notes
/// des codes. Le fichier de correspondances est validé contre ces listes avant toute reprise.
/// </summary>
public static class CiblesReprise
{
    private static readonly (string Liste, string Requete)[] Requetes =
    [
        (CorrespondancesReprise.Listes.TypeDocument, "SELECT tyd_code FROM type_document"),
        (CorrespondancesReprise.Listes.TypeLigne, "SELECT tyl_code FROM type_ligne"),
        (CorrespondancesReprise.Listes.Casquette, "SELECT cas_code FROM casquette"),
        (CorrespondancesReprise.Listes.TypeLien, "SELECT tli_code FROM type_lien"),
        (CorrespondancesReprise.Listes.RegroupementNature, "SELECT rgn_code FROM regroupement_nature"),
        (CorrespondancesReprise.Listes.ModeReglement, "SELECT mre_code FROM mode_reglement"),
        // Civilités proposées par la fiche individu (liste du paramétrage des fiches).
        (CorrespondancesReprise.Listes.Civilite, """
            SELECT o->>'valeur' FROM type_fiche t, jsonb_array_elements(t.tyf_definition->'champs') c,
                   jsonb_array_elements(c->'options') o
            WHERE t.tyf_code = 'individu' AND c->>'code' = 'civilite'
            """),
    ];

    public static async Task<IReadOnlyDictionary<string, IReadOnlyCollection<string>>> LireAsync(
        NpgsqlConnection connexion, NpgsqlTransaction? transaction, CancellationToken ct)
    {
        var cibles = new Dictionary<string, IReadOnlyCollection<string>>(StringComparer.Ordinal)
        {
            [CorrespondancesReprise.Listes.TypeFiche] = Constantes(typeof(TypesFiche)),
            [CorrespondancesReprise.Listes.NatureNote] = Constantes(typeof(NatureNote)),
        };
        foreach (var (liste, requete) in Requetes)
        {
            var valeurs = new List<string>();
            await using var cmd = new NpgsqlCommand(requete, connexion, transaction);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) valeurs.Add(r.GetString(0));
            cibles[liste] = valeurs;
        }
        return cibles;
    }

    private static List<string> Constantes(Type type) =>
        type.GetFields(BindingFlags.Public | BindingFlags.Static).Where(f => f.IsLiteral && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!).ToList();
}
