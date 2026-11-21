using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace LogiBTP.Documents;

/// <summary>Valeur d'une zone de type liste (valeur enregistrée, libellé affiché).</summary>
public sealed class OptionZone
{
    public string Valeur { get; set; } = "";
    public string? Libelle { get; set; }
}

/// <summary>Erreur d'une zone : champ (colonne) et code (<see cref="ErreursZoneEntete"/>).</summary>
public sealed record ErreurZone(string Champ, string Code);

/// <summary>
/// Zone supplémentaire d'entête (registre document_zone_entete) : colonne x_ de document, type, libellé, groupe de l'onglet
/// Entête, ordre, obligatoire (contrôlé à la validation), valeurs d'une liste, portée (famille ou type de document, code ;
/// les deux nuls : global).
/// </summary>
public sealed record ZoneEntete(string Colonne, string Type, string Libelle, string? Groupe, int Ordre, bool Obligatoire,
    List<OptionZone>? Valeurs, string? Famille, string? TypeDocument, bool Actif = true);

/// <summary>
/// Règles des zones d'entête : même règle que zones-entete.js (jeu partagé modules/document/tests/zones/01_zones_entete.json).
/// Les fonctions SQL document_zone_creer / document_zone_retirer refont les contrôles de nom, de type et de portée : ce
/// sont elles qui protègent la base.
/// </summary>
public static partial class ZonesEntete
{
    public const int LongueurLibelle = 100;
    public const int LongueurValeur = 200;
    public const int LongueurGroupe = 100;
    /// <summary>Format d'un montant (numeric(18,2)) : seize chiffres et deux décimales.</summary>
    public const string FormatMontant = "9999999999999999.99";

    [GeneratedRegex(@"^x_[a-z][a-z0-9_]{0,40}\z")]
    private static partial Regex NomSur();

    public static bool NomValide(string? colonne) => colonne is not null && NomSur().IsMatch(colonne);

    /// <summary>Type SQL de la colonne créée ; null si le type n'est pas permis.</summary>
    public static string? TypeSql(string? type) => type switch
    {
        TypesZoneEntete.Texte or TypesZoneEntete.Liste => "text",
        TypesZoneEntete.Nombre => "numeric",
        TypesZoneEntete.Montant => "numeric(18,2)",
        TypesZoneEntete.Date => "date",
        TypesZoneEntete.CaseACocher => "boolean",
        _ => null,
    };

    /// <summary>Portée d'une zone : TYPE si un type est fixé, FAMILLE si une famille l'est, sinon GLOBAL.</summary>
    public static string Portee(string? famille, string? typeDocument) =>
        !string.IsNullOrEmpty(typeDocument) ? PorteesZoneEntete.Type : !string.IsNullOrEmpty(famille) ? PorteesZoneEntete.Famille : PorteesZoneEntete.Global;

    /// <summary>Valeurs d'une liste : au moins une, sans doublon, valeur non vide de 200 caractères au plus.</summary>
    public static List<ErreurZone> ErreursValeurs(IReadOnlyList<OptionZone>? valeurs, string champ)
    {
        if (valeurs is null || valeurs.Count == 0) return [new(champ, ErreursZoneEntete.Valeurs)];
        var erreurs = new List<ErreurZone>();
        var vues = new HashSet<string>(StringComparer.Ordinal);
        foreach (var v in valeurs)
            if (string.IsNullOrWhiteSpace(v.Valeur) || v.Valeur.Length > LongueurValeur || !vues.Add(v.Valeur)) erreurs.Add(new(champ, ErreursZoneEntete.Valeurs));
        return erreurs;
    }

    private static List<ErreurZone> ErreursLibelle(string? libelle, string champ)
    {
        var l = (libelle ?? "").Trim();
        return l.Length == 0 || l.Length > LongueurLibelle ? [new(champ, ErreursZoneEntete.LibelleObligatoire)] : [];
    }

    private static List<ErreurZone> ErreursPortee(string? famille, string? typeDocument, string champ) =>
        (!string.IsNullOrEmpty(famille) && !string.IsNullOrEmpty(typeDocument)) || (!string.IsNullOrEmpty(famille) && !FamillesDocument.Toutes.Contains(famille))
            ? [new(champ, ErreursZoneEntete.PorteeInvalide)] : [];

    /// <summary>Erreurs d'une demande de création (hors existence du type de document et de la colonne, contrôlée avec la base).</summary>
    public static List<ErreurZone> ErreursCreation(string? colonne, string? type, string? libelle, IReadOnlyList<OptionZone>? valeurs, string? famille, string? typeDocument)
    {
        var champ = colonne ?? "";
        var erreurs = new List<ErreurZone>();
        if (!NomValide(colonne)) erreurs.Add(new(champ, ErreursZoneEntete.NomInvalide));
        if (TypeSql(type) is null) erreurs.Add(new(champ, ErreursZoneEntete.TypeInvalide));
        erreurs.AddRange(ErreursLibelle(libelle, champ));
        if (type == TypesZoneEntete.Liste) erreurs.AddRange(ErreursValeurs(valeurs, champ));
        erreurs.AddRange(ErreursPortee(famille, typeDocument, champ));
        return erreurs;
    }

