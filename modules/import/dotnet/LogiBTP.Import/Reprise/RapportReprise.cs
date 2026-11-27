using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LogiBTP.Import.Reprise;

/// <summary>Volumes d'une table source : lignes lues, écrites dans LogiBTP et écartées (avec le motif principal).</summary>
public sealed class VolumeTable
{
    [JsonPropertyName("table")] public string Table { get; init; } = "";
    [JsonPropertyName("lues")] public long Lues { get; set; }
    [JsonPropertyName("ecrites")] public long Ecrites { get; set; }
    [JsonPropertyName("ecartees")] public long Ecartees { get; set; }
}

/// <summary>Valeur obligatoire absente de la source, posée par défaut (Q13) : à corriger après la reprise.</summary>
public sealed record ValeurForcee(
    [property: JsonPropertyName("fiche")] string Fiche,
    [property: JsonPropertyName("cle")] string Cle,
    [property: JsonPropertyName("champ")] string Champ,
    [property: JsonPropertyName("valeur")] string Valeur);

/// <summary>Écart entre le total recalculé et le total source d'une pièce, porté par une ligne d'écart d'arrondi.</summary>
public sealed record EcartArrondi(
    [property: JsonPropertyName("piece")] string Piece,
    [property: JsonPropertyName("total_source")] decimal TotalSource,
    [property: JsonPropertyName("total_calcule")] decimal TotalCalcule,
    [property: JsonPropertyName("ecart")] decimal Ecart);

/// <summary>Champ source sans équivalent : nombre de valeurs non vides perdues et exemples.</summary>
[JsonObjectCreationHandling(JsonObjectCreationHandling.Populate)]
public sealed class ChampPerdu
{
    [JsonPropertyName("table")] public string Table { get; init; } = "";
    [JsonPropertyName("champ")] public string Champ { get; init; } = "";
    [JsonPropertyName("motif")] public string? Motif { get; init; }
    [JsonPropertyName("nombre")] public long Nombre { get; set; }
    [JsonPropertyName("exemples")] public List<string> Exemples { get; } = [];
}

/// <summary>Anomalie relevée : niveau (<see cref="NiveauAnomalie"/>), code, emplacement et message.</summary>
public sealed record AnomalieReprise(
    [property: JsonPropertyName("niveau")] string Niveau,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("emplacement")] string? Emplacement,
    [property: JsonPropertyName("message")] string Message);

/// <summary>Utilisateur de l'ancien logiciel (comptes créés à la main, Q20), avec sa fiche LogiBTP quand le lien existe.</summary>
public sealed record UtilisateurSource(
    [property: JsonPropertyName("identifiant")] string Identifiant,
    [property: JsonPropertyName("nom")] string? Nom,
    [property: JsonPropertyName("courriel")] string? Courriel,
    [property: JsonPropertyName("profil")] string? Profil,
    [property: JsonPropertyName("fiche_type")] string? FicheType,
    [property: JsonPropertyName("fiche_id")] long? FicheId);

/// <summary>Ligne source d'un groupe de doublons proposé : clé d'origine et libellé lisible (code, raison sociale, ville).</summary>
public sealed record FicheDoublon(
    [property: JsonPropertyName("cle")] string Cle,
    [property: JsonPropertyName("libelle")] string Libelle);

/// <summary>
/// Doublons proposés à la fusion (même SIRET, même nom et code postal…) : l'écran de reprise les présente à cocher, les
/// choix sont enregistrés dans <c>import_fusion</c> et appliqués à la reprise suivante.
/// </summary>
public sealed record DoublonPropose(
    [property: JsonPropertyName("table")] string Table,
    [property: JsonPropertyName("critere")] string Critere,
    [property: JsonPropertyName("valeur")] string Valeur,
    [property: JsonPropertyName("fiches")] IReadOnlyList<FicheDoublon> Fiches);

/// <summary>Durée et état d'un domaine exécuté.</summary>
public sealed record DomaineExecute(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("duree_ms")] long DureeMs);

/// <summary>
/// Rapport d'une reprise (simulation ou réelle) : enregistré en jsonb dans <c>import_reprise.irp_rapport</c>, rendu en
/// Markdown pour la commande de l'installeur et l'écran de reprise. Les champs perdus ne comptent que les valeurs non
/// vides : on sait ce qui se perd réellement, pas seulement ce qui existe dans le schéma.
/// </summary>
[JsonObjectCreationHandling(JsonObjectCreationHandling.Populate)]
public sealed class RapportReprise
{
    private const int ExemplesMax = 3;

