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
}
