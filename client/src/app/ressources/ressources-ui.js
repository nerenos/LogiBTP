import { echapper, creerCombo, formatNombre } from '@logibtp/socle/ui';
import { api } from '../api.js';
import {
  ETATS_HABILITATION, MESSAGES_RESSOURCES, etatHabilitation, controlerHabilitation, controlerMissions, finValidite,
} from './regles.js';

// Écrans du référentiel des ressources (db/195) : habilitations d'un salarié ou d'un matériel, missions d'un intérimaire,
// habilitations exigées du conducteur d'un matériel. Enregistrés à part de la fiche (bouton propre), en ligne seulement.

const aujourdhui = () => new Date().toISOString().slice(0, 10);
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

/**
 * Habilitations d'un salarié ou d'un matériel : tableau éditable (type, obtention, fin de validité — calculée depuis la
 * durée du type si vide —, numéro, organisme, commentaire), état recalculé à la saisie, enregistrement par l'API.
 */
export async function rendreHabilitations(corps, { app, element, id, titre = 'Habilitations' }) {
  if (!app.enLigne) { corps.innerHTML = '<p class="aide">Habilitations : en ligne seulement.</p>'; return; }
  const [{ liste: types, index }, lignes] = await Promise.all([typesHabilitation(), api.ressources.habilitations(element, id)]);
  const concerne = element === 'materiel' ? 'MATERIEL' : 'SALARIE';
  const options = types.filter((t) => t.actif && (t.concerne === concerne || t.concerne === 'LES_DEUX')).map((t) => ({ valeur: t.code, libelle: t.libelle, detail: t.code }));
  let saisie = lignes.map((h) => ({ ...h }));
  let modifiee = false;
  const rendre = () => {
    corps.innerHTML = `<div class="ressources-habilitations"><h3>${echapper(titre)}</h3>
      <table><thead><tr><th>Type</th><th>Obtenue le</th><th>Fin de validité</th><th>État</th><th>N°</th><th>Organisme</th><th>Commentaire</th><th></th></tr></thead><tbody>
      ${saisie.map((h, i) => {
        const e = etatHabilitation(h, index[h.code]?.duree_mois ?? null, aujourdhui());
        const calc = !h.valide_jusqu_au && e.fin;
        return `<tr data-i="${i}"><td data-type></td>
          <td><input type="date" data-c="obtenue_le" value="${echapper(h.obtenue_le ?? '')}"></td>
          <td><input type="date" data-c="valide_jusqu_au" value="${echapper(h.valide_jusqu_au ?? '')}" title="Vide : calculée depuis la durée du type">${calc ? `<br><small class="aide">calculée : ${jour(e.fin)}</small>` : ''}</td>
          <td>${h.code ? pastilleHabilitation(e) : ''}</td>
          <td><input data-c="numero" value="${echapper(h.numero ?? '')}" size="10" maxlength="60"></td>
          <td><input data-c="organisme" value="${echapper(h.organisme ?? '')}" size="16" maxlength="120"></td>
          <td><input data-c="commentaire" value="${echapper(h.commentaire ?? '')}" size="20"></td>
          <td><button type="button" data-retirer title="Retirer">✕</button></td></tr>`;
      }).join('')}</tbody></table>
      <p class="connexion-erreur" data-erreur hidden></p>
      <p><button type="button" data-ajouter>＋ Habilitation</button> <button type="button" class="principal" data-enregistrer ${modifiee ? '' : 'disabled'}>Enregistrer les habilitations</button></p></div>`;
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
  if (!app.enLigne) return;
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
  if (!app.enLigne) { corps.innerHTML = '<p class="aide">Missions : en ligne seulement.</p>'; return; }
  const [missions, agences] = await Promise.all([api.ressources.missions(salarie), annuaire.rechercherPersonnes({ recherche: '', casquette: 'INTERIM', limite: 200 }).catch(() => [])]);
  const options = agences.map((a) => ({ valeur: a.id, libelle: a.raison_sociale, detail: a.ville ?? '' }));
  for (const m of missions) if (m.agence_id && !options.some((o) => Number(o.valeur) === Number(m.agence_id))) options.push({ valeur: m.agence_id, libelle: m.agence ?? `Tiers ${m.agence_id}` });
  let saisie = missions.map((m) => ({ ...m }));
  let modifiee = false;
  const rendre = () => {
    corps.innerHTML = `<div class="ressources-missions"><h3>Missions d'intérim</h3>
      <p class="aide">Le taux horaire facturé par l'agence sert au coût des chantiers (option du Pointage) et au contrôle des factures d'intérim ;
        la fin de la mission en cours est proposée comme fin de validité du compte de connexion.</p>
      <table><thead><tr><th>Agence</th><th>Début</th><th>Fin</th><th>Taux horaire facturé</th><th>Commentaire</th><th></th><th></th></tr></thead><tbody>
      ${saisie.map((m, i) => `<tr data-i="${i}"><td data-agence></td>
        <td><input type="date" data-c="debut" value="${echapper(m.debut ?? '')}"></td><td><input type="date" data-c="fin" value="${echapper(m.fin ?? '')}"></td>
        <td><input data-c="taux_horaire" value="${m.taux_horaire === null || m.taux_horaire === undefined ? '' : formatNombre(m.taux_horaire, 2)}" size="8" inputmode="decimal"> €</td>
        <td><input data-c="commentaire" value="${echapper(m.commentaire ?? '')}" size="24"></td>
        <td>${m.en_cours ? '<span class="pastille-compte ok">En cours</span>' : ''}</td>
        <td><button type="button" data-retirer title="Retirer">✕</button></td></tr>`).join('')}</tbody></table>
      <p class="connexion-erreur" data-erreur hidden></p>
      <p><button type="button" data-ajouter>＋ Mission</button> <button type="button" class="principal" data-enregistrer ${modifiee ? '' : 'disabled'}>Enregistrer les missions</button></p></div>`;
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

export { finValidite, jour as jourRessource };
