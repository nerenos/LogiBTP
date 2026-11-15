import { texte, texteHtml, iconeHtml, couleurTheme } from '@logibtp/socle/dictionnaire';
import { CFG_LIGNES as C, ordreAffichage, echapper, formatNombre, formatLibre, lireNombre, creerCombo, editerLibelle, htmlSur, confirmer } from '@logibtp/socle/ui';
import { TL, estChiffree, estPied, estTranche, calculerEcheances, montantRetenue, MODES_REGLEMENT, regle, estFamilleAchat } from '../src/index.js';
import { LIBELLES_BASE_PIED, LIBELLES_TYPE_PRIX } from './editeur-document.js';

const lireEtiquettes = (v) => {
  const x = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v;
  return Array.isArray(x) ? x : [];
};

// Panneaux autour de la grille : entête, détail de la ligne, totaux, messages, écarts.
// Chaque champ modifié forme une étape d'annulation ; un panneau ne se redessine pas pendant une saisie.

export const opt = (valeur, libelle, courant) => `<option value="${echapper(valeur)}" ${String(valeur) === String(courant ?? '') ? 'selected' : ''}>${echapper(libelle)}</option>`;
const STYLES_NUM = [['1', '1, 2, 3'], ['A', 'A, B, C'], ['a', 'a, b, c']];

export function lier(zone, selecteur, appliquer) {
  zone.querySelectorAll(selecteur).forEach((el) => {
    el.addEventListener('change', () => {
      const v = el.type === 'checkbox' ? el.checked : el.value;
      appliquer(el.dataset.champ, v, el);
    });
  });
}

export function valeurChamp(el, v) {
  if (el.type === 'checkbox') return v;
  if (el.dataset.nombre !== undefined) return lireNombre(v) ?? null;
  if (el.dataset.entier !== undefined) return v === '' ? null : Number(v);
  return v === '' ? null : v;
}

/** Générateurs de champs de formulaire liés à un objet (data-champ). */
export function champsFormulaire(objet) {
  return {
    sel: (champ, libelle, options, entier = false) =>
      `<label>${libelle}<select data-champ="${champ}" ${entier ? 'data-entier' : ''}>${options.map(([v, t]) => opt(v, t, objet[champ])).join('')}</select></label>`,
    txt: (champ, libelle, nombre = false) =>
      `<label>${libelle}<input data-champ="${champ}" ${nombre ? 'data-nombre' : ''} value="${echapper(nombre ? formatLibre(objet[champ]) : objet[champ] ?? '')}"></label>`,
    coche: (champ, libelle) => `<label class="coche"><input type="checkbox" data-champ="${champ}" ${objet[champ] ? 'checked' : ''}> ${libelle}</label>`,
    zone: (champ, libelle) => `<label class="large">${libelle}<textarea data-champ="${champ}" rows="3">${echapper(objet[champ] ?? '')}</textarea></label>`,
  };
}

/**
 * Panneaux du document (classe mère). Points de spécialisation : champsEntete, sectionsEntete / lierEntete,
 * champsDetail, calculDetail, aideLigneAbsente, lignesTotaux.
 */
export class PanneauxDocument {
  constructor(editeur) {
    this.editeur = editeur;
  }

  get regles() { return this.editeur.regles; }

  // ------------------------------------------------------------------ entête

  /**
   * Taux de TVA par défaut du document (nouvelles lignes de prix hors d'un titre à taux ; vide : taux par défaut du
   * paramétrage) et action qui l'impose à tous les titres et à toutes les lignes de prix.
   */
  champTauxDocument(d) {
    const ed = this.editeur;
    const taux = ed.definition.taux_tva ?? [];
    const defaut = taux.find((t) => t.ttv_defaut) ?? taux[0];
    // Toujours proposée (le panneau ne se redessine pas tant que le champ a le focus) : taux saisi, sinon celui du paramétrage.
    const appliquer = !ed.fige && !ed.estAvancement && defaut;
    return `<label title="${texteHtml('document.panneaux.tva_defaut_aide')}">${texteHtml('document.panneaux.tva_defaut')}
      <select data-champ="ent_tva_id" data-entier>${opt('', defaut ? texte('document.panneaux.tva_parametrage', { code: defaut.ttv_code }) : '—', d.ent_tva_id)}${taux.map((t) => opt(t.ttv_id, t.ttv_code, d.ent_tva_id)).join('')}</select></label>
      ${appliquer ? `<button type="button" data-action="appliquer-tva-document" title="${texteHtml('document.panneaux.tva_appliquer_aide')}">${texteHtml('document.panneaux.tva_appliquer')}</button>` : ''}`;
  }

  /** Taux effectif du document : saisi, sinon taux par défaut du paramétrage, sinon le premier. */
  tauxDocument(d) {
    const taux = this.editeur.definition.taux_tva ?? [];
    return taux.some((t) => t.ttv_id === d.ent_tva_id) ? d.ent_tva_id : (taux.find((t) => t.ttv_defaut) ?? taux[0])?.ttv_id ?? null;
  }

  /** Champs propres à la spécialisation, ajoutés après les champs génériques (data-champ sur le document). */
  champsEntete(_d) { return []; }

  /** Champ du tiers de l'entête (identifiant) ; une spécialisation peut le saisir ailleurs (annuaire du document). */
  champTiers(d) { return `<label>${texteHtml('document.panneaux.tiers')} <input data-champ="ent_tiers_id" data-entier value="${echapper(d.ent_tiers_id ?? '')}"></label>`; }

  /** Sections HTML ajoutées sous le formulaire d'entête. */
  sectionsEntete() { return ''; }

  /** Branchement des sections ajoutées. */
  lierEntete(_zone) {}

