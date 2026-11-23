import { texte, texteHtml, textesParCode, messageErreur } from '@logibtp/socle/dictionnaire';
import { echapper, creerCombo, confirmer } from '@logibtp/socle/ui';
import { FAMILLE_DOCUMENT, TYPE_ZONE_ENTETE } from '../src/codes.js';
import { proposerColonneZone, ecrireValeursZone, demandeCreationZone, lireValeursZone, controleDeErreurZone, porteeZone } from '../src/zones-entete.js';

// Paramétrage des zones supplémentaires d'entête (lot 10 fiches-lignes-documents) : registre des colonnes « x_ » de la
// table document (libellé, groupe de l'onglet Entête, ordre, obligatoire, valeurs d'une liste, portée global / famille /
// type de document, actif), création (nom technique proposé d'après le libellé) et suppression avec confirmation (les
// valeurs saisies sont perdues). Administrateur ; refus du serveur (422) affichés sous le contrôle concerné.
// Fournisseur : { zones() → [zone], creer(demande), modifier(colonne, modification), supprimer(colonne),
// types() → [{ tyd_code, tyd_libelle }] }.

const CONTROLES = ['colonne', 'type', 'libelle', 'valeurs', 'portee'];

export class ParametrageZonesEntete {
  constructor(conteneur, { fournisseur, admin = false, message = () => {} }) {
    this.conteneur = conteneur;
    this.fournisseur = fournisseur;
    this.admin = admin;
    this.message = message;
    this.zones = [];
    this.types = [];
    this.libelles = textesParCode('document.zones.types', Object.values(TYPE_ZONE_ENTETE));
  }

  async ouvrir() {
    if (!this.admin) {
      this.conteneur.innerHTML = `<p class="aide">${texteHtml('document.parametrage.lecture_seule')}</p>`;
      return;
    }
    this.types = await this.fournisseur.types();
    await this.charger();
  }

  async charger() {
    this.zones = await this.fournisseur.zones();
    this.rendre();
  }

  /** Options de portée : global, une famille, un type de document. */
  optionsPortee() {
    return [{ valeur: '', libelle: texte('document.styles.global') },
      ...Object.values(FAMILLE_DOCUMENT).map((f) => ({ valeur: `F:${f}`, libelle: texte('document.styles.famille', { famille: f }) })),
      ...this.types.map((t) => ({ valeur: `T:${t.tyd_code}`, libelle: t.tyd_libelle, detail: t.tyd_code }))];
  }

  static valeurPortee(zone) {
    return { GLOBAL: '', FAMILLE: `F:${zone.famille}`, TYPE: `T:${zone.type_document}` }[porteeZone(zone)];
  }

  static lirePortee(valeur) {
    return { famille: valeur?.startsWith('F:') ? valeur.slice(2) : null, type_document: valeur?.startsWith('T:') ? valeur.slice(2) : null };
  }

  rendre() {
    const t = (cle) => texteHtml(`document.zones.${cle}`);
    this.conteneur.innerHTML = `<p class="aide">${t('aide')}</p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('document.zones.libelle')}</th><th>${t('colonne')}</th><th>${t('type')}</th>
      <th>${t('groupe')}</th><th>${t('portee')}</th><th>${t('valeurs')}</th><th>${t('ordre')}</th><th>${t('obligatoire')}</th><th>${t('actif')}</th><th></th></tr></thead><tbody>
      ${this.zones.map((z, i) => this.ligne(z, i)).join('')}
      <tr data-nouveau>${this.ligneNouveau()}</tr></tbody></table>`;
    const corps = this.conteneur;
    for (const tr of corps.querySelectorAll('tr[data-i]')) {
      const z = this.zones[Number(tr.dataset.i)];
      const combo = creerCombo({ options: this.optionsPortee(), valeur: ParametrageZonesEntete.valeurPortee(z), vide: false });
      combo.dataset.c = 'portee';
      tr.querySelector('[data-portee]').append(combo);
      tr.querySelector('[data-c="valeurs"]').hidden = z.type !== TYPE_ZONE_ENTETE.LISTE;
      tr.querySelector('[data-c="obligatoire"]').disabled = z.type === TYPE_ZONE_ENTETE.CASE_A_COCHER;
    }
    this.preparerNouveau(corps.querySelector('[data-nouveau]'));
    corps.onclick = (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const tr = b.closest('tr');
      const actions = {
        creer: () => this.creer(tr),
        enregistrer: () => this.enregistrer(tr, this.zones[Number(tr.dataset.i)]),
        supprimer: () => this.supprimer(this.zones[Number(tr.dataset.i)]),
      };
      Promise.resolve(actions[b.dataset.action]?.()).catch((x) => this.refus(tr, x));
    };
  }

