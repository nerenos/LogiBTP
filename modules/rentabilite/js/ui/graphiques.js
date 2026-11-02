// Graphiques d'évolution d'un chantier (ANALYSE-MODULE-ANALYSE.md § 10.3, lot 8) : courbes SVG sans bibliothèque (un
// seul axe en euros, traits de 2 px, points de 8 px, grille discrète, légende et étiquette en bout de courbe, réticule
// et bulle au survol, tableau des valeurs pour la lecture sans couleur). Couleurs des séries : variables
// --rentabilite-serie-<n> du thème (palette catégorielle validée en clair et en sombre).
import { texte, texteHtml, langue } from '@logibtp/socle/dictionnaire';
import { formatNombre, formatDate, echapper } from '@logibtp/socle/ui';
import { COUT } from '../src/indicateurs.js';
import { seriesEvolution, echelle } from '../src/evolution.js';

const L = 720;
const H = 260;
const MARGE = { haut: 16, droite: 130, bas: 30, gauche: 56 };
let compact = null;
const court = (v) => (compact ??= new Intl.NumberFormat(langue(), { notation: 'compact', maximumFractionDigits: 1 })).format(Number(v.toString()));
const montant = (v) => (v === null || v === undefined ? '—' : formatNombre(v.toString(), 2));
const n = (v) => Number(v.toString());

/**
 * Courbes sur un axe commun. series : [{ code, libelle, court (étiquette en bout de courbe), rang (1 à 4 : couleur), valeurs: Decimal[] }] ; etiquettes :
 * libellé de chaque abscisse ; titre, resume (phrase au-dessus).
 */
