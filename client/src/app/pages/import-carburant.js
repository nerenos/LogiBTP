import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { lireFichierCarburant } from '@logibtp/import';
import { formatImport } from '../import/formats.js';
import { importerCarburant } from '../import/carburant-import.js';
import { rapportCarburant } from '../import/rapport-import.js';

/**
 * Import d'un fichier de cartes carburant (/import/carburant, plan materiel-suites lot 10b) : même parcours que l'import
 * d'un devis (dépôt du fichier, aperçu), puis écriture des pleins par le serveur et compte rendu (écrits, doublons,
 * cartes non rapprochées, lignes en erreur).
 */
export class PageImportCarburant extends PageBase {
  icone = icone('navigation_btp_import_carburant');

  get format() { return formatImport('CartesCarburant'); }

  async ouvrir() {
    this.titre = texte('import_btp.routes.carburant');
    this.conteneur.innerHTML = `<div class="page-simple page-import">
      <h1 class="page-titre">${iconeHtml('navigation_btp_import_carburant')} ${texteHtml('import_btp.routes.carburant')}</h1>
      <p class="aide">${texteHtml('import_btp.carburant.aide_html')}</p>
      <label class="import-depot"><input type="file" accept="${this.format.extensions}" hidden>
        <span>${texteHtml('import_btp.page.depot_html')}</span></label>
      <div class="import-apercu"></div>
    </div>`;
    const depot = this.conteneur.querySelector('.import-depot');
    const entree = depot.querySelector('input');
    entree.addEventListener('change', () => entree.files[0] && this.lire(entree.files[0]));
    depot.addEventListener('dragover', (e) => { e.preventDefault(); depot.classList.add('survol'); });
    depot.addEventListener('dragleave', () => depot.classList.remove('survol'));
    depot.addEventListener('drop', (e) => {
      e.preventDefault();
      depot.classList.remove('survol');
      const f = e.dataTransfer.files[0];
      if (f) this.lire(f);
    });
    this.app.majPage();
  }

  get apercu() { return this.conteneur.querySelector('.import-apercu'); }

  async lire(fichier) {
    this.apercu.innerHTML = `<p class="aide">${texteHtml('import_btp.page.lecture')}</p>`;
    try {
      this.contenu = await fichier.text();
      const lecture = lireFichierCarburant(this.contenu);
      this.apercu.innerHTML = `<section class="import-resume">
        <p>${texteHtml('import_btp.carburant.lecture_resume', { fichier: fichier.name, nombre: lecture.pleins.length, erreurs: lecture.erreurs.length })}</p>
        <div class="boutons"><button type="button" class="principal" data-action="importer" title="${texteHtml('import_btp.carburant.importer_aide')}" ${lecture.pleins.length ? '' : 'disabled'}>${iconeHtml('import_btp_import')} ${texteHtml('import_btp.carburant.importer')}</button></div>
        <div class="import-rapport"></div></section>`;
      this.apercu.querySelector('[data-action="importer"]').addEventListener('click', () => this.importer().catch((x) => this.app.erreur(x)));
    } catch (e) {
      this.apercu.innerHTML = `<p class="erreur">${texteHtml('import_btp.page.illisible', { message: e.message })}</p>`;
    }
  }

  /** Écrit les pleins et affiche le compte rendu (un second clic ne réécrit rien : les doublons sont ignorés). */
  async importer() {
    const bouton = this.apercu.querySelector('[data-action="importer"]');
    bouton.disabled = true;
    const rapport = await importerCarburant(this.contenu);
    this.apercu.querySelector('.import-rapport').innerHTML = `<p class="aide">${texteHtml('import_btp.carburant.resume', {
      ecrits: rapport.ecrits, doublons: rapport.doublons.length, non_rapproches: rapport.non_rapproches.length, erreurs: rapport.erreurs.length })}</p>${rapportCarburant(rapport)}`;
    bouton.disabled = false;
  }
}
