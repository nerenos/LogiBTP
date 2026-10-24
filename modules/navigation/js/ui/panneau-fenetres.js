import { echapper, ouvrirModale, confirmer } from '@logibtp/socle/ui';

// Liste des fenêtres ouvertes de la session : afficher (premier plan), signaler, fermer ; fermer la session.
// fenetres : GestionFenetres ; fermerSession() : procédure de l'application (contrôle des modifications).

const heure = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export class PanneauFenetres {
  constructor({ fenetres, fermerSession, fermerFenetre, message = () => {} }) {
    this.fenetres = fenetres;
    this.message = message;
    this.fond = document.createElement('dialog');
    this.fond.className = 'nav-dialogue-fond dialogue-plein';
    this.fond.innerHTML = `<section class="nav-dialogue" role="dialog" aria-label="Fenêtres ouvertes">
      <header><h2>🗗 Fenêtres ouvertes</h2><button type="button" data-action="fermer" title="Fermer (Échap)">✕</button></header>
      <div class="nav-dialogue-corps"><table class="nav-fenetres"><thead><tr><th></th><th>Fenêtre</th><th>Adresse</th><th>Ouverte</th><th></th></tr></thead><tbody></tbody></table>
      <p class="aide">« Afficher » remet la fenêtre au premier plan ; si le navigateur ne le permet pas, elle est signalée (titre clignotant et cadre).
      Les fenêtres d'une autre société (autre sous-domaine) n'apparaissent pas ici.</p></div>
      <footer><button type="button" data-action="session" class="danger">Fermer la session…</button><button type="button" data-action="fermer">Fermer</button></footer>
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
        if (!this.fenetres.focaliser(id)) this.message('Le navigateur ne permet pas de mettre cette fenêtre au premier plan : elle est signalée', 'avertissement');
      } else if (b.dataset.action === 'signaler') this.fenetres.signaler(id);
      else if (b.dataset.action === 'fermer-courante') { this.fermer(); fermerFenetre(); }
    });
    this.echap = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.fermer(); } };
    document.addEventListener('keydown', this.echap, true);
    this.rendre(this.fenetres.liste());
  }

  rendre(liste) {
    this.fond.querySelector('tbody').innerHTML = liste.map((f) => `<tr data-id="${echapper(f.id)}" class="${f.courante ? 'courante' : ''}">
      <td>${echapper(f.icone || '🗔')}</td>
      <td><b>${echapper(f.titre || '(sans titre)')}</b>${f.modifiee ? ' <span class="nav-modifiee" title="Modifications non enregistrées">●</span>' : ''}${f.courante ? ' <small>(cette fenêtre)</small>' : ''}${f.principale ? ' <small>principale</small>' : ''}</td>
      <td><code>${echapper(f.url)}</code></td>
      <td>${heure(f.ouverteLe)}</td>
      <td class="nav-actions">${f.courante ? '<button type="button" data-action="fermer-courante">Fermer</button>'
        : '<button type="button" data-action="afficher">Afficher</button><button type="button" data-action="signaler" title="Signaler sa présence">🔔</button>'}</td>
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
  if (!modifiees.length) return confirmer('Fermer la session ? Toutes les fenêtres seront fermées ; « Restaurer ma session précédente » les rouvrira.', { titre: 'Fermer la session', ok: 'Fermer la session' });
  return new Promise((resolve) => {
    const fond = document.createElement('dialog');
    fond.className = 'nav-dialogue-fond dialogue-plein';
    fond.innerHTML = `<section class="nav-dialogue" role="alertdialog" aria-label="Modifications en cours">
      <header><h2>⚠ Modifications non enregistrées</h2></header>
      <div class="nav-dialogue-corps"><p>Ces fenêtres ont des modifications qui seront perdues :</p>
      <ul>${modifiees.map((f) => `<li><b>${echapper(f.titre || '(sans titre)')}</b>${f.courante ? ' (cette fenêtre)' : ''}</li>`).join('')}</ul>
      <p class="aide">Annulez pour enregistrer d'abord, puis fermez de nouveau la session.</p></div>
      <footer><button type="button" data-r="oui" class="danger">Fermer quand même</button><button type="button" data-r="non" class="principal">Annuler</button></footer>
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
