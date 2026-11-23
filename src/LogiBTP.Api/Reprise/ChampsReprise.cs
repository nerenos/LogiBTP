using System.Globalization;
using System.Text;
using LogiBTP.Fiches;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;
using LogiBTP.Socle;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Champ repris : table de la fiche, clé, colonne et type ; colonne « x_ » créée par la reprise, ou champ standard de la
/// fiche (<paramref name="Standard"/> : jamais écrasé, longueur maximale du texte).
/// </summary>
public sealed record ChampRepris(string Table, string Cle, string Colonne, string Type, bool Standard = false, int? Longueur = null);

/// <summary>Champ standard d'une fiche (paramétrage <c>type_fiche.tyf_definition</c>) : cible d'une zone supplémentaire.</summary>
public sealed record ChampStandard(string Code, string Libelle, string Colonne, string Type, int? Longueur);

/// <summary>
/// Champs supplémentaires des fiches repris (plan reprise-mde-optim, lot 5, Q12) : création des colonnes « x_ » par la
/// fonction <c>fiche_champ_creer</c> du module Fiche (dans la transaction du moteur : une simulation les retire), puis
/// écriture des valeurs sur les fiches reprises par les domaines suivants (registre : table source + clé primaire).
/// </summary>
public static class ChampsReprise
{
    /// <summary>Clé du registre (codes texte) des champs créés : « source.champ » → table|clé|colonne|type.</summary>
    public const string Registre = "champ_supplementaire";

    /// <summary>
    /// Type propre à la reprise du champ standard « usage » des fiches : une zone vraie (Oui, O, 1…) met la fiche en
    /// « Ne plus utiliser » (N), une zone fausse ne change rien.
    /// </summary>
    public const string TypeUsage = "usage";

    /// <summary>
    /// Valeurs d'une liste de choix MDE (SYS_RTCINFOS.PARAMS, ex. <c>S: M "&amp;Oui;&amp;Non"</c>) : préfixe « S: M »
    /// retiré, éléments séparés par « ; », valeur = lettre qui suit « &amp; » (ce que MDE enregistre), libellé sans
    /// « &amp; » ; sans « &amp; » : l'élément entier. Null si aucune valeur.
    /// </summary>
    public static List<OptionChamp>? OptionsMde(string? parametres)
    {
        if (string.IsNullOrWhiteSpace(parametres)) return null;
        var liste = System.Text.RegularExpressions.Regex.Replace(parametres.Trim(), @"^S\s*:\s*M\s*", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase)
            .Trim().Trim('"').Trim();
        var options = new List<OptionChamp>();
        foreach (var brut in liste.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            var i = brut.IndexOf('&');
            var libelle = brut.Replace("&", "", StringComparison.Ordinal).Trim();
            var valeur = i >= 0 && i + 1 < brut.Length ? brut[i + 1].ToString().ToUpperInvariant() : libelle;
            if (libelle.Length == 0 || valeur.Length == 0 || options.Any(o => o.Valeur == valeur)) continue;
            options.Add(new OptionChamp { Valeur = valeur, Libelle = libelle });
        }
        return options.Count > 0 ? options : null;
    }

    /// <summary>Zone de MDE qui bloque la fiche (« Bloqué », « Achat bloqué », « Compte bloqué »…) : versée dans l'usage.</summary>
    public static bool EstBlocage(string libelle) => Comparable(libelle) is var c && (c == "bloque" || c.EndsWith("_bloque", StringComparison.Ordinal));

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

