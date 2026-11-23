using LogiBTP.Metres.Script;
using LogiBTP.Socle;

namespace LogiBTP.Metres;

/// <summary>
/// Métré en script (réplique de script-metre.js) : exécution du script d'un métré pour une ligne de l'hôte,
/// publication des variables, lignes de variables (variable_definition) produites à chaque calcul.
/// </summary>
public static class ScriptMetre
{
    /// <summary>Le métré est-il saisi en script (sinon : lignes de métré) ?</summary>
    public static bool EstScript(Metre? metre) => metre?.MtrScript is not null;

    /// <summary>Métré du document : sans ligne (MtrLigId null), rattaché au document par MtrEntId.</summary>
    public static bool EstMetreDocument(Metre? metre) => metre is not null && metre.MtrLigId is null;

    /// <summary>
    /// Portée où sont publiées les variables non locales d'un script : $$ pour le métré du document (sans ligne),
    /// @ de la ligne par défaut ; l'hôte peut en imposer une autre ($ pour le métré d'une tranche).
    /// </summary>
    public static string PorteePublication(Metre metre, string? publication) => publication ?? (EstMetreDocument(metre) ? "$$" : "@");

    /// <summary>
    /// Exécute le script du métré. Renseigne MtrResultat (null sans « Renvoyer » ou en erreur) ; sans erreur, publie
    /// les variables non locales (numériques, chaînes, booléens) en portée @ de la ligne (ou <paramref name="publication"/>,
    /// $$ pour le métré du document) et affecte le résultat à MtrVariable.
    /// Métré du document (LigneId null) : @, @@ et $ refusés (PORTEE), « Renvoyer » averti (METRE_DOCUMENT_RESULTAT)
    /// et son résultat ignoré, pas d'avertissement METRE_SANS_RESULTAT.
    /// </summary>
    public static ResultatScript Evaluer(Metre metre, ContexteScript contexte, string? publication = null)
    {
        var r = Interpreteur.Executer(metre.MtrScript, contexte);
        if (contexte.LigneId is null)
        {
            var avert = r.Avertissements.Where(a => a.Code != "METRE_SANS_RESULTAT").ToList();
            if (r.Resultat is not null)
            {
                avert.Add(new AvertissementScript("METRE_DOCUMENT_RESULTAT", "Métré du document : « Renvoyer » est ignoré (il ne donne que des variables $$)"));
            }
            r = r with { Resultat = null, Avertissements = avert };
        }
        metre.MtrResultat = r.Resultat;
        if (r.Erreurs.Count > 0) return r;
        var portees = contexte.Portees!;
        var portee = PorteePublication(metre, publication);
        foreach (var v in r.Variables)
        {
            if (!v.Local && v.Valeur is not null) portees.AffecterValeur(portee, v.Nom, v.Valeur, contexte.LigneId);
        }
        if (!string.IsNullOrEmpty(metre.MtrVariable) && r.Resultat is decimal resultat)
        {
            var c = References.AnalyserCible(metre.MtrVariable);
            portees.Affecter(c.Portee, c.Nom, "=", resultat, contexte.LigneId);
        }
        return r;
    }

    /// <summary>
    /// Lignes de variables d'un métré en script : une par variable non locale (portée de publication), dans l'ordre des déclarations.
    /// Une ligne existante (même métré, même nom) garde son identifiant ; <paramref name="nouvelId"/> fournit les autres.
    /// </summary>
    public static List<VariableDefinition> LignesVariables(Metre metre, ResultatScript resultat, IEnumerable<VariableDefinition> existantes,
        long entId, Func<long> nouvelId, string? publication = null)
    {
        var portee = PorteePublication(metre, publication);
        var parNom = new Dictionary<string, VariableDefinition>(StringComparer.Ordinal);
        foreach (var v in existantes) if (v.VarMtrId == metre.MtrId) parNom.TryAdd(v.VarNom, v);
        return resultat.Variables.Where(v => !v.Local).Select((v, k) => new VariableDefinition
        {
            VarId = parNom.TryGetValue(v.Nom, out var e) ? e.VarId : nouvelId(),
            VarEntId = entId,
            VarLigId = metre.MtrLigId,
            VarMtrId = metre.MtrId,
            VarPortee = portee,
            VarNom = v.Nom,
            VarOperation = "=",
            VarFormule = v.Defaut ?? "",
            VarOrdre = k + 1,
            VarType = v.Type.ToString(),
            VarValeur = v.Type == 'N' ? (decimal?)v.Valeur : null,
            VarValeurTexte = v.Type == 'C' ? (string?)v.Valeur : v.Type == 'B' && v.Valeur is bool b ? (b ? "Vrai" : "Faux") : null,
        }).ToList();
    }

    /// <summary>Message d'une erreur de script pour l'hôte (position dans le script).</summary>
    public static string Message(ErreurScript e) => $"Métré, ligne {e.Ligne}, colonne {e.Colonne} : {e.Message}";
}
