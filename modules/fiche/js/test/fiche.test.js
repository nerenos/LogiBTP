import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validerChamp, erreurRequete, FournisseurFicheMemoire, titreFiche } from '../src/index.js';

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

describe('paramétrage étendu : RGPD, groupes, requête SQL, mot de passe', () => {
  const definition = {
    libelle: 'Matériel',
    sections: [{ code: 'general', titre: 'Général', champs: ['nom', 'serie'] }],
    champs: [
      { code: 'nom', libelle: 'Nom', type: 'texte', obligatoire: true },
      { code: 'serie', libelle: 'N° de série', type: 'texte' },
      { code: 'acces', libelle: 'Mot de passe', type: 'motdepasse', longueur: 10 },
    ],
  };
  const creer = (requete = null) => new FournisseurFicheMemoire({
    types: { materiel: { definition, cle: 'id', proprietes: 'proprietes', lignes: [{ id: 1, nom: 'Pelle', serie: 'S-1', acces: 'secret', proprietes: { code: '1234' } }] } },
    droits: ['VOIR', 'MODIFIER', 'CONFIDENTIEL'].map((action) => ({ profil: 'ADMIN', type: 'materiel', action })),
    requete,
  });

  it('requête de liste : SELECT seul', () => {
    expect(erreurRequete('select code, libelle from t;')).toBeNull();
    expect(erreurRequete('WITH x AS (SELECT 1) SELECT * FROM x')).toBeNull();
    expect(erreurRequete('delete from t')).toMatch(/SELECT/);
    expect(erreurRequete('select 1; drop table t')).toMatch(/instruction/);
  });

  it('champ du logiciel rendu confidentiel, groupe et onglet conservés, options de la requête', async () => {
    const f = creer(async (sql) => (sql.includes('agence') ? [['LYO', 'Lyon'], { valeur: 'PAR', libelle: 'Paris' }] : []));
    await f.enregistrerParametrage('materiel', {
      obligatoires: [], confidentiels: ['serie', 'inconnu'],
      supplementaires: [
        { code: 'agence', libelle: 'Agence', type: 'liste', requete: 'SELECT code, nom FROM agence', section: 'general', groupe: ' Rattachement ', ordre: 10 },
        { code: 'code', libelle: 'Code', type: 'motdepasse', section: 'absent', ordre: 20 },
      ],
    });
    const p = await f.parametrage('materiel');
    expect(p.confidentiels).toEqual(['serie']);
    expect(p.supplementaires.map((c) => [c.section, c.groupe])).toEqual([['general', 'Rattachement'], [null, null]]);
    const def = await f.definition('materiel');
    expect(def.champs.find((c) => c.code === 'serie')).toMatchObject({ confidentiel: true, confidentiel_parametre: true });
    expect(def.supplementaires[0].options).toEqual([{ valeur: 'LYO', libelle: 'Lyon' }, { valeur: 'PAR', libelle: 'Paris' }]);
    expect(def.supplementaires[0].requete).toBeUndefined();
    const fiche = await f.charger('materiel', 1);
    expect(fiche.masques).toEqual(['serie']);
    expect((await f.enregistrerParametrage('materiel', { supplementaires: [{ code: 'x', libelle: 'X', type: 'liste', requete: 'update t set a = 1' }] }).catch((e) => e)).code).toBe('REQUETE');
  });

  it('mot de passe : jamais chargé, révélé et journalisé, ressaisi', async () => {
    const f = creer();
    await f.enregistrerParametrage('materiel', { supplementaires: [{ code: 'code', libelle: 'Code', type: 'motdepasse', confidentiel: true }] });
    const fiche = await f.charger('materiel', 1);
    expect([fiche.valeurs.acces, fiche.proprietes.code, fiche.secrets, fiche.masques]).toEqual([null, null, ['acces', '+code'], []]);
    expect(await f.revelerSecret('materiel', 1, 'acces')).toEqual({ valeur: 'secret' });
    expect(await f.revelerSecret('materiel', 1, '+code')).toEqual({ valeur: '1234' });
    expect(f.journal.map((j) => j.champs)).toEqual([['acces'], ['+code']]);
    expect((await f.revelerSecret('materiel', 1, 'nom').catch((e) => e)).code).toBe('CHAMP');
    await f.verrouiller('materiel', 1, { jeton: 'j' });
    const erreur = await f.enregistrer('materiel', 1, { jeton: 'j', h: fiche.h, valeurs: { acces: 'beaucoup-trop-long' } }).catch((e) => e);
    expect(erreur.details.map((x) => x.code)).toEqual(['LONGUEUR']);
    await f.enregistrer('materiel', 1, { jeton: 'j', h: fiche.h, valeurs: { acces: 'nouveau' } });
    expect(await f.revelerSecret('materiel', 1, 'acces')).toEqual({ valeur: 'nouveau' });
  });
});
