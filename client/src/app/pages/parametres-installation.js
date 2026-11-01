import { texte, texteHtml, icone, iconeHtml, textesParCode, langue } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatDate, formatDateHeure } from '@logibtp/socle/ui';
import { api } from '../api.js';

const ORIGINES = textesParCode('parametres_btp.installation.origines', ['LOGIBTP', 'IMPORTE', 'LETSENCRYPT']);

const go = (mo) => (mo >= 1024 ? texte('parametres_btp.installation.taille_go', { taille: (mo / 1024).toLocaleString(langue(), { maximumFractionDigits: 1 }) }) : texte('terrain_btp.page.taille_mo', { taille: mo }));

/**
 * État de l'installation (module Installation, ANALYSE-MODULE-INSTALLATION.md § 7.3), en lecture : version, certificat
 * HTTPS et échéance, bases des sociétés (joignables, connexion chiffrée, scripts appliqués ou en attente), dernière sauvegarde, espace
 * disque. Les actions (certificat, sauvegarde, mise à jour) se font sur le serveur par l'installeur.
 */
export class PageParametresInstallation extends PageBase {
  icone = icone('parametres_btp_installation');

  async ouvrir() {
    this.titre = texte('parametres_btp.installation.titre');
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">${iconeHtml('parametres_btp_installation')} ${texteHtml('parametres_btp.installation.titre')}</h1>
      <button type="button" data-actualiser title="${texteHtml('parametres_btp.installation.relire')}">${iconeHtml('parametres_btp_actualiser')}</button></div>
      <p class="aide">${texteHtml('parametres_btp.installation.aide')}</p><div data-corps></div></div>`;
    this.conteneur.querySelector('[data-actualiser]').addEventListener('click', () => this.charger());
    await this.charger();
  }

  async charger() {
    const corps = this.conteneur.querySelector('[data-corps]');
    try {
      corps.innerHTML = this.rendu(await api.etatInstallation());
    } catch (e) { this.app.erreur(e); }
  }

  rendu(e) {
    const c = e.certificat;
    const alerte = (message) => `<p class="erreur">${iconeHtml('avertissement')} ${echapper(message)}</p>`;
    const certificat = !c
      ? `<p>${e.https ? '' : texteHtml('parametres_btp.sans_certificat')}</p>`
      : `<table class="tableau-compact largeur-contenu"><tbody>
          <tr><th>${texteHtml('parametres_btp.installation.certificat.origine')}</th><td>${echapper(ORIGINES[c.origine] ?? c.origine)}</td></tr>
          <tr><th>${texteHtml('parametres_btp.installation.certificat.noms')}</th><td>${c.noms.map(echapper).join(', ')}</td></tr>
          <tr><th>${texteHtml('parametres_btp.installation.certificat.emetteur')}</th><td>${echapper(c.emetteur)}</td></tr>
          <tr><th>${texteHtml('parametres_btp.installation.certificat.fin')}</th><td>${texteHtml('parametres_btp.installation.certificat.fin_valeur', { date: formatDate(c.fin), jours: c.jours_restants })}</td></tr>
          ${c.empreinte_racine ? `<tr><th>${texteHtml('parametres_btp.installation.certificat.empreinte')}</th><td><code>${echapper(c.empreinte_racine)}</code></td></tr>` : ''}
        </tbody></table>${c.jours_restants < 30 ? alerte(texte('parametres_btp.installation.certificat.renouveler')) : ''}
        <p class="aide">${texteHtml('parametres_btp.installation.certificat.postes')} <a href="/certificat" target="_blank" rel="noopener">/certificat</a>.</p>`;
    const bases = `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('parametres_btp.installation.bases.societe')}</th><th>${texteHtml('parametres_btp.installation.bases.base')}</th><th>${texteHtml('parametres_btp.installation.bases.etat')}</th><th>${texteHtml('parametres_btp.installation.bases.connexion')}</th><th>${texteHtml('parametres_btp.installation.bases.scripts')}</th><th>${texteHtml('parametres_btp.installation.bases.attente')}</th></tr></thead><tbody>
      ${e.bases.map((b) => `<tr><td>${echapper(b.libelle)}${b.code ? ` <small class="aide">(${echapper(b.code)})</small>` : ''}</td><td>${echapper(b.base ?? '')}</td>
        <td>${b.joignable ? `${iconeHtml('parametres_btp_ok')} ${texteHtml('parametres_btp.installation.bases.joignable')}` : `<span class="erreur">${iconeHtml('parametres_btp_ko')} ${echapper(b.erreur ?? texte('parametres_btp.installation.bases.injoignable'))}</span>`}</td>
        <td>${!b.joignable ? '' : b.chiffree ? `${iconeHtml('verrou')} ${texteHtml('parametres_btp.installation.bases.chiffree')}` : `<span class="erreur">${iconeHtml('avertissement')} ${texteHtml('parametres_btp.installation.bases.non_chiffree')}</span>`}</td>
        <td>${b.scripts || ''}</td><td>${b.en_attente ? `<span class="erreur">${texteHtml('parametres_btp.installation.bases.a_faire', { nombre: b.en_attente })}</span>` : ''}</td></tr>`).join('')}
      </tbody></table>`;
    const s = e.sauvegarde;
    const anciennete = s ? (Date.now() - new Date(s.le).getTime()) / 86400000 : null;
    const sauvegarde = !s ? alerte(texte('parametres_btp.installation.sauvegarde.aucune'))
      : `<p>${texteHtml(s.chiffree ? 'parametres_btp.sauvegarde.derniere_chiffree_html' : 'parametres_btp.sauvegarde.derniere_html', { date: formatDateHeure(s.le), bases: s.bases.length, taille: go(s.taille_mo) })}</p>
        ${s.erreur ? alerte(texte('parametres_btp.installation.sauvegarde.echec', { erreur: s.erreur })) : ''}${anciennete > 2 ? alerte(texte('parametres_btp.installation.sauvegarde.ancienne')) : ''}`;
    const disques = e.disques.length === 0 ? '' : `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('parametres_btp.installation.disques.usage')}</th><th>${texteHtml('parametres_btp.installation.disques.libre')}</th><th>${texteHtml('commun.total')}</th></tr></thead><tbody>
      ${e.disques.map((d) => `<tr><td>${echapper(d.usage)}</td><td>${go(d.libre_mo)}${d.libre_mo < d.total_mo / 10 ? ` ${iconeHtml('avertissement')}` : ''}</td><td>${go(d.total_mo)}</td></tr>`).join('')}
      </tbody></table>`;
    return `<p>${texteHtml(e.domaine ? 'parametres_btp.installation.version_domaine_html' : 'parametres_btp.installation.version_html', { version: e.version, deploiement: e.deploiement, domaine: e.domaine, protocole: texte(e.https ? 'parametres_btp.installation.https' : 'parametres_btp.installation.http') })}</p>
      <h2>${texteHtml('parametres_btp.installation.certificat.titre')}</h2>${certificat}
      <h2>${texteHtml('parametres_btp.installation.bases.titre')}</h2>${bases}
      <h2>${texteHtml('parametres_btp.installation.sauvegarde.titre')}</h2>${sauvegarde}
      ${disques ? `<h2>${texteHtml('parametres_btp.installation.disques.titre')}</h2>${disques}` : ''}`;
  }
}
