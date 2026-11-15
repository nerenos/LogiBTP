import { texte, texteHtml, icone, iconeHtml, textesParCode, messageErreur } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer } from '@logibtp/socle/ui';
import { api, ErreurApi } from '../api.js';
import { TYPE_CHAMP_SUPPLEMENTAIRE, proposerColonne, ecrireValeursListe, demandeCreation, lireValeursListe, controleDeErreur } from '@logibtp/fiche';

const TYPES = textesParCode('parametres_btp.champs_supplementaires.types', Object.values(TYPE_CHAMP_SUPPLEMENTAIRE));
const CONTROLES = ['colonne', 'type', 'libelle', 'valeurs'];

/**
 * Champs supplémentaires des fiches (plan versionnement-schema, lot 8) : choix de la fiche, registre de ses colonnes
 * « x_ » (libellé, ordre, valeurs, actif), création (nom technique proposé d'après le libellé, modifiable) et
 * suppression avec confirmation (les valeurs saisies sont perdues). Administrateur ; refus du serveur (422) affichés
 * sous le contrôle concerné.
 */
export class PageParametresChampsSupplementaires extends PageBase {
  icone = icone('parametres_btp_champs_supplementaires');

  async ouvrir() {
    this.titre = texte('parametres_btp.champs_supplementaires.titre');
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">${iconeHtml('parametres_btp_champs_supplementaires')} ${texteHtml('parametres_btp.champs_supplementaires.titre')}</h1></div>
      <p class="aide">${texteHtml('parametres_btp.champs_supplementaires.aide')}</p>
      <p class="ligne">${texteHtml('parametres_btp.champs_supplementaires.fiche')} <span data-fiche></span></p>
      <div data-corps></div></div>`;
    this.tables = await api.champsSupplementaires.tables();
    if (this.tables.length === 0) {
      this.conteneur.querySelector('[data-corps]').innerHTML = `<p class="aide">${texteHtml('parametres_btp.champs_supplementaires.aucune_table')}</p>`;
      return;
    }
    this.table = this.tables[0].table;
    const combo = creerCombo({
      options: this.tables.map((t) => ({ valeur: t.table, libelle: t.types.join(', '), detail: t.table })), valeur: this.table, vide: false,
    });
    combo.addEventListener('change', () => { this.table = combo.valeurCombo || this.table; this.charger().catch((e) => this.app.erreur(e)); });
    this.conteneur.querySelector('[data-fiche]').append(combo);
    await this.charger();
  }

  async charger() {
    this.champs = await api.champsSupplementaires.lister(this.table);
    this.rendre();
  }

  rendre() {
    const corps = this.conteneur.querySelector('[data-corps]');
    const t = (cle) => texteHtml(`parametres_btp.champs_supplementaires.${cle}`);
    corps.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('commun.libelle')}</th><th>${t('colonne')}</th><th>${t('type')}</th><th>${t('valeurs')}</th>
      <th>${t('ordre')}</th><th>${t('actif')}</th><th></th></tr></thead><tbody>
      ${this.champs.map((c, i) => this.ligne(c, i)).join('')}
      <tr data-nouveau class="ligne-nouveau">${this.ligneNouveau()}</tr></tbody></table>`;
    const combo = creerCombo({ options: Object.entries(TYPES).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: TYPE_CHAMP_SUPPLEMENTAIRE.TEXTE, vide: false });
    combo.dataset.c = 'type';
    const nouveau = corps.querySelector('[data-nouveau]');
    nouveau.querySelector('[data-type]').append(combo);
    const valeurs = nouveau.querySelector('[data-c="valeurs"]');
    const sync = () => { valeurs.hidden = combo.valeurCombo !== TYPE_CHAMP_SUPPLEMENTAIRE.LISTE; };
    combo.addEventListener('change', sync);
    sync();
    // Nom technique proposé d'après le libellé, tant que la saisie ne l'a pas modifié.
    const libelle = nouveau.querySelector('[data-c="libelle"]');
    const colonne = nouveau.querySelector('[data-c="colonne"]');
    let manuel = false;
    colonne.addEventListener('input', () => { manuel = true; });
    libelle.addEventListener('input', () => { if (!manuel) colonne.value = proposerColonne(libelle.value); });
    colonne.value = proposerColonne('');
    corps.querySelectorAll('tr[data-i]').forEach((tr) => {
      const c = this.champs[Number(tr.dataset.i)];
      if (c.type !== TYPE_CHAMP_SUPPLEMENTAIRE.LISTE) tr.querySelector('[data-c="valeurs"]').hidden = true;
    });
    corps.onclick = (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const tr = b.closest('tr');
      const actions = {
        creer: () => this.creer(tr, combo),
        enregistrer: () => this.enregistrer(tr, this.champs[Number(tr.dataset.i)]),
        supprimer: () => this.supprimer(this.champs[Number(tr.dataset.i)]),
      };
      Promise.resolve(actions[b.dataset.action]?.()).catch((x) => this.refus(tr, x));
    };
  }

