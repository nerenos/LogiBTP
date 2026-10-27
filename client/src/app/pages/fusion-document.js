import { PageBase } from '@logibtp/navigation';
import { echapper, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { VERSION_MOTEUR } from '../../calcul/index.js';
import { lireAttente, ecrireAttente, retirerAttente, marquerAttente } from '../hors-ligne/attente.js';
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
const element = (table, libelle) => (table === 'document' ? 'Entête' : `${TABLES[table]} ${echapper(libelle ?? '')}`);

const NATURES = { AJOUT: 'Ajout', MODIFICATION: 'Modification', SUPPRESSION: 'Suppression' };
const COTES = { ici: 'Ma saisie', serveur: 'Serveur', deux: 'Les deux (sans conflit)' };
const TABLES = { document: 'Entête', lignes: 'Ligne', metres: 'Métré', variables: 'Variable', ventilations: 'Ventilation' };
const CHAMPS = {
  ent_objet: 'Objet', ent_tiers_id: 'Tiers', ent_date: 'Date', ent_intervenants: 'Intervenants', ent_notre_reference: 'Notre référence',
  ent_reference_externe: 'Référence externe', ent_validite_jours: 'Validité (jours)', ent_chantier_id: 'Chantier', ent_marche_id: 'Marché',
  lig_code: 'Code', lig_libelle_html: 'Libellé', lig_qte: 'Quantité', lig_unt_code: 'Unité', lig_pv: 'PV', lig_pa: 'PA', lig_coef_fg: 'Coef. FG',
  lig_coef_benef: 'Coef. bénéfice', lig_coef_remise: 'Remise', lig_nat_id: 'Nature', lig_tva_id: 'TVA', lig_parent_id: 'Tranche', lig_commentaire: 'Commentaire',
  mtr_script: 'Script', var_valeur: 'Valeur',
};

/** Valeur affichée d'un champ (texte sans balises, objets abrégés). */
function valeur(v) {
  if (v === null || v === undefined || v === '') return '<span class="aide">—</span>';
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return echapper(t.length > 90 ? `${t.slice(0, 90)}…` : t);
}

export class PageFusionDocument extends PageBase {
  icone = '⇄';

  async ouvrir() {
    this.titre = 'Fusion';
    this.conteneur.innerHTML = '<div class="page-parametres page-fusion" data-corps><p class="aide">Chargement…</p></div>';
    const corps = this.conteneur.querySelector('[data-corps]');
    const compte = this.app.utilisateur();
    this.entree = await lireAttente(compte, Number(this.params.id));
    if (!this.entree) { corps.innerHTML = '<p class="aide">Aucune saisie hors ligne de ce document sur ce poste.</p>'; return; }
    if (!this.entree.id) { this.app.naviguer(`/document/${this.entree.id_local}`, { remplacer: true }); return; }
    if (this.app.apiPerdue) { corps.innerHTML = '<p class="aide">La fusion compare votre saisie à la version actuelle du serveur : elle sera possible à son retour.</p>'; return; }
    this.serveur = await api.document(this.entree.id);
    const definition = await api.definition(this.entree.type_code).catch(() => null);
    const statut = definition?.statuts?.find((s) => s.std_id === this.serveur.document.ent_std_id);
    // Document validé (ou non modifiable) sur le serveur : votre saisie ne peut plus que devenir un autre document.
    this.figee = Boolean(this.serveur.document.ent_verrouille) || statut?.std_modifiable === false;
    this.peutEcraser = !this.figee && (this.app.estAdmin() || (definition?.droits ?? []).includes('FORCER'));
    this.choix = new Map();
    this.titre = `Fusion : ${this.entree.libelle}`;
    this.rendre();
  }

  get contenus() { return { depart: this.entree.depart, local: this.entree.saisie, serveur: this.serveur }; }

  rendre() {
    const corps = this.conteneur.querySelector('[data-corps]');
    const f = fusionner(this.contenus, { choix: this.choix });
    this.fusion = f;
    const le = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?');
    const s = this.serveur.document;
    corps.innerHTML = `<div class="entete-page"><h1 class="page-titre">⇄ ${echapper(this.titre)}</h1><span>
        ${this.figee ? '' : `<button type="button" data-action="fusionner" class="principal" title="Saisie fusionnée ouverte dans le document : vérifiez puis enregistrez">✓ Fusionner et vérifier</button>`}
        ${this.peutEcraser ? '<button type="button" data-action="ecraser" title="Votre saisie remplace la version du serveur (ses modifications sont perdues)">⇥ Garder ma saisie</button>' : ''}
        <button type="button" data-action="copie" title="Votre saisie devient un nouveau document en brouillon ; ce document reste tel que sur le serveur">⧉ Copie en brouillon</button>
        <button type="button" data-action="abandonner" class="danger" title="Votre saisie est supprimée de ce poste">✕ Abandonner ma saisie</button></span></div>
      <p>Votre saisie a été enregistrée sur ce poste le <b>${le(this.entree.le)}</b>, sans réseau. Entre-temps, le serveur a enregistré
        la version <b>${echapper(String(s.ent_version ?? ''))}</b>${s.ent_modifie_par ? ` (${echapper(s.ent_modifie_par)}, ${le(s.ent_modifie_le)})` : ''}.
        ${this.entree.depart ? '' : '<br><span class="erreur">Version de départ inconnue : toute différence est présentée comme un conflit.</span>'}</p>
      ${this.figee ? '<p class="erreur">Le document a été validé (ou n’est plus modifiable) sur le serveur : votre saisie peut devenir une copie en brouillon, ou être abandonnée.</p>' : ''}
      <h2 class="titre-actions">Conflits (${f.conflits.length})
        ${f.conflits.length ? '<span><button type="button" data-tout="local">Tout : ma saisie</button><button type="button" data-tout="serveur">Tout : serveur</button></span>' : ''}</h2>
      ${f.conflits.length ? `<table class="tableau-compact"><thead><tr><th>Élément</th><th>Champ</th><th>Départ</th><th>Ma saisie</th><th>Serveur</th></tr></thead><tbody>
        ${f.conflits.map((c) => this.#ligneConflit(c)).join('')}</tbody></table>`
    : '<p class="aide">Aucun conflit : les modifications des deux côtés se complètent.</p>'}
      <h2>Modifications prises d'office (${f.changements.length})</h2>
      ${f.changements.length ? `<table class="tableau-compact"><thead><tr><th>Élément</th><th>Nature</th><th>Faite par</th></tr></thead><tbody>
        ${f.changements.map((c) => `<tr><td>${element(c.table, c.libelle)}</td><td>${NATURES[c.nature]}</td><td>${COTES[c.cote]}</td></tr>`).join('')}</tbody></table>`
    : '<p class="aide">Aucune.</p>'}`;
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
    return `<tr><td>${element(c.table, c.libelle)}</td><td>${ici ? 'Supprimée dans ma saisie, modifiée sur le serveur' : 'Modifiée dans ma saisie, supprimée sur le serveur'}</td><td></td>
      <td>${radio('local', ici ? 'Supprimer' : 'Garder ma version')}</td><td>${radio('serveur', ici ? 'Garder la version du serveur' : 'Supprimer')}</td></tr>`;
  }

  /** Saisie fusionnée (ou la mienne entière) posée sur la version du serveur, puis ouverte dans le document. */
  async #ouvrirFusion(mode) {
    const f = mode === 'ecraser' ? fusionner(this.contenus, { mode }) : this.fusion;
    await marquerAttente(this.entree.compte, this.entree.id_local, {
      saisie: f.saisie, depart: this.serveur, etat: 'FUSION', erreur: null, le: new Date().toISOString(),
    });
    this.app.publier(SUJET_ATTENTE, {});
    this.app.message(mode === 'ecraser' ? 'Votre saisie est posée sur la version du serveur : vérifiez puis enregistrez'
      : 'Saisie fusionnée : vérifiez (totaux recalculés) puis enregistrez', 'avertissement');
    await this.app.naviguer(`/document/${this.entree.id_local}`, { remplacer: true });
  }

  fusionner() { return this.#ouvrirFusion('fusion'); }

  async ecraser() {
    if (!await confirmer('Garder votre saisie entière ? Les modifications faites sur le serveur depuis votre départ seront perdues à l’enregistrement.', { ok: 'Garder ma saisie', danger: true })) return;
    await this.#ouvrirFusion('ecraser');
  }

  async copie() {
    const id = -Date.now();
    const saisie = copieLocale(this.entree.saisie, id);
    saisie.document.ent_objet = `${saisie.document.ent_objet ?? ''} (copie hors ligne)`.trim();
    const d = saisie.document;
    await ecrireAttente({
      compte: this.entree.compte, id_local: id, id: null, type_code: this.entree.type_code,
      creation: { params: { ent_tyd_id: d.ent_tyd_id, ent_tiers_id: d.ent_tiers_id ?? null, ent_objet: d.ent_objet }, initial: null },
      envoi: { document: d, lignes: saisie.lignes, metres: saisie.metres, variables: saisie.variables, ventilations: saisie.ventilations, version_moteur_client: VERSION_MOTEUR },
      saisie, depart: null, libelle: `${this.entree.libelle.split(' ')[0]} (copie hors ligne)`, etat: 'FUSION',
    });
    await retirerAttente(this.entree.compte, this.entree.id_local);
    this.app.publier(SUJET_ATTENTE, {});
    this.app.message('Copie en brouillon : vérifiez puis enregistrez pour la créer sur le serveur', 'avertissement');
    await this.app.naviguer(`/document/${id}`, { remplacer: true });
  }

  async abandonner() {
    if (!await confirmer('Supprimer votre saisie hors ligne de ce poste ? La version du serveur sera rouverte.', { ok: 'Abandonner ma saisie', danger: true })) return;
    await retirerAttente(this.entree.compte, this.entree.id_local);
    this.app.publier(SUJET_ATTENTE, {});
    await this.app.naviguer(`/document/${this.entree.id}`, { remplacer: true });
  }
}
