import { texte, texteHtml, icone, iconeHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { urlDocument } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { VERSION_MOTEUR } from '../../calcul/index.js';
import { lireAttente, ecrireAttente, retirerAttente, marquerAttente, ETAT_ATTENTE } from '../hors-ligne/attente.js';
import { SUJET_ATTENTE } from '../hors-ligne/synchro.js';
import { fusionner, copieLocale } from '../hors-ligne/fusion.js';

// Fusion d'un document saisi hors ligne et modifié entre-temps sur le serveur (mode hors ligne, lot 4) :
// /fusion/document/:id (id local du document). Trois versions : départ (serveur au début de la saisie), ma saisie,
// serveur actuel. Conflits tranchés champ par champ, modifications prises d'office listées ; puis :
// - Fusionner : saisie fusionnée sur la version du serveur, rouverte dans la page document (recalcul par le moteur),
//   à vérifier puis enregistrer ;
// - Garder ma saisie : la saisie locale remplace la version du serveur (droit FORCER ou administrateur) ;
// - Copie en brouillon : ma saisie devient un nouveau document (le seul choix si le document a été validé) ;
// - Abandonner ma saisie : la version du serveur est rouverte.

/** Élément d'un conflit ou d'une modification : « Entête », « Ligne <code – libellé> »… */
const element = (table, libelle) => (table === 'document' ? texteHtml('hors_ligne_btp.fusion.tables.document') : `${echapper(TABLES[table])} ${echapper(libelle ?? '')}`);

const NATURES = textesParCode('hors_ligne_btp.fusion.natures', ['AJOUT', 'MODIFICATION', 'SUPPRESSION']);
const COTES = textesParCode('hors_ligne_btp.fusion.cotes', ['ici', 'serveur', 'deux']);
const TABLES = textesParCode('hors_ligne_btp.fusion.tables', ['document', 'lignes', 'metres', 'variables', 'ventilations']);
const CHAMPS = textesParCode('hors_ligne_btp.fusion.champs', ['ent_objet', 'ent_tiers_id', 'ent_date', 'ent_intervenants', 'ent_notre_reference', 'ent_reference_externe', 'ent_validite_jours', 'ent_chantier_id', 'ent_marche_id', 'lig_code', 'lig_libelle_html', 'lig_qte', 'lig_unt_code', 'lig_pv', 'lig_pa', 'lig_coef_fg', 'lig_coef_benef', 'lig_coef_remise', 'lig_nat_id', 'lig_tva_id', 'lig_parent_id', 'lig_commentaire', 'mtr_script', 'var_valeur']);

/** Valeur affichée d'un champ (texte sans balises, objets abrégés). */
function valeur(v) {
  if (v === null || v === undefined || v === '') return '<span class="aide">—</span>';
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return echapper(t.length > 90 ? `${t.slice(0, 90)}…` : t);
}

export class PageFusionDocument extends PageBase {
  icone = icone('hors_ligne_btp_fusion');

  async ouvrir() {
    this.titre = texte('hors_ligne_btp.fusion.titre');
    this.conteneur.innerHTML = `<div class="page-parametres page-fusion" data-corps><p class="aide">${texteHtml('hors_ligne_btp.fusion.chargement')}</p></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    const compte = this.app.utilisateur();
    this.entree = await lireAttente(compte, Number(this.params.id));
    if (!this.entree) { corps.innerHTML = `<p class="aide">${texteHtml('hors_ligne_btp.fusion.aucune')}</p>`; return; }
    if (!this.entree.id) { this.app.naviguer(urlDocument(this.entree.id_local), { remplacer: true }); return; }
    if (this.app.apiPerdue) { corps.innerHTML = `<p class="aide">${texteHtml('hors_ligne_btp.fusion.api_perdue')}</p>`; return; }
    this.serveur = await api.document(this.entree.id);
    const definition = await api.definition(this.entree.type_code).catch(() => null);
    const statut = definition?.statuts?.find((s) => s.std_id === this.serveur.document.ent_std_id);
    // Document validé (ou non modifiable) sur le serveur : votre saisie ne peut plus que devenir un autre document.
    this.figee = Boolean(this.serveur.document.ent_verrouille) || statut?.std_modifiable === false;
    this.peutEcraser = !this.figee && (this.app.estAdmin() || (definition?.droits ?? []).includes('FORCER'));
    this.choix = new Map();
    this.titre = texte('hors_ligne_btp.fusion.titre_document', { libelle: this.entree.libelle });
    this.rendre();
  }

  get contenus() { return { depart: this.entree.depart, local: this.entree.saisie, serveur: this.serveur }; }

  rendre() {
    const corps = this.conteneur.querySelector('[data-corps]');
    const f = fusionner(this.contenus, { choix: this.choix });
    this.fusion = f;
    const le = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?');
    const s = this.serveur.document;
    corps.innerHTML = `<div class="entete-page"><h1 class="page-titre">${iconeHtml('hors_ligne_btp_fusion')} ${echapper(this.titre)}</h1><span>
        ${this.figee ? '' : `<button type="button" data-action="fusionner" class="principal" title="${texteHtml('hors_ligne_btp.fusion.fusionner_aide')}">${iconeHtml('hors_ligne_btp_fusionner')} ${texteHtml('hors_ligne_btp.fusion.fusionner')}</button>`}
        ${this.peutEcraser ? `<button type="button" data-action="ecraser" title="${texteHtml('hors_ligne_btp.fusion.ecraser_aide')}">${iconeHtml('hors_ligne_btp_ecraser')} ${texteHtml('hors_ligne_btp.fusion.ecraser')}</button>` : ''}
        <button type="button" data-action="copie" title="${texteHtml('hors_ligne_btp.fusion.copie_aide')}">${iconeHtml('hors_ligne_btp_copie')} ${texteHtml('hors_ligne_btp.fusion.copie')}</button>
        <button type="button" data-action="abandonner" class="danger" title="${texteHtml('hors_ligne_btp.fusion.abandonner_aide')}">${iconeHtml('retirer')} ${texteHtml('hors_ligne_btp.fusion.abandonner')}</button></span></div>
      <p>${texteHtml('hors_ligne_btp.fusion.resume_html', { le: le(this.entree.le), version: String(s.ent_version ?? '') })}${s.ent_modifie_par ? ` (${echapper(s.ent_modifie_par)}, ${le(s.ent_modifie_le)})` : ''}.
        ${this.entree.depart ? '' : `<br><span class="erreur">${texteHtml('hors_ligne_btp.fusion.depart_inconnu')}</span>`}</p>
      ${this.figee ? `<p class="erreur">${texteHtml('hors_ligne_btp.fusion.figee')}</p>` : ''}
      <h2 class="titre-actions">${texteHtml('hors_ligne_btp.fusion.conflits', { nombre: f.conflits.length })}
        ${f.conflits.length ? `<span><button type="button" data-tout="local">${texteHtml('hors_ligne_btp.fusion.tout_local')}</button><button type="button" data-tout="serveur">${texteHtml('hors_ligne_btp.fusion.tout_serveur')}</button></span>` : ''}</h2>
      ${f.conflits.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('hors_ligne_btp.fusion.colonnes.element')}</th><th>${texteHtml('hors_ligne_btp.fusion.colonnes.champ')}</th><th>${texteHtml('hors_ligne_btp.fusion.colonnes.depart')}</th><th>${texteHtml('hors_ligne_btp.fusion.cotes.ici')}</th><th>${texteHtml('hors_ligne_btp.fusion.cotes.serveur')}</th></tr></thead><tbody>
        ${f.conflits.map((c) => this.#ligneConflit(c)).join('')}</tbody></table>`
    : `<p class="aide">${texteHtml('hors_ligne_btp.fusion.aucun_conflit')}</p>`}
      <h2>${texteHtml('hors_ligne_btp.fusion.changements', { nombre: f.changements.length })}</h2>
      ${f.changements.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('hors_ligne_btp.fusion.colonnes.element')}</th><th>${texteHtml('hors_ligne_btp.fusion.colonnes.nature')}</th><th>${texteHtml('hors_ligne_btp.fusion.colonnes.cote')}</th></tr></thead><tbody>
        ${f.changements.map((c) => `<tr><td>${element(c.table, c.libelle)}</td><td>${echapper(NATURES[c.nature])}</td><td>${echapper(COTES[c.cote])}</td></tr>`).join('')}</tbody></table>`
    : `<p class="aide">${texteHtml('hors_ligne_btp.fusion.aucun_changement')}</p>`}`;
    corps.querySelectorAll('input[data-conflit]').forEach((r) => r.addEventListener('change', () => { this.choix.set(r.dataset.conflit, r.value); this.rendre(); }));
    corps.querySelectorAll('[data-tout]').forEach((b) => b.addEventListener('click', () => {
      for (const c of this.fusion.conflits) this.choix.set(c.cle, b.dataset.tout);
      this.rendre();
    }));
    corps.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => this[b.dataset.action]().catch((e) => this.app.erreur(e))));
  }

  #ligneConflit(c) {
    const radio = (cote, html) => `<label><input type="radio" name="${echapper(c.cle)}" data-conflit="${echapper(c.cle)}" value="${cote}" ${c.choix === cote ? 'checked' : ''}> ${html}</label>`;
    if (c.nature === 'CHAMP') {
      return `<tr><td>${element(c.table, c.libelle)}</td><td>${echapper(CHAMPS[c.champ] ?? c.champ)}</td><td>${valeur(c.depart)}</td>
        <td>${radio('local', valeur(c.local))}</td><td>${radio('serveur', valeur(c.serveur))}</td></tr>`;
    }
    const ici = c.nature === 'SUPPRIME_ICI';
    return `<tr><td>${element(c.table, c.libelle)}</td><td>${texteHtml(ici ? 'hors_ligne_btp.fusion.supprime_ici' : 'hors_ligne_btp.fusion.supprime_serveur')}</td><td></td>
      <td>${radio('local', texteHtml(ici ? 'hors_ligne_btp.fusion.supprimer' : 'hors_ligne_btp.fusion.garder_local'))}</td><td>${radio('serveur', texteHtml(ici ? 'hors_ligne_btp.fusion.garder_serveur' : 'hors_ligne_btp.fusion.supprimer'))}</td></tr>`;
  }

  /** Saisie fusionnée (ou la mienne entière) posée sur la version du serveur, puis ouverte dans le document. */
  async #ouvrirFusion(mode) {
    const f = mode === 'ecraser' ? fusionner(this.contenus, { mode }) : this.fusion;
    await marquerAttente(this.entree.compte, this.entree.id_local, {
      saisie: f.saisie, depart: this.serveur, etat: ETAT_ATTENTE.FUSION, erreur: null, le: new Date().toISOString(),
    });
    this.app.publier(SUJET_ATTENTE, {});
    this.app.message(texte(mode === 'ecraser' ? 'hors_ligne_btp.fusion.message_ecraser'
      : 'hors_ligne_btp.fusion.message_fusion'), 'avertissement');
    await this.app.naviguer(urlDocument(this.entree.id_local), { remplacer: true });
  }

  fusionner() { return this.#ouvrirFusion('fusion'); }

  async ecraser() {
    if (!await confirmer(texte('hors_ligne_btp.fusion.confirmer_ecraser'), { ok: texte('hors_ligne_btp.fusion.ecraser'), danger: true })) return;
    await this.#ouvrirFusion('ecraser');
  }

  async copie() {
    const id = -Date.now();
    const saisie = copieLocale(this.entree.saisie, id);
    saisie.document.ent_objet = `${saisie.document.ent_objet ?? ''} ${texte('hors_ligne_btp.fusion.suffixe_copie')}`.trim();
    const d = saisie.document;
    await ecrireAttente({
      compte: this.entree.compte, id_local: id, id: null, type_code: this.entree.type_code,
      creation: { params: { ent_tyd_id: d.ent_tyd_id, ent_tiers_id: d.ent_tiers_id ?? null, ent_objet: d.ent_objet }, initial: null },
      envoi: { document: d, lignes: saisie.lignes, metres: saisie.metres, variables: saisie.variables, ventilations: saisie.ventilations, version_moteur_client: VERSION_MOTEUR },
      saisie, depart: null, libelle: `${this.entree.libelle.split(' ')[0]} ${texte('hors_ligne_btp.fusion.suffixe_copie')}`, etat: ETAT_ATTENTE.FUSION,
    });
    await retirerAttente(this.entree.compte, this.entree.id_local);
    this.app.publier(SUJET_ATTENTE, {});
    this.app.message(texte('hors_ligne_btp.fusion.message_copie'), 'avertissement');
    await this.app.naviguer(urlDocument(id), { remplacer: true });
  }

  async abandonner() {
    if (!await confirmer(texte('hors_ligne_btp.fusion.confirmer_abandon'), { ok: texte('hors_ligne_btp.fusion.abandonner'), danger: true })) return;
    await retirerAttente(this.entree.compte, this.entree.id_local);
    this.app.publier(SUJET_ATTENTE, {});
    await this.app.naviguer(urlDocument(this.entree.id), { remplacer: true });
  }
}
