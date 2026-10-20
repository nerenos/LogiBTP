import { PageBase } from '@logibtp/navigation';
import { echapper, htmlSur } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { lienElement, formatDateHeure, nouvelleSaisie, texteEnHtml } from '../crm/crm.js';

const GENRES = [
  { code: 'NOTE', libelle: 'Notes', icone: '💬' },
  { code: 'DOCUMENT', libelle: 'Documents', icone: '📄' },
  { code: 'PHOTO', libelle: 'Photos', icone: '📷' },
  { code: 'EVENEMENT', libelle: 'Événements', icone: '🔔' },
];
const ICONES = { NOTE: '💬', DOCUMENT: '📄', PHOTOS: '📷', EVENEMENT: '🔔' };
const PHOTOS_VISIBLES = 3;

/**
 * Fil d'actualité (module CRM) : `/crm/fil?type=&id=` (d'un élément, agrégé vers le haut : une affaire montre ses
 * chantiers) ou global. Notes cochées « Dans le fil », documents et photos déposés, événements des modules ; filtres par
 * genre ; chargement par lots (« Plus ancien ») ; documents ouverts à la demande ; un groupe de photos montre les trois
 * premières et le nombre restant. Publication d'un message, avec photos, dans le fil de l'élément.
 */
export class PageFilCrm extends PageBase {
  icone = '📰';

  async ouvrir() {
    const app = this.app;
    this.element = this.requete.type && this.requete.id ? { type: this.requete.type, id: String(this.requete.id) } : null;
    this.genres = new Set(this.requete.genres ? this.requete.genres.split(',') : GENRES.map((g) => g.code));
    if (!app.enLigne) { this.conteneur.innerHTML = '<p class="aide">Suivi (CRM) disponible en ligne seulement.</p>'; return; }
    const e = this.element ? (await api.crm.elements([this.element]))[0] : null;
    this.titre = e ? `Fil : ${e.libelle}` : 'Fil d\'actualité';
    this.conteneur.innerHTML = `<div class="page-parametres page-crm-fil"><h1 class="page-titre">📰 Fil d'actualité${e ? ` : ${lienElement(e)}` : ''}</h1>
      ${this.element ? `<div class="crm-publier"><textarea data-message rows="2" placeholder="Message pour le fil de ${echapper(e?.libelle ?? 'l\'élément')}…"></textarea>
        <label class="crm-photos" title="Joindre des photos"><input type="file" data-photos accept="image/*" multiple hidden>📷 Photos</label><span data-nb-photos class="aide"></span>
        <button type="button" class="principal" data-publier>Publier</button></div>` : '<p class="aide">Fil de toutes les notes publiées et des événements ; les documents et photos se voient dans le fil d\'un élément.</p>'}
      <div class="crm-filtres">${GENRES.map((g) => `<label class="fiche-option"><input type="checkbox" data-genre="${g.code}" ${this.genres.has(g.code) ? 'checked' : ''}> ${g.icone} ${g.libelle}</label>`).join('')}</div>
      <div data-fil class="crm-fil"></div><div class="boutons"><button type="button" data-suite hidden>Plus ancien…</button></div></div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    this.conteneur.querySelectorAll('[data-genre]').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) this.genres.add(c.dataset.genre); else this.genres.delete(c.dataset.genre);
      app.routeur.remplacerUrl(this.urlCourante());
      this.charger(true);
    }));
    $('[data-suite]').addEventListener('click', () => this.charger(false));
    $('[data-photos]')?.addEventListener('change', (ev) => { const n = ev.target.files.length; $('[data-nb-photos]').textContent = n ? `${n} photo(s)` : ''; });
    $('[data-publier]')?.addEventListener('click', () => this.publier());
    this.desabonner = app.abonner('crm', () => this.charger(true));
    await this.charger(true);
  }

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ type: this.element?.type, id: this.element?.id, genres: this.genres?.size === GENRES.length ? '' : [...(this.genres ?? [])].join(',') }).filter(([, v]) => v));
    return `/crm/fil${p.toString() ? `?${p}` : ''}`;
  }

  async reprendre() { await this.charger(true); }

  fermer() { this.desabonner?.(); }

  async charger(depuisDebut) {
    const zone = this.conteneur.querySelector('[data-fil]');
    if (!zone) return;
    if (depuisDebut) { this.suivant = null; zone.innerHTML = ''; }
    if (!this.genres.size) { zone.innerHTML = '<p class="aide">Choisissez au moins un genre.</p>'; this.conteneur.querySelector('[data-suite]').hidden = true; return; }
    let lot;
    try {
      lot = await api.crm.fil({ type_element: this.element?.type, id_element: this.element?.id, avant: this.suivant, taille: 30, genres: [...this.genres].join(',') });
    } catch (e) { zone.insertAdjacentHTML('beforeend', `<p class="erreur">${echapper(e.message)}</p>`); return; }
    if (depuisDebut && !lot.elements.length) zone.innerHTML = '<p class="aide">Rien dans le fil pour l\'instant.</p>';
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
      <div class="crm-fil-entete"><span class="crm-fil-icone">${ICONES[x.genre] ?? '•'}</span>
        <b>${x.url ? `<a href="${echapper(x.url)}">${echapper(x.titre)}</a>` : echapper(x.titre)}</b>
        ${x.element ? `<span class="aide">· ${lienElement(x.element)}</span>` : ''}
        <span class="aide crm-fil-quand">${echapper(x.par ?? '')} · ${echapper(formatDateHeure(x.quand))}</span></div>
      ${x.texte ? `<div class="crm-fil-texte">${htmlSur(x.texte)}</div>` : ''}
      ${photos.length ? `<div class="crm-fil-photos">${vignettes}${reste > 0 ? `<a class="crm-fil-reste" href="${echapper(x.url ?? photos[PHOTOS_VISIBLES].url ?? '#')}">+${reste}</a>` : ''}</div>` : ''}
      ${autres.length ? `<ul class="crm-liens">${autres.map((p) => `<li>📄 <a href="${echapper(p.url ?? '#')}">${echapper(p.titre)}</a></li>`).join('')}</ul>` : ''}
      ${x.note_id ? `<div class="aide"><a href="/crm/note/${x.note_id}">${x.nb_reponses ? `💬 ${x.nb_reponses} réponse(s)` : '↩ Répondre'}</a></div>` : ''}
    </article>`;
  }

  /** Message publié : note pour mémo « Dans le fil » rattachée à l'élément ; photos déposées dans la GED de la note. */
  async publier() {
    const texte = this.conteneur.querySelector('[data-message]').value.trim();
    const fichiers = [...(this.conteneur.querySelector('[data-photos]').files ?? [])];
    if (!texte && !fichiers.length) { this.app.message('Écrivez un message ou joignez des photos', 'avertissement'); return; }
    try {
      const s = nouvelleSaisie({ etat: 'MEMO', element: this.element });
      s.objet = (texte.split('\n')[0] || `${fichiers.length} photo(s)`).slice(0, 200);
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
      this.app.publier('crm', { fil: true });
      this.app.message('Publié dans le fil', 'succes');
    } catch (e) { this.app.erreur(e); }
  }
}
