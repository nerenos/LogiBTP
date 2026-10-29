using System.Globalization;
using System.Text.Json;
using LogiBTP.Fiches;
using LogiBTP.Socle;
using LogiBTP.Socle.Web;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LogiBTP.Fiches.Web;

/// <summary>
/// Chrono du code des fiches (règle ChronoFiche, format paramétré dans chrono_fiche, compteur compteur_fiche) : code
/// prévisionnel affiché à la création (le compteur n'avance pas), code calculé attribué à l'enregistrement de la
/// création (incrément dans la transaction, rang déjà pris sauté), code saisi contrôlé (CODE_PRIS : prochain code libre
/// proposé à partir de la saisie), code modifié après la création réservé au droit MODIFIER_CODE.
/// </summary>
public partial class ServiceFiche : IChronosFiches
{
    /// <summary>Chrono résolu pour une fiche : définition, variante, préfixe, format, remise à zéro, portée, texte du parent.</summary>
    protected sealed record ChronoResolu(ChronoDefinition Definition, string Variante, string? Prefixe, string? Format, string Raz, string Portee, string? Parent)
    {
        public bool AParent => ChronoFiche.AParent(Format);
    }

    private delegate Task<List<Dictionary<string, object?>>> Lecteur(RequeteFiche r);

    private static string? TexteValeur(object? v) => v switch
    {
        null => null,
        JsonElement e => e.ValueKind switch { JsonValueKind.Null or JsonValueKind.Undefined => null, JsonValueKind.String => e.GetString(), _ => e.GetRawText() },
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => v.ToString(),
    } is { } s && s.Trim().Length > 0 ? s.Trim() : null;

    /// <summary>Format effectif d'un type et d'une variante : paramétrage, sinon définition (préfixe de la variante).</summary>
    private async Task<(string? Prefixe, string? Format, string Raz)> FormatChrono(string type, ChronoDefinition def, string variante, CancellationToken ct)
    {
        var p = await db.Chronos.AsNoTracking().FirstOrDefaultAsync(c => c.ChfType == type && c.ChfVariante == variante, ct);
        if (p is not null) return (p.ChfPrefixe, p.ChfFormat ?? def.Format, p.ChfRaz);
        var prefixe = def.Variantes?.FirstOrDefault(v => v.Valeur == variante)?.Prefixe ?? def.Prefixe;
        return (prefixe, def.Format, def.Raz);
    }

    /// <summary>Chrono d'une fiche d'après ses valeurs (variante, portée, parent) ; null si le type n'en a pas.</summary>
    protected async Task<ChronoResolu?> Chrono(TypeFicheResolu t, IReadOnlyDictionary<string, object?> valeurs, CancellationToken ct)
    {
        if (t.Definition.Chrono is not { } def) return null;
        var variante = def.Variante is null ? "" : TexteValeur(valeurs.GetValueOrDefault(def.Variante)) ?? def.Variantes?.FirstOrDefault()?.Valeur ?? "";
        var (prefixe, format, raz) = await FormatChrono(t.Code, def, variante, ct);
        var portee = def.Portee is null ? "" : TexteValeur(valeurs.GetValueOrDefault(def.Portee)) ?? "";
        string? parent = null;
        if (def.Parent is not null && ChronoFiche.AParent(format) && TexteValeur(valeurs.GetValueOrDefault(def.Parent)) is { } p)
            parent = await specialisation.CodeParentChronoAsync(t.Code, def.Parent, p, ct);
        return new ChronoResolu(def, variante, prefixe, format, raz, portee, parent);
    }

    private ChampFiche ChampChrono(TypeFicheResolu t, string code) =>
        t.Definition.Champs.FirstOrDefault(c => c.Code == code && c.Colonne is not null) ?? throw ExceptionMetier.Invalide("CHAMP", $"Chrono : champ {code} sans colonne");

    private string? ColonnePortee(TypeFicheResolu t, ChronoResolu ch) => ch.Definition.Portee is { } p ? ChampChrono(t, p).Colonne : null;

    private Task<List<Dictionary<string, object?>>> LireRequete(RequeteFiche r, CancellationToken ct) => Lire(r, ct);

    /// <summary>Fiche qui porte déjà le code dans la portée (hors de la fiche exclue), ou null.</summary>
    private async Task<FichePrise?> CodePris(TypeFicheResolu t, ChronoResolu ch, string code, string? exclure, Lecteur lire)
    {
        var l = (await lire(specialisation.Constructeur(t).CodePris(ChampChrono(t, ch.Definition.Champ).Colonne!, code, ColonnePortee(t, ch), ch.Portee == "" ? null : ch.Portee, exclure))).FirstOrDefault();
        return l is null ? null : new FichePrise((string)l["id"]!, (string)l["code"]!);
    }

