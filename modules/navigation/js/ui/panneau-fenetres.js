import { echapper, ouvrirModale, confirmer, formatHeure } from '@logibtp/socle/ui';
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';

// Liste des fenêtres ouvertes de la session : afficher (premier plan), signaler, fermer ; fermer la session.
// fenetres : GestionFenetres ; fermerSession() : procédure de l'application (contrôle des modifications).


export class PanneauFenetres {
  constructor({ fenetres, fermerSession, fermerFenetre, message = () => {} }) {
    this.fenetres = fenetres;
    this.message = message;
    this.fond = document.createElement('dialog');
    this.fond.className = 'nav-dialogue-fond dialogue-plein';
    this.fond.innerHTML = `<section class="nav-dialogue" role="dialog" aria-label="${texteHtml('navigation.fenetres.titre')}">
      <header><h2>${iconeHtml('navigation_fenetres')} ${texteHtml('navigation.fenetres.titre')}</h2><button type="button" data-action="fermer" title="${texteHtml('commun.fermer_echap')}">${iconeHtml('retirer')}</button></header>
      <div class="nav-dialogue-corps"><table class="nav-fenetres"><thead><tr><th></th><th>${texteHtml('navigation.fenetres.fenetre')}</th><th>${texteHtml('navigation.fenetres.adresse')}</th><th>${texteHtml('navigation.fenetres.ouverte')}</th><th></th></tr></thead><tbody></tbody></table>
      <p class="aide">${texteHtml('navigation.fenetres.aide')}</p></div>
      <footer><button type="button" data-action="session" class="danger">${texteHtml('navigation.fenetres.fermer_session_choix')}</button><button type="button" data-action="fermer">${texteHtml('commun.fermer')}</button></footer>
    </section>`;
    ouvrirModale(this.fond);
    this.fond.addEventListener('click', (e) => {
      if (e.target === this.fond) { this.fermer(); return; }
      const b = e.target.closest('button');
      if (!b) return;
      const id = b.closest('tr')?.dataset.id;
      if (b.dataset.action === 'fermer') this.fermer();
      else if (b.dataset.action === 'session') { this.fermer(); fermerSession(); }
      else if (b.dataset.action === 'afficher') {
        if (!this.fenetres.focaliser(id)) this.message(texte('navigation.fenetres.premier_plan_impossible'), 'avertissement');
      } else if (b.dataset.action === 'signaler') this.fenetres.signaler(id);
      else if (b.dataset.action === 'fermer-courante') { this.fermer(); fermerFenetre(); }
    });
    this.echap = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.fermer(); } };
    document.addEventListener('keydown', this.echap, true);
    this.rendre(this.fenetres.liste());
  }

  rendre(liste) {
    this.fond.querySelector('tbody').innerHTML = liste.map((f) => `<tr data-id="${echapper(f.id)}" class="${f.courante ? 'courante' : ''}">
      <td>${f.icone ? echapper(f.icone) : iconeHtml('navigation_fenetre')}</td>
      <td><b>${echapper(f.titre || texte('commun.sans_titre'))}</b>${f.modifiee ? ` <span class="nav-modifiee" title="${texteHtml('navigation.fenetres.modifiee')}">${iconeHtml('modifie')}</span>` : ''}${f.courante ? ` <small>${texteHtml('navigation.fenetres.courante')}</small>` : ''}${f.principale ? ` <small>${texteHtml('navigation.fenetres.principale')}</small>` : ''}</td>
      <td><code>${echapper(f.url)}</code></td>
      <td>${formatHeure(f.ouverteLe)}</td>
      <td class="nav-actions">${f.courante ? `<button type="button" data-action="fermer-courante">${texteHtml('commun.fermer')}</button>`
        : `<button type="button" data-action="afficher">${texteHtml('commun.afficher')}</button><button type="button" data-action="signaler" title="${texteHtml('navigation.fenetres.signaler')}">${iconeHtml('navigation_signaler')}</button>`}</td>
    </tr>`).join('');
  }

  fermer() {
    document.removeEventListener('keydown', this.echap, true);
    this.fond.remove();
    this.surFerme?.();
  }
}

/**
 * Confirmation de fermeture de session : liste des fenêtres avec des modifications non enregistrées.
 * Renvoie une promesse : true pour fermer quand même.
 */
export function confirmerFermetureSession(modifiees) {
  if (!modifiees.length) {
    return confirmer(texte('navigation.fenetres.fermer_session_question'), { titre: texte('navigation.fenetres.fermer_session'), ok: texte('navigation.fenetres.fermer_session') });
  }
  return new Promise((resolve) => {
    const fond = document.createElement('dialog');
    fond.className = 'nav-dialogue-fond dialogue-plein';
    fond.innerHTML = `<section class="nav-dialogue" role="alertdialog" aria-label="${texteHtml('navigation.fenetres.modifications_en_cours')}">
      <header><h2>${iconeHtml('avertissement')} ${texteHtml('navigation.fenetres.modifications_titre')}</h2></header>
      <div class="nav-dialogue-corps"><p>${texteHtml('navigation.fenetres.modifications_perdues')}</p>
      <ul>${modifiees.map((f) => `<li><b>${echapper(f.titre || texte('commun.sans_titre'))}</b>${f.courante ? ` ${texteHtml('navigation.fenetres.courante')}` : ''}</li>`).join('')}</ul>
      <p class="aide">${texteHtml('navigation.fenetres.modifications_aide')}</p></div>
      <footer><button type="button" data-r="oui" class="danger">${texteHtml('navigation.fenetres.fermer_quand_meme')}</button><button type="button" data-r="non" class="principal">${texteHtml('commun.annuler')}</button></footer>
    </section>`;
    const repondre = (oui) => { fond.remove(); resolve(oui); };
    ouvrirModale(fond, () => repondre(false));
    fond.querySelector('[data-r="non"]').focus();
    fond.addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]')?.dataset.r;
      if (r) repondre(r === 'oui');
    });
  });
}
