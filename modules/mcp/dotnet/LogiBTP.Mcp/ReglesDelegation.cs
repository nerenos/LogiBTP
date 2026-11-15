using LogiBTP.Socle;

namespace LogiBTP.Mcp;

/// <summary>Droits d'un profil (forme du module Droits, reprise sans dépendance) : nœud → action → portée ; Total = profil total.</summary>
public sealed record DroitsProfil(bool Total, IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> Lignes);

/// <summary>
/// Plafond d'une délégation : modèle (<see cref="ModelePlafond"/>), actions par nœud (SUR_MESURE, même héritage que
/// les droits), portée maximale (null : TOUT ; inconnue : SOI).
/// </summary>
public sealed record PlafondDelegation(string? Modele, IReadOnlyDictionary<string, IReadOnlyList<string>>? Actions = null, string? Portee = null);

/// <summary>
/// Données fournies par la spécialisation : catalogue (nœud → actions, développe un profil total), nœuds retenus par
/// garde-fou (garde-fou → nœuds), interdits supplémentaires (codes d'action ou préfixes de nœuds).
/// </summary>
public sealed record OptionsDelegation(
    IReadOnlyDictionary<string, IReadOnlyList<string>>? Catalogue = null,
    IReadOnlyDictionary<string, IReadOnlyList<string>>? Noeuds = null,
    IReadOnlyList<string>? Interdits = null);

/// <summary>Délégation saisie : modèle, échéance en jours (null : défaut), garde-fous levés.</summary>
public sealed record DelegationSaisie(string? Modele, int? Jours, IReadOnlyList<string>? Leves);

/// <summary>Délégant : profil total, modèles permis (null : tous), garde-fous levables, échéance maximale du profil.</summary>
public sealed record Delegant(bool Total, IReadOnlyList<string>? Levables, IReadOnlyList<string>? Modeles = null, int? JoursMax = null);

/// <summary>Quotas du garde-fou VOLUME (null : valeurs par défaut).</summary>
public sealed record QuotasDelegation(int? Appel = null, int? Jour = null, int? Alerte = null);

/// <summary>Résultat d'un quota : éléments accordés, tronqué, erreur (MCP_QUOTA_JOUR), alerte.</summary>
public sealed record ResultatQuota(int Accordes, bool Tronque, string? Erreur, bool Alerte);

/// <summary>Outil d'agent : nœud de droits, action, effet externe (envoi).</summary>
public sealed record OutilAgent(string Noeud, string Action, bool Envoi = false);

/// <summary>
/// Règles de délégation des droits à un agent IA, répliquées avec modules/mcp/js/src/delegation.js (jeu partagé
/// modules/mcp/tests/cas/01_delegation.json). Droits effectifs = intersection du profil et du plafond par nœud et
/// action (portée la plus étroite), moins les interdits absolus et les garde-fous actifs.
/// </summary>
public static class ReglesDelegation
{
    public const int EcheanceDefaut = 30;
    public const int EcheanceMax = 90;
    public const int QuotaAppel = 200;
    public const int QuotaJour = 5000;
    public const int AlerteQuota = 80;

    /// <summary>Nœuds interdits à un agent, quelle que soit l'action (préfixes).</summary>
    public static readonly IReadOnlyList<string> NoeudsInterdits = ["administration", "connexions", "mail"];

    /// <summary>Nœuds en lecture seule pour un agent.</summary>
    public static readonly IReadOnlyList<string> NoeudsLectureSeule = ["parametres"];

    /// <summary>Actions jamais délégables.</summary>
    public static readonly IReadOnlyList<string> ActionsInterdites =
        [ActionsDroits.Forcer, ActionsDroits.Usurper, ActionsDroits.Parametrer, ActionsDroits.Deverrouiller];

    private static readonly IReadOnlyList<string> RetireesValidation = [ActionsDroits.Valider, ActionsDroits.Supprimer, ActionsDroits.Devalider];
    private static readonly IReadOnlyList<string> RetireesRgpd = [ActionsDroits.Rgpd, ActionsDroits.Confidentiel];
    private static readonly IReadOnlyList<string> Preparation = [ActionsDroits.Consulter, ActionsDroits.Creer, ActionsDroits.Modifier];
    private static readonly IReadOnlyList<string> Portees = [PorteesDroits.Soi, PorteesDroits.Equipe, PorteesDroits.Service, PorteesDroits.Tout];
    private static readonly IReadOnlyList<string> Modeles = [ModelePlafond.Lecture, ModelePlafond.Preparation, ModelePlafond.CommeMoi, ModelePlafond.SurMesure];