  ligne(z, i) {
    return `<tr data-i="${i}"${z.actif ? '' : ' class="discret"'}>
      <td><input data-c="libelle" value="${echapper(z.libelle)}" size="22" maxlength="100"><span class="erreur" data-erreur="libelle"></span></td>
      <td><code>${echapper(z.colonne)}</code></td>
      <td>${echapper(this.libelles[z.type] ?? z.type)}</td>
      <td><input data-c="groupe" value="${echapper(z.groupe ?? '')}" size="16" maxlength="100"></td>
      <td><span data-portee></span><span class="erreur" data-erreur="portee"></span></td>
      <td><textarea data-c="valeurs" rows="3" cols="22" title="${texteHtml('document.zones.valeurs_aide')}">${echapper(ecrireValeursZone(z.valeurs))}</textarea><span class="erreur" data-erreur="valeurs"></span></td>
      <td><input data-c="ordre" value="${Number(z.ordre ?? 0)}" size="4" inputmode="numeric"></td>
      <td><input type="checkbox" data-c="obligatoire" ${z.obligatoire ? 'checked' : ''}></td>
      <td><input type="checkbox" data-c="actif" ${z.actif ? 'checked' : ''}></td>
      <td class="cellule-boutons"><button type="button" data-action="enregistrer">${texteHtml('commun.enregistrer')}</button>
        <button type="button" data-action="supprimer" class="danger">${texteHtml('commun.supprimer')}</button></td></tr>`;
  }

  ligneNouveau() {
    const ordre = this.zones.reduce((m, z) => Math.max(m, Number(z.ordre ?? 0)), 0) + 10;
    return `<td><input data-c="libelle" size="22" maxlength="100" placeholder="${texteHtml('document.zones.nouvelle')}"><span class="erreur" data-erreur="libelle"></span></td>
      <td><input data-c="colonne" size="22" maxlength="43"><span class="erreur" data-erreur="colonne"></span></td>
      <td><span data-type></span><span class="erreur" data-erreur="type"></span></td>
      <td><input data-c="groupe" size="16" maxlength="100"></td>
      <td><span data-portee></span><span class="erreur" data-erreur="portee"></span></td>
      <td><textarea data-c="valeurs" rows="3" cols="22" placeholder="${texteHtml('document.zones.valeurs_aide')}"></textarea><span class="erreur" data-erreur="valeurs"></span></td>
      <td><input data-c="ordre" value="${ordre}" size="4" inputmode="numeric"></td>
      <td><input type="checkbox" data-c="obligatoire"></td><td></td>
      <td class="cellule-boutons"><button type="button" data-action="creer" class="principal">${texteHtml('document.zones.creer')}</button></td>`;
  }

