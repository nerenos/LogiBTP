using LogiBTP.Socle;

namespace LogiBTP.Documents;

/// <summary>État de solde d'une ligne transformée : reste, soldée, quantité à écrire dans document_ligne_solde.</summary>
public sealed record EtatSolde(decimal Reste, bool Soldee, decimal ASolder);

/// <summary>
/// Solde des lignes transformées (soldes.js côté client, jeu modules/document/tests/soldes/01_reste_solde.json).
/// reste = quantité du parent − transformé à l'étape (tous documents) − déjà soldé ; soldée si la case est cochée ou
/// si le reste passe sous un seuil (en quantité, ou en % de la quantité du parent) ; un reste négatif est toujours
/// soldé. Une ligne de parent négative se lit au signe près.
/// </summary>
public static class Soldes
{
    public static EtatSolde Etat(decimal qteParent, decimal transforme, decimal solde, decimal seuilPct, decimal seuilQte, bool force)
    {
        var signe = qteParent < 0 ? -1 : 1;
        var reste = ArrondiCalcul.Arr6(qteParent - transforme - solde);
        var normal = reste * signe;
        var seuil = ArrondiCalcul.Arr6(Math.Abs(qteParent) * seuilPct / 100);
        var soldee = force || normal <= seuilQte || normal <= seuil;
        return new EtatSolde(reste, soldee, soldee && normal > 0 ? reste : 0);
    }
}
