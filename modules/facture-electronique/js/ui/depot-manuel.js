// Module Facturation électronique, dépôt et import manuels (repli Q1 (c), connecteur MANUEL) : télécharger le fichier
// d'un flux à déposer sur le portail de la PA, saisir l'accusé rendu par le portail (Ok, ou Error avec motif et
// message), importer un fichier reçu hors connexion (facture, ou statut CDAR d'une facture émise ou reçue).
import { texte, texteHtml, iconeHtml, messageErreur } from '@logibtp/socle/dictionnaire';
import { echapper, creerCombo, alerter, ouvrirDialogue, telechargerFichier, formatDateHeure, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { ETAT_ACCUSE, MOTIF_ACCUSE, TYPE_DOCUMENT_FLUX, ETAT_FLUX, SENS_FLUX } from '../src/codes.js';
import { base64, corpsConfirmation, depotsEnAttente, requeteFlux, TYPES_STATUT_IMPORT } from './modeles.js';

export const GROUPE_RACCOURCIS_DEPOT = 'facture_electronique_depot';
declarerRaccourcis(GROUPE_RACCOURCIS_DEPOT, {
  libelle: texte('facture_electronique.raccourcis.groupe_depot'),
  actions: {
    importer: { libelle: texte('facture_electronique.raccourcis.importer'), defaut: 'Alt+Shift+I' },
    actualiser: { libelle: texte('facture_electronique.raccourcis.actualiser'), defaut: 'Alt+Shift+R' },
  },
});

const erreurParDefaut = (e) => alerter(messageErreur(e?.code, e?.message ?? String(e)));

/** Télécharge un document d'un flux (Original par défaut) : api.fichier(id, document) → { contenu (Blob), nom }. */
export async function telechargerDocumentFlux(api, flux, document = TYPE_DOCUMENT_FLUX.ORIGINAL) {
  const f = await api.fichier(flux.id, document);
  telechargerFichier(f.nom ?? flux.nom, f.contenu, f.type ?? 'application/octet-stream');
}

/**
 * Saisie de l'accusé d'un dépôt fait sur le portail de la PA, puis POST /flux/{id}/depot-manuel. Rend le flux mis à
 * jour, ou null si l'utilisateur annule.
 */
export async function confirmerDepotManuel(api, flux) {
  let etat;
  let motif;
  const corps = await ouvrirDialogue({
    titre: texte('facture_electronique.depot.confirmer_titre', { nom: flux.nom }),
    valeurAnnulation: null,
    html: `<p class="aide">${texteHtml('facture_electronique.depot.confirmer_aide')}</p>
      <label>${texteHtml('facture_electronique.depot.accuse')} <span data-etat></span></label>
      <label data-refus hidden>${texteHtml('facture_electronique.depot.motif')} <span data-motif></span></label>
      <label data-refus hidden>${texteHtml('facture_electronique.depot.message')} <input type="text" size="40" data-message></label>`,
    boutons: [{ libelle: texte('commun.annuler'), valeur: null },
      { libelle: texte('commun.valider'), principal: true, valeur: (d) => corpsConfirmation({ etat: etat.valeurCombo, motif: motif.valeurCombo, message: d.querySelector('[data-message]').value }) }],
    construire: (d) => {
      etat = creerCombo({ options: [ETAT_ACCUSE.OK, ETAT_ACCUSE.ERREUR].map((v) => ({ valeur: v, libelle: texte(`facture_electronique.accuses.${v}`) })), valeur: ETAT_ACCUSE.OK, vide: false });
      motif = creerCombo({ options: Object.values(MOTIF_ACCUSE).map((v) => ({ valeur: v, libelle: texte(`facture_electronique.motifs_accuse.${v}`) })), valeur: MOTIF_ACCUSE.AUTRE_ERREUR_TECHNIQUE, vide: false });
      d.querySelector('[data-etat]').append(etat);
      d.querySelector('[data-motif]').append(motif);
      etat.addEventListener('change', () => d.querySelectorAll('[data-refus]').forEach((x) => { x.hidden = etat.valeurCombo !== ETAT_ACCUSE.ERREUR; }));
    },
  });
  return corps ? api.confirmerDepot(flux.id, corps) : null;
}

/**
 * Import d'un fichier reçu hors connexion (facture CII / UBL / Factur-X, ou CDAR), puis POST /import. Rend le flux
 * enregistré, ou null si l'utilisateur annule.
 */
export async function importerFichier(api) {
  let type;
  const choix = await ouvrirDialogue({
    titre: texte('facture_electronique.import.titre'),
    valeurAnnulation: null,
    html: `<p class="aide">${texteHtml('facture_electronique.import.aide')}</p>
      <label>${texteHtml('facture_electronique.import.fichier')} <input type="file" data-fichier accept=".xml,.pdf,application/xml,text/xml,application/pdf"></label>
      <label>${texteHtml('facture_electronique.import.type_statut')} <span data-type></span></label>`,
    boutons: [{ libelle: texte('commun.annuler'), valeur: null },
      { libelle: texte('facture_electronique.import.importer'), principal: true, valeur: (d) => ({ fichier: d.querySelector('[data-fichier]').files?.[0] ?? null, type: type.valeurCombo }) }],
    construire: (d) => {
      type = creerCombo({ options: TYPES_STATUT_IMPORT.map((v) => ({ valeur: v, libelle: texte(`facture_electronique.types.${v}`) })), valeur: TYPES_STATUT_IMPORT[0], vide: false });
      d.querySelector('[data-type]').append(type);
      const bouton = d.querySelector('.principal');
      const champ = d.querySelector('[data-fichier]');
      bouton.disabled = true;
      champ.addEventListener('change', () => { bouton.disabled = !champ.files?.length; });
    },
  });
  if (!choix?.fichier) return null;
  const contenu = base64(await choix.fichier.arrayBuffer());
  return api.importer({ nom: choix.fichier.name, contenu, type_statut: choix.type });
}

/**
 * Écran du dépôt manuel : flux à déposer sur le portail de la PA (téléchargement, accusé), import d'un fichier reçu.
 * options : { peut: { modifier }, api: { flux(requete), fichier(id, document), confirmerDepot(id, corps), importer(corps) },
 * ouvrirFlux(id, nouvelleFenetre), apresEcriture(), erreur(e) }.
 */
export class PanneauDepotManuel {
  #zone;
  #o;
  #flux = [];

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { peut: {}, api: {}, ouvrirFlux: () => {}, apresEcriture: () => {}, erreur: erreurParDefaut, ...options };
    this.#zone.addEventListener('click', (e) => this.#clic(e));
    this.#zone.addEventListener('keydown', (e) => {
      const action = actionDe(e, GROUPE_RACCOURCIS_DEPOT);
      if (action === 'importer' && this.#o.peut.modifier) this.importer();
      else if (action === 'actualiser') this.charger();
      else return;
      e.preventDefault();
    });
  }

  async charger() {
    try {
      this.#flux = depotsEnAttente((await this.#o.api.flux(requeteFlux({ sens: SENS_FLUX.SORTANT, etat: ETAT_FLUX.ENVOYE }, { limite: 500 }))) ?? []);
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  #rendre() {
    const { peut } = this.#o;
    const ligne = (f) => `<tr><td>${echapper(f.numero ?? '')}</td><td>${echapper(f.nom)}</td><td>${echapper(formatDateHeure(f.cree_le))}</td>
      <td class="cellule-boutons"><button type="button" data-telecharger="${f.id}" title="${echapper(texte('facture_electronique.depot.telecharger'))}">${iconeHtml('fe_telecharger')}</button>
        ${peut.modifier ? `<button type="button" data-confirmer="${f.id}" title="${echapper(texte('facture_electronique.depot.confirmer'))}">${iconeHtml('fe_confirmer')}</button>` : ''}
        <button type="button" data-ouvrir="${f.id}" title="${echapper(texte('facture_electronique.tableau.ouvrir'))}">${iconeHtml('fe_ouvrir')}</button></td></tr>`;
    this.#zone.innerHTML = `<h2 class="titre-actions">${iconeHtml('fe_depot')} ${texteHtml('facture_electronique.depot.titre')}</h2>
      <p class="fe-actions"><button type="button" data-actualiser>${iconeHtml('fe_actualiser')} ${texteHtml('commun.actualiser')}</button>
        ${peut.modifier ? `<button type="button" class="principal" data-importer>${iconeHtml('fe_importer')} ${texteHtml('facture_electronique.import.titre')}</button>` : ''}</p>
      ${this.#flux.length ? `<table class="tableau-compact fe-table"><thead><tr><th>${texteHtml('facture_electronique.colonnes.numero')}</th><th>${texteHtml('facture_electronique.colonnes.nom')}</th>
        <th>${texteHtml('facture_electronique.colonnes.cree_le')}</th><th></th></tr></thead><tbody>${this.#flux.map(ligne).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('facture_electronique.depot.aucun')}</p>`}`;
  }

  async #ecrire(action) {
    try {
      const r = await action();
      if (r) this.#o.apresEcriture(r);
      return r;
    } catch (e) {
      this.#o.erreur(e);
      return null;
    } finally {
      await this.charger();
    }
  }

  /** Import d'un fichier reçu hors connexion ; le flux enregistré s'ouvre ensuite. */
  async importer() {
    const f = await this.#ecrire(() => importerFichier(this.#o.api));
    if (f) this.#o.ouvrirFlux(f.id, false);
  }

  async #clic(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const flux = (id) => this.#flux.find((x) => x.id === Number(id));
    if (b.matches('[data-actualiser]')) this.charger();
    else if (b.matches('[data-importer]')) this.importer();
    else if (b.dataset.telecharger) {
      try { await telechargerDocumentFlux(this.#o.api, flux(b.dataset.telecharger)); } catch (x) { this.#o.erreur(x); }
    } else if (b.dataset.confirmer) await this.#ecrire(() => confirmerDepotManuel(this.#o.api, flux(b.dataset.confirmer)));
    else if (b.dataset.ouvrir) this.#o.ouvrirFlux(Number(b.dataset.ouvrir), e.ctrlKey || e.metaKey);
  }
}
