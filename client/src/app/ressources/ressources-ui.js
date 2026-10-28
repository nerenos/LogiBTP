import { urlFiche, TYPE_FICHE } from '../codes.js';
import { ajouterJours, aujourdhui } from '@logibtp/socle';
import { echapper, creerCombo, formatNombre } from '@logibtp/socle/ui';
import { api } from '../api.js';
import {
  ETATS_HABILITATION, MESSAGES_RESSOURCES, etatHabilitation, controlerHabilitation, controlerMissions, finValidite,
} from './regles.js';
import { TYPES_AFFECTATION, LIBELLES_AFFECTATION, MESSAGES_AFFECTATIONS, controlerAffectations, affectationA } from './affectations.js';

// Écrans du référentiel des ressources (db/195) : habilitations d'un salarié ou d'un matériel, missions d'un intérimaire,
// habilitations exigées du conducteur d'un matériel. Enregistrés à part de la fiche (bouton propre), en ligne seulement.

const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const CLASSES = { VALIDE: 'ok', A_RENOUVELER: 'attention', EXPIREE: 'erreur', NON_ACQUISE: 'neutre' };

/** Pastille de l'état d'une habilitation (avec les jours restants). */
export function pastilleHabilitation(e) {
  const jours = e.jours_restants === null || e.jours_restants === undefined ? '' : e.jours_restants >= 0 ? ` · ${e.jours_restants} j` : ` · depuis ${-e.jours_restants} j`;
  return `<span class="pastille-compte ${CLASSES[e.etat] ?? 'neutre'}">${echapper(ETATS_HABILITATION[e.etat] ?? e.etat)}${jours}</span>`;
}

let typesCache = null;
/** Types d'habilitations : liste et index { code: { duree_mois, concerne, actif, libelle } }. */
export async function typesHabilitation({ recharger = false } = {}) {
  if (recharger) typesCache = null;
  typesCache ??= api.ressources.typesHabilitation().then((liste) => ({ liste, index: Object.fromEntries(liste.map((t) => [t.code, t])) }));
  return typesCache;
}

const messages = (codes) => codes.map((c) => MESSAGES_RESSOURCES[c] ?? c).join(', ');
/** Bouton icône (libellé en bulle). */
const action = (attr, icone, titre) => `<button type="button" class="bouton-icone" ${attr} title="${titre}" aria-label="${titre}">${icone}</button>`;

/**
 * Habilitations d'un salarié ou d'un matériel : tableau éditable (type, obtention, fin de validité — calculée depuis la
 * durée du type si vide —, numéro, organisme, commentaire), état recalculé à la saisie, enregistrement par l'API.
 */
