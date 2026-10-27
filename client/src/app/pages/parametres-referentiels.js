import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';

// Référentiels communs (lot 2 des demandes du 25/10/2026) : listes de valeurs du cœur (types de matériel, activités,
// priorités et évaluations des projets ; deux niveaux pour les deux premières), modes de règlement, unités (décimales
// par défaut, synonymes) et numérotation des documents (format, remise à zéro, reprise du dernier numéro). Chaque
// section s'enregistre à part ; écriture : administrateur. Un élément retiré encore employé est désactivé.

const action = (attr, icone, titre) => `<button type="button" class="bouton-icone" ${attr} title="${titre}" aria-label="${titre}">${icone}</button>`;
const JETONS_NUMERO = '{P} préfixe du type, {AAAA} ou {AA} année, {N} rang ou {N:5} rang sur 5 chiffres ; vide : {P}{AAAA}-{N:5}';

export class PageParametresReferentiels extends PageBase {
  icone = '🗃';
  #modifiees = new Set();

  get modifiee() { return this.#modifiees.size > 0; }

  async ouvrir() {
    const app = this.app;
    this.titre = 'Référentiels communs';
    this.admin = app.estAdmin();
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">🗃 Référentiels communs</h1>
      <div data-listes></div>
      <div data-section="modes"></div><div data-section="unites"></div><div data-section="numeros"></div></div>`;
    const listes = await api.listesValeurs.listes();
    const zone = this.conteneur.querySelector('[data-listes]');
    zone.innerHTML = listes.map((l) => `<div data-liste="${echapper(l.code)}"></div>`).join('');
    await Promise.all([
      ...listes.map((l) => this.#liste(zone.querySelector(`[data-liste="${l.code}"]`), l)),
      this.#modes(this.conteneur.querySelector('[data-section="modes"]')),
      this.#unites(this.conteneur.querySelector('[data-section="unites"]')),
      this.#numeros(this.conteneur.querySelector('[data-section="numeros"]')),
    ]);
  }

  /** Marque une section modifiée (bouton Enregistrer actif, page modifiée). */
  #modifier(cle, zone, oui = true) {
    if (oui) this.#modifiees.add(cle); else this.#modifiees.delete(cle);
    const b = zone.querySelector('[data-enregistrer]');
    if (b) b.disabled = !oui;
  }

  #entete(titre, aide, ajouter) {
    return `<div class="titre-actions"><h2>${echapper(titre)}</h2>${this.admin ? `<span class="titre-actions-boutons">${action('data-ajouter', '＋', ajouter)}
      <button type="button" class="principal" data-enregistrer disabled>Enregistrer</button></span>` : ''}</div>${aide ? `<p class="aide">${aide}</p>` : ''}`;
  }

  /** Liste de valeurs du cœur : code, libellé, regroupement (listes à deux niveaux), couleur, ordre, actif. */
  async #liste(zone, def) {
    let valeurs = await api.listesValeurs.lire(def.code);
    const rendre = () => {
      const groupes = valeurs.filter((v) => !v.parent);
      zone.innerHTML = `${this.#entete(def.libelle, def.hierarchie ? 'Deux niveaux : un regroupement et ses valeurs (une valeur rangée sous un regroupement).' : '', 'Ajouter une valeur')}
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Code</th><th>Libellé</th>${def.hierarchie ? '<th>Regroupement</th>' : ''}<th>Couleur</th><th>Ordre</th><th>Actif</th><th></th></tr></thead><tbody>
        ${valeurs.map((v, i) => `<tr data-i="${i}"${v.parent ? ' class="dans-groupe"' : ''}>
          <td><input data-c="code" value="${echapper(v.code)}" size="14" maxlength="30" ${this.admin ? '' : 'readonly'}></td>
          <td><input data-c="libelle" value="${echapper(v.libelle)}" size="28" maxlength="100" ${this.admin ? '' : 'readonly'}></td>
          ${def.hierarchie ? '<td data-parent></td>' : ''}
          <td><input type="color" data-c="couleur" value="${echapper(v.couleur ?? '#64748b')}" ${this.admin ? '' : 'disabled'}></td>
          <td><input data-c="ordre" value="${v.ordre}" size="4" inputmode="numeric" ${this.admin ? '' : 'readonly'}></td>
          <td><input type="checkbox" data-c="actif" ${v.actif ? 'checked' : ''} ${this.admin ? '' : 'disabled'}></td>
          <td class="cellule-boutons">${this.admin ? action('data-retirer', '✕', 'Retirer (désactivée si elle est employée)') : ''}</td></tr>`).join('')}</tbody></table>`;
      zone.querySelectorAll('tr[data-i]').forEach((tr) => {
        const v = valeurs[Number(tr.dataset.i)];
        const td = tr.querySelector('[data-parent]');
        if (td) {
          const combo = creerCombo({ options: groupes.filter((g) => g !== v).map((g) => ({ valeur: g.code, libelle: g.libelle, detail: g.code })), valeur: v.parent ?? '', vide: true });
          combo.disabled = !this.admin;
          combo.addEventListener('change', () => { v.parent = combo.valeurCombo || null; this.#modifier(def.code, zone); });
          td.append(combo);
        }
        tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
          v[c.dataset.c] = c.type === 'checkbox' ? c.checked : c.dataset.c === 'ordre' ? Number(c.value) || 0 : c.value.trim();
          this.#modifier(def.code, zone);
        }));
        tr.querySelector('[data-retirer]')?.addEventListener('click', () => {
          valeurs = valeurs.filter((x) => x !== v).map((x) => (x.parent === v.code ? { ...x, parent: null } : x));
          rendre();
          this.#modifier(def.code, zone);
        });
      });
      zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
        valeurs.push({ code: '', libelle: '', parent: null, couleur: null, ordre: (valeurs.at(-1)?.ordre ?? 0) + 10, actif: true });
        rendre();
        this.#modifier(def.code, zone);
      });
      zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        try {
          valeurs = await api.listesValeurs.enregistrer(def.code, valeurs.map((v) => ({ ...v, code: v.code.toUpperCase() })));
          this.#modifier(def.code, zone, false);
          this.app.message(`${def.libelle} enregistrés`, 'succes');
          rendre();
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }

  /** Modes de règlement (module Document) : code, libellé, ordre, actif. */
  async #modes(zone) {
    let modes = await api.modesReglement();
    const rendre = () => {
      zone.innerHTML = `${this.#entete('Modes de règlement', 'Proposés dans les tiers (client, fournisseur), l\'entête des pièces, les échéances et les règlements. Délais de paiement : conditions de paiement des documents (Paramètres › Documents).', 'Ajouter un mode')}
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Code</th><th>Libellé</th><th>Ordre</th><th>Actif</th><th></th></tr></thead><tbody>
        ${modes.map((m, i) => `<tr data-i="${i}"><td><input data-c="code" value="${echapper(m.code)}" size="14" maxlength="20" ${this.admin ? '' : 'readonly'}></td>
          <td><input data-c="libelle" value="${echapper(m.libelle)}" size="28" maxlength="80" ${this.admin ? '' : 'readonly'}></td>
          <td><input data-c="ordre" value="${m.ordre}" size="4" inputmode="numeric" ${this.admin ? '' : 'readonly'}></td>
          <td><input type="checkbox" data-c="actif" ${m.actif ? 'checked' : ''} ${this.admin ? '' : 'disabled'}></td>
          <td class="cellule-boutons">${this.admin ? action('data-retirer', '✕', 'Retirer (désactivé s\'il est employé)') : ''}</td></tr>`).join('')}</tbody></table>`;
      lierTableau(zone, modes, () => this.#modifier('modes', zone), rendre, () => ({ code: '', libelle: '', ordre: modes.length + 1, actif: true }));
      zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        try {
          modes = await api.enregistrerModesReglement(modes.map((m) => ({ ...m, code: m.code.toUpperCase() })));
          this.#modifier('modes', zone, false);
          this.app.message('Modes de règlement enregistrés', 'succes');
          rendre();
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }

  /** Unités : code, libellé, décimales par défaut des quantités, synonymes (séparés par des virgules), ordre, actif. */
  async #unites(zone) {
    let unites = await api.unitesParametrage();
    const rendre = () => {
      zone.innerHTML = `${this.#entete('Unités', 'Décimales : précision par défaut des quantités. Synonymes : autres écritures reconnues à la saisie et à l\'import (M² = m2, m², mcarre…), séparées par des virgules.', 'Ajouter une unité')}
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Code</th><th>Libellé</th><th>Décimales</th><th>Synonymes</th><th>Ordre</th><th>Actif</th><th></th></tr></thead><tbody>
        ${unites.map((u, i) => `<tr data-i="${i}"><td><input data-c="code" value="${echapper(u.code)}" size="6" maxlength="10" ${this.admin ? '' : 'readonly'}></td>
          <td><input data-c="libelle" value="${echapper(u.libelle)}" size="20" maxlength="50" ${this.admin ? '' : 'readonly'}></td>
          <td><input data-c="precision" value="${u.precision}" size="2" inputmode="numeric" ${this.admin ? '' : 'readonly'}></td>
          <td><input data-c="synonymes" value="${echapper((u.synonymes ?? []).join(', '))}" size="36" ${this.admin ? '' : 'readonly'}></td>
          <td><input data-c="ordre" value="${u.ordre}" size="4" inputmode="numeric" ${this.admin ? '' : 'readonly'}></td>
          <td><input type="checkbox" data-c="actif" ${u.actif ? 'checked' : ''} ${this.admin ? '' : 'disabled'}></td>
          <td class="cellule-boutons">${this.admin ? action('data-retirer', '✕', 'Retirer (désactivée si une ligne l\'emploie)') : ''}</td></tr>`).join('')}</tbody></table>`;
      lierTableau(zone, unites, () => this.#modifier('unites', zone), rendre,
        () => ({ code: '', libelle: '', precision: 2, synonymes: [], ordre: (unites.at(-1)?.ordre ?? 0) + 1, actif: true }),
        { precision: (v) => Number(v) || 0, synonymes: (v) => v.split(',').map((s) => s.trim()).filter(Boolean) });
      zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        try {
          unites = await api.enregistrerUnitesParametrage(unites);
          this.#modifier('unites', zone, false);
          this.app.message('Unités enregistrées', 'succes');
          rendre();
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }

  /**
   * Numérotation des documents (chronos) : par type, préfixe, format, remise à zéro (chaque exercice ou jamais) et
   * reprise du dernier numéro attribué de l'exercice en cours ; prochain numéro calculé par le serveur.
   */
  async #numeros(zone) {
    let types = await api.numerotations();
    const saisies = new Map();
    const rendre = () => {
      zone.innerHTML = `<div class="titre-actions"><h2>Numérotation des documents</h2></div>
        <p class="aide">Format : ${echapper(JETONS_NUMERO)}. Remise à zéro chaque exercice : l'année doit figurer dans le numéro. Reprise : dernier numéro déjà attribué cette année (ou depuis toujours sans remise à zéro) ; le suivant sera attribué.</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Type</th><th>Préfixe</th><th>Format</th><th>Remise<br><small>à zéro</small></th><th>Dernier<br><small>numéro</small></th><th>Prochain<br><small>numéro</small></th><th></th></tr></thead><tbody>
        ${types.map((t) => `<tr data-code="${echapper(t.code)}"><td>${echapper(t.libelle)}<div><small>${echapper(t.code)}${t.continue ? ' · numérotation continue' : ''}</small></div></td>
          <td><input data-c="prefixe" value="${echapper(t.prefixe ?? '')}" size="5" maxlength="10" ${this.admin ? '' : 'readonly'}></td>
          <td><input data-c="format" value="${echapper(t.format ?? '')}" placeholder="{P}{AAAA}-{N:5}" size="14" maxlength="40" ${this.admin ? '' : 'readonly'}></td>
          <td data-raz></td>
          <td><input data-c="dernier" value="${t.dernier}" size="5" inputmode="numeric" ${this.admin ? '' : 'readonly'}></td>
          <td class="nombre">${echapper(t.prochain)}</td>
          <td class="cellule-boutons">${this.admin ? '<button type="button" data-appliquer disabled>Appliquer</button>' : ''}</td></tr>`).join('')}</tbody></table>`;
      zone.querySelectorAll('tr[data-code]').forEach((tr) => {
        const t = types.find((x) => x.code === tr.dataset.code);
        const s = { prefixe: t.prefixe, format: t.format, raz: t.raz, dernier: t.dernier };
        const changer = () => { saisies.set(t.code, s); tr.querySelector('[data-appliquer]').disabled = false; this.#modifier('numeros', zone); };
        const raz = creerCombo({ options: [{ valeur: 'A', libelle: 'Chaque exercice' }, { valeur: 'J', libelle: 'Jamais' }], valeur: t.raz, vide: false });
        raz.disabled = !this.admin;
        raz.addEventListener('change', () => { s.raz = raz.valeurCombo; changer(); });
        tr.querySelector('[data-raz]').append(raz);
        tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => { s[c.dataset.c] = c.dataset.c === 'dernier' ? Number(c.value) || 0 : c.value.trim() || null; changer(); }));
        tr.querySelector('[data-appliquer]')?.addEventListener('click', async () => {
          if (s.dernier !== t.dernier && !(await confirmer(`Reprendre la numérotation de « ${t.libelle} » après le numéro ${s.dernier} ?`))) return;
          try {
            types = await api.enregistrerNumerotation(t.code, s);
            saisies.delete(t.code);
            if (!saisies.size) this.#modifier('numeros', zone, false);
            this.app.message(`Numérotation de « ${t.libelle} » enregistrée`, 'succes');
            rendre();
          } catch (e) { this.app.erreur(e); }
        });
      });
    };
    rendre();
  }
}

/**
 * Saisie d'un tableau de lignes { champ: valeur } (attributs data-i et data-c) : changement, retrait, ajout.
 * `convertir` : conversion d'un champ saisi (sinon texte, ordre en nombre, case à cocher en booléen).
 */
function lierTableau(zone, lignes, modifier, rendre, nouvelle, convertir = {}) {
  zone.querySelectorAll('tr[data-i]').forEach((tr) => {
    const l = lignes[Number(tr.dataset.i)];
    tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
      const k = c.dataset.c;
      l[k] = c.type === 'checkbox' ? c.checked : convertir[k] ? convertir[k](c.value) : k === 'ordre' ? Number(c.value) || 0 : c.value.trim();
      modifier();
    }));
    tr.querySelector('[data-retirer]')?.addEventListener('click', () => { lignes.splice(lignes.indexOf(l), 1); rendre(); modifier(); });
  });
  zone.querySelector('[data-ajouter]')?.addEventListener('click', () => { lignes.push(nouvelle()); rendre(); modifier(); });
}