    /// <summary>Rangs déjà pris de l'exercice (ou du parent), lus dans les codes au format.</summary>
    private async Task<HashSet<int>> RangsPris(TypeFicheResolu t, ChronoResolu ch, int annee, Lecteur lire)
    {
        var exercice = ChronoFiche.Exercice(ch.Raz, annee);
        var debut = ChronoFiche.Debut(ch.Format, ch.Prefixe, ch.AParent || exercice == 0 ? null : annee, ch.Parent);
        var codes = await lire(specialisation.Constructeur(t).CodesCommencantPar(ChampChrono(t, ch.Definition.Champ).Colonne!, debut, ColonnePortee(t, ch), ch.Portee == "" ? null : ch.Portee));
        return codes.Select(c => ChronoFiche.Lire(ch.Format, ch.Prefixe, c["code"] as string, ch.Parent))
            .Where(x => x is not null && (ch.AParent || ChronoFiche.Exercice(ch.Raz, x.Annee ?? annee) == exercice)).Select(x => x!.Rang).ToHashSet();
    }

    private static int PremierLibre(HashSet<int> pris, int depuis)
    {
        var r = Math.Max(1, depuis);
        while (pris.Contains(r)) r++;
        return r;
    }

    private static readonly string SqlCompteur = """
        SELECT cpf_dernier FROM compteur_fiche WHERE cpf_type = @p0 AND cpf_variante = @p1 AND cpf_portee = @p2 AND cpf_exercice = CAST(@p3 AS int)
        """;

    private static RequeteFiche Compteur(string type, ChronoResolu ch, int exercice, string sql, int? valeur = null) =>
        new(sql, [new("p0", type), new("p1", ch.Variante), new("p2", ch.Portee), new("p3", exercice.ToString(CultureInfo.InvariantCulture)),
            new("p4", valeur?.ToString(CultureInfo.InvariantCulture))]);

    /// <summary>Code prévisionnel : rang suivant du compteur (ou du parent), rang déjà pris sauté ; le compteur n'avance pas.</summary>
    private async Task<string?> Previsionnel(TypeFicheResolu t, ChronoResolu ch, Lecteur lire)
    {
        if (ch.AParent && ch.Parent is null) return null;
        var annee = DateTime.Today.Year;
        var pris = await RangsPris(t, ch, annee, lire);
        if (ch.AParent) return ChronoFiche.Formater(ch.Format, ch.Prefixe, annee, pris.Count == 0 ? 1 : pris.Max() + 1, ch.Parent);
        var exercice = ChronoFiche.Exercice(ch.Raz, annee);
        var dernier = (await lire(Compteur(t.Code, ch, exercice, SqlCompteur))).FirstOrDefault()?["cpf_dernier"] is int d ? d : 0;
        return ChronoFiche.Formater(ch.Format, ch.Prefixe, annee, PremierLibre(pris, dernier + 1));
    }

    /// <summary>
    /// Code calculé attribué dans la transaction de la création : compteur incrémenté puis replacé sur le premier rang
    /// libre (codes saisis à la main, reprise d'un ancien logiciel) ; à {PARENT} : plus grand rang du parent + 1.
    /// </summary>
    private async Task<string?> Attribuer(TypeFicheResolu t, ChronoResolu ch, Lecteur lire)
    {
        if (ch.AParent) return await Previsionnel(t, ch, lire);
        var annee = DateTime.Today.Year;
        var exercice = ChronoFiche.Exercice(ch.Raz, annee);
        var n = (int)(await lire(Compteur(t.Code, ch, exercice, """
            INSERT INTO compteur_fiche (cpf_type, cpf_variante, cpf_portee, cpf_exercice, cpf_dernier) VALUES (@p0, @p1, @p2, CAST(@p3 AS int), 1)
            ON CONFLICT (cpf_type, cpf_variante, cpf_portee, cpf_exercice) DO UPDATE SET cpf_dernier = compteur_fiche.cpf_dernier + 1
            RETURNING cpf_dernier
            """)))[0]["cpf_dernier"]!;
        var code = ChronoFiche.Formater(ch.Format, ch.Prefixe, annee, n);
        if (await CodePris(t, ch, code, null, lire) is null) return code;
        var libre = PremierLibre(await RangsPris(t, ch, annee, lire), n);
        await lire(Compteur(t.Code, ch, exercice, "UPDATE compteur_fiche SET cpf_dernier = CAST(@p4 AS int) WHERE cpf_type = @p0 AND cpf_variante = @p1 AND cpf_portee = @p2 AND cpf_exercice = CAST(@p3 AS int) RETURNING cpf_dernier", libre));
        return ChronoFiche.Formater(ch.Format, ch.Prefixe, annee, libre);
    }