    /// <summary>Garde-fous dans l'ordre des codes du socle.</summary>
    public static readonly IReadOnlyList<string> GardesFous =
    [
        GardeFou.Rgpd, GardeFou.Tiers, GardeFou.Salaries, GardeFou.Paie, GardeFou.Couts, GardeFou.GedConfidentiel,
        GardeFou.CrmNotes, GardeFou.Envoi, GardeFou.Validation, GardeFou.Volume,
    ];

    private static readonly HashSet<string> Actions = typeof(ActionsDroits).GetFields()
        .Where(f => f.IsLiteral && f.FieldType == typeof(string)).Select(f => (string)f.GetRawConstantValue()!).ToHashSet();

    private static readonly Dictionary<string, string> Alias = new()
    {
        [ActionsDroits.Voir] = ActionsDroits.Consulter,
        [ActionsDroits.Transformer] = ActionsDroits.Consulter,
        [ActionsDroits.Approuver] = ActionsDroits.Valider,
        [ActionsDroits.Devalider] = ActionsDroits.Deverrouiller,
        [ActionsDroits.Debloquer] = ActionsDroits.Deverrouiller,
        [ActionsDroits.Confidentiel] = ActionsDroits.Rgpd,
    };

    private static int Rang(string? p) => p is null ? -1 : IndexDe(Portees, p);
    private static int IndexDe(IReadOnlyList<string> liste, string v) { for (var i = 0; i < liste.Count; i++) if (liste[i] == v) return i; return -1; }

    public static string NormaliserAction(string? action)
    {
        var a = (action ?? "").Trim().ToUpperInvariant();
        return Alias.TryGetValue(a, out var n) ? n : a;
    }

    private static bool Sous(string noeud, string prefixe) => noeud == prefixe || noeud.StartsWith(prefixe + "/", StringComparison.Ordinal);

    private static T? LigneDe<T>(IReadOnlyDictionary<string, T>? lignes, string noeud) where T : class
    {
        if (lignes is null) return null;
        for (string? n = noeud; !string.IsNullOrEmpty(n); n = n.Contains('/') ? n[..n.LastIndexOf('/')] : null)
            if (lignes.TryGetValue(n, out var l)) return l;
        return null;
    }

    /// <summary>Actions d'un modèle : LECTURE → CONSULTER ; PREPARATION → CONSULTER, CREER, MODIFIER ; COMME_MOI, SUR_MESURE → null ; inconnu → aucune.</summary>
    public static IReadOnlyList<string>? ActionsModele(string? modele) => modele switch
    {
        ModelePlafond.Lecture => [ActionsDroits.Consulter],
        ModelePlafond.Preparation => [.. Preparation],
        ModelePlafond.CommeMoi or ModelePlafond.SurMesure => null,
        _ => [],
    };

    /// <summary>Garde-fous actifs : tous, sauf ceux levables pour le profil et levés par la délégation (double accord).</summary>
    public static IReadOnlyList<string> GardesFousActifs(IEnumerable<string>? levables, IEnumerable<string>? leves)
    {
        var l = (levables ?? []).ToHashSet();
        var v = (leves ?? []).ToHashSet();
        return GardesFous.Where(g => !(l.Contains(g) && v.Contains(g))).ToList();
    }

    /// <summary>Interdit absolu (nœuds d'administration, connexions, messagerie, paramétrage en écriture, actions interdites) ou de la spécialisation.</summary>
    public static bool EstInterdit(string noeud, string? action, IEnumerable<string>? interdits = null)
    {
        var brute = (action ?? "").Trim().ToUpperInvariant();
        var a = NormaliserAction(brute);
        if (ActionsInterdites.Contains(brute) || ActionsInterdites.Contains(a)) return true;
        if (NoeudsInterdits.Any(p => Sous(noeud, p))) return true;
        if (a != ActionsDroits.Consulter && NoeudsLectureSeule.Any(p => Sous(noeud, p))) return true;
        foreach (var i in interdits ?? [])
            if (Actions.Contains(i) ? brute == i || a == i : Sous(noeud, i)) return true;
        return false;
    }

    private static List<string> Retenus(IEnumerable<string>? gardesFous, IReadOnlyDictionary<string, IReadOnlyList<string>>? noeuds) =>
        (gardesFous ?? []).SelectMany(g => noeuds is not null && noeuds.TryGetValue(g, out var n) ? n : []).ToList();

