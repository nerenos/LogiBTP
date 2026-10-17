using LogiBTP.Metres.Script;
using LogiBTP.Socle;

namespace LogiBTP.Calcul;

/// <summary>
/// Fonctions des métrés propres au BTP (ContexteScript.Fonctions), passées par MoteurDevisBtp à chaque script.
/// Réplique de client/src/calcul/fonctions-btp.js (aussi proposées par le panneau de métré) ; clé : nom normalisé.
/// </summary>
public static class FonctionsBtp
{
    public static readonly IReadOnlyDictionary<string, FonctionScript> Catalogue = new Dictionary<string, FonctionScript>
    {
        ["conditionnements"] = new(2, 2, "Conditionnements(quantité; contenance)",
            "Nombre de conditionnements entiers (barres, plaques, rouleaux, sacs…) pour couvrir la quantité", args =>
            {
                var q = Fonctions.Nombre(args[0], "Conditionnements");
                var c = Fonctions.Nombre(args[1], "Conditionnements, contenance");
                if (c <= 0) throw new ErreurCalcul("ARGUMENTS", "Conditionnements : contenance positive attendue");
                return Valeur.N(Math.Ceiling(q / c));
            }),
    };
}