    /// <summary>Prochain code libre à partir d'une saisie déjà prise (nombre final augmenté, sinon « 1 » ajouté).</summary>
    private async Task<string?> SuivantLibre(TypeFicheResolu t, ChronoResolu ch, string code, Lecteur lire)
    {
        var c = ChronoFiche.Suivant(code);
        for (var i = 0; c is not null && i < 1000; i++, c = ChronoFiche.Suivant(c))
            if (await CodePris(t, ch, c, null, lire) is null) return c;
        return null;
    }

    /// <summary>Lecture dans la transaction d'une écriture.</summary>
    private static Lecteur Dans(NpgsqlConnection cnx, NpgsqlTransaction tx, CancellationToken ct) => r => LireDans(cnx, tx, r, ct);

    /// <summary>
    /// Code d'une fiche en saisie : code prévisionnel (création) et fiche qui porte déjà le code saisi (création ou
    /// modification, hors de la fiche elle-même).
    /// </summary>
    public virtual async Task<ReponseCode> Code(string code, DemandeCode d, Utilisateur u, CancellationToken ct)
    {
        await Exiger(code, u, x => x.Modifier, ActionsDroits.Modifier, ct);
        var t = await Type(code, ct);
        var valeurs = d.Valeurs.ToDictionary(kv => kv.Key, kv => ValidationFiche.Normaliser(kv.Value));
        if (await Chrono(t, valeurs, ct) is not { } ch) return new ReponseCode(null, null);
        Lecteur lire = r => LireRequete(r, ct);
        var previsionnel = d.Id is null ? await Previsionnel(t, ch, lire) : null;
        var saisi = TexteValeur(d.Code);
        return new ReponseCode(previsionnel, saisi is null ? null : await CodePris(t, ch, saisi, d.Id, lire));
    }

    /// <summary>
    /// Création : code vide = code prévisionnel pour la validation (attribué ensuite dans la transaction) ; code saisi
    /// déjà pris = refus CODE_PRIS avec le prochain code libre proposé. Renvoie le chrono si le code est à attribuer.
    /// </summary>
    protected async Task<ChronoResolu?> PreparerCodeCreation(TypeFicheResolu t, Dictionary<string, object?> valeurs, CancellationToken ct)
    {
        if (await Chrono(t, valeurs, ct) is not { } ch) return null;
        var champ = ch.Definition.Champ;
        Lecteur lire = r => LireRequete(r, ct);
        if (TexteValeur(valeurs.GetValueOrDefault(champ)) is { } saisi)
        {
            if (await CodePris(t, ch, saisi, null, lire) is { } pris)
                throw ExceptionMetier.Conflit(ErreursFiche.CodePris, $"Le code {saisi} est déjà utilisé", new CodePrisDetails(saisi, pris, await SuivantLibre(t, ch, saisi, lire)));
            return null;
        }
        valeurs[champ] = await Previsionnel(t, ch, lire);
        return ch;
    }

    /// <summary>
    /// Modification : code changé = droit MODIFIER_CODE, et refus CODE_PRIS s'il est déjà porté par une autre fiche
    /// (aucune proposition : l'utilisateur choisit).
    /// </summary>
    protected async Task ControlerCodeModifie(TypeFicheResolu t, string id, IReadOnlyDictionary<string, object?> avant, IReadOnlyDictionary<string, object?> valeurs,
        DroitsFiche droits, NpgsqlConnection cnx, NpgsqlTransaction tx, CancellationToken ct)
    {
        if (t.Definition.Chrono is not { } def) return;
        var nouveau = TexteValeur(valeurs.GetValueOrDefault(def.Champ));
        if (nouveau == TexteValeur(avant.GetValueOrDefault(def.Champ))) return;
        if (!droits.ModifierCode) throw ExceptionMetier.AccesRefuse(ActionsDroits.ModifierCode);
        if (nouveau is null || await Chrono(t, valeurs, ct) is not { } ch) return;
        if (await CodePris(t, ch, nouveau, id, Dans(cnx, tx, ct)) is { } pris)
            throw ExceptionMetier.Invalide(ErreursFiche.CodePris, $"Le code {nouveau} est déjà utilisé", new CodePrisDetails(nouveau, pris, null));
    }

    /// <summary>Code calculé attribué dans la transaction de la création (compteur avancé).</summary>
    protected Task<string?> AttribuerCode(TypeFicheResolu t, ChronoResolu ch, NpgsqlConnection cnx, NpgsqlTransaction tx, CancellationToken ct) =>
        Attribuer(t, ch, Dans(cnx, tx, ct));

    /// <summary>Contrat IChronosFiches : code attribué hors de la fiche (tiers provisoire…), dans sa propre transaction.</summary>
    public virtual async Task<string?> AttribuerAsync(string type, IReadOnlyDictionary<string, object?> valeurs, CancellationToken ct)
    {
        var t = await Type(type, ct);
        if (await Chrono(t, valeurs, ct) is not { } ch) return null;
        return await Ecrire((cnx, tx) => Attribuer(t, ch, Dans(cnx, tx, ct)), ct);
    }

