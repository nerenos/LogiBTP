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
  icone = '📥';

  get format() { return formatImport('OptimBTP'); }

  async ouvrir() {
    this.titre = 'Import d\'un devis OptimBTP';
    this.conteneur.innerHTML = `<div class="page-simple page-import">
      <h1 class="page-titre">📥 Import d'un devis OptimBTP</h1>
      <p class="aide">Fichier <code>.optim</code> exporté d'OptimBTP (archive contenant le devis en XML). Le devis importé s'ouvre dans une
        nouvelle fenêtre pour être vérifié avant sa création ; le fichier est ensuite conservé dans les pièces du devis.</p>
      <label class="import-depot"><input type="file" accept="${this.format.extensions}" hidden>
        <span>Déposez le fichier ici ou <u>choisissez-le</u></span></label>
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
    if (!v) throw new Error('Fichier source introuvable dans la GED');
    await this.lire(await ged.contenu(v.id), v.nom_fichier ?? doc.titre);
  }

  async lire(fichier, nom) {
    this.apercu.innerHTML = '<p class="aide">Lecture du fichier…</p>';
    try {
      this.devis = await this.format.lire(await fichier.arrayBuffer());
      this.fichier = fichier;
      this.nomFichier = nom;
      this.afficherApercu();
    } catch (e) {
      this.devis = null;
      this.apercu.innerHTML = `<p class="erreur">Fichier illisible : ${echapper(e.message)}</p>`;
    }
  }

  afficherApercu() {
    const d = this.devis;
    const compte = (t) => d.lignes.filter((l) => l.type === t).length;
    const intervenants = d.intervenants.map((i) => `${echapper(i.nom ?? i.interlocuteur ?? '')} (${i.roles.join(', ').toLowerCase() || 'sans rôle'})`).join(' ; ');
    this.apercu.innerHTML = `
      <section class="import-resume">
        <h2>${echapper(d.entete.objet ?? 'Devis sans objet')}</h2>
        <dl>
          <dt>Fichier</dt><dd>${echapper(this.nomFichier)} — référence ${echapper(d.entete.reference ?? '?')}${d.entete.date ? `, du ${formatDate(d.entete.date)}` : ''}</dd>
          <dt>Lignes</dt><dd>${compte('TITRE')} titre(s), ${compte('OUVRAGE')} ouvrage(s), ${compte('ELEMENT')} élément(s), ${compte('TEXTE')} texte(s)</dd>
          <dt>Total d'origine</dt><dd>${formatNombre(d.entete.controle.total_ht, 2)} € HT — ${formatNombre(d.entete.controle.total_ttc, 2)} € TTC</dd>
          <dt>Rédacteur</dt><dd>${echapper(d.entete.redacteur ?? '—')}</dd>
          <dt>Intervenants</dt><dd>${intervenants || '<i>aucun</i>'}</dd>
          <dt>Non repris</dt><dd>${d.non_repris.length} champ(s) — détail dans le devis importé, en mode débogage</dd>
        </dl>
        ${d.avertissements.length ? `<ul class="import-avertissements">${d.avertissements.map((a) => `<li>⚠ ${echapper(a)}</li>`).join('')}</ul>` : ''}
        <div class="boutons"><button type="button" class="principal" data-action="verifier" title="Ouvre le devis importé dans une nouvelle fenêtre, sans l'enregistrer">🔍 Vérifier le devis importé</button></div>
      </section>`;
    this.apercu.querySelector('[data-action="verifier"]').addEventListener('click', () => this.verifier().catch((x) => this.app.erreur(x)));
  }

  /** Ouvre le devis importé dans une nouvelle fenêtre (dépôt temporaire du fichier dans le navigateur). */
  async verifier() {
    const jeton = await deposerImport({ format: 'OptimBTP', nom_fichier: this.nomFichier, fichier: this.fichier });
    await this.app.naviguer(`/document/import?jeton=${jeton}`, { nouvelleFenetre: true });
  }
}
