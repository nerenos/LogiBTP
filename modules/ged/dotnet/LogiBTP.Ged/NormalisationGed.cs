using LogiBTP.Socle;

namespace LogiBTP.Ged;

/// <summary>
/// Normalisation de la recherche : ligatures développées (œ → oe, æ → ae, ß → ss, ø → o, đ → d, ł → l), accents et
/// autres marques retirés, minuscules (table explicite du socle, <see cref="SansAccent"/> : l'application tourne en mode
/// de globalisation invariant, où string.Normalize ne décompose pas). Même règle que la fonction SQL f_ged_normaliser
/// (colonne dge_recherche) et que normaliserRecherche en JS (jeu tests/cas/03_normalisation.json).
/// </summary>
public static class NormalisationGed
{
    public static string Normaliser(string? texte) => SansAccent.Retirer(texte);
}
