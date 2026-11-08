using LogiBTP.Socle;
using System.Text;
using System.Text.RegularExpressions;

namespace LogiBTP.Mail;

/// <summary>Élément de l'application (type, identifiant).</summary>
public sealed record ElementCible(string Type, string Id);

/// <summary>Candidat fourni par l'application : élément dont le numéro ou une référence peut figurer dans le courriel, tiers de l'élément.</summary>
public sealed record Candidat(string Type, string Id, string? Numero, IReadOnlyList<string> References, long? TiersId);

/// <summary>Règle de reconnaissance : nature, mots cherchés dans des zones (objet, texte, pieces ; aucune = toutes), expéditeur par suffixe, action, ordre.</summary>
public sealed record RegleReconnaissance(string Code, string Nature, IReadOnlyList<string> Mots, IReadOnlyList<string> Dans, string? Expediteur, string? Service,
    string Action, int Ordre);

/// <summary>Courriel à reconnaître et ce que l'application en sait (fil, candidats, tiers de l'expéditeur).</summary>
public sealed record EntreeReconnaissance(string Objet, string Texte, IReadOnlyList<string> Pieces, string TextePieces, string De, IReadOnlyList<ElementCible> Fil,
    IReadOnlyList<Candidat> Candidats, IReadOnlyList<long> ExpediteurTiers, IReadOnlyList<ElementCible> Tiers, bool Automatique);

public sealed record Proposition(string Type, string Id, int Score, IReadOnlyList<string> Indices);

public sealed record ResultatReconnaissance(string? Nature, string? Regle, string? Service, string Decision, IReadOnlyList<Proposition> Retenus,
    IReadOnlyList<Proposition> Propositions, bool Alerte);

/// <summary>
/// Reconnaissance d'un courriel reçu, répliquée avec reconnaissance.js (jeu tests/cas/01_reconnaissance.json) : nature
/// par la première règle applicable, score des candidats (numéro dans l'objet 70, dans le texte ou le nom d'une pièce
/// 60, dans le texte des pièces 50 ; référence 40 ; expéditeur = tiers 20 ; plafond 100 ; fil 100 ; tiers 50),
/// décision IGNORE / RATTACHE / PROPOSE / A_RAPPROCHER, alerte.
/// </summary>
public static partial class ReconnaissanceMail
{
    public static readonly IReadOnlyDictionary<string, int> Scores = new Dictionary<string, int>
    {
        ["NUMERO_OBJET"] = 70, ["NUMERO_TEXTE"] = 60, ["NUMERO_PIECE"] = 60, ["NUMERO_PIECE_TEXTE"] = 50, ["REFERENCE"] = 40, ["EXPEDITEUR"] = 20, ["FIL"] = 100, ["TIERS"] = 50,
    };

    public static readonly string[] Zones = ["objet", "texte", "pieces"];
    public static readonly string[] Actions = ["ALERTER", "RATTACHER", "IGNORER"];
    public static readonly string[] Natures = ["ARC", "REPONSE_DEVIS", "FACTURE_FOURNISSEUR", "BL", "RELANCE", "AUTRE"];

    [GeneratedRegex(@"[\s﻿]+")]
    private static partial Regex Espaces();

    /// <summary>Minuscules, accents retirés (table du socle), apostrophe typographique droite, espaces resserrés.</summary>
    public static string Normaliser(string? texte) => Espaces().Replace(SansAccent.Retirer(texte).Replace('’', '\''), " ").Trim();

    private static bool Alnum(string t, int i) => i >= 0 && i < t.Length && (t[i] is >= 'a' and <= 'z' || char.IsAsciiDigit(t[i]));

    /// <summary>Le mot (ou l'expression) figure en entier dans le texte, sans casse ni accents.</summary>
    public static bool ContientMot(string? texte, string? mot)
    {
        var t = Normaliser(texte);
        var m = Normaliser(mot);
        if (m.Length == 0) return false;
        for (var i = t.IndexOf(m, StringComparison.Ordinal); i >= 0; i = t.IndexOf(m, i + 1, StringComparison.Ordinal))
        {
            if (!Alnum(t, i - 1) && !Alnum(t, i + m.Length)) return true;
        }
        return false;
    }

