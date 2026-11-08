import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normaliser, compilerFormule, resolveurColonnes, ModeleVue, FournisseurMemoire, correspond, calculerLargeurs, valeursDistinctes, bornesPeriode, resoudrePeriodes,
  filtreVuePeriode, libellePeriode, TEINTES_PASTILLE, resoudrePeriodes, PERIODE, OPERATEURS_DATE,
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
  // Thème « t » portant les types d'élément du cas (vide = tous).
  const fournisseur = (types = []) => new FournisseurMemoire({
    sources: { s: jeu.source }, themes: [{ thl_code: 't', thl_libelle: 'Test', thl_types: types.map((code) => ({ code })) }],
  });
  const definition = {
    source: { mode: 'vue', vue: 's' },
    colonnes: jeu.source.colonnes.map((c) => ({ code: c.code, recherche: jeu.recherche.includes(c.code) })),
  };

  for (const c of jeu.cas) {
    it(c.nom, async () => {
      const f = fournisseur(c.types);
      const demande = { definition: { ...definition, filtres: c.filtres ?? [], theme: 't' }, ...c.requete, reference: c.reference, debut_exercice: c.debut_exercice };
      if (c.erreur) {
        await expect(f.lot({ ...demande, taille: 2 })).rejects.toMatchObject({ code: c.erreur });
        return;
      }
      if (c.bornes) {
        const types = new Map(jeu.source.colonnes.map((x) => [x.code, x.type]));
        const [resolu] = resoudrePeriodes(c.filtres, types, { reference: c.reference, debutExercice: c.debut_exercice ?? null });
        expect([resolu.bornes.debut, resolu.bornes.fin]).toEqual(c.bornes);
      }
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
      expect(await fournisseur(c.types).segments({ definition: { ...definition, filtres: c.filtres ?? [], theme: 't' }, ...c.requete }, c.colonne)).toEqual(c.attendu);
    });
  }

  for (const c of jeu.agregats) {
    it(`agrégats : ${c.nom}`, async () => {
      const demande = { definition: { ...definition, theme: 't' }, ...c.requete, reference: c.reference, agregats: c.agregats };
      if (c.erreur) {
        await expect(fournisseur().agregats(demande)).rejects.toMatchObject({ code: c.erreur });
        return;
      }
      const r = await fournisseur().agregats(demande);
      for (const [code, v] of Object.entries(c.attendu)) {
        if (v === null) expect(r[code], code).toBeNull();
        else expect(r[code], code).toBeCloseTo(v, 8);
      }
    });
  }

  it('saisie dans la liste : colonnes autorisées, conversion, conflit', async () => {
    const source = structuredClone(jeu.source);
    source.modifiable = true;
    source.colonnes = source.colonnes.map((c) => ({ ...c, modifiable: c.code !== 'id' && c.code !== 'type_element' }));
    const f = new FournisseurMemoire({ sources: { s: source } });
    const def = { ...definition, colonnes: definition.colonnes.map((c) => ({ ...c, modifiable: ['nom', 'montant', 'actif'].includes(c.code) })) };
    const d = { definition: def };
    const [l1] = await f.lignes(d, [1]);
    const apres = await f.modifier(d, 1, l1._h, { montant: '99,5', actif: false, nom: '' });
    expect([apres.montant, apres.actif, apres.nom]).toEqual([99.5, false, null]);
    expect(apres._h).not.toBe(l1._h);
    // Empreinte périmée : conflit, la ligne actuelle est renvoyée.
    const conflit = await f.modifier(d, 1, l1._h, { montant: 1 }).catch((e) => e);
    expect([conflit.statut, conflit.code, conflit.details?.montant]).toEqual([409, 'LIGNE_MODIFIEE', 99.5]);
    // Colonne non saisissable dans la vue, ou non modifiable dans la source.
    expect((await f.modifier(d, 1, null, { ville: 'x' }).catch((e) => e)).code).toBe('COLONNE_NON_MODIFIABLE');
    expect((await f.modifier({ definition: { ...def, colonnes: [...def.colonnes, { code: 'id', modifiable: true }] } }, 1, null, { id: 9 }).catch((e) => e)).code)
      .toBe('COLONNE_NON_MODIFIABLE');
    expect((await f.modifier(d, 1, null, { montant: 'abc' }).catch((e) => e)).code).toBe('VALEUR');
  });

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