export function graphiqueCourbes({ titre, resume = '', etiquettes, series }) {
  const e = echelle(series.flatMap((s) => s.valeurs));
  const largeur = L - MARGE.gauche - MARGE.droite;
  const hauteur = H - MARGE.haut - MARGE.bas;
  const x = (i) => MARGE.gauche + (etiquettes.length === 1 ? largeur / 2 : (i * largeur) / (etiquettes.length - 1));
  const y = (v) => MARGE.haut + hauteur - ((n(v) - n(e.min)) / (n(e.max) - n(e.min))) * hauteur;
  const grille = e.graduations.map((g) => `<line class="rentabilite-grille${g.isZero() ? ' rentabilite-zero' : ''}" x1="${MARGE.gauche}" x2="${MARGE.gauche + largeur}" y1="${y(g)}" y2="${y(g)}"/>
    <text class="rentabilite-axe" x="${MARGE.gauche - 6}" y="${y(g)}" text-anchor="end" dominant-baseline="middle">${echapper(court(g))}</text>`).join('');
  // Abscisses : toutes si elles tiennent, sinon une sur deux ou plus (la dernière toujours).
  const saut = Math.max(1, Math.ceil(etiquettes.length / 8));
  const abscisses = etiquettes.map((t, i) => ((i % saut === 0 || i === etiquettes.length - 1)
    ? `<text class="rentabilite-axe" x="${x(i)}" y="${H - 8}" text-anchor="middle">${echapper(t)}</text>` : '')).join('');
  // Étiquettes en bout de courbe, écartées pour ne pas se chevaucher (12 px au moins).
  const fins = series.map((s) => ({ s, y: y(s.valeurs.at(-1)) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < fins.length; i++) fins[i].y = Math.max(fins[i].y, fins[i - 1].y + 13);
  const courbes = series.map((s) => {
    const pts = s.valeurs.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    return `<g class="rentabilite-serie-${s.rang}">
      ${s.valeurs.length > 1 ? `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
      ${s.valeurs.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="currentColor" stroke="var(--surface)" stroke-width="2"/>`).join('')}</g>`;
  }).join('');
  // Étiquette courte au bout de chaque courbe (à côté du dernier point) : l'identité ne dépend pas de la seule couleur.
  const bouts = fins.map(({ s, y: yy }) => `<text class="rentabilite-etiquette" x="${MARGE.gauche + largeur + 9}" y="${yy}" dominant-baseline="middle">${
    echapper(s.court ?? s.libelle)} ${echapper(court(s.valeurs.at(-1)))}</text>`).join('');
  const legende = series.length > 1 ? `<ul class="rentabilite-legende">${series.map((s) => `<li><span class="rentabilite-pastille rentabilite-serie-${s.rang}"></span>${echapper(s.libelle)}</li>`).join('')}</ul>` : '';
  const tableau = `<details class="rentabilite-graphique-tableau"><summary>${texteHtml('rentabilite.graphiques.tableau')}</summary>
    <table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite.graphiques.date')}</th>${series.map((s) => `<th class="montant">${echapper(s.libelle)}</th>`).join('')}</tr></thead>
    <tbody>${etiquettes.map((t, i) => `<tr><th scope="row">${echapper(t)}</th>${series.map((s) => `<td class="montant">${montant(s.valeurs[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
  return `<figure class="rentabilite-graphique">
    <figcaption><strong>${echapper(titre)}</strong>${resume ? ` <span class="aide">${echapper(resume)}</span>` : ''}</figcaption>
    ${legende}
    <div class="rentabilite-graphique-zone">
      <svg viewBox="0 0 ${L} ${H}" role="img" aria-label="${echapper(titre)}">${grille}${abscisses}${courbes}${bouts}
        <line class="rentabilite-reticule" x1="0" x2="0" y1="${MARGE.haut}" y2="${MARGE.haut + hauteur}" visibility="hidden"/>
        <rect class="rentabilite-survol" x="${MARGE.gauche - 10}" y="0" width="${largeur + 20}" height="${H}" fill="transparent"/></svg>
      <div class="rentabilite-bulle" hidden></div>
    </div>${tableau}</figure>`;
}

/** Réticule et bulle au survol des graphiques d'une zone (valeur de chaque série au point le plus proche). */
function brancherSurvol(zone, graphiques) {
  zone.querySelectorAll('figure.rentabilite-graphique').forEach((fig, k) => {
    const { etiquettes, series } = graphiques[k];
    const svg = fig.querySelector('svg');
    const reticule = fig.querySelector('.rentabilite-reticule');
    const bulle = fig.querySelector('.rentabilite-bulle');
    const largeur = L - MARGE.gauche - MARGE.droite;
    const masquer = () => { reticule.setAttribute('visibility', 'hidden'); bulle.hidden = true; };
    fig.querySelector('.rentabilite-survol').addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect();
      const xv = ((ev.clientX - r.left) / r.width) * L;
      const i = etiquettes.length === 1 ? 0 : Math.max(0, Math.min(etiquettes.length - 1, Math.round(((xv - MARGE.gauche) / largeur) * (etiquettes.length - 1))));
      const xi = MARGE.gauche + (etiquettes.length === 1 ? largeur / 2 : (i * largeur) / (etiquettes.length - 1));
      reticule.setAttribute('x1', xi);
      reticule.setAttribute('x2', xi);
      reticule.setAttribute('visibility', 'visible');
      bulle.innerHTML = `<strong>${echapper(etiquettes[i])}</strong>${series.map((s) => `<div><span class="rentabilite-pastille rentabilite-serie-${s.rang}"></span>${echapper(s.libelle)} <b>${montant(s.valeurs[i])}</b></div>`).join('')}`;
      bulle.hidden = false;
      const px = (xi / L) * r.width;
      bulle.style.left = `${px > r.width / 2 ? px - bulle.offsetWidth - 12 : px + 12}px`;
      bulle.style.top = `${MARGE.haut}px`;
    });
    fig.querySelector('.rentabilite-survol').addEventListener('mouseleave', masquer);
  });
}

/**
 * Graphiques d'évolution du Détail : budget PV, facturé cumulé, dépensé et coût à terminaison sur un axe ; marge à
 * terminaison sur un second graphique (jamais deux échelles sur un même axe). Sans les coûts : budget et facturé seuls.
 */
export class GraphiquesEvolution {
  #zone;

  constructor(zone) { this.#zone = zone; }

  /** donnees : { voir_couts, points: [{ date, type, libelle, agregats }] } du serveur ; options : { cout }. */
  rendre(donnees, { cout = COUT.PR } = {}) {
    const points = donnees.points ?? [];
    if (points.length < 2) {
      this.#zone.innerHTML = `<h2>${texteHtml('rentabilite.graphiques.titre')}</h2><p class="aide">${texteHtml('rentabilite.graphiques.pas_assez')}</p>`;
      return;
    }
    const { series: s } = seriesEvolution(points, cout);
    const etiquettes = points.map((p, i) => (i === points.length - 1 ? texte('rentabilite.graphiques.aujourdhui') : formatDate(p.date)));
    const libelle = (c) => texte(`rentabilite.graphiques.series.${c}`);
    const libelleCourt = (c) => texte(`rentabilite.graphiques.courts.${c}`);
    const couts = donnees.voir_couts;
    const courbes = { titre: texte('rentabilite.graphiques.montants'), etiquettes, resume: texte(couts ? 'rentabilite.graphiques.montants_resume' : 'rentabilite.graphiques.montants_resume_pv'),
      series: [
        { code: 'budget', libelle: libelle('budget'), court: libelleCourt('budget'), rang: 1, valeurs: s.budget },
        { code: 'facture', libelle: libelle('facture'), court: libelleCourt('facture'), rang: 2, valeurs: s.facture },
        ...(couts ? [
          { code: 'depense', libelle: libelle(cout === COUT.PA ? 'depense_pa' : 'depense'), court: libelleCourt('depense'), rang: 3, valeurs: s.depense },
          { code: 'terminaison', libelle: libelle(cout === COUT.PA ? 'terminaison_pa' : 'terminaison'), court: libelleCourt('terminaison'), rang: 4, valeurs: s.terminaison },
        ] : []),
      ] };
    const derniere = s.taux.at(-1);
    const marge = couts ? { titre: texte(cout === COUT.PA ? 'rentabilite.graphiques.marge_brute' : 'rentabilite.graphiques.marge_nette'), etiquettes,
      resume: derniere === null ? '' : texte('rentabilite.graphiques.marge_resume', { taux: formatNombre(derniere.toDecimalPlaces(1).toString(), 1) }),
      series: [{ code: 'marge', libelle: libelle('marge'), court: libelleCourt('marge'), rang: 1, valeurs: s.marge }] } : null;
    const graphiques = [courbes, ...(marge ? [marge] : [])];
    this.#zone.innerHTML = `<h2>${texteHtml('rentabilite.graphiques.titre')}</h2>
      <div class="rentabilite-graphiques">${graphiques.map(graphiqueCourbes).join('')}</div>
      <p class="aide">${texteHtml('rentabilite.graphiques.aide')}</p>`;
    brancherSurvol(this.#zone, graphiques);
  }
}
