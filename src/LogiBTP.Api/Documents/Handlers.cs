using System.Globalization;
using System.Text.Json;
using LogiBTP.Calcul;
using LogiBTP.Domaine;

namespace LogiBTP.Api.Documents;

/// <summary>Contexte transmis aux handlers : type, définition des propriétés et entrée de calcul.</summary>
public sealed class ContexteDocument
{
    public required TypeDocument Type { get; init; }
    public required List<ProprieteDefinition> Proprietes { get; init; }
    public required EntreeCalcul Entree { get; init; }
}

/// <summary>Ligne source proposée à la transformation, avec la quantité retenue.</summary>
public sealed record LigneTransformee(DocumentLigne Source, decimal Qte, decimal? AvancementPct);

/// <summary>
/// Spécificités d'un type de document (pattern Stratégie). Le handler est désigné par
/// type_document.tyd_handler ; NULL = HandlerStandard.
/// </summary>
public interface IDocumentHandler
{
    string Nom { get; }

    /// <summary>Valeurs initiales d'un nouveau document.</summary>
    void Initialiser(Document document, TypeDocument type);

    /// <summary>Contrôles avant calcul et enregistrement (propriétés, cohérence).</summary>
    void Controler(ContexteDocument ctx, List<MessageCalcul> erreurs);

    /// <summary>Calcul définitif ; par défaut le moteur C# commun.</summary>
    ResultatCalcul Calculer(EntreeCalcul entree);

    /// <summary>Contrôles supplémentaires avant validation.</summary>
    void AvantValidation(ContexteDocument ctx, List<MessageCalcul> erreurs);

    /// <summary>Quantité de la ligne cible pour une ligne source transformée.</summary>
    decimal QuantiteCible(LigneTransformee ligne, decimal dejaTransforme);
}

public class HandlerStandard : IDocumentHandler
{
    public virtual string Nom => "Standard";

    public virtual void Initialiser(Document document, TypeDocument type)
    {
        document.EntProprietes ??= JsonDocument.Parse("{}");
    }

    public virtual void Controler(ContexteDocument ctx, List<MessageCalcul> erreurs)
    {
        ControlerProprietes(ctx.Proprietes.Where(p => p.PrdNiveau == "E"), ctx.Entree.Document.EntProprietes, null, erreurs);
        var defLignes = ctx.Proprietes.Where(p => p.PrdNiveau == "L").ToList();
        foreach (var l in ctx.Entree.Lignes) ControlerProprietes(defLignes, l.LigProprietes, l.LigId, erreurs);

        // Le type de prix est hérité : un descendant d'une ligne Option / Mémoire / Variante ne peut pas être Vendu.
        var parId = ctx.Entree.Lignes.ToDictionary(l => l.LigId);
        foreach (var l in ctx.Entree.Lignes)
        {
            if (l.LigParentId is long p && parId.TryGetValue(p, out var parent) && parent.LigTypePrix != "V" && l.LigTypePrix != parent.LigTypePrix)
            {
                erreurs.Add(new MessageCalcul(l.LigId, "TYPE_PRIX_HERITE", "Le type de prix est hérité de la ligne parente"));
            }
        }
    }

    public virtual ResultatCalcul Calculer(EntreeCalcul entree) => MoteurCalcul.Calculer(entree);

    public virtual void AvantValidation(ContexteDocument ctx, List<MessageCalcul> erreurs) { }

    public virtual decimal QuantiteCible(LigneTransformee ligne, decimal dejaTransforme) => ligne.Qte;

    /// <summary>La définition sert à la fois à générer l'interface et à valider les valeurs.</summary>
    protected static void ControlerProprietes(IEnumerable<ProprieteDefinition> defs, JsonDocument? valeurs, long? ligId, List<MessageCalcul> erreurs)
    {
        var racine = valeurs?.RootElement;
        foreach (var d in defs)
        {
            JsonElement v = default;
            var presente = racine is { ValueKind: JsonValueKind.Object } r && r.TryGetProperty(d.PrdCode, out v) && v.ValueKind != JsonValueKind.Null;
            if (!presente)
            {
                if (d.PrdObligatoire) erreurs.Add(new MessageCalcul(ligId, "PROPRIETE_OBLIGATOIRE", $"Propriété obligatoire : {d.PrdLibelle}"));
                continue;
            }
            var valide = d.PrdTypeDonnee switch
            {
                "entier" => v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out _),
                "decimal" => v.ValueKind == JsonValueKind.Number,
                "booleen" => v.ValueKind is JsonValueKind.True or JsonValueKind.False,
                "date" => v.ValueKind == JsonValueKind.String && DateOnly.TryParseExact(v.GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _),
                "liste" => v.ValueKind == JsonValueKind.String && OptionsDe(d).Contains(v.GetString()!),
                _ => v.ValueKind == JsonValueKind.String,
            };
            if (!valide) erreurs.Add(new MessageCalcul(ligId, "PROPRIETE_INVALIDE", $"Valeur invalide pour {d.PrdLibelle} ({d.PrdTypeDonnee})"));
        }
    }

    private static HashSet<string> OptionsDe(ProprieteDefinition d)
    {
        var res = new HashSet<string>();
        if (d.PrdOptions?.RootElement is { ValueKind: JsonValueKind.Array } a)
        {
            foreach (var o in a.EnumerateArray())
            {
                if (o.ValueKind == JsonValueKind.String) res.Add(o.GetString()!);
                else if (o.TryGetProperty("code", out var c)) res.Add(c.GetString()!);
            }
        }
        return res;
    }
}

/// <summary>
/// Facture d'avancement (situation de travaux) : la quantité facturée est l'avancement cumulé
/// appliqué à la ligne de référence, moins ce qui a déjà été facturé.
/// Révision de prix, acomptes et décompte général définitif : seconde phase.
/// </summary>
public sealed class HandlerFactureAvancement : HandlerStandard
{
    public override string Nom => "FactureAvancement";

    public override decimal QuantiteCible(LigneTransformee ligne, decimal dejaTransforme)
    {
        if (ligne.AvancementPct is not decimal pct) return ligne.Qte;
        if (pct is < 0 or > 100) throw new ArgumentOutOfRangeException(nameof(ligne), "Avancement entre 0 et 100 %");
        var cumul = ArrondiCalcul.Arrondir((ligne.Source.LigQteVendue ?? 0) * pct / 100, ligne.Source.LigPrecisionQte);
        return cumul - dejaTransforme;
    }
}

public sealed class RegistreHandlers(IEnumerable<IDocumentHandler> handlers)
{
    private readonly Dictionary<string, IDocumentHandler> _handlers = handlers.ToDictionary(h => h.Nom, StringComparer.OrdinalIgnoreCase);

    public IDocumentHandler Pour(TypeDocument type) =>
        type.TydHandler is string nom && _handlers.TryGetValue(nom, out var h) ? h : _handlers["Standard"];
}
