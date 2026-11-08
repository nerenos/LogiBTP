using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Socle;

namespace LogiBTP.Api.Btp;

/// <summary>
/// TVA des pièces d'achat d'un fournisseur de l'Union européenne (per_fou_tva_intracom) : à la validation, avertissement
/// non bloquant listant les lignes dont la TVA n'est pas autoliquidée (catégorie A), si le module Comptabilité est actif.
/// </summary>
public static class TvaAchatBtp
{
    /// <summary>Catégorie de TVA autoliquidée (db/010 : ttv_categorie).</summary>
    public const string CategorieAutoliquidee = "A";

    /// <summary>Ajoute l'avertissement avec les numéros des lignes dont la TVA n'est pas autoliquidée ; rien sinon.</summary>
    public static void Avertir(string? famille, bool fournisseurIntracom, bool comptabiliteActive, IEnumerable<DocumentLigneBtp> lignes,
        IReadOnlyDictionary<int, string> categories, List<MessageCalcul> avertissements)
    {
        if (!comptabiliteActive || !fournisseurIntracom || famille != FamillesDocument.Achat) return;
        var enCause = lignes.Where(l => TL.EstChiffree(l) && l.LigTypePrix == "V"
            && !(l.LigTvaId is int t && categories.TryGetValue(t, out var c) && c == CategorieAutoliquidee)).ToList();
        if (enCause.Count == 0) return;
        var numeros = string.Join(", ", enCause.Select(l => l.LigNumerotation));
        avertissements.Add(new MessageCalcul(enCause[0].LigId, AvertissementsGestion.TvaNonAutoliquee,
            $"Fournisseur intracommunautaire : TVA non autoliquidée sur les lignes {numeros}"));
    }
}
