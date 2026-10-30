import { describe, it, expect } from 'vitest';
import { NotificationsDocument } from '../ui/notifications.js';

// Panneau des notifications : sources réunies dans l'ordre des lignes, filtres, suivante / précédente.
const racine = () => ({ classList: { add() {} }, addEventListener() {}, innerHTML: '', querySelector: () => null });

function panneau(sources) {
  const allees = [];
  const editeur = {
    resultat: {
      lignes: [{ lig_id: 1 }, { lig_id: 2 }, { lig_id: 3 }],
      erreurs: [{ lig_id: 3, code: 'TVA_MANQUANTE', message: 'TVA' }], avertissements: [],
    },
    magasin: { abonner() {} }, grille: { courant: 1 }, titreLigne: (id) => `L${id}`,
  };
  const n = new NotificationsDocument(racine(), editeur, { sources, aller: (m) => { allees.push(m.lig_id); editeur.grille.courant = m.lig_id; } });
  return { n, editeur, allees };
}

describe('Notifications du document', () => {
  const saisie = { cle: 'saisie', libelle: 'Saisie', messages: () => [
    { lig_id: 2, code: 'QTE_NULLE', message: 'Quantité à 0', gravite: 'avertissement' },
    { lig_id: 3, code: 'UNITE_MANQUANTE', message: 'Sans unité', gravite: 'avertissement' },
  ] };

  it('réunit le calcul et les sources, triées par ligne puis gravité', () => {
    const { n } = panneau([saisie]);
    n.masques.gravites.clear(); n.masques.sources.clear(); n.masques.codes.clear();
    expect(n.tous().map((m) => [m.lig_id, m.code])).toEqual([[2, 'QTE_NULLE'], [3, 'TVA_MANQUANTE'], [3, 'UNITE_MANQUANTE']]);
    expect(n.messagesLigne(3).map((m) => m.source)).toEqual(['calcul', 'saisie']);
  });

  it('filtre par gravité, source et type', () => {
    const { n } = panneau([saisie]);
    n.masques.gravites.clear(); n.masques.sources.clear(); n.masques.codes.clear();
    n.masques.gravites.add('erreur');
    expect(n.filtres().map((m) => m.code)).toEqual(['QTE_NULLE', 'UNITE_MANQUANTE']);
    n.masques.codes.add('QTE_NULLE');
    expect(n.filtres().map((m) => m.code)).toEqual(['UNITE_MANQUANTE']);
    n.masques.sources.add('saisie');
    expect(n.filtres()).toEqual([]);
  });

  it('passe à la suivante et à la précédente à partir de la ligne courante, en boucle', () => {
    const { n, allees } = panneau([saisie]);
    n.masques.gravites.clear(); n.masques.sources.clear(); n.masques.codes.clear();
    n.suivante(1); n.suivante(1); n.suivante(1); n.suivante(1);
    expect(allees).toEqual([2, 3, 3, 2]);
    n.suivante(-1);
    expect(allees.at(-1)).toBe(3);
  });
});
