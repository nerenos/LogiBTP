import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sirenValide, siretValide, cleTva, tvaValide, ibanValide, bicValide, erreursIdentifiants, planifierCoordonnees,
  FournisseurAnnuaireMemoire, coordonneesParDefaut,
} from '../src/index.js';

const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');
const lire = (f) => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf-8'));

describe('identifiants (jeu partagé 01_identifiants.json)', () => {
  const jeu = lire('01_identifiants.json');
  it('SIREN', () => jeu.siren.forEach((c) => expect(sirenValide(c.valeur), c.valeur).toBe(c.attendu)));
  it('SIRET', () => jeu.siret.forEach((c) => expect(siretValide(c.valeur), c.valeur).toBe(c.attendu)));
  it('clé de TVA', () => jeu.cle_tva.forEach((c) => expect(cleTva(c.siren)).toBe(c.attendu)));
  it('TVA intracommunautaire', () => jeu.tva.forEach((c) => expect(tvaValide(c.valeur), c.valeur).toBe(c.attendu)));
  it('IBAN', () => jeu.iban.forEach((c) => expect(ibanValide(c.valeur), c.valeur).toBe(c.attendu)));
  it('BIC', () => jeu.bic.forEach((c) => expect(bicValide(c.valeur), c.valeur).toBe(c.attendu)));
  for (const c of jeu.personnes) {
    it(`personne : ${c.nom}`, () => expect(erreursIdentifiants(c.valeurs).map(({ champ, code }) => ({ champ, code }))).toEqual(c.erreurs));
  }
});

describe('plan des coordonnées (jeu partagé 02_coordonnees.json)', () => {
  for (const c of lire('02_coordonnees.json').cas) {
    it(c.nom, () => {
      const r = planifierCoordonnees({ existantes: c.existantes, saisies: c.saisies, partages: c.partages });
      expect(r.operations).toEqual(c.attendu.operations);
      expect(r.erreurs.map(({ index, champ, code }) => ({ index, champ, code }))).toEqual(c.attendu.erreurs);
      expect(r.choix_requis).toEqual(c.attendu.choix_requis);
    });
  }
});

/** Annuaire de test : une société, un établissement, un individu salarié de la société et client particulier. */
function annuaire() {
  return new FournisseurAnnuaireMemoire({
    niveaux: [{ code: 'SOCIETE', libelle: 'Société', ordre: 1 }, { code: 'ETABLISSEMENT', libelle: 'Établissement', ordre: 2 }, { code: 'PARTICULIER', libelle: 'Particulier', morale: false, ordre: 9 }],
    casquettes: [{ code: 'CLIENT', libelle: 'Client', groupes: ['client'] }, { code: 'FOURNISSEUR', libelle: 'Fournisseur', groupes: ['fournisseur'] }],
    types_lien: [{ code: 'FACTURER_A', libelle: 'Facturer à', libelle_inverse: 'Payeur pour' }],
    personnes: [
      { id: 1, code: 'ENT', niveau: 'SOCIETE', raison_sociale: 'ENT SAS', casquettes: ['FOURNISSEUR'], siret: '40483304800022' },
      { id: 2, code: 'ENT-LYON', niveau: 'ETABLISSEMENT', raison_sociale: 'ENT Lyon', parent_id: 1, casquettes: ['FOURNISSEUR'] },
    ],
    individus: [{ id: 1, civilite: 'M.', nom: 'Ab', prenom: 'Jean', roles: [] }],
    rattachements: [{ id: 1, per_id: 1, ind_id: 1, fonction: 'Commercial', principal: true }],
    coordonnees: [
      { id: 1, nature: 'ADRESSE', ligne1: '1 rue du Port', code_postal: '69002', ville: 'Lyon', pays: 'FR' },
      { id: 2, nature: 'TELEPHONE', valeur: '04 72 00 00 01' },
      { id: 3, nature: 'ADRESSE', ligne1: '8 impasse des Lilas', code_postal: '69100', ville: 'Villeurbanne', pays: 'FR' },
      { id: 4, nature: 'TELEPHONE', valeur: '06 12 34 56 78' },
    ],
    usages: [
      { id: 1, coo_id: 1, per_id: 1, usage: 'SIEGE', principal: true, ordre: 0 },
      { id: 2, coo_id: 1, per_id: 2, usage: 'PRINCIPALE', principal: true, ordre: 0 },
      { id: 3, coo_id: 2, per_id: 1, usage: 'STANDARD', principal: true, ordre: 0 },
      { id: 4, coo_id: 3, ind_id: 1, usage: 'PERSONNELLE', principal: true, ordre: 0 },
      { id: 5, coo_id: 4, rat_id: 1, usage: 'PORTABLE', principal: true, ordre: 0 },
    ],
  });
}

