import { echapper } from '@logibtp/socle/ui';

// Dialogue de recherche dans l'annuaire des entreprises françaises : nom, SIREN ou SIRET ; l'entreprise choisie est
// rendue avec les dirigeants cochés (à créer comme contacts). Styles : classes du dialogue des fiches.

const adresse = (a) => (a ? [a.ligne1, a.ligne2, [a.code_postal, a.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '');

/**
 * Ouvre la recherche ; résout avec { entreprise, dirigeants } ou null (fermée).
 * Options : fournisseur (rechercher(q, { page })), recherche (texte initial), dirigeants (proposer les dirigeants).
 */
export function rechercherEntreprise({ fournisseur, recherche = '', dirigeants = true }) {
  return new Promise((resoudre) => {
    const fond = document.createElement('div');
    fond.className = 'fiche-dialogue-fond';
    fond.innerHTML = `<section class="fiche-dialogue entreprises-recherche" role="dialog" aria-label="Annuaire des entreprises">
      <header><h2>🇫🇷 Annuaire des entreprises</h2><button type="button" data-fermer title="Fermer (Échap)">✕</button></header>
      <div class="entreprises-barre"><input type="search" placeholder="Nom, SIREN ou SIRET…" value="${echapper(recherche)}"><button type="button" data-chercher>Rechercher</button></div>
      <div class="fiche-dialogue-corps entreprises-zone"><p class="aide">Source : annuaire des entreprises de l'État (INSEE, RNE) – données publiques.</p></div>
      <footer><span class="fiche-dialogue-message"></span><button type="button" data-annuler>Annuler</button><button type="button" class="principal" data-choisir disabled>Reprendre dans la fiche</button></footer></section>`;
    document.body.append(fond);
    const entree = fond.querySelector('input[type="search"]');
    const zone = fond.querySelector('.entreprises-zone');
    const message = fond.querySelector('.fiche-dialogue-message');
    let resultats = [];
    let choisie = null;
    let page = 1;
    const fermer = (r = null) => { fond.remove(); resoudre(r); };

    const rendreChoix = () => {
      fond.querySelector('[data-choisir]').disabled = choisie === null;
      zone.querySelectorAll('[data-i]').forEach((el) => el.classList.toggle('actif', Number(el.dataset.i) === choisie));
    };

    const chercher = async (p = 1) => {
      message.textContent = 'Recherche…';
      message.className = 'fiche-dialogue-message';
      try {
        const r = await fournisseur.rechercher(entree.value, { page: p });
        page = r.page;
        resultats = r.resultats;
        choisie = resultats.length === 1 ? 0 : null;
        message.textContent = r.total ? `${r.total} résultat${r.total > 1 ? 's' : ''}${r.pages > 1 ? ` · page ${r.page}/${r.pages}` : ''}` : 'Aucune entreprise trouvée';
        zone.innerHTML = resultats.map((e, i) => `<article class="entreprise" data-i="${i}">
          <div class="entreprise-titre"><b>${echapper(e.raison_sociale ?? '')}</b>${e.nom_commercial && e.nom_commercial !== e.raison_sociale ? ` <span>(${echapper(e.nom_commercial)})</span>` : ''}
            ${e.etat_administratif === 'F' ? '<span class="entreprise-ferme">fermé</span>' : ''}${e.siege ? '<span class="entreprise-siege">siège</span>' : ''}</div>
          <div class="aide">SIRET ${echapper(e.siret ?? '—')} · ${echapper(e.forme_libelle ?? e.forme_juridique ?? '')} · NAF ${echapper(e.naf ?? '—')}${e.effectif ? ` · ${echapper(e.effectif)}` : ''}</div>
          <div>${echapper(adresse(e.adresse))}</div>
          ${dirigeants && e.dirigeants.length ? `<details><summary>${e.dirigeants.length} dirigeant(s) : créer les contacts cochés</summary>
            ${e.dirigeants.map((d, j) => `<label><input type="checkbox" data-dirigeant="${j}"> ${echapper([d.prenom, d.nom].filter(Boolean).join(' '))}${d.qualite ? ` – ${echapper(d.qualite)}` : ''}</label>`).join('')}</details>` : ''}
        </article>`).join('') || '<p class="aide">Aucune entreprise trouvée.</p>';
        if (r.pages > 1) {
          zone.insertAdjacentHTML('beforeend', `<p class="entreprises-pages">${page > 1 ? '<button type="button" data-page="-1">◀ Précédents</button>' : ''}
            ${page < r.pages ? '<button type="button" data-page="1">Suivants ▶</button>' : ''}</p>`);
        }
        rendreChoix();
      } catch (e) {
        message.textContent = e.message;
        message.className = 'fiche-dialogue-message erreur';
      }
    };

    zone.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (b) { chercher(page + Number(b.dataset.page)); return; }
      const a = e.target.closest('[data-i]');
      if (a) { choisie = Number(a.dataset.i); rendreChoix(); }
    });
    const choisir = () => {
      if (choisie === null) return;
      const e = resultats[choisie];
      const cases = [...zone.querySelectorAll(`[data-i="${choisie}"] [data-dirigeant]`)];
      fermer({ entreprise: e, dirigeants: cases.filter((c) => c.checked).map((c) => e.dirigeants[Number(c.dataset.dirigeant)]) });
    };
    zone.addEventListener('dblclick', (e) => { if (e.target.closest('[data-i]') && !e.target.closest('details')) choisir(); });
    fond.querySelector('[data-choisir]').addEventListener('click', choisir);
    fond.querySelector('[data-fermer]').addEventListener('click', () => fermer());
    fond.querySelector('[data-annuler]').addEventListener('click', () => fermer());
    fond.querySelector('[data-chercher]').addEventListener('click', () => chercher());
    entree.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); chercher(); } });
    fond.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); } });
    entree.focus();
    if (entree.value.trim().length >= 3) chercher();
  });
}