    /// <summary>Erreurs d'une modification (libellé, valeurs d'une liste, portée) d'une zone de type connu.</summary>
    public static List<ErreurZone> ErreursModification(string colonne, string type, string? libelle, IReadOnlyList<OptionZone>? valeurs, string? famille, string? typeDocument)
    {
        var erreurs = ErreursLibelle(libelle, colonne);
        if (type == TypesZoneEntete.Liste) erreurs.AddRange(ErreursValeurs(valeurs, colonne));
        erreurs.AddRange(ErreursPortee(famille, typeDocument, colonne));
        return erreurs;
    }

    /// <summary>La zone s'applique-t-elle à un document de cette famille et de ce type (code) ? Une zone inactive jamais.</summary>
    public static bool Applicable(ZoneEntete z, string? famille, string? typeDocument) => z.Actif && Portee(z.Famille, z.TypeDocument) switch
    {
        PorteesZoneEntete.Type => z.TypeDocument == typeDocument,
        PorteesZoneEntete.Famille => z.Famille == famille,
        _ => true,
    };

    /// <summary>Zones actives d'un document (famille, type), dans l'ordre : groupe (sans groupe d'abord), ordre, colonne.</summary>
    public static List<ZoneEntete> DuType(IEnumerable<ZoneEntete> zones, string? famille, string? typeDocument) =>
        zones.Where(z => Applicable(z, famille, typeDocument))
            .OrderBy(z => z.Groupe ?? "", StringComparer.Ordinal).ThenBy(z => z.Ordre).ThenBy(z => z.Colonne, StringComparer.Ordinal).ToList();

    private static bool Vide(JsonNode? v) => v is null || v.GetValueKind() == JsonValueKind.Null
        || (v.GetValueKind() == JsonValueKind.String && string.IsNullOrWhiteSpace(v.GetValue<string>()));

    private static bool Nombre(JsonNode v, out decimal d)
    {
        d = 0;
        if (v.GetValueKind() != JsonValueKind.Number) return false;
        try { d = v.GetValue<decimal>(); return true; }
        catch (Exception e) when (e is FormatException or OverflowException or InvalidOperationException) { return false; }
    }

    /// <summary>Une valeur non vide convient-elle au type de la zone ? (même règle que valeurZoneValide, zones-entete.js)</summary>
    public static bool ValeurValide(ZoneEntete z, JsonNode valeur) => z.Type switch
    {
        TypesZoneEntete.Texte => valeur.GetValueKind() == JsonValueKind.String,
        TypesZoneEntete.Liste => valeur.GetValueKind() == JsonValueKind.String && (z.Valeurs ?? []).Any(o => o.Valeur == valeur.GetValue<string>()),
        TypesZoneEntete.Nombre => Nombre(valeur, out _),
        TypesZoneEntete.Montant => Nombre(valeur, out var m) && Math.Abs(m) < 1e16m,
        TypesZoneEntete.Date => valeur.GetValueKind() == JsonValueKind.String
            && DateOnly.TryParseExact(valeur.GetValue<string>(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _),
        TypesZoneEntete.CaseACocher => valeur.GetValueKind() is JsonValueKind.True or JsonValueKind.False,
        _ => false,
    };

    /// <summary>
    /// Erreurs des valeurs d'un document de cette famille et de ce type (champ = colonne), dans l'ordre des zones : valeur non vide
    /// du mauvais type ou hors liste (ZONE_VALEUR_INVALIDE, toujours) ; zone obligatoire vide (ZONE_OBLIGATOIRE, à la validation
    /// seulement ; jamais une case à cocher). Même règle que erreursSaisieZones (zones-entete.js).
    /// </summary>
    public static List<ErreurZone> ErreursSaisie(IEnumerable<ZoneEntete> zones, string? famille, string? typeDocument, IReadOnlyDictionary<string, JsonNode?>? valeurs, bool validation)
    {
        var erreurs = new List<ErreurZone>();
        foreach (var z in DuType(zones, famille, typeDocument))
        {
            JsonNode? v = null;
            valeurs?.TryGetValue(z.Colonne, out v);
            if (Vide(v))
            {
                if (validation && z.Obligatoire && z.Type != TypesZoneEntete.CaseACocher) erreurs.Add(new(z.Colonne, ErreursZoneEntete.Obligatoire));
            }
            else if (!ValeurValide(z, v!)) erreurs.Add(new(z.Colonne, ErreursZoneEntete.ValeurInvalide));
        }
        return erreurs;
    }

    /// <summary>Valeurs non vides des zones qui existent dans le type cible (copie, nouvel indice, transformation).</summary>
    public static Dictionary<string, JsonNode?> Reprises(IEnumerable<ZoneEntete> zones, IReadOnlyDictionary<string, JsonNode?>? valeurs, string? famille, string? typeDocument)
    {
        var reprises = new Dictionary<string, JsonNode?>();
        foreach (var z in DuType(zones, famille, typeDocument))
            if (valeurs is not null && valeurs.TryGetValue(z.Colonne, out var v) && !Vide(v)) reprises[z.Colonne] = v;
        return reprises;
    }
}
