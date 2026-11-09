namespace LogiBTP.FactureElectronique;

/// <summary>Statut à contrôler avant de le poser ou à sa réception (historique : codes dans l'ordre chronologique).</summary>
public sealed record StatutPropose(
    string Sens, IReadOnlyList<string> Historique, string Statut, string? Emetteur, string? Motif = null, string? Action = null, bool B2g = false);

/// <summary>
/// Règles du cycle de vie d'une facture (flux 6), répliquées avec modules/facture-electronique/js/src/cycle-vie.js (jeu
/// tests/cas/01_cycle_vie.json). Sources : annexe A XP Z12-012 V1.4, onglets « Acteurs CDV » (émetteurs) et « Tableau des
/// motifs de STATUTS » (motifs).
/// </summary>
public static class ReglesCycleVie
{
    private const string PaE = EmetteurStatut.PaE, PaR = EmetteurStatut.PaR, Vendeur = EmetteurStatut.Vendeur,
        Acheteur = EmetteurStatut.Acheteur, Agent = EmetteurStatut.Agent;

    /// <summary>Émetteurs admis de chaque statut.</summary>
    private static readonly Dictionary<string, string[]> Emetteurs = new()
    {
        [StatutCdv.Deposee] = [PaE],
        [StatutCdv.Emise] = [PaE],
        [StatutCdv.Recue] = [PaR],
        [StatutCdv.MiseADisposition] = [PaR],
        [StatutCdv.PriseEnCharge] = [Acheteur],
        [StatutCdv.Approuvee] = [Acheteur],
        [StatutCdv.ApprouveePartiellement] = [Acheteur],
        [StatutCdv.EnLitige] = [Acheteur],
        [StatutCdv.Suspendue] = [Acheteur],
        [StatutCdv.Completee] = [Vendeur],
        [StatutCdv.Refusee] = [Acheteur],
        [StatutCdv.PaiementTransmis] = [Acheteur],
        [StatutCdv.Encaissee] = [Vendeur],
        [StatutCdv.Rejetee] = [PaE, PaR],
        [StatutCdv.Visee] = [Agent],
        [StatutCdv.Annulee] = [Vendeur, Acheteur],
        [StatutCdv.ErreurRoutage] = [PaR],
        [StatutCdv.DemandePaiementDirect] = [Vendeur],
        [StatutCdv.Affacturee] = [Vendeur],
        [StatutCdv.AffactureeConfidentiel] = [Vendeur],
        [StatutCdv.ChangementCompteAPayer] = [Vendeur],
        [StatutCdv.NonAffacturee] = [Vendeur],
        [StatutCdv.Irrecevable] = [PaR],
    };

    // Motifs autorisés : colonnes du tableau des motifs (Rejetée à l'émission ou en réception, Refusée B2B ou B2G…).
    private static readonly string[] MotifsRejetEmission =
    [
        MotifStatut.MontanttotalErr, MotifStatut.CalculErr, MotifStatut.Doublon, MotifStatut.DestInc, MotifStatut.AdrErr,
        MotifStatut.RejSeman, MotifStatut.RejUni, MotifStatut.RejCoh, MotifStatut.RejAdr, MotifStatut.RejContB2g,
        MotifStatut.RejRefPj, MotifStatut.RejAssPj,
    ];

    private static readonly string[] MotifsRejetReception = MotifsRejetEmission.Where(m => m != MotifStatut.DestInc).ToArray();

    private static readonly string[] MotifsRefusB2b =
    [
        MotifStatut.TxTvaErr, MotifStatut.MontanttotalErr, MotifStatut.CalculErr, MotifStatut.NonConforme, MotifStatut.Doublon,
        MotifStatut.DestErr, MotifStatut.TransacInc, MotifStatut.EmmetInc, MotifStatut.ContratTerm, MotifStatut.DoubleFact,
        MotifStatut.CmdErr, MotifStatut.AdrErr, MotifStatut.RefCtAbsent,
    ];

    private static readonly string[] MotifsRefusB2g =
    [
        MotifStatut.RetraitManServ, MotifStatut.StCtNonDeclar, MotifStatut.SupprCompAvoir, MotifStatut.TransfPmntRegie,
        MotifStatut.ContactAchtr, MotifStatut.Autre, MotifStatut.CoordBancErr, MotifStatut.TxTvaErr, MotifStatut.MontanttotalErr,
        MotifStatut.CalculErr, MotifStatut.NonConforme, MotifStatut.Doublon, MotifStatut.DestErr, MotifStatut.TransacInc,
        MotifStatut.EmmetInc, MotifStatut.ContratTerm, MotifStatut.DoubleFact, MotifStatut.CmdErr, MotifStatut.AdrErr,
        MotifStatut.RefCtAbsent, MotifStatut.LivrIncomp,
    ];

