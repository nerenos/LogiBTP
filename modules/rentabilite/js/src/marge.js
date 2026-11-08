// Marge d'un chantier avec produit interne (lot 6, refacturation interne du matériel), répliquée dans
// dotnet/LogiBTP.Rentabilite/Marges.cs (jeu tests/cas/03_marge_produit_interne.json). Le produit interne (composante
// PRODUIT_INTERNE : heures du matériel valorisées sur d'autres chantiers) s'ajoute au HT des lignes du chantier de suivi ;
// sans pièce ni écriture comptable. Calculs en décimal, jamais en Number.
import { Dz } from '@logibtp/socle';

const pourcent = (a, b) => (b.isZero() ? null : a.times(100).dividedBy(b));

/**
 * Marges brute (produit − PA) et nette (produit − PR), en montant et en % du produit ; produit = HT des lignes + produit
 * interne ; taux null si le produit est nul.
 */
export function margeChantier({ lignes, produitInterne = 0, pa, pr }) {
  const produit = Dz(lignes).plus(Dz(produitInterne));
  const brute = produit.minus(Dz(pa));
  const nette = produit.minus(Dz(pr));
  return { produit, brute, taux_brute: pourcent(brute, produit), nette, taux_nette: pourcent(nette, produit) };
}
