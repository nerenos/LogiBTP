import { texte, texteHtml } from '@logibtp/socle/dictionnaire';
import { ERREUR_ANNUAIRE } from '../src/codes.js';
import { echapper } from '@logibtp/socle/ui';
import { dialogue } from './coordonnees.js';
import { choisirPersonne } from './selection.js';

// Tiers provisoires : saisie d'un nouveau tiers après contrôle des doublons (SIRET, nom), puis, pour un utilisateur
// habilité, validation de la création ou fusion dans une fiche existante (valeurs choisies champ par champ).

const ligneResume = (p) => `<b>${echapper(p.raison_sociale)}</b> <small class="aide">${echapper([p.code, p.ville, p.siret].filter(Boolean).join(' · '))}</small>`
  + (p.provisoire ? ` <span class="annuaire-provisoire">${texteHtml('annuaire.provisoire.provisoire')}</span>` : '');

/**
 * Nouveau tiers provisoire : raison sociale et SIRET, doublons proposés avant la création (un SIRET connu impose la
 * fiche existante, des noms proches demandent confirmation). Résout avec le résumé du tiers choisi ou créé, ou null.
 * casquettes : relations du tiers (ex. CLIENT), gardées si elles existent dans le référentiel.
 */
export async function creerTiersProvisoire({ annuaire, raison_sociale = '', siret = '', casquettes = [], titre = texte('annuaire.provisoire.titre') }) {
  const refs = await annuaire.referentiels().catch(() => ({ casquettes: [] }));
  const relations = casquettes.filter((c) => refs.casquettes.some((x) => x.code === c));
  const d = dialogue(titre, `<div class="annuaire-provisoire-saisie">
      <label>${texteHtml('annuaire.provisoire.raison_sociale')} <input data-n="raison_sociale" value="${echapper(raison_sociale)}"></label>
      <label>${texteHtml('annuaire.provisoire.siret')} <input data-n="siret" value="${echapper(siret)}" inputmode="numeric" placeholder="${texteHtml('annuaire.provisoire.facultatif')}"></label>
      <button type="button" class="principal" data-verifier>${texteHtml('annuaire.provisoire.verifier')}</button></div>
    <div class="annuaire-doublons"></div>
    <p class="aide">${texteHtml('annuaire.provisoire.aide_html')}</p>`);
  const zone = d.corps.querySelector('.annuaire-doublons');
  const valeur = (n) => d.corps.querySelector(`[data-n="${n}"]`).value.trim();
  const message = (contenu, niveau = 'erreur') => { d.message.textContent = contenu; d.message.className = `fiche-dialogue-message ${niveau}`; };
  const proposer = (personnes, intro, { creer = false } = {}) => {
    zone.innerHTML = `<p>${echapper(intro)}</p><table class="coord-table selectionnable"><tbody>${personnes.map((p, i) => `<tr>
        <td>${ligneResume(p)}</td><td><button type="button" data-prendre="${i}">${texteHtml('annuaire.provisoire.choisir')}</button></td></tr>`).join('')}</tbody></table>
      ${creer ? `<p><button type="button" data-forcer>${texteHtml('annuaire.provisoire.forcer')}</button></p>` : ''}`;
    zone.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', () => d.fermer(personnes[Number(b.dataset.prendre)])));
    zone.querySelector('[data-forcer]')?.addEventListener('click', () => creer$(true));
  };
  const creer$ = async (confirme) => {
    try {
      d.fermer(await annuaire.creerProvisoire({ raison_sociale: valeur('raison_sociale'), siret: valeur('siret') || null, casquettes: relations, confirme }));
    } catch (e) {
      if (e.code === ERREUR_ANNUAIRE.DOUBLON_SIRET) proposer([e.details.personne], texte('annuaire.provisoire.doublon_siret'));
      else if (e.code === ERREUR_ANNUAIRE.DOUBLON_NOM) proposer(e.details.personnes, texte('annuaire.provisoire.doublon_nom'), { creer: true });
      else message(e.message);
    }
  };
  d.corps.querySelector('[data-verifier]').addEventListener('click', () => creer$(false));
  d.corps.querySelectorAll('[data-n]').forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); creer$(false); } }));
  const r = await d.resultat;
  return r && typeof r === 'object' ? r : null;
}