    /// <summary>
    /// Droits effectifs de l'agent (lignes redondantes retirées). Nœud retenu par un garde-fou actif : aucune action.
    /// Profil total : jamais COMME_MOI (rien), SUR_MESURE borné à la préparation. Modèle inconnu : rien.
    /// </summary>
    public static DroitsProfil DroitsEffectifs(DroitsProfil? profil, PlafondDelegation? plafond, IEnumerable<string>? gardesFous, OptionsDelegation? options = null)
    {
        var vide = new DroitsProfil(false, new SortedDictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.Ordinal));
        var total = profil?.Total ?? false;
        var modele = plafond?.Modele;
        if (modele is null || !Modeles.Contains(modele) || (total && modele == ModelePlafond.CommeMoi)) return vide;
        var porteeMax = plafond!.Portee is null ? PorteesDroits.Tout : Portees.Contains(plafond.Portee) ? plafond.Portee : PorteesDroits.Soi;
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> lignesProfil = total
            ? (options?.Catalogue ?? new Dictionary<string, IReadOnlyList<string>>()).ToDictionary(
                kv => kv.Key, kv => (IReadOnlyDictionary<string, string>)kv.Value.ToDictionary(x => x, _ => PorteesDroits.Tout))
            : profil?.Lignes ?? new Dictionary<string, IReadOnlyDictionary<string, string>>();
        var permises = ActionsModele(modele) ?? (total ? Preparation : null);
        Dictionary<string, List<string>>? lignesPlafond = modele == ModelePlafond.SurMesure
            ? (plafond.Actions ?? new Dictionary<string, IReadOnlyList<string>>()).ToDictionary(kv => kv.Key, kv => (kv.Value ?? []).Select(NormaliserAction).ToList())
            : null;
        var actifs = (gardesFous ?? []).ToList();
        var retirees = new HashSet<string>();
        if (actifs.Contains(GardeFou.Validation)) retirees.UnionWith(RetireesValidation);
        if (actifs.Contains(GardeFou.Rgpd)) retirees.UnionWith(RetireesRgpd);
        var retenus = Retenus(actifs, options?.Noeuds);
        var interdits = options?.Interdits ?? [];
        var noeuds = lignesProfil.Keys.Concat(lignesPlafond?.Keys ?? Enumerable.Empty<string>()).Concat(retenus)
            .Concat(NoeudsInterdits).Concat(NoeudsLectureSeule).Concat(interdits.Where(i => !Actions.Contains(i)))
            .Distinct().OrderBy(n => n, StringComparer.Ordinal);

