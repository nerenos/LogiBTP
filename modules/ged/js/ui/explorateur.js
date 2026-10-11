import { echapper } from '@logibtp/socle/ui';
import { icone, formatTaille } from '../src/fichiers.js';
import { versionsVisibles, etapes, ETAPES, GENRES } from '../src/versions.js';
import { rendreApercu, libererApercu, htmlMail } from './apercu.js';
import { DialogueDepot } from './depot.js';

// Explorateur de la GED (classe mère) : liste des documents (d'un élément, ou recherche globale), dépôt par
// sélection ou glisser-déposer, aperçu, informations modifiables (résumé, notes), éditions conservées, historique
// des étapes (recherche de version antérieure), coffre-fort (verrouillage, empreinte, horodatage, vérification),
// suppression par masquage, restauration et purge définitive (administrateur, jamais pour le coffre-fort).
//
// Options : fournisseur, contexte { type_element, id_element, libelle } (null = tous les documents), compact (vue
// simplifiée des fiches), modifiable, admin, utilisateur, message, documentInitial (ID à sélectionner).

const dateFr = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('fr-FR') : '');
const dateHeure = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const opt = (v, l, c) => `<option value="${echapper(v)}" ${String(c ?? '') === String(v) ? 'selected' : ''}>${echapper(l)}</option>`;
const libelleEtape = (code) => ETAPES.find(([c]) => c === code)?.[1] ?? code ?? '';

export class ExplorateurGed {
  constructor(conteneur, { fournisseur, contexte = null, compact = false, modifiable = true, admin = false, utilisateur = '', message, documentInitial = null, coffre = false }) {
    this.conteneur = conteneur;
    this.fournisseur = fournisseur;
    this.contexte = contexte;
    this.compact = compact;
    this.modifiable = modifiable;
    this.admin = admin;
    this.utilisateur = utilisateur;
    this.message = message ?? (() => {});
    this.selection = documentInitial;
    this.recherche = '';
    this.supprimes = false;
    this.coffre = coffre;
    this.documents = [];
    this.#construire();
  }

