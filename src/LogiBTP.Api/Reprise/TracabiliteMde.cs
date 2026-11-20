using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>
/// Liens entre pièces MDE (après les ventes et les achats) : <c>TRACABILITEDOC</c> → <c>document_lien</c> (transformation)
/// entre les entêtes repris, <c>TRACABILITE</c> → <c>document_ligne_lien</c> entre les lignes reprises (étape de la
/// transformation autorisée entre les deux types, quantité de la source) et ligne d'origine de la ligne cible.
/// Types de pièce de la source (eTypeDocument) : entête et lignes de <see cref="Tables"/> ; autre type signalé.
/// </summary>
public static class TracabiliteMde
{
    public const string TableDocuments = "TRACABILITEDOC";
    public const string TableLignes = "TRACABILITE";

    /// <summary>Tables d'entête et de lignes d'un type de pièce MDE.</summary>
    public static readonly IReadOnlyDictionary<string, (string Entete, string Lignes)> Tables = new Dictionary<string, (string, string)>(StringComparer.Ordinal)
    {
        ["DC"] = (PiecesVenteMde.Devis, "PMEDOCDEVCLILIG"),
        ["CC"] = ("PMEDOCCDECLI", "PMEDOCCDECLILIG"),
        ["LC"] = ("PMEDOCBLCLI", "PMEDOCBLCLILIG"),
        ["FC"] = (PiecesVenteMde.Facture, "PMEDOCFACCLILIG"),
        ["AC"] = (PiecesVenteMde.Facture, "PMEDOCFACCLILIG"),
        ["DF"] = ("ENTETEDEVISFOURNISSEUR", "LIGNEDEVISFOURNISSEUR"),
        ["CF"] = ("ENTETECDEFOURNISSEUR", "LIGNECDEFOURNISSEUR"),
        ["LF"] = ("ENTETERECEPTIONFOURNISSEUR", "LIGNERECEPTIONFOURNISSEUR"),
        ["FF"] = ("ENTETEFACTUREFOURNISSEUR", "LIGNEFACTUREFOURNISSEUR"),
        ["AF"] = ("ENTETEFACTUREFOURNISSEUR", "LIGNEFACTUREFOURNISSEUR"),
        ["OS"] = ("ENTETEAOSSTRAIT", "LIGNEAOSSTRAIT"),
        ["CS"] = ("ENTETECDESSTRAIT", "LIGNECDESSTRAIT"),
        ["FS"] = ("ENTETEFACTURESSTRAIT", "LIGNEFACTURESSTRAIT"),
    };

    public static async Task LierAsync(ContexteReprise ctx, PiecesReprise pieces, CancellationToken ct)
    {
        (string Entete, string Lignes)? Table(string? type, string colonne)
        {
            if (type is { } t && Tables.TryGetValue(t.Trim().ToUpperInvariant(), out var x)) return x;
            if (type is not null) ctx.Rapport.Perdre(TableDocuments, colonne, type, "Type de pièce sans équivalent : lien non repris");
            return null;
        }

        var documents = ctx.Rapport.Volume(TableDocuments);
        foreach (var l in await SqlReprise.SourceAsync(ctx, """
            SELECT TYPEDOCORIGINE, CODEDOCORIGINEINT, TYPEDOCDESTINATION, CODEDOCDESTINATIONINT FROM TRACABILITEDOC ORDER BY COMPTEUR
            """, ct))
        {
            documents.Lues++;
            if (Table(l.Texte("TYPEDOCORIGINE"), "TYPEDOCORIGINE") is not { } o || Table(l.Texte("TYPEDOCDESTINATION"), "TYPEDOCDESTINATION") is not { } d
                || ctx.Registre.Trouver(o.Entete, l.Texte("CODEDOCORIGINEINT")) is not { } source
                || ctx.Registre.Trouver(d.Entete, l.Texte("CODEDOCDESTINATIONINT")) is not { } cible || source == cible)
            {
                documents.Ecartees++;
                continue;
            }
            await pieces.LierAsync(source, cible, ct);
            documents.Ecrites++;
        }

        var lignes = ctx.Rapport.Volume(TableLignes);
        foreach (var l in await SqlReprise.SourceAsync(ctx, """
            SELECT COMPTEUR, TYPEDOCORIGINE, COMPTEURLIGNEDOCORIGINE, TYPEDOCDESTINATION, COMPTEURLIGNEDOCDESTINATION, QUANTITE FROM TRACABILITE ORDER BY COMPTEUR
            """, ct))
        {
            lignes.Lues++;
            if (Table(l.Texte("TYPEDOCORIGINE"), "TYPEDOCORIGINE") is not { } o || Table(l.Texte("TYPEDOCDESTINATION"), "TYPEDOCDESTINATION") is not { } d
                || ctx.Registre.Trouver(o.Lignes, l.Texte("COMPTEURLIGNEDOCORIGINE")) is not { } source
                || ctx.Registre.Trouver(d.Lignes, l.Texte("COMPTEURLIGNEDOCDESTINATION")) is not { } cible || source == cible)
            {
                lignes.Ecartees++;
                continue;
            }
            if (await pieces.LierLignesAsync(source, cible, l.Decimal("QUANTITE") ?? 0, ct)) lignes.Ecrites++;
            else
            {
                lignes.Ecartees++;
                ctx.Rapport.Signaler(NiveauAnomalie.Information, CodeAnomalie.LigneNonReprise, $"{TableLignes} {l.Texte("COMPTEUR")}",
                    "Aucune transformation autorisée entre les deux types de pièce : seule la ligne d'origine est notée");
            }
        }
    }
}