  /** Combos de type et de portée de la ligne de création, nom technique proposé d'après le libellé tant qu'il n'est pas saisi. */
  preparerNouveau(tr) {
    const type = creerCombo({ options: Object.entries(this.libelles).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: TYPE_ZONE_ENTETE.TEXTE, vide: false });
    type.dataset.c = 'type';
    tr.querySelector('[data-type]').append(type);
    const portee = creerCombo({ options: this.optionsPortee(), valeur: '', vide: false });
    portee.dataset.c = 'portee';
    tr.querySelector('[data-portee]').append(portee);
    const valeurs = tr.querySelector('[data-c="valeurs"]');
    const obligatoire = tr.querySelector('[data-c="obligatoire"]');
    const sync = () => {
      valeurs.hidden = type.valeurCombo !== TYPE_ZONE_ENTETE.LISTE;
      obligatoire.disabled = type.valeurCombo === TYPE_ZONE_ENTETE.CASE_A_COCHER;
      if (obligatoire.disabled) obligatoire.checked = false;
    };
    type.addEventListener('change', sync);
    sync();
    const libelle = tr.querySelector('[data-c="libelle"]');
    const colonne = tr.querySelector('[data-c="colonne"]');
    let manuel = false;
    colonne.addEventListener('input', () => { manuel = true; });
    libelle.addEventListener('input', () => { if (!manuel) colonne.value = proposerColonneZone(libelle.value); });
    colonne.value = proposerColonneZone('');
  }

  effacer(tr) { tr.querySelectorAll('[data-erreur]').forEach((s) => { s.textContent = ''; }); }

  /** Refus du serveur : chaque erreur de champ sous son contrôle, sinon le message général. */
  refus(tr, e) {
    const details = Array.isArray(e?.details) ? e.details.filter((d) => d?.message) : [];
    if (!details.length) { this.message(e?.message ?? String(e), 'erreur'); return; }
    this.effacer(tr);
    for (const d of details) {
      const controle = CONTROLES.includes(controleDeErreurZone(d.code)) ? controleDeErreurZone(d.code) : 'colonne';
      const zone = tr.querySelector(`[data-erreur="${controle}"]`);
      if (zone) zone.textContent = messageErreur(d.code, d.message, d);
    }
  }

  async creer(tr) {
    this.effacer(tr);
    const lire = (c) => tr.querySelector(`[data-c="${c}"]`);
    const { famille, type_document: typeDocument } = ParametrageZonesEntete.lirePortee(lire('portee').valeurCombo);
    const demande = demandeCreationZone({
      colonne: lire('colonne').value, type: lire('type').valeurCombo, libelle: lire('libelle').value, groupe: lire('groupe').value, ordre: lire('ordre').value,
      obligatoire: lire('obligatoire').checked, valeurs: lire('valeurs').value, famille, typeDocument,
    });
    await this.fournisseur.creer(demande);
    this.message(texte('document.zones.creee', { libelle: demande.libelle }), 'succes');
    await this.charger();
  }

  async enregistrer(tr, zone) {
    this.effacer(tr);
    const lire = (c) => tr.querySelector(`[data-c="${c}"]`);
    const { famille, type_document: typeDocument } = ParametrageZonesEntete.lirePortee(lire('portee').valeurCombo);
    await this.fournisseur.modifier(zone.colonne, {
      libelle: lire('libelle').value.trim(), groupe: lire('groupe').value.trim() || null, ordre: Number.parseInt(lire('ordre').value, 10) || 0,
      obligatoire: lire('obligatoire').checked, valeurs: zone.type === TYPE_ZONE_ENTETE.LISTE ? lireValeursZone(lire('valeurs').value) : null,
      famille, type_document: typeDocument, actif: lire('actif').checked,
    });
    this.message(texte('document.zones.enregistree', { libelle: lire('libelle').value.trim() }), 'succes');
    await this.charger();
  }

  async supprimer(zone) {
    if (!await confirmer(texte('document.zones.confirmer_suppression', { libelle: zone.libelle, colonne: zone.colonne }))) return;
    await this.fournisseur.supprimer(zone.colonne);
    this.message(texte('document.zones.supprimee', { libelle: zone.libelle }), 'succes');
    await this.charger();
  }
}
