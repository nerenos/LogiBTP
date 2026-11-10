import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { texte, existe, icone } from '@logibtp/socle/dictionnaire';
import {
  ETAT_FLUX, STATUT_CDV, EVENEMENT_FE, ACTEUR_FE, SENS_FLUX, SENS_STATUT, CONNECTEUR_FE, DECOUPAGE_EREPORTING, ETAT_ACCUSE, MOTIF_ACCUSE,
  TYPE_FLUX, TYPE_DOCUMENT_FLUX, EMETTEUR_STATUT, ACTION_CDV, SYNTAXE, PROFIL_FACTURE,
} from '../src/index.js';
import { controlerParametres, parametresPourEdition } from '../ui/modeles.js';

const dossier = new URL('../ui/', import.meta.url);
const lireDossier = (d) => readdirSync(d).filter((f) => f.endsWith('.js') && f !== 'vite.config.js').map((f) => [f, readFileSync(new URL(f, d), 'utf8')]);
// Écrans du module et page de démonstration.
const sources = [...lireDossier(dossier), ...lireDossier(new URL('../demo/', import.meta.url))];
const css = readFileSync(new URL('facture-electronique.css', dossier), 'utf8');

describe('textes, icônes et conventions des écrans', () => {
  it('toute clé de texte statique existe dans le dictionnaire', () => {
    let n = 0;
    for (const [f, s] of sources) {
      for (const m of s.matchAll(/\b(?:texte|texteHtml)\('([a-z_.]+)'/g)) { expect(existe(m[1]), `${f} : ${m[1]}`).toBe(true); n++; }
    }
    expect(n).toBeGreaterThan(80);
  });
  it('toute icône utilisée existe', () => {
    for (const [f, s] of sources) {
      for (const m of s.matchAll(/'(fe_[a-z_]+)'/g)) expect(icone(m[1]), `${f} : ${m[1]}`).not.toBe('');
    }
    for (const t of Object.values(EVENEMENT_FE)) expect(icone(`fe_evenement_${t.toLowerCase()}`), t).not.toBe('');
    for (const a of Object.values(ACTEUR_FE)) expect(icone(`fe_acteur_${a.toLowerCase()}`), a).not.toBe('');
  });
  it('les textes composés par code existent pour chaque code', () => {
    const par = (prefixe, codes) => { for (const c of codes) expect(existe(`facture_electronique.${prefixe}.${c}`), `${prefixe}.${c}`).toBe(true); };
    par('etats', Object.values(ETAT_FLUX));
    par('statuts', Object.values(STATUT_CDV));
    par('evenements', Object.values(EVENEMENT_FE));
    par('acteurs', Object.values(ACTEUR_FE));
    par('sens', Object.values(SENS_FLUX));
    par('sens_statut', Object.values(SENS_STATUT));
    par('connecteurs', Object.values(CONNECTEUR_FE));
    par('decoupages', Object.values(DECOUPAGE_EREPORTING));
    par('accuses', Object.values(ETAT_ACCUSE));
    par('motifs_accuse', Object.values(MOTIF_ACCUSE));
    par('types', Object.values(TYPE_FLUX));
    par('documents', Object.values(TYPE_DOCUMENT_FLUX));
    par('emetteurs', Object.values(EMETTEUR_STATUT));
    par('actions_cdv', Object.values(ACTION_CDV));
    par('syntaxes', Object.values(SYNTAXE));
    par('profils', Object.values(PROFIL_FACTURE));
    // Une erreur de chaque champ des paramètres (tout faux).
    const faux = controlerParametres({ ...parametresPourEdition(), connecteur: 'X', adresse_flux: 'x', adresse_annuaire: 'x', organisation: 'x'.repeat(65),
      syntaxe: 'X', profil: 'X', frequence_releve: 0, delai_secondes: 0, decoupage_ereporting: 'X' });
    expect(faux.length).toBe(9);
    par('parametres.erreurs', [...faux, 'connexion_oauth']);
    par('parametres.champs', Object.keys(parametresPourEdition()));
    par('colonnes', ['sens', 'type', 'numero', 'nom', 'etat', 'statut', 'element', 'essais', 'cree_le', 'erreur']);
    par('detail.colonnes', ['document', 'nom', 'taille', 'empreinte', 'statut', 'sens', 'emetteur', 'motif', 'action', 'montant', 'date', 'cdar', 'essai', 'code', 'niveau', 'element', 'message', 'http', 'request_id']);
    par('detail.champs', ['sens', 'type', 'syntaxe', 'profil', 'regle', 'numero', 'nom', 'connecteur', 'id_suivi', 'id_flux', 'accuse', 'essais', 'prochain_essai', 'depose_le', 'modifie_pa_le', 'cree_le', 'empreinte', 'element']);
    expect(texte('facture_electronique.statut_code', { code: '205', libelle: texte('facture_electronique.statuts.205') })).toBe('205 Approuvée');
  });
  it('aucune fenêtre, liste ou touche en dur, aucune couleur hors du thème', () => {
    for (const [f, s] of sources) {
      expect(s, f).not.toMatch(/\b(?:window\.)?(?:confirm|alert|prompt)\(/);
      expect(s, f).not.toMatch(/<select|createElement\('select'\)/);
      expect(s, f).not.toMatch(/e\.key\s*===|\.keyCode/);
      expect(s, f).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
      expect(s, f).not.toMatch(/localStorage|sessionStorage/);
    }
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });
});