    [JsonPropertyName("source")] public string Source { get; init; } = "";
    [JsonPropertyName("societes")] public IReadOnlyList<string> Societes { get; init; } = [];
    [JsonPropertyName("simulation")] public bool Simulation { get; init; }
    [JsonPropertyName("etat")] public string Etat { get; set; } = EtatReprise.EnCours;
    [JsonPropertyName("debut")] public DateTimeOffset Debut { get; init; } = DateTimeOffset.UtcNow;
    [JsonPropertyName("fin")] public DateTimeOffset? Fin { get; set; }
    [JsonPropertyName("domaines")] public List<DomaineExecute> Domaines { get; } = [];
    /// <summary>Temps cumulé par poste (lecture de la source, calcul, écriture…), du plus long au plus court.</summary>
    [JsonPropertyName("chronos")] public List<ChronoPoste> Chronos { get; } = [];
    [JsonPropertyName("tables_source")] public Dictionary<string, long> TablesSource { get; } = new(StringComparer.Ordinal);
    [JsonPropertyName("volumes")] public List<VolumeTable> Volumes { get; } = [];
    [JsonPropertyName("correspondances")] public Dictionary<string, Dictionary<string, string>> Correspondances { get; } = new(StringComparer.Ordinal);
    [JsonPropertyName("valeurs_forcees")] public List<ValeurForcee> ValeursForcees { get; } = [];
    [JsonPropertyName("ecarts_arrondi")] public List<EcartArrondi> EcartsArrondi { get; } = [];
    [JsonPropertyName("champs_perdus")] public List<ChampPerdu> ChampsPerdus { get; } = [];
    [JsonPropertyName("anomalies")] public List<AnomalieReprise> Anomalies { get; } = [];
    [JsonPropertyName("utilisateurs")] public List<UtilisateurSource> Utilisateurs { get; } = [];
    [JsonPropertyName("doublons")] public List<DoublonPropose> Doublons { get; } = [];

    /// <summary>
    /// Total des lignes écrites des volumes, lu pendant la reprise par le suivi de l'avancement (autre fil) : liste
    /// modifiée pendant la lecture → null (valeur précédente gardée par l'appelant).
    /// </summary>
    public long? EcritesTotal()
    {
        try { return Volumes.ToArray().Sum(v => v.Ecrites); }
        catch (Exception e) when (e is InvalidOperationException or ArgumentException or NullReferenceException or IndexOutOfRangeException) { return null; }
    }

    /// <summary>Volumes d'une table source (créés au premier appel).</summary>
    public VolumeTable Volume(string table)
    {
        var v = Volumes.FirstOrDefault(x => x.Table == table);
        if (v is null) Volumes.Add(v = new VolumeTable { Table = table });
        return v;
    }

    /// <summary>Correspondance appliquée (table → valeur source → cible ou motif), pour la relecture.</summary>
    public void Appliquer(string table, string source, string resultat)
    {
        if (!Correspondances.TryGetValue(table, out var t)) Correspondances[table] = t = new(StringComparer.Ordinal);
        t[source] = resultat;
    }

    /// <summary>Valeur non vide d'un champ sans équivalent (comptée, trois exemples au plus).</summary>
    public void Perdre(string table, string champ, string? valeur, string? motif = null)
    {
        if (string.IsNullOrWhiteSpace(valeur)) return;
        var c = ChampsPerdus.FirstOrDefault(x => x.Table == table && x.Champ == champ);
        if (c is null) ChampsPerdus.Add(c = new ChampPerdu { Table = table, Champ = champ, Motif = motif });
        c.Nombre++;
        if (c.Exemples.Count < ExemplesMax && !c.Exemples.Contains(valeur)) c.Exemples.Add(valeur);
    }

    public void Forcer(string fiche, string cle, string champ, string valeur) => ValeursForcees.Add(new(fiche, cle, champ, valeur));

    public void Signaler(string niveau, string code, string? emplacement, string message) =>
        Anomalies.Add(new(niveau, code, emplacement, message));

    /// <summary>Groupe de doublons proposé (au moins deux fiches).</summary>
    public void Proposer(string table, string critere, string valeur, IReadOnlyList<FicheDoublon> fiches)
    {
        if (fiches.Count > 1) Doublons.Add(new(table, critere, valeur, fiches));
    }

    public bool Bloque => Anomalies.Any(a => a.Niveau == NiveauAnomalie.Bloquant);