export async function rendreHabilitations(corps, { app, element, id, titre = 'Habilitations' }) {
  const [{ liste: types, index }, lignes] = await Promise.all([typesHabilitation(), api.ressources.habilitations(element, id)]);
  const concerne = element === TYPE_FICHE.MATERIEL ? 'MATERIEL' : 'SALARIE';
  const options = types.filter((t) => t.actif && (t.concerne === concerne || t.concerne === 'LES_DEUX')).map((t) => ({ valeur: t.code, libelle: t.libelle, detail: t.code }));
  let saisie = lignes.map((h) => ({ ...h }));
  let modifiee = false;
  const rendre = () => {
    // Présentation commune des tableaux de saisie (tableau compact, actions sur la ligne de titre, boutons en icônes).
    corps.innerHTML = `<div class="ressources-habilitations"><div class="titre-actions"><h3>${echapper(titre)}</h3>
        <span class="titre-actions-boutons">${action('data-ajouter', '＋', 'Ajouter une habilitation')}
          <button type="button" class="principal" data-enregistrer ${modifiee ? '' : 'disabled'}>Enregistrer</button></span></div>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>Type</th><th>Obtenue le</th><th>Fin de validité</th><th>État</th><th>N°</th><th>Organisme</th><th>Commentaire</th><th></th></tr></thead><tbody>
      ${saisie.map((h, i) => {
        const e = etatHabilitation(h, index[h.code]?.duree_mois ?? null, aujourdhui());
        const calc = !h.valide_jusqu_au && e.fin;
        return `<tr data-i="${i}"><td data-type></td>
          <td><input type="date" data-c="obtenue_le" value="${echapper(h.obtenue_le ?? '')}"></td>
          <td><input type="date" data-c="valide_jusqu_au" value="${echapper(h.valide_jusqu_au ?? '')}" title="Vide : calculée depuis la durée du type">${calc ? `<div><small>calculée : ${jour(e.fin)}</small></div>` : ''}</td>
          <td>${h.code ? pastilleHabilitation(e) : ''}</td>
          <td><input data-c="numero" value="${echapper(h.numero ?? '')}" size="10" maxlength="60"></td>
          <td><input data-c="organisme" value="${echapper(h.organisme ?? '')}" size="14" maxlength="120"></td>
          <td><input data-c="commentaire" value="${echapper(h.commentaire ?? '')}" size="28"></td>
          <td class="cellule-boutons">${action('data-retirer', '✕', 'Retirer cette habilitation')}</td></tr>`;
      }).join('') || '<tr><td colspan="8" class="aide">Aucune habilitation.</td></tr>'}</tbody></table>
      <p class="connexion-erreur" data-erreur hidden></p></div>`;
    corps.querySelectorAll('tr[data-i]').forEach((tr) => {
      const h = saisie[Number(tr.dataset.i)];
      const combo = creerCombo({ options, valeur: h.code ?? '', vide: false });
      combo.addEventListener('change', () => { h.code = combo.valeurCombo; modifiee = true; rendre(); });
      tr.querySelector('[data-type]').append(combo);
      tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
        h[c.dataset.c] = c.value || null;
        modifiee = true;
        if (c.type === 'date') rendre(); else corps.querySelector('[data-enregistrer]').disabled = false;
      }));
      tr.querySelector('[data-retirer]').addEventListener('click', () => { saisie.splice(Number(tr.dataset.i), 1); modifiee = true; rendre(); });
    });
    corps.querySelector('[data-ajouter]').addEventListener('click', () => { saisie.push({ code: options[0]?.valeur ?? null, obtenue_le: aujourdhui() }); modifiee = true; rendre(); });
    corps.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      const erreur = corps.querySelector('[data-erreur]');
      const fautes = saisie.map((h, i) => ({ i, codes: controlerHabilitation(h, index, element) })).filter((x) => x.codes.length);
      if (fautes.length) { erreur.textContent = fautes.map((f) => `ligne ${f.i + 1} : ${messages(f.codes)}`).join(' · '); erreur.hidden = false; return; }
      try {
        saisie = (await api.ressources.enregistrerHabilitations(element, id, saisie)).map((h) => ({ ...h }));
        modifiee = false;
        app.message('Habilitations enregistrées', 'succes');
        rendre();
      } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
    });
  };
  rendre();
}

