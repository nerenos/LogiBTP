import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as m from '../ui/modeles.js';
import { CONNECTEUR_FE, ETAT_FLUX, SENS_FLUX, STATUT_CDV, EVENEMENT_FE, ACTEUR_FE, TYPE_DOCUMENT_FLUX, ETAT_ACCUSE, MOTIF_ACCUSE } from '../src/index.js';
import {
  controlerParametres, adresseValable, parametresPourEdition, corpsParametres, parametresModifies, dureeMs, requeteFlux, filtresValables,
  filtrerParStatut, pageSuivante, ajouterPage, graviteEtat, graviteStatut, actionsFlux, depotsEnAttente, documentsFlux, tailleKo, grouperParJour,
  natureEtat, transition, classeEvenement, champsDetail, empreinteCourte, base64, corpsConfirmation, FILTRES_VIDES,
} from '../ui/modeles.js';
import { libelleEtat, chronologieHtml } from '../ui/chronologie.js';

// Jeu partagé avec ReglesParametresFe.cs (LogiBTP.FactureElectronique.Tests).
const jeu = JSON.parse(fs.readFileSync(new URL('../../tests/cas/02_parametres.json', import.meta.url), 'utf8'));

describe('paramètres (jeu partagé avec le C#)', () => {
  for (const c of jeu.cas) {
    it(c.nom, () => expect(controlerParametres({ ...jeu.base, ...c.modif }, jeu.connecteurs)).toEqual(c.attendu));
  }
  it('adresses', () => {
    expect(adresseValable(null)).toBe(true);
    expect(adresseValable('https://pa.fr')).toBe(true);
    expect(adresseValable('mailto:a@b.fr')).toBe(false);
  });
  it('édition, corps et modification', () => {
    const p = parametresPourEdition({ connecteur: CONNECTEUR_FE.AFNOR, connecteurs: ['AFNOR'], organisation: undefined });
    expect(p.connecteur).toBe('AFNOR');
    expect(p.organisation).toBeNull();
    expect(corpsParametres(p)).not.toHaveProperty('connecteurs');
    expect(parametresModifies(p, { ...p, connecteurs: [] })).toBe(false);
    expect(parametresModifies({ ...p, frequence_releve: 20 }, p)).toBe(true);
  });
  it('durée de l\'essai de santé', () => {
    expect(dureeMs('00:00:00.1234567')).toBe(123);
    expect(dureeMs('1.00:00:01')).toBe(86_401_000);
    expect(dureeMs('n/a')).toBeNull();
  });
});

const flux = (o) => ({ id: 1, sens: SENS_FLUX.SORTANT, connecteur: CONNECTEUR_FE.SIMULE, etat: ETAT_FLUX.ACQUITTE, id_flux: 'F1', nom: 'f.xml', ...o });

