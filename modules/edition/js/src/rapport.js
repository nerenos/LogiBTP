// Édition d'un rapport : modèle + données → arbre de pages (mêmes pages dans le navigateur et dans Jint).
// Bandes (Q1, Q2) : ENTETE_PAGE, PIED_PAGE, FOND_PAGE (filigrane, zones fixes) composées pour chaque page ; CORPS
// (aussi TITRE et RESUME) en flux paginé ; modes UNIQUE, REPETE (une par élément d'une collection), GROUPE (rupture
// sur une expression : entête et pied de groupe, agrégats du groupe).
import { creerContexte, enfant, composer, evaluer, evaluerExpression, condition, alerter } from './composition.js';
import { paginer } from './pagination.js';
import { completerCharte } from './charte.js';
import { dimensionsPage } from './unites.js';
import { enTexte } from './formules.js';
import { normaliserModele } from './modele.js';
import { paginerEtiquettes } from './etiquettes.js';

const TYPES_PAGE = new Set(['ENTETE_PAGE', 'PIED_PAGE', 'FOND_PAGE']);

/** Une bande s'applique-t-elle à cette page ? (TOUTES, PREMIERE, SUIVANTES, DERNIERE, SAUF_DERNIERE, PAIRES, IMPAIRES) */
function pourPage(bande, numero, derniere) {
  switch (bande.pages ?? 'TOUTES') {
    case 'PREMIERE': return numero === 1;
    case 'SUIVANTES': return numero > 1;
    case 'DERNIERE': return derniere;
    case 'SAUF_DERNIERE': return !derniere;
    case 'PAIRES': return numero % 2 === 0;
    case 'IMPAIRES': return numero % 2 === 1;
    default: return true;
  }
}

/**
 * @param modele modèle d'édition (format JSON, voir modele.js)
 * @param donnees données de la source (objet racine)
 * @param env { polices, charte, ressources: { code: { type, octets, largeur, hauteur, dpi } }, blocs: { code: def },
 *              rapports: { code: modele } (sous-rapports), parametres, format, orientation, aujourdhui }
 * @returns { pages, alertes, page: { largeur, hauteur } }
 */
