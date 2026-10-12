using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace LogiBTP.Annuaire;

/// <summary>
/// Usage d'une coordonnée saisi dans une fiche (champs gérés « coordonnees ») : identifiants (usage, coordonnée),
/// qualification, valeurs, valeurs d'origine (lues ou reprises d'une autre fiche) et choix de l'utilisateur pour une
/// coordonnée partagée modifiée (MODIFICATION ou AUTRE).
/// </summary>
public sealed class SaisieCoordonnee
{
    public long? UcoId { get; set; }
    public long? CooId { get; set; }
    public string Nature { get; set; } = "";
    public string? Usage { get; set; }
    public string? Libelle { get; set; }
    public bool? Principal { get; set; }
    public string? Ligne1 { get; set; }
    public string? Ligne2 { get; set; }
    public string? Ligne3 { get; set; }
    public string? CodePostal { get; set; }
    public string? Ville { get; set; }
    public string? Pays { get; set; }
    public string? Valeur { get; set; }
    public string? Reseau { get; set; }
    public SaisieCoordonnee? Origine { get; set; }
    public string? Choix { get; set; }
}

/// <summary>Opération d'un plan : SUPPRIMER (usage), AJOUTER ou MAJ (usage, coordonnée gardée, modifiée ou nouvelle).</summary>
public sealed record OperationCoordonnee(string Op, int? Index, long? UcoId, long? CooId, string? Coordonnee,
    IReadOnlyDictionary<string, string?>? Valeurs, string? Nature, string? Usage, string? Libelle, bool Principal, int Ordre)
{
    /// <summary>Forme JSON du plan JS (SUPPRIMER : op et uco_id seulement ; valeurs absentes pour GARDER).</summary>
    public JsonObject VersJson()
    {
        if (Op == "SUPPRIMER") return new JsonObject { ["op"] = Op, ["uco_id"] = UcoId };
        var o = new JsonObject { ["op"] = Op, ["index"] = Index, ["uco_id"] = UcoId, ["coo_id"] = CooId, ["coordonnee"] = Coordonnee };
        if (Valeurs is not null)
        {
            var v = new JsonObject();
            foreach (var (k, x) in Valeurs) v[k] = x;
            o["valeurs"] = v;
        }
        o["nature"] = Nature;
        o["usage"] = Usage;
        o["libelle"] = Libelle;
        o["principal"] = Principal;
        o["ordre"] = Ordre;
        return o;
    }
}

public sealed record ErreurCoordonnee(int Index, string Champ, string Code, string Message);

public sealed record ChoixRequis(int Index, long CooId, int Partages);

public sealed record PlanEnregistrement(IReadOnlyList<OperationCoordonnee> Operations, IReadOnlyList<ErreurCoordonnee> Erreurs, IReadOnlyList<ChoixRequis> ChoixRequis);

/// <summary>
/// Coordonnées partagées : natures, contrôles et plan d'enregistrement d'une fiche. Réplique de
/// modules/annuaire/js/src/coordonnees.js (jeu partagé 02_coordonnees.json) : saisie vide ignorée (usage existant
/// vidé : supprimé), coordonnée modifiée et partagée soumise au choix de l'utilisateur, un principal par nature.
/// </summary>
public static partial class PlanCoordonnees
{
    public static readonly IReadOnlyDictionary<string, string[]> ChampsNature = new Dictionary<string, string[]>
    {
        ["ADRESSE"] = ["ligne1", "ligne2", "ligne3", "code_postal", "ville", "pays"],
        ["TELEPHONE"] = ["valeur"],
        ["EMAIL"] = ["valeur"],
        ["WEB"] = ["valeur", "reseau"],
    };

    public static readonly IReadOnlyDictionary<string, string> Messages = new Dictionary<string, string>
    {
        ["ADRESSE"] = "Adresse : ligne d'adresse ou ville à saisir",
        ["PAYS"] = "Code pays sur 2 lettres (ISO)",
        ["EMAIL"] = "Adresse e-mail invalide",
        ["TELEPHONE"] = "Numéro de téléphone invalide",
        ["WEB"] = "Lien ou pseudo à saisir",
        ["NATURE"] = "Nature de coordonnée inconnue",
        ["CHOIX"] = "Coordonnée partagée modifiée : indiquez s'il s'agit d'une modification ou d'une autre information",
    };

    private static string? Texte(string? v) => v is null || v.Trim().Length == 0 ? null : v.Trim();

    private static string? Brute(SaisieCoordonnee c, string champ) => champ switch
    {
        "ligne1" => c.Ligne1, "ligne2" => c.Ligne2, "ligne3" => c.Ligne3, "code_postal" => c.CodePostal, "ville" => c.Ville,
        "pays" => c.Pays, "valeur" => c.Valeur, "reseau" => c.Reseau, _ => null,
    };

    /// <summary>Valeurs normalisées selon la nature (pays d'une adresse : FR par défaut ; e-mail en minuscules).</summary>
    public static Dictionary<string, string?> Valeurs(SaisieCoordonnee c, string? nature = null)
    {
        nature ??= c.Nature;
        var v = new Dictionary<string, string?>(StringComparer.Ordinal);
        if (!ChampsNature.TryGetValue(nature, out var champs)) return v;
        foreach (var k in champs) v[k] = Texte(Brute(c, k));
        if (nature == "ADRESSE") v["pays"] = (v["pays"] ?? "FR").ToUpperInvariant();
        if (nature == "EMAIL" && v["valeur"] is { } e) v["valeur"] = e.ToLowerInvariant();
        return v;
    }