    private static readonly Dictionary<string, string[]> Motifs = new()
    {
        [StatutCdv.Deposee] = [MotifStatut.NonTransmise],
        [StatutCdv.ApprouveePartiellement] =
        [
            MotifStatut.Autre, MotifStatut.CmdErr, MotifStatut.SiretErr, MotifStatut.CodeRoutageErr, MotifStatut.RefCtAbsent,
            MotifStatut.RefErr, MotifStatut.PuErr, MotifStatut.RemErr, MotifStatut.QteErr, MotifStatut.ArtErr,
            MotifStatut.ModpaiErr, MotifStatut.QualiteErr, MotifStatut.LivrIncomp,
        ],
        [StatutCdv.EnLitige] =
        [
            MotifStatut.Autre, MotifStatut.CoordBancErr, MotifStatut.TxTvaErr, MotifStatut.MontanttotalErr, MotifStatut.CalculErr,
            MotifStatut.NonConforme, MotifStatut.Doublon, MotifStatut.DestErr, MotifStatut.TransacInc, MotifStatut.EmmetInc,
            MotifStatut.ContratTerm, MotifStatut.DoubleFact, MotifStatut.CmdErr, MotifStatut.AdrErr, MotifStatut.SiretErr,
            MotifStatut.CodeRoutageErr, MotifStatut.RefCtAbsent, MotifStatut.RefErr, MotifStatut.PuErr, MotifStatut.RemErr,
            MotifStatut.QteErr, MotifStatut.ArtErr, MotifStatut.ModpaiErr, MotifStatut.QualiteErr, MotifStatut.LivrIncomp,
        ],
        [StatutCdv.Suspendue] =
        [
            MotifStatut.JustifAbs, MotifStatut.CoordBancErr, MotifStatut.CmdErr, MotifStatut.SiretErr, MotifStatut.CodeRoutageErr,
            MotifStatut.RefCtAbsent, MotifStatut.RefErr,
        ],
        [StatutCdv.ErreurRoutage] = [MotifStatut.RoutageErr],
        [StatutCdv.Irrecevable] =
        [
            MotifStatut.IrrVideF, MotifStatut.IrrTypeF, MotifStatut.IrrSyntax, MotifStatut.IrrTaillePj, MotifStatut.IrrNomPj,
            MotifStatut.IrrVidPj, MotifStatut.IrrExtDoc, MotifStatut.IrrTailleF, MotifStatut.IrrAntivirus, MotifStatut.IrrNomF,
        ],
    };

    /// <summary>Rang d'avancement pour le statut affiché (Rejetée et Refusée priment, hors rang).</summary>
    private static readonly Dictionary<string, int> Rang = new()
    {
        [StatutCdv.Deposee] = 10,
        [StatutCdv.Emise] = 20,
        [StatutCdv.ErreurRoutage] = 25,
        [StatutCdv.Recue] = 30,
        [StatutCdv.MiseADisposition] = 40,
        [StatutCdv.Irrecevable] = 45,
        [StatutCdv.PriseEnCharge] = 50,
        [StatutCdv.Visee] = 55,
        [StatutCdv.Suspendue] = 60,
        [StatutCdv.Completee] = 65,
        [StatutCdv.EnLitige] = 70,
        [StatutCdv.ApprouveePartiellement] = 80,
        [StatutCdv.Affacturee] = 85,
        [StatutCdv.AffactureeConfidentiel] = 85,
        [StatutCdv.ChangementCompteAPayer] = 85,
        [StatutCdv.NonAffacturee] = 85,
        [StatutCdv.Approuvee] = 90,
        [StatutCdv.DemandePaiementDirect] = 95,
        [StatutCdv.PaiementTransmis] = 100,
        [StatutCdv.Encaissee] = 110,
        [StatutCdv.Annulee] = 120,
    };

    /// <summary>Rôle de la société selon le sens de la facture : vendeur d'une facture émise, acheteur d'une facture reçue ; null si inconnu.</summary>
    public static string? EmetteurDuSens(string? sens) => sens switch
    {
        SensFacture.Emise => Vendeur,
        SensFacture.Recue => Acheteur,
        _ => null,
    };

    /// <summary>Émetteurs admis d'un statut (vide si inconnu).</summary>
    public static IReadOnlyList<string> EmetteursStatut(string? statut) =>
        statut is not null && Emetteurs.TryGetValue(statut, out var e) ? e : [];

    /// <summary>
    /// Motifs autorisés d'un statut. Rejetée : selon l'émetteur (PA_E à l'émission, PA_R en réception, les deux sans
    /// émetteur) ; Refusée : liste B2B ou B2G. Statut sans motif prévu : vide.
    /// </summary>
    public static IReadOnlyList<string> MotifsAutorises(string? statut, string? emetteur = null, bool b2g = false)
    {
        if (statut == StatutCdv.Rejetee) return emetteur == PaR ? MotifsRejetReception : MotifsRejetEmission;
        if (statut == StatutCdv.Refusee) return b2g ? MotifsRefusB2g : MotifsRefusB2b;
        return statut is not null && Motifs.TryGetValue(statut, out var m) ? m : [];
    }

