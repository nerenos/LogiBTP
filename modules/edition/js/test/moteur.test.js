import { describe, it, expect, beforeAll } from 'vitest';
import { polices } from './aide.js';
import {
  mettreEnLignes, evaluerFormule, verifierFormule, formaterNombre, lireHtml, code39, matriceQr, lireImage,
  editer, produirePdf, verifierModele, dependances, chercherCycle, resoudreStyle, completerCharte, base64VersOctets, octetsVersBase64,
} from '../src/index.js';

let p;
beforeAll(async () => { p = await polices(); });

const largeur = (t, s = {}) => p.largeur(t, { police: 'Inter', taille: 10, ...s });

describe('polices et mise en ligne', () => {
  it('mesure sans crénage : la largeur d’un texte est la somme de ses caractères', () => {
    expect(largeur('AV')).toBeCloseTo(largeur('A') + largeur('V'), 10);
    expect(largeur('abc', { taille: 20 })).toBeCloseTo(2 * largeur('abc'), 10);
  });
  it('chiffres tabulaires de même largeur', () => {
    expect(largeur('1', { tnum: true })).toBeCloseTo(largeur('8', { tnum: true }), 10);
    expect(largeur('1')).not.toBeCloseTo(largeur('8'), 3);
  });
  it('gras plus large que normal ; face la plus proche', () => {
    expect(largeur('Bonjour', { graisse: 700 })).toBeGreaterThan(largeur('Bonjour'));
    expect(p.face({ police: 'Inter', graisse: 650 }).graisse).toBe(600);
  });
  it('coupure aux espaces, saut de ligne, mot trop long coupé', () => {
    const seg = [{ texte: 'un deux trois quatre cinq six sept huit neuf dix', style: { taille: 10 } }];
    const r = mettreEnLignes(seg, 30, p);
    expect(r.lignes.length).toBeGreaterThan(1);
    for (const l of r.lignes) expect(l.largeur).toBeLessThanOrEqual(30.001);
    expect(mettreEnLignes([{ texte: 'a\nb', style: {} }], 100, p).lignes.length).toBe(2);
    const long = mettreEnLignes([{ texte: 'x'.repeat(200), style: {} }], 20, p);
    expect(long.lignes.length).toBeGreaterThan(5);
  });
  it('ellipse sur une ligne, justification, alignement à droite', () => {
    const r = mettreEnLignes([{ texte: 'Désignation beaucoup trop longue pour la colonne', style: {} }], 20, p, { retour: 'aucun', ellipse: true });
    expect(r.lignes).toHaveLength(1);
    expect(r.lignes[0].morceaux.at(-1).texte.endsWith('…')).toBe(true);
    const d = mettreEnLignes([{ texte: '12,50', style: {} }], 30, p, { alignement: 'droite' });
    expect(d.lignes[0].morceaux[0].x + d.lignes[0].morceaux[0].largeur).toBeCloseTo(30, 5);
    const j = mettreEnLignes([{ texte: 'mot '.repeat(30), style: {} }], 40, p, { alignement: 'justifie' });
    const premiere = j.lignes[0].morceaux;
    expect(premiere.at(-1).x + premiere.at(-1).largeur).toBeCloseTo(40, 3);
  });
  it('retrait suspendu : lignes suivantes alignées après le libellé', () => {
    const r = mettreEnLignes([{ texte: 'Désignation : ', style: { graisse: 700 } }, { texte: 'texte '.repeat(20), style: {} }], 50, p, { retraitSuivantes: 25 });
    expect(r.lignes[1].morceaux[0].x).toBeCloseTo(25, 5);
  });
});