  #construire() {
    const c = this.conteneur;
    c.classList.add('ged');
    c.classList.toggle('ged-compact', this.compact);
    c.innerHTML = `
      <div class="ged-barre">
        <input type="search" class="ged-recherche" placeholder="Rechercher (titre, mail, résumé, notes…)">
        ${this.modifiable ? '<button type="button" class="principal" data-action="ajouter" title="Ajouter des documents (ou glisser-déposer)">＋ Ajouter</button><input type="file" multiple hidden data-fichiers>' : ''}
        ${this.contexte ? '' : `<label class="ged-option" title="Documents archivés au coffre-fort uniquement"><input type="checkbox" data-coffre${this.coffre ? ' checked' : ''}> Coffre-fort</label>`}
        ${this.admin ? '<label class="ged-option"><input type="checkbox" data-supprimes> Supprimés</label>' : ''}
        ${this.admin && !this.contexte ? '<button type="button" data-action="coffre" title="Vérifier toute la chaîne du coffre-fort">🔒 Vérifier le coffre</button>' : ''}
        <span class="ged-compteur"></span>
      </div>
      <div class="ged-corps">
        <div class="ged-liste"></div>
        <aside class="ged-detail"><p class="aide">Sélectionnez un document, ou déposez des fichiers ici.</p></aside>
      </div>
      <div class="ged-depot-zone" hidden>Déposer pour ajouter${this.contexte?.libelle ? ` à ${echapper(this.contexte.libelle)}` : ''}</div>`;
    this.liste = c.querySelector('.ged-liste');
    this.detail = c.querySelector('.ged-detail');
    let minuterie;
    c.querySelector('.ged-recherche').addEventListener('input', (e) => {
      clearTimeout(minuterie);
      minuterie = setTimeout(() => { this.recherche = e.target.value; this.charger().catch((x) => this.#erreur(x)); }, 300);
    });
    const entree = c.querySelector('[data-fichiers]');
    c.querySelector('[data-action="ajouter"]')?.addEventListener('click', () => entree.click());
    entree?.addEventListener('change', () => { if (entree.files.length) this.deposer(entree.files); entree.value = ''; });
    c.querySelector('[data-coffre]')?.addEventListener('change', (e) => { this.coffre = e.target.checked; this.charger().catch((x) => this.#erreur(x)); });
    c.querySelector('[data-supprimes]')?.addEventListener('change', (e) => { this.supprimes = e.target.checked; this.charger().catch((x) => this.#erreur(x)); });
    c.querySelector('[data-action="coffre"]')?.addEventListener('click', () => this.verifierCoffre().catch((x) => this.#erreur(x)));
    if (this.modifiable) this.#glisserDeposer();
    this.charger().catch((x) => this.#erreur(x));
  }

  /** Glisser-déposer de fichiers depuis l'explorateur du poste ou le client mail, sur tout le composant. */
  #glisserDeposer() {
    const zone = this.conteneur.querySelector('.ged-depot-zone');
    let profondeur = 0;
    const avecFichiers = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    this.conteneur.addEventListener('dragenter', (e) => { if (!avecFichiers(e)) return; e.preventDefault(); profondeur++; zone.hidden = false; });
    this.conteneur.addEventListener('dragover', (e) => { if (avecFichiers(e)) e.preventDefault(); });
    this.conteneur.addEventListener('dragleave', () => { profondeur = Math.max(0, profondeur - 1); if (!profondeur) zone.hidden = true; });
    this.conteneur.addEventListener('drop', (e) => {
      if (!avecFichiers(e)) return;
      e.preventDefault();
      profondeur = 0;
      zone.hidden = true;
      if (e.dataTransfer.files.length) this.deposer(e.dataTransfer.files);
    });
  }

  #erreur(e) {
    console.error(e);
    this.message(e.message ?? String(e), 'erreur');
  }

  async deposer(fichiers) {
    this.parametres ??= await this.fournisseur.parametres();
    new DialogueDepot(fichiers, {
      fournisseur: this.fournisseur, contexte: this.contexte, utilisateur: this.utilisateur, parametres: this.parametres, message: this.message,
      surTermine: (crees) => { this.selection = crees[0]?.id ?? this.selection; this.charger().catch((x) => this.#erreur(x)); },
    });
  }

  // ---------------------------------------------------------------- liste

  async charger() {
    this.parametres ??= await this.fournisseur.parametres();
    const filtre = { recherche: this.recherche, supprimes: this.supprimes, coffre: this.coffre };
    if (this.contexte) Object.assign(filtre, { type_element: this.contexte.type_element, id_element: String(this.contexte.id_element) });
    this.documents = await this.fournisseur.lister(filtre);
    this.#rendreListe();
    if (this.selection !== null) await this.selectionner(this.selection);
  }

  libelleCategorie(code) { return this.parametres?.categories?.find((c) => c.code === code)?.libelle ?? code ?? ''; }

  #rendreListe() {
    const docs = this.documents;
    this.conteneur.querySelector('.ged-compteur').textContent = `${docs.length} document${docs.length > 1 ? 's' : ''}`;
    if (!docs.length) {
      this.liste.innerHTML = `<p class="aide ged-vide">${this.recherche ? 'Aucun document trouvé.' : 'Aucun document.'}${this.modifiable ? ' Glissez des fichiers ici ou utilisez ＋ Ajouter.' : ''}</p>`;
      return;
    }
    // Pièces jointes d'un mail : sous le mail quand il est dans la liste.
    const ids = new Set(docs.map((d) => d.id));
    const racines = docs.filter((d) => !d.parent_id || !ids.has(d.parent_id));
    const ordonnes = racines.flatMap((d) => [d, ...docs.filter((x) => x.parent_id === d.id)]);
    this.liste.innerHTML = `<table class="ged-table"><thead><tr>
        <th></th><th>Titre</th>${this.compact ? '' : '<th>Catégorie</th>'}<th>Date</th>${this.compact ? '' : '<th>Auteur</th><th>Élément</th>'}<th>Taille</th></tr></thead>
      <tbody>${ordonnes.map((d) => `
        <tr data-id="${d.id}" class="${d.id === this.selection ? 'selectionnee' : ''} ${d.supprime ? 'supprime' : ''} ${d.parent_id && ids.has(d.parent_id) ? 'piece' : ''}" draggable="false">
          <td class="ged-ico">${icone(d)}</td>
          <td><span class="ged-titre">${echapper(d.titre)}</span>
            ${d.coffre ? '<span class="ged-badge coffre" title="Coffre-fort : verrouillé, horodaté">🔒</span>' : ''}
            ${d.nb_pieces ? `<span class="ged-badge" title="Pièces jointes">📎 ${d.nb_pieces}</span>` : ''}
            ${d.etat ? `<span class="ged-badge etat">${echapper(libelleEtape(d.etat))}</span>` : ''}
            ${d.version?.numero > 1 ? `<span class="ged-badge" title="Version courante">v${d.version.numero}</span>` : ''}</td>
          ${this.compact ? '' : `<td>${echapper(this.libelleCategorie(d.categorie))}</td>`}
          <td>${dateFr(d.date_document)}</td>
          ${this.compact ? '' : `<td>${echapper(d.auteur ?? '')}</td><td>${echapper(d.type_element ? `${d.type_element} ${d.id_element ?? ''}` : '')}</td>`}
          <td class="nombre">${formatTaille(d.version?.taille)}</td>
        </tr>`).join('')}</tbody></table>`;
    this.liste.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => this.selectionner(Number(tr.dataset.id)).catch((x) => this.#erreur(x))));
  }

  // ---------------------------------------------------------------- détail

  async selectionner(id) {
    this.selection = id;
    this.liste.querySelectorAll('tr.selectionnee').forEach((tr) => tr.classList.remove('selectionnee'));
    this.liste.querySelector(`tr[data-id="${id}"]`)?.classList.add('selectionnee');
    this.doc = await this.fournisseur.document(id);
    this.#rendreDetail();
  }

  #lienContenu(v, telecharger = true) { return this.fournisseur.urlContenu(v.id, { telecharger }); }

  #rendreDetail() {
    const d = this.doc;
    const z = this.detail;
    libererApercu(z.querySelector('.ged-apercu') ?? z);
    const courante = d.versions.at(-1);
    const editable = this.modifiable && !d.supprime;
    const cats = this.parametres.categories ?? [];
    const lecture = !editable || d.coffre;
    const champ = (k, libelle, type = 'text') => `<label>${libelle}<input type="${type}" data-m="${k}" value="${echapper(d[k] ?? '')}" ${lecture ? 'readonly' : ''}></label>`;
    const editions = versionsVisibles(d.versions);
    const historique = etapes(d.versions);
    z.innerHTML = `
      <header class="ged-detail-entete">
        <span class="ged-icone-grande">${icone(d)}</span>
        <div><h3>${echapper(d.titre)}</h3><small>${echapper(this.libelleCategorie(d.categorie))}${d.etat ? ` · ${echapper(libelleEtape(d.etat))}` : ''}
          ${d.supprime ? ` · <b class="erreur">supprimé le ${dateFr(d.supprime_le)} par ${echapper(d.supprime_par ?? '')}</b>` : ''}</small></div>
      </header>
      <div class="ged-actions">
        ${courante ? `<a class="bouton" href="${echapper(this.#lienContenu(courante))}" download="${echapper(courante.nom_fichier)}">⬇ Télécharger</a>` : ''}
        ${editable && !d.coffre ? '<button type="button" data-action="version" title="Remplacer par une nouvelle version (les 5 dernières éditions sont conservées)">⟳ Nouvelle version</button><input type="file" hidden data-version>' : ''}
        ${editable && !d.coffre ? '<button type="button" data-action="etape" title="Enregistrer une étape (validation, envoi, signature…)">✔ Étape</button>' : ''}
        ${editable && !d.coffre ? '<button type="button" data-action="coffre" title="Archiver au coffre-fort : verrouillé, empreinte et horodatage">🔒 Coffre-fort</button>' : ''}
        ${d.coffre ? '<button type="button" data-action="verifier" title="Recalculer l\'empreinte et contrôler la chaîne du coffre-fort">✓ Vérifier l\'intégrité</button>' : ''}
        ${this.modifiable && !d.supprime && (!d.coffre || this.admin) ? '<button type="button" data-action="supprimer" title="Masquer le document (récupérable)">🗑 Supprimer</button>' : ''}
        ${d.supprime && this.modifiable ? '<button type="button" data-action="restaurer">↺ Restaurer</button>' : ''}
        ${d.supprime && this.admin && !d.coffre ? '<button type="button" data-action="purger" class="danger" title="Suppression définitive (administrateur)">Supprimer définitivement</button>' : ''}
      </div>
      <div class="ged-etape-saisie" hidden>
        <select data-etape>${ETAPES.map(([c, l]) => opt(c, l)).join('')}</select>
        <input data-etape-commentaire placeholder="Commentaire (destinataire, signataire…)">
        <label class="ged-option" title="Joindre le fichier de cette étape (ex. devis signé)"><input type="file" data-etape-fichier> </label>
        <button type="button" class="principal" data-action="etape-ok">Enregistrer l'étape</button>
      </div>
      <div class="ged-apercu"></div>
      ${d.parent ? `<p class="ged-lien-mail">📎 Pièce jointe du mail <a href="#" data-ouvrir="${d.parent.id}">${echapper(d.parent.titre)}</a></p>` : ''}
      ${d.pieces?.length ? `<div class="ged-pieces"><b>Pièces jointes du mail</b>${d.pieces.map((p) => `<a href="#" data-ouvrir="${p.id}">${icone(p)} ${echapper(p.titre)}</a>`).join('')}</div>` : ''}
      <details class="ged-section" open><summary>Informations</summary>
        <div class="ged-formulaire">
          ${champ('titre', 'Titre')}
          <label>Catégorie <select data-m="categorie" ${lecture ? 'disabled' : ''}>${opt('', '—', d.categorie)}${cats.map((c) => opt(c.code, c.libelle, d.categorie)).join('')}</select></label>
          ${champ('date_document', 'Date', 'date')}
          ${champ('auteur', 'Auteur')}
          <label>Élément lié <span class="ged-lien"><input data-m="type_element" value="${echapper(d.type_element ?? '')}" size="9" ${lecture ? 'readonly' : ''}>
            <input data-m="id_element" value="${echapper(d.id_element ?? '')}" size="7" ${lecture ? 'readonly' : ''}></span></label>
          <label class="large">Résumé <textarea rows="3" data-m="resume" ${editable ? '' : 'readonly'} placeholder="Résumé du document (saisi par l'utilisateur)">${echapper(d.resume ?? '')}</textarea></label>
          <label class="large">Notes <textarea rows="3" data-m="notes" ${editable ? '' : 'readonly'}>${echapper(d.notes ?? '')}</textarea></label>
        </div>
        <p class="aide">Créé le ${dateHeure(d.cree_le)} par ${echapper(d.cree_par ?? '')}${d.modifie_le ? ` · modifié le ${dateHeure(d.modifie_le)}` : ''}</p>
      </details>
      ${d.coffre ? `<details class="ged-section"><summary>Coffre-fort</summary>
        <dl class="ged-coffre">${(d.journal_coffre ?? []).map((e) => `
          <dt>Archivé le</dt><dd>${dateHeure(e.horodatage)} par ${echapper(e.utilisateur)}${e.motif ? ` · ${echapper(e.motif)}` : ''}</dd>
          <dt>Empreinte (SHA-256)</dt><dd><code>${e.empreinte_document}</code></dd>
          <dt>Entrée du journal</dt><dd><code>${e.empreinte_entree}</code></dd>`).join('')}</dl>
        <p class="ged-verification aide"></p></details>` : ''}
      <details class="ged-section" ${this.compact ? '' : 'open'}><summary>Versions (${editions.length})</summary>
        <table class="ged-versions">${editions.map((v) => `<tr><td>v${v.numero}</td><td>${dateHeure(v.date)}</td><td>${echapper(v.auteur)}</td>
          <td>${echapper(v.nom_fichier)}</td><td class="nombre">${formatTaille(v.taille)}</td>
          <td><a href="${echapper(this.#lienContenu(v))}" download="${echapper(v.nom_fichier)}" title="Télécharger">⬇</a>
            <a href="#" data-apercu="${v.id}" title="Aperçu">👁</a></td></tr>`).join('')}</table>
        <p class="aide">Les ${this.parametres.editions_conservees} dernières éditions sont conservées.</p>
      </details>
      <details class="ged-section"><summary>Historique des étapes (${historique.length})</summary>
        <input type="search" data-filtre-etapes placeholder="Rechercher une version antérieure (étape, état, auteur, date…)">
        <table class="ged-versions ged-etapes">${historique.map((v) => `<tr data-texte="${echapper(`${libelleEtape(v.etape)} ${v.etat ?? ''} ${v.auteur} ${dateHeure(v.date)} ${v.commentaire ?? ''}`.toLowerCase())}">
          <td>v${v.numero}</td><td>${dateHeure(v.date)}</td><td>${echapper(v.auteur)}</td><td><b>${echapper(libelleEtape(v.etape))}</b></td>
          <td>${echapper(v.etat ?? '')}</td><td>${echapper(v.commentaire ?? '')}</td>
          <td><a href="${echapper(this.#lienContenu(v))}" download="${echapper(v.nom_fichier)}" title="Télécharger">⬇</a>
            <a href="#" data-apercu="${v.id}" title="Aperçu">👁</a></td></tr>`).join('') || '<tr><td class="aide">Aucune étape enregistrée.</td></tr>'}</table>
      </details>`;

    const apercu = z.querySelector('.ged-apercu');
    this.#apercu(apercu, courante);
    z.querySelectorAll('[data-apercu]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      this.#apercu(apercu, d.versions.find((v) => v.id === Number(a.dataset.apercu)));
      apercu.scrollIntoView({ block: 'nearest' });
    }));
    z.querySelectorAll('[data-ouvrir]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.selectionner(Number(a.dataset.ouvrir)).catch((x) => this.#erreur(x)); }));
    z.querySelectorAll('[data-m]').forEach((el) => el.addEventListener('change', () => this.#modifier({ [el.dataset.m]: el.value }).catch((x) => this.#erreur(x))));
    z.querySelector('[data-filtre-etapes]')?.addEventListener('input', (e) => {
      const t = e.target.value.toLowerCase();
      z.querySelectorAll('.ged-etapes tr[data-texte]').forEach((tr) => { tr.hidden = !!t && !tr.dataset.texte.includes(t); });
    });
    const action = (nom, f) => z.querySelector(`[data-action="${nom}"]`)?.addEventListener('click', () => Promise.resolve(f()).catch((x) => this.#erreur(x)));
    const entreeVersion = z.querySelector('[data-version]');
    action('version', () => entreeVersion.click());
    entreeVersion?.addEventListener('change', async () => {
      const f = entreeVersion.files[0];
      if (!f) return;
      this.doc = await this.fournisseur.nouvelleVersion(d.id, { fichier: f, genre: GENRES.EDITION, commentaire: 'Nouvelle version' });
      this.message('Nouvelle version enregistrée', 'succes');
      await this.charger();
    });
    action('etape', () => { z.querySelector('.ged-etape-saisie').hidden = !z.querySelector('.ged-etape-saisie').hidden; });
    action('etape-ok', async () => {
      const etape = z.querySelector('[data-etape]').value;
      const commentaire = z.querySelector('[data-etape-commentaire]').value || null;
      const f = z.querySelector('[data-etape-fichier]').files[0];
      if (f) await this.fournisseur.nouvelleVersion(d.id, { fichier: f, genre: GENRES.ETAPE, etape, etat: etape, commentaire });
      else await this.fournisseur.etape(d.id, { etape, etat: etape, commentaire });
      this.message(`Étape « ${libelleEtape(etape)} » enregistrée`, 'succes');
      await this.charger();
    });
    action('coffre', async () => {
      const motif = prompt('Archivage au coffre-fort : le document sera verrouillé (ni modification ni suppression).\nMotif :', this.libelleCategorie(d.categorie) || 'Archivage');
      if (motif === null) return;
      await this.fournisseur.mettreAuCoffre(d.id, motif);
      this.message('Document archivé au coffre-fort', 'succes');
      await this.charger();
    });
    action('verifier', async () => {
      const r = await this.fournisseur.verifier(d.id);
      const p = z.querySelector('.ged-verification');
      z.querySelector('.ged-section:has(.ged-coffre)')?.setAttribute('open', '');
      p.className = `ged-verification ${r.integre && r.coffre?.ok !== false ? 'ok' : 'erreur'}`;
      p.textContent = r.integre
        ? `✓ Intègre : empreinte recalculée identique${r.coffre ? (r.coffre.ok ? `, chaîne du coffre-fort valide (${r.coffre.entrees} entrées)` : ` — chaîne rompue : ${r.coffre.rupture?.raison}`) : ''}`
        : `✗ Altéré : empreinte attendue ${r.empreinte_attendue}, calculée ${r.empreinte_calculee}`;
    });
    action('supprimer', async () => {
      if (!confirm(`Supprimer « ${d.titre} » ? Le document est masqué, il reste récupérable${d.nb_pieces ? ' (ses pièces jointes aussi)' : ''}.`)) return;
      await this.fournisseur.supprimer(d.id);
      this.message('Document supprimé (masqué)', 'succes');
      this.selection = this.supprimes ? d.id : null;
      if (!this.supprimes) this.detail.innerHTML = '<p class="aide">Document supprimé.</p>';
      await this.charger();
    });
    action('restaurer', async () => { await this.fournisseur.restaurer(d.id); this.message('Document restauré', 'succes'); await this.charger(); });
    action('purger', async () => {
      if (!confirm(`Supprimer DÉFINITIVEMENT « ${d.titre} » et toutes ses versions ? Cette action est irréversible.`)) return;
      await this.fournisseur.purger(d.id);
      this.message('Document supprimé définitivement', 'succes');
      this.selection = null;
      this.detail.innerHTML = '<p class="aide">Document supprimé définitivement.</p>';
      await this.charger();
    });
  }

  #apercu(zone, version) {
    rendreApercu(zone, {
      fournisseur: this.fournisseur, doc: this.doc, version, tailleMax: this.parametres.taille_apercu_max,
      urlTelechargement: version ? this.#lienContenu(version) : null,
    }).catch((e) => { zone.innerHTML = `<p class="erreur">Aperçu impossible : ${echapper(e.message)}</p>`; });
  }

  async #modifier(meta) {
    this.doc = await this.fournisseur.modifier(this.doc.id, meta);
    const i = this.documents.findIndex((x) => x.id === this.doc.id);
    if (i >= 0) { this.documents[i] = { ...this.documents[i], ...meta }; this.#rendreListe(); }
    this.message('Informations enregistrées', 'succes');
  }

  async verifierCoffre() {
    const r = await this.fournisseur.verifierCoffre();
    this.message(r.ok ? `Coffre-fort intègre : ${r.entrees} entrée(s), chaîne valide` : `Coffre-fort : ${r.rupture.raison} à l'entrée ${r.rupture.index + 1}`, r.ok ? 'succes' : 'erreur');
  }

  detruire() {
    libererApercu(this.detail.querySelector('.ged-apercu') ?? this.detail);
  }
}

export { htmlMail };