    /// <summary>
    /// Champs standard saisissables de chaque type de fiche : colonne propre, ni lecture seule, ni référence, de type
    /// texte, nombre, date ou case à cocher.
    /// </summary>
    private static async Task<Dictionary<string, List<ChampStandard>>> LireStandardsAsync(ContexteReprise ctx, CancellationToken ct) =>
        (await SqlReprise.LireAsync(ctx.Unite, """
            SELECT t.tyf_code, c->>'code', coalesce(c->>'libelle', c->>'code'), c->>'colonne',
                   CASE WHEN c->>'code' = 'usage' THEN 'usage' ELSE c->>'type' END, (c->>'longueur')::int
            FROM type_fiche t, jsonb_array_elements(t.tyf_definition->'champs') c
            WHERE t.tyf_actif AND c->>'colonne' IS NOT NULL
              AND (c->>'code' = 'usage' OR c->>'type' IN ('texte', 'nombre', 'date', 'booleen')
                   AND coalesce((c->>'lecture_seule')::boolean, false) = false AND c->>'reference' IS NULL)
            """, r => (r.GetString(0), new ChampStandard(r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4), r.IsDBNull(5) ? null : r.GetInt32(5))), ct))
        .GroupBy(x => x.Item1).ToDictionary(g => g.Key, g => g.Select(x => x.Item2).ToList(), StringComparer.Ordinal);

    /// <summary>Libellé comparable : sans unité entre parenthèses, minuscules sans accents, mots séparés par « _ ».</summary>
    public static string Comparable(string libelle) =>
        Nom(System.Text.RegularExpressions.Regex.Replace(libelle, @"\([^)]*\)", " "))[2..].TrimEnd('s');

    /// <summary>Créateur des champs d'une reprise : une colonne par (fiche, libellé), nom libre dans la table.</summary>
    public sealed class Createur
    {
        private readonly ContexteReprise ctx;
        private readonly Dictionary<string, (string Table, string Cle)> types;
        private readonly Dictionary<string, HashSet<string>> colonnes;
        private readonly Dictionary<string, List<ChampStandard>> standards;
        private int ordre;

        private Createur(ContexteReprise ctx, Dictionary<string, (string, string)> types, Dictionary<string, HashSet<string>> colonnes,
            Dictionary<string, List<ChampStandard>> standards)
        {
            this.ctx = ctx; this.types = types; this.colonnes = colonnes; this.standards = standards;
        }

        public static async Task<Createur> LireAsync(ContexteReprise ctx, CancellationToken ct)
        {
            var (types, colonnes) = await LireCiblesAsync(ctx, ct);
            return new Createur(ctx, types, colonnes, await LireStandardsAsync(ctx, ct));
        }

        /// <summary>Champ standard d'une fiche par son code (cible « type_fiche.code » des correspondances).</summary>
        public ChampStandard? Standard(string typeFiche, string code) =>
            standards.GetValueOrDefault(typeFiche)?.FirstOrDefault(c => c.Code == code);

        /// <summary>Champ standard de même libellé (unités entre parenthèses ignorées) ou de même code, s'il est le seul.</summary>
        public ChampStandard? StandardDuLibelle(string typeFiche, string libelle)
        {
            var cle = Comparable(libelle);
            if (cle.Length == 0) return null;
            var trouves = (standards.GetValueOrDefault(typeFiche) ?? []).Where(c => c.Type != TypeUsage)
                .Where(c => Comparable(c.Libelle) == cle || Comparable(c.Code) == cle).ToList();
            return trouves.Count == 1 ? trouves[0] : null;
        }

        /// <summary>Zone versée dans un champ standard de la fiche : inscrite au registre sous <paramref name="cleSource"/>.</summary>
        public ChampRepris? Utiliser(string typeFiche, string cleSource, ChampStandard s)
        {
            if (!types.TryGetValue(typeFiche, out var t)) return null;
            var champ = new ChampRepris(t.Table, t.Cle, s.Colonne, s.Type, true, s.Longueur);
            ctx.Registre.InscrireCode(Registre, cleSource, string.Join('|', champ.Table, champ.Cle, champ.Colonne, champ.Type, "S", s.Longueur));
            ctx.Rapport.Appliquer(Registre, cleSource, $"{t.Table}.{s.Colonne} (champ existant « {s.Libelle} »)");
            return champ;
        }

        /// <summary>Crée le champ d'une fiche et l'inscrit au registre sous <paramref name="cleSource"/> ; null si la fiche est inconnue.</summary>
        public async Task<ChampRepris?> CreerAsync(string typeFiche, string cleSource, string libelle, string type, CancellationToken ct,
            IReadOnlyList<OptionChamp>? valeurs = null)
        {
            if (!types.TryGetValue(typeFiche, out var t))
            {
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.ValeurInconnue, cleSource, $"Type de fiche inconnu : {typeFiche}");
                return null;
            }
            if (!colonnes.TryGetValue(t.Table, out var prises)) colonnes[t.Table] = prises = new(StringComparer.Ordinal);
            var colonne = Associations.CodeLibre(Nom(libelle), 43, prises.Contains);
            prises.Add(colonne);
            await SqlReprise.ExecuterAsync(ctx.Unite, "SELECT fiche_champ_creer($1, $2, $3, $4, $5, $6::text::jsonb)", ct,
                t.Table, colonne, type, AnnuaireReprise.Couper(libelle, ChampsSupplementaires.LongueurLibelle) ?? colonne, ++ordre,
                type == TypesChampSupplementaire.Liste && valeurs is { Count: > 0 } ? System.Text.Json.JsonSerializer.Serialize(valeurs) : null);
            var champ = new ChampRepris(t.Table, t.Cle, colonne, type);
            ctx.Registre.InscrireCode(Registre, cleSource, string.Join('|', champ.Table, champ.Cle, champ.Colonne, champ.Type));
            ctx.Rapport.Appliquer(Registre, cleSource, $"{t.Table}.{colonne} ({type})");
            return champ;
        }
    }

    /// <summary>Champ créé pour une clé source (« table.champ » MDE, « DTB_ID.entité » OPTIM), sinon null.</summary>
    public static ChampRepris? Trouver(ContexteReprise ctx, string cleSource) =>
        ctx.Registre.TrouverCode(Registre, cleSource)?.Split('|') switch
        {
            [var table, var cle, var colonne, var type] => new ChampRepris(table, cle, colonne, type),
            [var table, var cle, var colonne, var type, "S", var longueur] =>
                new ChampRepris(table, cle, colonne, type, true, int.TryParse(longueur, CultureInfo.InvariantCulture, out var n) ? n : null),
            _ => null,
        };

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
                TypeUsage => valeur switch
                {
                    bool b => b,
                    string t => t.Trim().ToUpperInvariant() is "O" or "OUI" or "1" or "TRUE" or "Y" or "YES" or "X",
                    _ => Convert.ToInt64(valeur, CultureInfo.InvariantCulture) != 0,
                } ? "N" : null,
                // Liste de choix MDE : la lettre enregistrée, en majuscule comme les valeurs créées (OptionsMde).
                TypesChampSupplementaire.Liste => Convert.ToString(valeur, CultureInfo.InvariantCulture)?.Trim() is { Length: 1 } lettre
                    ? lettre.ToUpperInvariant() : Convert.ToString(valeur, CultureInfo.InvariantCulture)?.Trim(),
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
    /// <remarks>
    /// Champ standard (colonne lue dans le paramétrage des fiches, jamais saisie) : écrit seulement s'il est vide, la
    /// valeur déjà reprise d'une autre table de la source primant ; texte coupé à la longueur du champ.
    /// </remarks>
    public static async Task<int> EcrireAsync(ContexteReprise ctx, ChampRepris champ, long id, object valeur, CancellationToken ct)
    {
        if (!champ.Standard && !ChampsSupplementaires.NomValide(champ.Colonne))
            throw new InvalidOperationException($"Colonne de champ supplémentaire invalide : {champ.Colonne}");
        if (champ.Standard && valeur is string s && champ.Longueur is { } max) valeur = AnnuaireReprise.Couper(s, max) ?? s;
        var colonne = ConstructeurFiche.Identifiant(champ.Colonne);
        // Usage : seulement une fiche encore en service (une fiche en sommeil le reste).
        var condition = !champ.Standard ? "" : champ.Type == TypeUsage ? " AND " + colonne + " = 'A'" : " AND " + colonne + " IS NULL";
        var sql = "UPDATE " + ConstructeurFiche.Identifiant(champ.Table) + " SET " + colonne + " = $1 WHERE "
                  + ConstructeurFiche.Identifiant(champ.Cle) + " = $2" + condition;
        var n = await SqlReprise.ExecuterAsync(ctx.Unite, sql, ct, valeur, id);
        if (n == 0 && champ.Standard && champ.Type != TypeUsage)
            ctx.Rapport.Perdre(champ.Table, champ.Colonne, Convert.ToString(valeur, CultureInfo.InvariantCulture), "champ existant déjà renseigné par la reprise");
        return n;
    }
}