describe('formules', () => {
  const ctx = { resoudre: (c) => ({ a: '12.5', b: 2, nom: 'Durand', vide: null, liste: [{ m: '1.5' }, { m: '2' }] })[c] ?? null };
  it('arithmétique décimale exacte, concaténation, comparaisons', () => {
    expect(evaluerFormule('=a * b + 0,1', ctx).toString()).toBe('25.1');
    expect(evaluerFormule('={{a}} / 4', ctx).toString()).toBe('3.125');
    expect(evaluerFormule('=nom & " !"', ctx)).toBe('Durand !');
    expect(evaluerFormule('=a > b ET NON EstVide(nom)', ctx)).toBe(true);
    expect(evaluerFormule('=Si(vide; "x"; "y")', ctx)).toBe('y');
  });
  it('gabarit à variables et texte brut', () => {
    expect(evaluerFormule('Client : {{nom}}', ctx)).toBe('Client : Durand');
    expect(evaluerFormule('Texte simple', ctx)).toBe('Texte simple');
    expect(evaluerFormule('{{a}}', ctx).toString()).toBe('12.5');
  });
  it('fonctions de format et d’agrégat', () => {
    expect(evaluerFormule('=Montant(1234567,891)', ctx)).toBe('1 234 567,89');
    expect(evaluerFormule('=Date("2026-10-18"; "long")', ctx)).toBe('18 octobre 2026');
    expect(evaluerFormule('=Somme(liste; "m")', ctx).toString()).toBe('3.5');
    expect(evaluerFormule('=Majuscule(nom)', ctx)).toBe('DURAND');
    expect(formaterNombre('-0.004', 2)).toBe('0,00');
  });
  it('mise en forme dans la formule : texte riche', () => {
    const v = evaluerFormule('=Gras(nom) & " " & Taille(11; "x")', ctx);
    expect(v.riche).toEqual([{ texte: 'Durand', style: { graisse: 700 } }, { texte: ' ', style: {} }, { texte: 'x', style: { taille: 11 } }]);
  });
  it('erreurs : syntaxe, fonction inconnue, division par zéro', () => {
    expect(verifierFormule('=Si(1;')?.code).toBe('SYNTAXE');
    expect(() => evaluerFormule('=Inconnue(1)', ctx)).toThrow(/inconnue/i);
    expect(() => evaluerFormule('=1/0', ctx)).toThrow(/zéro/);
  });
});

describe('libellés HTML', () => {
  it('paragraphes, gras, listes, entités, tableaux simples', () => {
    const b = lireHtml('<p>Dalle <b>béton</b> &amp; treillis</p><ul><li>un</li><li>deux</li></ul><table><tr><td>a</td><td>b</td></tr></table>');
    expect(b[0].segments.map((s) => s.texte).join('')).toBe('Dalle béton & treillis');
    expect(b[0].segments[1].style.graisse).toBe(700);
    expect(b[1].puce).toBe('•');
    expect(b.at(-1).type).toBe('tableau');
  });
  it('balise inconnue ignorée, texte gardé ; script jamais interprété', () => {
    const b = lireHtml('<blink>a</blink><script>alert(1)</script>');
    expect(b[0].segments.map((s) => s.texte).join('')).toBe('aalert(1)');
  });
});

