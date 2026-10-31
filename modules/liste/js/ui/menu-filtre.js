import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper } from '@logibtp/socle/ui';
import { normaliser } from '../src/normaliser.js';
import {
  valeursDistinctes, formatsPresents, estNumerique, filtreActif, OPERATEURS_NOMBRE, OPERATEURS_TEXTE,
} from '../src/filtres.js';

// Menu d'une colonne, façon tableur : tri (lignes chargées ou toute la base), filtre par valeurs distinctes,
// par condition (nombres et dates : supérieur à, égal à, entre… ; textes : contient, commence par…)
// et par mise en forme (couleur de fond, couleur de police, gras, italique, souligné, barré).
// Les filtres portent sur les lignes chargées.

let ouvert = null;

export function fermerMenuFiltre() {
  ouvert?.fermer();
}

const opt = (v, l, courant) => `<option value="${echapper(v)}" ${String(courant ?? '') === String(v) ? 'selected' : ''}>${echapper(l)}</option>`;
const triEtat = (nom, libelle, v) => `<label>${libelle}<select data-format="${nom}">
  ${opt('', texte('liste.menu.indifferent'), v === undefined || v === null ? '' : String(v))}${opt('true', texte('commun.oui'), v === true ? 'true' : '')}${opt('false', texte('commun.non'), v === false ? 'false' : '')}</select></label>`;

/**
 * Ouvre le menu sous `ancre`. `appliquer(filtre | null)` reçoit le nouveau filtre ; `trier(sens, base)` trie
 * les lignes chargées (base = false) ou toute la base (base = true, indisponible pour une colonne calculée).
 * Options : `triBase` (boutons de tri de toute la base) et `miseEnForme` (filtre par mise en forme), affichés par défaut.
 */
