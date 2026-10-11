import { echapper } from '@logibtp/socle/ui';
import { estMail, titreDepuisNom, dateDepuisFichier, formatTaille, icone } from '../src/fichiers.js';
import { lireMail } from '../src/mails.js';

// Dépôt de documents (sélection par l'explorateur de fichiers ou glisser-déposer) : informations prises
// automatiquement (titre, date, auteur, élément lié ; objet, expéditeur et date pour un mail), modifiables avant
// l'enregistrement. Les pièces jointes d'un mail sont enregistrées à côté de lui, avec un lien vers le mail.

const opt = (v, l, c) => `<option value="${echapper(v)}" ${String(c ?? '') === String(v) ? 'selected' : ''}>${echapper(l)}</option>`;

export class DialogueDepot {
  constructor(fichiers, { fournisseur, contexte = null, utilisateur, parametres, message, surTermine }) {
    this.fournisseur = fournisseur;
    this.contexte = contexte;
    this.parametres = parametres;
    this.message = message ?? (() => {});
    this.surTermine = surTermine;
    this.entrees = [...fichiers].map((f) => ({
      fichier: f,
      meta: {
        titre: titreDepuisNom(f.name), categorie: null, date_document: dateDepuisFichier(f), auteur: utilisateur,
        type_element: contexte?.type_element ?? '', id_element: contexte?.id_element ?? '', resume: '', notes: '', coffre: false,
      },
      mail: null,
    }));
    this.fond = document.createElement('div');
    this.fond.className = 'ged-dialogue-fond';
    this.fond.innerHTML = `
      <div class="ged-dialogue" role="dialog" aria-label="Ajouter des documents">
        <header><strong>Ajouter ${this.entrees.length} document${this.entrees.length > 1 ? 's' : ''}</strong>
          ${contexte?.libelle ? `<span class="aide">Lié à ${echapper(contexte.libelle)}</span>` : ''}
          <button type="button" data-action="fermer" title="Annuler (Échap)">✕</button></header>
        <div class="ged-dialogue-corps"><p class="aide">Lecture des fichiers…</p></div>
        <footer><span class="ged-dialogue-message"></span>
          <button type="button" data-action="fermer">Annuler</button>
          <button type="button" class="principal" data-action="enregistrer">Enregistrer</button></footer>
      </div>`;
    document.body.append(this.fond);
    this.corps = this.fond.querySelector('.ged-dialogue-corps');
    this.fond.querySelectorAll('[data-action="fermer"]').forEach((b) => b.addEventListener('click', () => this.fermer()));
    this.fond.querySelector('[data-action="enregistrer"]').addEventListener('click', () => this.enregistrer());
    this.clavier = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.fermer(); } };
    document.addEventListener('keydown', this.clavier, true);
    this.#preparer().catch((e) => this.#erreur(e.message));
  }

  /** Mails : objet, expéditeur, date et pièces jointes lus dans le fichier. */
  async #preparer() {
    for (const e of this.entrees) {
      if (!estMail(e.fichier.name)) continue;
      try {
        e.mail = await lireMail(e.fichier);
        Object.assign(e.meta, {
          titre: e.mail.objet || e.meta.titre, categorie: 'mail', auteur: e.mail.de || e.meta.auteur,
          date_document: e.mail.date ? e.mail.date.slice(0, 10) : e.meta.date_document,
        });
        e.sens = 'recu';
      } catch (x) {
        e.erreur = `Mail illisible : ${x.message}`;
      }
    }
    this.rendre();
  }

  rendre() {
    const cats = this.parametres.categories ?? [];
    this.corps.innerHTML = this.entrees.map((e, i) => `
      <fieldset class="ged-depot" data-i="${i}">
        <legend>${e.mail ? '✉️' : icone({ nom_fichier: e.fichier.name })} ${echapper(e.fichier.name)} <small>${formatTaille(e.fichier.size)}</small></legend>
        ${e.erreur ? `<p class="erreur">${echapper(e.erreur)}</p>` : ''}
        <div class="ged-formulaire">
          <label class="large">Titre <input data-m="titre" value="${echapper(e.meta.titre)}"></label>
          <label>Catégorie <select data-m="categorie">${opt('', '—', e.meta.categorie)}${cats.map((c) => opt(c.code, `${c.libelle}${c.coffre ? ' 🔒' : ''}`, e.meta.categorie)).join('')}</select></label>
          <label>Date <input type="date" data-m="date_document" value="${echapper(e.meta.date_document ?? '')}"></label>
          <label>Auteur <input data-m="auteur" value="${echapper(e.meta.auteur ?? '')}"></label>
          <label>Élément lié <span class="ged-lien"><input data-m="type_element" value="${echapper(e.meta.type_element ?? '')}" placeholder="type" size="9">
            <input data-m="id_element" value="${echapper(e.meta.id_element ?? '')}" placeholder="n°" size="7"></span></label>
          <label class="coche" title="Archivage verrouillé : empreinte et horodatage, ni modification ni suppression"><input type="checkbox" data-m="coffre" ${e.meta.coffre ? 'checked' : ''}> Coffre-fort</label>
          ${e.mail ? `<label class="coche"><input type="checkbox" data-sens ${e.sens === 'envoye' ? 'checked' : ''}> Mail envoyé (sinon reçu)</label>` : ''}
          <label class="large">Résumé <textarea rows="2" data-m="resume" placeholder="Saisi par l'utilisateur (résumé automatique prévu plus tard)">${echapper(e.meta.resume)}</textarea></label>
          <label class="large">Notes <textarea rows="2" data-m="notes">${echapper(e.meta.notes)}</textarea></label>
        </div>
        ${e.mail ? `<div class="ged-depot-mail"><span><b>De</b> ${echapper(e.mail.de)}</span><span><b>À</b> ${echapper(e.mail.a)}</span>
          ${e.mail.pieces.length ? `<span>📎 ${e.mail.pieces.length} pièce(s) jointe(s) enregistrée(s) à côté du mail : ${e.mail.pieces.map((p) => echapper(p.nom)).join(', ')}</span>` : ''}</div>` : ''}
      </fieldset>`).join('');
    this.corps.querySelectorAll('[data-i]').forEach((fs) => {
      const e = this.entrees[Number(fs.dataset.i)];
      fs.querySelectorAll('[data-m]').forEach((el) => el.addEventListener('change', () => {
        e.meta[el.dataset.m] = el.type === 'checkbox' ? el.checked : el.value;
        if (el.dataset.m === 'categorie') {
          // Catégories administratives (devis signé, factures, contrats) : coffre-fort proposé d'office.
          e.meta.coffre = !!cats.find((c) => c.code === el.value)?.coffre;
          fs.querySelector('[data-m="coffre"]').checked = e.meta.coffre;
        }
      }));
      fs.querySelector('[data-sens]')?.addEventListener('change', (x) => { e.sens = x.target.checked ? 'envoye' : 'recu'; });
    });
  }

  #erreur(t) {
    const m = this.fond.querySelector('.ged-dialogue-message');
    m.textContent = t ?? '';
    m.classList.toggle('erreur', !!t);
  }

  async enregistrer() {
    const bouton = this.fond.querySelector('[data-action="enregistrer"]');
    bouton.disabled = true;
    const crees = [];
    try {
      for (const e of this.entrees) {
        if (!e.meta.titre?.trim()) throw new Error(`Titre obligatoire pour ${e.fichier.name}`);
        const meta = { ...e.meta, type_element: e.meta.type_element || null, id_element: e.meta.id_element || null };
        if (e.mail) {
          const { pieces, ...infos } = e.mail;
          const doc = await this.fournisseur.deposer({ fichier: e.fichier, meta: { ...meta, nature: 'mail', mail: { ...infos, sens: e.sens } } });
          crees.push(doc);
          for (const p of pieces) {
            crees.push(await this.fournisseur.deposer({
              fichier: new File([p.contenu], p.nom, { type: p.type }),
              meta: { titre: titreDepuisNom(p.nom), categorie: null, date_document: meta.date_document, auteur: meta.auteur, type_element: meta.type_element,
                id_element: meta.id_element, parent_id: doc.id, notes: `Pièce jointe du mail « ${infos.objet} »` },
            }));
          }
        } else crees.push(await this.fournisseur.deposer({ fichier: e.fichier, meta }));
      }
      this.message(`${crees.length} document(s) enregistré(s)`, 'succes');
      this.fermer(crees);
    } catch (x) {
      this.#erreur(x.message);
      bouton.disabled = false;
      if (crees.length) this.surTermine?.(crees);
    }
  }

  fermer(crees = []) {
    document.removeEventListener('keydown', this.clavier, true);
    this.fond.remove();
    if (crees.length) this.surTermine?.(crees);
  }
}