/** Habilitations exigées du conducteur d'un matériel (types concernant un salarié), cochées puis enregistrées. */
export async function rendreHabilitationsExigees(corps, { app, materiel }) {
  const [{ liste: types }, exigees] = await Promise.all([typesHabilitation(), api.ressources.exigeesMateriel(materiel)]);
  const choix = new Set(exigees);
  corps.innerHTML = `<div class="ressources-exigees"><h3>Habilitations exigées du conducteur</h3>
    <p class="aide">Le planning signale l'affectation d'un salarié sans ces habilitations valables à la date de la tâche.</p>
    <p>${types.filter((t) => t.actif && t.concerne !== 'MATERIEL').map((t) => `<label class="ligne"><input type="checkbox" value="${echapper(t.code)}" ${choix.has(t.code) ? 'checked' : ''}> ${echapper(t.libelle)}</label>`).join(' ')}</p>
    <p><button type="button" data-enregistrer>Enregistrer les exigences</button></p></div>`;
  corps.querySelector('[data-enregistrer]').addEventListener('click', async () => {
    const codes = [...corps.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
    try { await api.ressources.enregistrerExigeesMateriel(materiel, codes); app.message('Habilitations exigées enregistrées', 'succes'); } catch (e) { app.erreur(e); }
  });
}

/**
 * Missions d'un intérimaire : agence (tiers « intérim » de l'annuaire), période, taux horaire facturé, commentaire ;
 * la mission en cours est marquée ; contrôles du jeu partagé avant l'envoi.
 */
export async function rendreMissions(corps, { app, salarie, annuaire }) {
  const [missions, agences] = await Promise.all([api.ressources.missions(salarie), annuaire.rechercherPersonnes({ recherche: '', casquette: 'INTERIM', limite: 200 }).catch(() => [])]);
  const options = agences.map((a) => ({ valeur: a.id, libelle: a.raison_sociale, detail: a.ville ?? '' }));
  for (const m of missions) if (m.agence_id && !options.some((o) => Number(o.valeur) === Number(m.agence_id))) options.push({ valeur: m.agence_id, libelle: m.agence ?? `Tiers ${m.agence_id}` });
  let saisie = missions.map((m) => ({ ...m }));
  let modifiee = false;
  const rendre = () => {
    corps.innerHTML = `<div class="ressources-missions"><div class="titre-actions"><h3>Missions d'intérim</h3>
        <span class="titre-actions-boutons">${action('data-ajouter', '＋', 'Ajouter une mission')}
          <button type="button" class="principal" data-enregistrer ${modifiee ? '' : 'disabled'}>Enregistrer</button></span></div>
      <p class="aide">Le taux horaire facturé par l'agence sert au coût des chantiers (option du Pointage) et au contrôle des factures d'intérim ;
        la fin de la mission en cours est proposée comme fin de validité du compte de connexion.</p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>Agence</th><th>Début</th><th>Fin</th><th>Taux horaire<br><small>facturé (€)</small></th><th>Commentaire</th><th></th><th></th></tr></thead><tbody>
      ${saisie.map((m, i) => `<tr data-i="${i}"><td data-agence></td>
        <td><input type="date" data-c="debut" value="${echapper(m.debut ?? '')}"></td><td><input type="date" data-c="fin" value="${echapper(m.fin ?? '')}"></td>
        <td><input data-c="taux_horaire" class="nombre" value="${m.taux_horaire === null || m.taux_horaire === undefined ? '' : formatNombre(m.taux_horaire, 2)}" size="8" inputmode="decimal"></td>
        <td><input data-c="commentaire" value="${echapper(m.commentaire ?? '')}" size="28"></td>
        <td>${m.en_cours ? '<span class="pastille-compte ok">En cours</span>' : ''}</td>
        <td class="cellule-boutons">${action('data-retirer', '✕', 'Retirer cette mission')}</td></tr>`).join('') || '<tr><td colspan="7" class="aide">Aucune mission.</td></tr>'}</tbody></table>
      <p class="connexion-erreur" data-erreur hidden></p></div>`;
    corps.querySelectorAll('tr[data-i]').forEach((tr) => {
      const m = saisie[Number(tr.dataset.i)];
      const combo = creerCombo({ options, valeur: m.agence_id ?? '', vide: true });
      combo.addEventListener('change', () => { m.agence_id = combo.valeurCombo ? Number(combo.valeurCombo) : null; modifiee = true; corps.querySelector('[data-enregistrer]').disabled = false; });
      tr.querySelector('[data-agence]').append(combo);
      tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
        m[c.dataset.c] = c.dataset.c === 'taux_horaire' ? (c.value.trim() ? c.value.replace(/\s/g, '').replace(',', '.') : null) : (c.value || null);
        modifiee = true;
        corps.querySelector('[data-enregistrer]').disabled = false;
      }));
      tr.querySelector('[data-retirer]').addEventListener('click', () => { saisie.splice(Number(tr.dataset.i), 1); modifiee = true; rendre(); });
    });
    corps.querySelector('[data-ajouter]').addEventListener('click', () => {
      const derniere = saisie.at(-1);
      saisie.push({ agence_id: derniere?.agence_id ?? options[0]?.valeur ?? null, debut: aujourdhui(), fin: null, taux_horaire: derniere?.taux_horaire ?? null });
      modifiee = true;
      rendre();
    });
    corps.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      const erreur = corps.querySelector('[data-erreur]');
      const fautes = controlerMissions(saisie);
      if (fautes.length) { erreur.textContent = fautes.map((f) => `mission ${f.index + 1} : ${messages(f.codes)}`).join(' · '); erreur.hidden = false; return; }
      try {
        saisie = (await api.ressources.enregistrerMissions(salarie, saisie)).map((m) => ({ ...m }));
        modifiee = false;
        app.message('Missions enregistrées', 'succes');
        rendre();
      } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
    });
  };
  rendre();
}

