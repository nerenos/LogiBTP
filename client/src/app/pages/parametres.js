import { PageBase } from '@logibtp/navigation';
import { echapper, THEMES } from '@logibtp/socle/ui';
import { VERSION_MOTEUR } from '../../calcul/index.js';

/** Paramètres : préférences de navigation, profil (démo), listes, fiches, GED, société, à propos. */
export class PageParametres extends PageBase {
  icone = '⚙';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Paramètres';
    const s = await app.services();
    const parametresGed = await s.ged.parametres().catch(() => null);
    const societe = app.societe ?? {};
    this.conteneur.innerHTML = `<div class="page-parametres">
      <h1 class="page-titre">⚙ Paramètres</h1>
      <section class="carte"><h2>Affichage</h2>
        <div class="ligne" role="radiogroup" aria-label="Thème">${THEMES.map((t) => `<label class="ligne"><input type="radio" name="theme" value="${t.code}"
          ${app.preferences.get('theme') === t.code ? 'checked' : ''}> ${t.icone} ${echapper(t.libelle)}</label>`).join('')}</div>
        <p class="aide">Automatique suit le réglage clair / sombre du système. Le choix s'applique à toutes les fenêtres de ce navigateur.</p>
      </section>
      <section class="carte"><h2>Raccourcis clavier</h2>
        <p class="aide">Toutes les fonctions qui acceptent un raccourci, avec leurs touches ; chaque raccourci se remplace (gardé dans ce navigateur).
          Le clic droit sur une ligne les rappelle.</p>
        <p><a href="/parametres/raccourcis">⌨ Personnaliser les raccourcis…</a></p>
      </section>
      <section class="carte"><h2>Navigation</h2>
        <label class="ligne"><input type="checkbox" data-pref="nouvelleFenetre" ${app.preferences.get('nouvelleFenetre') ? 'checked' : ''}>
          Ouvrir les fiches et les documents d'une liste dans une nouvelle fenêtre</label>
        <p class="aide">Par défaut, la navigation se fait dans la fenêtre (liste → fiche → retour à la liste). Ctrl+clic, Maj+clic ou clic milieu
          (et ⧉ dans les menus) inversent ce choix. Les préférences restent dans ce navigateur, pour cette société.</p>
        <p><button type="button" data-action="fenetres">🗗 Fenêtres ouvertes…</button>
          <button type="button" data-action="oublier" ${app.fenetres.sessionPrecedente() ? '' : 'disabled'}>Oublier la session précédente</button>
          <button type="button" data-action="session" class="danger">⏻ Fermer la session…</button></p>
      </section>
      <section class="carte"><h2>Utilisateur</h2>
        <p>Utilisateur <b>${echapper(app.utilisateur())}</b>, profil <b>${echapper(app.profil())}</b>.
          ${app.enLigne ? '<span class="aide">(L\'identification et les droits seront gérés par le module de connexion.)</span>' : ''}</p>
        ${app.enLigne ? '' : `<label class="ligne">Profil de démonstration <select data-action="profil">${['ADMIN', 'SAISIE'].map((p) => `<option ${p === app.profil() ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          <p class="aide">SAISIE : sans informations confidentielles, sans reprise de la main sur les fiches, sans purge ni suppression au coffre-fort.</p>`}
      </section>
      <section class="carte"><h2>Listes et fiches</h2>
        <p><button type="button" data-action="themes" ${app.peutGererThemes() ? '' : 'disabled'}>🗂 Thèmes et vues de liste…</button>
          <button type="button" data-action="fiche" data-type="salarie" ${app.estAdmin() ? '' : 'disabled'}>👷 Champs de la fiche salarié…</button>
          <button type="button" data-action="fiche" data-type="materiel" ${app.estAdmin() ? '' : 'disabled'}>🚜 Champs de la fiche matériel…</button></p>
      </section>
      ${parametresGed ? `<section class="carte"><h2>GED</h2>
        <dl class="definitions"><dt>Éditions conservées</dt><dd>${parametresGed.editions_conservees} dernières (les étapes sont toutes conservées)</dd>
        <dt>Aperçu jusqu'à</dt><dd>${Math.round(parametresGed.taille_apercu_max / 1048576)} Mo</dd>
        <dt>Copie cachée des mails envoyés</dt><dd>${echapper(parametresGed.adresse_copie_cachee || '(non définie, module Mail à venir)')}</dd>
        <dt>Catégories</dt><dd>${parametresGed.categories.map((c) => `${echapper(c.libelle)}${c.coffre ? ' 🔒' : ''}`).join(' · ')}</dd></dl>
      </section>` : ''}
      <section class="carte"><h2>Société</h2>
        <dl class="definitions"><dt>Société</dt><dd>${echapper(societe.libelle ?? '')}${societe.principale ? ' (base principale)' : ''}</dd>
        <dt>Adresse</dt><dd><code>${echapper(location.host)}</code></dd></dl>
        <p class="aide">Une base par société : chaque société s'ouvre sur son sous-domaine (ex. <code>acme.${echapper(location.host.replace(/^[^.]+\.(?=.*\.)/, ''))}</code>) ; sans sous-domaine, la base principale.
          Deux sociétés ouvertes en même temps ne partagent ni fenêtres, ni session, ni préférences.</p>
      </section>
      <section class="carte" id="apropos"><h2>À propos</h2>
        <dl class="definitions"><dt>Application</dt><dd>LogiBTP</dd><dt>Moteur de calcul</dt><dd>${echapper(VERSION_MOTEUR)}</dd>
        <dt>Mode</dt><dd>${app.enLigne ? 'API connectée' : 'Démo hors ligne (données de démonstration, calcul local)'}</dd></dl>
      </section>
    </div>`;
    this.conteneur.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', () => app.changerTheme(r.value)));
    this.conteneur.querySelector('[data-pref="nouvelleFenetre"]').addEventListener('change', (e) => app.preferences.set('nouvelleFenetre', e.target.checked));
    this.conteneur.querySelector('[data-action="profil"]')?.addEventListener('change', (e) => app.changerProfilDemo(e.target.value));
    this.conteneur.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const actions = {
        fenetres: () => app.listeFenetres(),
        oublier: () => { app.fenetres.oublierSessionPrecedente(); b.disabled = true; app.message('Session précédente oubliée'); },
        session: () => app.fermerSession(),
        themes: () => app.gererThemes(),
        fiche: () => app.parametrerFiche(b.dataset.type),
      };
      Promise.resolve(actions[b.dataset.action]?.()).catch((x) => app.erreur(x));
    });
    if (location.hash) this.conteneur.querySelector(location.hash)?.scrollIntoView();
  }
}