    /// <summary>Première règle (ordre, puis code) qui s'applique.</summary>
    public static RegleReconnaissance? RegleApplicable(EntreeReconnaissance e, IEnumerable<RegleReconnaissance> regles)
    {
        var zones = new Dictionary<string, string> { ["objet"] = e.Objet, ["texte"] = e.Texte, ["pieces"] = string.Join(' ', e.Pieces) };
        return regles.OrderBy(r => r.Ordre).ThenBy(r => r.Code, StringComparer.Ordinal).FirstOrDefault(r =>
        {
            if (!string.IsNullOrEmpty(r.Expediteur) && !Normaliser(e.De).EndsWith(Normaliser(r.Expediteur), StringComparison.Ordinal)) return false;
            if (r.Mots.Count == 0) return !string.IsNullOrEmpty(r.Expediteur);
            var dans = r.Dans.Count > 0 ? r.Dans : Zones;
            return r.Mots.Any(m => dans.Any(z => ContientMot(zones.GetValueOrDefault(z, ""), m)));
        });
    }

    private static Proposition? Scorer(EntreeReconnaissance e, Candidat c)
    {
        var indices = new List<string>();
        if (!string.IsNullOrEmpty(c.Numero))
        {
            if (ContientMot(e.Objet, c.Numero)) indices.Add("NUMERO_OBJET");
            else if (ContientMot(e.Texte, c.Numero)) indices.Add("NUMERO_TEXTE");
            else if (e.Pieces.Any(p => ContientMot(p, c.Numero))) indices.Add("NUMERO_PIECE");
            else if (ContientMot(e.TextePieces, c.Numero)) indices.Add("NUMERO_PIECE_TEXTE");
        }
        string[] textes = [e.Objet, e.Texte, e.TextePieces];
        if (c.References.Any(r => !string.IsNullOrEmpty(r) && r.Length >= 4 && textes.Any(t => ContientMot(t, r)))) indices.Add("REFERENCE");
        if (indices.Count == 0) return null;
        if (c.TiersId is long t && e.ExpediteurTiers.Contains(t)) indices.Add("EXPEDITEUR");
        return new Proposition(c.Type, c.Id, Math.Min(100, indices.Sum(i => Scores[i])), indices);
    }

    /// <summary>Identifiants comparés comme des nombres s'ils le sont tous deux (même ordre que localeCompare numérique).</summary>
    private static int ComparerId(string a, string b) =>
        long.TryParse(a, out var x) && long.TryParse(b, out var y) ? x.CompareTo(y) : string.CompareOrdinal(a, b);

    public static ResultatReconnaissance Reconnaitre(EntreeReconnaissance e, IReadOnlyList<RegleReconnaissance> regles, int seuilHaut = 80, int seuilBas = 40)
    {
        var regle = RegleApplicable(e, regles);
        var props = new List<Proposition>();
        void Ajouter(Proposition p)
        {
            var i = props.FindIndex(x => x.Type == p.Type && x.Id == p.Id);
            if (i < 0) props.Add(p);
            else if (p.Score > props[i].Score) props[i] = p;
        }
        foreach (var f in e.Fil) Ajouter(new Proposition(f.Type, f.Id, Scores["FIL"], ["FIL"]));
        foreach (var c in e.Candidats)
        {
            if (Scorer(e, c) is { } p) Ajouter(p);
        }
        foreach (var t in e.Tiers)
        {
            if (!props.Any(x => x.Type == t.Type && x.Id == t.Id)) props.Add(new Proposition(t.Type, t.Id, Scores["TIERS"], ["TIERS"]));
        }
        props.Sort((a, b) => b.Score != a.Score ? b.Score.CompareTo(a.Score) : a.Type != b.Type ? string.CompareOrdinal(a.Type, b.Type) : ComparerId(a.Id, b.Id));
        var action = regle?.Action ?? "ALERTER";
        var decision = "A_RAPPROCHER";
        List<Proposition> retenus = [];
        var hauts = props.Where(p => p.Score >= seuilHaut).ToList();
        if (action == "IGNORER") decision = "IGNORE";
        else if (e.Fil.Count > 0) { decision = "RATTACHE"; retenus = props.Where(p => p.Indices.Contains("FIL")).ToList(); }
        else if (hauts.Count == 1) { decision = "RATTACHE"; retenus = hauts; }
        else if (props.Any(p => p.Score >= seuilBas)) decision = "PROPOSE";
        return new ResultatReconnaissance(regle?.Nature, regle?.Code, regle?.Service, decision, retenus, props,
            decision == "RATTACHE" && !e.Automatique && action == "ALERTER");
    }

    /// <summary>Motifs par défaut d'un accusé de réception de commande (mots entiers, sans casse ni accents).</summary>
    public static readonly string[] MotifsAr = ["accusé de réception", "confirmation de commande", "AR", "ARC"];

    [GeneratedRegex(@"livr[a-z]*[^0-9]{0,40}?(?:([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})|semaine\s*(?:n\s*°?\s*|no\s*)?([0-9]{1,2})(?:[/-]([0-9]{4}))?)")]
    private static partial Regex Livraison();

