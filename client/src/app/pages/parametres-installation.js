import { PageBase } from '@logibtp/navigation';
import { echapper } from '@logibtp/socle/ui';
import { api } from '../api.js';

const ORIGINES = {
  LOGIBTP: 'Autorité LogiBTP de l\'installation',
  IMPORTE: 'Certificat importé (Active Directory, prestataire)',
  LETSENCRYPT: 'Let\'s Encrypt (défi DNS)',
};

const date = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : '');
const dateHeure = (v) => (v ? new Date(v).toLocaleString('fr-FR') : '');
const go = (mo) => (mo >= 1024 ? `${(mo / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : `${mo} Mo`);

/**
 * État de l'installation (module Installation, ANALYSE-MODULE-INSTALLATION.md § 7.3), en lecture : version, certificat
 * HTTPS et échéance, bases des sociétés (joignables, connexion chiffrée, scripts appliqués ou en attente), dernière sauvegarde, espace
 * disque. Les actions (certificat, sauvegarde, mise à jour) se font sur le serveur par l'installeur.
 */
export class PageParametresInstallation extends PageBase {
  icone = '🖥';

  async ouvrir() {
    this.titre = 'Installation';
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">🖥 Installation</h1>
      <button type="button" data-actualiser title="Relire l'état">⟳</button></div>
      <p class="aide">État du serveur, en lecture : le certificat, les sauvegardes et les mises à jour se gèrent sur le serveur
      (Installer-LogiBTP.ps1, Sauvegarder-LogiBTP.ps1, MettreAJour-LogiBTP.ps1).</p><div data-corps></div></div>`;
    this.conteneur.querySelector('[data-actualiser]').addEventListener('click', () => this.charger());
    await this.charger();
  }

  async charger() {
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!this.app.enLigne) { corps.innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    try {
      corps.innerHTML = this.rendu(await api.etatInstallation());
    } catch (e) { this.app.erreur(e); }
  }

  rendu(e) {
    const c = e.certificat;
    const alerte = (texte) => `<p class="erreur">⚠ ${echapper(texte)}</p>`;
    const certificat = !c
      ? `<p>${e.https ? '' : 'Aucun certificat : l\'application est servie en HTTP (copier-coller des lignes, empreintes de la GED et borne indisponibles hors du poste serveur).'}</p>`
      : `<table class="tableau-compact largeur-contenu"><tbody>
          <tr><th>Origine</th><td>${echapper(ORIGINES[c.origine] ?? c.origine)}</td></tr>
          <tr><th>Noms</th><td>${c.noms.map(echapper).join(', ')}</td></tr>
          <tr><th>Émetteur</th><td>${echapper(c.emetteur)}</td></tr>
          <tr><th>Valable jusqu'au</th><td>${date(c.fin)} (${c.jours_restants} jour(s))</td></tr>
          ${c.empreinte_racine ? `<tr><th>Empreinte de l'autorité</th><td><code>${echapper(c.empreinte_racine)}</code></td></tr>` : ''}
        </tbody></table>${c.jours_restants < 30 ? alerte('Certificat à renouveler') : ''}
        <p class="aide">Postes et tablettes : page <a href="/certificat" target="_blank" rel="noopener">/certificat</a>.</p>`;
    const bases = `<table class="tableau-compact largeur-contenu"><thead><tr><th>Société</th><th>Base</th><th>État</th><th>Connexion</th><th>Scripts</th><th>En attente</th></tr></thead><tbody>
      ${e.bases.map((b) => `<tr><td>${echapper(b.libelle)}${b.code ? ` <small class="aide">(${echapper(b.code)})</small>` : ''}</td><td>${echapper(b.base ?? '')}</td>
        <td>${b.joignable ? '✔ joignable' : `<span class="erreur">✘ ${echapper(b.erreur ?? 'injoignable')}</span>`}</td>
        <td>${!b.joignable ? '' : b.chiffree ? '🔒 chiffrée (TLS)' : '<span class="erreur">⚠ non chiffrée : relancer « installation preparer »</span>'}</td>
        <td>${b.scripts || ''}</td><td>${b.en_attente ? `<span class="erreur">${b.en_attente} (mise à jour à faire)</span>` : ''}</td></tr>`).join('')}
      </tbody></table>`;
    const s = e.sauvegarde;
    const anciennete = s ? (Date.now() - new Date(s.le).getTime()) / 86400000 : null;
    const sauvegarde = !s ? alerte('Aucune sauvegarde connue')
      : `<p>Dernière sauvegarde : <b>${dateHeure(s.le)}</b>, ${s.bases.length} base(s), ${go(s.taille_mo)}${s.chiffree ? ', chiffrée' : ''}.</p>
        ${s.erreur ? alerte(`Échec : ${s.erreur}`) : ''}${anciennete > 2 ? alerte('Sauvegarde de plus de deux jours') : ''}`;
    const disques = e.disques.length === 0 ? '' : `<table class="tableau-compact largeur-contenu"><thead><tr><th>Usage</th><th>Libre</th><th>Total</th></tr></thead><tbody>
      ${e.disques.map((d) => `<tr><td>${echapper(d.usage)}</td><td>${go(d.libre_mo)}${d.libre_mo < d.total_mo / 10 ? ' ⚠' : ''}</td><td>${go(d.total_mo)}</td></tr>`).join('')}
      </tbody></table>`;
    return `<p>Version <b>${echapper(e.version)}</b>, déploiement ${echapper(e.deploiement)}${e.domaine ? `, domaine <b>${echapper(e.domaine)}</b>` : ''},
      ${e.https ? 'HTTPS' : 'HTTP seul'}.</p>
      <h2>Certificat HTTPS</h2>${certificat}
      <h2>Bases</h2>${bases}
      <h2>Sauvegardes</h2>${sauvegarde}
      ${disques ? `<h2>Espace disque</h2>${disques}` : ''}`;
  }
}