describe('périodes glissantes (jeu partagé)', () => {
  for (const c of lire('04_periodes.json').cas) {
    it(c.nom, () => {
      const appel = () => bornesPeriode(c.code, c.x ?? null, c.reference, c.debut_exercice ?? null);
      if (c.erreur) { expect(appel).toThrow(expect.objectContaining({ code: c.erreur })); return; }
      expect(appel()).toEqual({ debut: c.debut, fin: c.fin });
    });
  }
});

describe('période choisie dans le filtre de colonne', () => {
  it('une vue enregistrée garde le code de la période, pas des dates', () => {
    const f = filtreVuePeriode('date_pose', PERIODE.MOIS_EN_COURS);
    expect(f).toEqual({ colonne: 'date_pose', op: 'periode', valeur: 'mois_en_cours' });
    expect(JSON.stringify(f)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const [resolu] = resoudrePeriodes([f], new Map([['date_pose', 'date']]), { reference: '2026-11-08' });
    expect(resolu.bornes).toEqual({ debut: '2026-11-01', fin: '2026-11-30' });
  });

  it('période paramétrée : nombre x gardé, saisie invalide ignorée', () => {
    expect(filtreVuePeriode('d', PERIODE.DERNIERS_JOURS, '30')).toMatchObject({ valeur: 'derniers_jours', nombre: 30 });
    expect(filtreVuePeriode('d', PERIODE.DERNIERS_JOURS, '2,5')).not.toHaveProperty('nombre');
    expect(libellePeriode(PERIODE.DERNIERS_JOURS, 30)).toContain('30');
  });

  it('condition de colonne « dans la période » sur les lignes chargées', () => {
    const colonne = { code: 'd', format: 'date' };
    const cellule = (v) => ({ valeur: v, texte: v, style: {} });
    const filtre = { condition: { op: 'periode', a: 'mois_en_cours', b: '' } };
    expect(OPERATEURS_DATE.map(([c]) => c)).toContain('periode');
    expect(correspond(filtre, cellule('2026-11-03'), colonne, '2026-11-08')).toBe(true);
    expect(correspond(filtre, cellule('2026-10-31'), colonne, '2026-11-08')).toBe(false);
    expect(correspond({ condition: { op: 'periode', a: 'derniers_jours', b: '' } }, cellule('2026-11-08'), colonne, '2026-11-08')).toBe(false);
    expect(correspond({ condition: { op: 'periode', a: 'derniers_jours', b: '3' } }, cellule('2026-11-06'), colonne, '2026-11-08')).toBe(true);
  });
});

describe('exercice comptable fourni aux périodes', () => {
  const colonne = { format: 'date' };
  const cellule = (v) => ({ valeur: v, texte: v });
  const filtre = { condition: { op: 'periode', a: 'exercice_en_cours' } };

  it('filtre de colonne : exercice décalé ou année civile', () => {
    expect(correspond(filtre, cellule('2026-08-15'), colonne, '2026-11-08', '2000-07-01')).toBe(true);
    expect(correspond(filtre, cellule('2026-03-15'), colonne, '2026-11-08', '2000-07-01')).toBe(false);
    expect(correspond(filtre, cellule('2026-03-15'), colonne, '2026-11-08', null)).toBe(true);
  });

  it('fournisseur : contexte de la société et filtre de vue', async () => {
    const f = new FournisseurMemoire({ sources: { s: { ...structuredClone(lire('02_requete.json').source) } }, debutExercice: '2000-07-01' });
    expect(await f.contexteSociete()).toEqual({ debut_exercice: '2000-07-01' });
    expect(await new FournisseurMemoire({}).contexteSociete()).toEqual({ debut_exercice: null });
  });
});

describe('teintes de pastille (P1)', () => {
  const fr = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../personnalisation/fr.json'), 'utf8'));
  it('chaque teinte a un nom de couleur au dictionnaire', () => {
    for (const t of TEINTES_PASTILLE) expect(fr.liste.concepteur.teintes[t], t).toBeTruthy();
  });
  it('codes inchangés', () => {
    expect(TEINTES_PASTILLE).toEqual(['neutre', 'info', 'envoye', 'succes', 'attention', 'erreur', 'termine', 'barre']);
  });
});