const affichage = (v) => (v === null || v === undefined || v === '' ? '<span class="aide">—</span>'
  : typeof v === 'boolean' ? texteHtml(v ? 'commun.oui' : 'commun.non') : echapper(typeof v === 'object' ? JSON.stringify(v) : String(v)));

/**
 * Fusion d'un tiers provisoire dans une fiche existante : choix de la fiche conservée, puis, pour chaque champ
 * renseigné des deux côtés avec des valeurs différentes, la valeur gardée ; les champs vides de la fiche conservée
 * reprennent ceux du provisoire. Contacts, coordonnées, liens, documents et pièces passent sur la fiche conservée.
 * libelles : colonne (per_…) ou « +clé » → libellé affiché. Résout avec { cible_id, reports } ou null.
 */
export async function fusionnerTiers({ annuaire, id, libelles = {}, cible = null }) {
  const choisie = cible ?? await choisirPersonne({ annuaire, titre: texte('annuaire.fusion.choisir'), exclure: [Number(id)] });
  if (!choisie) return null;
  const a = await annuaire.apercuFusion(id, choisie.id);
  const libelle = (c) => libelles[c] ?? c.replace(/^\+/, '').replace(/^per_/, '').replaceAll('_', ' ');
  const vide = (v) => v === null || v === undefined || v === '';
  const conflits = a.conflits;
  const repris = Object.keys(a.valeurs ?? {}).filter((c) => !conflits.includes(c));
  const repriseProprietes = Object.keys(a.valeurs_source).filter((c) => c.startsWith('+') && !conflits.includes(c) && vide(a.valeurs_cible[c]) && !vide(a.valeurs_source[c]));
  const lignesConflits = conflits.map((c) => `<tr><th>${echapper(libelle(c))}</th>
      <td><label><input type="radio" name="f-${echapper(c)}" value="source" data-c="${echapper(c)}"> ${affichage(a.valeurs_source[c])}</label></td>
      <td><label><input type="radio" name="f-${echapper(c)}" value="cible" data-c="${echapper(c)}" checked> ${affichage(a.valeurs_cible[c])}</label></td></tr>`).join('');
  const lignesReprises = [...repris, ...repriseProprietes].map((c) => `<tr><th>${echapper(libelle(c))}</th><td>${affichage(a.valeurs_source[c])}</td><td class="aide">${texteHtml('annuaire.fusion.repris')}</td></tr>`).join('');
  const d = dialogue(texte('annuaire.fusion.titre'), `
    <p>${texte('annuaire.fusion.aide_html', { source: ligneResume(a.source), cible: ligneResume(a.cible) })}</p>
    ${conflits.length ? `<h3>${texteHtml('annuaire.fusion.conflits')}</h3>
      <table class="coord-table annuaire-fusion"><thead><tr><th>${texteHtml('annuaire.fusion.champ')}</th><th>${texteHtml('annuaire.fusion.source')}</th><th>${texteHtml('annuaire.fusion.cible')}</th></tr></thead><tbody>${lignesConflits}</tbody></table>`
    : `<p class="aide">${texteHtml('annuaire.fusion.aucun_conflit')}</p>`}
    ${lignesReprises ? `<h3>${texteHtml('annuaire.fusion.reprises')}</h3>
      <table class="coord-table annuaire-fusion"><tbody>${lignesReprises}</tbody></table>` : ''}`, texte('annuaire.fusion.action'), { large: true });
  if (!await d.resultat) return null;
  const choix = Object.fromEntries([...d.fond.querySelectorAll('input[type="radio"][data-c]:checked')].map((x) => [x.dataset.c, x.value]));
  return annuaire.fusionner(id, { cible_id: choisie.id, choix });
}
