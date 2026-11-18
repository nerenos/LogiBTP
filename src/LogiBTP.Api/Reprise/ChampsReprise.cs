using System.Globalization;
using System.Text;
using LogiBTP.Fiches;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle;

namespace LogiBTP.Api.Reprise;

/// <summary>Champ supplémentaire créé par la reprise : table de la fiche, clé, colonne « x_ » et type.</summary>
public sealed record ChampRepris(string Table, string Cle, string Colonne, string Type);

/// <summary>
/// Champs supplémentaires des fiches repris (plan reprise-mde-optim, lot 5, Q12) : création des colonnes « x_ » par la
/// fonction <c>fiche_champ_creer</c> du module Fiche (dans la transaction du moteur : une simulation les retire), puis
/// écriture des valeurs sur les fiches reprises par les domaines suivants (registre : table source + clé primaire).
/// </summary>
public static class ChampsReprise
{
    /// <summary>Clé du registre (codes texte) des champs créés : « source.champ » → table|clé|colonne|type.</summary>
    public const string Registre = "champ_supplementaire";

    /// <summary>Nom de colonne « x_ » tiré d'un libellé : minuscules sans accents, mots séparés par « _ », 41 caractères.</summary>
    public static string Nom(string libelle)
    {
        var b = new StringBuilder();
        foreach (var c in SansAccent.Retirer(libelle))
        {
            if (c is >= 'a' and <= 'z' or >= '0' and <= '9') b.Append(c);
            else if (b.Length > 0 && b[^1] != '_') b.Append('_');
        }
        var nom = b.ToString().Trim('_');
        if (nom.Length == 0 || !char.IsAsciiLetterLower(nom[0])) nom = "champ_" + nom;
        nom = nom.Length > 41 ? nom[..41].TrimEnd('_') : nom;
        return "x_" + nom;
    }

    /// <summary>Table et clé de chaque type de fiche (type_fiche), colonnes existantes des tables.</summary>
    private static async Task<(Dictionary<string, (string Table, string Cle)> Types, Dictionary<string, HashSet<string>> Colonnes)> LireCiblesAsync(
        ContexteReprise ctx, CancellationToken ct)
    {
        var types = (await SqlReprise.LireAsync(ctx.Unite, "SELECT tyf_code, tyf_table, tyf_cle FROM type_fiche WHERE tyf_actif",
            r => (r.GetString(0), r.GetString(1), r.GetString(2)), ct)).ToDictionary(t => t.Item1, t => (Table: t.Item2, Cle: t.Item3), StringComparer.Ordinal);
        var colonnes = (await SqlReprise.LireAsync(ctx.Unite,
            "SELECT table_name::text, column_name::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)",
            r => (r.GetString(0), r.GetString(1)), ct, (object)types.Values.Select(t => t.Table).Distinct().ToArray()))
            .GroupBy(c => c.Item1).ToDictionary(g => g.Key, g => g.Select(c => c.Item2).ToHashSet(StringComparer.Ordinal), StringComparer.Ordinal);
        return (types, colonnes);
    }

    /// <summary>Créateur des champs d'une reprise : une colonne par (fiche, libellé), nom libre dans la table.</summary>
    public sealed class Createur
    {
        private readonly ContexteReprise ctx;
        private readonly Dictionary<string, (string Table, string Cle)> types;
        private readonly Dictionary<string, HashSet<string>> colonnes;
        private int ordre;

        private Createur(ContexteReprise ctx, Dictionary<string, (string, string)> types, Dictionary<string, HashSet<string>> colonnes)
        {
            this.ctx = ctx; this.types = types; this.colonnes = colonnes;
        }

        public static async Task<Createur> LireAsync(ContexteReprise ctx, CancellationToken ct)
        {
            var (types, colonnes) = await LireCiblesAsync(ctx, ct);
            return new Createur(ctx, types, colonnes);
        }

