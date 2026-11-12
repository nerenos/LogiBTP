import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { D, S } from '@logibtp/socle';
import { existe, texte } from '@logibtp/socle/dictionnaire';
import { concerneEncaissement, partServices, proposerEncaissements } from '../src/calcul/encaissement-fe.js';
import { encaissementsFeHtml, selectionEncaissees, ventilationEncaisseeTexte } from '../src/app/facture-electronique/encaissements-fe.js';

// Jeu partagé avec src/LogiBTP.Calcul/EncaissementFeBtp.cs (tests/LogiBTP.Calcul.Tests/EncaissementFeTests.cs), lot 26.
const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/emission-fe');
const j = JSON.parse(fs.readFileSync(path.join(dossier, '03_encaissement.json'), 'utf8'));
const n = (v) => S(D(v));
const normaliser = (props) => props.map((p) => ({
  ...p, montant: n(p.montant), encaissements: p.encaissements.map((e) => ({ taux: n(e.taux), montant: n(e.montant) })),
}));

describe('statut Encaissée (jeu 03_encaissement.json)', () => {
  it.each(j.concerne.map((c) => [`${c.cadre} ${c.code_exigibilite}`, c]))('concernée : %s', (_, c) => {
    expect(concerneEncaissement(c.cadre, c.code_exigibilite)).toBe(c.attendu);
  });

  it.each(j.part_services.map((c) => [c.nom, c]))('part des services : %s', (_, c) => {
    const r = partServices(c.lignes, j.natures_fe);
    expect({ services: n(r.services), total: n(r.total) }).toEqual({ services: n(c.attendu.services), total: n(c.attendu.total) });
  });

  it.each(j.cas.map((c) => [c.nom, c]))('%s', (_, c) => {
    expect(normaliser(proposerEncaissements(c.entree))).toEqual(normaliser(c.attendu));
  });

  it('versements d\'une situation : la somme par taux égale le TTC du taux', () => {
    const c = j.cas[0];
    const total = new Map();
    for (const p of proposerEncaissements(c.entree)) {
      for (const e of p.encaissements) total.set(e.taux, (total.get(e.taux) ?? D(0)).plus(D(e.montant)));
    }
    for (const v of c.entree.ventilation) expect(S(total.get(n(v.taux)))).toBe(n(v.montant));
  });
});

describe('liste à valider des statuts Encaissée (onglet Encaissements)', () => {
  const propositions = [
    { cle: '1:2:3', ent_id: 1, numero: 'F-1', tiers: 'Client', date_reglement: '2026-11-10', mode: 'VIREMENT', montant: 100, annulation: false,
      reglement_supprime: false, encaissements: [{ taux: 20, montant: 62.07 }, { taux: 10, montant: 37.93 }] },
    { cle: '1:4:3', ent_id: 1, numero: 'F-1', tiers: 'Client', montant: -175.5, annulation: true, reglement_supprime: true,
      encaissements: [{ taux: 20, montant: -108.93 }] },
  ];

  it('textes et icônes déclarés', () => {
    for (const c of ['aide', 'aucune', 'taux', 'separateur', 'sans_montant', 'reglement_supprime', 'annulation', 'envoyer', 'ecarter',
      'confirmer_envoyer', 'confirmer_ecarter', 'resultat', 'perimees', 'erreur', 'colonnes.piece', 'colonnes.encaisse']) {
      expect(existe(`facture_electronique_btp.encaissements.${c}`), c).toBe(true);
    }
    expect(existe('facture_electronique_btp.onglets.encaissements')).toBe(true);
  });

  it('montants par taux, cases cochées et annulation signalée', () => {
    expect(ventilationEncaisseeTexte(propositions[0].encaissements)).toContain('62');
    expect(ventilationEncaisseeTexte([])).toBe(texte('facture_electronique_btp.encaissements.sans_montant'));
    const html = encaissementsFeHtml(propositions, { peutModifier: true });
    expect(html.match(/data-encaissement=/g)).toHaveLength(2);
    expect(html.match(/data-annulation/g)).toHaveLength(1);
    expect(encaissementsFeHtml(propositions)).not.toContain('data-encaissement=');
    expect(encaissementsFeHtml([])).toContain('data-encaissements-vide');
  });

  it('sélection : clé et montant lus des seules lignes cochées', () => {
    expect(selectionEncaissees(propositions, ['1:4:3'])).toEqual([{ cle: '1:4:3', montant: -175.5 }]);
  });
});
