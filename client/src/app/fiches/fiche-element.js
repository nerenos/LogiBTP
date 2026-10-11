import { MODES } from '@logibtp/fiche';
import { echapper, formatNombre } from '@logibtp/socle/ui';
import { OngletPrix, OngletUnites, OngletTarifs } from '@logibtp/bibliotheque/ui';
import { PanneauMetre } from '@logibtp/metre/ui';
import { EditeurDevisBtp, DictionnaireBtp } from '../editeur-btp.js';
import { calculerOuvrage, documentComposition, racineComposition } from '../bibliotheque/bibliotheque.js';
import { FicheLogiBTP } from './fiches.js';

// Fiche d'un élément de bibliothèque (module Fiche + module Bibliothèque) : référentiels en listes déroulantes,
// onglets Prix (scénarios, coefficients, remise, historique), Unités (correspondances par formule), Tarifs
// fournisseurs, Composition des ouvrages (éditeur de devis et métrés), Image et notices techniques (GED, DOE).

const json = (v, defaut) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return defaut; } })() : v ?? defaut);
const prix = (v) => (v === null || v === undefined || v === '' ? '—' : formatNombre(v, Math.abs(Number(v)) < 10 ? 4 : 2));
const L = (o) => ({ lig_ent_id: 0, lig_proprietes: {}, lig_coef_remise: 1, lig_precision_qte: 2, lig_precision_pv: 2, lig_type_prix: 'V', lig_qte_source: 'S', lig_coef_perte: 1, ...o });

export class FicheElement extends FicheLogiBTP {
  /** options.services : { bibliotheque, ged } ; options.definitionDocument() : définition du document de composition. */
  constructor(options) {
    super(options);
    this.services = options.services;
    this.definitionDocument = options.definitionDocument;
    this.utilisateur = options.utilisateur ?? 'demo';
    this.admin = options.admin ?? false;
  }

  get bibliotheque() { return this.services.bibliotheque; }

  async ouvrir() {
    const b = this.bibliotheque;
    const [bibliotheques, familles, natures, regroupements, unites, parametres] = await Promise.all([
      b.bibliotheques(), b.familles(), b.natures(), b.regroupements(), b.unites(), b.parametres()]);
    this.referentiels = { bibliotheques, familles, natures, regroupements, unites, parametres };
    await super.ouvrir();
    await this.#chargerImage();
  }

  valeursCreation() {
    const { bibliotheques, parametres } = this.referentiels;
    const type = new URLSearchParams(globalThis.location?.search ?? '').get('type') === 'OUVRAGE' ? 'OUVRAGE' : 'ARTICLE';
    return {
      ...super.valeursCreation(), type, bib_id: (bibliotheques.find((x) => x.defaut) ?? bibliotheques[0])?.id ?? null,
      scenario_pa: parametres.scenario_defaut, coef_fg: String(parametres.coef_fg_defaut), coef_benef: String(parametres.coef_benef_defaut), unites: [],
    };
  }

  sousTitre(v) {
    const bib = this.referentiels.bibliotheques.find((b) => b.id === Number(v.bib_id));
    const fam = this.referentiels.familles.find((f) => f.id === Number(v.fam_id));
    return [bib && `${bib.code} – ${bib.libelle}`, fam?.chemin, v.type === 'OUVRAGE' ? 'Ouvrage' : 'Article'].filter(Boolean).join(' · ');
  }

  /** Nature isolant : le groupe Isolation (R, λ, U) n'apparaît que pour elle. */
  estIsolant() {
    return this.referentiels.natures.find((n) => n.id === Number(this.valeur('nat_id')))?.isolant === true;
  }

  sections() {
    const isolant = this.estIsolant();
    return super.sections().map((s) => (s.groupes ? { ...s, groupes: s.groupes.filter((g) => g.code !== 'isolation' || isolant) } : s))
      .map((s) => (s.groupes ? { ...s, champs: s.groupes.flatMap((g) => g.champs) } : s));
  }

  /** Encart : image de l'élément et prix par unité de stock. */
  rendreInformations(v) {
    if (this.id === null) return '';
    return `${this.urlImage ? `<img class="element-vignette" src="${echapper(this.urlImage)}" alt="">` : ''}
      <span class="info"><small>PA</small>${prix(v.pa)}</span><span class="info"><small>PR</small>${prix(v.pr)}</span>
      <span class="info"><small>PV net / ${echapper(v.unite_stock ?? '')}</small><b>${prix(v.pv_net)}</b></span>`;
  }