    /// <summary>Format des nombres du rapport (globalisation invariante : séparateurs français posés à la main).</summary>
    private static readonly NumberFormatInfo Nombres = new() { NumberDecimalSeparator = ",", NumberGroupSeparator = "\u202f" };

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false };

    public string EnJson() => JsonSerializer.Serialize(this, Json);

    public static RapportReprise? DepuisJson(string json) => JsonSerializer.Deserialize<RapportReprise>(json, Json);

    /// <summary>Rapport lisible (commande de l'installeur, pièce jointe de la GED).</summary>
    public string EnMarkdown()
    {
        var c = Nombres;
        var sb = new StringBuilder();
        sb.AppendLine($"# Reprise {Source}{(Simulation ? " (simulation)" : "")}");
        sb.AppendLine();
        sb.AppendLine($"- État : {Etat}");
        if (Societes.Count > 0) sb.AppendLine($"- Sociétés source : {string.Join(", ", Societes)}");
        sb.AppendLine($"- Début : {Debut:yyyy-MM-dd HH:mm:ss} UTC{(Fin is { } f ? $", fin : {f:yyyy-MM-dd HH:mm:ss} UTC" : "")}");
        sb.AppendLine($"- Domaines : {(Domaines.Count == 0 ? "aucun" : string.Join(", ", Domaines.Select(d => $"{d.Code} ({d.DureeMs} ms)")))}");

        Section(sb, "Temps par poste", Chronos, ["Poste", "Durée (s)", "Passages"],
            p => [p.Poste, (p.DureeMs / 1000m).ToString("N1", c), p.Nombre.ToString(c)]);
        Section(sb, "Anomalies", Anomalies, ["Niveau", "Code", "Emplacement", "Message"],
            a => [a.Niveau, a.Code, a.Emplacement ?? "", a.Message]);
        Section(sb, "Volumes par table source", Volumes, ["Table", "Lues", "Écrites", "Écartées"],
            v => [v.Table, v.Lues.ToString(c), v.Ecrites.ToString(c), v.Ecartees.ToString(c)]);
        Section(sb, "Valeurs forcées à corriger", ValeursForcees, ["Fiche", "Clé", "Champ", "Valeur posée"],
            v => [v.Fiche, v.Cle, v.Champ, v.Valeur]);
        Section(sb, "Lignes d'écart d'arrondi", EcartsArrondi, ["Pièce", "Total source", "Total calculé", "Écart"],
            e => [e.Piece, e.TotalSource.ToString("N2", c), e.TotalCalcule.ToString("N2", c), e.Ecart.ToString("N2", c)]);
        Section(sb, "Champs sans équivalent", ChampsPerdus, ["Table", "Champ", "Valeurs perdues", "Exemples", "Motif"],
            p => [p.Table, p.Champ, p.Nombre.ToString(c), string.Join(" ; ", p.Exemples), p.Motif ?? ""]);
        Section(sb, "Doublons proposés à la fusion", Doublons, ["Table", "Critère", "Valeur", "Fiches"],
            d => [d.Table, d.Critere, d.Valeur, string.Join(" ; ", d.Fiches.Select(f => $"{f.Cle} {f.Libelle}"))]);
        Section(sb, "Correspondances appliquées", Correspondances.SelectMany(t => t.Value.Select(v => (t.Key, v.Key, v.Value))).ToList(),
            ["Table", "Valeur source", "Résultat"], x => [x.Item1, x.Item2, x.Item3]);
        Section(sb, "Utilisateurs de l'ancien logiciel", Utilisateurs, ["Identifiant", "Nom", "Courriel", "Profil", "Fiche"],
            u => [u.Identifiant, u.Nom ?? "", u.Courriel ?? "", u.Profil ?? "", u.FicheType is null ? "" : $"{u.FicheType} {u.FicheId}"]);
        Section(sb, "Tables de la base source", TablesSource.OrderBy(t => t.Key, StringComparer.Ordinal).ToList(), ["Table", "Lignes"],
            t => [t.Key, t.Value.ToString(c)]);
        return sb.ToString();
    }

    private static void Section<T>(StringBuilder sb, string titre, IReadOnlyCollection<T> lignes, string[] entetes, Func<T, string[]> cellules)
    {
        sb.AppendLine();
        sb.AppendLine($"## {titre}");
        sb.AppendLine();
        if (lignes.Count == 0) { sb.AppendLine("Aucune."); return; }
        sb.AppendLine("| " + string.Join(" | ", entetes) + " |");
        sb.AppendLine("|" + string.Concat(entetes.Select(_ => "---|")));
        foreach (var l in lignes)
            sb.AppendLine("| " + string.Join(" | ", cellules(l).Select(Cellule)) + " |");
    }

    private static string Cellule(string texte) => texte.Replace("|", "\\|").Replace("\r", "").Replace("\n", " ");
}
