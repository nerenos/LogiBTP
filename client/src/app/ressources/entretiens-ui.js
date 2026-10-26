import { echapper, creerCombo, formatNombre, ouvrirDialogue } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { ETATS_EXECUTION } from '../execution/execution.js';
import { LIBELLES_UNITE, MESSAGES_COMPTEURS, unitesCompteurs } from './compteurs.js';

// Ordres d'entretien du matériel (lot 5c-3, db/234) : bloc « Matériel entretenu » de l'entête d'un ordre E_ENT
// (matériel, nature, relevé du compteur à l'intervention, enregistrés à part du document, même validé) ; fenêtre de
// création depuis la fiche matériel ; ligne d'ordre dans l'onglet Compteurs.

export const NATURES_ENTRETIEN = { PREVENTIF: 'Préventif', CURATIF: 'Curatif (réparation)', REGLEMENTAIRE: 'Réglementaire' };

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const optionsNature = () => Object.entries(NATURES_ENTRETIEN).map(([valeur, libelle]) => ({ valeur, libelle }));

/** Bloc « Matériel entretenu » de l'entête d'un ordre d'entretien. */
export async function rendreEntretienOrdre(zone, { app, entId }) {
  if (!entId || entId < 0) { zone.innerHTML = '<p class="aide">Enregistrez l\'ordre d\'abord.</p>'; return; }
  let d = await api.ressources.entretien(entId);
  const rendre = () => {
    if (!d.materiel) { zone.innerHTML = '<p class="aide">Ordre sans matériel : créez les ordres d\'entretien depuis la fiche du matériel (onglet Compteurs).</p>'; return; }
    const m = d.materiel;
    const unites = unitesCompteurs(m.compteurs);
    const r = d.releve ?? {};
    zone.innerHTML = `<p><a href="/fiche/materiel/${m.id}">🚜 ${echapper(m.code)} ${echapper(m.designation)}</a>
        <span class="aide">${unites.includes('H') ? `${formatNombre(m.heures ?? 0, 0)} h` : ''} ${unites.includes('KM') && m.kilometres != null ? `· ${formatNombre(m.kilometres, 0)} km` : ''}</span></p>
      <div class="formulaire-compact"><label>Nature <span data-nature></span></label>
      ${unites.length ? `<label>Compteur à l'intervention <input type="date" data-c="date" value="${echapper(r.date ? String(r.date).slice(0, 10) : '')}">
        <span data-unite></span><input type="number" min="0" step="0.1" data-c="valeur" value="${echapper(r.valeur ?? '')}" size="8"></label>
        <label><input type="checkbox" data-c="remise" ${r.remise ? 'checked' : ''}> Remise à zéro</label>` : ''}
      <p class="aide">À la clôture (état Terminé), l'entretien s'inscrit dans l'historique du matériel.</p>
      <div><button type="button" data-enregistrer>Enregistrer</button></div></div>`;
    const nature = creerCombo({ options: optionsNature(), valeur: d.nature ?? '', vide: true });
    zone.querySelector('[data-nature]').append(nature);
    const unite = unites.length ? creerCombo({ options: unites.map((u) => ({ valeur: u, libelle: LIBELLES_UNITE[u] })), valeur: r.unite ?? unites[0], vide: false }) : null;
    if (unite) zone.querySelector('[data-unite]').append(unite);
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      const valeur = zone.querySelector('[data-c="valeur"]')?.value ?? '';
      try {
        d = await api.ressources.enregistrerEntretien(entId, {
          nature: nature.valeurCombo || null,
          releve: valeur === '' ? null : {
            date: zone.querySelector('[data-c="date"]').value || aujourdhui(), unite: unite.valeurCombo, valeur: Number(valeur),
            remise: zone.querySelector('[data-c="remise"]').checked,
          },
        });
        app.message('Entretien enregistré', 'succes');
        rendre();
      } catch (e) { app.erreur(new Error(MESSAGES_COMPTEURS[e.code] ?? e.message)); }
    });
  };
  rendre();
}

/** Fenêtre de création d'un ordre d'entretien : nature, objet, opérations (une par ligne). */
export async function saisirNouvelEntretien(valeurs = {}) {
  return ouvrirDialogue({
    titre: '🔧 Nouvel ordre d\'entretien',
    html: `<div class="formulaire-compact"><label>Nature <span data-nature></span></label>
      <label>Objet <input data-c="objet" maxlength="200" size="40" value="${echapper(valeurs.objet ?? '')}"></label>
      <label>Opérations <textarea data-c="operations" rows="4" cols="40" placeholder="Une opération par ligne">${echapper((valeurs.operations ?? []).join('\n'))}</textarea></label>
      <p class="aide">L'ordre est créé en brouillon sur le chantier de suivi du matériel : ajoutez-y la main-d'œuvre (heures) et les pièces.</p></div>`,
    focus: '[data-c="objet"]',
    construire: (dlg) => { dlg._nature = creerCombo({ options: optionsNature(), valeur: valeurs.nature ?? 'CURATIF', vide: false }); dlg.querySelector('[data-nature]').append(dlg._nature); },
    boutons: [{ libelle: 'Annuler', valeur: null }, {
      libelle: 'Créer', principal: true,
      valeur: (dlg) => ({
        nature: dlg._nature.valeurCombo, objet: dlg.querySelector('[data-c="objet"]').value || null,
        operations: dlg.querySelector('[data-c="operations"]').value.split('\n').map((x) => x.trim()).filter(Boolean), plan: valeurs.plan ?? null,
      }),
    }],
  });
}

/** Crée l'ordre (fenêtre) puis l'ouvre ; rend vrai si un ordre a été créé. */
export async function creerOrdreEntretien(app, materiel, valeurs) {
  const n = await saisirNouvelEntretien(valeurs);
  if (!n) return false;
  try {
    const { ent_id: id } = await api.ressources.creerOrdreEntretien(materiel, n);
    app.naviguer(`/document/${id}`, { nouvelleFenetre: true });
    return true;
  } catch (e) { app.erreur(e); return false; }
}

/** Tableau des ordres d'entretien d'un matériel (onglet Compteurs). */
export function tableauOrdres(ordres) {
  if (!ordres.length) return '<p class="aide">Aucun ordre d\'entretien.</p>';
  return `<table class="tableau-compact largeur-contenu"><thead><tr><th>Ordre</th><th>Date</th><th>Objet</th><th>Nature</th><th>État</th><th>Statut</th></tr></thead><tbody>
    ${ordres.map((o) => `<tr><td><a href="/document/${o.id}">${echapper(o.numero ?? 'Brouillon')}</a></td><td>${jour(o.date)}</td><td>${echapper(o.objet ?? '')}</td>
      <td>${echapper(NATURES_ENTRETIEN[o.nature] ?? '')}</td><td>${o.etat ? `${ETATS_EXECUTION[o.etat]?.icone ?? ''} ${echapper(ETATS_EXECUTION[o.etat]?.libelle ?? o.etat)}` : ''}</td><td>${echapper(o.statut ?? '')}</td></tr>`).join('')}</tbody></table>`;
}
