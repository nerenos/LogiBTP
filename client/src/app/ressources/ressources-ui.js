import { texte, texteHtml, pluriel, iconeHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { pastille } from '../pastilles.js';
import { urlFiche, TYPE_FICHE } from '../codes.js';
import { ajouterJours, aujourdhui } from '@logibtp/socle';
import { echapper, creerCombo, formatNombre, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { reprendreCoutMoyen } from './cout-moyen.js';
import {
  ETATS_HABILITATION, MESSAGES_RESSOURCES, etatHabilitation, controlerHabilitation, controlerMissions, finValidite,
} from './regles.js';
import { TYPES_AFFECTATION, LIBELLES_AFFECTATION, MESSAGES_AFFECTATIONS, controlerAffectations, affectationA, photosAffectation, definirPhoto } from './affectations.js';
import { urlImage } from '../annuaire/photo.js';

// Écrans du référentiel des ressources (db/195) : habilitations d'un salarié ou d'un matériel, missions d'un intérimaire,
// habilitations exigées du conducteur d'un matériel. Enregistrés à part de la fiche (bouton propre), en ligne seulement.

const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const CLASSES = { VALIDE: 'ok', A_RENOUVELER: 'attention', EXPIREE: 'erreur', NON_ACQUISE: 'neutre' };

/** Pastille de l'état d'une habilitation (avec les jours restants). */
export function pastilleHabilitation(e) {
  const jours = e.jours_restants === null || e.jours_restants === undefined ? '' : e.jours_restants >= 0 ? ` · ${texte('ressources_btp.habilitations.jours', { nombre: e.jours_restants })}` : ` · ${texte('ressources_btp.habilitations.depuis', { nombre: -e.jours_restants })}`;
  return pastille(`${ETATS_HABILITATION[e.etat] ?? e.etat}${jours}`, CLASSES[e.etat] ?? 'neutre');
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
const action = (attr, symbole, titre) => `<button type="button" class="bouton-icone" ${attr} title="${echapper(titre)}" aria-label="${echapper(titre)}">${iconeHtml(symbole)}</button>`;

/**
 * Habilitations d'un salarié ou d'un matériel : tableau éditable (type, obtention, fin de validité — calculée depuis la
 * durée du type si vide —, numéro, organisme, commentaire), état recalculé à la saisie, enregistrement par l'API.
 */
export async function rendreHabilitations(corps, { app, element, id, titre = texte('ressources_btp.habilitations.titre') }) {
  const [{ liste: types, index }, lignes] = await Promise.all([typesHabilitation(), api.ressources.habilitations(element, id)]);
  const concerne = element === TYPE_FICHE.MATERIEL ? 'MATERIEL' : 'SALARIE';
  const options = types.filter((t) => t.actif && (t.concerne === concerne || t.concerne === 'LES_DEUX')).map((t) => ({ valeur: t.code, libelle: t.libelle, detail: t.code }));
  let saisie = lignes.map((h) => ({ ...h }));
  let modifiee = false;
  const rendre = () => {
    // Présentation commune des tableaux de saisie (tableau compact, actions sur la ligne de titre, boutons en icônes).
    corps.innerHTML = `<div class="ressources-habilitations"><div class="titre-actions"><h3>${echapper(titre)}</h3>
        <span class="titre-actions-boutons">${action('data-ajouter', 'ajouter', texte('ressources_btp.habilitations.ajouter'))}
          <button type="button" class="principal" data-enregistrer ${modifiee ? '' : 'disabled'}>${texteHtml('commun.enregistrer')}</button></span></div>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('ressources_btp.habilitations.colonnes.type')}</th><th>${texteHtml('ressources_btp.habilitations.colonnes.obtenue')}</th><th>${texteHtml('ressources_btp.habilitations.colonnes.fin')}</th><th>${texteHtml('ressources_btp.habilitations.colonnes.etat')}</th><th>${texteHtml('ressources_btp.habilitations.colonnes.numero')}</th><th>${texteHtml('ressources_btp.habilitations.colonnes.organisme')}</th><th>${texteHtml('ressources_btp.colonnes.commentaire')}</th><th></th></tr></thead><tbody>
      ${saisie.map((h, i) => {
        const e = etatHabilitation(h, index[h.code]?.duree_mois ?? null, aujourdhui());
        const calc = !h.valide_jusqu_au && e.fin;
        return `<tr data-i="${i}"><td data-type></td>
          <td><input type="date" data-c="obtenue_le" value="${echapper(h.obtenue_le ?? '')}"></td>
          <td><input type="date" data-c="valide_jusqu_au" value="${echapper(h.valide_jusqu_au ?? '')}" title="${texteHtml('ressources_btp.habilitations.fin_aide')}">${calc ? `<div><small>${texteHtml('ressources_btp.habilitations.calculee', { date: jour(e.fin) })}</small></div>` : ''}</td>
          <td>${h.code ? pastilleHabilitation(e) : ''}</td>
          <td><input data-c="numero" value="${echapper(h.numero ?? '')}" size="10" maxlength="60"></td>
          <td><input data-c="organisme" value="${echapper(h.organisme ?? '')}" size="14" maxlength="120"></td>
          <td><input data-c="commentaire" value="${echapper(h.commentaire ?? '')}" size="28"></td>
          <td class="cellule-boutons">${action('data-retirer', 'retirer', texte('ressources_btp.habilitations.retirer'))}</td></tr>`;
      }).join('') || `<tr><td colspan="8" class="aide">${texteHtml('ressources_btp.habilitations.aucune')}</td></tr>`}</tbody></table>
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
      if (fautes.length) { erreur.textContent = fautes.map((f) => texte('ressources_btp.habilitations.faute', { n: f.i + 1, messages: messages(f.codes) })).join(' · '); erreur.hidden = false; return; }
      try {
        saisie = (await api.ressources.enregistrerHabilitations(element, id, saisie)).map((h) => ({ ...h }));
        modifiee = false;
        app.message(texte('ressources_btp.habilitations.enregistrees'), 'succes');
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
  corps.innerHTML = `<div class="ressources-exigees"><h3>${texteHtml('ressources_btp.exigees.titre')}</h3>
    <p class="aide">${texteHtml('ressources_btp.exigees.aide')}</p>
    <p>${types.filter((t) => t.actif && t.concerne !== 'MATERIEL').map((t) => `<label class="ligne"><input type="checkbox" value="${echapper(t.code)}" ${choix.has(t.code) ? 'checked' : ''}> ${echapper(t.libelle)}</label>`).join(' ')}</p>
    <p><button type="button" data-enregistrer>${texteHtml('ressources_btp.exigees.enregistrer')}</button></p></div>`;
  corps.querySelector('[data-enregistrer]').addEventListener('click', async () => {
    const codes = [...corps.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
    try { await api.ressources.enregistrerExigeesMateriel(materiel, codes); app.message(texte('ressources_btp.exigees.enregistrees'), 'succes'); } catch (e) { app.erreur(e); }
  });
}

/**
 * Missions d'un intérimaire : agence (tiers « intérim » de l'annuaire), période, taux horaire facturé, commentaire ;
 * la mission en cours est marquée ; contrôles du jeu partagé avant l'envoi.
 */
export async function rendreMissions(corps, { app, salarie, annuaire }) {
  const [missions, agences] = await Promise.all([api.ressources.missions(salarie), annuaire.rechercherPersonnes({ recherche: '', casquette: 'INTERIM', limite: 200 }).catch(() => [])]);
  const options = agences.map((a) => ({ valeur: a.id, libelle: a.raison_sociale, detail: a.ville ?? '' }));
  for (const m of missions) if (m.agence_id && !options.some((o) => Number(o.valeur) === Number(m.agence_id))) options.push({ valeur: m.agence_id, libelle: m.agence ?? texte('ressources_btp.missions.tiers', { id: m.agence_id }) });
  let saisie = missions.map((m) => ({ ...m }));
  let modifiee = false;
  const rendre = () => {
    corps.innerHTML = `<div class="ressources-missions"><div class="titre-actions"><h3>${texteHtml('ressources_btp.missions.titre')}</h3>
        <span class="titre-actions-boutons">${action('data-ajouter', 'ajouter', texte('ressources_btp.missions.ajouter'))}
          <button type="button" class="principal" data-enregistrer ${modifiee ? '' : 'disabled'}>${texteHtml('commun.enregistrer')}</button></span></div>
      <p class="aide">${texteHtml('ressources_btp.missions.aide')}</p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('ressources_btp.missions.colonnes.agence')}</th><th>${texteHtml('ressources_btp.missions.colonnes.debut')}</th><th>${texteHtml('ressources_btp.missions.colonnes.fin')}</th><th>${texteHtml('ressources_btp.missions.colonnes.taux_html')}</th><th>${texteHtml('ressources_btp.colonnes.commentaire')}</th><th></th><th></th></tr></thead><tbody>
      ${saisie.map((m, i) => `<tr data-i="${i}"><td data-agence></td>
        <td><input type="date" data-c="debut" value="${echapper(m.debut ?? '')}"></td><td><input type="date" data-c="fin" value="${echapper(m.fin ?? '')}"></td>
        <td><input data-c="taux_horaire" class="nombre" value="${formatNombre(m.taux_horaire, 2)}" size="8" inputmode="decimal"></td>
        <td><input data-c="commentaire" value="${echapper(m.commentaire ?? '')}" size="28"></td>
        <td>${m.en_cours ? `<span class="pastille-compte ok">${texteHtml('ressources_btp.en_cours')}</span>` : ''}</td>
        <td class="cellule-boutons">${action('data-retirer', 'retirer', texte('ressources_btp.missions.retirer'))}</td></tr>`).join('') || `<tr><td colspan="7" class="aide">${texteHtml('ressources_btp.missions.aucune')}</td></tr>`}</tbody></table>
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
      if (fautes.length) { erreur.textContent = fautes.map((f) => texte('ressources_btp.missions.faute', { n: f.index + 1, messages: messages(f.codes) })).join(' · '); erreur.hidden = false; return; }
      try {
        saisie = (await api.ressources.enregistrerMissions(salarie, saisie)).map((m) => ({ ...m }));
        modifiee = false;
        app.message(texte('ressources_btp.missions.enregistrees'), 'succes');
        rendre();
      } catch (e) { erreur.textContent = e.message; erreur.hidden = false; }
    });
  };
  rendre();
}

