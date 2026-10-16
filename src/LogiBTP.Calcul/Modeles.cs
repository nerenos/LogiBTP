using LogiBTP.Documents;
using LogiBTP.Domaine;
using LogiBTP.Metres;
using LogiBTP.Metres.Script;

namespace LogiBTP.Calcul;

/// <summary>Entrée du moteur BTP : entrée du document générique + métrés (scripts) et variables (module Métré).</summary>
public sealed class EntreeCalcul : EntreeDocument<DocumentBtp, DocumentLigneBtp>
{
    public List<Metre> Metres { get; set; } = [];
    public List<VariableDefinition> Variables { get; set; } = [];
    /// <summary>Clés de ventilation des frais annexes (db/167).</summary>
    public List<VentilationFrais> Ventilations { get; set; } = [];
}

/// <summary>Résultat du moteur BTP : résultat générique + métrés, variables et lignes d'écart supprimées.</summary>
public sealed class ResultatCalcul : ResultatDocument<DocumentBtp, DocumentLigneBtp>
{
    public List<Metre> Metres { get; set; } = [];
    public List<VariableDefinition> Variables { get; set; } = [];
    /// <summary>Exécution des métrés en script : résultat, erreurs positionnées (pour l'éditeur), avertissements.</summary>
    public List<DiagnosticScript> Scripts { get; set; } = [];
    /// <summary>Lignes d'écart d'arrondi existantes qui n'ont pas été recréées.</summary>
    public List<long> LignesSupprimees { get; set; } = [];
    /// <summary>Clés de ventilation des frais annexes (inchangées) ; détail calculé ; bilan par tranche de frais.</summary>
    public List<VentilationFrais> Ventilations { get; set; } = [];
    public List<VentilationFraisLigne> VentilationsLignes { get; set; } = [];
    public List<BilanFraisAnnexes> FraisAnnexes { get; set; } = [];
}

/// <summary>Bilan d'une tranche de frais annexes : prévu, ventilé par les clés, ventilé réel (après arrondi du PV), écart.</summary>
public sealed record BilanFraisAnnexes(long LigId, long? PorteeId, bool Cles, decimal Prevu, decimal Ventile, decimal VentileReel, decimal Ecart);

/// <summary>Exécution du script d'un métré (scripts du résultat, comme côté JS).</summary>
public sealed record DiagnosticScript(long MtrId, long LigId, decimal? Resultat, IReadOnlyList<ErreurScript> Erreurs,
    IReadOnlyList<AvertissementScript> Avertissements);

/// <summary>Comparaison client / serveur : champs génériques + BTP ; la ligne d'écart est appariée par son ouvrage.</summary>
public sealed class ComparateurBtp : ComparateurCalcul
{
    private static readonly string[] ChampsDoc = [.. ChampsDocumentGeneriques, "ent_coef_fa"];

    private static readonly string[] ChampsLig =
    [
        .. ChampsLigneGeneriques, "lig_qte_base", "lig_pa", "lig_pr", "lig_coef_fg", "lig_coef_benef", "lig_coef_fa",
        "lig_pv_affiche", "lig_montant_pa", "lig_montant_pr",
    ];

    public override IReadOnlyList<string> ChampsDocument => ChampsDoc;
    public override IReadOnlyList<string> ChampsLigne => ChampsLig;

    protected override string Cle(DocumentLigne l) =>
        l is DocumentLigneBtp { LigIsEcartArrondi: true } ? $"ecart:{l.LigParentId}" : base.Cle(l);

    public List<EcartCalcul> Comparer(ResultatCalcul client, ResultatCalcul serveur) =>
        Comparer(client.Document, client.Lignes, serveur.Document, serveur.Lignes);
}
