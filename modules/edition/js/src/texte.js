// Mise en ligne du texte, sans DOM : segments stylés → lignes de morceaux positionnés (millimètres).
// Coupure aux espaces (et aux sauts de ligne), mot trop long coupé au caractère, justification, ellipse, réduction de
// la police, retrait de la première ligne ou retrait suspendu. Même résultat dans le navigateur et dans Jint.

const ESPACES = /[ \t]/;
const INSECABLES = /[  ]/;
const ELLIPSE = '…';

/** Style complet d'un morceau (valeurs par défaut du moteur). */
export function styleTexte(s = {}) {
  return {
    police: s.police ?? 'Inter', taille: s.taille ?? 9, graisse: s.graisse ?? 400, italique: !!s.italique,
    couleur: s.couleur ?? '#000000', souligne: !!s.souligne, barre: !!s.barre, tnum: !!s.tnum,
    interligne: s.interligne ?? 1.2, fond: s.fond ?? null, exposant: s.exposant ?? null,
  };
}

const memeStyle = (a, b) => a.police === b.police && a.taille === b.taille && a.graisse === b.graisse
  && a.italique === b.italique && a.couleur === b.couleur && a.souligne === b.souligne && a.barre === b.barre
  && a.tnum === b.tnum && a.fond === b.fond && a.exposant === b.exposant;

/** Jetons : mots (suite sans espace, éventuellement sur plusieurs segments), espaces, sauts de ligne. */
function jetons(segments) {
  const res = [];
  for (const seg of segments) {
    const style = styleTexte(seg.style);
    const texte = String(seg.texte ?? '').replace(/\r\n?/g, '\n');
    let courant = '';
    const pousser = () => { if (courant) { res.push({ type: 'mot', texte: courant, style }); courant = ''; } };
    for (const c of texte) {
      if (c === '\n') { pousser(); res.push({ type: 'saut', style }); }
      else if (ESPACES.test(c)) { pousser(); res.push({ type: 'espace', texte: ' ', style }); }
      else courant += INSECABLES.test(c) ? ' ' : c;
    }
    pousser();
  }
  return res;
}

/** Groupes insécables : mots contigus (de styles différents) sans espace entre eux. */
function groupes(liste) {
  const res = [];
  let g = null;
  for (const j of liste) {
    if (j.type === 'mot') {
      if (!g) { g = { type: 'mot', parts: [] }; res.push(g); }
      g.parts.push(j);
    } else { g = null; res.push(j); }
  }
  return res;
}

/**
 * Lignes d'un texte stylé.
 * @param segments [{ texte, style }]
 * @param largeurMax largeur disponible (mm)
 * @param polices instance de Polices
 * @param opts { alignement: gauche|centre|droite|justifie, retour: auto|sauts|aucun, ellipse, lignesMax,
 *               retraitPremiere (mm), retraitSuivantes (mm), reductionMin (pt) }
 * @returns { lignes: [{ y (ligne de base depuis le haut), hauteur, largeur, morceaux: [{ x, texte, style, largeur }] }],
 *            hauteur, largeur, tronque }
 */
export function mettreEnLignes(segments, largeurMax, polices, opts = {}) {
  const r = composerLignes(segments, largeurMax, polices, opts);
  // Réduction de la police : texte trop long pour le nombre de lignes permis.
  if (opts.reductionMin && (r.tronque || (opts.retour === 'aucun' && r.largeur > largeurMax + 0.001))) {
    for (let f = 0.95; f > 0.3; f -= 0.05) {
      const reduits = segments.map((s) => ({ ...s, style: { ...styleTexte(s.style), taille: Math.max(opts.reductionMin, styleTexte(s.style).taille * f) } }));
      const essai = composerLignes(reduits, largeurMax, polices, opts);
      const tailleMin = reduits.every((s) => s.style.taille <= opts.reductionMin + 1e-9);
      if ((!essai.tronque && essai.largeur <= largeurMax + 0.001) || tailleMin) return essai;
    }
  }
  return r;
}

