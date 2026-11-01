import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, formatDate } from '@logibtp/socle/ui';
import { formatImport } from '../import/formats.js';
import { deposerImport } from '../import/depot-import.js';
import { derniereVersionGed } from '../documents/tracabilite.js';

/**
 * Import d'un devis OptimBTP (/import/optimbtp ; ?ged=<id> : réutilisation d'un fichier source conservé dans la GED).
 * Le fichier est lu dans le navigateur (module Import) ; « Vérifier le devis » l'ouvre dans une nouvelle fenêtre comme
 * un brouillon non enregistré, que l'utilisateur contrôle avant de le créer.
 */
export class PageImportOptim extends PageBase {
  icone = icone('import_btp_import');

  get format() { return formatImport('OptimBTP'); }

  async ouvrir() {
    this.titre = texte('import_btp.routes.optim');
    this.conteneur.innerHTML = `<div class="page-simple page-import">
      <h1 class="page-titre">${iconeHtml('import_btp_import')} ${texteHtml('import_btp.routes.optim')}</h1>
      <p class="aide">${texteHtml('import_btp.page.aide_html')}</p>
      <label class="import-depot"><input type="file" accept="${this.format.extensions}" hidden>
        <span>${texteHtml('import_btp.page.depot_html')}</span></label>
      <div class="import-apercu"></div>
    </div>`;
    const depot = this.conteneur.querySelector('.import-depot');
    const entree = depot.querySelector('input');
    entree.addEventListener('change', () => entree.files[0] && this.lire(entree.files[0], entree.files[0].name));
    depot.addEventListener('dragover', (e) => { e.preventDefault(); depot.classList.add('survol'); });
    depot.addEventListener('dragleave', () => depot.classList.remove('survol'));
    depot.addEventListener('drop', (e) => {
      e.preventDefault();
      depot.classList.remove('survol');
      const f = e.dataTransfer.files[0];
      if (f) this.lire(f, f.name);
    });
    if (this.requete.ged) await this.lireDepuisGed(Number(this.requete.ged));
    this.app.majPage();
  }

  get apercu() { return this.conteneur.querySelector('.import-apercu'); }

  /** Réutilisation de l'import d'un document : fichier source conservé dans la GED. */
  async lireDepuisGed(id) {
    const ged = (await this.app.services()).ged;
    const doc = await ged.document(id);
    const v = await derniereVersionGed(ged, id);
    if (!v) throw new Error(texte('import_btp.page.source_introuvable'));
    await this.lire(await ged.contenu(v.id), v.nom_fichier ?? doc.titre);
  }

  async lire(fichier, nom) {
    this.apercu.innerHTML = `<p class="aide">${texteHtml('import_btp.page.lecture')}</p>`;
    try {
      this.devis = await this.format.lire(await fichier.arrayBuffer());
      this.fichier = fichier;
      this.nomFichier = nom;
      this.afficherApercu();
    } catch (e) {
      this.devis = null;
      this.apercu.innerHTML = `<p class="erreur">${texteHtml('import_btp.page.illisible', { message: e.message })}</p>`;
    }
  }

  afficherApercu() {
    const d = this.devis;
    const compte = (t) => d.lignes.filter((l) => l.type === t).length;
    const intervenants = d.intervenants.map((i) => `${echapper(i.nom ?? i.interlocuteur ?? '')} (${echapper(i.roles.join(', ').toLowerCase()) || texteHtml('import_btp.page.sans_role')})`).join(' ; ');
    this.apercu.innerHTML = `
      <section class="import-resume">
        <h2>${echapper(d.entete.objet ?? texte('import_btp.page.sans_objet'))}</h2>
        <dl>
          <dt>${texteHtml('import_btp.page.fichier')}</dt><dd>${texteHtml('import_btp.page.fichier_valeur', { fichier: this.nomFichier, reference: d.entete.reference ?? '?' })}${d.entete.date ? `${texteHtml('import_btp.page.du', { date: formatDate(d.entete.date) })}` : ''}</dd>
          <dt>${texteHtml('import_btp.page.lignes')}</dt><dd>${texteHtml('import_btp.page.lignes_valeur', { titres: compte('TITRE'), ouvrages: compte('OUVRAGE'), elements: compte('ELEMENT'), textes: compte('TEXTE') })}</dd>
          <dt>${texteHtml('import_btp.page.total')}</dt><dd>${texteHtml('import_btp.page.total_valeur', { ht: formatNombre(d.entete.controle.total_ht, 2), ttc: formatNombre(d.entete.controle.total_ttc, 2) })}</dd>
          <dt>${texteHtml('import_btp.page.redacteur')}</dt><dd>${echapper(d.entete.redacteur ?? '—')}</dd>
          <dt>${texteHtml('import_btp.page.intervenants')}</dt><dd>${intervenants || `<i>${texteHtml('import_btp.page.aucun')}</i>`}</dd>
          <dt>${texteHtml('import_btp.page.non_repris')}</dt><dd>${texteHtml('import_btp.page.non_repris_valeur', { nombre: d.non_repris.length })}</dd>
        </dl>
        ${d.avertissements.length ? `<ul class="import-avertissements">${d.avertissements.map((a) => `<li>${iconeHtml('avertissement')} ${echapper(a)}</li>`).join('')}</ul>` : ''}
        <div class="boutons"><button type="button" class="principal" data-action="verifier" title="${texteHtml('import_btp.page.verifier_aide')}">${iconeHtml('import_btp_verifier')} ${texteHtml('import_btp.page.verifier')}</button></div>
      </section>`;
    this.apercu.querySelector('[data-action="verifier"]').addEventListener('click', () => this.verifier().catch((x) => this.app.erreur(x)));
  }

  /** Ouvre le devis importé dans une nouvelle fenêtre (dépôt temporaire du fichier dans le navigateur). */
  async verifier() {
    const jeton = await deposerImport({ format: 'OptimBTP', nom_fichier: this.nomFichier, fichier: this.fichier });
    await this.app.naviguer(`/document/import?jeton=${jeton}`, { nouvelleFenetre: true });
  }
}