  rendreEntete(zone) {
    if (zone.contains(document.activeElement)) return;
    const editeur = this.editeur;
    const d = editeur.saisie.document;
    const def = editeur.definition;
    const props = def.proprietes.filter((p) => p.prd_niveau === 'E');
    const valeurs = d.ent_proprietes ?? {};
    const statut = def.statuts?.find((s) => s.std_id === d.ent_std_id);
    zone.innerHTML = `
      <div class="entete-titre">
        <strong>${echapper(def.type.tyd_libelle)}</strong>
        <span class="numero">${echapper(d.ent_numero ?? texte('document.panneaux.non_numerote'))}${d.ent_indice ? ` · ${texteHtml('document.panneaux.indice', { indice: d.ent_indice })}` : ''}</span>
        <span class="statut">${echapper(statut?.std_libelle ?? '')} · v${d.ent_version ?? 1}</span>
      </div>
      <div class="formulaire">
        <label class="large">${texteHtml('document.panneaux.objet')} <input data-champ="ent_objet" value="${echapper(d.ent_objet ?? '')}"></label>
        <label>${texteHtml('document.panneaux.date')} <input type="date" data-champ="ent_date" value="${echapper(d.ent_date ?? '')}"></label>
        ${this.champTiers(d)}
        <label>${texteHtml('document.panneaux.notre_reference')} <input data-champ="ent_notre_reference" maxlength="50" value="${echapper(d.ent_notre_reference ?? '')}"></label>
        <label>${texteHtml('document.panneaux.reference_externe')} <input data-champ="ent_reference_externe" maxlength="100" title="${texteHtml('document.panneaux.reference_externe_aide')}" value="${echapper(d.ent_reference_externe ?? '')}"></label>
        ${def.type?.tyd_consultation ? `<label title="${texteHtml('document.panneaux.consultation_aide')}">${texteHtml('document.panneaux.consultation')} <input data-champ="ent_consultation" maxlength="30" size="12" value="${echapper(d.ent_consultation ?? '')}"></label>` : ''}
        ${estFamilleAchat(def.type?.tyd_famille) ? `<label title="${texteHtml('document.panneaux.date_externe_aide')}">${texteHtml('document.panneaux.date_externe')} <input type="date" data-champ="ent_date_externe" value="${echapper(d.ent_date_externe ?? '')}"></label>` : ''}
        ${this.champsEntete(d).join('')}
        ${props.map((p) => {
          const v = valeurs[p.prd_code] ?? '';
          const libelle = `${echapper(p.prd_libelle)}${p.prd_obligatoire ? ' *' : ''}`;
          if (p.prd_type_donnee === 'liste') {
            const options = (p.prd_options ?? []).map((o) => (typeof o === 'string' ? { code: o, libelle: o } : o));
            return `<label>${libelle}<select data-prop="${p.prd_code}">${opt('', '—', v)}${options.map((o) => opt(o.code, o.libelle, v)).join('')}</select></label>`;
          }
          if (p.prd_type_donnee === 'booleen') return `<label>${libelle}<input type="checkbox" data-prop="${p.prd_code}" ${v ? 'checked' : ''}></label>`;
          const type = { entier: 'number', decimal: 'text', date: 'date' }[p.prd_type_donnee] ?? 'text';
          return `<label>${libelle}<input type="${type}" data-prop="${p.prd_code}" data-type="${p.prd_type_donnee}" value="${echapper(v)}"></label>`;
        }).join('')}
      </div>
      ${this.sectionsEntete()}
      ${this.sectionTextes()}`;

    const m = editeur.magasin;
    this.lierTextes(zone);
    lier(zone.querySelector('.formulaire'), '[data-champ]', (champ, v, el) => m.modifier((b) => { b.document[champ] = valeurChamp(el, v); }, texte('document.etapes.entete')));
    zone.querySelectorAll('[data-prop]').forEach((el) => el.addEventListener('change', () => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.type === 'entier') v = v === '' ? null : Number(v);
      if (el.dataset.type === 'decimal') v = v === '' ? null : Number(lireNombre(v));
      m.modifier((b) => { b.document.ent_proprietes = { ...(b.document.ent_proprietes ?? {}), [el.dataset.prop]: v === '' ? null : v }; }, texte('document.etapes.propriete'));
    }));
    this.lierEntete(zone);
  }

  // ------------------------------------------------------------------ options (D8)

  /** Champs d'options propres à la spécialisation (data-champ sur le document), après les options génériques. */
  champsOptions(_d) { return []; }

  /** Sections HTML ajoutées sous les options, et leur branchement. */
  sectionsOptions() { return ''; }

  lierOptions(_zone) {}

  /**
   * Onglet Options : réglages du document consultés rarement (modèle de saisie, validité, TVA par défaut, décimales,
   * numérotation, options de la spécialisation, étiquettes du document) ; l'entête garde l'identité, les rattachements
   * et, en bas juste avant les totaux, les textes de l'édition.
   */
  rendreOptions(zone) {
    if (!zone || zone.contains(document.activeElement)) return;
    const editeur = this.editeur;
    const d = editeur.saisie.document;
    const def = editeur.definition;
    const fmt = typeof d.ent_num_format === 'string' ? JSON.parse(d.ent_num_format) : d.ent_num_format ?? { separateur: '.', niveaux: [{ style: '1' }] };
    const niveaux = [0, 1, 2].map((i) => fmt.niveaux?.[i]?.style ?? '');
    zone.innerHTML = `
      <fieldset class="options-document"><legend>${texteHtml('document.panneaux.options')}</legend>
      <div class="formulaire">
        ${def.modeles?.length ? `<label title="${texteHtml('document.panneaux.modele_aide')}">${texteHtml('document.panneaux.modele')} <select data-champ="ent_modele">${opt('', '—', d.ent_modele)}${def.modeles.map((x) => opt(x.code, x.libelle, d.ent_modele)).join('')}</select></label>` : ''}
        <label title="${texteHtml('document.panneaux.validite_aide')}">${texteHtml('document.panneaux.validite')}
          <input data-champ="ent_validite_jours" data-entier type="number" min="1" max="3650" value="${d.ent_validite_jours ?? ''}"></label>
        ${d.ent_date_validite ? `<label>${texteHtml('document.panneaux.valable_jusqu')} <input type="date" value="${echapper(d.ent_date_validite)}" disabled></label>` : ''}
        ${this.champTauxDocument(d)}
        <label>${texteHtml('document.panneaux.decimales_montants')} <input data-champ="ent_precision_montant" data-entier type="number" min="0" max="6" value="${d.ent_precision_montant ?? 2}"></label>
        <fieldset class="numerotation"><legend>${texteHtml('document.panneaux.numerotation')}</legend>
          ${niveaux.map((s, i) => `<select data-niveau="${i}">${i > 0 ? opt('', '—', s) : ''}${STYLES_NUM.map(([v, l]) => opt(v, l, s)).join('')}</select>`).join('')}
          <input data-separateur maxlength="2" value="${echapper(fmt.separateur ?? '.')}" title="${texteHtml('document.panneaux.separateur')}">
        </fieldset>
        ${this.champsOptions(d).join('')}
      </div></fieldset>
      ${this.sectionEtiquettes(d)}
      ${this.sectionsOptions()}`;
    const m = editeur.magasin;
    this.lierEtiquettes(zone);
    lier(zone.querySelector('.formulaire'), '[data-champ]', (champ, v, el) => m.modifier((b) => { b.document[champ] = valeurChamp(el, v); }, texte('document.etapes.entete')));
    const majFormat = () => {
      const styles = [...zone.querySelectorAll('[data-niveau]')].map((x) => x.value).filter(Boolean);
      const separateur = zone.querySelector('[data-separateur]').value || '.';
      m.modifier((b) => { b.document.ent_num_format = { separateur, niveaux: styles.map((style) => ({ style })) }; }, texte('document.etapes.numerotation'));
    };
    zone.querySelectorAll('[data-niveau], [data-separateur]').forEach((el) => el.addEventListener('change', majFormat));
    zone.querySelector('[data-action="appliquer-tva-document"]')?.addEventListener('click', async (e) => {
      e.currentTarget.blur();
      const id = this.tauxDocument(editeur.saisie.document);
      if (!id) return;
      const ok = await confirmer(texte('document.panneaux.tva_confirmer', { taux: editeur.libelleTaux(id) }),
        { titre: texte('document.etapes.tva_document'), ok: texte('document.panneaux.appliquer') });
      if (ok) m.modifier((b) => this.regles.appliquerTauxDocument(b, id), texte('document.etapes.tva_document'));
    });
    this.lierOptions(zone);
  }

  // ------------------------------------------------------------------ textes de l'édition

  /**
   * Textes d'introduction (avant les lignes) et de conclusion (après le pied et les récapitulatifs) : HTML à variables,
   * repris du modèle du type à la création ; aperçu du texte calculé (figé à la validation).
   */
  sectionTextes() {
    const ed = this.editeur;
    const d = ed.saisie.document;
    const calcule = ed.resultat?.document ?? {};
    const bloc = (cle, titre, aide) => {
      const html = d[`ent_texte_${cle}_html`];
      const apercu = calcule[`ent_texte_${cle}`] ?? html;
      return `<div class="texte-document" data-texte="${cle}">
        <div class="texte-document-titre"><strong>${titre}</strong> <span class="aide">${aide}</span>
          <button type="button" data-texte-editer="${cle}">${ed.fige ? texteHtml('document.panneaux.consulter') : `${iconeHtml('document_modifier')} ${texteHtml('commun.modifier')}`}</button>
          ${!ed.fige && ed.definition.type?.[`tyd_texte_${cle}_html`] ? `<button type="button" data-texte-modele="${cle}" title="${texteHtml('document.panneaux.texte_modele_aide')}">${iconeHtml('document_modele')} ${texteHtml('document.panneaux.modele')}</button>` : ''}
          ${!ed.fige && this.peutChoisirTexte() ? `<button type="button" data-texte-choisir="${cle}" title="${texteHtml('document.panneaux.texte_choisir_aide')}">${iconeHtml('document_textes')} ${texteHtml('document.panneaux.texte')}</button>` : ''}</div>
        <div class="texte-document-apercu">${apercu ? htmlSur(apercu) : `<span class="aide">${texteHtml('document.panneaux.aucun_texte')}</span>`}</div></div>`;
    };
    return `<fieldset class="textes-document"><legend>${texteHtml('document.panneaux.textes')}</legend>
      ${bloc('intro', texteHtml('document.panneaux.introduction'), texteHtml('document.panneaux.introduction_aide'))}
      ${bloc('fin', texteHtml('document.panneaux.conclusion'), texteHtml('document.panneaux.conclusion_aide'))}</fieldset>`;
  }

  /** Point d'accroche : textes réutilisables proposés dans les textes de l'édition (aucun par défaut). */
  peutChoisirTexte() { return false; }

  /** Point d'accroche : HTML du texte choisi (null : abandon). */
  async choisirTexte() { return null; }

  lierTextes(zone) {
    const ed = this.editeur;
    const titres = { intro: texte('document.panneaux.texte_intro'), fin: texte('document.panneaux.texte_fin') };
    zone.querySelectorAll('[data-texte-editer]').forEach((b) => b.addEventListener('click', async () => {
      const cle = b.dataset.texteEditer;
      const champ = `ent_texte_${cle}_html`;
      if (ed.fige) {
        await editerLibelle({ html: ed.resultat?.document?.[`ent_texte_${cle}`] ?? ed.saisie.document[champ] ?? '', titre: texte('document.panneaux.lecture_seule', { titre: titres[cle] }), lecture: true });
        return;
      }
      const v = await editerLibelle({ html: ed.saisie.document[champ] ?? '', titre: titres[cle], variables: ed.variablesTexte() });
      // Le panneau ne se redessine pas tant qu'il a le focus (saisie) : le bouton le rend avant la modification.
      b.blur();
      if (v !== undefined) ed.magasin.modifier((d) => { d.document[champ] = v || null; }, titres[cle]);
    }));
    zone.querySelectorAll('[data-texte-choisir]').forEach((b) => b.addEventListener('click', async () => {
      const cle = b.dataset.texteChoisir;
      b.blur();
      const html = await this.choisirTexte();
      if (!html) return;
      const champ = `ent_texte_${cle}_html`;
      ed.magasin.modifier((d) => { d.document[champ] = d.document[champ] ? `${d.document[champ]}${html}` : html; }, titres[cle]);
    }));
    zone.querySelectorAll('[data-texte-modele]').forEach((b) => b.addEventListener('click', () => {
      const cle = b.dataset.texteModele;
      b.blur();
      ed.magasin.modifier((d) => { d.document[`ent_texte_${cle}_html`] = ed.definition.type[`tyd_texte_${cle}_html`]; }, texte('document.etapes.texte_modele'));
    }));
  }

  // ------------------------------------------------------------------ règlement et échéancier

  /**
   * Section Règlement : condition de paiement, mode de règlement et, avec `apercu`, l'échéancier (aperçu ou enregistré).
   * Rendue par l'hôte où il la veut (onglet Règlements de la page document : `rendreReglement`), plus dans l'entête.
   */
  sectionReglement({ apercu = true } = {}) {
    if (!this.editeur.definition.conditions_paiement?.length) return '';
    return `<fieldset class="reglement-document"><legend>${texteHtml('document.panneaux.reglement')}</legend>
      <div class="formulaire">
        <label title="${texteHtml('document.panneaux.condition_aide')}">${texteHtml('document.panneaux.condition')} <span data-condition-paiement></span></label>
        <label title="${texteHtml('document.panneaux.mode_aide')}">${texteHtml('document.panneaux.mode')} <span data-mode-reglement></span></label>
      </div>
      ${apercu ? '<div data-echeancier></div>' : ''}</fieldset>`;
  }

  /** Section Règlement rendue et branchée dans une zone (onglet Règlements). */
  rendreReglement(zone, options = {}) {
    if (!zone) return;
    zone.innerHTML = this.sectionReglement(options);
    zone.hidden = !zone.innerHTML;
    this.lierReglement(zone);
  }

  /**
   * Condition et mode effectifs : ceux du document, sinon du tiers (reglement_tiers, chargé avec le document), sinon
   * la condition par défaut du type (ventes ou achats). { condition, origine, mode }.
   */
  reglementEffectif() {
    const s = this.editeur.saisie;
    const d = s.document;
    const conditions = this.editeur.definition.conditions_paiement ?? [];
    const tiers = s.reglement_tiers ?? null;
    const connue = (c) => conditions.find((x) => x.code === c);
    let condition = connue(d.ent_cpa_code);
    let origine = 'document';
    if (!condition && tiers?.condition && connue(tiers.condition)) { condition = connue(tiers.condition); origine = 'tiers'; }
    if (!condition) { condition = connue(this.editeur.definition.condition_defaut); origine = 'defaut'; }
    return { condition: condition ?? null, origine, mode: d.ent_mode_reglement ?? tiers?.mode ?? null };
  }

  lierReglement(zone) {
    const place = zone.querySelector('[data-condition-paiement]');
    if (!place) return;
    const m = this.editeur.magasin;
    const d = this.editeur.saisie.document;
    const combo = (options, valeur, champ, titre) => {
      const c = creerCombo({ options, valeur: valeur ?? '' });
      c.readOnly = !!m.lectureSeule;
      c.title = titre;
      c.addEventListener('change', () => {
        m.modifier((b) => { b.document[champ] = c.valeurCombo || null; }, texte('document.etapes.reglement'));
        this.rendreEcheancier(zone.querySelector('[data-echeancier]'));
      });
      return c;
    };
    place.replaceWith(combo(this.editeur.definition.conditions_paiement.map((x) => ({ valeur: x.code, libelle: x.libelle, detail: x.code })),
      d.ent_cpa_code, 'ent_cpa_code', place.parentElement.title));
    const mode = zone.querySelector('[data-mode-reglement]');
    mode.replaceWith(combo(this.modesReglement().map(([valeur, libelle]) => ({ valeur, libelle })), d.ent_mode_reglement, 'ent_mode_reglement', mode.parentElement.title));
    this.rendreEcheancier(zone.querySelector('[data-echeancier]'));
  }

  /**
   * Échéancier : enregistré à la validation d'une pièce (factures, avoirs), sinon aperçu calculé sur le net à payer
   * (calculerEcheances, règle répliquée dans Echeances.cs) ; retenue de garantie (postes lig_pied_retenue) à part.
   */
  /** Modes de règlement [code, libellé] : ceux de la définition (table mode_reglement), sinon la liste du module. */
  modesReglement() {
    const m = this.editeur.definition.modes_reglement;
    return m?.length ? m.map((x) => [x.code, x.libelle]) : MODES_REGLEMENT;
  }

  rendreEcheancier(div) {
    if (!div) return;
    const s = this.editeur.saisie;
    const r = this.editeur.resultat;
    const { condition, origine, mode } = this.reglementEffectif();
    const libelleMode = (v) => this.modesReglement().find(([c]) => c === v)?.[1] ?? v ?? '';
    let lignes;
    let titre;
    if (s.echeances?.length) {
      lignes = s.echeances.map((e) => ({ rang: e.ech_rang, date: e.ech_date, montant: e.ech_montant, mode: e.ech_mode, nature: e.ech_nature, manuel: e.ech_manuel }));
      titre = s.document.ent_cpa_code ? texteHtml('document.panneaux.echeancier_condition', { condition: condition?.libelle ?? s.document.ent_cpa_code }) : texteHtml('document.panneaux.echeancier');
    } else {
      if (!r?.document || !s.document.ent_date) { div.innerHTML = ''; return; }
      lignes = calculerEcheances({
        date: s.document.ent_date, montant: r.document.ent_net_a_payer ?? 0, lignes: condition?.lignes ?? [],
        retenue: montantRetenue(r.lignes), mode, precision: s.document.ent_precision_montant ?? 2,
      });
      titre = condition ? texteHtml('document.panneaux.apercu_condition', { condition: condition.libelle, origine: texte(`document.panneaux.origines.${origine}`) }) : texteHtml('document.panneaux.apercu_comptant');
    }
    div.innerHTML = `<p class="aide">${titre}</p>
      <table class="echeancier"><thead><tr><th>${texteHtml('document.panneaux.numero')}</th><th>${texteHtml('document.panneaux.echeance')}</th><th class="nombre">${texteHtml('document.panneaux.montant')}</th><th>${texteHtml('document.panneaux.mode_court')}</th></tr></thead>
      <tbody>${lignes.map((e) => `<tr${e.nature === 'RETENUE' ? ' class="retenue"' : ''}><td>${e.rang}</td>
        <td>${e.nature === 'RETENUE' ? (e.date ? texteHtml('document.panneaux.retenue_liberee', { date: e.date }) : texteHtml('document.panneaux.retenue')) : echapper(e.date ?? '')}${e.manuel ? ` ${iconeHtml('document_modifier')}` : ''}</td>
        <td class="nombre">${formatNombre(e.montant, s.document.ent_precision_montant ?? 2)}</td><td>${echapper(libelleMode(e.mode))}</td></tr>`).join('')}</tbody></table>`;
  }

  /**
   * Étiquettes propres au document (ent_etiquettes) : une étiquette de même code qu'une étiquette globale la
   * personnalise (libellé, couleur) dans ce document seulement.
   */
  sectionEtiquettes(d) {
    const propres = lireEtiquettes(d.ent_etiquettes);
    const globales = (this.editeur.definition.etiquettes ?? []).filter((e) => e.actif !== false);
    return `<fieldset class="etiquettes-document"><legend>${texteHtml('document.parametrage.etiquettes')}</legend>
      <p class="aide">${texteHtml('document.panneaux.etiquettes_globales')} ${globales.map((e) => `<span class="pastille-couleur" style="background:${echapper(e.couleur)}"></span> ${echapper(e.libelle)}`).join(' · ') || texteHtml('document.panneaux.aucune')}</p>
      <table class="etiquettes"><tbody>
        ${propres.map((e, i) => `<tr data-i="${i}">
          <td><input data-etq="code" value="${echapper(e.code)}" size="10" title="${texteHtml('document.panneaux.etiquette_code_aide')}"></td>
          <td><input data-etq="libelle" value="${echapper(e.libelle ?? '')}"></td>
          <td><input data-etq="couleur" type="color" value="${echapper(e.couleur ?? couleurTheme('--document-etiquette-vide', '#999999'))}"></td>
          <td><button type="button" data-etq-suppr title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}
      </tbody></table>
      <button type="button" data-etq-ajout>${texteHtml('document.panneaux.etiquette_ajouter')}</button>
    </fieldset>`;
  }

  lierEtiquettes(zone) {
    const m = this.editeur.magasin;
    const ecrire = (modif, libelle) => m.modifier((b) => {
      const liste = lireEtiquettes(b.document.ent_etiquettes).map((e) => ({ ...e }));
      modif(liste);
      b.document.ent_etiquettes = liste;
    }, libelle);
    zone.querySelectorAll('[data-etq]').forEach((el) => el.addEventListener('change', () => {
      const i = Number(el.closest('tr').dataset.i);
      const champ = el.dataset.etq;
      const v = champ === 'code' ? el.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') : el.value;
      ecrire((l) => { l[i][champ] = v; }, texte('document.etapes.etiquettes'));
    }));
    zone.querySelectorAll('[data-etq-suppr]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.closest('tr').dataset.i);
      ecrire((l) => l.splice(i, 1), texte('document.etapes.etiquettes'));
    }));
    zone.querySelector('[data-etq-ajout]')?.addEventListener('click', () => {
      ecrire((l) => {
        let n = l.length + 1;
        while (l.some((e) => e.code === `DOC_${n}`)) n += 1;
        l.push({ code: `DOC_${n}`, libelle: texte('document.parametrage.etiquette_n', { n }), couleur: couleurTheme('--document-etiquette-defaut', '#64748b') });
      }, texte('document.etapes.etiquettes'));
    });
  }

  // ------------------------------------------------------------------ détail de la ligne

  /** Message affiché quand la ligne sélectionnée n'est pas saisie (ligne calculée…). */
  aideLigneAbsente(_calculee) { return `<p class="aide">${texteHtml('document.panneaux.selectionner')}</p>`; }

  /**
   * Champs du détail de la ligne `l` (saisie). `f` fournit sel, txt et coche. Une spécialisation
   * complète ou remplace la liste renvoyée par super.champsDetail.
   */
  champsDetail(l, f) {
    const lignes = this.editeur.saisie.lignes;
    const taux = this.editeur.definition.taux_tva;
    const champs = [];
    if (l.lig_tyl_id === TL.TITRE) {
      champs.push(f.sel('lig_tva_id', texteHtml('document.panneaux.tva_tranche'), [['', '—'], ...taux.map((t) => [t.ttv_id, t.ttv_libelle])], true));
      champs.push(`<button data-action="appliquer-tva" title="${texteHtml('document.panneaux.tva_reappliquer_aide')}">${texteHtml('document.panneaux.tva_reappliquer')}</button>`);
      champs.push(f.txt('lig_num_depart', texteHtml('document.panneaux.num_depart')));
    }
    // Type de prix d'une tranche : appliqué à toute sa descendance (hérité). Frais annexes : titres seulement.
    if (estTranche(l)) {
      // Frais annexes (F) : sur un titre, si la règle FRAIS_ANNEXES le permet (ventes).
      const fraisPermis = regle(this.editeur.definition, 'FRAIS_ANNEXES', true);
      const types = Object.entries(LIBELLES_TYPE_PRIX).filter(([t]) => t !== 'F' || (l.lig_tyl_id === TL.TITRE && fraisPermis) || l.lig_type_prix === 'F');
      champs.push(f.sel('lig_type_prix', texteHtml('document.panneaux.type_prix_tranche'), types));
    }
    if (estChiffree(l)) {
      if (this.regles.ouvrageAncetre(lignes, l.lig_id)) champs.push(f.sel('lig_qte_type', texteHtml('document.panneaux.quantite'), [['R', texte('document.panneaux.qte_relative')], ['A', texte('document.panneaux.qte_absolue')]]));
      champs.push(f.sel('lig_precision_qte', texteHtml('document.panneaux.decimales_qte'), [0, 1, 2, 3, 4, 5, 6].map((n) => [n, n]), true));
      champs.push(f.sel('lig_precision_pv', texteHtml('document.panneaux.decimales_pv'), [0, 1, 2, 3, 4, 5, 6].map((n) => [n, n]), true));
      // Frais annexes : choisis sur un titre (la ligne l'hérite) ; une ligne seule ne peut pas en être.
      champs.push(f.sel('lig_type_prix', texteHtml('document.panneaux.type_prix'), Object.entries(LIBELLES_TYPE_PRIX).filter(([t]) => t !== 'F' || l.lig_type_prix === 'F')));
      champs.push(f.txt('lig_code', texteHtml('document.panneaux.code_article')));
      champs.push(f.txt('lig_art_id', texteHtml('document.panneaux.id_article')));
      champs.push(f.txt('lig_num_depart', texteHtml('document.panneaux.num_depart')));
    }
    if (l.lig_tyl_id === TL.SOUS_TOTAL) {
      const precedents = ordreAffichage(C, lignes).map((r) => r.item).filter((x) => x.lig_tyl_id === TL.SOUS_TOTAL && x.lig_id !== l.lig_id);
      champs.push(f.sel('lig_st_depuis_id', texteHtml('document.panneaux.st_depuis'), [['', texte('document.panneaux.st_debut')], ...precedents.map((x) => [x.lig_id, texte('document.panneaux.st_libelle', { libelle: x.lig_libelle_html ?? x.lig_id })])], true));
    }
    if (l.lig_tyl_id === TL.PIED_HT || l.lig_tyl_id === TL.PIED_TTC) {
      champs.push(f.sel('lig_pied_mode', texteHtml('document.panneaux.mode_court'), [['P', texte('document.panneaux.pourcentage')], ['C', texte('document.panneaux.coefficient')], ['M', texte('document.panneaux.montant')]]));
      if ((l.lig_pied_mode ?? 'M') !== 'M') {
        champs.push(f.sel('lig_pied_base', texteHtml('document.panneaux.base'), Object.entries(LIBELLES_BASE_PIED)));
        if (l.lig_pied_base === 'LIGNE') {
          const st = this.sousTotauxPiedAvant(l.lig_id);
          champs.push(f.sel('lig_pied_base_id', texteHtml('document.panneaux.st_base'), [['', '—'], ...st.map((x) => [x.lig_id, texte('document.panneaux.st_montant', { libelle: x.lig_libelle_brut || texte('document.panneaux.sous_total'), montant: formatNombre(x.lig_montant_ht, 2) })])], true));
        }
      }
      champs.push(f.sel('lig_pied_sens', texteHtml('document.panneaux.sens'), [[1, texte('document.panneaux.ajout')], [-1, texte('document.panneaux.deduction')]], true));
      champs.push(f.txt('lig_pied_valeur', texteHtml('document.panneaux.valeur'), true));
      champs.push(f.sel('lig_type_prix', texteHtml('document.panneaux.traitement'), [['V', texte('document.panneaux.dans_net')], ['M', texte('document.panneaux.pour_memoire')]]));
      if (l.lig_tyl_id === TL.PIED_TTC) champs.push(f.coche('lig_pied_retenue', texteHtml('document.panneaux.retenue_aide')));
    }
    if (!estPied(l)) {
      champs.push(l.lig_type_prix === 'F'
        ? `<label class="coche" title="${texteHtml('document.panneaux.frais_non_imprime_aide')}"><input type="checkbox" checked disabled> ${texteHtml('document.panneaux.non_imprimer_frais')}</label>`
        : f.coche('lig_is_non_editee', texteHtml('document.panneaux.non_imprimer')));
    }
    const etiquettes = this.editeur.etiquettes();
    if (etiquettes.length) champs.push(f.sel('lig_etiquette', texteHtml('document.panneaux.etiquette'), [['', '—'], ...etiquettes.map((e) => [e.code, e.libelle])]));
    const parent = l.lig_proprietes?.commentaire_parent;
    if (parent) champs.push(`<label class="large">${texteHtml('document.panneaux.commentaire_parent')}<textarea rows="2" disabled>${echapper(parent)}</textarea></label>`);
    champs.push(f.zone('lig_commentaire', texteHtml(parent ? 'document.panneaux.commentaire_document' : 'document.panneaux.commentaire')));
    return champs;
  }

  /** Sous-totaux de pied placés avant la ligne de pied `ligId` (bases possibles d'un pourcentage ou coefficient). */
  sousTotauxPiedAvant(ligId) {
    const r = this.editeur.resultat;
    // Ligne d'un pied de section : sous-totaux de ce pied ; sinon ceux du pied du document.
    const contient = (structure) => structure.some((e) => e.lig_id === ligId || (e.genre !== 'consolide' && e.lignes?.includes(ligId)));
    const pied = (r.pieds_sections ?? []).find((s) => contient(s.pied))?.pied ?? r.pied ?? [];
    const i = pied.findIndex((e) => e.lig_id === ligId || e.lignes?.includes(ligId));
    const ids = pied.slice(0, i < 0 ? pied.length : i).filter((e) => e.genre === 'ligne').map((e) => e.lig_id);
    return ids.map((id) => r.lignes.find((x) => x.lig_id === id)).filter(Boolean);
  }

  /** Valeurs calculées affichées sous le formulaire : [libellé, valeur formatée]. */
  calculDetail(c) {
    if (estChiffree(c)) {
      return [[texte('document.panneaux.qte_vendue'), formatLibre(c.lig_qte_vendue)], [texte('document.panneaux.qte_totale'), formatLibre(c.lig_qte_totale)],
        [texte('document.panneaux.pv_net'), formatNombre(c.lig_pv_remise, c.lig_precision_pv ?? 2)], [texte('document.panneaux.montant_ht'), formatNombre(c.lig_montant_ht, 2)]];
    }
    if (estPied(c) && c.lig_base_calcul !== undefined && c.lig_base_calcul !== null) {
      return [[texte('document.panneaux.base'), `${formatNombre(c.lig_base_calcul, 2)} <small>(${echapper(this.editeur.libelleBasePied(c))})</small>`]];
    }
    return [];
  }

  rendreDetail(zone, ligId) {
    if (zone.contains(document.activeElement)) return;
    const editeur = this.editeur;
    const l = editeur.saisie.lignes.find((x) => x.lig_id === ligId);
    const c = editeur.resultat.lignes.find((x) => x.lig_id === ligId);
    if (!l || !c) {
      zone.innerHTML = this.aideLigneAbsente(c);
      return;
    }
    const champs = this.champsDetail(l, champsFormulaire(l));
    const props = editeur.definition.proprietes.filter((p) => p.prd_niveau === 'L');
    const valeurs = l.lig_proprietes ?? {};
    const calcul = this.calculDetail(c);

    zone.innerHTML = `
      <h3>${echapper(c.lig_numerotation ?? '')} ${echapper(c.lig_libelle_brut ?? '')}</h3>
      <div class="formulaire">${champs.join('')}
        ${props.map((p) => `<label>${echapper(p.prd_libelle)}<input data-prop="${p.prd_code}" value="${echapper(valeurs[p.prd_code] ?? '')}"></label>`).join('')}
      </div>
      ${calcul.length ? `<dl class="calcul">${calcul.map(([t, v]) => `<dt>${echapper(t)}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}`;

    const m = editeur.magasin;
    // Ligne reprise du parent d'un document d'avancement : informations du parent en lecture seule.
    zone.querySelectorAll('[data-champ]').forEach((el) => { if (editeur.fige || editeur.champVerrouille?.(l, el.dataset.champ)) el.disabled = true; });
    lier(zone, '[data-champ]', (champ, v, el) => {
      // Champs qui changent le formulaire (base proposée selon le mode…) : le panneau se redessine.
      if (['lig_pied_mode', 'lig_pied_base'].includes(champ)) el.blur();
      editeur.modifierLigne(ligId, champ, champ === 'lig_art_id' ? (v === '' ? null : Number(v)) : valeurChamp(el, v));
    });
    zone.querySelectorAll('[data-prop]').forEach((el) => el.addEventListener('change', () => {
      m.modifier((b) => {
        const x = b.lignes.find((y) => y.lig_id === ligId);
        x.lig_proprietes = { ...(x.lig_proprietes ?? {}), [el.dataset.prop]: el.value || null };
      }, texte('document.etapes.propriete'));
    }));
    zone.querySelector('[data-action="appliquer-tva"]')?.addEventListener('click', () => {
      m.modifier((b) => this.regles.appliquerTauxTitre(b, ligId), texte('document.etapes.tva_titre'));
    });
  }

  // ------------------------------------------------------------------ totaux, messages, écarts

  /** Lignes ajoutées aux totaux : [libellé, valeur formatée], affichées sous le net à payer. */
  lignesTotaux(_document) { return []; }

  rendreTotaux(zone, { compact = false } = {}) {
    const editeur = this.editeur;
    const r = editeur.resultat;
    const d = r.document;
    const pm = editeur.saisie.document.ent_precision_montant ?? 2;
    // Situation (présentation C) : précédent et montant de la période en information, le total restant le cumul.
    const situation = r.situation
      ? [[texte('document.panneaux.situation_precedent'), formatNombre(r.situation.precedent, pm)], [texte('document.panneaux.situation_periode'), formatNombre(r.situation.periode, pm)]]
      : [];
    const extra = [...this.lignesTotaux(d), ...situation];
    if (compact) {
      const detailTva = r.tva.map((t) => texte('document.panneaux.tva_detail', { code: t.tva_code, montant: formatNombre(t.tva_montant_net, pm), base: formatNombre(t.tva_base_ht, pm) })).join(' · ');
      // Erreur de calcul : totaux signalés en attention (D5).
      const ecart = (r.erreurs ?? []).length > 0;
      zone.classList.toggle('attention', ecart);
      zone.title = ecart ? texte('document.panneaux.totaux_erreur') : '';
      zone.innerHTML = `
        <span><small>${texteHtml('document.panneaux.total_ht')}</small> ${formatNombre(d.ent_total_ht, pm)}</span>
        <span title="${echapper(detailTva)}"><small>${texteHtml('document.panneaux.tva')}</small> ${formatNombre(d.ent_total_tva, pm)}</span>
        <span><small>${texteHtml('document.panneaux.ttc')}</small> ${formatNombre(d.ent_total_ttc, pm)}</span>
        <span class="net"><small>${texteHtml('document.panneaux.net')}</small> ${formatNombre(d.ent_net_a_payer, pm)}</span>
        ${extra.map(([t, v]) => `<span><small>${echapper(t)}</small> ${v}</span>`).join('')}`;
      return;
    }
    zone.innerHTML = `<h3>${texteHtml('document.panneaux.totaux')}</h3>
      <table class="totaux">
        <tr><th>${texteHtml('document.panneaux.total_ht')}</th><td>${formatNombre(d.ent_total_ht, pm)}</td></tr>
        ${r.tva.map((t) => `
          <tr class="tva"><th>${texteHtml('document.panneaux.tva_base', { code: t.tva_code, base: formatNombre(t.tva_base_ht, pm) })}</th><td>${formatNombre(t.tva_montant, pm)}</td></tr>
          ${Number(t.tva_montant_annulation) !== 0 ? `<tr class="tva annulation"><th>${texteHtml('document.panneaux.tva_annulation', { code: t.tva_code })}</th><td>${formatNombre(t.tva_montant_annulation, pm)}</td></tr>` : ''}
          ${t.tva_mention ? `<tr class="mention"><td colspan="2">${echapper(t.tva_mention)}</td></tr>` : ''}`).join('')}
        <tr><th>${texteHtml('document.panneaux.total_tva')}</th><td>${formatNombre(d.ent_total_tva, pm)}</td></tr>
        <tr><th>${texteHtml('document.panneaux.total_ttc')}</th><td>${formatNombre(d.ent_total_ttc, pm)}</td></tr>
        <tr class="net"><th>${texteHtml('document.panneaux.net')}</th><td>${formatNombre(d.ent_net_a_payer, pm)}</td></tr>
        ${extra.map(([t, v]) => `<tr class="mention"><th>${echapper(t)}</th><td>${v}</td></tr>`).join('')}
      </table>`;
  }

  /** Contrôles de la spécialisation affichés avec ceux du calcul : [{ lig_id, code, message, niveau }]. */
  controlesSupplementaires() { return []; }

  /**
   * Contrôles du document ; messages : ceux à afficher à la place ([{ lig_id, code, message, gravite }], ex. les
   * notifications de la ligne courante quand le panneau des notifications regroupe tout le document).
   */
  rendreMessages(zone, selectionner, messages = null) {
    const r = this.editeur.resultat;
    const items = messages?.map((e) => ({ ...e, niveau: e.gravite ?? 'avertissement' }))
      ?? [...r.erreurs.map((e) => ({ ...e, niveau: 'erreur' })), ...this.controlesSupplementaires(),
        ...r.avertissements.map((e) => ({ ...e, niveau: 'avertissement' }))];
    zone.hidden = items.length === 0;
    zone.innerHTML = `<h3>${texteHtml(messages ? 'document.panneaux.notifications_ligne' : 'document.panneaux.controles', { nombre: items.length })}</h3><ul>${items.map((e) =>
      `<li class="${e.niveau}" data-lig="${e.lig_id ?? ''}"><code>${echapper(e.code)}</code> ${echapper(e.message)}</li>`).join('')}</ul>`;
    zone.querySelectorAll('li[data-lig]').forEach((li) => li.addEventListener('click', () => {
      if (li.dataset.lig) selectionner(Number(li.dataset.lig));
    }));
  }

  /** Arbitrage des écarts client / serveur, ligne par ligne : S serveur validé, A anomalie. */
  rendreEcarts(zone, ecarts, arbitrer) {
    zone.hidden = !ecarts?.length;
    if (!ecarts?.length) return;
    zone.innerHTML = `
      <h3>${texteHtml('document.panneaux.ecarts', { nombre: ecarts.length })}</h3>
      <table><thead><tr><th>${texteHtml('document.panneaux.ligne')}</th><th>${texteHtml('document.panneaux.champ')}</th><th>${texteHtml('document.panneaux.client')}</th><th>${texteHtml('document.panneaux.serveur')}</th></tr></thead>
      <tbody>${ecarts.map((e) => `<tr><td>${e.lig_id ?? texteHtml('document.panneaux.document')}</td><td><code>${echapper(e.champ)}</code></td>
        <td>${echapper(e.valeur_client ?? '∅')}</td><td>${echapper(e.valeur_serveur ?? '∅')}</td></tr>`).join('')}</tbody></table>
      <label>${texteHtml('document.panneaux.commentaire_court')} <input data-commentaire></label>
      <div class="boutons">
        <button data-decision="S" title="${texteHtml('document.panneaux.serveur_valide_aide')}">${texteHtml('document.panneaux.serveur_valide')}</button>
        <button data-decision="A" title="${texteHtml('document.panneaux.anomalie_aide')}">${texteHtml('document.panneaux.anomalie')}</button>
      </div>`;
    zone.querySelectorAll('[data-decision]').forEach((b) => b.addEventListener('click', () => {
      arbitrer(b.dataset.decision, zone.querySelector('[data-commentaire]').value);
    }));
  }
}
