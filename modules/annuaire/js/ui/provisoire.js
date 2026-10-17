import { echapper } from '@logibtp/socle/ui';
import { dialogue } from './coordonnees.js';
import { choisirPersonne } from './selection.js';

// Tiers provisoires : saisie d'un nouveau tiers après contrôle des doublons (SIRET, nom), puis, pour un utilisateur
// habilité, validation de la création ou fusion dans une fiche existante (valeurs choisies champ par champ).

const ligneResume = (p) => `<b>${echapper(p.raison_sociale)}</b> <small class="aide">${echapper([p.code, p.ville, p.siret].filter(Boolean).join(' · '))}</small>`
  + (p.provisoire ? ' <span class="annuaire-provisoire">provisoire</span>' : '');

/**
 * Nouveau tiers provisoire : raison sociale et SIRET, doublons proposés avant la création (un SIRET connu impose la
 * fiche existante, des noms proches demandent confirmation). Résout avec le résumé du tiers choisi ou créé, ou null.
 * casquettes : relations du tiers (ex. CLIENT), gardées si elles existent dans le référentiel.
 */
export async function creerTiersProvisoire({ annuaire, raison_sociale = '', siret = '', casquettes = [], titre = 'Nouveau tiers' }) {
  const refs = await annuaire.referentiels().catch(() => ({ casquettes: [] }));
  const relations = casquettes.filter((c) => refs.casquettes.some((x) => x.code === c));
  const d = dialogue(titre, `<div class="annuaire-provisoire-saisie">
      <label>Raison sociale <input data-n="raison_sociale" value="${echapper(raison_sociale)}"></label>
      <label>SIRET <input data-n="siret" value="${echapper(siret)}" inputmode="numeric" placeholder="facultatif"></label>
      <button type="button" class="principal" data-verifier>Vérifier et créer</button></div>
    <div class="annuaire-doublons"></div>
    <p class="aide">Le tiers est créé <b>provisoire</b> : utilisable tout de suite, sa création sera validée ou il sera fusionné avec une
      fiche existante par un utilisateur habilité.</p>`);
  const zone = d.corps.querySelector('.annuaire-doublons');
  const valeur = (n) => d.corps.querySelector(`[data-n="${n}"]`).value.trim();
  const message = (texte, niveau = 'erreur') => { d.message.textContent = texte; d.message.className = `fiche-dialogue-message ${niveau}`; };
  const proposer = (personnes, intro, { creer = false } = {}) => {
    zone.innerHTML = `<p>${echapper(intro)}</p><table class="coord-table selectionnable"><tbody>${personnes.map((p, i) => `<tr>
        <td>${ligneResume(p)}</td><td><button type="button" data-prendre="${i}">Choisir</button></td></tr>`).join('')}</tbody></table>
      ${creer ? '<p><button type="button" data-forcer>Créer quand même un nouveau tiers</button></p>' : ''}`;
    zone.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', () => d.fermer(personnes[Number(b.dataset.prendre)])));
    zone.querySelector('[data-forcer]')?.addEventListener('click', () => creer$(true));
  };
  const creer$ = async (confirme) => {
    try {
      d.fermer(await annuaire.creerProvisoire({ raison_sociale: valeur('raison_sociale'), siret: valeur('siret') || null, casquettes: relations, confirme }));
    } catch (e) {
      if (e.code === 'DOUBLON_SIRET') proposer([e.details.personne], 'Ce SIRET est déjà dans l’annuaire : choisissez la fiche existante.');
      else if (e.code === 'DOUBLON_NOM') proposer(e.details.personnes, 'Des tiers de nom proche existent : est-ce l’un d’eux ?', { creer: true });
      else message(e.message);
    }
  };
  d.corps.querySelector('[data-verifier]').addEventListener('click', () => creer$(false));
  d.corps.querySelectorAll('[data-n]').forEach((x) => x.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); creer$(false); } }));
  const r = await d.resultat;
  return r && typeof r === 'object' ? r : null;
}

const affichage = (v) => (v === null || v === undefined || v === '' ? '<span class="aide">—</span>'
  : typeof v === 'boolean' ? (v ? 'Oui' : 'Non') : echapper(typeof v === 'object' ? JSON.stringify(v) : String(v)));

/**
 * Fusion d'un tiers provisoire dans une fiche existante : choix de la fiche conservée, puis, pour chaque champ
 * renseigné des deux côtés avec des valeurs différentes, la valeur gardée ; les champs vides de la fiche conservée
 * reprennent ceux du provisoire. Contacts, coordonnées, liens, documents et pièces passent sur la fiche conservée.
 * libelles : colonne (per_…) ou « +clé » → libellé affiché. Résout avec { cible_id, reports } ou null.
 */
export async function fusionnerTiers({ annuaire, id, libelles = {}, cible = null }) {
  const choisie = cible ?? await choisirPersonne({ annuaire, titre: 'Fusionner avec la fiche…', exclure: [Number(id)] });
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
  const lignesReprises = [...repris, ...repriseProprietes].map((c) => `<tr><th>${echapper(libelle(c))}</th><td>${affichage(a.valeurs_source[c])}</td><td class="aide">repris</td></tr>`).join('');
  const d = dialogue('Fusionner le tiers provisoire', `
    <p>Le tiers provisoire ${ligneResume(a.source)} sera fusionné dans ${ligneResume(a.cible)} puis supprimé : ses contacts, coordonnées,
      liens, documents, intervenants et pièces passent sur la fiche conservée.</p>
    ${conflits.length ? `<h3>Valeurs différentes : choisissez celle à garder</h3>
      <table class="coord-table annuaire-fusion"><thead><tr><th>Champ</th><th>Tiers provisoire</th><th>Fiche conservée</th></tr></thead><tbody>${lignesConflits}</tbody></table>`
    : '<p class="aide">Aucune valeur en conflit.</p>'}
    ${lignesReprises ? `<h3>Champs vides de la fiche conservée, repris du provisoire</h3>
      <table class="coord-table annuaire-fusion"><tbody>${lignesReprises}</tbody></table>` : ''}`, 'Fusionner', { large: true });
  if (!await d.resultat) return null;
  const choix = Object.fromEntries([...d.fond.querySelectorAll('input[type="radio"][data-c]:checked')].map((x) => [x.dataset.c, x.value]));
  return annuaire.fusionner(id, { cible_id: choisie.id, choix });
}
