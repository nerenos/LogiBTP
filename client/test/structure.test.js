import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { completerRattachement, controlerIntervenants } from '../src/app/structure/structure.js';
import { adresseChantierInitiale } from '../src/app/structure/marche-commande.js';
import { FONCTIONS_INTERVENANT } from '../src/app/structure/donnees.js';

describe('Structure des affaires', () => {
  it('adresse du chantier créé à l’acceptation : commande, sinon projet, sinon client', () => {
    const client = { adresse: { ligne1: '1 rue du Client', code_postal: '69001', ville: 'Lyon' } };
    const projet = { adresse: '2 rue du Projet', code_postal: '69002', ville: 'Villeurbanne' };
    const commande = { ent_adresse_livraison: { adresse: { ligne1: '3 rue des Travaux', ligne2: 'Bât. B', code_postal: '69003', ville: 'Caluire' } }, ent_contact_client: client };
    expect(adresseChantierInitiale(commande, projet)).toEqual({ adresse: '3 rue des Travaux, Bât. B', code_postal: '69003', ville: 'Caluire' });
    expect(adresseChantierInitiale({ ent_contact_client: client }, projet)).toEqual({ adresse: '2 rue du Projet', code_postal: '69002', ville: 'Villeurbanne' });
    expect(adresseChantierInitiale({ ent_contact_client: client }, null)).toEqual({ adresse: '1 rue du Client', code_postal: '69001', ville: 'Lyon' });
  });

  it('complète le rattachement : marché → chantier → affaire', () => {
    const refs = { chantiers: [{ id: 2, aff_id: 1 }], marches: [{ id: 5, cha_id: 2 }] };
    expect(completerRattachement({ ent_marche_id: 5 }, refs)).toEqual({ ent_projet_id: null, ent_affaire_id: 1, ent_chantier_id: 2, ent_marche_id: 5 });
    expect(completerRattachement({ ent_projet_id: 3 }, refs)).toEqual({ ent_projet_id: 3, ent_affaire_id: null, ent_chantier_id: null, ent_marche_id: null });
  });

  it('contrôle les intervenants comme le serveur (Intervenants.Controler)', () => {
    const f = FONCTIONS_INTERVENANT;
    expect(controlerIntervenants([{ fonction: 'CLIENT', per_id: 1 }, { fonction: 'SOUS_TRAITANT', per_id: 2, paiement_direct: true }], f, 'S')).toEqual([]);
    expect(controlerIntervenants([
      { fonction: 'PAYEUR', per_id: 1 }, { fonction: 'PAYEUR', ind_id: 3 }, { fonction: 'BC', per_id: 4, paiement_direct: true },
      { fonction: 'LIVRAISON', per_id: 5 }, { fonction: 'ARCHITECTE' }, { fonction: 'XX', per_id: 1 },
    ], f, 'S')).toEqual([
      'Un seul intervenant « Payeur »', 'Intervenant 3 : paiement direct réservé aux sous-traitants',
      'Intervenant 4 : fonction « Contact de livraison » non proposée ici', 'Intervenant 5 : tiers ou contact à choisir',
      'Intervenant 6 : fonction inconnue',
    ]);
    expect(controlerIntervenants([{ fonction: 'ARCHITECTE', per_id: 1 }], f, 'D')).toHaveLength(1);
  });

  it('réplique les fonctions de db/162_intervenants.sql', () => {
    const sql = fs.readFileSync(new URL('../../db/162_intervenants.sql', import.meta.url), 'utf8');
    const lignes = [...sql.matchAll(/^\('([A-Z_]+)', '((?:[^']|'')*)', '([STD])', (TRUE|FALSE), (TRUE|FALSE), (\d+)\)/gm)]
      .map((m) => ({ code: m[1], libelle: m[2].replace(/''/g, "'"), portee: m[3], unique: m[4] === 'TRUE', paiement_direct: m[5] === 'TRUE', ordre: Number(m[6]) }));
    expect(lignes).toEqual(FONCTIONS_INTERVENANT);
  });
});

import { facturesMarche, peutAnnulerParAvoir } from '../src/app/structure/structure.js';

describe('Gestion du marché : pièces remplacées (M2)', () => {
  const valable = { ent_id: 1, valide: true, annule: false, remplace: false, total_ht: '100' };
  const remplacee = { ent_id: 2, valide: true, annule: false, remplace: true, total_ht: '40' };
  it('une facture remplacée est absente du total et sans bouton d\'avoir', () => {
    const { comptees } = facturesMarche([valable, remplacee], false);
    expect(comptees.map((x) => x.ent_id)).toEqual([1]);
    expect(peutAnnulerParAvoir(remplacee)).toBe(false);
  });
  it('une facture valable garde bouton et total', () => {
    expect(peutAnnulerParAvoir(valable)).toBe(true);
    expect(facturesMarche([valable], false).comptees).toHaveLength(1);
  });
});

describe('Gestion du marché : case Afficher le détail (M1)', () => {
  const courant = { ent_id: 3, indice: 'B', reference: true, annule: false, remplace: false, total_ht: '120' };
  const ancien = { ent_id: 1, indice: 'A', reference: false, annule: false, remplace: true, total_ht: '100' };
  const annule = { ent_id: 4, indice: 'A', reference: true, annule: true, remplace: false, total_ht: '10' };
  it('sans détail : une ligne par référence, indice courant', () => {
    const { affichees } = facturesMarche([ancien, courant, annule], false);
    expect(affichees.map((x) => x.indice)).toEqual(['B']);
  });
  it('avec détail : tous les indices, total hors annulées et remplacées', () => {
    const { affichees, comptees } = facturesMarche([ancien, courant, annule], true);
    expect(affichees.map((x) => x.ent_id)).toEqual([1, 3, 4]);
    expect(comptees.map((x) => x.ent_id)).toEqual([3]);
  });
});
