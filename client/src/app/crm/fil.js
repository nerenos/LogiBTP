import { texte, texteHtml, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { SUJET_FENETRE } from '../codes.js';
import { ETAT_NOTE } from '@logibtp/crm';
import { echapper, htmlSur, formatDateHeure } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { lienElement, nouvelleSaisie, texteEnHtml } from './crm.js';

export const GENRES_FIL = [
  { code: 'NOTE', libelle: texte('crm_btp.fil.genres.NOTE'), icone: icone('crm_btp_note') },
  { code: 'DOCUMENT', libelle: texte('crm_btp.fil.genres.DOCUMENT'), icone: icone('crm_btp_document') },
  { code: 'PHOTO', libelle: texte('crm_btp.fil.genres.PHOTO'), icone: icone('crm_btp_photo') },
  { code: 'EVENEMENT', libelle: texte('crm_btp.fil.genres.EVENEMENT'), icone: icone('crm_btp_evenement') },
];
const ICONES = { NOTE: icone('crm_btp_note'), DOCUMENT: icone('crm_btp_document'), PHOTOS: icone('crm_btp_photo'), EVENEMENT: icone('crm_btp_evenement') };
const PHOTOS_VISIBLES = 3;

/**
 * Fil d'actualité (module CRM) d'un élément (agrégé vers le haut : une affaire montre ses chantiers) ou global : notes
 * cochées « Dans le fil », documents et photos déposés, événements des modules ; filtres par genre ; chargement par lots
 * (« Plus ancien ») ; un groupe de photos montre les trois premières et le nombre restant ; publication d'un message,
 * avec photos, dans le fil de l'élément. Utilisé par la page `/crm/fil` et l'onglet Fil des fiches affaire et chantier ;
 * centré dans son hôte (`.crm-fil-hote`).
 */
export class FilCrm {
  /** @param {HTMLElement} conteneur @param {{ app, element?: { type, id }, libelle?: string, genres?: Set<string>, surGenres?: Function }} options */
  constructor(conteneur, { app, element = null, libelle = null, genres = null, surGenres = null }) {
    this.conteneur = conteneur;
    this.app = app;
    this.element = element;
    this.libelle = libelle;
    this.genres = genres ?? new Set(GENRES_FIL.map((g) => g.code));
    this.surGenres = surGenres;
  }

  async ouvrir() {
    const app = this.app;
    this.conteneur.classList.add('crm-fil-hote');
    this.conteneur.innerHTML = `${this.element ? `<div class="crm-publier"><textarea data-message rows="2" placeholder="${this.libelle ? texteHtml('crm_btp.fil.message_pour', { libelle: this.libelle }) : texteHtml('crm_btp.fil.message_pour_element')}"></textarea>
        <label class="crm-photos" title="${texteHtml('crm_btp.fil.joindre_photos')}"><input type="file" data-photos accept="image/*" multiple hidden>${iconeHtml('crm_btp_photo')} ${texteHtml('crm_btp.fil.photos')}</label><span data-nb-photos class="aide"></span>
        <button type="button" class="principal" data-publier>${texteHtml('crm_btp.fil.publier')}</button></div>` : `<p class="aide">${texteHtml('crm_btp.fil.global')}</p>`}
      <div class="crm-filtres">${GENRES_FIL.map((g) => `<label class="fiche-option"><input type="checkbox" data-genre="${g.code}" ${this.genres.has(g.code) ? 'checked' : ''}> ${g.icone} ${g.libelle}</label>`).join('')}</div>
      <div data-fil class="crm-fil"></div><div class="boutons"><button type="button" data-suite hidden>${texteHtml('crm_btp.fil.plus_ancien')}</button></div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    this.conteneur.querySelectorAll('[data-genre]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) this.genres.add(c.dataset.genre); else this.genres.delete(c.dataset.genre);
      this.surGenres?.(this.genres);
      this.charger(true);
    }));
    $('[data-suite]').addEventListener('click', () => this.charger(false));
    $('[data-photos]')?.addEventListener('change', (ev) => { const n = ev.target.files.length; $('[data-nb-photos]').textContent = n ? pluriel('crm_btp.fil.nb_photos', n) : ''; });
    $('[data-publier]')?.addEventListener('click', () => this.publier());
    this.desabonner = app.abonner(SUJET_FENETRE.CRM, () => this.charger(true));
    await this.charger(true);
  }

  fermer() { this.desabonner?.(); }

  async charger(depuisDebut) {
    const zone = this.conteneur.querySelector('[data-fil]');
    if (!zone) return;
    if (depuisDebut) { this.suivant = null; zone.innerHTML = ''; }
    if (!this.genres.size) { zone.innerHTML = `<p class="aide">${texteHtml('crm_btp.fil.aucun_genre')}</p>`; this.conteneur.querySelector('[data-suite]').hidden = true; return; }
    let lot;
    try {
      lot = await api.crm.fil({ type_element: this.element?.type, id_element: this.element?.id, avant: this.suivant, taille: 30, genres: [...this.genres].join(',') });
    } catch (e) { zone.insertAdjacentHTML('beforeend', `<p class="erreur">${echapper(e.message)}</p>`); return; }
    if (depuisDebut && !lot.elements.length) zone.innerHTML = `<p class="aide">${texteHtml('crm_btp.fil.vide')}</p>`;
    zone.insertAdjacentHTML('beforeend', lot.elements.map((x) => this.html(x)).join(''));
    this.suivant = lot.suivant;
    this.conteneur.querySelector('[data-suite]').hidden = !lot.suivant;
  }

  html(x) {
    const photos = x.pieces.filter((p) => p.image);
    const autres = x.pieces.filter((p) => !p.image);
    const vignettes = photos.slice(0, PHOTOS_VISIBLES).map((p) => `<a href="${echapper(p.url ?? '#')}" title="${echapper(p.titre)}"><img src="${echapper(p.contenu ?? '')}" alt="${echapper(p.titre)}" loading="lazy"></a>`).join('');
    const reste = photos.length - PHOTOS_VISIBLES;
    return `<article class="crm-fil-element crm-fil-${x.genre.toLowerCase()}">
      <div class="crm-fil-entete"><span class="crm-fil-icone">${ICONES[x.genre] ?? icone('crm_btp_puce')}</span>
        <b>${x.url ? `<a href="${echapper(x.url)}">${echapper(x.titre)}</a>` : echapper(x.titre)}</b>
        ${x.element ? `<span class="aide">· ${lienElement(x.element)}</span>` : ''}
        <span class="aide crm-fil-quand">${echapper(x.par ?? '')} · ${echapper(formatDateHeure(x.quand))}</span></div>
      ${x.texte ? `<div class="crm-fil-texte">${htmlSur(x.texte)}</div>` : ''}
      ${photos.length ? `<div class="crm-fil-photos">${vignettes}${reste > 0 ? `<a class="crm-fil-reste" href="${echapper(x.url ?? photos[PHOTOS_VISIBLES].url ?? '#')}">+${reste}</a>` : ''}</div>` : ''}
      ${autres.length ? `<ul class="crm-liens">${autres.map((p) => `<li>${iconeHtml('crm_btp_document')} <a href="${echapper(p.url ?? '#')}">${echapper(p.titre)}</a></li>`).join('')}</ul>` : ''}
      ${x.note_id ? `<div class="aide"><a href="/crm/note/${x.note_id}">${x.nb_reponses ? `${iconeHtml('crm_btp_note')} ${echapper(pluriel('crm_btp.fil.nb_reponses', x.nb_reponses))}` : `${iconeHtml('crm_btp_repondre')} ${texteHtml('crm_btp.fil.repondre')}`}</a></div>` : ''}
    </article>`;
  }

  /** Message publié : note pour mémo « Dans le fil » rattachée à l'élément ; photos déposées dans la GED de la note. */
  async publier() {
    const texte = this.conteneur.querySelector('[data-message]').value.trim();
    const fichiers = [...(this.conteneur.querySelector('[data-photos]').files ?? [])];
    if (!texte && !fichiers.length) { this.app.message(texte('crm_btp.fil.message_vide'), 'avertissement'); return; }
    try {
      const s = nouvelleSaisie({ etat: ETAT_NOTE.MEMO, element: this.element });
      s.objet = (texte.split('\n')[0] || pluriel('crm_btp.fil.nb_photos', fichiers.length)).slice(0, 200);
      s.message_html = texte.includes('\n') || texte.length > 200 ? texteEnHtml(texte) : null;
      s.dans_fil = true;
      const d = await api.crm.creer(s);
      if (fichiers.length) {
        const { ged } = await this.app.services();
        for (const f of fichiers) await ged.deposer({ fichier: f, nom_fichier: f.name, meta: { titre: f.name, categorie: 'crm', type_element: 'crm_note', id_element: String(d.note.id) } });
      }
      this.conteneur.querySelector('[data-message]').value = '';
      this.conteneur.querySelector('[data-photos]').value = '';
      this.conteneur.querySelector('[data-nb-photos]').textContent = '';
      this.app.publier(SUJET_FENETRE.CRM, { fil: true });
      this.app.message(texte('crm_btp.fil.publie'), 'succes');
    } catch (e) { this.app.erreur(e); }
  }
}
