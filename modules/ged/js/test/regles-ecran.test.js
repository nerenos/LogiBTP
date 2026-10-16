import { describe, it, expect } from 'vitest';
import { FournisseurGedMemoire } from '../src/index.js';
import { listeDepuisTexte, entierOuNul } from '../ui/regles.js';

describe('écran de paramétrage des règles', () => {
  it('lit les listes et durées saisies', () => {
    expect(listeDepuisTexte(' pdf, dwg ;pdf\n ifc, ')).toEqual(['pdf', 'dwg', 'ifc']);
    expect(listeDepuisTexte(null)).toEqual([]);
    expect(entierOuNul('')).toBeNull();
    expect(entierOuNul(' 36 ')).toBe(36);
  });

  it('hors ligne : remplace les règles par le fournisseur mémoire, réservé à un administrateur', async () => {
    const g = new FournisseurGedMemoire({ profil: 'ADMIN' });
    const { retention, classification } = await g.regles();
    const r = await g.remplacerReglesRetention([...retention, { id: 0, libelle: 'Plans de chantier', categorie: 'plan', type_element: 'chantier',
      duree_active_mois: 12, duree_conservation_mois: null, action_fin: 'REVOIR', priorite: 5, actif: true }]);
    expect(r.retention.at(-1)).toMatchObject({ id: retention.length + 1, libelle: 'Plans de chantier' });
    const c = await g.remplacerReglesClassification([...classification, { id: 0, libelle: 'Devis fournisseurs', priorite: 50, actif: true,
      extensions: listeDepuisTexte('.PDF'), types_mime: [], mots: ['devis'], expediteur: null, type_element: null, categorie: null, confidentialite: 'INTERNE', mots_cles: ['achat'] }]);
    expect(c.classification.at(-1).extensions).toEqual(['pdf']);
    // Les règles de classification enregistrées servent au dialogue de dépôt (paramètres).
    expect((await g.parametres()).regles_classification.at(-1).libelle).toBe('Devis fournisseurs');
    expect((await g.remplacerReglesRetention([{ ...retention[0], action_fin: 'GARDER' }]).catch((e) => e)).code).toBe('ACTION');

    const lecteur = new FournisseurGedMemoire({ profil: 'LECTEUR' });
    expect((await lecteur.remplacerReglesClassification([]).catch((e) => e)).code).toBe('ACCES_REFUSE');
  });
});
