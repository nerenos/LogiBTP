// Module Facturation électronique, détail d'un flux (GET /flux/{id}) : métadonnées (sens, type, syntaxe, profil, règle,
// identifiants de suivi et de dépôt, accusé, essais, élément de l'application), fichiers (téléchargement), statuts du
// cycle de vie, erreurs, chronologie du journal ; nouvelle tentative et dépôt manuel selon l'état du flux.
import { texte, texteHtml, iconeHtml, messageErreur } from '@logibtp/socle/dictionnaire';
import { echapper, confirmer, alerter, formatDateHeure, formatNombre, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { SENS_FLUX } from '../src/codes.js';
import { actionsFlux, documentsFlux, graviteEtat, graviteStatut, tailleKo, champsDetail, empreinteCourte } from './modeles.js';
import { Chronologie, libelleEtat, libelleCode } from './chronologie.js';
import { libelleType } from './tableau-flux.js';
import { libelleConnecteur } from './parametres-fe.js';
import { telechargerDocumentFlux, confirmerDepotManuel } from './depot-manuel.js';

export const GROUPE_RACCOURCIS_DETAIL = 'facture_electronique_detail';
declarerRaccourcis(GROUPE_RACCOURCIS_DETAIL, {
  libelle: texte('facture_electronique.raccourcis.groupe_detail'),
  actions: {
    tentative: { libelle: texte('facture_electronique.raccourcis.tentative'), defaut: 'Alt+Shift+T' },
    telecharger: { libelle: texte('facture_electronique.raccourcis.telecharger'), defaut: 'Alt+Shift+O' },
    confirmer: { libelle: texte('facture_electronique.raccourcis.confirmer_depot'), defaut: 'Alt+Shift+C' },
  },
});

const valeur = (v) => (v === null || v === undefined || v === '' ? '' : String(v));

/**
 * Détail d'un flux. options : { peut: { modifier }, api: { detail(id), fichier(id, document), tentative(id),
 * confirmerDepot(id, corps) } (promesses), libelleElement(type, id), ouvrirElement(type, id, nouvelleFenetre)
 * (facultatif), libelleUtilisateur(code), ouvrirFlux(id, nouvelleFenetre), apresEcriture(flux), erreur(e) }.
 */
export class DetailFlux {
  #zone;
  #o;
  #id = null;
  #d = null;
  #chronologie = null;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { peut: {}, api: {}, libelleElement: (type, id) => texte('facture_electronique.element', { type, id }), apresEcriture: () => {},
      erreur: (e) => alerter(messageErreur(e?.code, e?.message ?? String(e))), ...options };
    this.#zone.addEventListener('click', (e) => this.#clic(e));
    this.#zone.addEventListener('keydown', (e) => {
      const action = actionDe(e, GROUPE_RACCOURCIS_DETAIL);
      if (!action || !this.#d) return;
      const a = actionsFlux(this.#d.flux);
      if (action === 'tentative' && a.tentative && this.#o.peut.modifier) this.tentative();
      else if (action === 'telecharger') this.telecharger();
      else if (action === 'confirmer' && a.confirmerDepot && this.#o.peut.modifier) this.confirmerDepot();
      else return;
      e.preventDefault();
    });
  }

  /** Détail affiché (flux, statuts, erreurs, fichiers, chronologie). */
  get detail() {
    return this.#d;
  }

  /** Ouvre le flux id. */
  async ouvrir(id) {
    this.#id = id;
    await this.charger();
  }

  async charger() {
    if (this.#id === null) return;
    try {
      this.#d = await this.#o.api.detail(this.#id);
    } catch (e) {
      this.#d = null;
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  #rendre() {
    const d = this.#d;
    if (!d) { this.#zone.innerHTML = `<p class="aide">${texteHtml('facture_electronique.detail.aucun')}</p>`; return; }
    const f = d.flux;
    const a = actionsFlux(f);
    const { peut } = this.#o;
    const meta = [
      ['sens', texte(`facture_electronique.sens.${f.sens}`)], ['type', libelleType(f.type)], ['syntaxe', libelleCode('syntaxes', f.syntaxe)], ['profil', f.profil ? libelleCode('profils', f.profil) : ''], ['regle', f.regle],
      ['numero', f.numero], ['nom', f.nom], ['connecteur', libelleConnecteur(f.connecteur)], ['id_suivi', f.id_suivi], ['id_flux', f.id_flux],
      ['accuse', f.accuse ? libelleCode('accuses', f.accuse) : ''], ['essais', f.essais || ''],
      ['prochain_essai', formatDateHeure(f.prochain_essai)], ['depose_le', formatDateHeure(f.depose_le)], ['modifie_pa_le', formatDateHeure(f.modifie_pa_le)],
      ['cree_le', formatDateHeure(f.cree_le)], ['empreinte', empreinteCourte(f.empreinte)],
    ].filter(([, v]) => valeur(v) !== '');
    const element = f.type_element ? (this.#o.ouvrirElement
      ? `<button type="button" class="lien" data-element>${echapper(this.#o.libelleElement(f.type_element, f.id_element))}</button>`
      : echapper(this.#o.libelleElement(f.type_element, f.id_element))) : texteHtml('facture_electronique.detail.sans_element');
    const accuse = champsDetail(f.accuse_details);
    const docs = documentsFlux(f, d.fichiers).map(({ document, fichier }) => `<tr><td>${echapper(texte(`facture_electronique.documents.${document}`))}</td>
      <td>${echapper(fichier?.nom ?? '')}</td><td class="montant">${fichier ? echapper(texte('facture_electronique.detail.ko', { taille: formatNombre(tailleKo(fichier.taille), 1) })) : ''}</td>
      <td title="${echapper(fichier?.empreinte ?? '')}">${echapper(empreinteCourte(fichier?.empreinte))}</td>
      <td class="cellule-boutons"><button type="button" data-document="${echapper(document)}" title="${echapper(texte('facture_electronique.detail.telecharger'))}">${iconeHtml('fe_telecharger')}</button></td></tr>`).join('');
    const statuts = d.statuts.map((s) => `<tr><td><span class="fe-pastille fe-${graviteStatut(s.code)}">${echapper(libelleEtat(s.code))}</span></td>
      <td>${echapper(texte(`facture_electronique.sens_statut.${s.sens}`))}</td><td>${echapper(s.emetteur ? libelleCode('emetteurs', s.emetteur) : '')}</td>
      <td>${echapper(s.motif ? libelleCode('motifs', s.motif) : '')}</td><td>${echapper(s.action ? libelleCode('actions_cdv', s.action) : '')}</td>
      <td class="montant">${s.montant === null || s.montant === undefined ? '' : formatNombre(String(s.montant), 2)}</td><td>${echapper(formatDateHeure(s.date))}</td>
      <td>${s.flux_cdar_id ? `<button type="button" class="lien" data-ouvrir-flux="${s.flux_cdar_id}">${echapper(texte('facture_electronique.chronologie.flux', { id: s.flux_cdar_id }))}</button>` : ''}</td></tr>`).join('');
    const erreurs = d.erreurs.map((x) => `<tr><td>${x.essai}</td><td><code>${echapper(x.code)}</code></td><td>${echapper(x.niveau ?? '')}</td><td>${echapper(x.element ?? '')}</td>
      <td>${echapper(messageErreur(x.code, x.message ?? ''))}</td><td>${valeur(x.statut_http)}</td><td><code>${echapper(x.request_id ?? '')}</code></td>
      <td>${echapper(formatDateHeure(x.cree_le))}</td></tr>`).join('');
    const entetes = (cles) => `<thead><tr>${cles.map((c) => `<th>${c ? texteHtml(`facture_electronique.detail.colonnes.${c}`) : ''}</th>`).join('')}</tr></thead>`;
    this.#zone.innerHTML = `<div class="entete-page"><h2 class="titre-actions">${iconeHtml(f.sens === SENS_FLUX.SORTANT ? 'fe_sortant' : 'fe_entrant')}
        ${echapper(texte('facture_electronique.detail.titre', { id: f.id, nom: f.numero ?? f.nom }))}
        <span class="fe-pastille fe-${graviteEtat(f.etat)}">${echapper(libelleEtat(f.etat))}</span>
        ${f.statut_affiche ? `<span class="fe-pastille fe-${graviteStatut(f.statut_affiche)}">${echapper(libelleEtat(f.statut_affiche))}</span>` : ''}</h2>
      <span class="barre-outils"><span class="groupe-outils">
        <button type="button" data-actualiser title="${echapper(texte('commun.actualiser'))}">${iconeHtml('fe_actualiser')}</button>
        ${a.aDeposer ? `<button type="button" data-a-deposer>${iconeHtml('fe_telecharger')} ${texteHtml('facture_electronique.depot.telecharger')}</button>` : ''}
        ${a.confirmerDepot && peut.modifier ? `<button type="button" class="principal" data-confirmer>${iconeHtml('fe_confirmer')} ${texteHtml('facture_electronique.depot.confirmer')}</button>` : ''}
        ${a.tentative && peut.modifier ? `<button type="button" class="principal" data-tentative>${iconeHtml('fe_tentative')} ${texteHtml('facture_electronique.detail.tentative')}</button>` : ''}
      </span></span></div>
      ${f.derniere_erreur ? `<p class="fe-erreur">${iconeHtml('fe_avertissement')} ${echapper(f.derniere_erreur)}</p>` : ''}
      <div class="fe-detail">
        <section><h3>${texteHtml('facture_electronique.detail.metadonnees')}</h3>
          <dl class="fe-meta">${meta.map(([k, v]) => `<dt>${texteHtml(`facture_electronique.detail.champs.${k}`)}</dt><dd>${echapper(v)}</dd>`).join('')}
            <dt>${texteHtml('facture_electronique.detail.champs.element')}</dt><dd>${element}</dd>
            ${accuse.map(([k, v]) => `<dt>${echapper(texte('facture_electronique.detail.accuse_detail', { champ: k }))}</dt><dd>${echapper(v)}</dd>`).join('')}</dl></section>
        <section><h3>${iconeHtml('fe_fichiers')} ${texteHtml('facture_electronique.detail.fichiers')}</h3>
          <table class="tableau-compact fe-table">${entetes(['document', 'nom', 'taille', 'empreinte', ''])}<tbody>${docs}</tbody></table></section>
        <section><h3>${iconeHtml('fe_statuts')} ${texteHtml('facture_electronique.detail.statuts')}</h3>
          ${statuts ? `<table class="tableau-compact fe-table">${entetes(['statut', 'sens', 'emetteur', 'motif', 'action', 'montant', 'date', 'cdar'])}<tbody>${statuts}</tbody></table>`
            : `<p class="aide">${texteHtml('facture_electronique.detail.aucun_statut')}</p>`}</section>
        <section><h3>${iconeHtml('fe_avertissement')} ${texteHtml('facture_electronique.detail.erreurs')}</h3>
          ${erreurs ? `<table class="tableau-compact fe-table">${entetes(['essai', 'code', 'niveau', 'element', 'message', 'http', 'request_id', 'date'])}<tbody>${erreurs}</tbody></table>`
            : `<p class="aide">${texteHtml('facture_electronique.detail.aucune_erreur')}</p>`}</section>
        <section class="fe-detail-chronologie" data-chronologie></section>
      </div>`;
    this.#chronologie = new Chronologie(this.#zone.querySelector('[data-chronologie]'), {
      evenements: d.chronologie, libelleUtilisateur: this.#o.libelleUtilisateur, ouvrirFlux: this.#o.ouvrirFlux,
    });
    this.#chronologie.rendre();
  }

  async #clic(e) {
    const b = e.target.closest('button');
    if (!b || !this.#d || b.closest('[data-chronologie]')) return;
    const nouvelle = e.ctrlKey || e.metaKey;
    if (b.matches('[data-actualiser]')) this.charger();
    else if (b.matches('[data-tentative]')) this.tentative();
    else if (b.matches('[data-confirmer]')) this.confirmerDepot();
    else if (b.matches('[data-a-deposer]')) this.telecharger();
    else if (b.dataset.document) this.telecharger(b.dataset.document);
    else if (b.matches('[data-element]')) this.#o.ouvrirElement?.(this.#d.flux.type_element, this.#d.flux.id_element, nouvelle);
    else if (b.dataset.ouvrirFlux) this.#o.ouvrirFlux?.(Number(b.dataset.ouvrirFlux), nouvelle);
  }

  /** Télécharge un document du flux (Original par défaut : fichier à déposer). */
  async telecharger(document) {
    try {
      await telechargerDocumentFlux(this.#o.api, this.#d.flux, document);
    } catch (e) {
      this.#o.erreur(e);
    }
  }

  async #ecrire(action) {
    try {
      const r = await action();
      if (r) this.#o.apresEcriture(r);
    } catch (e) {
      this.#o.erreur(e);
    }
    await this.charger();
  }

  /** Nouvelle tentative après confirmation (flux refusé : nouveau dépôt sous un nouvel identifiant de suivi). */
  async tentative() {
    const f = this.#d.flux;
    const cle = f.id_flux ? 'facture_electronique.detail.confirmer_redepot' : 'facture_electronique.detail.confirmer_tentative';
    if (!await confirmer(texte(cle, { nom: f.numero ?? f.nom }), { titre: texte('facture_electronique.detail.tentative') })) return;
    await this.#ecrire(() => this.#o.api.tentative(f.id));
  }

  /** Saisie de l'accusé du dépôt fait sur le portail de la PA. */
  async confirmerDepot() {
    await this.#ecrire(() => confirmerDepotManuel(this.#o.api, this.#d.flux));
  }
}
