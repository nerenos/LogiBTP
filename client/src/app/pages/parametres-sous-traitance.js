import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { ACTIONS_BLOQUEES, PORTEES_PIECE } from '@logibtp/sous-traitance';
import { api } from '../api.js';

// Module Sous-traitance, lot 2 : pièces exigées (ANALYSE-MODULE-SOUS-TRAITANCE.md § 5.3, ST12, ST13) : liste
// paramétrable (administrateur) des pièces du sous-traitant et du marché, avec durée de validité, délai de rappel,
// actions bloquées et conditions (marché public ou privé, garantie, montant minimal).

const GARANTIES = [{ valeur: 'PAIEMENT_DIRECT', libelle: 'Paiement direct' }, { valeur: 'DELEGATION', libelle: 'Délégation' }, { valeur: 'CAUTION', libelle: 'Caution' }];
const PUBLIC = [{ valeur: 'oui', libelle: 'Public' }, { valeur: 'non', libelle: 'Privé' }];

export class PageParametresSousTraitance extends PageBase {
  icone = '🤝';
  #modifie = false;

  get modifiee() { return this.#modifie; }

  async ouvrir() {
    this.titre = 'Pièces exigées des sous-traitants';
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">🤝 Pièces exigées des sous-traitants</h1></div>
      <p class="aide">Pièces du sous-traitant (valables pour tous ses marchés : Kbis, URSSAF…) et documents du marché (DC4, contrat…). Une pièce fournie
      est un document de la GED de la catégorie indiquée ; sa validité court depuis son dépôt (durée) ou jusqu'à la date saisie. Une pièce
      bloquante manquante ou expirée empêche l'action cochée.</p><div data-corps></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-corps]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    this.pieces = await api.sousTraitance.typesPieces();
    this.#rendre();
  }

  #rendre() {
    const admin = this.app.estAdmin();
    const l = this.pieces;
    const corps = this.conteneur.querySelector('[data-corps]');
    const dis = admin ? '' : 'disabled';
    corps.innerHTML = `<table class="tableau-compact"><thead><tr><th>Code</th><th>Libellé</th><th>Portée</th><th>Catégorie GED</th><th>Obligatoire</th>
      <th>Validité (mois)</th><th>Rappel (jours)</th>${Object.values(ACTIONS_BLOQUEES).map((a) => `<th title="${echapper(a)}">Bloque ${echapper(a.split(' ').pop())}</th>`).join('')}
      <th>Marché</th><th>Garantie</th><th>Montant min.</th><th>Actif</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${l.map((p, i) => `<tr data-i="${i}"><td><input data-c="code" size="10" value="${echapper(p.code)}" ${admin && !p._existant ? '' : 'readonly'}></td>
        <td><input data-c="libelle" size="30" value="${echapper(p.libelle)}" ${admin ? '' : 'readonly'}></td><td data-portee></td>
        <td><input data-c="categorie" size="16" value="${echapper(p.categorie ?? '')}" ${admin ? '' : 'readonly'}></td>
        <td><input type="checkbox" data-c="obligatoire" ${p.obligatoire ? 'checked' : ''} ${dis}></td>
        <td><input data-c="duree_mois" size="3" value="${p.duree_mois ?? ''}" ${admin ? '' : 'readonly'}></td>
        <td><input data-c="rappel_jours" size="3" value="${p.rappel_jours ?? 0}" ${admin ? '' : 'readonly'}></td>
        ${Object.keys(ACTIONS_BLOQUEES).map((a) => `<td><input type="checkbox" data-bloque="${a}" ${p.bloquant.includes(a) ? 'checked' : ''} ${dis}></td>`).join('')}
        <td data-public></td><td data-garantie></td>
        <td><input data-c="cond_montant_min" size="8" value="${p.cond_montant_min ?? ''}" ${admin ? '' : 'readonly'}></td>
        <td><input type="checkbox" data-c="actif" ${p.actif ? 'checked' : ''} ${dis}></td>
        <td class="cellule-boutons">${admin ? `<button type="button" data-monter ${i ? '' : 'disabled'} title="Monter">↑</button><button type="button" data-retirer title="Retirer">✕</button>` : ''}</td></tr>`).join('')}
      </tbody></table>
      ${admin ? '<p class="ligne"><button type="button" data-ajouter>＋ Pièce</button> <button type="button" class="principal" data-enregistrer>Enregistrer</button></p>' : ''}`;
    const changer = () => { this.#modifie = true; };
    corps.querySelectorAll('tr[data-i]').forEach((tr) => {
      const p = l[Number(tr.dataset.i)];
      const combo = (sel, options, valeur, vide, ecrire) => {
        const c = creerCombo({ options, valeur: valeur ?? '', vide });
        c.readOnly = !admin;
        c.addEventListener('change', () => { ecrire(c.valeurCombo); changer(); });
        tr.querySelector(sel).append(c);
      };
      combo('[data-portee]', Object.entries(PORTEES_PIECE).map(([valeur, libelle]) => ({ valeur, libelle })), p.portee, false, (v) => { p.portee = v; });
      combo('[data-public]', PUBLIC, p.cond_public === true ? 'oui' : p.cond_public === false ? 'non' : '', true, (v) => { p.cond_public = v === 'oui' ? true : v === 'non' ? false : null; });
      combo('[data-garantie]', GARANTIES, p.cond_garantie, true, (v) => { p.cond_garantie = v || null; });
      tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => {
        const c = x.dataset.c;
        if (x.type === 'checkbox') p[c] = x.checked;
        else if (c === 'duree_mois' || c === 'cond_montant_min') p[c] = x.value.trim() ? Number(x.value.replace(',', '.')) : null;
        else if (c === 'rappel_jours') p[c] = Number(x.value) || 0;
        else p[c] = c === 'code' ? x.value.trim().toLowerCase() : x.value;
        changer();
      }));
      tr.querySelectorAll('[data-bloque]').forEach((x) => x.addEventListener('change', () => {
        p.bloquant = Object.keys(ACTIONS_BLOQUEES).filter((a) => tr.querySelector(`[data-bloque="${a}"]`).checked);
        changer();
      }));
      tr.querySelector('[data-monter]')?.addEventListener('click', () => { const i = l.indexOf(p); l.splice(i - 1, 0, ...l.splice(i, 1)); changer(); this.#rendre(); });
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { l.splice(l.indexOf(p), 1); changer(); this.#rendre(); });
    });
    corps.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      l.push({ code: '', libelle: '', portee: 'TIERS', categorie: '', obligatoire: true, duree_mois: null, rappel_jours: 0, bloquant: [], cond_public: null,
        cond_garantie: null, cond_montant_min: null, modele_edition: null, ordre: 0, actif: true });
      changer();
      this.#rendre();
    });
    corps.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.pieces = (await api.sousTraitance.enregistrerTypesPieces(l.map(({ _existant, ...x }, i) => ({ ...x, ordre: (i + 1) * 10 })))).map((x) => ({ ...x, _existant: true }));
        this.#modifie = false;
        this.app.message('Pièces exigées enregistrées', 'succes');
        this.#rendre();
      } catch (e) { this.app.message(e.message, 'erreur'); }
    });
    l.forEach((p) => { if (p.code) p._existant ??= true; });
  }
}
