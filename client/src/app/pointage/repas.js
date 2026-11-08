import { texte, texteHtml, icone, iconeHtml, langue } from '@logibtp/socle/dictionnaire';
import { echapper, ouvrirDialogue } from '@logibtp/socle/ui';

// Repas au restaurant (lot 10 des demandes du 25/10/2026, A29) : choix du restaurant d'un jour (les plus proches du
// chantier d'abord, distance à vol d'oiseau des adresses géocodées), restaurant « non trouvé » saisi par son nom et sa
// ville (créé en tiers provisoire de relation RESTAURANT), « pas de repas » ; section de la saisie de la semaine.
// La règle de paie REPAS en tire l'avantage en nature selon l'agence du salarié.

export const distanceRestaurant = (r) => (r.distance_km == null ? '' : texte('pointage.repas.distance_km', { distance: String(r.distance_km).replace('.', ',') }));

/**
 * Fenêtre de choix : `charger(recherche)` → restaurants [{ id, nom, ville, distance_km, provisoire }], `actuel` (repas du
 * jour ou null), `titre`. Renvoie { restaurant_id } | { nouveau, ville } | { aucun: true } ou null (annulé).
 */
export async function choisirRestaurant({ charger, actuel = null, titre = `${icone('pointage_repas')} ${texte('pointage.repas.titre')}` }) {
  let liste = [];
  return ouvrirDialogue({
    titre,
    html: `<p class="ligne"><input data-recherche placeholder="${texteHtml('pointage.repas.rechercher_court')}" size="28" autocomplete="off"></p>
      <div class="tableau-defilant" style="max-height: 50vh"><table class="tableau-compact"><thead><tr><th>${texteHtml('pointage.repas.restaurant')}</th><th>${texteHtml('pointage.repas.ville_colonne')}</th><th class="nombre">${texteHtml('pointage.repas.distance')}</th></tr></thead><tbody data-liste><tr><td colspan="3" class="aide">…</td></tr></tbody></table></div>
      <details data-non-trouve><summary>${texteHtml('pointage.repas.non_trouve')}</summary>
        <p class="ligne"><label>${texteHtml('pointage.repas.nom_court')} <input data-nom size="24"></label> <label>${texteHtml('pointage.repas.ville_colonne')} <input data-ville size="16"></label> <button type="button" data-creer>${iconeHtml('ajouter')} ${texteHtml('pointage.repas.utiliser')}</button></p>
        <p class="aide">${texteHtml('pointage.repas.provisoire_aide')}</p></details>
      ${actuel ? `<p class="aide">${texteHtml('pointage.repas.actuel', { restaurant: actuel.restaurant })}</p>` : ''}`,
    boutons: [{ libelle: texte('commun.annuler'), valeur: null }, ...(actuel ? [{ libelle: texte('pointage.repas.aucun'), valeur: { aucun: true } }] : [])],
    construire: (dlg, fermer) => {
      const tbody = dlg.querySelector('[data-liste]');
      const recherche = dlg.querySelector('[data-recherche]');
      const afficher = () => {
        tbody.innerHTML = liste.length ? liste.map((r) => `<tr class="cliquable" data-id="${r.id}"><td>${echapper(r.nom)}${r.provisoire ? ` <small class="aide">${texteHtml('pointage.repas.provisoire')}</small>` : ''}</td>
          <td>${echapper(r.ville ?? '')}</td><td class="nombre">${distanceRestaurant(r)}</td></tr>`).join('')
          : `<tr><td colspan="3" class="aide">${texteHtml('pointage.repas.aucun_liste')}</td></tr>`;
        tbody.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => fermer({ restaurant_id: Number(tr.dataset.id) })));
      };
      let minuterie = null;
      const relire = async () => { try { liste = await charger(recherche.value.trim()); } catch { liste = []; } afficher(); };
      recherche.addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(relire, 250); });
      dlg.querySelector('[data-creer]').addEventListener('click', () => {
        const nom = dlg.querySelector('[data-nom]').value.trim();
        if (!nom) { dlg.querySelector('[data-nom]').focus(); return; }
        fermer({ nouveau: nom, ville: dlg.querySelector('[data-ville]').value.trim() || null });
      });
      dlg.querySelector('[data-non-trouve]').addEventListener('toggle', () => { dlg.querySelector('[data-nom]').value ||= recherche.value.trim(); });
      relire();
      recherche.focus();
    },
  });
}

