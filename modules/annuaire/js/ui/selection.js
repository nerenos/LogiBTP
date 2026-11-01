import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper } from '@logibtp/socle/ui';
import { dialogue } from './coordonnees.js';

// Sélections de l'annuaire : choix d'une personne ou d'un individu (recherche, création d'un nouvel individu), cases
// de codes (relations, rôles) en pastilles.

const CIVILITES = ['M.', 'Mme'];

/**
 * Recherche d'une personne ; résout avec son résumé ou null. Options : annuaire, casquette, titre, exclure (ids).
 */
export async function choisirPersonne({ annuaire, casquette = '', titre = texte('annuaire.selection.personne'), exclure = [] }) {
  const d = dialogue(titre, `<div class="annuaire-recherche"><input type="search" placeholder="${texteHtml('annuaire.selection.personne_aide')}"></div><div class="annuaire-resultats"></div>`, texte('annuaire.selection.choisir'));
  return choisir(d, async (q) => (await annuaire.rechercherPersonnes({ recherche: q, casquette, limite: 40 })).filter((p) => !exclure.includes(p.id)),
    (p) => `<td>${echapper(p.icone ?? icone('annuaire_personne'))}</td><td><b>${echapper(p.raison_sociale)}</b>${p.chemin && p.chemin !== p.raison_sociale ? `<br><small class="aide">${echapper(p.chemin)}</small>` : ''}</td>
      <td>${echapper(p.niveau_libelle ?? '')}</td><td>${echapper(p.ville ?? '')}</td><td class="aide">${echapper(p.code ?? '')}</td>${p.actif ? '' : `<td class="aide">${texteHtml('annuaire.selection.inactif')}</td>`}`);
}

/**
 * Recherche d'un individu, ou création d'un nouvel individu (civilité, prénom, nom) ; résout avec
 * { individu } (existant), { nouveau: { civilite, prenom, nom } } ou null.
 */
export async function choisirIndividu({ annuaire, titre = texte('annuaire.selection.individu'), exclure = [], nom = '' }) {
  const d = dialogue(titre, `<div class="annuaire-recherche"><input type="search" placeholder="${texteHtml('annuaire.selection.individu_aide')}" value="${echapper(nom)}"></div>
    <div class="annuaire-resultats"></div>
    <fieldset class="annuaire-nouveau"><legend>${texteHtml('annuaire.selection.nouveau')}</legend>
      <select data-n="civilite"><option value=""></option>${CIVILITES.map((c) => `<option>${c}</option>`).join('')}</select>
      <input data-n="prenom" placeholder="${texteHtml('annuaire.selection.prenom')}"><input data-n="nom" placeholder="${texteHtml('annuaire.selection.nom')}"><button type="button" data-creer>${texteHtml('commun.creer')}</button>
      <p class="aide">${texteHtml('annuaire.selection.nouveau_aide')}</p></fieldset>`, texte('annuaire.selection.choisir'));
  let nouveau = null;
  d.corps.querySelector('[data-creer]').addEventListener('click', () => {
    const v = Object.fromEntries([...d.corps.querySelectorAll('[data-n]')].map((x) => [x.dataset.n, x.value.trim() || null]));
    if (!v.nom) { d.message.textContent = texte('annuaire.selection.nom_obligatoire'); d.message.className = 'fiche-dialogue-message erreur'; return; }
    nouveau = v;
    d.fermer(true);
  });
  const r = await choisir(d, async (q) => (await annuaire.rechercherIndividus({ recherche: q, limite: 40 })).filter((i) => !exclure.includes(i.id)),
    (i) => `<td>${iconeHtml('annuaire_individu')}</td><td><b>${echapper(i.nom_complet)}</b></td><td>${echapper(i.personnes ?? '')}</td><td>${echapper(i.email ?? '')}</td><td>${echapper(i.telephone ?? '')}</td>`);
  if (nouveau) return { nouveau };
  return r ? { individu: r } : null;
}

async function choisir(d, chercher, cellules) {
  const entree = d.corps.querySelector('input[type="search"]');
  const zone = d.corps.querySelector('.annuaire-resultats');
  let resultats = [];
  let actif = -1;
  const surligner = () => zone.querySelectorAll('tr[data-i]').forEach((tr) => tr.classList.toggle('actif', Number(tr.dataset.i) === actif));
  const lancer = async () => {
    resultats = await chercher(entree.value);
    actif = resultats.length ? 0 : -1;
    zone.innerHTML = resultats.length ? `<table class="coord-table selectionnable"><tbody>${resultats.map((x, i) => `<tr data-i="${i}">${cellules(x)}</tr>`).join('')}</tbody></table>`
      : `<p class="aide">${texteHtml('annuaire.selection.aucun_resultat')}</p>`;
    surligner();
  };
  let minuterie;
  entree.addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(lancer, 200); });
  zone.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) { actif = Number(tr.dataset.i); surligner(); } });
  zone.addEventListener('dblclick', (e) => { if (e.target.closest('tr[data-i]')) d.fermer(true); });
  entree.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      actif = Math.min(Math.max(actif + (e.key === 'ArrowDown' ? 1 : -1), 0), resultats.length - 1);
      surligner();
    } else if (e.key === 'Enter' && actif >= 0) { e.preventDefault(); d.fermer(true); }
  });
  entree.focus();
  await lancer();
  const ok = await d.resultat;
  return ok && actif >= 0 ? resultats[actif] : null;
}

/**
 * Pastilles à cocher (casquettes, rôles) : options [{ code, libelle, icone, actif }] ; renvoie l'élément.
 * surChange(codes) à chaque changement ; en lecture, seules les pastilles cochées sont affichées.
 */
export function pastilles({ options, valeur = [], modifiable, surChange }) {
  const el = document.createElement('div');
  el.className = 'annuaire-pastilles';
  const codes = new Set(valeur ?? []);
  const visibles = options.filter((o) => (modifiable ? o.actif !== false || codes.has(o.code) : codes.has(o.code)));
  el.innerHTML = visibles.map((o) => `<label class="pastille ${codes.has(o.code) ? 'cochee' : ''}" title="${echapper(o.libelle)}">
    <input type="checkbox" value="${echapper(o.code)}" ${codes.has(o.code) ? 'checked' : ''} ${modifiable ? '' : 'disabled'}>${o.icone ? `${echapper(o.icone)} ` : ''}${echapper(o.libelle)}</label>`).join('')
    || `<span class="aide">${texteHtml('annuaire.selection.aucune')}</span>`;
  el.querySelectorAll('input').forEach((c) => c.addEventListener('change', () => {
    c.closest('.pastille').classList.toggle('cochee', c.checked);
    surChange([...el.querySelectorAll('input:checked')].map((x) => x.value));
  }));
  return el;
}