/**
 * Affectations d'un matériel (lot 5b, db/231) : historique saisi en tableau (type, ressource, du, au, commentaire),
 * affectation en cours signalée, contrôles du jeu partagé avant l'envoi (affectations.js ↔ ReglesAffectations.cs).
 */
export async function rendreAffectations(corps, { app, materiel }) {
  const [historique, cibles] = await Promise.all([api.ressources.affectations(materiel), api.ressources.ciblesAffectation()]);
  const options = (type) => cibles.filter((c) => c.type === type && !(type === 'MATERIEL' && String(c.id) === String(materiel))).map((c) => ({ valeur: c.id, libelle: c.libelle }));
  let saisie = historique.map((a) => ({ ...a }));
  let modifiee = false;
  const rendre = () => {
    const encours = affectationA(saisie, aujourdhui());
    corps.innerHTML = `<div class="ressources-affectations"><div class="titre-actions"><h3>Affectations</h3>
        <span class="titre-actions-boutons">${action('data-ajouter', '＋', 'Nouvelle affectation (la précédente se termine la veille)')}
          <button type="button" class="principal" data-enregistrer ${modifiee ? '' : 'disabled'}>Enregistrer</button></span></div>
      <p class="aide">Une affectation à la fois : un salarié, un intérimaire, un sous-traitant ou un autre matériel (porteur : le petit outillage d'un camion suit le camion).</p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>Affecté à</th><th>Ressource</th><th>Du</th><th>Au</th><th>Commentaire</th><th></th><th></th></tr></thead><tbody>
      ${saisie.map((a, i) => `<tr data-i="${i}"><td data-type></td><td data-ressource></td>
        <td><input type="date" data-c="du" value="${echapper(a.du ?? '')}"></td><td><input type="date" data-c="au" value="${echapper(a.au ?? '')}"></td>
        <td><input data-c="commentaire" value="${echapper(a.commentaire ?? '')}" size="28" maxlength="200"></td>
        <td>${i === encours ? '<span class="pastille-compte ok">En cours</span>' : ''}</td>
        <td class="cellule-boutons">${action('data-retirer', '✕', 'Retirer cette affectation')}</td></tr>`).join('') || '<tr><td colspan="7" class="aide">Jamais affecté.</td></tr>'}</tbody></table>
      <p class="connexion-erreur" data-erreur hidden></p></div>`;
    corps.querySelectorAll('tr[data-i]').forEach((tr) => {
      const a = saisie[Number(tr.dataset.i)];
      const type = creerCombo({ options: TYPES_AFFECTATION.map((t) => ({ valeur: t, libelle: LIBELLES_AFFECTATION[t] })), valeur: a.type, vide: false });
      type.addEventListener('change', () => { a.type = type.valeurCombo; a.ressource = null; modifiee = true; rendre(); });
      tr.querySelector('[data-type]').append(type);
      const ressource = creerCombo({ options: options(a.type), valeur: a.ressource ?? '', vide: true });
      ressource.addEventListener('change', () => { a.ressource = ressource.valeurCombo || null; modifiee = true; corps.querySelector('[data-enregistrer]').disabled = false; });
      tr.querySelector('[data-ressource]').append(ressource);
      tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => { a[c.dataset.c] = c.value || null; modifiee = true; rendre(); }));
      tr.querySelector('[data-retirer]').addEventListener('click', () => { saisie.splice(Number(tr.dataset.i), 1); modifiee = true; rendre(); });
    });
    corps.querySelector('[data-ajouter]').addEventListener('click', () => {
      const jourCourant = aujourdhui();
      const veille = ajouterJours(aujourdhui(), -1);
      for (const a of saisie) if (!a.au && a.du && a.du < jourCourant) a.au = veille;
      saisie.push({ type: 'SALARIE', ressource: null, du: jourCourant, au: null, commentaire: null });
      modifiee = true;
      rendre();
    });
    corps.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      const erreur = corps.querySelector('[data-erreur]');
      const fautes = controlerAffectations(materiel, saisie.map((a) => ({ type: a.type, id: a.ressource, du: a.du, au: a.au })));
      if (fautes.length) { erreur.textContent = fautes.map((f) => `affectation ${f.affectation + 1} : ${MESSAGES_AFFECTATIONS[f.code] ?? f.code}`).join(' · '); erreur.hidden = false; return; }
      try {
        saisie = (await api.ressources.enregistrerAffectations(materiel, saisie)).map((a) => ({ ...a }));
        modifiee = false;
        app.message('Affectations enregistrées', 'succes');
        rendre();
      } catch (e) { erreur.textContent = MESSAGES_AFFECTATIONS[e.code] ?? e.message; erreur.hidden = false; }
    });
  };
  rendre();
}