    /// <summary>Années reconnues (hors plage : pas de date proposée, comme côté JS).</summary>
    public const int AnneeMin = 2000, AnneeMax = 2099;

    private static bool AnneeValable(int? a) => a is >= AnneeMin and <= AnneeMax;

    private static bool Bissextile(int a) => (a % 4 == 0 && a % 100 != 0) || a % 400 == 0;

    private static int JoursDuMois(int a, int m) => m == 2 ? (Bissextile(a) ? 29 : 28) : m is 4 or 6 or 9 or 11 ? 30 : 31;

    /// <summary>Lundi de la semaine n (1 à 53) de l'année : le lundi de la semaine 1 est celui de la semaine du 4 janvier.</summary>
    private static string LundiDeSemaine(int annee, int semaine)
    {
        var quatre = new DateOnly(annee, 1, 4);
        var dow = ((int)quatre.DayOfWeek + 6) % 7;
        return quatre.AddDays(-dow + 7 * (semaine - 1)).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>Numéros candidats : un des préfixes (numérotation des commandes), séparateur facultatif, chiffres (groupes séparés par - ou /).</summary>
    private static List<string> NumerosCandidats(string[] zones, IReadOnlyList<string> prefixes)
    {
        var trouves = new List<string>();
        var ps = prefixes.Select(Normaliser).Where(p => p.Length > 0).Select(Regex.Escape).ToList();
        if (ps.Count == 0) return trouves;
        var re = new Regex($"(?<![a-z0-9])(?:{string.Join('|', ps)})[-/ ]?[0-9]+(?:[-/][0-9]+)*(?![a-z0-9])");
        foreach (var z in zones)
        {
            foreach (Match m in re.Matches(Normaliser(z)))
            {
                var n = m.Value.Replace(" ", "").ToUpperInvariant();
                if (!trouves.Contains(n)) trouves.Add(n);
            }
        }
        return trouves;
    }

    private static (string? Date, int? Semaine, string Precision)? LivraisonAnnoncee(string[] zones, int? anneeReference)
    {
        foreach (var z in zones)
        {
            foreach (Match m in Livraison().Matches(Normaliser(z)))
            {
                if (m.Groups[4].Success)
                {
                    var semaine = int.Parse(m.Groups[4].Value);
                    if (semaine < 1 || semaine > 53) continue;
                    int? annee = m.Groups[5].Success ? int.Parse(m.Groups[5].Value) : AnneeValable(anneeReference) ? anneeReference : null;
                    if (m.Groups[5].Success && !AnneeValable(annee)) continue;
                    return (annee is null ? null : LundiDeSemaine(annee.Value, semaine), semaine, PrecisionLivraison.Semaine);
                }
                int j = int.Parse(m.Groups[1].Value), mo = int.Parse(m.Groups[2].Value), a = int.Parse(m.Groups[3].Value);
                if (!AnneeValable(a) || mo < 1 || mo > 12 || j < 1 || j > JoursDuMois(a, mo)) continue;
                return ($"{a}-{mo:00}-{j:00}", null, PrecisionLivraison.Jour);
            }
        }
        return null;
    }

    /// <summary>
    /// Accusé de réception de commande (objet et corps du message, pas les pièces jointes), répliqué avec reconnaitreAccuse
    /// (jeu tests/cas/02_accuses_reception.json) : motif, numéros candidats, livraison annoncée (jj/mm/aaaa ou semaine n).
    /// </summary>
    public static ResultatAccuse ReconnaitreAccuse(EntreeAccuse e)
    {
        string[] zones = [e.Objet, e.Texte];
        var motif = (e.Motifs.Count > 0 ? e.Motifs : MotifsAr).FirstOrDefault(m => zones.Any(z => ContientMot(z, m)));
        if (motif is null) return new ResultatAccuse(null, null, [], null, null, null, null);
        var numeros = NumerosCandidats(zones, e.Prefixes);
        var l = LivraisonAnnoncee(zones, e.AnneeReference);
        return new ResultatAccuse(TypeReconnaissance.AccuseReception, motif, numeros, numeros.Count == 1 ? numeros[0] : null, l?.Date, l?.Semaine, l?.Precision);
    }
}

/// <summary>Courriel à examiner : préfixes de la numérotation des commandes, année des semaines sans année, motifs (défaut MotifsAr).</summary>
public sealed record EntreeAccuse(string Objet, string Texte, IReadOnlyList<string> Prefixes, int? AnneeReference, IReadOnlyList<string> Motifs);

public sealed record ResultatAccuse(string? Type, string? Motif, IReadOnlyList<string> Numeros, string? Numero, string? Date, int? Semaine, string? Precision);