  ligne(c, i) {
    return `<tr data-i="${i}"${c.actif ? '' : ' class="discret"'}>
      <td><input data-c="libelle" value="${echapper(c.libelle)}" size="24" maxlength="100"><span class="erreur" data-erreur="libelle"></span></td>
      <td><code>${echapper(c.colonne)}</code></td>
      <td>${echapper(TYPES[c.type] ?? c.type)}</td>
      <td><textarea data-c="valeurs" rows="3" cols="24" title="${texteHtml('parametres_btp.champs_supplementaires.valeurs_aide')}">${echapper(ecrireValeursListe(c.valeurs))}</textarea><span class="erreur" data-erreur="valeurs"></span></td>
      <td><input data-c="ordre" value="${Number(c.ordre ?? 0)}" size="4" inputmode="numeric"></td>
      <td><input type="checkbox" data-c="actif" ${c.actif ? 'checked' : ''}></td>
      <td class="cellule-boutons"><button type="button" data-action="enregistrer" title="${texteHtml('commun.enregistrer')}">${iconeHtml('enregistrer')}</button>
        <button type="button" data-action="supprimer" class="danger" title="${texteHtml('commun.supprimer')}">${iconeHtml('supprimer')}</button></td></tr>`;
  }

  ligneNouveau() {
    const ordre = this.champs.reduce((m, c) => Math.max(m, Number(c.ordre ?? 0)), 0) + 10;
    return `<td><input data-c="libelle" size="24" maxlength="100" placeholder="${texteHtml('parametres_btp.champs_supplementaires.nouveau')}"><span class="erreur" data-erreur="libelle"></span></td>
      <td><input data-c="colonne" size="24" maxlength="43"><span class="erreur" data-erreur="colonne"></span></td>
      <td><span data-type></span><span class="erreur" data-erreur="type"></span></td>
      <td><textarea data-c="valeurs" rows="3" cols="24" placeholder="${texteHtml('parametres_btp.champs_supplementaires.valeurs_aide')}"></textarea><span class="erreur" data-erreur="valeurs"></span></td>
      <td><input data-c="ordre" value="${ordre}" size="4" inputmode="numeric"></td><td></td>
      <td class="cellule-boutons"><button type="button" data-action="creer" class="principal" title="${texteHtml('parametres_btp.champs_supplementaires.creer')}">${iconeHtml('ajouter')}</button></td>`;
  }

  /** Efface les messages d'erreur de la ligne. */
  effacer(tr) { tr.querySelectorAll('[data-erreur]').forEach((s) => { s.textContent = ''; }); }

  /** Refus du serveur : chaque erreur de champ sous son contrôle, sinon la fenêtre d'erreur de l'application. */
  refus(tr, e) {
    const details = e instanceof ErreurApi && Array.isArray(e.details) ? e.details.filter((d) => d?.message) : [];
    if (!details.length) { this.app.erreur(e); return; }
    this.effacer(tr);
    for (const d of details) {
      const controle = CONTROLES.includes(controleDeErreur(d.code)) ? controleDeErreur(d.code) : 'colonne';
      const zone = tr.querySelector(`[data-erreur="${controle}"]`);
      if (zone) zone.textContent = messageErreur(d.code, d.message, d);
    }
  }

  async creer(tr, combo) {
    this.effacer(tr);
    const lire = (c) => tr.querySelector(`[data-c="${c}"]`).value;
    const demande = demandeCreation(this.table, { colonne: lire('colonne'), type: combo.valeurCombo, libelle: lire('libelle'), ordre: lire('ordre'), valeurs: lire('valeurs') });
    await api.champsSupplementaires.creer(demande);
    this.app.message(texte('parametres_btp.champs_supplementaires.cree', { libelle: demande.libelle }), 'succes');
    await this.charger();
  }

  async enregistrer(tr, champ) {
    this.effacer(tr);
    const lire = (c) => tr.querySelector(`[data-c="${c}"]`);
    await api.champsSupplementaires.modifier(champ.table, champ.colonne, {
      libelle: lire('libelle').value.trim(), ordre: Number.parseInt(lire('ordre').value, 10) || 0,
      valeurs: champ.type === TYPE_CHAMP_SUPPLEMENTAIRE.LISTE ? lireValeursListe(lire('valeurs').value) : null, actif: lire('actif').checked,
    });
    this.app.message(texte('parametres_btp.champs_supplementaires.enregistre', { libelle: lire('libelle').value.trim() }), 'succes');
    await this.charger();
  }

  async supprimer(champ) {
    if (!await confirmer(texte('parametres_btp.champs_supplementaires.confirmer_suppression', { libelle: champ.libelle, colonne: champ.colonne }))) return;
    await api.champsSupplementaires.supprimer(champ.table, champ.colonne);
    this.app.message(texte('parametres_btp.champs_supplementaires.supprime', { libelle: champ.libelle }), 'succes');
    await this.charger();
  }
}