export function editer(modele, donnees, env) {
  const m = normaliserModele(modele);
  const charte = completerCharte(env.charte);
  const pageModele = m.page ?? {};
  const format = env.format && (pageModele.flexible ?? []).includes(env.format) ? env.format : pageModele.format;
  const dims = dimensionsPage({ ...pageModele, format, orientation: env.orientation ?? pageModele.orientation });
  const marges = { ...charte.marges, ...(pageModele.marges ?? {}) };
  const page = { ...dims, marges };
  const largeurUtile = dims.largeur - marges.gauche - marges.droite;

  const parametres = {};
  for (const p of m.parametres ?? []) parametres[p.nom] = p.defaut ?? null;
  Object.assign(parametres, env.parametres ?? {});

  const ctx = creerContexte({
    donnees, polices: env.polices, charte, ressources: env.ressources ?? {}, blocs: env.blocs ?? {},
    parametres, aujourdhui: env.aujourdhui ?? null, format: format ?? 'A4',
  });
  ctx.composerSousRapport = (c, ctxHote, largeur) => composerSousRapport(c, ctxHote, largeur, env);
  // Présentation des lignes (Q7) : demandée, sinon la première dont la condition `defaut_si` est vraie, sinon la
  // première ; ses paramètres s'appliquent avant ceux de la demande.
  const presentations = m.presentations ?? [];
  const presentation = presentations.find((x) => x.code === env.presentation)
    ?? presentations.find((x) => x.defaut_si && condition(ctx, x.defaut_si, `présentation ${x.code}`)) ?? presentations[0] ?? null;
  if (presentation) {
    Object.assign(ctx.parametres, presentation.parametres ?? {}, env.parametres ?? {}, { presentation: presentation.code });
    ctx.formule.parametres = ctx.parametres;
  }

  if (m.mode === 'ETIQUETTES') {
    const r = paginerEtiquettes(m, ctx, page, env);
    return { pages: r.pages, alertes: [...ctx.alertes, ...r.alertes], page: dims, presentation: presentation?.code ?? null };
  }

  // Corps : fragments.
  const fragments = [];
  for (const b of m.bandes.filter((x) => !TYPES_PAGE.has(x.type))) fragments.push(...fragmentsBande(b, ctx, largeurUtile));

  // Bandes de page : hauteurs estimées avant pagination (numéro de page provisoire), par variante de page.
  const bandesPage = m.bandes.filter((x) => TYPES_PAGE.has(x.type) && x.type !== 'FOND_PAGE');
  const cacheZones = new Map();
  const composerBandesPage = (type, numero, derniere, total) => {
    const ctxP = enfant(ctx, { page: { numero, total, derniere, premiere: numero === 1 } });
    const res = [];
    for (const b of bandesPage.filter((x) => x.type === type && pourPage(x, numero, derniere))) {
      if (!condition(ctxP, b.condition, `bande ${b.nom ?? type}`)) continue;
      const boite = composer(b.contenu, ctxP, largeurUtile);
      if (boite && !boite.flux) res.push(boite);
    }
    return res;
  };
  const zones = (numero, derniere) => {
    const cle = `${numero === 1 ? 1 : 2}|${derniere ? 1 : 0}`;
    if (!cacheZones.has(cle)) {
      const h = (type) => composerBandesPage(type, numero, derniere, Math.max(numero, 1)).reduce((a, b) => a + b.hauteur, 0);
      const ent = h('ENTETE_PAGE');
      const pied = h('PIED_PAGE');
      cacheZones.set(cle, { entete: ent ? ent + (m.page?.espace_entete ?? 3) : 0, pied: pied ? pied + (m.page?.espace_pied ?? 3) : 0 });
    }
    return cacheZones.get(cle);
  };

  const r = paginer(fragments, page, zones, ctx.alertes);

  // Bandes de page dessinées avec le vrai numéro et le nombre de pages ; fond de page en premier.
  const total = r.pages.length;
  for (const p of r.pages) {
    const derniere = p.numero === total;
    const fond = [];
    const ctxP = enfant(ctx, { page: { numero: p.numero, total, derniere, premiere: p.numero === 1 } });
    for (const b of m.bandes.filter((x) => x.type === 'FOND_PAGE' && pourPage(x, p.numero, derniere))) {
      if (!condition(ctxP, b.condition, `bande ${b.nom ?? 'FOND_PAGE'}`)) continue;
      const boite = composer(b.contenu, ctxP, largeurUtile);
      if (boite && !boite.flux) boite.dessiner(fond, marges.gauche, marges.haut);
    }
    let y = marges.haut;
    for (const b of composerBandesPage('ENTETE_PAGE', p.numero, derniere, total)) { b.dessiner(p.elements, marges.gauche, y); y += b.hauteur; }
    const pieds = composerBandesPage('PIED_PAGE', p.numero, derniere, total);
    let yp = dims.hauteur - marges.bas - pieds.reduce((a, b) => a + b.hauteur, 0);
    for (const b of pieds) { b.dessiner(p.elements, marges.gauche, yp); yp += b.hauteur; }
    if (fond.length) p.elements.unshift(...fond);
  }
  // Recto-verso : nombre de pages pair (page blanche ajoutée), marges en miroir sur les pages paires.
  if (pageModele.nombre_pair && r.pages.length % 2 === 1) r.pages.push({ numero: r.pages.length + 1, largeur: dims.largeur, hauteur: dims.hauteur, elements: [], blanche: true });
  if (pageModele.miroir && marges.droite !== marges.gauche) {
    const dx = marges.droite - marges.gauche;
    for (const p of r.pages) if (p.numero % 2 === 0) p.elements = p.elements.map((e) => decalerElement(e, dx));
  }
  return { pages: r.pages, alertes: ctx.alertes, page: dims, presentation: presentation?.code ?? null };
}

function decalerElement(e, dx) {
  const r = (v) => Math.round((v + dx) * 100) / 100;
  if (e.t === 'ligne') return { ...e, x1: r(e.x1), x2: r(e.x2) };
  return { ...e, x: r(e.x) };
}

/**
 * Plusieurs éditions en un seul document (lot d'impression) : pages mises bout à bout, numérotation propre à chaque
 * pièce (déjà portée par ses bandes de page), numéros d'ordre globaux en `rang`.
 */
export function assembler(resultats) {
  const pages = [];
  const alertes = [];
  for (const r of resultats) {
    for (const p of r.pages) pages.push({ ...p, rang: pages.length + 1 });
    alertes.push(...(r.alertes ?? []));
  }
  return { pages, alertes, page: resultats[0]?.page ?? null };
}