describe('codes, images, base64', () => {
  it('Code 39 : majuscules, caractères admis', () => {
    expect(code39('dv-2026').texte).toBe('*DV-2026*');
    expect(code39('é').erreur).toMatch(/non admis/);
  });
  it('QR : matrice carrée avec zone blanche', () => {
    const q = matriceQr('https://exemple.fr/é');
    expect(q.rangees).toHaveLength(q.taille);
    expect(q.rangees[0]).toMatch(/^0+$/);
  });
  it('images : PNG et JPEG acceptés, SVG refusé', () => {
    const png = base64VersOctets('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
    expect(lireImage(png)).toMatchObject({ type: 'png', largeur: 1, hauteur: 1 });
    expect(lireImage(new TextEncoder().encode('<svg/>')).erreur).toMatch(/SVG/);
    expect(octetsVersBase64(base64VersOctets('QUJDRA=='))).toBe('QUJDRA==');
  });
});

describe('modèles', () => {
  it('contrôle des formules et dépendances', () => {
    const m = { bandes: [{ contenu: { type: 'pile', enfants: [{ type: 'champ', valeur: '=Si(' }, { type: 'bloc', bloc: 'PIED' }, { type: 'image', ressource: 'LOGO' }] } }] };
    expect(verifierModele(m).map((e) => e.code)).toContain('SYNTAXE');
    expect(dependances(m)).toEqual({ blocs: ['PIED'], rapports: [], ressources: ['LOGO'] });
    const lire = (c) => ({ A: { contenu: { type: 'bloc', bloc: 'B' } }, B: { contenu: { type: 'bloc', bloc: 'A' } } })[c];
    expect(chercherCycle('A', lire)).toEqual(['A', 'B', 'A']);
  });
  it('charte : héritage des styles et couleurs nommées', () => {
    const c = completerCharte({ couleurs: { primaire: '#ff0000' } });
    expect(resoudreStyle(c, 'titre')).toMatchObject({ taille: 16, graisse: 700, couleur: '#ff0000', police: 'Inter' });
  });
});

describe('édition et pagination', () => {
  const lignes = Array.from({ length: 80 }, (_, i) => ({ lib: `Ligne ${i}`, mt: '10' }));
  const modele = (o = {}) => ({
    bandes: [
      { type: 'ENTETE_PAGE', contenu: { type: 'champ', valeur: 'Page {{Page()}}/{{NbPages()}}' } },
      { type: 'CORPS', contenu: { type: 'tableau', collection: 'lignes', remplir: o.remplir,
        colonnes: [{ cle: 'l', titre: 'Libellé', valeur: '{{ligne.lib}}' }, { cle: 'm', titre: 'Montant', largeur: '30mm', valeur: '{{ligne.mt}}', format: 'montant', cumul: '=ligne.mt' }] } },
      { type: 'CORPS', options: { bas_de_page: true }, contenu: { type: 'champ', valeur: '="Total " & Montant(Somme(lignes; "mt"))' } },
    ],
  });
  const textes = (r, n) => r.pages[n].elements.filter((e) => e.t === 'texte').map((e) => e.texte);
  it('entête de tableau répétée, report, numéros de page', () => {
    const r = editer(modele(), { lignes }, { polices: p });
    expect(r.pages.length).toBeGreaterThan(1);
    expect(textes(r, 0)).toContain('À reporter');
    expect(textes(r, 1)).toContain('Report');
    expect(textes(r, 1)).toContain('Libellé');
    expect(textes(r, 0)).toContain(`Page 1/${r.pages.length}`);
    expect(textes(r, r.pages.length - 1)).toContain('Total 800,00');
    expect(r.alertes).toEqual([]);
  });
  it('bloc de bas de page posé au bas de la zone ; cadre étiré', () => {
    const r = editer(modele({ remplir: true }), { lignes: lignes.slice(0, 5) }, { polices: p });
    const total = r.pages[0].elements.find((e) => e.t === 'texte' && e.texte.startsWith('Total'));
    expect(total.y).toBeGreaterThan(260);
    const verticales = r.pages[0].elements.filter((e) => e.t === 'ligne' && e.x1 === e.x2 && e.y2 - e.y1 > 150);
    expect(verticales.length).toBeGreaterThan(0);
  });
  it('formule en erreur : champ vide et alerte, jamais d’arrêt', () => {
    const r = editer({ bandes: [{ contenu: { type: 'champ', valeur: '=Inconnue()' } }] }, {}, { polices: p });
    expect(r.alertes[0].code).toBe('FONCTION_INCONNUE');
  });
  it('format flexible : A3 accepté, A5 ignoré s’il n’est pas déclaré', () => {
    const m = { page: { format: 'A4', flexible: ['A4', 'A3'] }, bandes: [] };
    expect(editer(m, {}, { polices: p, format: 'A3' }).page.largeur).toBe(297);
    expect(editer(m, {}, { polices: p, format: 'A5' }).page.largeur).toBe(210);
  });
  it('étiquettes : planche 3 × 8, départ sur une planche entamée', () => {
    const m = { mode: 'ETIQUETTES', collection: 'elements', planche: { colonnes: 3, rangees: 8, largeur: 70, hauteur: 37 }, bandes: [{ contenu: { type: 'champ', valeur: '{{element.nom}}' } }] };
    const r = editer(m, { elements: Array.from({ length: 30 }, (_, i) => ({ nom: `É${i}` })) }, { polices: p, parametres: { premiere_etiquette: 5 } });
    expect(r.pages).toHaveLength(2);
    expect(r.pages[1].elements.filter((e) => e.t === 'texte')).toHaveLength(10);
  });
  it('PDF produit, déterministe', async () => {
    const r = editer(modele(), { lignes }, { polices: p });
    const a = await produirePdf(r, p, { date: '2026-10-18T00:00:00Z' });
    const b = await produirePdf(r, p, { date: '2026-10-18T00:00:00Z' });
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe('%PDF-');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
