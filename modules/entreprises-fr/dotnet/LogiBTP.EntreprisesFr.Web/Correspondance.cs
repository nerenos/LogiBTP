using System.Text.Json;
using System.Text.RegularExpressions;

namespace LogiBTP.EntreprisesFr.Web;

public sealed record AdresseEntreprise(string? Ligne1, string? Ligne2, string? CodePostal, string? Ville, string Pays = "FR");

public sealed record DirigeantEntreprise(string? Nom, string? Prenom, string? Qualite);

/// <summary>Entreprise prête à remplir une fiche (identité, établissement, adresse, dirigeants personnes physiques).</summary>
public sealed record Entreprise(
    string? Siren, string? Siret, string? RaisonSociale, string? NomCommercial, string? Sigle, string? Naf, string? FormeJuridique, string? FormeLibelle,
    string? DateCreation, string? Effectif, string? EtatAdministratif, bool Siege, string? TvaIntra, bool ServicePublic, bool Rge, string? Categorie,
    int? EtablissementsOuverts, AdresseEntreprise? Adresse, List<DirigeantEntreprise> Dirigeants);

public sealed record ReponseRecherche(List<Entreprise> Resultats, int Total, int Page, int Pages);

/// <summary>
/// Correspondance d'un résultat de l'API Recherche d'entreprises vers une entreprise. Réplique de
/// modules/entreprises-fr/js/src/correspondance.js (jeu partagé 01_correspondance.json).
/// </summary>
public static partial class Correspondance
{
    public static readonly IReadOnlyDictionary<string, string> TranchesEffectif = new Dictionary<string, string>
    {
        ["NN"] = "Non employeuse", ["00"] = "0 salarié", ["01"] = "1 ou 2 salariés", ["02"] = "3 à 5 salariés", ["03"] = "6 à 9 salariés",
        ["11"] = "10 à 19 salariés", ["12"] = "20 à 49 salariés", ["21"] = "50 à 99 salariés", ["22"] = "100 à 199 salariés", ["31"] = "200 à 249 salariés",
        ["32"] = "250 à 499 salariés", ["41"] = "500 à 999 salariés", ["42"] = "1 000 à 1 999 salariés", ["51"] = "2 000 à 4 999 salariés",
        ["52"] = "5 000 à 9 999 salariés", ["53"] = "10 000 salariés et plus",
    };

    public static readonly IReadOnlyDictionary<string, string> FormesJuridiques = new Dictionary<string, string>
    {
        ["1000"] = "Entrepreneur individuel", ["5202"] = "Société en nom collectif", ["5306"] = "Société en commandite simple",
        ["5485"] = "Société d'exercice libéral à responsabilité limitée", ["5498"] = "SARL unipersonnelle (EURL)", ["5499"] = "Société à responsabilité limitée (SARL)",
        ["5599"] = "SA à conseil d'administration", ["5699"] = "SA à directoire", ["5710"] = "Société par actions simplifiée (SAS)",
        ["5720"] = "Société par actions simplifiée à associé unique (SASU)", ["5785"] = "Société d'exercice libéral par actions simplifiée",
        ["6220"] = "Groupement d'intérêt économique (GIE)", ["6540"] = "Société civile immobilière (SCI)", ["6541"] = "SCI de construction-vente", ["6599"] = "Autre société civile",
        ["7210"] = "Commune", ["7220"] = "Département", ["7344"] = "Métropole", ["7346"] = "Communauté de communes", ["7348"] = "Communauté d'agglomération",
        ["9220"] = "Association déclarée",
    };

    private static string? Texte(JsonElement e, string propriete) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(propriete, out var v) ? Texte(v) : null;

    private static string? Texte(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => v.GetString() is { } s && s.Trim().Length > 0 ? s.Trim() : null,
        JsonValueKind.Number => v.GetRawText(),
        _ => null,
    };

    private static JsonElement Prop(JsonElement e, string p) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(p, out var v) ? v : default;

    private static bool Vrai(JsonElement e, string p) => Prop(e, p).ValueKind == JsonValueKind.True;

    [GeneratedRegex(@"(^|[\s\-'’(])(\p{L})")]
    private static partial Regex DebutMot();

    /// <summary>Casse d'un nom propre : minuscules, majuscule en début de mot (après espace, tiret, apostrophe ou parenthèse).</summary>
    public static string? CasseNom(string? v)
    {
        if (v is null || v.Trim().Length == 0) return null;
        return DebutMot().Replace(v.Trim().ToLowerInvariant(), m => m.Groups[1].Value + m.Groups[2].Value.ToUpperInvariant());
    }

    [GeneratedRegex(@"^(.*?)\s*([0-9]{5})\s+(.+)$")]
    private static partial Regex AdresseUneLigne();