/**
 * Affectations d'un matériel (lot 5b, db/231) : historique saisi en tableau (type, ressource, du, au, commentaire),
 * affectation en cours signalée, contrôles du jeu partagé avant l'envoi (affectations.js ↔ ReglesAffectations.cs).
 * Condition du matériel (db/252) : au départ (celle du matériel, affichée) et au retour (obligatoire pour terminer
 * l'affectation d'un matériel identifié ; endommagé ou hors service : événement et notification).
 */
export async function rendreAffectations(corps, { app, materiel, identifie = false, ged = null, utilisateur = null }) {
  const [historique, cibles, conditions] = await Promise.all([api.ressources.affectations(materiel), api.ressources.ciblesAffectation(),
    api.listesValeurs.lire('ETAT_MATERIEL').catch(() => [])]);
  const libelleCondition = (c) => conditions.find((x) => x.code === c)?.libelle ?? c ?? '';
  const optionsConditions = conditions.filter((c) => c.actif).map((c) => ({ valeur: c.code, libelle: c.libelle }));
  const options = (type) => cibles.filter((c) => c.type === type && !(type === 'MATERIEL' && String(c.id) === String(materiel))).map((c) => ({ valeur: c.id, libelle: c.libelle }));
  let saisie = historique.map((a) => ({ ...a }));
  let modifiee = false;
  // Photos de l'état au départ et au retour (db/279) : vignettes des documents de la GED du matériel, lues une fois.
  const urls = new Map();
  const chargerUrls = () => Promise.all(saisie.flatMap((a) => photosAffectation(a)).filter((p) => p.id && !urls.has(p.id))
    .map(async (p) => urls.set(p.id, await urlImage(ged, p.id))));
  await chargerUrls();
  const cellulePhoto = (a, sens) => {
    const p = photosAffectation(a).find((x) => x.sens === sens);
    const url = p.id ? urls.get(p.id) : null;
    const titre = texte(`ressources_btp.affectations.photo.${sens}`);
    return `${url ? `<a href="${echapper(url)}" target="_blank" rel="noopener" title="${echapper(titre)}"><img class="element-vignette" src="${echapper(url)}" alt="${echapper(titre)}"></a>` : ''}
      ${ged && p.deposable ? action(`data-photo="${sens}"`, 'ressources_btp_photo', texte(`ressources_btp.affectations.photo.${p.id ? 'remplacer' : 'ajouter'}`, { sens: titre })) : ''}`;
  };
  const rendre = () => {
    const encours = affectationA(saisie, aujourdhui());
    corps.innerHTML = `<div class="ressources-affectations"><div class="titre-actions"><h3>${texteHtml('ressources_btp.affectations.titre')}</h3>
        <span class="titre-actions-boutons">${action('data-ajouter', 'ajouter', texte('ressources_btp.affectations.ajouter'))}
          <button type="button" class="principal" data-enregistrer ${modifiee ? '' : 'disabled'}>${texteHtml('commun.enregistrer')}</button></span></div>
      <p class="aide">${texteHtml('ressources_btp.affectations.aide')}</p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('ressources_btp.affectations.colonnes.type')}</th><th>${texteHtml('ressources_btp.affectations.colonnes.ressource')}</th><th>${texteHtml('ressources_btp.colonnes.du')}</th><th>${texteHtml('ressources_btp.colonnes.au')}</th><th>${texteHtml('ressources_btp.affectations.colonnes.depart')}</th><th>${texteHtml('ressources_btp.affectations.colonnes.retour')}</th><th>${texteHtml('ressources_btp.affectations.colonnes.photo_depart')}</th><th>${texteHtml('ressources_btp.affectations.colonnes.photo_retour')}</th><th>${texteHtml('ressources_btp.colonnes.commentaire')}</th><th></th><th></th></tr></thead><tbody>
      ${saisie.map((a, i) => `<tr data-i="${i}"><td data-type></td><td data-ressource></td>
        <td><input type="date" data-c="du" value="${echapper(a.du ?? '')}"></td><td><input type="date" data-c="au" value="${echapper(a.au ?? '')}"></td>
        <td>${echapper(libelleCondition(a.depart))}</td><td data-retour></td>
        <td>${cellulePhoto(a, 'depart')}</td><td>${cellulePhoto(a, 'retour')}</td>
        <td><input data-c="commentaire" value="${echapper(a.commentaire ?? '')}" size="28" maxlength="200"></td>
        <td>${i === encours ? `<span class="pastille-compte ok">${texteHtml('ressources_btp.en_cours')}</span>` : ''}</td>
        <td class="cellule-boutons">${action('data-retirer', 'retirer', texte('ressources_btp.affectations.retirer'))}</td></tr>`).join('') || `<tr><td colspan="11" class="aide">${texteHtml('ressources_btp.affectations.aucune')}</td></tr>`}</tbody></table>
      <p class="connexion-erreur" data-erreur hidden></p></div>`;
    corps.querySelectorAll('tr[data-i]').forEach((tr) => {
      const a = saisie[Number(tr.dataset.i)];
      const type = creerCombo({ options: TYPES_AFFECTATION.map((t) => ({ valeur: t, libelle: LIBELLES_AFFECTATION[t] })), valeur: a.type, vide: false });
      type.addEventListener('change', () => { a.type = type.valeurCombo; a.ressource = null; modifiee = true; rendre(); });
      tr.querySelector('[data-type]').append(type);
      const ressource = creerCombo({ options: options(a.type), valeur: a.ressource ?? '', vide: true });
      ressource.addEventListener('change', () => { a.ressource = ressource.valeurCombo || null; modifiee = true; corps.querySelector('[data-enregistrer]').disabled = false; });
      tr.querySelector('[data-ressource]').append(ressource);
      // État au retour : saisi dès que l'affectation a une fin (obligatoire pour un matériel identifié).
      if (a.au) {
        const retour = creerCombo({ options: optionsConditions, valeur: a.retour ?? '', vide: true });
        retour.title = texte(`ressources_btp.affectations.retour_${identifie && a.retour_requis !== false ? 'obligatoire' : 'facultatif'}`);
        retour.addEventListener('change', () => { a.retour = retour.valeurCombo || null; modifiee = true; corps.querySelector('[data-enregistrer]').disabled = false; });
        tr.querySelector('[data-retour]').append(retour);
      }
      // Dépôt d'une photo dans la GED du matériel, rattachée à l'affectation à l'enregistrement.
      tr.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => {
        const entree = document.createElement('input');
        entree.type = 'file';
        entree.accept = 'image/*';
        entree.addEventListener('change', async () => {
          const fichier = entree.files[0];
          if (!fichier) return;
          try {
            const d = await ged.deposer({ fichier, meta: {
              titre: texte(`ressources_btp.affectations.photo.titre_${b.dataset.photo}`, { du: jour(a.du) }), categorie: 'photo', type_element: TYPE_FICHE.MATERIEL,
              id_element: String(materiel), date_document: aujourdhui(), auteur: utilisateur } });
            definirPhoto(a, b.dataset.photo, Number(d.id));
            await chargerUrls();
            modifiee = true;
            rendre();
          } catch (e) { app.erreur(e); }
        });
        entree.click();
      }));
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
      const fautes = controlerAffectations(materiel, saisie.map((a) => ({ type: a.type, id: a.ressource, du: a.du, au: a.au, retour: a.retour, retour_requis: a.retour_requis })), { identifie });
      if (fautes.length) { erreur.textContent = fautes.map((f) => texte('ressources_btp.affectations.faute', { n: f.affectation + 1, message: MESSAGES_AFFECTATIONS[f.code] ?? f.code })).join(' · '); erreur.hidden = false; return; }
      try {
        saisie = (await api.ressources.enregistrerAffectations(materiel, saisie)).map((a) => ({ ...a }));
        modifiee = false;
        app.message(texte('ressources_btp.affectations.enregistrees'), 'succes');
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
  const lien = (m) => `<a href="${urlFiche(TYPE_FICHE.MATERIEL, m.id)}">${iconeHtml('ressources_btp_materiel')} ${echapper(m.code)} ${echapper(m.designation ?? '')}</a>`;
  corps.innerHTML = `<div class="ressources-materiel-affecte"><h3>${texteHtml('ressources_btp.materiel_affecte.titre')}</h3>
    ${d.courant.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('ressources_btp.materiel_affecte.colonnes.materiel')}</th><th>${texteHtml('ressources_btp.materiel_affecte.colonnes.type')}</th><th>${texteHtml('ressources_btp.materiel_affecte.colonnes.immatriculation')}</th><th>${texteHtml('ressources_btp.materiel_affecte.colonnes.depuis')}</th><th>${texteHtml('ressources_btp.materiel_affecte.colonnes.par')}</th></tr></thead><tbody>
      ${d.courant.map((m) => `<tr><td>${'&nbsp;&nbsp;'.repeat(m.niveau)}${lien(m)}</td><td>${echapper(m.type ?? '')}</td><td>${echapper(m.immatriculation ?? '')}</td>
        <td>${jour(m.du)}</td><td>${m.via ? texteHtml('ressources_btp.materiel_affecte.porte', { via: m.via }) : texteHtml('ressources_btp.materiel_affecte.direct')}</td></tr>`).join('')}</tbody></table>` : `<p class="aide">${texteHtml('ressources_btp.materiel_affecte.aucun')}</p>`}
    ${d.historique.length ? `<h3>${texteHtml('ressources_btp.materiel_affecte.passees')}</h3><table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('ressources_btp.materiel_affecte.colonnes.materiel')}</th><th>${texteHtml('ressources_btp.colonnes.du')}</th><th>${texteHtml('ressources_btp.colonnes.au')}</th></tr></thead><tbody>
      ${d.historique.map((m) => `<tr><td>${lien(m)}</td><td>${jour(m.du)}</td><td>${jour(m.au)}</td></tr>`).join('')}</tbody></table>` : ''}</div>`;
}

const LIBELLES_COUT = textesParCode('ressources_btp.couts.natures', ['MO', 'STOCK', 'ACHAT', 'SOUS_TRAITANCE', 'CARBURANT', 'TOTAL']);

/**
 * Coûts d'un matériel (lot 5c-1, db/232) : chantier de suivi (créé à la demande ; partagé par les matériels gérés par
 * nombre d'un même type), coûts par mois et nature de l'année choisie (main-d'œuvre pointée, pièces sorties du stock,
 * achats, sous-traitance), totaux de l'année et depuis l'entrée, coût par heure d'utilisation ; listes filtrées.
 */
export async function rendreCoutsMateriel(corps, { app, materiel }) {
  const montant = (v) => (Number(v) ? formatNombre(v, 2) : '');
  const rendre = (d) => {
    if (!d.chantier) {
      corps.innerHTML = `<div class="ressources-couts"><div class="titre-actions"><h3>${texteHtml('ressources_btp.couts.titre')}</h3></div>
        <p class="aide">${texteHtml('ressources_btp.couts.aucun')}</p>
        <button type="button" class="principal" data-creer>${texteHtml('ressources_btp.couts.creer')}</button></div>`;
      corps.querySelector('[data-creer]').addEventListener('click', async () => {
        try { rendre(await api.ressources.creerChantierMateriel(materiel)); app.message(texte('ressources_btp.couts.cree'), 'succes'); } catch (e) { app.erreur(e); }
      });
      return;
    }
    const c = d.chantier;
    const colonnes = [...d.natures, 'TOTAL'];
    const ligne = (titre, t, heures, classe = '') => `<tr class="${classe}"><td>${titre}</td>
      <td class="nombre">${Number(heures) ? formatNombre(heures, 2) : ''}</td>${colonnes.map((n) => `<td class="nombre">${montant(t[n])}</td>`).join('')}</tr>`;
    const filtre = encodeURIComponent(c.code);
    corps.innerHTML = `<div class="ressources-couts"><div class="titre-actions"><h3>${texteHtml('ressources_btp.couts.titre')}</h3>
        <span class="titre-actions-boutons"><span data-annee></span></span></div>
      <p>${texteHtml('ressources_btp.couts.chantier')} <a href="${urlFiche(TYPE_FICHE.CHANTIER, c.id)}">${echapper(c.code)}</a> ${echapper(c.libelle)}
        ${c.statut === 'OUVERT' ? '' : `<span class="pastille-compte neutre">${texteHtml('ressources_btp.couts.clos')}</span>`}
        ${c.partage ? `<span class="aide">${texteHtml('ressources_btp.couts.partage', { nombre: c.materiels })}</span>` : ''}
        · <a href="/liste/documents?chantier=${filtre}">${texteHtml('ressources_btp.couts.documents')}</a> · <a href="/liste/pointages?chantier=${filtre}">${texteHtml('ressources_btp.couts.pointages')}</a></p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('ressources_btp.couts.colonnes.mois')}</th><th>${texteHtml('ressources_btp.couts.colonnes.heures')}</th>${colonnes.map((n) => `<th>${echapper(LIBELLES_COUT[n] ?? n)}</th>`).join('')}</tr></thead><tbody>
      ${d.mois.map((m, i) => ligne(texteHtml(`ressources_btp.couts.mois.${i + 1}`), m.montants, m.heures_mo)).join('')}</tbody><tfoot>
      ${ligne(texteHtml('ressources_btp.couts.annee', { annee: d.annee }), d.total_annee, d.heures_mo_annee, 'total')}
      ${ligne(`${texteHtml('ressources_btp.couts.depuis_entree')}${d.date_entree ? ` (${jour(d.date_entree)})` : ''}`, d.total_depuis_entree, null, 'total')}</tfoot></table>
      <p>${d.cout_par_heure != null ? texteHtml('ressources_btp.couts.par_heure_html', { cout: formatNombre(d.cout_par_heure, 2), heures: formatNombre(d.heures, 0) })
        : `<span class="aide">${texteHtml(c.partage ? 'ressources_btp.couts.par_heure_partage' : 'ressources_btp.couts.par_heure_inconnu')}</span>`}
        ${d.cout_par_heure != null ? `<button type="button" data-reprendre>${texteHtml('ressources_btp.couts.reprendre')}</button>` : ''}
        ${Number(d.non_valorises) ? ` <span class="pastille-compte attention">${pluriel('ressources_btp.couts.non_valorises', d.non_valorises)}</span>` : ''}</p></div>`;
    corps.querySelector('[data-reprendre]')?.addEventListener('click', async () => {
      try {
        const cout = formatNombre(d.cout_par_heure, 2);
        if (await reprendreCoutMoyen({ confirmer, reprendre: () => api.ressources.reprendreCoutMoyen(materiel), message: texte('ressources_btp.couts.reprendre_confirmer', { cout }) })) {
          app.message(texte('ressources_btp.couts.repris', { cout }), 'succes');
        }
      } catch (e) { app.erreur(e); }
    });
    const annee = creerCombo({ options: d.annees.map((a) => ({ valeur: a, libelle: String(a) })), valeur: d.annee, vide: false });
    annee.addEventListener('change', async () => {
      try { rendre(await api.ressources.coutsMateriel(materiel, annee.valeurCombo)); } catch (e) { app.erreur(e); }
    });
    corps.querySelector('[data-annee]').append(annee);
  };
  rendre(await api.ressources.coutsMateriel(materiel));
}

export { finValidite, jour as jourRessource };

const SOURCES_ETAT = textesParCode('ressources_btp.etats.sources', ['CREATION', 'FICHE', 'AFFECTATION', 'REPRISE']);
const DISPONIBILITES = textesParCode('ressources_btp.etats.disponibilites', ['DISPO', 'CHANTIER', 'PANNE', 'REBUT']);

/** Onglet Historique de la fiche matériel (db/252) : disponibilité et condition datées, motif, origine, auteur. */
export async function rendreEtatsMateriel(corps, { materiel }) {
  const l = await api.ressources.etatsMateriel(materiel);
  const heure = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  corps.innerHTML = `<div class="ressources-etats"><h3>${texteHtml('ressources_btp.etats.titre')}</h3>
    <p class="aide">${texteHtml('ressources_btp.etats.aide')}</p>
    <table class="tableau-compact largeur-contenu"><thead><tr>${['date', 'disponibilite', 'condition', 'motif', 'origine', 'par'].map((c) => `<th>${texteHtml(`ressources_btp.etats.colonnes.${c}`)}</th>`).join('')}</tr></thead><tbody>
    ${l.map((e) => `<tr><td>${heure(e.le)}</td><td>${echapper(DISPONIBILITES[e.etat] ?? e.etat)}</td><td>${echapper(e.condition_libelle ?? e.condition)}</td>
      <td>${echapper(e.motif ?? '')}</td><td>${echapper(SOURCES_ETAT[e.source] ?? e.source)}</td><td>${echapper(e.par ?? '')}</td></tr>`).join('')
      || `<tr><td colspan="6" class="aide">${texteHtml('ressources_btp.etats.aucun')}</td></tr>`}</tbody></table></div>`;
}
