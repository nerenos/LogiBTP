import { ErreurCalcul } from '@logibtp/socle';
import { texte } from '@logibtp/socle/dictionnaire';
import { N, nombre } from '@logibtp/metre';

// Fonctions des métrés propres au BTP (option `fonctions` du langage de script du module Métré), passées aux
// moteurs (moteur-btp.js, MoteurDevisBtp.cs) et au panneau de métré (complétion, dictionnaire, contrôle de
// l'éditeur). Réplique de src/LogiBTP.Calcul/FonctionsBtp.cs ; clé : nom normalisé (minuscules sans accents).

export const FONCTIONS_BTP = {
  conditionnements: {
    min: 2, max: 2, signature: 'Conditionnements(quantité; contenance)',
    get description() { return texte('document_btp.fonctions.conditionnements.description'); },
    appliquer: (args) => {
      const q = nombre(args[0], 'Conditionnements');
      const c = nombre(args[1], texte('document_btp.fonctions.conditionnements.contenance'));
      if (!c.isPositive() || c.isZero()) throw new ErreurCalcul('ARGUMENTS', texte('document_btp.fonctions.conditionnements.contenance_positive'));
      return N(q.div(c).ceil());
    },
  },
};