    // ------------------------------------------------------------------ paramétrage

    /// <summary>Chronos d'un type (une ligne par variante) : format effectif, compteur de l'exercice en cours (portée commune), prochain code.</summary>
    public virtual async Task<List<ChronoTypeDto>> Chronos(string code, Utilisateur u, CancellationToken ct)
    {
        await Exiger(code, u, d => d.Voir, ActionsDroits.Voir, ct);
        var t = await Type(code, ct);
        if (t.Definition.Chrono is not { } def) return [];
        var annee = DateTime.Today.Year;
        var res = new List<ChronoTypeDto>();
        foreach (var v in def.Variantes is { Count: > 0 } vs ? vs : [new VarianteChrono()])
        {
            var (prefixe, format, raz) = await FormatChrono(code, def, v.Valeur, ct);
            var ch = new ChronoResolu(def, v.Valeur, prefixe, format, raz, "", null);
            var exercice = ChronoFiche.Exercice(raz, annee);
            var dernier = ch.AParent ? 0 : (await Lire(Compteur(code, ch, exercice, SqlCompteur), ct)).FirstOrDefault()?["cpf_dernier"] is int d ? d : 0;
            // Prochain code : celui que recevra une création (rang déjà pris sauté) ; d'après le chantier pour un marché.
            var prochain = ch.AParent || def.Portee is not null ? ChronoFiche.Formater(format, prefixe, annee, dernier + 1, ch.AParent ? "…" : null)
                : await Previsionnel(t, ch, r => LireRequete(r, ct)) ?? "";
            res.Add(new ChronoTypeDto(code, t.Definition.Libelle, v.Valeur, v.Libelle, prefixe, format, raz, ch.AParent, def.Portee is not null, exercice, dernier, prochain));
        }
        return res;
    }

    /// <summary>
    /// Chrono d'un type (administrateur) : préfixe, format contrôlé, remise à zéro ; reprise : dernier rang de l'exercice
    /// en cours, portée commune (le suivant sera attribué ; un rang déjà pris est sauté).
    /// </summary>
    public virtual async Task<List<ChronoTypeDto>> EnregistrerChrono(string code, ChronoSaisie s, Utilisateur u, CancellationToken ct)
    {
        u.ExigerAdmin();
        var t = await Type(code, ct);
        if (t.Definition.Chrono is not { } def) throw ExceptionMetier.Invalide("CHRONO", $"Les fiches {t.Definition.Libelle} n'ont pas de chrono");
        var variante = s.Variante ?? "";
        if (def.Variantes is { Count: > 0 } vs ? vs.All(v => v.Valeur != variante) : variante != "") throw ExceptionMetier.Invalide("CHRONO", $"Variante inconnue : {variante}");
        var raz = s.Raz == "A" ? "A" : "J";
        var format = string.IsNullOrWhiteSpace(s.Format) ? null : s.Format.Trim();
        if (ChronoFiche.Controler(format ?? def.Format, raz) is { } erreur) throw ExceptionMetier.Invalide("CHRONO_FORMAT", erreur);
        if (s.Prefixe?.Trim().Length > 10) throw ExceptionMetier.Invalide("CHRONO_FORMAT", "Préfixe de 10 caractères au plus");
        if (s.Dernier is < 0) throw ExceptionMetier.Invalide("CHRONO_REPRISE", "Dernier rang positif ou nul");
        var p = await db.Chronos.FirstOrDefaultAsync(c => c.ChfType == code && c.ChfVariante == variante, ct);
        if (p is null) db.Chronos.Add(p = new ChronoParametre { ChfType = code, ChfVariante = variante });
        p.ChfPrefixe = string.IsNullOrWhiteSpace(s.Prefixe) ? null : s.Prefixe.Trim();
        p.ChfFormat = format;
        p.ChfRaz = raz;
        await db.SaveChangesAsync(ct);
        if (s.Dernier is int dernier)
        {
            var ch = new ChronoResolu(def, variante, p.ChfPrefixe, format ?? def.Format, raz, "", null);
            await Lire(Compteur(code, ch, ChronoFiche.Exercice(raz, DateTime.Today.Year), """
                INSERT INTO compteur_fiche (cpf_type, cpf_variante, cpf_portee, cpf_exercice, cpf_dernier) VALUES (@p0, @p1, @p2, CAST(@p3 AS int), CAST(@p4 AS int))
                ON CONFLICT (cpf_type, cpf_variante, cpf_portee, cpf_exercice) DO UPDATE SET cpf_dernier = EXCLUDED.cpf_dernier
                RETURNING cpf_dernier
                """, dernier), ct, ecriture: true);
        }
        return await Chronos(code, u, ct);
    }
}
