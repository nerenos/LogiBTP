import { PageBase } from '@logibtp/navigation';
import { ParametrageAffichageDocument, FournisseurAffichageMemoire } from '@logibtp/document/ui';
import { echapper, lireNombre, formatLibre, creerCombo } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { ETIQUETTES_LIGNE, COULEURS_TYPE_PRIX } from '../vues-document.js';

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
      <h2>Conditions de paiement</h2><div class="conditions-paiement"></div></div>`;
    // Hors ligne : les listes de la définition de démonstration sont modifiées en place (visibles dans le devis de démo).
    const fournisseur = app.enLigne
      ? {
        etiquettes: () => api.etiquettesLigne(), enregistrerEtiquettes: (l) => api.enregistrerEtiquettesLigne(l),
        couleursTypePrix: () => api.couleursTypePrix(), enregistrerCouleurs: (l) => api.enregistrerCouleursTypePrix(l),
      }
      : new FournisseurAffichageMemoire({ etiquettes: ETIQUETTES_LIGNE, couleurs: COULEURS_TYPE_PRIX, admin: () => app.estAdmin() });
    const p = new ParametrageAffichageDocument(this.conteneur.querySelector('.corps'), { fournisseur, admin: app.estAdmin(), message: (t, n) => app.message(t, n) });
    await p.ouvrir();
    await this.ouvrirSeuils(this.conteneur.querySelector('.seuils-solde'));
    await this.ouvrirConditions(this.conteneur.querySelector('.conditions-paiement'));
  }

  /**
   * Conditions de paiement (échéancier des factures et avoirs à leur validation) et condition par défaut des ventes et
   * des achats, quand ni le document ni le tiers n'en donnent.
   */
  async ouvrirConditions(zone) {
    const app = this.app;
    if (!app.enLigne) { zone.innerHTML = '<p class="aide">Conditions de paiement disponibles en ligne seulement.</p>'; return; }
    let [conditions, defauts] = await Promise.all([api.conditionsPaiement(), api.conditionsDefaut()]);
    const admin = app.estAdmin();
    const ro = admin ? '' : 'disabled';
    const rendre = () => {
      zone.innerHTML = `<p class="aide">Échéances : « 30% 0j; 70% 30j FM » — pourcentage du net à payer, délai en jours, puis FM (fin de mois)
        ou « le 10 » (jour fixe du mois), mode de règlement facultatif (VIREMENT, LCR…). Vide : comptant. Le tiers choisit sa
        condition par son délai de paiement (même code).</p>
        <table><thead><tr><th>Code</th><th>Libellé</th><th>Échéances</th><th>Actif</th><th></th></tr></thead>
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
    if (!app.enLigne) { zone.innerHTML = '<p class="aide">Seuils de solde disponibles en ligne seulement.</p>'; return; }
    const seuils = await api.seuilsSolde();
    const admin = app.estAdmin();
    const ro = admin ? '' : 'disabled';
    const ligne = (cle, libelle) => `<tr><th>${echapper(libelle)}</th>
      <td><input data-famille="${cle}" data-c="pct" inputmode="decimal" size="6" value="${formatLibre(seuils[cle]?.pct ?? 0)}" ${ro}> %</td>
      <td><input data-famille="${cle}" data-c="qte" inputmode="decimal" size="8" value="${formatLibre(seuils[cle]?.qte ?? 0)}" ${ro}></td></tr>`;
    zone.innerHTML = `<p class="aide">À la validation d'un bon de livraison ou d'une facture issu d'une commande, une ligne est soldée
      automatiquement quand son reste est inférieur ou égal à l'un des deux seuils (0 : soldée quand tout est livré ou facturé).
      La case « Soldée » de la ligne permet aussi de la solder à la main.</p>
      <table><thead><tr><th></th><th>% de la quantité du parent</th><th>Quantité</th></tr></thead>
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