describe('tableau des flux', () => {
  it('requête du serveur', () => {
    expect(requeteFlux(FILTRES_VIDES)).toBe('limite=50');
    expect(requeteFlux({ sens: 'Out', etat: 'ERREUR', statut: '205', erreurs: 'true', du: '2026-11-01', au: '2026-11-10', inconnu: 'x' }, { avant: 120, limite: 10 }))
      .toBe('sens=Out&etat=ERREUR&erreurs=true&du=2026-11-01&au=2026-11-10&avant=120&limite=10');
    expect(filtresValables({ sens: 'In', etat: 3 })).toEqual({ ...FILTRES_VIDES, sens: 'In' });
    expect(filtresValables(null)).toEqual(FILTRES_VIDES);
  });
  it('statut affiché, pages', () => {
    const l = [flux({ id: 3, statut_affiche: '205' }), flux({ id: 2, statut_affiche: '200' }), flux({ id: 1 })];
    expect(filtrerParStatut(l, '205').map((x) => x.id)).toEqual([3]);
    expect(filtrerParStatut(l, '')).toHaveLength(3);
    expect(pageSuivante(l, 3)).toBe(1);
    expect(pageSuivante(l, 4)).toBeNull();
    expect(ajouterPage(l, [flux({ id: 1 }), flux({ id: 0 })]).map((x) => x.id)).toEqual([3, 2, 1, 0]);
  });
  it('gravités', () => {
    expect(graviteEtat(ETAT_FLUX.ERREUR)).toBe('erreur');
    expect(graviteEtat(ETAT_FLUX.ENVOYE)).toBe('attente');
    expect(graviteEtat(ETAT_FLUX.TRAITE)).toBe('succes');
    expect(graviteEtat(ETAT_FLUX.ABANDONNE)).toBe('neutre');
    expect(graviteStatut(STATUT_CDV.REJETEE)).toBe('erreur');
    expect(graviteStatut(STATUT_CDV.EN_LITIGE)).toBe('attente');
    expect(graviteStatut(STATUT_CDV.ENCAISSEE)).toBe('succes');
    expect(graviteStatut(STATUT_CDV.DEPOSEE)).toBe('neutre');
    expect(graviteStatut(null)).toBe('');
  });
  it('actions permises comme le serveur', () => {
    expect(actionsFlux(flux({ etat: ETAT_FLUX.ERREUR })).tentative).toBe(true);
    expect(actionsFlux(flux({ etat: ETAT_FLUX.A_ENVOYER })).tentative).toBe(true);
    expect(actionsFlux(flux({ etat: ETAT_FLUX.ERREUR, sens: SENS_FLUX.ENTRANT })).tentative).toBe(false);
    expect(actionsFlux(flux({ etat: ETAT_FLUX.ACQUITTE }))).toEqual({ tentative: false, confirmerDepot: false, aDeposer: false });
    const manuel = flux({ connecteur: CONNECTEUR_FE.MANUEL, etat: ETAT_FLUX.ENVOYE });
    expect(actionsFlux(manuel)).toEqual({ tentative: false, confirmerDepot: true, aDeposer: true });
    expect(actionsFlux({ ...manuel, id_flux: null }).confirmerDepot).toBe(false);
    expect(depotsEnAttente([manuel, flux({ id: 2 })])).toEqual([manuel]);
  });
  it('documents proposés', () => {
    const fichiers = [{ document: TYPE_DOCUMENT_FLUX.ORIGINAL, nom: 'f.xml', taille: 2048 }];
    expect(documentsFlux(flux(), fichiers).map((d) => d.document)).toEqual(['Original', 'Converted', 'ReadableView']);
    expect(documentsFlux(flux({ connecteur: CONNECTEUR_FE.MANUEL }), fichiers).map((d) => d.document)).toEqual(['Original']);
    expect(documentsFlux(flux({ id_flux: null }), [...fichiers, { document: TYPE_DOCUMENT_FLUX.LISIBLE }]).map((d) => d.document)).toEqual(['Original', 'ReadableView']);
    expect(documentsFlux(flux(), fichiers)[0].fichier.nom).toBe('f.xml');
    expect(tailleKo(2048)).toBe(2);
    expect(tailleKo(10)).toBe(0.1);
  });
});

const ev = (rang, o = {}) => ({ id: rang, rang, flux_id: 9, type: EVENEMENT_FE.DEPOT, acteur: ACTEUR_FE.SYSTEME, etat_avant: null, etat_apres: null,
  horodatage: `2026-11-${o.jour ?? '10'}T12:00:0${rang % 10}.000Z`, empreinte: 'a'.repeat(64), detail: null, ...o });