  /** Bibliothèque, famille (selon la bibliothèque) et nature : listes déroulantes des référentiels. */
  rendreChamp(champ, valeur) {
    // Isolation : l'épaisseur est celle des données techniques ; R calculé proposé (épaisseur en m / λ).
    if (champ.code === 'isolant_epaisseur') return super.rendreChamp({ ...champ, lecture_seule: true }, this.valeur('epaisseur'));
    if (champ.code === 'isolant_r') {
      const el = super.rendreChamp(champ, valeur);
      const e = Number(String(this.valeur('epaisseur') ?? '').replace(',', '.'));
      const l = Number(String(this.valeur('isolant_lambda') ?? '').replace(',', '.'));
      if (e > 0 && l > 0) {
        const r = Math.round((e / 1000 / l) * 100) / 100;
        const bloc = document.createElement('div');
        bloc.className = 'element-r';
        bloc.append(el);
        bloc.insertAdjacentHTML('beforeend', `<small class="aide">e / λ = ${String(r).replace('.', ',')}</small>`);
        return bloc;
      }
      return el;
    }
    if (!champ.reference) return super.rendreChamp(champ, valeur);
    const { bibliotheques, familles, natures, regroupements } = this.referentiels;
    const bib = Number(this.valeur('bib_id'));
    const options = {
      bibliotheque: bibliotheques.filter((b) => b.actif || b.id === Number(valeur)).map((b) => [b.id, `${b.code} – ${b.libelle}`]),
      famille: familles.filter((f) => f.bib_id === bib).map((f) => [f.id, f.chemin]),
      nature: natures.filter((n) => n.actif || n.id === Number(valeur)).map((n) => [n.id, `${n.libelle}${n.regroupement ? ` (${regroupements.find((r) => r.code === n.regroupement)?.libelle ?? n.regroupement})` : ''}`]),
    }[champ.reference];
    const lecture = !this.estEnSaisie() || (champ.saisie === 'creation' && this.mode === MODES.MODIFICATION);
    const el = document.createElement('select');
    el.className = 'fiche-saisie-champ';
    el.innerHTML = `<option value=""></option>${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(valeur ?? '') ? 'selected' : ''}>${echapper(l)}</option>`).join('')}`;
    el.disabled = lecture;
    el.addEventListener('change', () => {
      this.definirValeur(champ.code, el.value === '' ? null : el.value);
      if (champ.code === 'bib_id') { this.definirValeur('fam_id', null); this.rendre(); }
      if (champ.code === 'nat_id') this.rendre(); // groupe Isolation selon la nature
    });
    return el;
  }

  #contexte(modifiable) {
    return {
      valeur: (c) => this.valeur(c), definir: (c, v) => this.definirValeur(c, v), valeurs: () => ({ ...this.valeurs(), proprietes: this.proprietes() }),
      modifiable, id: this.id, fournisseur: this.bibliotheque, message: this.message, unites: this.referentiels.unites, parametres: this.referentiels.parametres,
      donnees: (this.definition.supplementaires ?? []).filter((s) => s.type === 'nombre').map((s) => ({ code: s.code, libelle: s.libelle })),
      surPrix: (p) => { Object.assign(this.fiche.valeurs, { pa: p.pa, pr: p.pr, pv: p.pv, coef_benef: p.coef_benef, pv_net: p.pv_net }); this.#majInformations(); },
    };
  }

  #majInformations() {
    const zone = this.conteneur.querySelector('.fiche-informations');
    const html = this.rendreInformations(this.valeurs());
    zone.hidden = !html;
    zone.innerHTML = html;
  }

  ongletsSpecifiques() {
    const ouvrage = this.valeur('type') === 'OUVRAGE';
    return [
      { code: 'prix', titre: 'Prix', champs: ['scenario_pa', 'pa_fixe', 'dernier_pa', 'pmp', 'coef_fg', 'coef_benef', 'pv', 'pv_fixe', 'coef_remise', 'commentaire_prix'],
        rendre: (corps, { modifiable }) => new OngletPrix(corps, this.#contexte(modifiable)) },
      { code: 'unites', titre: 'Unités', champs: ['unite_stock', 'unite_achat', 'unite_vente', 'unites'], rendre: (corps, { modifiable }) => new OngletUnites(corps, this.#contexte(modifiable)) },
      ...(ouvrage
        ? [{ code: 'composition', titre: 'Composition', champs: ['composition'], rendre: (corps, { modifiable }) => this.#composition(corps, modifiable).catch((e) => this.message(e.message, 'erreur')) }]
        : [{ code: 'tarifs', titre: 'Tarifs fournisseurs', rendre: (corps, { modifiable }) => new OngletTarifs(corps, this.#contexte(modifiable)) }]),
      // Image et notices : sous les groupes de l'onglet Article.
      { code: 'image', dans: 'article', titre: 'Image et notices', champs: ['image_ged'], rendre: (corps, { modifiable }) => this.#imageNotices(corps, modifiable).catch((e) => this.message(e.message, 'erreur')) },
    ];
  }

  // ---------------------------------------------------------------- composition d'un ouvrage

  #compositionInitiale() {
    return {
      mode: 'D', metres: [], metre_lignes: [], variables: [],
      lignes: [L({ lig_id: 1, lig_parent_id: null, lig_ordre: 1, lig_tyl_id: 2, lig_libelle_html: this.valeur('libelle_html') || 'Ouvrage', lig_qte: 1, lig_unt_code: this.valeur('unite_stock') ?? 'u' })],
    };
  }

  /** Éditeur de devis sur la composition (lignes, métrés F4, variables) ; prix recalculés en direct. */
  async #composition(corps, modifiable) {
    const composition = json(this.valeur('composition'), null) ?? this.#compositionInitiale();
    corps.innerHTML = `<div class="element-composition">
      <div class="element-composition-barre">
        <label>Calcul de l'ouvrage <select data-mode ${modifiable ? '' : 'disabled'}><option value="D">Déboursé : PR des composantes × coefficients de l'élément</option><option value="V">Somme des PV des composantes</option></select></label>
        ${modifiable ? '<button type="button" data-article>＋ Article de la bibliothèque</button>' : ''}
        <span class="element-composition-totaux"></span>
      </div>
      <div class="element-composition-grille"></div>
      <p class="aide">Quantités par unité d'ouvrage (${echapper(this.valeur('unite_stock') ?? '?')}). F4 sur une composante : métré. Les coefficients de l'élément (onglet Prix) s'appliquent à l'ouvrage.</p>
      <aside class="tiroir element-metre" hidden></aside></div>`;
    corps.querySelector('[data-mode]').value = composition.mode ?? 'D';
    const definition = await this.definitionDocument();
    // Le métré est créé après l'éditeur, qui signale déjà sa sélection à sa construction.
    let metre = null;
    const editeur = new EditeurDevisBtp(corps.querySelector('.element-composition-grille'), {
      definition,
      saisie: { document: documentComposition(composition.mode), lignes: composition.lignes, metres: composition.metres ?? [], metre_lignes: composition.metre_lignes ?? [], variables: composition.variables ?? [] },
      surSelection: (id) => metre?.suivre(id), surMessage: (t) => this.message(t), ouvrirMetre: (ligId, mtrId) => metre.ouvrir(ligId, mtrId),
    });
    metre = new PanneauMetre(corps.querySelector('.element-metre'), editeur, {
      fermer: (ligId) => { editeur.grille.selectionner(ligId, { colonne: 3 }); editeur.grille.focus(); }, message: (t) => this.message(t), dictionnaire: new DictionnaireBtp(editeur),
    });
    editeur.magasin.lectureSeule = !modifiable;
    editeur.magasin.surRefus = () => this.message('Passez la fiche en modification pour changer la composition', 'avertissement');
    const mode = () => corps.querySelector('[data-mode]').value;
    const totaux = () => {
      const c = { mode: mode(), lignes: editeur.saisie.lignes, metres: editeur.saisie.metres, metre_lignes: editeur.saisie.metre_lignes, variables: editeur.saisie.variables };
      let r;
      try { r = calculerOuvrage(c, { coef_fg: this.valeur('coef_fg'), coef_benef: this.valeur('coef_benef'), coef_remise: this.valeur('coef_remise') }); } catch (e) { r = { erreur: e.message }; }
      corps.querySelector('.element-composition-totaux').innerHTML = r.erreur ? `<span class="erreur">${echapper(r.erreur)}</span>`
        : `PA ${prix(r.pa)} · PR ${prix(r.pr)} · PV ${prix(r.pv)} · <b>PV net ${prix(r.pv_net)}</b> / ${echapper(this.valeur('unite_stock') ?? '')}`;
      return c;
    };
    editeur.magasin.abonner(() => this.definirValeur('composition', totaux()));
    corps.querySelector('[data-mode]').addEventListener('change', () => this.definirValeur('composition', totaux()));
    corps.querySelector('[data-article]')?.addEventListener('click', () => this.#choisirArticle((e) => {
      const racine = racineComposition(editeur.saisie.lignes);
      if (!racine) return;
      editeur.magasin.modifier((d) => {
        const l = editeur.nouvelleLigne(editeur.magasin.prochainId(), 3, 0);
        const ordre = Math.max(0, ...d.lignes.filter((x) => x.lig_parent_id === racine.lig_id).map((x) => x.lig_ordre)) + 1;
        Object.assign(l, {
          lig_parent_id: racine.lig_id, lig_ordre: ordre, lig_libelle_html: e.libelle_html, lig_unt_code: e.unite_stock, lig_qte: 1, lig_qte_type: 'R',
          lig_pa: e.pa === null ? null : Number(e.pa), lig_coef_fg: Number(e.coef_fg), lig_coef_benef: Number(e.coef_benef),
          lig_proprietes: { element: { id: e.id, bib: e.bib_code, code: e.code } },
        });
        d.lignes.push(l);
      }, `Composante ${e.code}`);
      this.message(`${e.code} ajouté à la composition`);
    }));
    totaux();
  }

  /** Recherche d'un article de la bibliothèque (code ou libellé). */
  #choisirArticle(choisir) {
    const fond = document.createElement('div');
    fond.className = 'fiche-dialogue-fond';
    fond.innerHTML = `<section class="fiche-dialogue element-recherche" role="dialog" aria-label="Article de la bibliothèque">
      <header><h2>Article de la bibliothèque</h2><button type="button" data-fermer>✕</button></header>
      <input type="search" placeholder="Code ou libellé…" autofocus><div class="element-resultats"></div></section>`;
    document.body.append(fond);
    const fermer = () => fond.remove();
    fond.querySelector('[data-fermer]').addEventListener('click', fermer);
    fond.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); fermer(); } });
    const zone = fond.querySelector('.element-resultats');
    let resultats = [];
    const chercher = async (texte) => {
      resultats = await this.bibliotheque.rechercher({ recherche: texte, type: 'ARTICLE' });
      zone.innerHTML = resultats.length ? `<table class="bib-table"><thead><tr><th>Code</th><th>Libellé</th><th>U.</th><th>PA</th><th>PV net</th></tr></thead><tbody>
        ${resultats.map((e, i) => `<tr data-i="${i}" tabindex="0"><td><b>${echapper(e.bib_code)}:${echapper(e.code)}</b></td><td>${echapper(e.libelle ?? '')}</td><td>${echapper(e.unite_stock)}</td>
          <td class="nombre">${prix(e.pa)}</td><td class="nombre">${prix(e.pv_net)}</td></tr>`).join('')}</tbody></table>` : '<p class="aide">Aucun article.</p>';
    };
    let minuterie;
    fond.querySelector('input').addEventListener('input', (e) => { clearTimeout(minuterie); minuterie = setTimeout(() => chercher(e.target.value), 250); });
    const prendre = (tr) => { if (tr) { choisir(resultats[Number(tr.dataset.i)]); fermer(); } };
    zone.addEventListener('dblclick', (e) => prendre(e.target.closest('tr[data-i]')));
    zone.addEventListener('click', (e) => prendre(e.target.closest('tr[data-i]')));
    zone.addEventListener('keydown', (e) => { if (e.key === 'Enter') prendre(e.target.closest('tr[data-i]')); });
    chercher('');
  }

  // ---------------------------------------------------------------- image et notices techniques (GED)

  async #chargerImage() {
    this.urlImage = null;
    const id = this.valeur('image_ged');
    if (!id || !this.services.ged) return;
    try {
      const d = await this.services.ged.document(id);
      if (d.version) this.urlImage = this.services.ged.urlContenu(d.version.id);
    } catch { /* image retirée de la GED */ }
    this.#majInformations();
  }

  async #imageNotices(corps, modifiable) {
    const ged = this.services.ged;
    if (this.id === null) { corps.innerHTML = '<p class="aide">Enregistrez l\'élément pour lui associer une image et des notices techniques.</p>'; return; }
    const docs = await ged.lister({ type_element: 'element', id_element: String(this.id) });
    const images = docs.filter((d) => d.version?.type_mime?.startsWith('image/'));
    const notices = docs.filter((d) => d.categorie === 'notice_technique');
    const choisie = Number(this.valeur('image_ged')) || null;
    corps.innerHTML = `<div class="element-medias">
      <fieldset class="fiche-groupe"><legend>Image de l'élément</legend>
        <div class="element-images">${images.map((d) => `<label class="element-image ${d.id === choisie ? 'choisie' : ''}">
          <img src="${echapper(ged.urlContenu(d.version.id))}" alt="${echapper(d.titre)}"><span><input type="radio" name="image" value="${d.id}" ${d.id === choisie ? 'checked' : ''} ${modifiable ? '' : 'disabled'}> ${echapper(d.titre)}</span></label>`).join('')
          || '<p class="aide">Aucune image : ajoutez-en une.</p>'}</div>
        <p><button type="button" data-ajout="image">＋ Ajouter une image</button>${choisie && modifiable ? ' <button type="button" data-retirer>Retirer l\'image</button>' : ''}
          ${modifiable ? '' : '<span class="aide"> Passez en modification pour choisir l\'image de l\'élément.</span>'}</p>
      </fieldset>
      <fieldset class="fiche-groupe"><legend>Notices techniques (DOE)</legend>
        ${notices.length ? `<ul class="element-notices">${notices.map((d) => `<li>📘 <a href="${echapper(ged.urlContenu(d.version.id, { telecharger: true }))}" target="_blank" rel="noopener">${echapper(d.titre)}</a>
          <small>${echapper(d.version?.nom_fichier ?? '')}${d.date_document ? ` · ${new Date(d.date_document).toLocaleDateString('fr-FR')}` : ''}</small></li>`).join('')}</ul>` : '<p class="aide">Aucune notice technique.</p>'}
        <p><button type="button" data-ajout="notice">＋ Ajouter une notice technique</button></p>
        <p class="aide">Les notices techniques (catégorie GED « Notice technique (DOE) ») seront jointes au dossier des ouvrages exécutés remis au client.</p>
      </fieldset>
      <input type="file" hidden data-fichier></div>`;
    corps.querySelectorAll('input[name="image"]').forEach((r) => r.addEventListener('change', () => {
      this.definirValeur('image_ged', r.value);
      this.#chargerImage();
      corps.querySelectorAll('.element-image').forEach((l) => l.classList.toggle('choisie', l.contains(r)));
    }));
    corps.querySelector('[data-retirer]')?.addEventListener('click', () => { this.definirValeur('image_ged', null); this.urlImage = null; this.#majInformations(); this.#imageNotices(corps, modifiable); });
    const entree = corps.querySelector('[data-fichier]');
    let genre = 'image';
    corps.querySelectorAll('[data-ajout]').forEach((b) => b.addEventListener('click', () => {
      genre = b.dataset.ajout;
      entree.accept = genre === 'image' ? 'image/*' : '';
      entree.click();
    }));
    entree.addEventListener('change', async () => {
      const fichier = entree.files[0];
      entree.value = '';
      if (!fichier) return;
      try {
        await ged.deposer({
          fichier, meta: {
            titre: fichier.name.replace(/\.[^.]+$/, ''), categorie: genre === 'image' ? 'photo' : 'notice_technique', type_element: 'element', id_element: String(this.id),
            date_document: new Date().toISOString().slice(0, 10), auteur: this.utilisateur,
          },
        });
        this.message(genre === 'image' ? 'Image ajoutée à la GED de l\'élément' : 'Notice technique ajoutée', 'succes');
        await this.#imageNotices(corps, modifiable);
      } catch (e) { this.message(e.message, 'erreur'); }
    });
  }
}
