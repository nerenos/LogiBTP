// Codes du module SAV, répliqués dans LogiBTP.Sav/Codes.cs (parité vérifiée par CodesTests.cs).

/** État d'un équipement installé : en place, retiré (retour, dépose), remplacé par un autre équipement. */
export const ETAT_EQUIPEMENT = Object.freeze({
  INSTALLE: 'INSTALLE',
  RETIRE: 'RETIRE',
  REMPLACE: 'REMPLACE',
});

/** Origine d'un équipement : créé par un mouvement de stock (application), ou saisi à la main. */
export const ORIGINE_EQUIPEMENT = Object.freeze({
  MOUVEMENT: 'MOUVEMENT',
  MANUEL: 'MANUEL',
});

/** État de la garantie d'un équipement à une date : sans garantie connue, en cours, échue. */
export const ETAT_GARANTIE = Object.freeze({
  SANS: 'SANS',
  EN_COURS: 'EN_COURS',
  ECHUE: 'ECHUE',
});