    public static bool EstVide(SaisieCoordonnee c) => Valeurs(c).All(kv => kv.Value is null || kv.Key is "pays" or "reseau");

    public static bool MemesValeurs(SaisieCoordonnee a, SaisieCoordonnee b)
    {
        var x = Valeurs(a);
        var y = Valeurs(b, a.Nature);
        return x.All(kv => y.GetValueOrDefault(kv.Key) == kv.Value);
    }

    /// <summary>Texte affichable (adresse sur une ligne).</summary>
    public static string Texte(SaisieCoordonnee c)
    {
        var v = Valeurs(c);
        if (c.Nature != "ADRESSE") return v.GetValueOrDefault("valeur") ?? "";
        var cpVille = string.Join(" ", new[] { v["code_postal"], v["ville"] }.Where(x => x is not null));
        return string.Join(", ", new[] { v["ligne1"], v["ligne2"], v["ligne3"], cpVille.Length > 0 ? cpVille : null, v["pays"] != "FR" ? v["pays"] : null }.Where(x => x is not null));
    }

    [GeneratedRegex("^[A-Z]{2}$")]
    private static partial Regex CodePays();

    [GeneratedRegex(@"^\+?[0-9 .\-()]{6,25}$")]
    private static partial Regex FormatTelephone();

    /// <summary>Contrôle d'une coordonnée non vide : (champ, code) ou null.</summary>
    public static (string Champ, string Code)? Erreur(SaisieCoordonnee c)
    {
        if (!ChampsNature.ContainsKey(c.Nature)) return ("nature", "NATURE");
        var v = Valeurs(c);
        switch (c.Nature)
        {
            case "ADRESSE":
                if (v["ligne1"] is null && v["ville"] is null) return ("ligne1", "ADRESSE");
                if (!CodePays().IsMatch(v["pays"]!)) return ("pays", "PAYS");
                return null;
            case "EMAIL":
                return Identifiants.EmailValide(v["valeur"]) ? null : ("valeur", "EMAIL");
            case "TELEPHONE":
                var t = v["valeur"] ?? "";
                return FormatTelephone().IsMatch(t) && t.Count(char.IsAsciiDigit) >= 6 ? null : ("valeur", "TELEPHONE");
            default:
                return v["valeur"] is not null ? null : ("valeur", "WEB");
        }
    }

    private sealed class Retenue(SaisieCoordonnee s, int index)
    {
        public SaisieCoordonnee S { get; } = s;
        public int Index { get; } = index;
        public bool Principal { get; set; }
        public int Ordre { get; set; }
    }

    /// <summary>Plan d'enregistrement (mêmes règles et même ordre que planifierCoordonnees).</summary>
    public static PlanEnregistrement Planifier(IReadOnlyCollection<long> existantes, IReadOnlyList<SaisieCoordonnee> saisies, IReadOnlyDictionary<long, int> partages)
    {
        var erreurs = new List<ErreurCoordonnee>();
        var choix = new List<ChoixRequis>();
        var operations = new List<OperationCoordonnee>();
        var retenues = saisies.Select((s, i) => new Retenue(s, i)).Where(r => !EstVide(r.S)).ToList();
        var connus = existantes.ToHashSet();

        foreach (var groupe in retenues.GroupBy(r => r.S.Nature))
        {
            var liste = groupe.ToList();
            var principal = liste.FirstOrDefault(r => r.S.Principal == true) ?? liste[0];
            for (var i = 0; i < liste.Count; i++) { liste[i].Principal = liste[i] == principal; liste[i].Ordre = i; }
        }

        var gardes = retenues.Where(r => r.S.UcoId is { } u && connus.Contains(u)).Select(r => r.S.UcoId!.Value).ToHashSet();
        foreach (var id in existantes) if (!gardes.Contains(id)) operations.Add(new("SUPPRIMER", null, id, null, null, null, null, null, null, false, 0));

        foreach (var r in retenues)
        {
            var s = r.S;
            if (Erreur(s) is { } e)
            {
                erreurs.Add(new(r.Index, e.Champ, e.Code, Messages[e.Code]));
                continue;
            }
            var existant = s.UcoId is { } uco && connus.Contains(uco);
            var coordonnee = "NOUVELLE";
            if (s.CooId is { } coo)
            {
                var change = !MemesValeurs(s, s.Origine ?? s);
                var autres = partages.GetValueOrDefault(coo);
                if (!change) coordonnee = "GARDER";
                else if (autres == 0 || s.Choix == "MODIFICATION") coordonnee = "MODIFIER";
                else if (s.Choix == "AUTRE") coordonnee = "NOUVELLE";
                else
                {
                    choix.Add(new(r.Index, coo, autres));
                    continue;
                }
            }
            operations.Add(new(existant ? "MAJ" : "AJOUTER", r.Index, existant ? s.UcoId : null, coordonnee == "NOUVELLE" ? null : s.CooId, coordonnee,
                coordonnee == "GARDER" ? null : Valeurs(s), s.Nature, Texte(s.Usage), Texte(s.Libelle), r.Principal, r.Ordre));
        }
        return new(operations, erreurs, choix);
    }
}