        var lignes = new SortedDictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.Ordinal);
        foreach (var n in noeuds)
        {
            var ligne = new SortedDictionary<string, string>(StringComparer.Ordinal);
            if (!retenus.Any(r => Sous(n, r)))
            {
                var p = LigneDe(lignesProfil, n) ?? new Dictionary<string, string>();
                var q = lignesPlafond is null ? null : LigneDe(lignesPlafond, n) ?? [];
                foreach (var (a, portee) in p)
                {
                    var norm = NormaliserAction(a);
                    if (Rang(portee) < 0) continue;
                    if (permises is not null && !permises.Contains(norm)) continue;
                    if (q is not null && !q.Contains(norm)) continue;
                    if (retirees.Contains(a) || retirees.Contains(norm)) continue;
                    if (EstInterdit(n, a, interdits)) continue;
                    ligne[a] = Rang(portee) <= Rang(porteeMax) ? portee : porteeMax;
                }
            }
            lignes[n] = ligne;
        }
        // Lignes égales à ce que le nœud hériterait de son plus proche ancêtre (ou vides sans ancêtre) : retirées.
        var redondants = lignes.Keys.Where(n =>
        {
            var i = n.LastIndexOf('/');
            var herite = (i < 0 ? null : LigneDe(lignes, n[..i])) ?? new Dictionary<string, string>();
            return Egales(lignes[n], herite);
        }).ToList();
        foreach (var n in redondants) lignes.Remove(n);
        return new DroitsProfil(false, lignes);
    }

    private static bool Egales(IReadOnlyDictionary<string, string> a, IReadOnlyDictionary<string, string> b) =>
        a.Count == b.Count && a.All(kv => b.TryGetValue(kv.Key, out var v) && v == kv.Value);

    /// <summary>Action permise à l'agent (droits effectifs) sur le nœud avec au moins la portée demandée.</summary>
    public static bool AutoriseAgent(DroitsProfil? effectifs, string noeud, string action, string porteeMin = PorteesDroits.Soi)
    {
        var l = LigneDe(effectifs?.Lignes, noeud);
        return l is not null && l.TryGetValue(NormaliserAction(action), out var p) && Rang(p) >= Rang(porteeMin);
    }

    /// <summary>Contrôle d'une délégation au regard du délégant : codes <see cref="ErreurMcp"/>, dans l'ordre.</summary>
    public static IReadOnlyList<string> ControlerDelegation(DelegationSaisie? delegation, Delegant? delegant)
    {
        var erreurs = new List<string>();
        var m = delegation?.Modele;
        if (m is null || !Modeles.Contains(m)) erreurs.Add(ErreurMcp.McpModeleInconnu);
        else if (delegant?.Modeles is not null && !delegant.Modeles.Contains(m)) erreurs.Add(ErreurMcp.McpModeleNonPermis);
        if ((delegant?.Total ?? false) && m == ModelePlafond.CommeMoi) erreurs.Add(ErreurMcp.McpAdminCommeMoi);
        var max = Math.Min(delegant?.JoursMax ?? EcheanceMax, EcheanceMax);
        if (delegation?.Jours is int j && (j < 1 || j > max)) erreurs.Add(ErreurMcp.McpEcheance);
        var levables = delegant?.Levables ?? [];
        if ((delegation?.Leves ?? []).Any(g => !levables.Contains(g))) erreurs.Add(ErreurMcp.McpGardeFouNonLevable);
        return erreurs;
    }

    /// <summary>Date d'échéance : début + jours (30 par défaut), bornés à 1 et au maximum du profil (90 au plus).</summary>
    public static DateOnly EcheanceDelegation(DateOnly debut, int? jours = null, int? joursMax = null)
    {
        var max = Math.Min(joursMax ?? EcheanceMax, EcheanceMax);
        return debut.AddDays(Math.Max(1, Math.Min(jours ?? EcheanceDefaut, max)));
    }

    /// <summary>Quota d'un appel (garde-fou VOLUME) compte tenu des éléments déjà lus dans la journée.</summary>
    public static ResultatQuota AppliquerQuota(int demandes, int dejaDuJour, QuotasDelegation? quotas = null)
    {
        var appel = quotas?.Appel ?? QuotaAppel;
        var jour = quotas?.Jour ?? QuotaJour;
        var alerte = quotas?.Alerte ?? AlerteQuota;
        var reste = Math.Max(0, jour - dejaDuJour);
        var accordes = Math.Max(0, Math.Min(demandes, Math.Min(appel, reste)));
        return new ResultatQuota(accordes, accordes < demandes, reste == 0 && demandes > 0 ? ErreurMcp.McpQuotaJour : null,
            (long)(dejaDuJour + accordes) * 100 >= (long)alerte * jour);
    }

    /// <summary>
    /// Classement d'un outil : INTERDIT, LECTURE, BROUILLON, ou PROPOSITION (action retenue seulement par ENVOI ou
    /// VALIDATION, que le délégant pourrait faire ; jamais pour un plafond LECTURE ni un nœud retenu).
    /// </summary>
    public static string ClasserOutil(OutilAgent outil, DroitsProfil? profil, PlafondDelegation? plafond, IEnumerable<string>? gardesFous, OptionsDelegation? options = null)
    {
        var noeud = outil.Noeud ?? "";
        var brute = (outil.Action ?? "").Trim().ToUpperInvariant();
        var a = NormaliserAction(brute);
        if (EstInterdit(noeud, brute, options?.Interdits)) return ClasseOutil.Interdit;
        var actifs = (gardesFous ?? []).ToList();
        var total = profil?.Total ?? false;
        var modele = plafond?.Modele;
        var proposable = modele is not null && Modeles.Contains(modele) && modele != ModelePlafond.Lecture && !(total && modele == ModelePlafond.CommeMoi)
            && (total || (LigneDe(profil?.Lignes, noeud)?.ContainsKey(a) ?? false))
            && !Retenus(actifs, options?.Noeuds).Any(r => Sous(noeud, r));
        if (outil.Envoi && actifs.Contains(GardeFou.Envoi)) return proposable ? ClasseOutil.Proposition : ClasseOutil.Interdit;
        if (AutoriseAgent(DroitsEffectifs(profil, plafond, actifs, options), noeud, a))
            return a == ActionsDroits.Consulter ? ClasseOutil.Lecture : ClasseOutil.Brouillon;
        if (actifs.Contains(GardeFou.Validation) && (RetireesValidation.Contains(brute) || RetireesValidation.Contains(a)) && proposable)
            return ClasseOutil.Proposition;
        return ClasseOutil.Interdit;
    }
}
