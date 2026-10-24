import { echapper, creerCombo, ouvrirModale } from '@logibtp/socle/ui';
import { estMail, titreDepuisNom, dateDepuisFichier, formatTaille, icone } from '../src/fichiers.js';
import { lireMail } from '../src/mails.js';
import { classer } from '../src/classification.js';
import { CONFIDENTIALITES, libelleConfidentialite } from '../src/acces.js';

// Dépôt de documents (sélection par l'explorateur de fichiers ou glisser-déposer) dans un dossier de l'explorateur :
// le document est lié à l'élément du dossier (destination), même si ce n'est pas l'élément ouvert, et classé dans le
// répertoire choisi. Plusieurs fichiers : informations communes (saisies une fois, appliquées à tous ; le titre reste
// propre à chaque fichier) ou informations par fichier. Informations prises automatiquement (titre, date, auteur ;
// objet, expéditeur et date pour un mail), catégorie proposée par la classification automatique (le serveur la
// confirme avec le texte du contenu quand elle n'est pas choisie). Les pièces jointes d'un mail sont enregistrées
// à côté de lui, avec un lien vers le mail.

const COMMUNS = ['categorie', 'date_document', 'auteur', 'confidentialite', 'mots_cles', 'resume', 'notes'];
const motsCles = (t) => String(t ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export class DialogueDepot {
  /**
   * destination : { type_element, id_element, repertoire_id, libelle } (dossier de dépôt) ; contexte : ancienne forme
   * { type_element, id_element, libelle } acceptée.
   */
  constructor(fichiers, { fournisseur, destination = null, contexte = null, utilisateur, parametres, message, surTermine }) {
    this.fournisseur = fournisseur;
    this.destination = destination ?? (contexte ? { ...contexte, repertoire_id: null } : { type_element: null, id_element: null, repertoire_id: null, libelle: '' });
    this.parametres = parametres;
    this.message = message ?? (() => {});
    this.surTermine = surTermine;
    this.entrees = [...fichiers].map((f) => ({
      fichier: f,
      meta: { titre: titreDepuisNom(f.name), categorie: '', date_document: dateDepuisFichier(f), auteur: utilisateur, confidentialite: '', mots_cles: '', resume: '', notes: '', coffre: false },
      mail: null,
    }));
    this.commun = { categorie: '', date_document: '', auteur: '', confidentialite: '', mots_cles: '', resume: '', notes: '', coffre: false };
    this.mode = this.entrees.length > 1 ? 'commun' : 'fichier';
    const n = this.entrees.length;
    this.fond = document.createElement('dialog');
    this.fond.className = 'ged-dialogue-fond dialogue-plein';
    this.fond.innerHTML = `
      <div class="ged-dialogue" role="dialog" aria-label="Ajouter des documents">
        <header><strong>Ajouter ${n} document${n > 1 ? 's' : ''}</strong>
          ${this.destination.libelle ? `<span class="aide">dans 📁 ${echapper(this.destination.libelle)}</span>` : ''}
          ${n > 1 ? `<span class="ged-modes" role="group" aria-label="Saisie des informations">
            <button type="button" data-mode="commun">Informations communes</button><button type="button" data-mode="fichier">Par fichier</button></span>` : ''}
          <button type="button" class="ged-fermer" data-action="fermer" title="Annuler (Échap)">✕</button></header>
        <div class="ged-dialogue-corps"><p class="aide">Lecture des fichiers…</p></div>
        <footer><span class="ged-dialogue-message"></span>
          <button type="button" data-action="fermer">Annuler</button>
          <button type="button" class="principal" data-action="enregistrer">Enregistrer</button></footer>
      </div>`;
    ouvrirModale(this.fond);
    this.corps = this.fond.querySelector('.ged-dialogue-corps');
    this.fond.querySelectorAll('[data-action="fermer"]').forEach((b) => b.addEventListener('click', () => this.fermer()));
    this.fond.querySelector('[data-action="enregistrer"]').addEventListener('click', () => this.enregistrer());
    this.fond.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => this.changerMode(b.dataset.mode)));
    this.clavier = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.fermer(); } };
    document.addEventListener('keydown', this.clavier, true);
    this.#preparer().catch((e) => this.#erreur(e.message));
  }

  /** Mails : objet, expéditeur, date et pièces jointes lus dans le fichier ; catégorie proposée pour chaque fichier. */
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
    this.#proposer();
    this.rendre();
  }

  #proposer() {
    for (const e of this.entrees) {
      e.propose = classer({ nom_fichier: e.fichier.name, type_mime: e.fichier.type, titre: e.meta.titre, texte: e.mail?.message ?? null, expediteur: e.mail?.de ?? null,
        type_element: this.destination.type_element }, this.parametres.regles_classification ?? []);
    }
  }

  get #categories() { return this.parametres.categories ?? []; }
  #libelleCategorie(code) { return this.#categories.find((c) => c.code === code)?.libelle ?? code ?? ''; }

  /** Passage d'un mode à l'autre : les informations communes déjà saisies sont reportées sur chaque fichier. */
  changerMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'fichier') for (const e of this.entrees) Object.assign(e.meta, this.#communSaisi());
    this.mode = mode;
    this.rendre();
  }

  #communSaisi() {
    const c = Object.fromEntries(COMMUNS.filter((k) => this.commun[k] !== '' && this.commun[k] !== null).map((k) => [k, this.commun[k]]));
    if (this.commun.coffre) c.coffre = true;
    return c;
  }

  /** Champs d'informations (communes ou d'un fichier) ; `vides` : libellés des choix « selon le fichier ». */
  #formulaire(meta, { commun = false, mail = null, sens = null } = {}) {
    const p = commun ? 'Selon chaque fichier' : '';
    return `<div class="ged-formulaire">
      ${commun ? '' : `<label class="large">Titre <input data-m="titre" value="${echapper(meta.titre ?? '')}"></label>`}
      <label>Catégorie <span data-place="categorie"></span></label>
      <label>Date <input type="date" data-m="date_document" value="${echapper(meta.date_document ?? '')}" ${commun ? `title="${p}"` : ''}></label>
      <label>Auteur <input data-m="auteur" value="${echapper(meta.auteur ?? '')}" placeholder="${p}"></label>
      <label>Confidentialité <span data-place="confidentialite"></span></label>
      <label>Mots-clés <input data-m="mots_cles" value="${echapper(meta.mots_cles ?? '')}" placeholder="séparés par des virgules"></label>
      <label class="coche" title="Archivage verrouillé : empreinte et horodatage, ni modification ni suppression"><input type="checkbox" data-m="coffre" ${meta.coffre ? 'checked' : ''}> Coffre-fort</label>
      ${mail ? `<label class="coche"><input type="checkbox" data-sens ${sens === 'envoye' ? 'checked' : ''}> Mail envoyé (sinon reçu)</label>` : ''}
      <label class="large">Résumé <textarea rows="2" data-m="resume" placeholder="${p}">${echapper(meta.resume ?? '')}</textarea></label>
      <label class="large">Notes <textarea rows="2" data-m="notes" placeholder="${p}">${echapper(meta.notes ?? '')}</textarea></label>
    </div>`;
  }

  /** Branche les champs d'un formulaire sur `meta` (combos de catégorie et de confidentialité). */
  #lier(zone, meta, { propose = null, surSens = null } = {}) {
    const categorie = creerCombo({ options: this.#categories.map((c) => ({ valeur: c.code, libelle: `${c.libelle}${c.coffre ? ' 🔒' : ''}` })), valeur: meta.categorie ?? '', titre: 'Catégorie' });
    categorie.placeholder = propose?.categorie ? `Proposée : ${this.#libelleCategorie(propose.categorie)}` : 'Selon chaque fichier';
    const confidentialite = creerCombo({ options: CONFIDENTIALITES.map(([valeur, libelle]) => ({ valeur, libelle })), valeur: meta.confidentialite ?? '', titre: 'Confidentialité' });
    confidentialite.placeholder = propose?.confidentialite ? `Proposée : ${libelleConfidentialite(propose.confidentialite)}` : 'Interne';
    zone.querySelector('[data-place="categorie"]').replaceWith(categorie);
    zone.querySelector('[data-place="confidentialite"]').replaceWith(confidentialite);
    categorie.addEventListener('change', () => {
      meta.categorie = categorie.valeurCombo;
      // Catégories administratives (devis signé, factures, contrats) : coffre-fort proposé d'office.
      meta.coffre = Boolean(this.#categories.find((c) => c.code === meta.categorie)?.coffre);
      zone.querySelector('[data-m="coffre"]').checked = meta.coffre;
    });
    confidentialite.addEventListener('change', () => { meta.confidentialite = confidentialite.valeurCombo; });
    zone.querySelectorAll('[data-m]').forEach((el) => el.addEventListener('change', () => { meta[el.dataset.m] = el.type === 'checkbox' ? el.checked : el.value; }));
    zone.querySelector('[data-sens]')?.addEventListener('change', (x) => surSens?.(x.target.checked ? 'envoye' : 'recu'));
  }

  #entete(e) {
    return `${e.mail ? '✉️' : icone({ nom_fichier: e.fichier.name })} ${echapper(e.fichier.name)} <small>${formatTaille(e.fichier.size)}</small>`;
  }

  #infosMail(e) {
    return e.mail ? `<div class="ged-depot-mail"><span><b>De</b> ${echapper(e.mail.de)}</span><span><b>À</b> ${echapper(e.mail.a)}</span>
      ${e.mail.pieces.length ? `<span>📎 ${e.mail.pieces.length} pièce(s) jointe(s) enregistrée(s) à côté du mail : ${e.mail.pieces.map((p) => echapper(p.nom)).join(', ')}</span>` : ''}</div>` : '';
  }

  rendre() {
    this.fond.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode)));
    if (this.mode === 'commun') {
      this.corps.innerHTML = `
        <fieldset class="ged-depot ged-depot-commun"><legend>Pour tous les fichiers</legend>${this.#formulaire(this.commun, { commun: true })}
          <p class="aide">Les champs laissés vides gardent la valeur propre à chaque fichier (date du fichier, catégorie proposée…).</p></fieldset>
        <table class="ged-depot-fichiers"><thead><tr><th>Fichier</th><th>Titre</th><th>Catégorie proposée</th></tr></thead><tbody>
          ${this.entrees.map((e, i) => `<tr data-i="${i}"><td>${this.#entete(e)}${e.erreur ? `<br><span class="erreur">${echapper(e.erreur)}</span>` : ''}</td>
            <td><input data-titre value="${echapper(e.meta.titre)}" aria-label="Titre de ${echapper(e.fichier.name)}"></td>
            <td>${echapper(e.meta.categorie ? this.#libelleCategorie(e.meta.categorie) : e.propose?.categorie ? this.#libelleCategorie(e.propose.categorie) : '—')}
              ${e.propose?.confidentialite ? ` · ${echapper(libelleConfidentialite(e.propose.confidentialite))}` : ''}</td></tr>`).join('')}
        </tbody></table>`;
      this.#lier(this.corps.querySelector('.ged-depot-commun'), this.commun);
      this.corps.querySelectorAll('tr[data-i]').forEach((tr) => {
        const e = this.entrees[Number(tr.dataset.i)];
        tr.querySelector('[data-titre]').addEventListener('change', (x) => { e.meta.titre = x.target.value; });
      });
      return;
    }
    this.corps.innerHTML = this.entrees.map((e, i) => `
      <fieldset class="ged-depot" data-i="${i}"><legend>${this.#entete(e)}</legend>
        ${e.erreur ? `<p class="erreur">${echapper(e.erreur)}</p>` : ''}
        ${this.#formulaire(e.meta, { mail: e.mail, sens: e.sens })}${this.#infosMail(e)}
      </fieldset>`).join('');
    this.corps.querySelectorAll('fieldset[data-i]').forEach((fs) => {
      const e = this.entrees[Number(fs.dataset.i)];
      this.#lier(fs, e.meta, { propose: e.propose, surSens: (s) => { e.sens = s; } });
    });
  }

  #erreur(t) {
    const m = this.fond.querySelector('.ged-dialogue-message');
    m.textContent = t ?? '';
    m.classList.toggle('erreur', !!t);
  }

  /** Informations envoyées pour un fichier : propres au fichier, puis communes saisies, puis destination. */
  #meta(e) {
    const m = { ...e.meta, ...(this.mode === 'commun' ? this.#communSaisi() : {}) };
    return {
      titre: m.titre, categorie: m.categorie || null, date_document: m.date_document || null, auteur: m.auteur || null, confidentialite: m.confidentialite || null,
      mots_cles: motsCles(m.mots_cles), resume: m.resume || null, notes: m.notes || null, coffre: Boolean(m.coffre),
      type_element: this.destination.type_element ?? null, id_element: this.destination.id_element === null || this.destination.id_element === undefined ? null : String(this.destination.id_element),
      repertoire_id: this.destination.repertoire_id ?? null,
    };
  }

  async enregistrer() {
    const bouton = this.fond.querySelector('[data-action="enregistrer"]');
    bouton.disabled = true;
    const crees = [];
    try {
      for (const e of this.entrees) {
        const meta = this.#meta(e);
        if (!meta.titre?.trim()) throw new Error(`Titre obligatoire pour ${e.fichier.name}`);
        if (e.mail) {
          const { pieces, ...infos } = e.mail;
          const doc = await this.fournisseur.deposer({ fichier: e.fichier, meta: { ...meta, nature: 'mail', mail: { ...infos, sens: e.sens } } });
          crees.push(doc);
          for (const p of pieces) {
            crees.push(await this.fournisseur.deposer({
              fichier: new File([p.contenu], p.nom, { type: p.type }),
              meta: { titre: titreDepuisNom(p.nom), categorie: null, date_document: meta.date_document, auteur: meta.auteur, type_element: meta.type_element,
                id_element: meta.id_element, repertoire_id: meta.repertoire_id, confidentialite: meta.confidentialite, parent_id: doc.id,
                notes: `Pièce jointe du mail « ${infos.objet} »` },
            }));
          }
        } else crees.push(await this.fournisseur.deposer({ fichier: e.fichier, meta }));
      }
      this.message(`${crees.length} document(s) enregistré(s)`, 'succes');
      this.fermer(crees);
    } catch (x) {
      this.#erreur(x.message);
      bouton.disabled = false;
      // Fichiers déjà enregistrés : retirés du dialogue, l'explorateur les montre.
      if (crees.length) {
        const faits = new Set(crees.map((d) => d.titre));
        this.entrees = this.entrees.filter((e) => !faits.has(this.#meta(e).titre));
        this.rendre();
        this.surTermine?.(crees);
      }
    }
  }

  fermer(crees = []) {
    document.removeEventListener('keydown', this.clavier, true);
    this.fond.remove();
    if (crees.length) this.surTermine?.(crees);
  }
}
