import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, ouvrirMenuContextuel, confirmer, saisir } from '@logibtp/socle/ui';
import { ETATS_SERVICE, controlerParcours, MESSAGES_EXECUTION } from '@logibtp/execution';
import { EcranEtapesAtelier } from '@logibtp/execution/ui';
import { api } from '../api.js';
import { rendreCatalogueEtats, rendreEtatsTypes } from '../execution/parametres-etats.js';

// Module Exécution, lot 2 : synthèse des chantiers (un état par service), vue détaillée d'un chantier (parcours, états,
// ordres par service) et modèles de parcours. États calculés par le serveur (ReglesEtats.cs ↔ etats.js).

const TYPES_ORDRE = [
  ['E_OE', "Ordre d'exécution"], ['E_BE', "Bureau d'études"], ['E_BM', 'Méthodes'], ['E_OF', 'Ordre de fabrication'],
  ['E_CO', 'Colisage'], ['E_LI', 'Livraison'], ['E_PO', 'Ordre de pose'], ['E_SAV', 'Intervention SAV'], ['E_OST', 'Sous-traitance'],
  ['E_DAP', "Demande d'approvisionnement"], ['E_DAC', "Demande d'achat"], ['E_ENT', 'Entretien du matériel'],
].map(([valeur, libelle]) => ({ valeur, libelle, detail: valeur }));
const date = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

/** Pastille d'état d'un service (manuel : souligné ; écart avec l'automatique signalé). */
function pastille(e) {
  const d = ETATS_SERVICE[e.etat] ?? { icone: '?', libelle: e.etat };
  const titre = `${d.libelle}${e.manuel ? ` (imposé ; automatique : ${ETATS_SERVICE[e.automatique]?.libelle ?? e.automatique})` : ''}`;
  return `<span class="pastille-etat etat-${e.etat.toLowerCase()}${e.manuel ? ' manuel' : ''}${e.ecart ? ' ecart' : ''}" title="${echapper(titre)}">${d.icone}${e.ecart ? '❗' : ''}</span>`;
}

/** Menu contextuel d'un état : imposer un état ou revenir à l'automatique. */
function menuEtat(ev, e, imposer) {
  ouvrirMenuContextuel(ev, [
    ...Object.entries(ETATS_SERVICE).filter(([c]) => c !== 'SANS_OBJET').map(([c, d]) => ({ libelle: `${d.icone} Imposer « ${d.libelle} »`, action: () => imposer(c) })),
    { separateur: true },
    { libelle: '⟲ État automatique', actif: Boolean(e.manuel), action: () => imposer(null) },
  ], { aide: false });
}

async function demanderEtat(app, type, id, srv, etat) {
  const motif = etat ? await saisir('Motif (facultatif) :') ?? '' : null;
  return api.execution.imposerEtat(type, id, srv, { etat, motif: motif || null });
}

/**
 * Éditeur des étapes d'un parcours (modèle ou chantier) : code, libellé, service, type d'ordre, étapes amont (codes
 * séparés par des virgules) ; contrôles de la règle partagée affichés sous le tableau.
 */
/** États d'une étape de parcours en texte : « ETUDE:5, VISA » (durée facultative, virgule décimale acceptée). */
export const texteEtats = (etats) => (etats ?? []).map((x) => (x.duree === null || x.duree === undefined ? x.code : `${x.code}:${String(x.duree).replace('.', ',')}`)).join(', ');
export const lireEtats = (texte) => String(texte ?? '').split(/[,;\s]+(?=[A-Za-z_])/).map((x) => x.trim()).filter(Boolean).map((x) => {
  const [code, duree] = x.split(':');
  return { code: code.trim().toUpperCase(), duree: duree === undefined || duree.trim() === '' ? null : Number(duree.trim().replace(',', '.')) };
});