/**
 * Matériel affecté à une ressource (salarié, intérimaire) : en cours (directement, ou porté par un matériel qui lui
 * est affecté : petit outillage du camion), EPI immatriculés compris ; puis affectations passées.
 */
export async function rendreMaterielAffecte(corps, { app, type, id }) {
  const d = await api.ressources.materielAffecte(type, id);
  const lien = (m) => `<a href="${urlFiche(TYPE_FICHE.MATERIEL, m.id)}">🚜 ${echapper(m.code)} ${echapper(m.designation ?? '')}</a>`;
  corps.innerHTML = `<div class="ressources-materiel-affecte"><h3>Matériel affecté</h3>
    ${d.courant.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>Matériel</th><th>Type</th><th>Immatriculation</th><th>Depuis</th><th>Par</th></tr></thead><tbody>
      ${d.courant.map((m) => `<tr><td>${'&nbsp;&nbsp;'.repeat(m.niveau)}${lien(m)}</td><td>${echapper(m.type ?? '')}</td><td>${echapper(m.immatriculation ?? '')}</td>
        <td>${jour(m.du)}</td><td>${m.via ? `porté par ${echapper(m.via)}` : 'direct'}</td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucun matériel affecté aujourd\'hui.</p>'}
    ${d.historique.length ? `<h3>Affectations passées</h3><table class="tableau-compact largeur-contenu"><thead><tr><th>Matériel</th><th>Du</th><th>Au</th></tr></thead><tbody>
      ${d.historique.map((m) => `<tr><td>${lien(m)}</td><td>${jour(m.du)}</td><td>${jour(m.au)}</td></tr>`).join('')}</tbody></table>` : ''}</div>`;
}

const LIBELLES_COUT = { MO: 'Main-d\'œuvre', STOCK: 'Pièces du stock', ACHAT: 'Achats', SOUS_TRAITANCE: 'Sous-traitance', CARBURANT: 'Carburant', TOTAL: 'Total' };
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * Coûts d'un matériel (lot 5c-1, db/232) : chantier de suivi (créé à la demande ; partagé par les matériels gérés par
 * nombre d'un même type), coûts par mois et nature de l'année choisie (main-d'œuvre pointée, pièces sorties du stock,
 * achats, sous-traitance), totaux de l'année et depuis l'entrée, coût par heure d'utilisation ; listes filtrées.
 */
export async function rendreCoutsMateriel(corps, { app, materiel }) {
  const montant = (v) => (Number(v) ? formatNombre(v, 2) : '');
  const rendre = (d) => {
    if (!d.chantier) {
      corps.innerHTML = `<div class="ressources-couts"><div class="titre-actions"><h3>Coûts</h3></div>
        <p class="aide">Aucun chantier de suivi : il porte les coûts du matériel (pointages de l'atelier, pièces sorties du stock, achats et factures fournisseur, sous-traitance). Il est créé à la première imputation, ou ici.</p>
        <button type="button" class="principal" data-creer>Créer le chantier de suivi</button></div>`;
      corps.querySelector('[data-creer]').addEventListener('click', async () => {
        try { rendre(await api.ressources.creerChantierMateriel(materiel)); app.message('Chantier de suivi créé', 'succes'); } catch (e) { app.erreur(e); }
      });
      return;
    }
    const c = d.chantier;
    const colonnes = [...d.natures, 'TOTAL'];
    const ligne = (titre, t, heures, classe = '') => `<tr class="${classe}"><td>${titre}</td>
      <td class="nombre">${Number(heures) ? formatNombre(heures, 2) : ''}</td>${colonnes.map((n) => `<td class="nombre">${montant(t[n])}</td>`).join('')}</tr>`;
    const filtre = encodeURIComponent(c.code);
    corps.innerHTML = `<div class="ressources-couts"><div class="titre-actions"><h3>Coûts</h3>
        <span class="titre-actions-boutons"><span data-annee></span></span></div>
      <p>Chantier de suivi <a href="${urlFiche(TYPE_FICHE.CHANTIER, c.id)}">${echapper(c.code)}</a> ${echapper(c.libelle)}
        ${c.statut === 'OUVERT' ? '' : '<span class="pastille-compte neutre">Clos</span>'}
        ${c.partage ? `<span class="aide">— partagé par les ${c.materiels} matériels gérés par nombre de ce type</span>` : ''}
        · <a href="/liste/documents?chantier=${filtre}">Documents</a> · <a href="/liste/pointages?chantier=${filtre}">Pointages</a></p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>Mois</th><th>Heures MO</th>${colonnes.map((n) => `<th>${LIBELLES_COUT[n] ?? n}</th>`).join('')}</tr></thead><tbody>
      ${d.mois.map((m, i) => ligne(MOIS[i], m.montants, m.heures_mo)).join('')}</tbody><tfoot>
      ${ligne(`Année ${d.annee}`, d.total_annee, d.heures_mo_annee, 'total')}
      ${ligne(`Depuis l'entrée${d.date_entree ? ` (${jour(d.date_entree)})` : ''}`, d.total_depuis_entree, null, 'total')}</tfoot></table>
      <p>${d.cout_par_heure != null ? `Coût par heure d'utilisation : <b>${formatNombre(d.cout_par_heure, 2)} €</b> (${formatNombre(d.heures, 0)} h au compteur).`
        : c.partage ? '<span class="aide">Coût par heure : sans objet pour un chantier partagé.</span>' : '<span class="aide">Coût par heure : heures d\'utilisation non renseignées.</span>'}
        ${Number(d.non_valorises) ? ` <span class="pastille-compte attention">${d.non_valorises} mouvement(s) non valorisé(s)</span>` : ''}</p></div>`;
    const annee = creerCombo({ options: d.annees.map((a) => ({ valeur: a, libelle: String(a) })), valeur: d.annee, vide: false });
    annee.addEventListener('change', async () => {
      try { rendre(await api.ressources.coutsMateriel(materiel, annee.valeurCombo)); } catch (e) { app.erreur(e); }
    });
    corps.querySelector('[data-annee]').append(annee);
  };
  rendre(await api.ressources.coutsMateriel(materiel));
}

export { finValidite, jour as jourRessource };