    /// <summary>Statut terminal (Rejetée, Refusée).</summary>
    public static bool Terminal(string? statut) => StatutCdv.Terminaux.Contains(statut);

    /// <summary>Motif obligatoire (En litige, Refusée, Rejetée).</summary>
    public static bool MotifObligatoire(string? statut) => StatutCdv.MotifObligatoire.Contains(statut);

    /// <summary>Statut obligatoirement transmis au PPF (Déposée, Refusée, Encaissée, Rejetée).</summary>
    public static bool ObligatoirePpf(string? statut) => StatutCdv.ObligatoiresPpf.Contains(statut);

    /// <summary>
    /// Erreurs d'enchaînement d'un statut posé par la société après un historique : rien après un statut terminal ;
    /// facture émise : rien avant Déposée ; Déposée une seule fois ; Complétée seulement en réponse à une Suspendue.
    /// </summary>
    private static List<string> ErreursEnchainement(string sens, IReadOnlyList<string> historique, string statut)
    {
        var erreurs = new List<string>();
        if (historique.Any(Terminal)) erreurs.Add(ErreurFe.StatutTerminal);
        var interdite = (sens == SensFacture.Emise && !historique.Contains(StatutCdv.Deposee))
            || (statut == StatutCdv.Deposee && historique.Contains(StatutCdv.Deposee))
            || (statut == StatutCdv.Completee
                && historique.LastOrDefault(h => h == StatutCdv.Suspendue || h == StatutCdv.Completee) != StatutCdv.Suspendue);
        if (interdite) erreurs.Add(ErreurFe.TransitionInterdite);
        return erreurs;
    }

    /// <summary>
    /// Contrôle d'un statut avant de le poser ou à sa réception : liste des codes <see cref="ErreurFe"/> (vide : statut
    /// admis). Les règles d'enchaînement (terminal, transition) ne s'appliquent qu'au statut posé par la société (émetteur
    /// = rôle du sens) ; un statut reçu est contrôlé sur son code, son émetteur, son motif et son action.
    /// </summary>
    public static List<string> Controler(StatutPropose p)
    {
        var role = EmetteurDuSens(p.Sens);
        if (role is null) return [ErreurFe.SensInconnu];
        if (!Emetteurs.ContainsKey(p.Statut ?? "")) return [ErreurFe.StatutInconnu];
        var erreurs = new List<string>();
        if (!EmetteursStatut(p.Statut).Contains(p.Emetteur)) erreurs.Add(ErreurFe.EmetteurNonAutorise);
        if (!string.IsNullOrEmpty(p.Motif))
        {
            if (!MotifStatut.Tous.Contains(p.Motif)) erreurs.Add(ErreurFe.MotifInconnu);
            else if (!MotifsAutorises(p.Statut, p.Emetteur, p.B2g).Contains(p.Motif)) erreurs.Add(ErreurFe.MotifNonAutorise);
        }
        else if (MotifObligatoire(p.Statut)) erreurs.Add(ErreurFe.MotifObligatoire);
        if (!string.IsNullOrEmpty(p.Action) && !ActionCdv.Tous.Contains(p.Action)) erreurs.Add(ErreurFe.ActionInconnue);
        if (p.Emetteur == role) erreurs.AddRange(ErreursEnchainement(p.Sens, p.Historique, p.Statut!));
        return erreurs;
    }

    /// <summary>Statuts que la société peut poser après un historique, dans l'ordre de <see cref="StatutCdv.Tous"/> (vide si sens inconnu).</summary>
    public static List<string> StatutsPosables(string? sens, IReadOnlyList<string> historique)
    {
        var role = EmetteurDuSens(sens);
        if (role is null) return [];
        return StatutCdv.Tous.Where(s => Emetteurs[s].Contains(role) && ErreursEnchainement(sens!, historique, s).Count == 0).ToList();
    }

    /// <summary>
    /// Statut affiché d'une facture d'après son historique (ordre chronologique) : le premier statut terminal s'il y en a,
    /// sinon le plus avancé (à rang égal, le plus récent) ; codes inconnus ignorés ; null sans statut.
    /// </summary>
    public static string? StatutAffiche(IReadOnlyList<string> historique)
    {
        var terminal = historique.FirstOrDefault(Terminal);
        if (terminal is not null) return terminal;
        string? affiche = null;
        foreach (var s in historique)
            if (Rang.TryGetValue(s, out var r) && (affiche is null || r >= Rang[affiche])) affiche = s;
        return affiche;
    }
}