function editerEtapes(zone, etapes, services, { lecture = false, change = () => {} } = {}) {
  const rendre = () => {
    const erreurs = controlerParcours(etapes.map((e) => ({ code: e.code, srv_id: e.srv_id, amonts: e.amonts })));
    zone.innerHTML = `<table><thead><tr><th>Code</th><th>Libellé</th><th>Service</th><th>Type d'ordre</th><th>Amont (codes)</th>
      <th title="États retenus pour les ordres de cette étape, avec leur durée (ETUDE:5, VISA) ; vide : ceux du type d'ordre">États de l'ordre</th><th></th></tr></thead><tbody>
      ${etapes.map((e, i) => `<tr data-i="${i}"><td><input data-code size="9" value="${echapper(e.code ?? '')}" ${lecture ? 'readonly' : ''}></td>
        <td><input data-libelle size="24" value="${echapper(e.libelle ?? '')}" ${lecture ? 'readonly' : ''}></td><td data-service></td><td data-type></td>
        <td><input data-amonts size="16" value="${echapper((e.amonts ?? []).join(', '))}" ${lecture ? 'readonly' : ''}></td>
        <td><input data-etats size="22" placeholder="ceux du type" value="${echapper(texteEtats(e.etats))}" ${lecture ? 'readonly' : ''}></td>
        <td>${lecture ? '' : `<button type="button" data-monter title="Monter" ${i ? '' : 'disabled'}>↑</button><button type="button" data-retirer title="Retirer">✕</button>`}</td></tr>`).join('')}</tbody></table>
      ${lecture ? '' : '<p><button type="button" data-ajouter>＋ Étape</button></p>'}
      ${erreurs.length ? `<p class="erreur">${erreurs.map((c) => echapper(MESSAGES_EXECUTION[c] ?? c)).join(' · ')}</p>` : ''}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const e = etapes[Number(tr.dataset.i)];
      const srv = creerCombo({ options: services, valeur: e.srv_id ?? '', vide: true });
      const typ = creerCombo({ options: TYPES_ORDRE, valeur: e.type_ordre ?? '', vide: true });
      srv.readOnly = typ.readOnly = lecture;
      srv.addEventListener('change', () => { e.srv_id = srv.valeurCombo ? Number(srv.valeurCombo) : null; change(); rendre(); });
      typ.addEventListener('change', () => { e.type_ordre = typ.valeurCombo || null; change(); });
      tr.querySelector('[data-service]').append(srv);
      tr.querySelector('[data-type]').append(typ);
      tr.querySelector('[data-code]').addEventListener('change', (x) => { e.code = x.target.value.trim().toUpperCase(); change(); rendre(); });
      tr.querySelector('[data-libelle]').addEventListener('change', (x) => { e.libelle = x.target.value; change(); });
      tr.querySelector('[data-amonts]').addEventListener('change', (x) => {
        e.amonts = x.target.value.split(/[,;\s]+/).map((a) => a.trim().toUpperCase()).filter(Boolean); change(); rendre();
      });
      tr.querySelector('[data-etats]').addEventListener('change', (x) => { e.etats = lireEtats(x.target.value); change(); rendre(); });
      tr.querySelector('[data-monter]')?.addEventListener('click', () => { const i = etapes.indexOf(e); etapes.splice(i - 1, 0, ...etapes.splice(i, 1)); change(); rendre(); });
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { etapes.splice(etapes.indexOf(e), 1); change(); rendre(); });
    });
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      const prec = etapes.at(-1)?.code;
      etapes.push({ code: '', libelle: '', srv_id: null, type_ordre: null, amonts: prec ? [prec] : [] }); change(); rendre();
    });
  };
  rendre();
  return () => controlerParcours(etapes.map((e) => ({ code: e.code, srv_id: e.srv_id, amonts: e.amonts })));
}

const optionsServices = (services) => services.filter((s) => s.actif).map((s) => ({ valeur: s.id, libelle: s.parent_id ? `↳ ${s.libelle}` : s.libelle, detail: s.code }));

/** Synthèse : un chantier par ligne, une colonne par service présent ; filtres recherche, service, état. */
export class PageSyntheseExecution extends PageBase {
  icone = '🧭';

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ recherche: this.filtre.recherche, service: this.filtre.service, etat: this.filtre.etat }).filter(([, v]) => v));
    return `/execution/synthese${p.size ? `?${p}` : ''}`;
  }

  async ouvrir() {
    this.titre = "Synthèse de l'exécution";
    this.filtre = { recherche: this.requete.recherche ?? '', service: this.requete.service ?? '', etat: this.requete.etat ?? '' };
    this.conteneur.innerHTML = `<div class="page-parametres page-execution"><h1 class="page-titre">🧭 Synthèse de l'exécution</h1>
      <p class="ligne"><input type="search" data-recherche placeholder="Chantier, client…" value="${echapper(this.filtre.recherche)}">
        <span data-service></span> <span data-etat></span> <button type="button" data-actualiser>⟳</button></p>
      <p class="aide">Un état par service, calculé d'après le parcours et les ordres du chantier ; clic droit sur un état pour l'imposer. ❗ : état imposé différent de l'état calculé.</p>
      <div data-liste></div></div>`;
    const services = await api.services().catch(() => []);
    const srv = creerCombo({ options: optionsServices(services), valeur: this.filtre.service, vide: true, titre: 'Service' });
    const etat = creerCombo({ options: Object.entries(ETATS_SERVICE).filter(([c]) => c !== 'SANS_OBJET').map(([valeur, d]) => ({ valeur, libelle: `${d.icone} ${d.libelle}` })), valeur: this.filtre.etat, vide: true, titre: 'État' });
    this.conteneur.querySelector('[data-service]').append(srv);
    this.conteneur.querySelector('[data-etat]').append(etat);
    const relire = () => { this.app.routeur.remplacerUrl(this.urlCourante()); this.#charger(); };
    srv.addEventListener('change', () => { this.filtre.service = srv.valeurCombo; relire(); });
    etat.addEventListener('change', () => { this.filtre.etat = etat.valeurCombo; relire(); });
    this.conteneur.querySelector('[data-recherche]').addEventListener('change', (e) => { this.filtre.recherche = e.target.value; relire(); });
    this.conteneur.querySelector('[data-actualiser]').addEventListener('click', () => this.#charger());
    await this.#charger();
  }

  reprendre() { this.#charger(); }

  async #charger() {
    const zone = this.conteneur.querySelector('[data-liste]');
    let s;
    try { s = await api.execution.synthese(this.filtre); } catch (e) { this.app.erreur(e); return; }
    if (!s.lignes.length) { zone.innerHTML = '<p class="aide">Aucun chantier suivi : lancez un ordre d\'exécution depuis la fiche d\'un marché ou attribuez un parcours à un chantier.</p>'; return; }
    zone.innerHTML = `<table class="pleine-largeur synthese-execution"><thead><tr><th>Chantier</th><th>Client</th><th>Conducteur</th><th>Fin prévue</th>
        ${s.services.map((x) => `<th title="${echapper(x.libelle)}">${echapper(x.code)}</th>`).join('')}<th>Ordres</th><th>Dernier message</th></tr></thead><tbody>
      ${s.lignes.map((l, i) => `<tr data-i="${i}"><td><a href="/execution/chantier/${encodeURIComponent(l.element.id)}">${echapper(l.element.code)}</a> ${echapper(l.element.libelle)}</td>
        <td>${echapper(l.element.client ?? '')}</td><td>${echapper(l.element.responsable ?? '')}</td><td>${date(l.element.fin_prevue)}</td>
        ${s.services.map((x) => { const e = l.etats.find((y) => y.srv_id === x.id); return `<td class="centre" data-srv="${x.id}">${e && e.etat !== 'SANS_OBJET' ? pastille(e) : ''}</td>`; }).join('')}
        <td>${l.nb_ordres}${l.bloques ? ` · <span title="Bloqués">⛔ ${l.bloques}</span>` : ''}${l.en_retard ? ` · <span title="En retard">⏰ ${l.en_retard}</span>` : ''}</td>
        <td class="aide">${echapper(l.element.dernier_message ?? '')}</td></tr>`).join('')}</tbody></table>`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const l = s.lignes[Number(tr.dataset.i)];
      tr.querySelectorAll('td[data-srv]').forEach((td) => {
        const e = l.etats.find((y) => y.srv_id === Number(td.dataset.srv));
        if (!e || e.etat === 'SANS_OBJET') return;
        td.addEventListener('contextmenu', (ev) => menuEtat(ev, e, async (etat) => {
          try { await demanderEtat(this.app, l.element.type, l.element.id, e.srv_id, etat); await this.#charger(); } catch (x) { this.app.erreur(x); }
        }));
      });
    });
  }
}

/** Vue détaillée d'un chantier : parcours (modèle ou étapes propres), états par service, ordres regroupés par service. */
export class PageExecutionChantier extends PageBase {
  icone = '🧭';
  #modifie = () => false;

  get modifiee() { return this.#modifie(); }

  urlCourante() { return `/execution/chantier/${encodeURIComponent(this.params.id)}`; }

  async ouvrir() {
    this.titre = 'Exécution du chantier';
    this.conteneur.innerHTML = '<div class="page-parametres page-execution" data-corps></div>';
    const [modeles, d] = await Promise.all([api.execution.modeles(), api.execution.detail('chantier', this.params.id)]);
    this.modeles = modeles;
    this.#rendre(d);
  }

  #rendre(d) {
    const corps = this.conteneur.querySelector('[data-corps]');
    const el = d.element;
    this.titre = el ? `Exécution ${el.code}` : 'Exécution du chantier';
    const services = new Map(d.services.map((s) => [s.id, s]));
    const etapes = d.etapes.map((e) => ({ ...e, amonts: [...(e.amonts ?? [])] }));
    let modifie = false;
    corps.innerHTML = `<h1 class="page-titre">🧭 ${el ? `<a href="${echapper(el.url)}">${echapper(el.code)}</a> ${echapper(el.libelle)}` : 'Chantier introuvable'}</h1>
      ${el ? `<p class="aide">${echapper(el.client ?? '')}${el.responsable ? ` · conducteur : ${echapper(el.responsable)}` : ''}${el.fin_prevue ? ` · fin prévue : ${date(el.fin_prevue)}` : ''}</p>` : ''}
      <h2>États des services</h2><div data-etats></div>
      <h2>Parcours</h2><p class="ligne">Modèle : <span data-modele></span> <button type="button" data-appliquer>Appliquer le modèle</button>
        <button type="button" data-enregistrer disabled>Enregistrer le parcours</button> <button type="button" data-retirer-parcours ${etapes.length ? '' : 'disabled'}>Retirer le parcours</button>
        ${this.app.moduleActif('planning') && etapes.length ? '<button type="button" data-theorique title="Une tâche par étape, heures budget du service, enchaînées par des dépendances">📅 Planning théorique</button>' : ''}</p>
      <div data-etapes></div>
      <h2>Ordres</h2><div data-ordres></div>
      <p><a href="/execution/synthese">← Synthèse</a> · <a href="/liste/ordres?vue=1000&chantier=${encodeURIComponent(el?.code ?? '')}">Liste des ordres du chantier</a></p>`;
    // États
    const zEtats = corps.querySelector('[data-etats]');
    const visibles = d.etats.filter((e) => e.etat !== 'SANS_OBJET');
    zEtats.innerHTML = visibles.length ? `<table><tbody>${visibles.map((e) => {
      const m = d.manuels.find((x) => x.srv_id === e.srv_id);
      return `<tr data-srv="${e.srv_id}"><td>${echapper(services.get(e.srv_id)?.libelle ?? `Service ${e.srv_id}`)}</td><td>${pastille(e)} ${echapper(ETATS_SERVICE[e.etat]?.libelle ?? e.etat)}</td>
        <td class="aide">${m ? `imposé par ${echapper(m.par ?? '')} le ${date(m.le)}${m.motif ? ` : ${echapper(m.motif)}` : ''}` : ''}</td>
        <td><button type="button" data-imposer title="Imposer un état ou revenir à l'automatique">…</button></td></tr>`;
    }).join('')}</tbody></table>` : '<p class="aide">Aucun service concerné : attribuez un parcours ou créez des ordres.</p>';
    zEtats.querySelectorAll('tr[data-srv]').forEach((tr) => {
      const e = d.etats.find((x) => x.srv_id === Number(tr.dataset.srv));
      const ouvrirMenu = (ev) => menuEtat(ev, e, async (etat) => {
        try { this.#rendre(await demanderEtat(this.app, 'chantier', this.params.id, e.srv_id, etat)); } catch (x) { this.app.erreur(x); }
      });
      tr.addEventListener('contextmenu', ouvrirMenu);
      tr.querySelector('[data-imposer]').addEventListener('click', ouvrirMenu);
    });
    // Parcours
    const btnEnr = corps.querySelector('[data-enregistrer]');
    const modele = creerCombo({ options: this.modeles.filter((m) => m.actif).map((m) => ({ valeur: m.id, libelle: m.libelle, detail: m.code })), valeur: d.modele ?? '', vide: true });
    corps.querySelector('[data-modele]').append(modele);
    const controler = editerEtapes(corps.querySelector('[data-etapes]'), etapes, optionsServices(d.services), { change: () => { modifie = true; btnEnr.disabled = false; } });
    this.#modifie = () => modifie;
    const enregistrer = async (saisie) => {
      try { this.#rendre(await api.execution.enregistrerParcours('chantier', this.params.id, saisie)); } catch (x) { this.app.erreur(x); }
    };
    corps.querySelector('[data-appliquer]').addEventListener('click', async () => {
      if (!modele.valeurCombo) return;
      if (etapes.length && !await confirmer('Remplacer les étapes du parcours par celles du modèle ?')) return;
      enregistrer({ pam_id: Number(modele.valeurCombo) });
    });
    btnEnr.addEventListener('click', () => {
      if (controler().length) { this.app.erreur(new Error('Parcours incomplet : voir les contrôles sous le tableau.')); return; }
      enregistrer({ pam_id: d.modele ?? null, etapes });
    });
    corps.querySelector('[data-retirer-parcours]').addEventListener('click', async () => { if (await confirmer('Retirer le parcours de ce chantier ?')) enregistrer({ etapes: [] }); });
    corps.querySelector('[data-theorique]')?.addEventListener('click', async () => {
      const debut = await saisir('Début du planning théorique (AAAA-MM-JJ) :', new Date(Date.now() + 86400000).toISOString().slice(0, 10));
      if (!debut) return;
      try {
        const r = await api.liaisons.planningTheorique(this.params.id, `${debut}T08:00`);
        this.app.message(`${r.taches.length} tâche(s) créée(s) au planning`, 'succes');
        this.app.naviguer(`/planning?vue=CHANTIERS_GANTT&du=${debut}`);
      } catch (e) { this.app.erreur(e); }
    });
    // Ordres par service
    const groupes = new Map();
    for (const o of d.ordres) {
      const k = o.srv_id ?? 0;
      if (!groupes.has(k)) groupes.set(k, []);
      groupes.get(k).push(o);
    }
    corps.querySelector('[data-ordres]').innerHTML = d.ordres.length ? [...groupes].map(([k, l]) => `<h3>${echapper(services.get(k)?.libelle ?? 'Sans service')}</h3>
      <table><thead><tr><th>Numéro</th><th>Type</th><th>Objet</th><th>Statut</th><th>État</th><th>Fin prévue</th></tr></thead><tbody>
      ${l.map((o) => `<tr${o.en_retard ? ' class="en-retard"' : ''}><td><a href="${echapper(o.url)}">${echapper(o.numero ?? `#${o.ent_id}`)}</a></td><td>${echapper(o.type_libelle ?? o.type_ordre)}</td>
        <td>${echapper(o.objet ?? '')}</td><td>${echapper(o.statut_libelle ?? o.statut)}</td>
        <td>${echapper(o.etat ?? '')}${o.motif ? ` <span class="aide">(${echapper(o.motif)})</span>` : ''}</td><td>${date(o.fin_prevue)}${o.en_retard ? ' ⏰' : ''}</td></tr>`).join('')}</tbody></table>`).join('')
      : '<p class="aide">Aucun ordre.</p>';
  }
}

/** Modèles de parcours (paramétrage, administrateur) : étapes, services, types d'ordre, dépendances. */
export class PageParametresExecution extends PageBase {
  icone = '🧭';
  #modifie = () => false;

  get modifiee() { return this.#modifie(); }

  async ouvrir() {
    this.titre = 'Modèles de parcours';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">🧭 Modèles de parcours (exécution)</h1>
      <p class="aide">Un parcours enchaîne les services d'un chantier (études, fabrication, livraison, pose…) ; une étape démarre quand ses étapes amont sont terminées.</p><div data-corps></div>
      <h2>Catalogue des états</h2><div data-catalogue></div>
      <h2>États des types d'ordres</h2><div data-types></div></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    const admin = this.app.estAdmin();
    const [modeles, services] = await Promise.all([api.execution.modeles(), api.services()]);
    const zCatalogue = this.conteneur.querySelector('[data-catalogue]');
    const zTypes = this.conteneur.querySelector('[data-types]');
    await rendreCatalogueEtats(zCatalogue, { app: this.app, services, apres: () => rendreEtatsTypes(zTypes, { app: this.app }) });
    await rendreEtatsTypes(zTypes, { app: this.app });
    let courant = modeles[0] ?? null;
    let modifie = false;
    this.#modifie = () => modifie;
    const rendre = () => {
      corps.innerHTML = `<p class="ligne">${modeles.map((m, i) => `<button type="button" data-m="${i}" class="${m === courant ? 'actif' : ''}">${echapper(m.libelle || m.code || '(nouveau)')}${m.actif ? '' : ' (inactif)'}</button>`).join(' ')}
        ${admin ? '<button type="button" data-nouveau>＋ Modèle</button>' : ''}</p>
        ${courant ? `<p class="ligne"><label>Code <input data-code size="12" value="${echapper(courant.code)}" ${admin && !courant.id ? '' : 'readonly'}></label>
          <label>Libellé <input data-libelle size="40" value="${echapper(courant.libelle)}" ${admin ? '' : 'readonly'}></label>
          <label><input type="checkbox" data-actif ${courant.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}> Actif</label></p>
          <p><label>Description <input data-description size="80" value="${echapper(courant.description ?? '')}" ${admin ? '' : 'readonly'}></label></p>
          <div data-etapes></div>` : '<p class="aide">Aucun modèle.</p>'}
        ${admin ? '<p><button type="button" data-enregistrer>Enregistrer les modèles</button></p>' : ''}`;
      const changer = () => { modifie = true; };
      corps.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { courant = modeles[Number(b.dataset.m)]; rendre(); }));
      corps.querySelector('[data-nouveau]')?.addEventListener('click', () => {
        modeles.push(courant = { id: null, code: '', libelle: '', description: '', ordre: (modeles.length + 1) * 10, actif: true, etapes: [] }); changer(); rendre();
      });
      if (courant) {
        corps.querySelector('[data-code]').addEventListener('change', (e) => { courant.code = e.target.value.trim().toUpperCase(); changer(); });
        corps.querySelector('[data-libelle]').addEventListener('change', (e) => { courant.libelle = e.target.value; changer(); });
        corps.querySelector('[data-description]').addEventListener('change', (e) => { courant.description = e.target.value; changer(); });
        corps.querySelector('[data-actif]').addEventListener('change', (e) => { courant.actif = e.target.checked; changer(); });
        editerEtapes(corps.querySelector('[data-etapes]'), courant.etapes, optionsServices(services), { lecture: !admin, change: changer });
      }
      corps.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        try {
          const l = await api.execution.enregistrerModeles(modeles);
          modeles.splice(0, modeles.length, ...l);
          courant = modeles.find((m) => m.code === courant?.code) ?? modeles[0] ?? null;
          modifie = false;
          rendre();
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }
}

/**
 * Écran de l'atelier (lot 2e, E53) : étapes à valider des ordres proposés au salarié du compte (ressource principale,
 * équipe, ordres de son service sur ses chantiers du jour) ou d'un ordre lu par son numéro ; composant du module
 * Exécution (`EcranEtapesAtelier`), aussi inséré dans la borne du Pointage.
 */
export class PageAtelierExecution extends PageBase {
  icone = '🧩';

  async ouvrir() {
    this.titre = 'Étapes à valider';
    this.conteneur.innerHTML = '<div class="page-atelier" data-atelier></div>';
    const ecran = new EcranEtapesAtelier(this.conteneur.querySelector('[data-atelier]'), {
      charger: () => api.execution.atelier(),
      valider: (entId, code) => api.execution.validerAtelier(entId, code),
      ordre: async (numero) => (await api.execution.atelier(numero)).ordres[0] ?? null,
    }, { titre: '🧩 Étapes à valider', message: (t, n) => this.app.message(t, n) });
    await ecran.ouvrir();
  }
}
