import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normaliser, compilerFormule, resolveurColonnes, ModeleVue, FournisseurMemoire, correspond, calculerLargeurs, valeursDistinctes,
} from '../src/index.js';

const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');
const lire = (f) => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));

describe('normalisation (jeu partagé avec f_sans_accent)', () => {
  for (const c of lire('01_normalisation.json').cas) {
    it(c.texte, () => expect(normaliser(c.texte)).toBe(c.attendu));
  }
});

describe('requêtes paginées (jeu partagé avec le serveur)', () => {
  const jeu = lire('02_requete.json');
  const fournisseur = () => new FournisseurMemoire({ sources: { s: jeu.source } });
  const definition = {
    source: { mode: 'vue', vue: 's' },
    colonnes: jeu.source.colonnes.map((c) => ({ code: c.code, recherche: jeu.recherche.includes(c.code) })),
  };

  for (const c of jeu.cas) {
    it(c.nom, async () => {
      const f = fournisseur();
      const demande = { definition: { ...definition, filtres: c.filtres ?? [] }, ...c.requete };
      // Lots de 2 : la concaténation des lots doit donner l'ordre complet.
      const ids = [];
      let apres = null;
      for (let i = 0; i < 20; i++) {
        const r = await f.lot({ ...demande, apres, taille: 2 });
        ids.push(...r.lignes.map((l) => l._id));
        if (!r.suite) break;
        apres = r.suite;
      }
      expect(ids).toEqual(c.attendu);
      // Contrôle jusqu'au curseur de la deuxième ligne : les deux premières lignes, dans l'ordre.
      const premier = await f.lot({ ...demande, taille: 2 });
      if (premier.suite) expect((await f.controle(demande, premier.suite)).map((x) => x.id)).toEqual(c.attendu.slice(0, 2));
    });
  }

  for (const c of jeu.segments) {
    it(`segments : ${c.nom}`, async () => {
      expect(await fournisseur().segments({ definition: { ...definition, filtres: c.filtres ?? [] }, ...c.requete }, c.colonne)).toEqual(c.attendu);
    });
  }

  it('rafraîchissement ciblé et détection des modifications', async () => {
    const f = fournisseur();
    const d = { definition, segments: { ville: ['lyon'] } };
    const avant = await f.controle(d, null);
    f.modifierSource('s', (lignes) => {
      lignes.find((l) => l.id === 1).montant = 999;   // modifiée
      lignes.find((l) => l.id === 3).ville = 'paris'; // sort du segment
      lignes.push({ id: 8, nom: 'Nouveau', ville: 'lyon', service: 'bureau', montant: 1, actif: true }); // entre
    });
    const apres = await f.controle(d, null);
    expect(apres.map((x) => x.id)).toEqual([1, 7, 8]);
    expect(apres.find((x) => x.id === 1).h).not.toBe(avant.find((x) => x.id === 1).h);
    expect(apres.find((x) => x.id === 7).h).toBe(avant.find((x) => x.id === 7).h);
    expect((await f.lignes(d, [1, 3])).map((l) => [l._id, l.montant])).toEqual([[1, 999]]);
  });
});

describe('formules (jeu partagé)', () => {
  const jeu = lire('03_formules.json');
  const resoudre = resolveurColonnes(jeu.colonnes);
  for (const c of jeu.cas) {
    it(c.formule, () => {
      if (c.erreur_compilation) {
        expect(() => compilerFormule(c.formule, resoudre)).toThrow(c.erreur_compilation);
        return;
      }
      const f = compilerFormule(c.formule, resoudre);
      const ctx = { valeur: (code) => jeu.ligne[code] ?? null };
      if (c.erreur) { expect(() => f.evaluer(ctx)).toThrow(c.erreur); return; }
      const v = f.evaluer(ctx);
      expect(typeof v === 'object' && v !== null ? v.toFixed() : v).toEqual(c.attendu);
    });
  }
});

describe('modèle de vue', () => {
  const modele = new ModeleVue({
    colonnes: [
      { code: 'cde', titre: 'Qté\ncommandée', format: 'nombre', decimales: 0 },
      { code: 'liv', titre: 'Qté livrée', format: 'nombre', decimales: 0 },
      { code: 'reste', calcul: true, formule: 'SI [Qté commandée] > [liv] ALORS "Reste à livrer" SINON ""',
        regles: [{ condition: '[reste] <> ""', style: { fond: '#ffe0e0', gras: true } }] },
      { code: 'boucle', calcul: true, formule: '[boucle] + 1' },
      { code: 'etat', format: 'combo', options: [{ valeur: 'P', libelle: 'En panne' }] },
    ],
  });
  const l1 = { cde: 10, liv: 4, etat: 'P' };
  const l2 = { cde: 3, liv: 3, etat: 'X' };

  it('colonne calculée, titre multiligne et règle de mise en forme', () => {
    expect(modele.valeur(l1, 'reste')).toBe('Reste à livrer');
    expect(modele.valeur(l2, 'reste')).toBe('');
    expect(modele.style(l1, 'reste')).toMatchObject({ fond: '#ffe0e0', gras: true });
    expect(modele.style(l2, 'reste').fond).toBeNull();
  });

  it('référence circulaire signalée sans boucler', () => {
    expect(modele.valeur(l1, 'boucle')).toBe('#ERREUR');
  });

  it('texte affiché des combos et filtres façon tableur', () => {
    const etat = modele.parCode.get('etat');
    expect(modele.texteCellule(l1, etat)).toBe('En panne');
    expect(valeursDistinctes([l1, l2, l1], etat, modele)).toEqual([
      { texte: 'En panne', valeur: 'P', nombre: 2 }, { texte: 'X', valeur: 'X', nombre: 1 },
    ]);
    const cde = modele.parCode.get('cde');
    const cellule = (l, c) => ({ valeur: modele.valeur(l, c.code), texte: modele.texteCellule(l, c), style: modele.style(l, c.code) });
    expect(correspond({ condition: { op: '>', a: '5' } }, cellule(l1, cde), cde)).toBe(true);
    expect(correspond({ condition: { op: 'entre', a: '4', b: '8' } }, cellule(l1, cde), cde)).toBe(false);
    expect(correspond({ valeurs: new Set(['En panne']) }, cellule(l2, etat), etat)).toBe(false);
    const reste = modele.parCode.get('reste');
    expect(correspond({ format: { fond: '#ffe0e0' } }, cellule(l1, reste), reste)).toBe(true);
    expect(correspond({ format: { gras: true } }, cellule(l2, reste), reste)).toBe(false);
  });
});

describe('largeurs', () => {
  it('fixe, proportionnelle et bornes', () => {
    const cols = [
      { largeur: { mode: 'fixe', valeur: 100 } },
      { largeur: { mode: 'proportionnel', valeur: 2 } },
      { largeur: { mode: 'proportionnel', valeur: 1, max: 80 } },
      { largeur: { mode: 'auto' } },
    ];
    // 600 - 100 = 500 ; poids 2/1/1 → 250/125/125, la 3e bornée à 80 → 420 restants pour poids 3 → 280/140.
    expect(calculerLargeurs(cols, 600)).toEqual([100, 280, 80, 140]);
  });
});
