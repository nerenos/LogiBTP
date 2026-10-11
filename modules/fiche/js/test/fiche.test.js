import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validerChamp, FournisseurFicheMemoire, titreFiche } from '../src/index.js';

const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');
const lire = (f) => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));

describe('validation des champs (jeu partagé avec le C#)', () => {
  for (const c of lire('01_validation.json').cas) {
    it(c.nom, () => expect(validerChamp(c.champ, c.valeur)).toBe(c.attendu));
  }
});

describe('fournisseur mémoire', () => {
  const definition = {
    libelle: 'Salarié', titre: '[prenom] [nom]',
    champs: [
      { code: 'nom', libelle: 'Nom', type: 'texte', obligatoire: true, longueur: 60 },
      { code: 'prenom', libelle: 'Prénom', type: 'texte' },
      { code: 'email', libelle: 'E-mail', type: 'texte', format: 'email' },
      { code: 'salaire', libelle: 'Salaire', type: 'nombre', confidentiel: true },
    ],
  };
  let t = 0;
  const creer = (profil = 'ADMIN', utilisateur = 'demo') => new FournisseurFicheMemoire({
    types: { salarie: { definition, cle: 'id', proprietes: 'proprietes', lignes: [{ id: 1, nom: 'Martin', prenom: 'Hélène', email: null, salaire: 3000, proprietes: { badge: 'B12', mutuelle: 'X' } }] } },
    droits: [
      ...['VOIR', 'MODIFIER', 'DEBLOQUER', 'CONFIDENTIEL'].map((action) => ({ profil: 'ADMIN', type: 'salarie', action })),
      { profil: 'SAISIE', type: 'salarie', action: 'VOIR' }, { profil: 'SAISIE', type: 'salarie', action: 'MODIFIER' },
    ],
    profil,
    utilisateur,
    parametrage: {
      salarie: {
        obligatoires: ['email'],
        supplementaires: [
          { code: 'badge', libelle: 'Badge', type: 'texte', longueur: 5 },
          { code: 'mutuelle', libelle: 'Mutuelle', type: 'texte', confidentiel: true },
        ],
      },
    },
    horloge: () => t,
  });

  it('titre de fiche', () => expect(titreFiche(definition.titre, { prenom: 'Hélène', nom: 'Martin' })).toBe('Hélène Martin'));

  it('confidentiel masqué, révélé à la demande et journalisé', async () => {
    const f = creer();
    const fiche = await f.charger('salarie', 1);
    expect([fiche.valeurs.salaire, fiche.proprietes.mutuelle, fiche.masques]).toEqual([null, null, ['salaire', '+mutuelle']]);
    expect(await f.reveler('salarie', 1)).toEqual({ valeurs: { salaire: 3000 }, proprietes: { mutuelle: 'X' } });
    expect(f.journal.map((j) => j.champs)).toEqual([['salaire', '+mutuelle']]);
    // Option de session : valeurs envoyées directement (et journalisées).
    expect((await f.charger('salarie', 1, { confidentiel: true })).valeurs.salaire).toBe(3000);
    // Sans le droit CONFIDENTIEL : jamais envoyées.
    const saisie = creer('SAISIE');
    expect((await saisie.charger('salarie', 1, { confidentiel: true })).valeurs.salaire).toBeNull();
    expect((await saisie.reveler('salarie', 1).catch((e) => e)).code).toBe('ACCES_REFUSE');
  });

  it('verrou : un seul modificateur, expiration, reprise de la main avec le droit DEBLOQUER', async () => {
    const f = creer();
    t = 0;
    expect((await f.verrouiller('salarie', 1, { jeton: 'a' })).ok).toBe(true);
    f.utilisateur = 'autre';
    const refus = await f.verrouiller('salarie', 1, { jeton: 'b' });
    expect([refus.ok, refus.verrou.utilisateur, refus.verrou.moi]).toEqual([false, 'demo', false]);
    // Reprise de la main (droit DEBLOQUER) : le premier poste perd le verrou.
    expect((await f.verrouiller('salarie', 1, { jeton: 'b', forcer: true })).ok).toBe(true);
    f.utilisateur = 'demo';
    const perdu = await f.enregistrer('salarie', 1, { jeton: 'a', valeurs: { prenom: 'X' } }).catch((e) => e);
    expect([perdu.code, perdu.details.utilisateur]).toEqual(['VERROU_PERDU', 'autre']);
    // Verrou non renouvelé : expiré au bout de 2 minutes, la fiche est libre.
    t = 121000;
    expect((await f.verrouiller('salarie', 1, { jeton: 'c' })).ok).toBe(true);
    // Sans le droit DEBLOQUER : reprise refusée.
    const saisie = creer('SAISIE', 'saisie');
    t = 0;
    await saisie.verrouiller('salarie', 1, { jeton: 'x' });
    saisie.utilisateur = 'autre';
    expect((await saisie.verrouiller('salarie', 1, { jeton: 'y', forcer: true }).catch((e) => e)).code).toBe('ACCES_REFUSE');
  });

  it('enregistrement : obligatoires (programme et paramétrage), confidentiel conservé, empreinte', async () => {
    const f = creer();
    t = 0;
    const fiche = await f.charger('salarie', 1);
    await f.verrouiller('salarie', 1, { jeton: 'j' });
    const erreur = await f.enregistrer('salarie', 1, { jeton: 'j', h: fiche.h, valeurs: { nom: '' }, proprietes: { badge: 'TROP-LONG' } }).catch((e) => e);
    expect(erreur.details.map((x) => `${x.champ}:${x.code}`)).toEqual(['nom:OBLIGATOIRE', 'email:OBLIGATOIRE', 'badge:LONGUEUR']);
    const ok = await f.enregistrer('salarie', 1, { jeton: 'j', h: fiche.h, valeurs: { email: 'h@exemple.fr' }, proprietes: { badge: 'B13' }, confidentiel: true });
    expect([ok.valeurs.email, ok.valeurs.salaire, ok.proprietes.badge, ok.proprietes.mutuelle]).toEqual(['h@exemple.fr', 3000, 'B13', 'X']);
    expect((await f.enregistrer('salarie', 1, { jeton: 'j', h: fiche.h, valeurs: { prenom: 'Y' } }).catch((e) => e)).code).toBe('FICHE_MODIFIEE');
  });

  it('création et copie', async () => {
    const f = creer();
    const copie = await f.creer('salarie', { valeurs: { nom: 'Martin', prenom: 'Copie', email: 'c@exemple.fr', salaire: '2500,5' }, confidentiel: true });
    expect([copie.id, copie.valeurs.salaire]).toEqual([2, 2500.5]);
    expect((await f.creer('salarie', { valeurs: { prenom: 'Sans nom' } }).catch((e) => e)).code).toBe('VALIDATION');
  });
});