describe('chronologie', () => {
  it('par jour et par rang', () => {
    const j = grouperParJour([ev(3, { jour: '11' }), ev(1), ev(2)]);
    expect(j.map((x) => [x.jour, x.evenements.map((e) => e.rang)])).toEqual([['2026-11-10', [1, 2]], ['2026-11-11', [3]]]);
    expect(grouperParJour()).toEqual([]);
  });
  it('états, transitions, classes', () => {
    expect(natureEtat(ETAT_FLUX.ENVOYE)).toBe('etat');
    expect(natureEtat(STATUT_CDV.APPROUVEE)).toBe('statut');
    expect(natureEtat('X')).toBe('autre');
    expect(transition(ev(1, { etat_avant: 'A_ENVOYER', etat_apres: 'ENVOYE' }))).toEqual({ avant: 'A_ENVOYER', apres: 'ENVOYE', change: true });
    expect(transition(ev(1)).change).toBe(false);
    expect(classeEvenement(ev(1, { type: EVENEMENT_FE.ERREUR, acteur: ACTEUR_FE.PLATEFORME }))).toBe('erreur');
    expect(classeEvenement(ev(1, { acteur: ACTEUR_FE.PLATEFORME }))).toBe('plateforme');
    expect(classeEvenement(ev(1, { acteur: ACTEUR_FE.UTILISATEUR }))).toBe('utilisateur');
    expect(classeEvenement(ev(1))).toBe('systeme');
    expect(libelleEtat('ENVOYE')).toBe('Envoyé');
    expect(libelleEtat('205')).toBe('205 Approuvée');
    expect(libelleEtat(null)).toBe('');
  });
  it('détail à plat et empreinte', () => {
    expect(champsDetail({ code: 'X', essai: 2, vide: null, details: [{ niveau: 'Error', message: 'm' }], codes: ['a', 'b'], sous: { id_flux: 'F' } })).toEqual([
      ['code', 'X'], ['essai', '2'], ['details[1].niveau', 'Error'], ['details[1].message', 'm'], ['codes', 'a, b'], ['sous.id_flux', 'F']]);
    expect(champsDetail(null)).toEqual([]);
    expect(champsDetail([{ niveau: 'Error' }, { motif: 'X' }])).toEqual([['1.niveau', 'Error'], ['2.motif', 'X']]);
    expect(empreinteCourte('0123456789abcdef')).toBe('0123456789ab');
  });
  it('HTML de la chronologie : jours, étapes, transitions, détail échappé', () => {
    const html = chronologieHtml([ev(1, { type: EVENEMENT_FE.PRODUCTION, etat_apres: 'A_ENVOYER' }),
      ev(2, { etat_avant: 'A_ENVOYER', etat_apres: 'ENVOYE', detail: { message: '<b>x</b>' } }),
      ev(3, { type: EVENEMENT_FE.STATUT_RECU, acteur: ACTEUR_FE.PLATEFORME, etat_avant: '200', etat_apres: '205', jour: '11' })], { details: true });
    expect(html.match(/class="fe-chrono-jour"/g)).toHaveLength(2);
    expect(html.match(/<li class="fe-etape/g)).toHaveLength(3);
    expect(html).toContain('205 Approuvée');
    expect(html).toContain('fe-etape-plateforme');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
    expect(chronologieHtml([])).toContain(new RegExp('Aucune').source);
  });
});

describe('dépôt et import manuels', () => {
  it('base 64', () => {
    expect(base64(new TextEncoder().encode('<x/>'))).toBe('PHgvPg==');
    expect(base64(new Uint8Array(100_000).fill(65)).length).toBe(133_336);
  });
  it('corps de la confirmation', () => {
    expect(corpsConfirmation({ etat: ETAT_ACCUSE.OK, motif: MOTIF_ACCUSE.VIRUS, message: 'm' })).toEqual({ etat: 'Ok' });
    expect(corpsConfirmation({ etat: ETAT_ACCUSE.ERREUR, motif: MOTIF_ACCUSE.SCHEMA_INVALIDE, message: '  ' })).toEqual({ etat: 'Error', motif: 'InvalidSchema', message: null });
  });
});

describe('statuts posés (lot 13)', () => {
  it('boutons proposés selon l\'historique : refus impossible après Approuvée, rien après Refusée', () => {
    const codes = ['207', '210'];
    expect(m.statutsProposes('In', ['204'], codes)).toEqual(['207', '210']);
    expect(m.statutsProposes('In', ['204', '207'], codes)).toEqual(['207', '210']);
    expect(m.statutsProposes('In', ['204', '205'], codes)).toEqual(['207']);
    expect(m.statutsProposes('In', ['204', '210'], codes)).toEqual([]);
    expect(m.historiqueStatuts({ statuts: [{ code: '204' }, { code: '205' }] })).toEqual(['204', '205']);
  });
  it('motifs de la liste autorisée et demande valable', () => {
    const { motifs, obligatoire } = m.motifsProposes('In', '210');
    expect(obligatoire).toBe(true);
    expect(motifs).toContain('DOUBLON');
    expect(motifs).not.toContain('RETRAIT_MAN_SERV');
    expect(m.demandeStatutValable('In', { code: '210' })).toBe(false);
    expect(m.demandeStatutValable('In', { code: '210', motif: 'DOUBLON' })).toBe(true);
    expect(m.demandeStatutValable('In', { code: '207', motif: 'REJ_SEMAN' })).toBe(false);
    expect(m.demandeStatutValable('In', { code: '204' })).toBe(true);
    expect(m.demandeStatutValable('In', { code: '207', motif: 'QTE_ERR', commentaire: 'x'.repeat(501) })).toBe(false);
  });
  it('statuts paramétrables : posés par la société, hors ceux qu\'exige le PPF', () => {
    expect(m.STATUTS_PARAMETRABLES).toEqual(expect.arrayContaining(['204', '205', '207', '211']));
    expect(m.STATUTS_PARAMETRABLES).not.toContain('210');
    expect(m.STATUTS_PARAMETRABLES).not.toContain('212');
    expect(m.STATUTS_PARAMETRABLES).not.toContain('200');
    expect(m.basculerStatutEnvoye(['211'], '204', false)).toEqual(['204', '211']);
    expect(m.basculerStatutEnvoye(['204', '211'], '204', true)).toEqual(['211']);
  });
});
