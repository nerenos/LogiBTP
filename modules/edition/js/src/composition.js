// Composition : composants du modèle + données → boîtes mesurées (millimètres), prêtes à paginer.
// Une boîte : { hauteur, largeur, dessiner(sortie, x, y, hauteurImposee?), decouper?(h) → [haut, bas] | null }.
// Le dessin produit des éléments en coordonnées de page (mm, origine en haut à gauche) :
//   texte { x, y (ligne de base), texte, style, largeur, rotation? } ; rect { x, y, l, h, fond, trait } ;
//   ligne { x1, y1, x2, y2, trait } ; image { x, y, l, h, ressource } ; qr { x, y, module, rangees }.
import { evaluerFormule, evaluerCondition, enSegments, enTexte, estDec, estRiche, estRetrait, estVide, lireChemin,
  formaterNombre, formaterDate, ErreurFormule, versDec } from './formules.js';
import { mettreEnLignes, styleTexte } from './texte.js';
import { lireHtml, estHtml } from './html.js';
import { resoudreStyle, resoudreCouleur, resoudreTrait } from './charte.js';
import { lireLongueur, repartirLargeurs, r2 } from './unites.js';
import { code39, matriceQr } from './codes.js';

// ---------------------------------------------------------------------------------------------------------------
// Contexte d'évaluation

/**
 * Contexte de composition : { donnees (racine), element, groupe, parametres, page, polices, charte, ressources,
 * blocs, alertes, profondeur }. `resoudre(chemin)` : élément courant (ligne, élément), groupe, paramètres, page,
 * puis racine des données.
 */
export function creerContexte(base) {
  const ctx = {
    alertes: [], parametres: {}, profondeur: 0, ...base,
  };
  ctx.formule = contexteFormule(ctx);
  return ctx;
}

export function enfant(ctx, ajouts) {
  const c = { ...ctx, ...ajouts };
  c.formule = contexteFormule(c);
  return c;
}

function contexteFormule(ctx) {
  return {
    resoudre: (chemin) => resoudre(ctx, chemin),
    page: ctx.page,
    parametres: ctx.parametres,
    aujourdhui: ctx.aujourdhui,
    couleur: (n) => resoudreCouleur(ctx.charte, n),
    style: (n) => resoudreStyle(ctx.charte, n),
    code39: (t) => code39(t).texte,
  };
}