function composerLignes(segments, largeurMax, polices, opts) {
  const retour = opts.retour ?? 'auto';
  const retraitPremiere = opts.retraitPremiere ?? 0;
  const retraitSuivantes = opts.retraitSuivantes ?? 0;
  const lignesMax = opts.lignesMax ?? (retour === 'aucun' ? 1 : Infinity);
  const larg = (t, style) => polices.largeur(t, style);

  const brutes = []; // lignes : liste de jetons (mots / espaces)
  let ligne = [];
  let x = 0;
  let disponible = () => largeurMax - (brutes.length === 0 ? retraitPremiere : retraitSuivantes);
  const fin = (forcee) => { brutes.push({ jetons: ligne, forcee }); ligne = []; x = 0; };

  for (const g of groupes(jetons(segments))) {
    if (g.type === 'saut') {
      if (retour === 'aucun') { ligne.push({ type: 'espace', texte: ' ', style: g.style, largeur: larg(' ', g.style) }); x += larg(' ', g.style); continue; }
      fin(true);
      continue;
    }
    if (g.type === 'espace') {
      if (!ligne.length) continue; // pas d'espace en début de ligne
      const l = larg(' ', g.style);
      ligne.push({ ...g, largeur: l });
      x += l;
      continue;
    }
    const parts = g.parts.map((p) => ({ ...p, largeur: larg(p.texte, p.style) }));
    const largeurMot = parts.reduce((a, p) => a + p.largeur, 0);
    if (retour !== 'auto' || x + largeurMot <= disponible() + 0.001) {
      ligne.push(...parts);
      x += largeurMot;
      continue;
    }
    // Retour à la ligne avant le mot (espaces de fin retirés).
    while (ligne.length && ligne[ligne.length - 1].type === 'espace') { x -= ligne.pop().largeur; }
    if (ligne.length) fin(false);
    if (largeurMot <= disponible() + 0.001) { ligne.push(...parts); x += largeurMot; continue; }
    // Mot plus long que la ligne : coupé au caractère.
    for (const p of parts) {
      let morceau = '';
      for (const c of p.texte) {
        const l = larg(morceau + c, p.style);
        if (x + l > disponible() + 0.001 && (morceau || ligne.length)) {
          if (morceau) { ligne.push({ type: 'mot', texte: morceau, style: p.style, largeur: larg(morceau, p.style) }); }
          fin(false);
          morceau = c;
        } else morceau += c;
      }
      if (morceau) { const l = larg(morceau, p.style); ligne.push({ type: 'mot', texte: morceau, style: p.style, largeur: l }); x += l; }
    }
  }
  while (ligne.length && ligne[ligne.length - 1].type === 'espace') ligne.pop();
  fin(true);

  // Nombre de lignes limité : ellipse sur la dernière ligne gardée.
  let tronque = false;
  let gardees = brutes;
  if (brutes.length > lignesMax) {
    tronque = true;
    gardees = brutes.slice(0, lignesMax);
    if (opts.ellipse !== false) gardees[gardees.length - 1] = ellipser(gardees[gardees.length - 1], largeurMax - (gardees.length === 1 ? retraitPremiere : retraitSuivantes), larg);
  } else if (retour === 'aucun' && opts.ellipse) {
    const l = brutes[0];
    const total = l.jetons.reduce((a, j) => a + j.largeur, 0);
    if (total > largeurMax - retraitPremiere + 0.001) { tronque = true; gardees = [ellipser(l, largeurMax - retraitPremiere, larg)]; }
  }

  // Positions : alignement, justification, hauteur et ligne de base de chaque ligne.
  const alignement = opts.alignement ?? 'gauche';
  const resultat = [];
  let y = 0;
  let largeurContenu = 0;
  gardees.forEach((b, i) => {
    const retrait = i === 0 ? retraitPremiere : retraitSuivantes;
    const dispo = largeurMax - retrait;
    const js = b.jetons;
    const styles = js.length ? js.map((j) => j.style) : [styleTexte(segments.find((s) => s)?.style)];
    let hauteur = 0; let ascent = 0; let descent = 0;
    for (const s of styles) {
      const m = polices.metriques(s);
      hauteur = Math.max(hauteur, m.hauteur);
      ascent = Math.max(ascent, m.ascent);
      descent = Math.max(descent, m.descent);
    }
    const total = js.reduce((a, j) => a + j.largeur, 0);
    largeurContenu = Math.max(largeurContenu, total + retrait);
    let decalage = 0;
    let extraEspace = 0;
    const nbEspaces = js.filter((j) => j.type === 'espace').length;
    if (alignement === 'centre') decalage = (dispo - total) / 2;
    else if (alignement === 'droite') decalage = dispo - total;
    else if (alignement === 'justifie' && !b.forcee && nbEspaces > 0 && i < gardees.length - 1) extraEspace = (dispo - total) / nbEspaces;
    // Morceaux : jetons contigus de même style fusionnés (sauf justification, où chaque mot est placé).
    const morceaux = [];
    let cx = retrait + Math.max(0, decalage);
    for (const j of js) {
      const l = j.largeur + (j.type === 'espace' ? extraEspace : 0);
      const dernier = morceaux[morceaux.length - 1];
      if (dernier && memeStyle(dernier.style, j.style) && extraEspace === 0) {
        dernier.texte += j.texte; dernier.largeur += l;
      } else if (j.type === 'espace' && extraEspace !== 0) {
        // espace justifié : seulement un décalage
      } else {
        morceaux.push({ x: cx, texte: j.texte, style: j.style, largeur: j.largeur });
      }
      cx += l;
    }
    const base = y + (hauteur - (ascent + descent)) / 2 + ascent;
    resultat.push({ y: base, haut: y, hauteur, largeur: total, morceaux: morceaux.filter((m) => m.texte.trim() !== '' || m.style.fond) });
    y += hauteur;
  });
  return { lignes: resultat, hauteur: y, largeur: largeurContenu, tronque };
}

function ellipser(ligne, dispo, larg) {
  const js = [...ligne.jetons];
  const st = js.length ? js[js.length - 1].style : styleTexte();
  const lE = larg(ELLIPSE, st);
  let total = js.reduce((a, j) => a + j.largeur, 0);
  while (js.length && total + lE > dispo + 0.001) {
    const d = js.pop();
    total -= d.largeur;
    if (d.type === 'mot' && d.texte.length > 1) {
      let t = d.texte;
      while (t.length > 1 && total + larg(t, d.style) + lE > dispo + 0.001) t = t.slice(0, -1);
      if (total + larg(t, d.style) + lE <= dispo + 0.001) { js.push({ ...d, texte: t, largeur: larg(t, d.style) }); total += larg(t, d.style); break; }
    }
  }
  while (js.length && js[js.length - 1].type === 'espace') total -= js.pop().largeur;
  js.push({ type: 'mot', texte: ELLIPSE, style: st, largeur: lE });
  return { jetons: js, forcee: true };
}
