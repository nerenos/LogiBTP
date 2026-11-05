import { echapper, ouvrirModale } from '@logibtp/socle/ui';
import { texte, texteHtml, pluriel, iconeHtml } from '@logibtp/socle/dictionnaire';

// Dialogue de recherche dans l'annuaire des entreprises françaises : nom, SIREN ou SIRET ; l'entreprise choisie est
// rendue avec les dirigeants cochés (à créer comme contacts). Styles : classes du dialogue des fiches.

const adresse = (a) => (a ? [a.ligne1, a.ligne2, [a.code_postal, a.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '');

/**
 * Ouvre la recherche ; résout avec { entreprise, dirigeants } ou null (fermée).
 * Options : fournisseur (rechercher(q, { page })), recherche (texte initial), dirigeants (proposer les dirigeants).
 */
export function rechercherEntreprise({ fournisseur, recherche = '', dirigeants = true }) {
  return new Promise((resoudre) => {
    const fond = document.createElement('dialog');
    fond.className = 'fiche-dialogue-fond dialogue-plein';
    fond.innerHTML = `<section class="fiche-dialogue entreprises-recherche" role="dialog" aria-label="${texteHtml('entreprises_fr.recherche.titre')}">
      <header><h2>${iconeHtml('entreprises_fr_annuaire')} ${texteHtml('entreprises_fr.recherche.titre')}</h2><button type="button" data-fermer title="${texteHtml('entreprises_fr.recherche.fermer')}">${iconeHtml('retirer')}</button></header>
      <div class="entreprises-barre"><input type="search" placeholder="${texteHtml('entreprises_fr.recherche.saisie')}" value="${echapper(recherche)}"><button type="button" data-chercher>${texteHtml('entreprises_fr.recherche.rechercher')}</button></div>
      <div class="fiche-dialogue-corps entreprises-zone"><p class="aide">${texteHtml('entreprises_fr.recherche.source')}</p></div>
      <footer><span class="fiche-dialogue-message"></span><button type="button" data-annuler>${texteHtml('entreprises_fr.recherche.annuler')}</button><button type="button" class="principal" data-choisir disabled>${texteHtml('entreprises_fr.recherche.reprendre')}</button></footer></section>`;
    ouvrirModale(fond);
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
      message.textContent = texte('entreprises_fr.recherche.en_cours');
      message.className = 'fiche-dialogue-message';
      try {
        const r = await fournisseur.rechercher(entree.value, { page: p });
        page = r.page;
        resultats = r.resultats;
        choisie = resultats.length === 1 ? 0 : null;
        message.textContent = r.total ? `${pluriel('entreprises_fr.recherche.resultats', r.total, { nombre: r.total })}${r.pages > 1 ? texte('entreprises_fr.recherche.page', { page: r.page, pages: r.pages }) : ''}` : texte('entreprises_fr.recherche.aucune');
        zone.innerHTML = resultats.map((e, i) => `<article class="entreprise" data-i="${i}">
          <div class="entreprise-titre"><b>${echapper(e.raison_sociale ?? '')}</b>${e.nom_commercial && e.nom_commercial !== e.raison_sociale ? ` <span>(${echapper(e.nom_commercial)})</span>` : ''}
            ${e.etat_administratif === 'F' ? `<span class="entreprise-ferme">${texteHtml('entreprises_fr.recherche.ferme')}</span>` : ''}${e.siege ? `<span class="entreprise-siege">${texteHtml('entreprises_fr.recherche.siege')}</span>` : ''}</div>
          <div class="aide">${texteHtml('entreprises_fr.recherche.siret', { siret: e.siret ?? '—' })} · ${echapper(e.forme_libelle ?? e.forme_juridique ?? '')} · ${texteHtml('entreprises_fr.recherche.naf', { naf: e.naf ?? '—' })}${e.effectif ? ` · ${echapper(e.effectif)}` : ''}</div>
          <div>${echapper(adresse(e.adresse))}</div>
          ${dirigeants && e.dirigeants.length ? `<details><summary>${texteHtml('entreprises_fr.recherche.dirigeants', { nombre: e.dirigeants.length })}</summary>
            ${e.dirigeants.map((d, j) => `<label><input type="checkbox" data-dirigeant="${j}"> ${echapper([d.prenom, d.nom].filter(Boolean).join(' '))}${d.qualite ? ` – ${echapper(d.qualite)}` : ''}</label>`).join('')}</details>` : ''}
        </article>`).join('') || `<p class="aide">${texteHtml('entreprises_fr.recherche.aucune_point')}</p>`;
        if (r.pages > 1) {
          zone.insertAdjacentHTML('beforeend', `<p class="entreprises-pages">${page > 1 ? `<button type="button" data-page="-1">${iconeHtml('precedent')} ${texteHtml('entreprises_fr.recherche.precedents')}</button>` : ''}
            ${page < r.pages ? `<button type="button" data-page="1">${texteHtml('entreprises_fr.recherche.suivants')} ${iconeHtml('suivant')}</button>` : ''}</p>`);
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
