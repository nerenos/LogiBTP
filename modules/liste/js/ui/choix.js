import { echapper, ouvrirModale } from '@logibtp/socle/ui';
import { ListeDonnees } from './liste.js';

// Choix dans une liste (ergonomie I1) : fenêtre <dialog> qui présente une liste de données d'un thème en mode choix
// (vues du thème seulement, sans concepteur ni saisie). Entrée ou double-clic choisit la ligne, Échap annule ; la
// sélection multiple (Ctrl / Maj + clic) est permise en option. Les filtres de l'appel (relation Client, fonction…)
// s'affichent en pastilles retirables ; un bouton de création facultatif rend la main à l'appelant.

/**
 * Ouvre la fenêtre de choix. Options :
 *   fournisseur, theme (code du thème dont les vues sont proposées), vue (identifiant de la vue ouverte d'abord, sauf
 *   vue ★ de l'utilisateur dans la fenêtre de choix ; sans : vue par défaut du thème), titre ;
 *   filtres { colonne: [valeurs] } posés par défaut (sémantique des segments ; colonne ARRAY : l'une des valeurs),
 *   libellesFiltres { colonne: texte } pour leurs pastilles ; recherche (texte initial) ;
 *   multiple (plusieurs lignes) ; creer (libellé du bouton de création) ;
 *   accepter(ligne) → message de refus ou null (ligne exclue…) ; formats ; cleVue. Les messages s'affichent dans la
 *   fenêtre (une notification de l'application resterait sous la fenêtre modale).
 * Résout avec la ligne choisie (tableau de lignes si `multiple`), { creer: recherche } (bouton de création) ou null.
 */
export function choisirDansListe({ fournisseur, theme, vue = null, titre = 'Choisir', filtres = {}, libellesFiltres = {}, recherche = '', multiple = false,
  creer = null, accepter = null, formats, cleVue } = {}) {
  return new Promise((resoudre) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'choix-liste';
    dlg.innerHTML = `
      <header class="choix-liste-entete">
        <h2>${echapper(titre)}</h2>
        <span class="choix-liste-filtres"></span>
        <span class="choix-liste-espace"></span>
        ${creer ? `<button type="button" data-creer title="Créer un nouvel élément (la recherche saisie est reprise)">${echapper(creer)}</button>` : ''}
        <button type="button" data-annuler class="bouton-icone" title="Fermer (Échap)" aria-label="Fermer">✕</button>
      </header>
      <div class="choix-liste-zone"></div>
      <footer class="choix-liste-pied">
        <span class="aide choix-liste-message">Entrée ou double-clic : choisir${multiple ? ' · Ctrl / Maj + clic : plusieurs lignes' : ''} · Échap : annuler</span>
        <span class="choix-liste-espace"></span>
        <button type="button" data-annuler>Annuler</button>
        <button type="button" class="principal" data-choisir>Choisir</button>
      </footer>`;
    const actifs = new Map(Object.entries(filtres).filter(([, v]) => v?.length).map(([c, v]) => [c, [...v]]));
    let liste = null;
    let fini = false;
    const finir = (r) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      liste?.detruire();
      dlg.close();
      dlg.remove();
      resoudre(r);
    };
    const zoneMessage = dlg.querySelector('.choix-liste-message');
    const aide = zoneMessage.textContent;
    let minuterie = null;
    const signaler = (texte, niveau = 'info') => {
      clearTimeout(minuterie);
      zoneMessage.textContent = texte;
      zoneMessage.className = `choix-liste-message ${niveau}`;
      minuterie = setTimeout(() => { zoneMessage.textContent = aide; zoneMessage.className = 'aide choix-liste-message'; }, 5000);
    };
    const choisir = (lignes) => {
      if (!lignes.length) { signaler('Aucune ligne sélectionnée', 'avertissement'); return; }
      const refus = accepter ? lignes.map((l) => accepter(l)).find(Boolean) : null;
      if (refus) { signaler(refus, 'avertissement'); return; }
      finir(multiple ? lignes : lignes[0]);
    };
    ouvrirModale(dlg, () => finir(null));
    liste = new ListeDonnees(dlg.querySelector('.choix-liste-zone'), {
      fournisseur, formats, message: signaler, intervalleControle: 0, choix: true, themeFixe: theme,
      cleVue: cleVue ?? `logibtp.choix.${theme}`,
      // Double-clic ou Entrée : la ligne (plusieurs avec la sélection multiple).
      ouvrir: ({ ligne }) => choisir(multiple && liste.selections.size > 1 ? liste.lignesSelectionnees() : [ligne]),
      filtresVue: () => Object.fromEntries(actifs),
    });
    const zoneFiltres = dlg.querySelector('.choix-liste-filtres');
    const rendreFiltres = () => {
      zoneFiltres.innerHTML = [...actifs.keys()].map((c) => `<span class="choix-liste-filtre" title="Filtre de l'appel : cliquer ✕ pour voir toutes les lignes">
        ⚑ ${echapper(libellesFiltres[c] ?? `${c} : ${actifs.get(c).join(', ')}`)}<button type="button" class="bouton-icone" data-retirer="${echapper(c)}" aria-label="Retirer le filtre">✕</button></span>`).join('');
    };
    zoneFiltres.addEventListener('click', (e) => {
      const b = e.target.closest('[data-retirer]');
      if (!b) return;
      actifs.delete(b.dataset.retirer);
      rendreFiltres();
      liste.definirFiltreExterne(b.dataset.retirer, null);
    });
    rendreFiltres();
    dlg.querySelectorAll('[data-annuler]').forEach((b) => b.addEventListener('click', () => finir(null)));
    dlg.querySelector('[data-choisir]').addEventListener('click', () => choisir(liste.lignesSelectionnees()));
    dlg.querySelector('[data-creer]')?.addEventListener('click', () => finir({ creer: liste.recherche ?? '' }));
    const champ = dlg.querySelector('.liste-recherche');
    if (recherche) { champ.value = recherche; liste.recherche = recherche.trim(); }
    liste.demarrer(liste.panneauVues.etat().defauts?.[theme] ?? vue).then(() => champ.focus()).catch((e) => signaler(e.message ?? String(e), 'erreur'));
  });
}
