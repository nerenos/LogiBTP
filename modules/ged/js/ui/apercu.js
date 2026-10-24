import { echapper } from '@logibtp/socle/ui';
import { genreApercu, formatTaille } from '../src/fichiers.js';

// Aperçu d'un document, à la façon de l'explorateur Windows : images, PDF, textes et mails. Le contenu n'est
// récupéré qu'à l'affichage de l'aperçu (mémoire temporaire du navigateur, libérée au changement de document) ;
// les autres formats, ou les fichiers trop lourds, sont proposés au téléchargement.

const urls = new WeakMap();
const TEXTE_MAX = 200 * 1024;

function liberer(zone) {
  const u = urls.get(zone);
  if (u) URL.revokeObjectURL(u);
  urls.delete(zone);
}

/** Bloc d'en-tête d'un mail (objet, expéditeur, destinataires, date, message). */
export function htmlMail(mail) {
  if (!mail) return '';
  const date = mail.date ? new Date(mail.date).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return `<div class="ged-mail">
    <dl>
      <dt>Objet</dt><dd><strong>${echapper(mail.objet ?? '')}</strong></dd>
      <dt>${mail.sens === 'envoye' ? 'Envoyé par' : 'De'}</dt><dd>${echapper(mail.de ?? '')}</dd>
      <dt>À</dt><dd>${echapper(mail.a ?? '')}</dd>
      ${mail.cc ? `<dt>Cc</dt><dd>${echapper(mail.cc)}</dd>` : ''}
      <dt>Date</dt><dd>${echapper(date)}</dd>
    </dl>
    <pre class="ged-mail-message">${echapper(mail.message ?? '')}</pre>
  </div>`;
}

/**
 * Affiche l'aperçu de `version` (d'un document `doc`) dans `zone`. `urlTelechargement` : lien proposé quand l'aperçu
 * est impossible. Renvoie une promesse résolue une fois l'aperçu chargé.
 */
export async function rendreApercu(zone, { fournisseur, doc, version, tailleMax, urlTelechargement }) {
  liberer(zone);
  if (!version) { zone.innerHTML = '<p class="aide">Aucun contenu.</p>'; return; }
  const genre = doc.nature === 'mail' ? 'mail' : genreApercu(version.nom_fichier, version.type_mime);
  const lien = urlTelechargement ? `<a class="bouton" href="${echapper(urlTelechargement)}" download="${echapper(version.nom_fichier)}">⬇ Télécharger ${echapper(version.nom_fichier)}</a>` : '';
  if (genre === 'mail') { zone.innerHTML = htmlMail(doc.mail); return; }
  if (!genre || (tailleMax && version.taille > tailleMax)) {
    zone.innerHTML = `<div class="ged-sans-apercu"><span class="ged-icone-grande">📄</span>
      <p>${genre ? `Fichier trop lourd pour l'aperçu (${formatTaille(version.taille)})` : 'Pas d\'aperçu pour ce format'}</p>${lien}</div>`;
    return;
  }
  zone.innerHTML = '<p class="aide ged-chargement">Chargement de l\'aperçu…</p>';
  const blob = await fournisseur.contenu(version.id);
  if (genre === 'texte') {
    const texte = await blob.slice(0, TEXTE_MAX).text();
    zone.innerHTML = `<pre class="ged-texte">${echapper(texte)}${blob.size > TEXTE_MAX ? '\n…' : ''}</pre>`;
    return;
  }
  // Le cadre ne reçoit qu'un PDF (type imposé) : un HTML ou un SVG déposé n'y est jamais interprété. Pas d'attribut
  // `sandbox` : Chrome et Edge refusent alors d'afficher le PDF. Les images passent par <img>, sans script (SVG compris).
  const url = URL.createObjectURL(new Blob([blob], { type: genre === 'pdf' ? 'application/pdf' : version.type_mime || blob.type }));
  urls.set(zone, url);
  zone.innerHTML = genre === 'image'
    ? `<img class="ged-image" src="${url}" alt="${echapper(version.nom_fichier)}">`
    : `<iframe class="ged-pdf" src="${url}" title="${echapper(version.nom_fichier)}"></iframe>`;
}

export const libererApercu = liberer;