/** Chantier principal d'un jour (le plus d'heures pointées), ou null. */
export function chantierDuJour(pointages, date) {
  const m = new Map();
  for (const p of pointages.filter((x) => String(x.date).slice(0, 10) === date && x.cha_id)) m.set(p.cha_id, (m.get(p.cha_id) ?? 0) + (p.minutes ?? 0));
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Section « Repas » de la saisie d'une semaine : une case par jour (restaurant ou —), clic = choix ; jours validés en
 * lecture seule. Options : api (pointage), salarie, jours (dates ISO), pointages (chantier du jour), verrouilles (indices),
 * message(texte, niveau).
 */
export async function rendreRepasSemaine(zone, { api, salarie, jours, pointages, verrouilles = [], message = () => {} }) {
  let repas;
  try { repas = await api.repas(salarie, jours[0], jours[6]); } catch (e) { zone.innerHTML = `<p class="aide">${echapper(e.message)}</p>`; return; }
  const duJour = (d) => repas.find((r) => String(r.date).slice(0, 10) === d) ?? null;
  const visibles = jours.filter((d, i) => i < 5 || duJour(d) || chantierDuJour(pointages, d));
  const nomJour = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(langue(), { weekday: 'short', day: 'numeric' });
  zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr>${visibles.map((d) => `<th>${nomJour(d)}</th>`).join('')}</tr></thead>
    <tbody><tr>${visibles.map((d) => {
      const r = duJour(d);
      const bloque = verrouilles.includes(jours.indexOf(d));
      return `<td>${bloque ? `${iconeHtml('verrou')} ${echapper(r?.restaurant ?? texte('pointage.repas.sans'))}` : `<button type="button" class="lien" data-jour="${d}" title="${texteHtml(r ? 'pointage.repas.changer_aide' : 'pointage.repas.saisir_aide')}">${r ? `${iconeHtml('pointage_repas')} ${echapper(r.restaurant)}` : texteHtml('pointage.repas.sans')}</button>`}</td>`;
    }).join('')}</tr></tbody></table>
    <p class="aide">${texteHtml('pointage.repas.proposes_aide')}</p>`;
  zone.querySelectorAll('[data-jour]').forEach((b) => b.addEventListener('click', async () => {
    const date = b.dataset.jour;
    const chantier = chantierDuJour(pointages, date);
    const choix = await choisirRestaurant({ charger: (q) => api.restaurants(chantier, q), actuel: duJour(date), titre: `${icone('pointage_repas')} ${texte('pointage.repas.titre_jour', { jour: nomJour(date) })}` });
    if (!choix) return;
    try {
      await api.enregistrerRepas(salarie, { date, restaurant_id: choix.restaurant_id ?? null, nouveau: choix.nouveau ?? null, ville: choix.ville ?? null, cha_id: chantier });
      message(texte(choix.aucun ? 'pointage.repas.retire' : 'pointage.repas.enregistre'), 'succes');
      rendreRepasSemaine(zone, { api, salarie, jours, pointages, verrouilles, message });
    } catch (e) { message(e.message, 'erreur'); }
  }));
}

/** Membres d'une équipe retenus pour un repas déclaré par le chef (tous sauf les décochés), sans doublon. */
export const membresRepas = (membres, decoches = []) => {
  const ecartes = new Set(decoches);
  return [...new Set(membres)].filter((m) => !ecartes.has(m));
};

/** Corps de la requête `POST /repas` : un repas individuel, ou d'équipe (`membres`) quand la saisie est d'équipe. */
export const corpsRepas = ({ jeton, repas, equipe = null, decoches = [] }) =>
  (equipe ? { jeton, repas, membres: membresRepas(equipe, decoches) } : { jeton, repas });