function resoudre(ctx, chemin) {
  const [tete] = String(chemin).split(/[.[]/);
  const reste = String(chemin).slice(tete.length).replace(/^\./, '');
  const lire = (o) => (reste ? lireChemin(o, reste) : o ?? null);
  switch (tete) {
    case 'ligne': case 'element': return lire(ctx.element);
    case 'groupe': return lire(ctx.groupe);
    case 'parametres': return lire(ctx.parametres);
    case 'page': return lire(ctx.page);
    case 'donnees': return lire(ctx.donnees);
    default: break;
  }
  if (ctx.element && typeof ctx.element === 'object' && tete in ctx.element) return lireChemin(ctx.element, chemin);
  if (ctx.bloc && tete in ctx.bloc) return lireChemin(ctx.bloc, chemin);
  return lireChemin(ctx.donnees, chemin);
}

/** Évaluation protégée (Q8) : une formule en erreur donne une valeur vide et une alerte, jamais d'arrêt. */
export function evaluer(ctx, source, lieu = '') {
  try {
    return evaluerFormule(source, ctx.formule);
  } catch (e) {
    alerter(ctx, e.code ?? 'FORMULE', `${lieu ? lieu + ' : ' : ''}${e.message}`, source);
    return null;
  }
}

/** Expression d'une collection ou d'une donnée : chemin nu (« lignes ») ou formule (« =… », « {{…}} »). */
export function evaluerExpression(ctx, source, lieu = '') {
  if (source === undefined || source === null || source === '') return null;
  const s = String(source).trim();
  return evaluer(ctx, s.startsWith('=') || s.includes('{{') ? s : `=${s}`, lieu);
}

export function condition(ctx, source, lieu = '') {
  if (source === undefined || source === null || source === '') return true;
  try {
    return evaluerCondition(source, ctx.formule);
  } catch (e) {
    alerter(ctx, e.code ?? 'FORMULE', `${lieu ? lieu + ' : ' : ''}condition : ${e.message}`, source);
    return false;
  }
}

export function alerter(ctx, code, message, source = null) {
  const cle = `${code}|${message}`;
  if (!ctx.alertes.some((a) => `${a.code}|${a.message}` === cle)) ctx.alertes.push({ code, message, ...(source ? { formule: String(source) } : {}) });
}

// ---------------------------------------------------------------------------------------------------------------
// Boîtes élémentaires

const vide = (largeur = 0, hauteur = 0) => ({ hauteur, largeur, dessiner() {}, vide: true });

/** Boîte de lignes de texte (résultat de mettreEnLignes). */
function boiteTexte(r, largeur, opts = {}) {
  const lignes = r.lignes;
  const b = {
    hauteur: r.hauteur,
    largeur,
    lignes,
    dessiner(sortie, x, y) {
      for (const l of lignes) {
        for (const m of l.morceaux) {
          const st = m.style;
          let by = y + l.y;
          let taille = st.taille;
          if (st.exposant) { taille = st.taille * 0.7; by += (st.exposant === 'haut' ? -0.35 : 0.15) * (st.taille * 25.4 / 72); }
          const style = { police: st.police, graisse: st.graisse, italique: st.italique, taille, couleur: st.couleur, tnum: st.tnum };
          if (st.fond) sortie.push({ t: 'rect', x: r2(x + m.x), y: r2(y + l.haut), l: r2(m.largeur), h: r2(l.hauteur), fond: st.fond });
          sortie.push({ t: 'texte', x: r2(x + m.x), y: r2(by), texte: m.texte, style, largeur: r2(m.largeur), ...(opts.rotation ? { rotation: opts.rotation } : {}) });
          const ep = Math.max(0.1, st.taille * 0.02);
          if (st.souligne) sortie.push({ t: 'ligne', x1: r2(x + m.x), y1: r2(by + st.taille * 0.03), x2: r2(x + m.x + m.largeur), y2: r2(by + st.taille * 0.03), trait: { epaisseur: ep, couleur: st.couleur } });
          if (st.barre) sortie.push({ t: 'ligne', x1: r2(x + m.x), y1: r2(by - st.taille * 0.1), x2: r2(x + m.x + m.largeur), y2: r2(by - st.taille * 0.1), trait: { epaisseur: ep, couleur: st.couleur } });
        }
      }
    },
    decouper(h) {
      let n = 0;
      while (n < lignes.length && lignes[n].haut + lignes[n].hauteur <= h + 0.001) n++;
      // Veuves et orphelines : au moins deux lignes de chaque côté d'une coupure (texte d'au moins quatre lignes).
      const min = lignes.length >= 4 ? (opts.lignesMin ?? 2) : 1;
      if (n < min) return null;
      if (lignes.length - n < min) n = lignes.length - min;
      if (n <= 0 || n >= lignes.length) return null;
      const dy = lignes[n].haut;
      const bas = lignes.slice(n).map((l) => ({ ...l, y: l.y - dy, haut: l.haut - dy }));
      const hautR = { lignes: lignes.slice(0, n), hauteur: dy };
      const basR = { lignes: bas, hauteur: r.hauteur - dy };
      return [boiteTexte(hautR, largeur, opts), boiteTexte(basR, largeur, opts)];
    },
  };
  return b;
}

/** Marges internes, cadre et fond autour d'une boîte ; hauteur minimale ou fixe. */
function envelopper(boite, c, ctx, largeurExterne) {
  const m = marges(c.marges);
  const cadre = lireCadre(c.cadre, ctx);
  const fond = resoudreCouleur(ctx.charte, c.fond);
  const hMin = c.hauteur_min ?? 0;
  const hFixe = c.hauteur ?? null;
  if (!m.haut && !m.bas && !m.gauche && !m.droite && !cadre && !fond && !hMin && hFixe === null) return boite;
  const interieur = boite;
  const hauteur = hFixe ?? Math.max(hMin, interieur.hauteur + m.haut + m.bas);
  const b = {
    hauteur,
    largeur: largeurExterne,
    dessiner(sortie, x, y, hauteurImposee) {
      const h = hauteurImposee ?? hauteur;
      if (fond) sortie.push({ t: 'rect', x: r2(x), y: r2(y), l: r2(largeurExterne), h: r2(h), fond });
      interieur.dessiner(sortie, x + m.gauche, y + m.haut, hauteurImposee ? h - m.haut - m.bas : undefined);
      if (cadre) dessinerCadre(sortie, cadre, x, y, largeurExterne, h, c.rayon);
    },
  };
  if (interieur.decouper && hFixe === null) {
    b.decouper = (h) => {
      const parts = interieur.decouper(h - m.haut - m.bas);
      if (!parts) return null;
      return [envelopper(parts[0], { ...c, hauteur_min: 0 }, ctx, largeurExterne), envelopper(parts[1], { ...c, hauteur_min: 0 }, ctx, largeurExterne)];
    };
  }
  return b;
}

function marges(v) {
  if (v === undefined || v === null) return { haut: 0, bas: 0, gauche: 0, droite: 0 };
  if (typeof v === 'number') return { haut: v, bas: v, gauche: v, droite: v };
  return { haut: v.haut ?? 0, bas: v.bas ?? 0, gauche: v.gauche ?? 0, droite: v.droite ?? 0 };
}

/** Cadre : trait (tous les côtés) ou { haut, bas, gauche, droite } (traits par côté). */
function lireCadre(v, ctx) {
  if (!v) return null;
  if (typeof v === 'object' && ('haut' in v || 'bas' in v || 'gauche' in v || 'droite' in v)) {
    return { haut: resoudreTrait(ctx.charte, v.haut), bas: resoudreTrait(ctx.charte, v.bas), gauche: resoudreTrait(ctx.charte, v.gauche), droite: resoudreTrait(ctx.charte, v.droite) };
  }
  const t = resoudreTrait(ctx.charte, v);
  return t ? { haut: t, bas: t, gauche: t, droite: t, tout: t } : null;
}

function dessinerCadre(sortie, cadre, x, y, l, h, rayon) {
  if (cadre.tout) { sortie.push({ t: 'rect', x: r2(x), y: r2(y), l: r2(l), h: r2(h), trait: cadre.tout, ...(rayon ? { rayon } : {}) }); return; }
  if (cadre.haut) sortie.push({ t: 'ligne', x1: r2(x), y1: r2(y), x2: r2(x + l), y2: r2(y), trait: cadre.haut });
  if (cadre.bas) sortie.push({ t: 'ligne', x1: r2(x), y1: r2(y + h), x2: r2(x + l), y2: r2(y + h), trait: cadre.bas });
  if (cadre.gauche) sortie.push({ t: 'ligne', x1: r2(x), y1: r2(y), x2: r2(x), y2: r2(y + h), trait: cadre.gauche });
  if (cadre.droite) sortie.push({ t: 'ligne', x1: r2(x + l), y1: r2(y), x2: r2(x + l), y2: r2(y + h), trait: cadre.droite });
}

// ---------------------------------------------------------------------------------------------------------------
// Composants

/**
 * Compose un composant à une largeur donnée. Renvoie une boîte, null (composant masqué : condition fausse ou champ
 * vide), ou { flux: [...fragments], tableau } pour un tableau (lignes paginées une à une).
 */
export function composer(c, ctx, largeur) {
  if (!c) return null;
  if (!condition(ctx, c.condition, c.nom ?? c.type)) return null;
  switch (c.type) {
    case 'champ': return composerChamp(c, ctx, largeur);
    case 'pile': return composerPile(c, ctx, largeur);
    case 'rangee': return composerRangee(c, ctx, largeur);
    case 'tableau': return composerTableau(c, ctx, largeur);
    case 'repete': return composerRepete(c, ctx, largeur);
    case 'image': return composerImage(c, ctx, largeur);
    case 'trait': return composerTrait(c, ctx, largeur);
    case 'espace': return vide(largeur, c.hauteur ?? 2);
    case 'code39': return composerCode39(c, ctx, largeur);
    case 'qr': return composerQr(c, ctx, largeur);
    case 'absolu': return composerAbsolu(c, ctx);
    case 'saut_page': return { saut: true, hauteur: 0, largeur, dessiner() {} };
    case 'bloc': return composerBloc(c, ctx, largeur);
    case 'sous_rapport': return ctx.composerSousRapport ? ctx.composerSousRapport(c, ctx, largeur) : null;
    default:
      alerter(ctx, 'COMPOSANT_INCONNU', `Composant inconnu : ${c.type}`);
      return null;
  }
}

/** Valeur mise en forme d'un champ : format (montant, nombre:n, pourcent, date, date_longue) appliqué au type. */
function valeurChamp(c, ctx) {
  let v = evaluer(ctx, c.valeur ?? '', c.nom ?? 'champ');
  const f = c.format;
  if (f && v !== null && v !== '' && !estRiche(v) && !estRetrait(v)) {
    const [nom, arg] = String(f).split(':');
    try {
      if (nom === 'montant') v = estVide(v) ? '' : formaterNombre(versDec(v), arg === undefined ? 2 : Number(arg));
      else if (nom === 'nombre') v = formaterNombre(versDec(v), arg === undefined ? 2 : Number(arg));
      else if (nom === 'monnaie') v = `${formaterNombre(versDec(v), 2)} ${arg ?? '€'}`;
      else if (nom === 'pourcent') v = `${formaterNombre(versDec(v), arg === undefined ? 2 : Number(arg))} %`;
      else if (nom === 'date') v = formaterDate(v, arg ?? 'court');
      else if (nom === 'zero_vide' && estDec(v) && v.isZero()) v = '';
    } catch (e) {
      alerter(ctx, e.code ?? 'FORMAT', `${c.nom ?? 'champ'} : ${e.message}`, c.valeur);
    }
  }
  if (c.zero_vide && estDec(v) && v.isZero()) v = '';
  return v;
}

function optionsTexte(c) {
  const multi = c.multiligne ?? 'auto';
  return {
    alignement: c.alignement ?? 'gauche',
    retour: multi === 'une' ? 'aucun' : multi === 'sauts' ? 'sauts' : 'auto',
    ellipse: c.ellipse ?? (multi === 'une'),
    lignesMax: c.lignes_max ?? (multi === 'une' ? 1 : undefined),
    reductionMin: c.reduction_min,
  };
}

function composerChamp(c, ctx, largeur) {
  const v = valeurChamp(c, ctx);
  const masquer = c.masquer_si_vide ?? true;
  if (estVide(v) && masquer) return null;
  const m = marges(c.marges);
  const interieur = largeur - m.gauche - m.droite;
  const style = resoudreStyle(ctx.charte, c.style ?? 'normal');
  let boite;
  if (typeof v === 'string' && (c.html || (c.html !== false && estHtml(v)))) {
    boite = composerHtml(v, style, interieur, ctx, c);
  } else {
    const opts = optionsTexte(c);
    let segments;
    if (estRetrait(v)) {
      const lib = enSegments(v.libelle, style);
      segments = [...lib, ...enSegments(v.texte, style)];
      opts.retraitSuivantes = lib.reduce((a, s) => a + ctx.polices.largeur(s.texte, styleTexte(s.style)), 0);
    } else segments = enSegments(v, style);
    if (c.prefixe) segments.unshift(...enSegments(c.prefixe, style));
    if (c.suffixe) segments.push(...enSegments(c.suffixe, style));
    if (!segments.length) segments = [{ texte: '', style }];
    const r = mettreEnLignes(segments, interieur, ctx.polices, opts);
    boite = boiteTexte(r, interieur, { rotation: c.rotation });
    if (c.hauteur && r.hauteur > c.hauteur - m.haut - m.bas + 0.01 && (c.multiligne ?? 'auto') === 'auto') {
      // Hauteur fixe dépassée : lignes en trop retirées avec une ellipse.
      const n = r.lignes.filter((l) => l.haut + l.hauteur <= c.hauteur - m.haut - m.bas + 0.01).length;
      boite = boiteTexte(mettreEnLignes(segments, interieur, ctx.polices, { ...opts, lignesMax: Math.max(1, n), ellipse: true }), interieur);
    }
    if (c.secable === false) delete boite.decouper;
  }
  return envelopper(boite, c, ctx, largeur);
}

/** Libellé HTML : paragraphes (puces, titres), tableaux simples. */
export function composerHtml(html, style, largeur, ctx, c = {}) {
  const blocs = lireHtml(html);
  const enfants = [];
  const opts = optionsTexte(c);
  const espacePara = c.espace_paragraphes ?? 0.6;
  for (const b of blocs) {
    if (b.type === 'paragraphe') {
      const retrait = b.niveau * 4;
      const segs = b.segments.map((s) => ({ texte: s.texte, style: { ...style, ...s.style, taille: (s.style.taille ?? style.taille ?? 9) * (b.echelle ?? 1) } }));
      if (b.puce) segs.unshift({ texte: b.puce + ' ', style: { ...style } });
      const largPuce = b.puce ? ctx.polices.largeur(b.puce + ' ', styleTexte(style)) : 0;
      const r = mettreEnLignes(segs, largeur - retrait, ctx.polices, { ...opts, alignement: b.alignement ?? opts.alignement, retraitSuivantes: largPuce });
      const bt = boiteTexte(r, largeur - retrait);
      enfants.push(retrait ? decaler(bt, retrait, largeur) : bt);
    } else {
      enfants.push(composerTableauHtml(b, style, largeur, ctx));
    }
  }
  if (!enfants.length) return vide(largeur, 0);
  if (enfants.length === 1) return enfants[0];
  return pileDeBoites(enfants, largeur, espacePara);
}

function decaler(boite, dx, largeur) {
  const b = { hauteur: boite.hauteur, largeur, dessiner: (s, x, y, h) => boite.dessiner(s, x + dx, y, h) };
  if (boite.decouper) b.decouper = (h) => { const p = boite.decouper(h); return p && [decaler(p[0], dx, largeur), decaler(p[1], dx, largeur)]; };
  return b;
}

function composerTableauHtml(t, style, largeur, ctx) {
  if (t.fusions) alerter(ctx, 'HTML_FUSION', 'Tableau d’un libellé : cellules fusionnées rendues sans fusion');
  const nbCol = Math.max(...t.rangees.map((r) => r.cellules.length));
  const larg = largeur / nbCol;
  const trait = resoudreTrait(ctx.charte, 'fin');
  const rangees = t.rangees.map((r) => {
    const cellules = r.cellules.map((cel) => {
      const paras = cel.paragraphes.map((p) => mettreEnLignes(p.segments.map((s) => ({ texte: s.texte, style: { ...style, ...s.style } })), larg - 2, ctx.polices, { alignement: p.alignement ?? 'gauche' }));
      return pileDeBoites(paras.map((p) => boiteTexte(p, larg - 2)), larg - 2, 0.3);
    });
    const h = Math.max(...cellules.map((b) => b.hauteur), 0) + 1.2;
    return {
      hauteur: h, largeur,
      dessiner(sortie, x, y) {
        cellules.forEach((b, i) => {
          b.dessiner(sortie, x + i * larg + 1, y + 0.6);
          sortie.push({ t: 'rect', x: r2(x + i * larg), y: r2(y), l: r2(larg), h: r2(h), trait });
        });
      },
    };
  });
  return pileDeBoites(rangees, largeur, 0);
}

/** Pile de boîtes déjà composées (sécable entre deux boîtes et dans une boîte sécable). */
function pileDeBoites(boites, largeur, espacement = 0) {
  const liste = boites.filter(Boolean);
  const hauteur = liste.reduce((a, b) => a + b.hauteur, 0) + espacement * Math.max(0, liste.length - 1);
  const b = {
    hauteur, largeur,
    enfants: liste,
    dessiner(sortie, x, y) {
      let cy = y;
      for (const e of liste) { e.dessiner(sortie, x, cy); cy += e.hauteur + espacement; }
    },
    decouper(h) {
      let cy = 0;
      for (let i = 0; i < liste.length; i++) {
        const e = liste[i];
        if (cy + e.hauteur <= h + 0.001) { cy += e.hauteur + espacement; continue; }
        const haut = liste.slice(0, i);
        const bas = liste.slice(i + 1);
        const parts = e.decouper ? e.decouper(h - cy) : null;
        if (parts) { haut.push(parts[0]); bas.unshift(parts[1]); } else bas.unshift(e);
        if (!haut.length) return null;
        return [pileDeBoites(haut, largeur, espacement), pileDeBoites(bas, largeur, espacement)];
      }
      return null;
    },
  };
  return b;
}

function composerPile(c, ctx, largeur) {
  const m = marges(c.marges);
  const interieur = largeur - m.gauche - m.droite;
  const enfants = [];
  for (const e of c.enfants ?? []) {
    const b = composer(e, ctx, interieur);
    if (!b) continue;
    if (b.flux) { enfants.push(...b.flux.map((f) => f.boite)); continue; }
    enfants.push(b);
  }
  if (!enfants.length && (c.masquer_si_vide ?? true)) return null;
  const p = pileDeBoites(enfants, interieur, c.espacement ?? 0);
  if (c.secable === false) delete p.decouper;
  return envelopper(p, c, ctx, largeur);
}

/** Rangée : colonnes en %, mm ou reste ; hauteur = colonne la plus haute ; option meme_hauteur (cadres égaux). */
function composerRangee(c, ctx, largeur) {
  const m = marges(c.marges);
  const interieur = largeur - m.gauche - m.droite;
  const defs = (c.enfants ?? []).filter((e) => condition(ctx, e.condition, e.nom ?? e.type));
  const larg = repartirLargeurs(defs.map((e) => lireLongueur(e.largeur)), interieur, c.espacement ?? 0);
  const cols = [];
  let x = 0;
  defs.forEach((e, i) => {
    const b = composer({ ...e, condition: undefined }, ctx, larg[i]);
    if (b && !b.flux) cols.push({ b, x, l: larg[i], v: e.alignement_vertical ?? 'haut' });
    x += larg[i] + (c.espacement ?? 0);
  });
  if (!cols.length && (c.masquer_si_vide ?? true)) return null;
  const hauteur = Math.max(0, ...cols.map((k) => k.b.hauteur));
  const rangee = {
    hauteur, largeur: interieur,
    dessiner(sortie, x0, y0, hauteurImposee) {
      const h = hauteurImposee ?? hauteur;
      for (const k of cols) {
        const dy = k.v === 'bas' ? h - k.b.hauteur : k.v === 'milieu' ? (h - k.b.hauteur) / 2 : 0;
        k.b.dessiner(sortie, x0 + k.x, y0 + (c.meme_hauteur ? 0 : dy), c.meme_hauteur ? h : undefined);
      }
    },
  };
  if (c.secable !== false && cols.every((k) => k.b.decouper || k.b.hauteur === 0)) {
    rangee.decouper = (h) => {
      const parts = cols.map((k) => (k.b.hauteur <= h + 0.001 ? [k.b, vide(k.l, 0)] : k.b.decouper(h)));
      if (parts.some((p) => !p)) return null;
      const faire = (idx) => {
        const cs = cols.map((k, i) => ({ ...k, b: parts[i][idx] }));
        const hh = Math.max(0, ...cs.map((k) => k.b.hauteur));
        return { hauteur: hh, largeur: interieur, dessiner(s, x0, y0) { for (const k of cs) k.b.dessiner(s, x0 + k.x, y0); } };
      };
      return [faire(0), faire(1)];
    };
  }
  return envelopper(rangee, c, ctx, largeur);
}

/** Répétition d'un composant sur une collection (adresses, intervenants, TVA…), empilée verticalement. */
function composerRepete(c, ctx, largeur) {
  const liste = evaluerExpression(ctx, c.collection, 'répétition');
  if (!Array.isArray(liste) || !liste.length) return c.masquer_si_vide === false ? vide(largeur, 0) : null;
  const boites = liste.map((el, i) => composer(c.contenu, enfant(ctx, { element: el, index: i }), largeur)).filter((b) => b && !b.flux);
  if (!boites.length) return null;
  return envelopper(pileDeBoites(boites, largeur, c.espacement ?? 0), c, ctx, largeur);
}

function composerImage(c, ctx, largeur) {
  const code = c.ressource ? (String(c.ressource).includes('{{') || String(c.ressource).startsWith('=') ? enTexte(evaluer(ctx, c.ressource, 'image')) : c.ressource) : null;
  const res = code ? ctx.ressources?.[code] : null;
  if (!res) {
    if (code && c.obligatoire) alerter(ctx, 'RESSOURCE_INTROUVABLE', `Image introuvable : ${code}`);
    return c.masquer_si_vide === false ? vide(largeur, c.hauteur ?? 0) : null;
  }
  const lMax = c.largeur ? Math.min(largeur, Number(lireLongueur(c.largeur).mode === 'pct' ? (largeur * lireLongueur(c.largeur).valeur) / 100 : lireLongueur(c.largeur).valeur)) : largeur;
  const hMax = c.hauteur ?? 30;
  const ratio = res.largeur && res.hauteur ? res.largeur / res.hauteur : 1;
  let l = lMax; let h = l / ratio;
  if (h > hMax) { h = hMax; l = h * ratio; }
  if (res.dpi && res.largeur) {
    const dpiImprime = res.largeur / (l / 25.4);
    if (dpiImprime < 150) alerter(ctx, 'IMAGE_RESOLUTION', `Image ${code} : ${Math.round(dpiImprime)} dpi à la taille imprimée (300 conseillés)`);
  }
  const al = c.alignement ?? 'gauche';
  const dx = al === 'centre' ? (largeur - l) / 2 : al === 'droite' ? largeur - l : 0;
  return envelopper({
    hauteur: h, largeur,
    dessiner(sortie, x, y) { sortie.push({ t: 'image', x: r2(x + dx), y: r2(y), l: r2(l), h: r2(h), ressource: code, ...(res.orientation > 1 ? { orientation: res.orientation } : {}) }); },
  }, { ...c, hauteur: undefined }, ctx, largeur);
}

function composerTrait(c, ctx, largeur) {
  const t = resoudreTrait(ctx.charte, c.trait ?? 'fin');
  const marge = c.marge ?? 1;
  return {
    hauteur: marge * 2, largeur,
    dessiner(sortie, x, y) { if (t) sortie.push({ t: 'ligne', x1: r2(x), y1: r2(y + marge), x2: r2(x + largeur), y2: r2(y + marge), trait: t }); },
  };
}

function composerCode39(c, ctx, largeur) {
  const v = enTexte(evaluer(ctx, c.valeur, 'code-barres'));
  if (!v) return null;
  const code = code39(v);
  if (code.erreur) { alerter(ctx, 'CODE39', code.erreur, c.valeur); return null; }
  const taille = c.taille ?? 24;
  const style = { police: 'Libre Barcode 39', taille, graisse: 400, couleur: '#000000' };
  const lCode = ctx.polices.largeur(code.texte, style);
  const lisible = c.texte_lisible !== false;
  const styleTxt = resoudreStyle(ctx.charte, c.style ?? 'petit');
  const rTxt = lisible ? mettreEnLignes([{ texte: code.donnee, style: styleTxt }], largeur, ctx.polices, { alignement: 'centre', retour: 'aucun' }) : null;
  const m = ctx.polices.metriques(style);
  const hCode = m.ascent * 0.95;
  const al = c.alignement ?? 'gauche';
  const marge = c.marge_blanche ?? 3;
  const dx = al === 'centre' ? (largeur - lCode) / 2 : al === 'droite' ? largeur - lCode - marge : marge;
  if (lCode + 2 * marge > largeur + 0.01) alerter(ctx, 'CODE39_LARGEUR', `Code-barres « ${code.donnee} » plus large que sa zone (${lCode.toFixed(1)} mm)`);
  const hauteur = hCode + (rTxt ? rTxt.hauteur + 0.5 : 0);
  return {
    hauteur, largeur,
    dessiner(sortie, x, y) {
      sortie.push({ t: 'texte', x: r2(x + dx), y: r2(y + m.ascent), texte: code.texte, style, largeur: r2(lCode) });
      if (rTxt) boiteTexte(rTxt, largeur).dessiner(sortie, al === 'centre' ? x : x + dx - (largeur - lCode) / 2, y + hCode + 0.5);
    },
  };
}

function composerQr(c, ctx, largeur) {
  const v = enTexte(evaluer(ctx, c.valeur, 'QR code'));
  if (!v) return null;
  let q;
  try { q = matriceQr(v, c.correction ?? 'M'); } catch (e) { alerter(ctx, 'QR', `QR code : ${e.message}`, c.valeur); return null; }
  const taille = Math.min(c.taille ?? 25, largeur);
  const module = taille / q.taille;
  const al = c.alignement ?? 'gauche';
  const dx = al === 'centre' ? (largeur - taille) / 2 : al === 'droite' ? largeur - taille : 0;
  return {
    hauteur: taille, largeur,
    dessiner(sortie, x, y) { sortie.push({ t: 'qr', x: r2(x + dx), y: r2(y), module: Math.round(module * 10000) / 10000, rangees: q.rangees }); },
  };
}

/** Zone absolue : position en mm depuis le coin de la page (fenêtre d'enveloppe) ; ne prend pas de hauteur. */
function composerAbsolu(c, ctx) {
  const b = composer(c.contenu, ctx, c.largeur ?? 80);
  if (!b || b.flux) return null;
  return { hauteur: 0, largeur: 0, absolu: true, dessiner(sortie) { b.dessiner(sortie, c.x ?? 0, c.y ?? 0); } };
}

/** Bloc réutilisable (lié) : composant du bloc, paramètres du bloc lisibles par `bloc.<nom>` et `parametres`. */
function composerBloc(c, ctx, largeur) {
  const def = ctx.blocs?.[c.bloc];
  if (!def) { alerter(ctx, 'BLOC_INTROUVABLE', `Bloc introuvable : ${c.bloc}`); return null; }
  if ((ctx.profondeur ?? 0) > 8) { alerter(ctx, 'BLOC_CYCLE', `Bloc ${c.bloc} : inclusion trop profonde (cycle ?)`); return null; }
  const params = {};
  for (const p of def.parametres ?? []) params[p.nom] = p.defaut ?? null;
  for (const [k, v] of Object.entries(c.parametres ?? {})) params[k] = typeof v === 'string' && (v.startsWith('=') || v.includes('{{')) ? evaluer(ctx, v, `bloc ${c.bloc}`) : v;
  return composer(def.contenu, enfant(ctx, { bloc: params, profondeur: (ctx.profondeur ?? 0) + 1 }), largeur);
}

// ---------------------------------------------------------------------------------------------------------------
// Tableaux (Q4) : colonnes, gabarits de rangée par condition (cellules fusionnées, bordures, fond, retrait),
// entête répétée à chaque page, report des cumuls, remplissage de la page par un cadre étiré.

const PAD_H = 1;
const PAD_V = 0.7;

/** Colonnes visibles et leurs positions. */
function colonnesTableau(c, ctx, largeur) {
  const cols = (c.colonnes ?? []).filter((k) => condition(ctx, k.condition, `colonne ${k.cle}`));
  const larg = repartirLargeurs(cols.map((k) => lireLongueur(k.largeur)), largeur, 0);
  let x = 0;
  return cols.map((k, i) => { const r = { ...k, x, l: larg[i], i }; x += larg[i]; return r; });
}

function composerTableau(c, ctx, largeur) {
  const cols = colonnesTableau(c, ctx, largeur);
  const index = new Map(cols.map((k) => [k.cle, k]));
  const bord = c.bordures ?? {};
  const traitCol = resoudreTrait(ctx.charte, bord.colonnes ?? 'fin');
  const traitCadre = resoudreTrait(ctx.charte, bord.cadre ?? 'fin');
  const traitLignes = resoudreTrait(ctx.charte, bord.lignes ?? null);
  const traitEntete = resoudreTrait(ctx.charte, bord.entete ?? bord.cadre ?? 'fin');

  // Cellule : texte mis en ligne dans la largeur des colonnes couvertes.
  const cellule = (def, ctxL, de, a, styleRangee) => {
    const k0 = index.get(de); const k1 = index.get(a ?? de);
    if (!k0 || !k1) return null;
    const x = k0.x; const l = k1.x + k1.l - k0.x;
    const retrait = def.retrait !== undefined ? Number(enTexte(evaluer(ctxL, typeof def.retrait === 'number' ? String(def.retrait) : def.retrait, 'retrait')) || 0) : 0;
    const style = [styleRangee, k0.style, def.style].filter(Boolean);
    const champ = {
      type: 'champ', valeur: def.valeur ?? '', style, format: def.format ?? (de === a || !a ? k0.format : undefined),
      alignement: def.alignement ?? k0.alignement ?? 'gauche', multiligne: def.multiligne ?? k0.multiligne ?? 'auto',
      html: def.html ?? k0.html, masquer_si_vide: false, zero_vide: def.zero_vide ?? k0.zero_vide,
      reduction_min: def.reduction_min ?? k0.reduction_min, lignes_max: def.lignes_max ?? k0.lignes_max,
    };
    const b = composerChamp(champ, ctxL, Math.max(1, l - 2 * PAD_H - retrait));
    return { x, l, b: b ?? vide(l, 0), retrait, de: k0.i, a: k1.i, fond: resoudreCouleur(ctx.charte, def.fond) };
  };

  // Rangée d'une ligne de données : premier gabarit dont la condition est vraie.
  const rangee = (el, i) => {
    const ctxL = enfant(ctx, { element: el, index: i });
    const g = (c.gabarits ?? [{}]).find((x) => condition(ctxL, x.condition, 'gabarit')) ?? null;
    if (!g || g.masquer) return null;
    let defs;
    if (g.cellules) defs = g.cellules.map((d) => ({ ...d, de: d.colonne ?? d.de, a: d.colonne ?? d.a ?? d.de }));
    else defs = cols.map((k) => ({ valeur: k.valeur, de: k.cle, a: k.cle, ...(g.surcharges?.[k.cle] ?? {}) }));
    const styleRangee = g.style ?? null;
    const cells = defs.map((d) => cellule(d, ctxL, d.de, d.a, styleRangee)).filter(Boolean);
    const cumuls = {};
    for (const k of cols) {
      if (!k.cumul) continue;
      const v = evaluer(ctxL, k.cumul, `cumul ${k.cle}`);
      try { const d = versDec(v); if (d !== null) cumuls[k.cle] = d; } catch { /* non numérique : ignoré */ }
    }
    return {
      boite: boiteRangee(cells, {
        fond: resoudreCouleur(ctx.charte, g.fond), haut: resoudreTrait(ctx.charte, g.bordures?.haut ?? null),
        bas: resoudreTrait(ctx.charte, g.bordures?.bas ?? null) ?? traitLignes,
        colonnes: g.bordures?.colonnes === false ? null : traitCol, cadre: traitCadre, hauteurMin: g.hauteur_min,
      }),
      garderAvecSuivant: g.garder_avec_suivant ? condition(ctxL, g.garder_avec_suivant === true ? '' : g.garder_avec_suivant) : false,
      lieAuPrecedent: g.lie_au_precedent ? condition(ctxL, g.lie_au_precedent === true ? '' : g.lie_au_precedent) : false,
      cumuls,
    };
  };

  // Rangée : cellules, séparateurs de colonnes hors fusions, cadre gauche / droite, traits haut / bas.
  function boiteRangee(cells, o) {
    const hauteur = Math.max(o.hauteurMin ?? 0, ...cells.map((k) => k.b.hauteur + 2 * PAD_V), 0);
    const bornes = new Set();
    for (const k of cells) for (let j = k.de + 1; j <= k.a; j++) bornes.add(j); // bornes internes aux fusions
    const b = {
      hauteur, largeur, cellules: cells,
      dessiner(sortie, x, y, hImp) {
        const h = hImp ?? hauteur;
        if (o.fond) sortie.push({ t: 'rect', x: r2(x), y: r2(y), l: r2(largeur), h: r2(h), fond: o.fond });
        for (const k of cells) {
          if (k.fond) sortie.push({ t: 'rect', x: r2(x + k.x), y: r2(y), l: r2(k.l), h: r2(h), fond: k.fond });
          k.b.dessiner(sortie, x + k.x + PAD_H + k.retrait, y + PAD_V);
        }
        if (o.colonnes) for (const k of cols) if (k.i > 0 && !bornes.has(k.i)) sortie.push({ t: 'ligne', x1: r2(x + k.x), y1: r2(y), x2: r2(x + k.x), y2: r2(y + h), trait: o.colonnes });
        if (o.cadre) {
          sortie.push({ t: 'ligne', x1: r2(x), y1: r2(y), x2: r2(x), y2: r2(y + h), trait: o.cadre });
          sortie.push({ t: 'ligne', x1: r2(x + largeur), y1: r2(y), x2: r2(x + largeur), y2: r2(y + h), trait: o.cadre });
        }
        if (o.haut) sortie.push({ t: 'ligne', x1: r2(x), y1: r2(y), x2: r2(x + largeur), y2: r2(y), trait: o.haut });
        if (o.bas) sortie.push({ t: 'ligne', x1: r2(x), y1: r2(y + h), x2: r2(x + largeur), y2: r2(y + h), trait: o.bas });
      },
    };
    if (cells.some((k) => k.b.decouper)) {
      b.decouper = (h) => {
        const hi = h - 2 * PAD_V;
        if (hi <= 0) return null;
        const parts = cells.map((k) => (k.b.hauteur <= hi + 0.001 ? [k.b, vide(k.l, 0)] : k.b.decouper ? k.b.decouper(hi) : null));
        if (parts.some((p) => !p)) return null;
        return [boiteRangee(cells.map((k, i) => ({ ...k, b: parts[i][0] })), { ...o, bas: null, hauteurMin: 0 }),
          boiteRangee(cells.map((k, i) => ({ ...k, b: parts[i][1] })), { ...o, haut: null, hauteurMin: 0 })];
      };
    }
    return b;
  }

  // Entête de colonnes.
  const ent = c.entete === false ? null : (() => {
    const e = c.entete ?? {};
    const cells = cols.map((k) => cellule({ valeur: k.titre ?? '', alignement: k.alignement_titre ?? k.alignement, html: false, multiligne: 'auto', format: '' }, ctx, k.cle, k.cle, e.style ?? 'entete_tableau'));
    return boiteRangee(cells, {
      fond: resoudreCouleur(ctx.charte, e.fond ?? 'fond_entete'), haut: traitEntete, bas: traitEntete,
      colonnes: traitCol, cadre: traitCadre,
    });
  })();

  // Ligne de report (« À reporter » en bas de page, « Report » en haut de la suivante).
  const colsReport = cols.filter((k) => k.cumul);
  const report = c.report === false || !colsReport.length ? null : (libelle, cumuls) => {
    const premier = colsReport[0].i;
    const cells = [];
    if (premier > 0) cells.push(cellule({ valeur: libelle, alignement: 'droite', html: false, format: '' }, ctx, cols[0].cle, cols[premier - 1].cle, c.report?.style ?? 'sous_total'));
    for (const k of colsReport) cells.push(cellule({ valeur: '=Parametre("__cumul")', format: k.format ?? 'montant', alignement: 'droite' }, enfant(ctx, { parametres: { ...ctx.parametres, __cumul: cumuls[k.cle] ?? null } }), k.cle, k.cle, c.report?.style ?? 'sous_total'));
    return boiteRangee(cells.filter(Boolean), { fond: resoudreCouleur(ctx.charte, c.report?.fond ?? 'fond_total'), haut: traitEntete, bas: traitEntete, colonnes: traitCol, cadre: traitCadre });
  };

  const donnees = evaluerExpression(ctx, c.collection, 'tableau');
  const liste = Array.isArray(donnees) ? donnees : [];
  const fragments = [];
  liste.forEach((el, i) => { const r = rangee(el, i); if (r) fragments.push(r); });
  const meta = {
    id: c.nom ?? 'tableau',
    entete: ent, report, largeur, remplir: !!c.remplir, colonnes: cols.map((k) => k.x).filter((x) => x > 0),
    traitCol, traitCadre, traitFin: traitEntete,
    libelleReport: c.report?.libelle ?? 'Report', libelleAReporter: c.report?.libelle_a_reporter ?? 'À reporter',
  };
  if (!fragments.length && c.vide) {
    const b = composerChamp({ type: 'champ', valeur: c.vide, style: 'discret', alignement: 'centre' }, ctx, largeur);
    if (b) fragments.push({ boite: b, cumuls: {} });
  }
  return { flux: fragments.map((f) => ({ ...f, tableau: meta })), tableau: meta };
}

export { pileDeBoites, boiteTexte, envelopper, vide };