export function ouvrirMenuFiltre({ ancre, colonne, modele, lignes, filtre, appliquer, trier, triBase = true, miseEnForme = true }) {
  fermerMenuFiltre();
  const distinctes = valeursDistinctes(lignes, colonne, modele);
  const formats = formatsPresents(lignes, colonne, modele);
  const numerique = estNumerique(colonne);
  const ops = numerique ? OPERATEURS_NOMBRE : OPERATEURS_TEXTE;
  const retenues = filtre?.valeurs instanceof Set ? filtre.valeurs : null;
  const cond = filtre?.condition ?? {};
  const fmt = filtre?.format ?? {};
  const pastilles = (nom, couleurs, courant) => `
    <div class="liste-pastilles" data-pastilles="${nom}">
      <button type="button" data-couleur="" class="${courant === undefined || courant === null ? 'actif' : ''}">${texteHtml('liste.menu.toutes')}</button>
      <button type="button" data-couleur="aucune" class="${courant === '' ? 'actif' : ''}" title="${texteHtml('liste.menu.sans_couleur')}">${iconeHtml('liste_sans_couleur')}</button>
      ${couleurs.map((c) => `<button type="button" data-couleur="${echapper(c)}" class="pastille ${courant === c ? 'actif' : ''}" style="background:${echapper(c)}" title="${echapper(c)}"></button>`).join('')}
    </div>`;

  const menu = document.createElement('div');
  menu.className = 'liste-menu';
  menu.innerHTML = `
    <div class="liste-menu-tri">
      <button type="button" data-tri="asc" title="${texteHtml('liste.menu.trier_charge')}">${texteHtml(numerique ? 'liste.menu.tri_nombre_asc' : 'liste.menu.tri_texte_asc')}</button>
      <button type="button" data-tri="desc" title="${texteHtml('liste.menu.trier_charge')}">${texteHtml(numerique ? 'liste.menu.tri_nombre_desc' : 'liste.menu.tri_texte_desc')}</button>
      ${triBase ? `<button type="button" data-tri-base="asc" ${colonne.calcul ? `disabled title="${texteHtml('liste.menu.tri_calcule')}"` : `title="${texteHtml('liste.menu.tri_base_aide')}"`}>${texteHtml('liste.menu.tri_base')} ${iconeHtml('liste_tri_asc')}</button>
      <button type="button" data-tri-base="desc" ${colonne.calcul ? 'disabled' : ''}>${texteHtml('liste.menu.tri_base')} ${iconeHtml('liste_tri_desc')}</button>` : ''}
    </div>
    <details open><summary>${texteHtml('liste.menu.valeurs', { nombre: distinctes.length })}</summary>
      <input type="search" data-recherche placeholder="${texteHtml('liste.menu.rechercher')}">
      <div class="liste-menu-valeurs">
        <label class="tout"><input type="checkbox" data-tout> ${texteHtml('liste.menu.tout')}</label>
        ${distinctes.map((d, i) => `<label data-texte="${echapper(normaliser(d.texte))}"><input type="checkbox" data-valeur="${i}" ${!retenues || retenues.has(d.texte) ? 'checked' : ''}>
          ${d.texte === '' ? `<em>${texteHtml('liste.menu.vides')}</em>` : echapper(d.texte)} <small>${d.nombre}</small></label>`).join('')}
      </div>
    </details>
    <details ${cond.op ? 'open' : ''}><summary>${texteHtml('liste.menu.condition')}</summary>
      <div class="liste-menu-condition">
        <select data-op>${opt('', '—', cond.op)}${ops.map(([v, l]) => opt(v, l, cond.op)).join('')}</select>
        <input data-a value="${echapper(cond.a ?? '')}" placeholder="${texteHtml(numerique ? (colonne.format === 'date' ? 'liste.menu.saisie_date' : 'liste.menu.saisie_nombre') : 'liste.menu.saisie_texte')}">
        <input data-b value="${echapper(cond.b ?? '')}" placeholder="${texteHtml('liste.menu.et')}">
      </div>
    </details>
    <details ${filtreActif({ format: fmt }) ? 'open' : ''} ${miseEnForme ? '' : 'hidden'}><summary>${texteHtml('liste.menu.mise_en_forme')}</summary>
      <div class="liste-menu-format">
        <span>${texteHtml('liste.menu.fond')}</span>${pastilles('fond', formats.fonds, fmt.fond)}
        <span>${texteHtml('liste.menu.couleur')}</span>${pastilles('couleur', formats.couleurs, fmt.couleur)}
        ${['gras', 'italique', 'souligne', 'barre'].map((n) => triEtat(n, texteHtml(`liste.menu.styles.${n}`), fmt[n])).join('')}
      </div>
    </details>
    <div class="liste-menu-boutons">
      <button type="button" data-action="effacer">${texteHtml('liste.menu.effacer')}</button>
      <button type="button" data-action="annuler">${texteHtml('commun.annuler')}</button>
      <button type="button" class="principal" data-action="ok">${texteHtml('commun.ok')}</button>
    </div>`;
  document.body.append(menu);

  // Position : sous l'ancre, gardé dans la fenêtre.
  const r = ancre.getBoundingClientRect();
  const largeur = menu.offsetWidth;
  menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - largeur - 4))}px`;
  menu.style.top = `${Math.min(r.bottom + 2, window.innerHeight - menu.offsetHeight - 4)}px`;

  const cases = [...menu.querySelectorAll('[data-valeur]')];
  const tout = menu.querySelector('[data-tout]');
  const majTout = () => {
    const visibles = cases.filter((c) => !c.closest('label').hidden);
    tout.checked = visibles.every((c) => c.checked);
    tout.indeterminate = !tout.checked && visibles.some((c) => c.checked);
  };
  majTout();
  tout.addEventListener('change', () => { cases.filter((c) => !c.closest('label').hidden).forEach((c) => { c.checked = tout.checked; }); });
  cases.forEach((c) => c.addEventListener('change', majTout));
  menu.querySelector('[data-recherche]').addEventListener('input', (e) => {
    const t = normaliser(e.target.value);
    cases.forEach((c) => { const l = c.closest('label'); l.hidden = !!t && !l.dataset.texte.includes(t); });
    majTout();
  });
  const op = menu.querySelector('[data-op]');
  const majOp = () => {
    menu.querySelector('[data-a]').hidden = !op.value || op.value === 'vide' || op.value === 'nonvide';
    menu.querySelector('[data-b]').hidden = op.value !== 'entre';
  };
  op.addEventListener('change', majOp);
  majOp();
  menu.querySelectorAll('[data-pastilles]').forEach((zone) => zone.querySelectorAll('[data-couleur]').forEach((b) => b.addEventListener('click', () => {
    zone.querySelectorAll('[data-couleur]').forEach((x) => x.classList.toggle('actif', x === b));
  })));

  const lire = () => {
    const cochees = cases.filter((c) => c.checked).map((c) => distinctes[Number(c.dataset.valeur)].texte);
    const valeurs = cochees.length === distinctes.length ? null : new Set(cochees);
    const condition = op.value ? { op: op.value, a: menu.querySelector('[data-a]').value, b: menu.querySelector('[data-b]').value } : null;
    const format = {};
    menu.querySelectorAll('[data-pastilles]').forEach((zone) => {
      const v = zone.querySelector('.actif')?.dataset.couleur ?? '';
      if (v) format[zone.dataset.pastilles] = v === 'aucune' ? '' : v;
    });
    menu.querySelectorAll('[data-format]').forEach((s) => { if (s.value) format[s.dataset.format] = s.value === 'true'; });
    const f = { valeurs, condition, format: Object.keys(format).length ? format : null };
    return filtreActif(f) ? f : null;
  };

  const fermer = () => {
    menu.remove();
    document.removeEventListener('mousedown', dehors, true);
    document.removeEventListener('keydown', clavier, true);
    if (ouvert?.menu === menu) ouvert = null;
  };
  const dehors = (e) => { if (!menu.contains(e.target) && e.target !== ancre) fermer(); };
  const clavier = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); fermer(); }
    if (e.key === 'Enter' && !e.target.matches('button')) { e.preventDefault(); appliquer(lire()); fermer(); }
  };
  document.addEventListener('mousedown', dehors, true);
  document.addEventListener('keydown', clavier, true);
  menu.querySelector('[data-action="ok"]').addEventListener('click', () => { appliquer(lire()); fermer(); });
  menu.querySelector('[data-action="effacer"]').addEventListener('click', () => { appliquer(null); fermer(); });
  menu.querySelector('[data-action="annuler"]').addEventListener('click', fermer);
  menu.querySelectorAll('[data-tri]').forEach((b) => b.addEventListener('click', () => { trier(b.dataset.tri, false); fermer(); }));
  menu.querySelectorAll('[data-tri-base]').forEach((b) => b.addEventListener('click', () => { trier(b.dataset.triBase, true); fermer(); }));
  ouvert = { menu, fermer };
  menu.querySelector('[data-recherche]').focus();
  return ouvert;
}