        /// <summary>Crée le champ d'une fiche et l'inscrit au registre sous <paramref name="cleSource"/> ; null si la fiche est inconnue.</summary>
        public async Task<ChampRepris?> CreerAsync(string typeFiche, string cleSource, string libelle, string type, CancellationToken ct)
        {
            if (!types.TryGetValue(typeFiche, out var t))
            {
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ValeurInconnue, cleSource, $"Type de fiche inconnu : {typeFiche}");
                return null;
            }
            if (!colonnes.TryGetValue(t.Table, out var prises)) colonnes[t.Table] = prises = new(StringComparer.Ordinal);
            var colonne = Associations.CodeLibre(Nom(libelle), 43, prises.Contains);
            prises.Add(colonne);
            await SqlReprise.ExecuterAsync(ctx.Unite, "SELECT fiche_champ_creer($1, $2, $3, $4, $5, NULL)", ct,
                t.Table, colonne, type, AnnuaireReprise.Couper(libelle, ChampsSupplementaires.LongueurLibelle) ?? colonne, ++ordre);
            var champ = new ChampRepris(t.Table, t.Cle, colonne, type);
            ctx.Registre.InscrireCode(Registre, cleSource, string.Join('|', champ.Table, champ.Cle, champ.Colonne, champ.Type));
            ctx.Rapport.Appliquer(Registre, cleSource, $"{t.Table}.{colonne} ({type})");
            return champ;
        }
    }

    /// <summary>Champ créé pour une clé source (« table.champ » MDE, « DTB_ID.entité » OPTIM), sinon null.</summary>
    public static ChampRepris? Trouver(ContexteReprise ctx, string cleSource) =>
        ctx.Registre.TrouverCode(Registre, cleSource)?.Split('|') is [var table, var cle, var colonne, var type]
            ? new ChampRepris(table, cle, colonne, type) : null;

    /// <summary>
    /// Valeur source convertie au type du champ (texte, nombre, montant, date, case à cocher) ; null si vide ou
    /// illisible (illisible : perte notée au rapport).
    /// </summary>
    public static object? Convertir(ContexteReprise ctx, ChampRepris champ, object? valeur)
    {
        if (valeur is null or DBNull || valeur is string s && string.IsNullOrWhiteSpace(s)) return null;
        try
        {
            return champ.Type switch
            {
                TypesChampSupplementaire.Nombre or TypesChampSupplementaire.Montant => valeur switch
                {
                    string t => decimal.Parse(t.Trim().Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture),
                    double d => ArrondiCalcul.Arrondir((decimal)d, LigneSource.Precision),
                    float f => ArrondiCalcul.Arrondir((decimal)f, LigneSource.Precision),
                    _ => Convert.ToDecimal(valeur, CultureInfo.InvariantCulture),
                },
                TypesChampSupplementaire.Date => valeur switch
                {
                    DateTime d => d.Year <= 1900 ? null : DateOnly.FromDateTime(d),
                    DateOnly d => d,
                    string t => DateOnly.FromDateTime(DateTime.Parse(t, CultureInfo.GetCultureInfo("fr-FR"))),
                    _ => throw new FormatException(),
                },
                TypesChampSupplementaire.CaseACocher => valeur switch
                {
                    bool b => b,
                    string t => t.Trim() is "1" or "O" or "o" or "OUI" or "oui" or "true" or "True",
                    _ => Convert.ToInt64(valeur, CultureInfo.InvariantCulture) != 0,
                },
                _ => Convert.ToString(valeur, CultureInfo.InvariantCulture)?.TrimEnd(),
            };
        }
        catch (Exception e) when (e is FormatException or InvalidCastException or OverflowException)
        {
            ctx.Rapport.Perdre(champ.Table, champ.Colonne, Convert.ToString(valeur, CultureInfo.InvariantCulture), $"valeur illisible pour un champ {champ.Type}");
            return null;
        }
    }

    /// <summary>Écrit une valeur sur une fiche reprise (identifiants contrôlés et entre guillemets, valeur en paramètre).</summary>
    public static Task<int> EcrireAsync(ContexteReprise ctx, ChampRepris champ, long id, object valeur, CancellationToken ct)
    {
        if (!ChampsSupplementaires.NomValide(champ.Colonne))
            throw new InvalidOperationException($"Colonne de champ supplémentaire invalide : {champ.Colonne}");
        var sql = "UPDATE " + ConstructeurFiche.Identifiant(champ.Table) + " SET " + ConstructeurFiche.Identifiant(champ.Colonne)
                  + " = $1 WHERE " + ConstructeurFiche.Identifiant(champ.Cle) + " = $2";
        return SqlReprise.ExecuterAsync(ctx.Unite, sql, ct, valeur, id);
    }
}