describe('annuaire en mémoire', () => {
  it('lit les coordonnées partagées avec les autres fiches', async () => {
    const a = annuaire();
    const g = await a.geres('personne').lire(a.personnes[0]);
    const adresse = g.coordonnees.find((u) => u.nature === 'ADRESSE');
    expect(adresse.partages).toEqual([{ type: 'personne', id: 2, libelle: 'ENT Lyon', usage: 'PRINCIPALE' }]);
    expect(g.rattachements[0]).toMatchObject({ individu: 'M. Jean Ab', fonction: 'Commercial', principal: true });
    expect(g.rattachements[0].coordonnees[0]).toMatchObject({ valeur: '06 12 34 56 78', usage: 'PORTABLE' });
    expect(g.enfants.map((e) => e.id)).toEqual([2]);
  });

  it('coordonnée partagée : choix requis, puis modification pour toutes les fiches avec historique', async () => {
    const a = annuaire();
    const g = await a.geres('personne').lire(a.personnes[0]);
    const coordonnees = g.coordonnees.map((u) => (u.nature === 'ADRESSE' ? { ...u, ligne1: '3 rue du Port' } : u));
    await expect(a.geres('personne').valider(a.personnes[0], { coordonnees })).rejects.toMatchObject({ code: 'CHOIX_REQUIS' });
    const avecChoix = coordonnees.map((u) => (u.nature === 'ADRESSE' ? { ...u, choix: 'MODIFICATION' } : u));
    await a.geres('personne').ecrire(a.personnes[0], { coordonnees: avecChoix });
    expect(a.personnes[1].adresse).toBe('3 rue du Port, 69002 Lyon');
    expect(await a.historiqueCoordonnee(1)).toMatchObject([{ avant: { ligne1: '1 rue du Port' } }]);
  });

  it('coordonnée partagée : autre information pour cette fiche seulement', async () => {
    const a = annuaire();
    const g = await a.geres('personne').lire(a.personnes[1]);
    const coordonnees = g.coordonnees.map((u) => ({ ...u, ligne1: '9 quai Perrache', choix: 'AUTRE' }));
    await a.geres('personne').ecrire(a.personnes[1], { coordonnees });
    expect(a.personnes[1].adresse).toBe('9 quai Perrache, 69002 Lyon');
    expect(a.personnes[0].adresse).toBe('1 rue du Port, 69002 Lyon');
    expect(a.coordonnees).toHaveLength(5);
  });

  it('coordonnée modifiée par ailleurs entre-temps : refus', async () => {
    const a = annuaire();
    const g = await a.geres('personne').lire(a.personnes[0]);
    a.coordonnees.find((c) => c.id === 2).valeur = '04 72 99 99 99';
    const coordonnees = g.coordonnees.map((u) => (u.nature === 'TELEPHONE' ? { ...u, valeur: '04 72 00 00 02' } : u));
    await expect(a.geres('personne').valider(a.personnes[0], { coordonnees })).rejects.toMatchObject({ code: 'COORDONNEE_MODIFIEE' });
  });

  it('usage supprimé : coordonnée orpheline supprimée, coordonnée encore utilisée conservée', async () => {
    const a = annuaire();
    await a.geres('personne').ecrire(a.personnes[0], { coordonnees: [] });
    expect(a.coordonnees.map((c) => c.id)).toEqual([1, 3, 4]);
  });

  it('contact créé depuis une personne (nouvel individu) et rattachement supprimé', async () => {
    const a = annuaire();
    const g = await a.geres('personne').lire(a.personnes[1]);
    const rattachements = [...g.rattachements, {
      nouvel_individu: { civilite: 'Mme', nom: 'Durand', prenom: 'Lucie' }, fonction: 'Assistante', coordonnees: [{ nature: 'EMAIL', usage: 'PRO', valeur: 'l.durand@ent.fr' }],
    }];
    await a.geres('personne').ecrire(a.personnes[1], { rattachements });
    const lucie = a.individus.find((i) => i.nom === 'Durand');
    expect(lucie).toMatchObject({ personnes: 'ENT Lyon', fonction: 'Assistante', email: 'l.durand@ent.fr' });
    await a.geres('personne').ecrire(a.personnes[1], { rattachements: [] });
    expect(a.rattachements.filter((r) => r.per_id === 2)).toEqual([]);
    expect(a.coordonnees.some((c) => c.valeur === 'l.durand@ent.fr')).toBe(false);
  });

  it('compte particulier : personne titulaire, coordonnées personnelles partagées (même identifiant)', async () => {
    const a = annuaire();
    const { id } = await a.creerParticulier(1);
    const p = a.personnes.find((x) => x.id === id);
    expect(p).toMatchObject({ niveau: 'PARTICULIER', raison_sociale: 'M. AB Jean', casquettes: ['CLIENT'], adresse: '8 impasse des Lilas, 69100 Villeurbanne' });
    const g = await a.geres('individu').lire(a.individus[0]);
    expect(g.rattachements.map((r) => r.personne)).toEqual(['ENT SAS', 'M. AB Jean']);
    expect(g.coordonnees[0].partages).toEqual([{ type: 'personne', id, libelle: 'M. AB Jean', usage: 'PERSONNELLE' }]);
    expect((await a.creerParticulier(1)).existant).toBe(true);
  });

  it('coordonnées proposées : celles des fiches liées, sans doublon', async () => {
    const a = annuaire();
    const p = await a.coordonneesProposees('personne', 2);
    expect(p.map((c) => [c.coo_id, c.source.type, c.source.id])).toEqual([[1, 'personne', 1], [2, 'personne', 1]]);
    const i = await a.coordonneesProposees('individu', 1);
    expect(i.map((c) => c.coo_id)).toEqual([1, 2, 4]);
  });

  it('liens entre personnes (vus des deux côtés) et contrôles', async () => {
    const a = annuaire();
    await a.geres('personne').ecrire(a.personnes[1], { liens: [{ autre_id: 1, tli_code: 'FACTURER_A' }] });
    const g = await a.geres('personne').lire(a.personnes[0]);
    expect(g.liens).toMatchObject([{ inverse: true, autre_id: 2, tli_code: 'FACTURER_A' }]);
    await expect(a.geres('personne').valider(a.personnes[0], { liens: [{ autre_id: 1, tli_code: 'FACTURER_A' }] })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(() => a.controlerPersonne(1, { parent_id: 2 })).toThrow('Hiérarchie');
    expect(() => a.controlerPersonne(2, { siret: '404 833 048 00022' })).toThrow(/SIRET/);
  });

  it('recherche sans accents ni casse, coordonnées par défaut', async () => {
    const a = annuaire();
    expect((await a.rechercherPersonnes({ recherche: 'ent-lyon' })).map((p) => p.id)).toEqual([2]);
    expect((await a.rechercherPersonnes({ casquette: 'CLIENT' }))).toEqual([]);
    expect((await a.rechercherIndividus({ recherche: 'jean' }))[0].nom_complet).toBe('M. Jean Ab');
    expect(coordonneesParDefaut().map((c) => c.nature)).toEqual(['ADRESSE', 'TELEPHONE', 'EMAIL']);
  });
});