    public static AdresseEntreprise? Adresse(JsonElement e)
    {
        if (e.ValueKind != JsonValueKind.Object) return null;
        if (Texte(e, "libelle_voie") is not null || Texte(e, "numero_voie") is not null)
        {
            var ligne1 = string.Join(" ", new[] { "numero_voie", "indice_repetition", "type_voie", "libelle_voie" }.Select(k => Texte(e, k)).Where(x => x is not null));
            return new(ligne1.Length > 0 ? ligne1 : null, Texte(e, "complement_adresse"), Texte(e, "cedex") ?? Texte(e, "code_postal"), Texte(e, "libelle_cedex") ?? Texte(e, "libelle_commune"));
        }
        var adresse = Texte(e, "adresse");
        var m = AdresseUneLigne().Match(adresse ?? "");
        if (m.Success) return new(m.Groups[1].Value.Trim().Length > 0 ? m.Groups[1].Value.Trim() : null, null, m.Groups[2].Value, m.Groups[3].Value.Trim());
        return adresse is not null ? new(adresse, null, Texte(e, "code_postal"), Texte(e, "libelle_commune")) : null;
    }

    /// <summary>Entreprise d'un résultat ; établissement : celui du SIRET cherché s'il est trouvé, sinon le siège.</summary>
    public static Entreprise VersEntreprise(JsonElement r, string? siret = null)
    {
        var siege = Prop(r, "siege");
        var etablissements = new List<JsonElement> { siege };
        if (Prop(r, "matching_etablissements") is { ValueKind: JsonValueKind.Array } m) etablissements.AddRange(m.EnumerateArray());
        var cherche = siret is null || siret.Trim().Length == 0 ? null : siret.Trim();
        var e = (cherche is null ? null : etablissements.Cast<JsonElement?>().FirstOrDefault(x => Texte(x!.Value, "siret") == cherche)) ?? siege;
        var etat = Texte(e, "etat_administratif") ?? Texte(r, "etat_administratif");
        var forme = Texte(r, "nature_juridique");
        var enseignes = Prop(e, "liste_enseignes");
        var tva = Prop(r, "tva");
        var complements = Prop(r, "complements");
        var dirigeants = new List<DirigeantEntreprise>();
        if (Prop(r, "dirigeants") is { ValueKind: JsonValueKind.Array } ds)
        {
            foreach (var d in ds.EnumerateArray())
            {
                if (Texte(d, "type_dirigeant") != "personne physique" || Texte(d, "nom") is null) continue;
                var prenom = Texte(d, "prenoms")?.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
                dirigeants.Add(new(CasseNom(Texte(d, "nom")), CasseNom(prenom), Texte(d, "qualite")));
            }
        }
        var ouverts = Prop(r, "nombre_etablissements_ouverts");
        return new(
            Texte(r, "siren"), Texte(e, "siret"), Texte(r, "nom_raison_sociale") ?? Texte(r, "nom_complet"),
            Texte(e, "nom_commercial") ?? (enseignes.ValueKind == JsonValueKind.Array && enseignes.GetArrayLength() > 0 ? Texte(enseignes[0]) : null),
            Texte(r, "sigle"), Texte(e, "activite_principale") ?? Texte(r, "activite_principale"), forme, forme is null ? null : FormesJuridiques.GetValueOrDefault(forme),
            Texte(r, "date_creation"), TranchesEffectif.GetValueOrDefault(Texte(e, "tranche_effectif_salarie") ?? Texte(r, "tranche_effectif_salarie") ?? ""),
            etat == "A" ? "A" : etat is null ? null : "F", Vrai(e, "est_siege"),
            tva.ValueKind == JsonValueKind.Array && tva.GetArrayLength() > 0 ? Texte(tva[0]) : null,
            Vrai(complements, "est_service_public") || Vrai(complements, "est_administration"), Vrai(complements, "est_rge"), Texte(r, "categorie_entreprise"),
            ouverts.ValueKind == JsonValueKind.Number ? ouverts.GetInt32() : null, Adresse(e), dirigeants);
    }

    /// <summary>SIRET cherché (14 chiffres, espaces acceptés), sinon null.</summary>
    public static string? SiretCherche(string? recherche)
    {
        var c = string.Concat((recherche ?? "").Where(ch => !char.IsWhiteSpace(ch)));
        return c.Length == 14 && c.All(char.IsAsciiDigit) ? c : null;
    }

    public static ReponseRecherche Reponse(JsonElement data, string? recherche)
    {
        var siret = SiretCherche(recherche);
        var resultats = Prop(data, "results") is { ValueKind: JsonValueKind.Array } r ? r.EnumerateArray().Select(x => VersEntreprise(x, siret)).ToList() : [];
        int Entier(string p) => Prop(data, p) is { ValueKind: JsonValueKind.Number } v ? v.GetInt32() : 0;
        return new(resultats, Entier("total_results"), Math.Max(1, Entier("page")), Entier("total_pages"));
    }
}