/** Fragments d'une bande du corps selon son mode. */
export function fragmentsBande(b, ctx, largeur) {
  if (!condition(ctx, b.condition, `bande ${b.nom ?? b.type ?? ''}`)) return [];
  const o = b.options ?? {};
  const res = [];
  const ajouter = (r) => {
    if (!r) return [];
    if (r.flux) return r.flux.map((f) => ({ ...f }));
    if (r.saut) return [{ boite: r }];
    return [{ boite: r, ...(r.absolu ? { absolu: true } : {}) }];
  };
  const mode = b.mode ?? 'UNIQUE';
  if (mode === 'UNIQUE') res.push(...appliquerOptions(ajouter(composer(b.contenu, ctx, largeur)), o));
  else if (mode === 'REPETE') {
    const liste = evaluerExpression(ctx, b.collection, `bande ${b.nom ?? ''}`);
    (Array.isArray(liste) ? liste : []).forEach((el, i) => {
      res.push(...appliquerOptions(ajouter(composer(b.contenu, enfant(ctx, { element: el, index: i }), largeur)), o));
    });
  } else if (mode === 'GROUPE') {
    const liste = evaluerExpression(ctx, b.collection, `bande ${b.nom ?? ''}`);
    const groupes = [];
    for (const [i, el] of (Array.isArray(liste) ? liste : []).entries()) {
      const v = enTexte(evaluerExpression(enfant(ctx, { element: el, index: i }), b.rupture, 'rupture'));
      let g = groupes[groupes.length - 1];
      if (!g || g.valeur !== v) { g = { valeur: v, elements: [] }; groupes.push(g); }
      g.elements.push(el);
    }
    groupes.forEach((g, ig) => {
      const ctxG = enfant(ctx, { groupe: { ...g, rang: ig + 1, premier: g.elements[0] }, element: g.elements[0] });
      const frs = [];
      const portee = o.entete_chaque_page ? { groupe: ig } : null;
      if (b.entete) {
        // Entête de groupe : répétée en haut des pages suivantes tant que le groupe continue (`groupe.suite` vrai).
        const suite = o.entete_chaque_page ? ajouter(composer(b.entete, enfant(ctxG, { groupe: { ...ctxG.groupe, suite: true } }), largeur)) : [];
        frs.push(...ajouter(composer(b.entete, ctxG, largeur)).map((f, i) => ({
          ...f, garderAvecSuivant: true, ...(portee ? { chaquePage: true, portee, boiteRepetee: suite[i]?.boite } : {}),
        })));
      }
      if (!b.regrouper) {
        g.elements.forEach((el, i) => frs.push(...ajouter(composer(b.contenu, enfant(ctxG, { element: el, index: i }), largeur))));
      } else if (b.contenu) frs.push(...ajouter(composer(b.contenu, ctxG, largeur)));
      if (b.pied) frs.push(...ajouter(composer(b.pied, ctxG, largeur)).map((f, i) => (i === 0 ? { ...f, lieAuPrecedent: true } : f)));
      if (portee) frs.forEach((f) => { f.portee = portee; });
      res.push(...appliquerOptions(frs, { ...o, saut_apres: o.saut_par_groupe && ig < groupes.length - 1 ? true : o.saut_apres }));
    });
  } else alerter(ctx, 'MODE_INCONNU', `Mode de bande inconnu : ${mode}`);
  return res;
}

function appliquerOptions(frs, o) {
  if (!frs.length) return frs;
  if (o.saut_avant) frs[0].sautAvant = true;
  if (o.saut_apres) frs[frs.length - 1].sautApres = true;
  if (o.garder_ensemble) frs.slice(0, -1).forEach((f) => { f.garderAvecSuivant = true; });
  if (o.garder_avec_suivant) frs[frs.length - 1].garderAvecSuivant = true;
  if (o.bas_de_page) frs.forEach((f) => { f.basDePage = true; });
  if (o.chaque_page) frs.forEach((f) => { f.chaquePage = true; });
  return frs;
}

/**
 * Sous-rapport (Q6, trois niveaux) : bandes du corps d'un autre rapport, composées avec ses données (collection de
 * l'hôte ou autre source fournie par le serveur sous `sources.<nom>`), empilées dans le flux de l'hôte.
 */
function composerSousRapport(c, ctx, largeur, env) {
  const niveau = (ctx.niveauSousRapport ?? 0) + 1;
  if (niveau > 3) { alerter(ctx, 'SOUS_RAPPORT_NIVEAU', `Sous-rapport ${c.rapport} : plus de trois niveaux`); return null; }
  const def = env.rapports?.[c.rapport];
  if (!def) { alerter(ctx, 'SOUS_RAPPORT_INTROUVABLE', `Sous-rapport introuvable : ${c.rapport}`); return null; }
  const sm = normaliserModele(def);
  const donnees = c.donnees ? evaluerExpression(ctx, c.donnees, `sous-rapport ${c.rapport}`) : ctx.donnees;
  if (donnees === null || donnees === undefined || (Array.isArray(donnees) && !donnees.length)) return null;
  const params = { ...ctx.parametres };
  for (const p of sm.parametres ?? []) if (!(p.nom in params)) params[p.nom] = p.defaut ?? null;
  for (const [k, v] of Object.entries(c.parametres ?? {})) params[k] = typeof v === 'string' && (v.startsWith('=') || v.includes('{{')) ? evaluer(ctx, v) : v;
  const ctxS = enfant(ctx, {
    donnees: Array.isArray(donnees) ? { elements: donnees, hote: ctx.donnees } : { ...donnees, hote: ctx.donnees },
    element: null, groupe: null, parametres: params, niveauSousRapport: niveau,
  });
  const frs = [];
  for (const b of sm.bandes.filter((x) => !TYPES_PAGE.has(x.type))) frs.push(...fragmentsBande(b, ctxS, largeur));
  return frs.length ? { flux: frs } : null;
}
