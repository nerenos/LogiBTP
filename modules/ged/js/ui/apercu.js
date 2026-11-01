import { texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
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
      <dt>${texteHtml('ged.apercu.objet')}</dt><dd><strong>${echapper(mail.objet ?? '')}</strong></dd>
      <dt>${mail.sens === 'envoye' ? texteHtml('ged.apercu.envoye_par') : texteHtml('ged.apercu.de')}</dt><dd>${echapper(mail.de ?? '')}</dd>
      <dt>${texteHtml('ged.apercu.a')}</dt><dd>${echapper(mail.a ?? '')}</dd>
      ${mail.cc ? `<dt>${texteHtml('ged.apercu.cc')}</dt><dd>${echapper(mail.cc)}</dd>` : ''}
      <dt>${texteHtml('ged.apercu.date')}</dt><dd>${echapper(date)}</dd>
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
  if (!version) { zone.innerHTML = `<p class="aide">${texteHtml('ged.apercu.aucun_contenu')}</p>`; return; }
  const genre = doc.nature === 'mail' ? 'mail' : genreApercu(version.nom_fichier, version.type_mime);
  const lien = urlTelechargement ? `<a class="bouton" href="${echapper(urlTelechargement)}" download="${echapper(version.nom_fichier)}">${iconeHtml('ged_telecharger')} ${texteHtml('ged.apercu.telecharger', { fichier: version.nom_fichier })}</a>` : '';
  if (genre === 'mail') { zone.innerHTML = htmlMail(doc.mail); return; }
  if (!genre || (tailleMax && version.taille > tailleMax)) {
    zone.innerHTML = `<div class="ged-sans-apercu"><span class="ged-icone-grande">${iconeHtml('ged_fichier')}</span>
      <p>${genre ? texteHtml('ged.apercu.trop_lourd', { taille: formatTaille(version.taille) }) : texteHtml('ged.apercu.sans_apercu')}</p>${lien}</div>`;
    return;
  }
  zone.innerHTML = `<p class="aide ged-chargement">${texteHtml('ged.apercu.chargement')}</p>`;
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
