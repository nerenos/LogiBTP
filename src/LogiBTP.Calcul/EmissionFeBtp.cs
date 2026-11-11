using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.FactureElectronique;

namespace LogiBTP.Calcul;

/// <summary>Mentions de la société utiles à l'émission (parametre_edition « mentions », db/190).</summary>
public sealed record MentionsEmissionFe(string? Indemnite = null, string? Penalites = null, string? Escompte = null, bool TvaDebits = false);

/// <summary>Données d'une pièce pour ses paramètres d'émission (voir <see cref="EmissionFeBtp.Parametres"/>).</summary>
public sealed record EntreeEmissionFe
{
    /// <summary>Code BT-3 du type de pièce (type_document.tyd_fe_type_facture) ; null : type jamais émis.</summary>
    public string? TypeFacture { get; init; }
    /// <summary>BT-3 de la facture d'origine d'un avoir (avoir d'une facture d'acompte : 503).</summary>
    public string? TypeOrigine { get; init; }
    /// <summary>Surcharge de la nature (document.ent_fe_nature).</summary>
    public string? EntFeNature { get; init; }
    public IReadOnlyList<DocumentLigneBtp> Lignes { get; init; } = [];
    /// <summary>Nature biens / services par nature d'article (nature_element.nat_fe_nature).</summary>
    public IReadOnlyDictionary<int, string> NaturesFe { get; init; } = new Dictionary<int, string>();
    /// <summary><see cref="SituationsCadreFe.SousTraitant"/>, <see cref="SituationsCadreFe.Cotraitant"/> ou null (titulaire).</summary>
    public string? Role { get; init; }
    /// <summary>La pièce déduit une facture d'acompte (mode chiffre d'affaires).</summary>
    public bool DeduitAcompte { get; init; }
    public bool DejaPayee { get; init; }
    public MentionsEmissionFe Mentions { get; init; } = new();
}

/// <summary>Paramètres d'émission d'une pièce : BT-3, nature, situation et cadre BT-23, BT-8, notes BR-FR-05/06.</summary>
public sealed record ParametresEmissionFe(string TypeFacture, string Nature, string Situation, string Cadre, string? CodeExigibiliteTva,
    IReadOnlyList<NoteFacture> Notes);

/// <summary>
/// Paramètres d'émission BTP d'une facture électronique (plans/facturation-electronique.md, lot 21 ; analyse § 2.9, Q8).
/// Réplique de client/src/calcul/emission-fe.js (jeu tests/emission-fe/01_emission.json).
/// </summary>
public static class EmissionFeBtp
{
    private static readonly HashSet<string> NaturesLigne = [NaturesFe.Biens, NaturesFe.Services];
    private static readonly HashSet<string> NaturesPiece = [NaturesFe.Biens, NaturesFe.Services, NaturesFe.Mixte];

    /// <summary>Cadre BT-23 par situation et par nature (sous-traitant et cotraitant : services seulement).</summary>
    public static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> Cadres = new Dictionary<string, IReadOnlyDictionary<string, string>>
    {
        [SituationsCadreFe.Depot] = new Dictionary<string, string> { [NaturesFe.Biens] = CadreFacturation.B1, [NaturesFe.Services] = CadreFacturation.S1, [NaturesFe.Mixte] = CadreFacturation.M1 },
        [SituationsCadreFe.DejaPayee] = new Dictionary<string, string> { [NaturesFe.Biens] = CadreFacturation.B2, [NaturesFe.Services] = CadreFacturation.S2, [NaturesFe.Mixte] = CadreFacturation.M2 },
        [SituationsCadreFe.DefinitiveApresAcompte] = new Dictionary<string, string> { [NaturesFe.Biens] = CadreFacturation.B4, [NaturesFe.Services] = CadreFacturation.S4, [NaturesFe.Mixte] = CadreFacturation.M4 },
        [SituationsCadreFe.SousTraitant] = new Dictionary<string, string> { [NaturesFe.Services] = CadreFacturation.S5 },
        [SituationsCadreFe.Cotraitant] = new Dictionary<string, string> { [NaturesFe.Services] = CadreFacturation.S6 },
    };

    private static bool Vendu(string? typePrix) => (typePrix ?? "V") == "V";

    /// <summary>Lignes vendues : lignes de prix sans ancêtre ouvrage, hors pied et écart d'arrondi, sans type de prix hors total (hérité).</summary>
    public static List<DocumentLigneBtp> LignesVendues(IReadOnlyList<DocumentLigneBtp> lignes)
    {
        var parId = new Dictionary<long, DocumentLigneBtp>();
        foreach (var l in lignes) parId.TryAdd(l.LigId, l);
        DocumentLigneBtp? Parent(DocumentLigneBtp l) => l.LigParentId is long p && parId.TryGetValue(p, out var x) ? x : null;
        return lignes.Where(l =>
        {
            if (!TL.EstChiffree(l) || TL.EstPied(l) || l.LigIsEcartArrondi || !Vendu(l.LigTypePrix)) return false;
            for (var x = Parent(l); x is not null; x = Parent(x))
                if (x.LigTylId == TL.Ouvrage || !Vendu(x.LigTypePrix)) return false;
            return true;
        }).ToList();
    }

