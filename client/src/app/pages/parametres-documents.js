import { MODULE_FACULTATIF } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { ParametrageAffichageDocument, variablesTexteDocument } from '@logibtp/document/ui';
import { echapper, lireNombre, formatLibre, creerCombo, editerLibelle, htmlSur } from '@logibtp/socle/ui';
import { FAMILLES_REGLE } from '@logibtp/document';
import { api } from '../api.js';

/**
 * Échéances d'une condition de paiement en texte : « 30% 0j; 70% 30j FM » (FM : fin de mois, « le 10 » : jour fixe,
 * code de mode de règlement facultatif en fin d'échéance, ex. « 100% 45j FM LCR »).
 */
export function formaterEcheances(lignes) {
  return (lignes ?? []).map((l) => `${formatLibre(l.pct)}% ${l.delai}j${l.base === 'FIN_MOIS' ? ' FM' : l.base === 'JOUR' ? ` le ${l.jour}` : ''}${l.mode ? ` ${l.mode}` : ''}`).join('; ');
}

/** Lecture du texte des échéances ; null si une échéance est mal écrite. */
export function lireEcheances(texte) {
  const res = [];
  for (const partie of String(texte ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([\d.,]+)\s*%\s*(\d+)\s*j(?:\s+(FM|le\s+(\d+)))?(?:\s+([A-Za-z]+))?$/i.exec(partie);
    if (!m) return null;
    const ligne = { pct: lireNombre(m[1]), delai: Number(m[2]), base: m[3] ? (m[4] ? 'JOUR' : 'FIN_MOIS') : 'NET' };
    if (m[4]) ligne.jour = Number(m[4]);
    if (m[5]) ligne.mode = m[5].toUpperCase();
    res.push(ligne);
  }
  return res;
}

/** Paramétrage des documents : étiquettes de lignes, couleurs des modes de vente, seuils de solde, conditions de paiement. */
export class PageParametresDocuments extends PageBase {
  icone = '🏷';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Paramétrage des documents';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">🏷 Étiquettes et couleurs des lignes</h1><div class="corps"></div>
      <h2>Solde des lignes</h2><div class="seuils-solde"></div>
      <h2>Conditions de paiement</h2><div class="conditions-paiement"></div>
      <h2>Acomptes</h2><div class="mode-acomptes"></div>
      <h2>Textes de l'édition</h2><div class="textes-types"></div>
      <h2>Règles des documents</h2><div class="regles-documents"></div>
      ${app.moduleActif(MODULE_FACULTATIF.EXECUTION) ? "<h2>Types d'ordres (Exécution)</h2><div class='types-ordres'></div>" : ''}</div>`;
    const fournisseur = {
      etiquettes: () => api.etiquettesLigne(), enregistrerEtiquettes: (l) => api.enregistrerEtiquettesLigne(l),
      couleursTypePrix: () => api.couleursTypePrix(), enregistrerCouleurs: (l) => api.enregistrerCouleursTypePrix(l),
    };
    const p = new ParametrageAffichageDocument(this.conteneur.querySelector('.corps'), { fournisseur, admin: app.estAdmin(), message: (t, n) => app.message(t, n) });
    await p.ouvrir();
    await this.ouvrirSeuils(this.conteneur.querySelector('.seuils-solde'));
    await this.ouvrirConditions(this.conteneur.querySelector('.conditions-paiement'));
    await this.ouvrirAcomptes(this.conteneur.querySelector('.mode-acomptes'));
    await this.ouvrirTextes(this.conteneur.querySelector('.textes-types'));
    await this.ouvrirRegles(this.conteneur.querySelector('.regles-documents'));
    const ordres = this.conteneur.querySelector('.types-ordres');
    if (ordres) await this.ouvrirTypesOrdres(ordres);
  }

  /**
   * Types d'ordres du module Exécution (E25, E39) : activation (un type ne se désactive que lorsque tous ses ordres sont
   * terminés) et service par défaut d'un nouvel ordre.
   */
  async ouvrirTypesOrdres(zone) {
    const app = this.app;
    const [types, services] = await Promise.all([api.execution.types(), api.services()]);
    const admin = app.estAdmin();
    const options = services.filter((x) => x.actif).map((x) => ({ valeur: x.id, libelle: x.libelle, detail: x.code }));
    zone.innerHTML = `<p class="aide">Un type désactivé disparaît des menus, des listes et des transformations ; ses étapes de parcours sont ignorées.
      Il ne se désactive que lorsque tous ses ordres sont terminés.</p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>Type</th><th>Code</th><th>Actif</th><th>Service par défaut</th><th>Non terminés</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${types.map((t, i) => `<tr data-i="${i}"><td>${echapper(t.libelle)}</td><td>${echapper(t.code)}</td>
        <td><input type="checkbox" data-actif ${t.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}></td><td data-service></td>
        <td class="nombre">${t.en_cours || ''}</td>
        <td class="cellule-boutons">${admin ? '<button type="button" data-enregistrer title="Enregistrer">💾</button>' : ''}</td></tr>`).join('')}</tbody></table>`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const t = types[Number(tr.dataset.i)];
      const combo = creerCombo({ options, valeur: t.srv_id ?? '', vide: true });
      combo.readOnly = !admin;
      tr.querySelector('[data-service]').append(combo);
      tr.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        try {
          await api.execution.enregistrerType(t.code, { actif: tr.querySelector('[data-actif]').checked, srv_id: combo.valeurCombo === '' ? null : Number(combo.valeurCombo) });
          app.message(`${t.libelle} : enregistré`, 'succes');
          await app.chargerModules();
          await this.ouvrirTypesOrdres(zone);
        } catch (e) { app.message(e.message, 'erreur'); }
      });
    });
  }

  /**
   * Règles des documents (CONCEPTION-REGLES-DOCUMENTS.md, § 6) : par règle du catalogue, valeur globale (ou défaut) et
   * surcharges par famille ou par type ; le plus précis l'emporte.
   */
  async ouvrirRegles(zone) {
    const app = this.app;
    let [p, types] = await Promise.all([api.reglesDocuments(), api.typesDocument()]);
    const admin = app.estAdmin();
    const niveaux = [{ valeur: '', libelle: 'Global' }, ...FAMILLES_REGLE.map(([v, l]) => ({ valeur: `F:${v}`, libelle: l })),
      ...types.map((t) => ({ valeur: `T:${t.tyd_code}`, libelle: t.tyd_libelle, detail: t.tyd_code }))];
    const niveauDe = (r) => (r.type ? `T:${r.type}` : r.famille ? `F:${r.famille}` : '');
    const texteValeur = (d, v) => (d.genre === 'BOOLEEN' ? (v ? 'oui' : 'non') : v === null || v === undefined ? '—' : String(v));
    const EFFETS = { BLOQUANT: '⛔', AVERTISSEMENT: '⚠', PARAMETRE: '' };
    const rendre = () => {
      zone.innerHTML = `<p class="aide">Valeur d'une règle pour un document : celle de son type, sinon de sa famille, sinon la valeur globale,
        sinon le défaut. ⛔ bloque la validation, ⚠ avertit sans bloquer. -1 : pas de seuil.</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Règle</th><th>Défaut</th><th>Valeurs paramétrées</th><th></th></tr></thead><tbody>
        ${p.catalogue.map((d) => `<tr data-code="${d.code}"><td title="${echapper(d.description)}">${EFFETS[d.effet] ?? ''} ${echapper(d.libelle)}
          <br><small class="aide">${echapper(d.description)}</small></td><td>${echapper(texteValeur(d, d.defaut))}</td>
          <td>${p.regles.map((r, i) => (r.code === d.code ? `<div class="regle-niveau" data-i="${i}"><span data-niveau></span> <span data-valeur></span>
            ${admin ? '<button type="button" data-retirer title="Retirer cette valeur">✕</button>' : ''}</div>` : '')).join('')}</td>
          <td>${admin ? '<button type="button" data-ajouter title="Valeur pour un niveau (global, famille, type)">＋</button>' : ''}</td></tr>`).join('')}
        </tbody></table>
        ${admin ? '<div class="boutons"><button type="button" class="principal" data-enregistrer>Enregistrer les règles</button></div>' : ''}`;
      const catalogue = new Map(p.catalogue.map((d) => [d.code, d]));
      zone.querySelectorAll('.regle-niveau').forEach((div) => {
        const r = p.regles[Number(div.dataset.i)];
        const d = catalogue.get(r.code);
        const niveau = creerCombo({ options: niveaux, valeur: niveauDe(r), vide: false });
        niveau.readOnly = !admin;
        niveau.addEventListener('change', () => {
          const v = niveau.valeurCombo;
          r.famille = v.startsWith('F:') ? v.slice(2) : null;
          r.type = v.startsWith('T:') ? v.slice(2) : null;
        });
        div.querySelector('[data-niveau]').replaceWith(niveau);
        let champ;
        if (d.genre === 'BOOLEEN') {
          champ = document.createElement('input');
          champ.type = 'checkbox';
          champ.checked = r.valeur === true;
          champ.disabled = !admin;
          champ.addEventListener('change', () => { r.valeur = champ.checked; });
        } else if (d.genre === 'CHOIX') {
          champ = creerCombo({ options: (d.choix ?? []).map((c) => ({ valeur: c, libelle: c })), valeur: r.valeur ?? '', vide: false });
          champ.readOnly = !admin;
          champ.addEventListener('change', () => { r.valeur = champ.valeurCombo; });
        } else {
          champ = document.createElement('input');
          champ.size = 8;
          champ.value = r.valeur ?? '';
          champ.disabled = !admin;
          champ.addEventListener('change', () => { const n = lireNombre(champ.value); r.valeur = n === null || n === undefined ? null : Number(n); });
        }
        div.querySelector('[data-valeur]').replaceWith(champ);
      });
      zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { p.regles.splice(Number(b.closest('.regle-niveau').dataset.i), 1); rendre(); }));
      zone.querySelectorAll('[data-ajouter]').forEach((b) => b.addEventListener('click', () => {
        const d = catalogue.get(b.closest('tr').dataset.code);
        p.regles.push({ code: d.code, famille: null, type: null, valeur: d.defaut, actif: true });
        rendre();
      }));
      zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        try {
          p = await api.enregistrerReglesDocuments(p.regles);
          app.message('Règles des documents enregistrées', 'succes');
          rendre();
        } catch (e) { app.message(e.message, 'erreur'); }
      });
    };
    rendre();
  }

  /**
   * Mode d'acompte de la société (CONCEPTION-MARCHES-REGLEMENTS.md, 11.1) : avance de trésorerie (reçu sans TVA) ou
   * chiffre d'affaires (facture d'acompte avec TVA) ; il ne change plus une fois un acompte créé.
   */
  /**
   * Modèles des textes d'introduction et de conclusion par type de document : recopiés dans les documents créés ensuite
   * (puis modifiables dans chaque document) ; variables comme les libellés des lignes.
   */
  async ouvrirTextes(zone) {
    const app = this.app;
    const types = (await api.typesDocument()).filter((t) => t.tyd_actif !== false);
    zone.innerHTML = `<p class="aide">Introduction : avant le bloc des lignes ; conclusion : après le pied et les récapitulatifs (marché, factures).
      Le modèle est recopié dans chaque nouveau document du type, puis modifiable ; les variables sont figées à la validation.</p>
      <p>Type de document <span data-type></span></p><div class="textes-modele"></div>`;
    const combo = creerCombo({ options: types.map((t) => ({ valeur: t.tyd_code, libelle: t.tyd_libelle })), valeur: types[0]?.tyd_code ?? null, vide: false });
    zone.querySelector('[data-type]').replaceWith(combo);
    const corps = zone.querySelector('.textes-modele');
    let textes = { intro_html: null, fin_html: null };
    const rendre = () => {
      const bloc = (cle, titre) => `<div class="texte-document"><div class="texte-document-titre"><strong>${titre}</strong>
          ${app.estAdmin() ? `<button type="button" data-modifier="${cle}">✎ Modifier</button>` : ''}</div>
        <div class="texte-document-apercu">${textes[`${cle}_html`] ? htmlSur(textes[`${cle}_html`]) : '<span class="aide">Aucun texte</span>'}</div></div>`;
      corps.innerHTML = `${bloc('intro', 'Introduction')}${bloc('fin', 'Conclusion')}
        ${app.estAdmin() ? '<p><button type="button" class="principal" data-enregistrer>Enregistrer les textes</button></p>' : ''}`;
      corps.querySelectorAll('[data-modifier]').forEach((b) => b.addEventListener('click', async () => {
        const cle = `${b.dataset.modifier}_html`;
        const v = await editerLibelle({ html: textes[cle] ?? '', titre: `${combo.value} · ${b.dataset.modifier === 'intro' ? 'introduction' : 'conclusion'}`, variables: variablesTexteDocument() });
        if (v !== undefined) { textes = { ...textes, [cle]: v || null }; rendre(); }
      }));
      corps.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        try {
          textes = await api.enregistrerTextesType(combo.valeurCombo, textes);
          app.message('Textes enregistrés', 'succes');
          rendre();
        } catch (e) { app.message(e.message, 'erreur'); }
      });
    };
    const charger = async () => { textes = await api.textesType(combo.valeurCombo); rendre(); };
    combo.addEventListener('change', () => charger().catch((e) => app.message(e.message, 'erreur')));
    await charger();
  }

  async ouvrirAcomptes(zone) {
    const app = this.app;
    const mode = await api.modeAcomptes();
    zone.innerHTML = `<p class="aide">Avance de trésorerie : demande puis reçu d'acompte (non comptable, sans TVA), déduction TTC au pied des factures.
      Chiffre d'affaires : demande puis facture d'acompte (TVA du marché, comptée dans le facturé), déduction HT dans le pied de chaque commande.</p>
      <p>Mode <span data-mode></span> ${app.estAdmin() ? '<button type="button" class="principal" data-enregistrer>Enregistrer le mode</button>' : ''}</p>`;
    const combo = creerCombo({ options: [{ valeur: 'TRESORERIE', libelle: 'Avance de trésorerie' }, { valeur: 'CA', libelle: 'Chiffre d\'affaires' }], valeur: mode.mode, vide: false });
    combo.readOnly = !app.estAdmin();
    zone.querySelector('[data-mode]').replaceWith(combo);
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        await api.enregistrerModeAcomptes(combo.valeurCombo);
        app.message('Mode d\'acompte enregistré', 'succes');
      } catch (e) { app.message(e.message, 'erreur'); }
    });
  }

  /**
   * Conditions de paiement (échéancier des factures et avoirs à leur validation) et condition par défaut des ventes et
   * des achats, quand ni le document ni le tiers n'en donnent.
   */
  async ouvrirConditions(zone) {
    const app = this.app;
    let [conditions, defauts] = await Promise.all([api.conditionsPaiement(), api.conditionsDefaut()]);
    const admin = app.estAdmin();
    const ro = admin ? '' : 'disabled';
    const rendre = () => {
      zone.innerHTML = `<p class="aide">Échéances : « 30% 0j; 70% 30j FM » — pourcentage du net à payer, délai en jours, puis FM (fin de mois)
        ou « le 10 » (jour fixe du mois), mode de règlement facultatif (VIREMENT, LCR…). Vide : comptant. Le tiers choisit sa
        condition par son délai de paiement (même code).</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Code</th><th>Libellé</th><th>Échéances</th><th>Actif</th><th></th></tr></thead>
        <tbody>${conditions.map((c, i) => `<tr data-i="${i}">
          <td><input data-c="code" size="10" maxlength="20" value="${echapper(c.code)}" ${ro}></td>
          <td><input data-c="libelle" size="30" maxlength="100" value="${echapper(c.libelle)}" ${ro}></td>
          <td><input data-c="lignes" size="34" value="${echapper(formaterEcheances(c.lignes))}" ${ro}></td>
          <td><input type="checkbox" data-c="actif" ${c.actif ? 'checked' : ''} ${ro}></td>
          <td>${admin ? '<button type="button" data-retirer title="Retirer (désactivée si un document l\'utilise)">✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
        ${admin ? '<div class="boutons"><button type="button" data-ajouter>＋ Condition</button></div>' : ''}
        <p>Par défaut : ventes <span data-defaut="vente"></span> achats <span data-defaut="achat"></span></p>
        ${admin ? '<div class="boutons"><button type="button" class="principal" data-enregistrer>Enregistrer les conditions</button></div>' : ''}`;
      const options = conditions.filter((c) => c.actif).map((c) => ({ valeur: c.code, libelle: c.libelle, detail: c.code }));
      for (const place of zone.querySelectorAll('[data-defaut]')) {
        const combo = creerCombo({ options, valeur: defauts[place.dataset.defaut] ?? '' });
        combo.readOnly = !admin;
        combo.addEventListener('change', () => { defauts[place.dataset.defaut] = combo.valeurCombo || null; });
        place.replaceWith(combo);
      }
      zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => {
        lire();
        conditions.splice(Number(b.closest('tr').dataset.i), 1);
        rendre();
      }));
      zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
        lire();
        conditions.push({ code: '', libelle: '', lignes: [], ordre: conditions.length + 1, actif: true });
        rendre();
        zone.querySelector('tbody tr:last-child [data-c="code"]')?.focus();
      });
      zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        const erreur = lire();
        if (erreur) { app.message(erreur, 'avertissement'); return; }
        try {
          conditions = await api.enregistrerConditionsPaiement(conditions.map((c, i) => ({ ...c, ordre: i + 1 })));
          defauts = await api.enregistrerConditionsDefaut(defauts);
          app.message('Conditions de paiement enregistrées', 'succes');
          rendre();
        } catch (e) { app.message(e.message, 'erreur'); }
      });
    };
    // Saisie relue dans la liste ; renvoie le premier message d'erreur.
    const lire = () => {
      let erreur = null;
      for (const tr of zone.querySelectorAll('tbody tr')) {
        const c = conditions[Number(tr.dataset.i)];
        c.code = tr.querySelector('[data-c="code"]').value.trim().toUpperCase();
        c.libelle = tr.querySelector('[data-c="libelle"]').value.trim();
        c.actif = tr.querySelector('[data-c="actif"]').checked;
        const lignes = lireEcheances(tr.querySelector('[data-c="lignes"]').value);
        if (lignes === null) erreur ??= `${c.code || 'Condition'} : échéances mal écrites (ex. « 30% 0j; 70% 30j FM »)`;
        else c.lignes = lignes;
      }
      return erreur;
    };
    rendre();
  }

  /**
   * Seuils de solde automatique (achats, ventes) : à la validation d'un BL ou d'une facture, une ligne dont le reste
   * passe sous le seuil (en % de la quantité du parent, ou en quantité) solde la ligne du parent.
   */
  async ouvrirSeuils(zone) {
    const app = this.app;
    const seuils = await api.seuilsSolde();
    const admin = app.estAdmin();
    const ro = admin ? '' : 'disabled';
    const ligne = (cle, libelle) => `<tr><th>${echapper(libelle)}</th>
      <td><input data-famille="${cle}" data-c="pct" inputmode="decimal" size="6" value="${formatLibre(seuils[cle]?.pct ?? 0)}" ${ro}> %</td>
      <td><input data-famille="${cle}" data-c="qte" inputmode="decimal" size="8" value="${formatLibre(seuils[cle]?.qte ?? 0)}" ${ro}></td></tr>`;
    zone.innerHTML = `<p class="aide">À la validation d'un bon de livraison ou d'une facture issu d'une commande, une ligne est soldée
      automatiquement quand son reste est inférieur ou égal à l'un des deux seuils (0 : soldée quand tout est livré ou facturé).
      La case « Soldée » de la ligne permet aussi de la solder à la main.</p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th></th><th>% de la quantité du parent</th><th>Quantité</th></tr></thead>
      <tbody>${ligne('achat', 'Achats')}${ligne('vente', 'Ventes')}</tbody></table>
      ${admin ? '<div class="boutons"><button type="button" class="principal" data-enregistrer>Enregistrer les seuils</button></div>' : ''}`;
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      const valeurs = { achat: {}, vente: {} };
      for (const el of zone.querySelectorAll('[data-famille]')) {
        const v = lireNombre(el.value);
        if (v === undefined || v === null || Number(v) < 0) { app.message('Seuil invalide : nombre positif ou nul', 'avertissement'); el.focus(); return; }
        valeurs[el.dataset.famille][el.dataset.c] = v;
      }
      try {
        await api.enregistrerSeuilsSolde(valeurs);
        app.message('Seuils de solde enregistrés', 'succes');
      } catch (e) { app.message(e.message, 'erreur'); }
    });
  }
}