    /// <summary>Nature d'une ligne vendue : ouvrage = services ; sinon celle de sa nature d'article, services par défaut.</summary>
    public static string NatureLigne(DocumentLigneBtp l, IReadOnlyDictionary<int, string> naturesFe)
    {
        if (l.LigTylId == TL.Ouvrage) return NaturesFe.Services;
        return l.LigNatId is int n && naturesFe.TryGetValue(n, out var v) && NaturesLigne.Contains(v) ? v : NaturesFe.Services;
    }

    /// <summary>Nature de la pièce : surcharge valide, sinon B ou S unanimes, M si mêlées ; sans ligne vendue : services.</summary>
    public static string NaturePiece(IReadOnlyList<DocumentLigneBtp> lignes, IReadOnlyDictionary<int, string> naturesFe, string? surcharge = null)
    {
        if (surcharge is not null && NaturesPiece.Contains(surcharge)) return surcharge;
        var natures = LignesVendues(lignes).Select(l => NatureLigne(l, naturesFe)).Distinct().ToList();
        return natures.Count switch { > 1 => NaturesFe.Mixte, 1 => natures[0], _ => NaturesFe.Services };
    }

    /// <summary>BT-3 : celui du type (null : jamais émis) ; avoir (381) d'une facture d'acompte (386) : 503.</summary>
    public static string? TypeDeFacture(string? typeDuType, string? typeOrigine = null)
    {
        if (string.IsNullOrEmpty(typeDuType)) return null;
        if (typeDuType == TypeFacture.Avoir && typeOrigine == TypeFacture.Acompte) return TypeFacture.AvoirAcompte;
        return typeDuType;
    }

    /// <summary>Situation : sous-traitant ou cotraitant, puis facture (380) qui déduit un acompte, puis déjà payée, sinon dépôt.</summary>
    public static string Situation(string? role, string? type, bool deduitAcompte, bool dejaPayee)
    {
        if (role is SituationsCadreFe.SousTraitant or SituationsCadreFe.Cotraitant) return role;
        if (type == TypeFacture.Facture && deduitAcompte) return SituationsCadreFe.DefinitiveApresAcompte;
        return dejaPayee ? SituationsCadreFe.DejaPayee : SituationsCadreFe.Depot;
    }

    /// <summary>Cadre BT-23 d'une nature dans une situation.</summary>
    public static string Cadre(string nature, string situation)
    {
        var t = Cadres.TryGetValue(situation, out var x) ? x : Cadres[SituationsCadreFe.Depot];
        return t.TryGetValue(nature, out var c) ? c : t[NaturesFe.Services];
    }

    /// <summary>BT-8 (BR-FR-MAP-03) : 5 pour des services (S ou M) avec l'option TVA sur les débits ; sinon null.</summary>
    public static string? CodeExigibilite(string nature, bool tvaDebits) =>
        tvaDebits && nature is NaturesFe.Services or NaturesFe.Mixte ? CodeExigibiliteTva.DateFacture : null;

    /// <summary>Notes PMT (indemnité), PMD (pénalités), AAB (escompte) des mentions non vides.</summary>
    public static List<NoteFacture> NotesLegales(MentionsEmissionFe mentions) =>
        new (string Code, string? Texte)[] { (CodeNote.IndemniteRecouvrement, mentions.Indemnite), (CodeNote.Penalites, mentions.Penalites), (CodeNote.Escompte, mentions.Escompte) }
            .Where(x => !string.IsNullOrWhiteSpace(x.Texte))
            .Select(x => new NoteFacture(x.Code, x.Texte!.Trim())).ToList();

    /// <summary>Paramètres d'émission d'une pièce ; null pour un type jamais émis.</summary>
    public static ParametresEmissionFe? Parametres(EntreeEmissionFe e)
    {
        var type = TypeDeFacture(e.TypeFacture, e.TypeOrigine);
        if (type is null) return null;
        var situation = Situation(e.Role, type, e.DeduitAcompte, e.DejaPayee);
        var nature = situation is SituationsCadreFe.SousTraitant or SituationsCadreFe.Cotraitant
            ? NaturesFe.Services
            : NaturePiece(e.Lignes, e.NaturesFe, e.EntFeNature);
        return new ParametresEmissionFe(type, nature, situation, Cadre(nature, situation), CodeExigibilite(nature, e.Mentions.TvaDebits), NotesLegales(e.Mentions));
    }
}
