import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, lireStockage, ecrireStockage } from '@logibtp/socle/ui';
import { ACTION_DROIT } from '@logibtp/socle';
import { ListeRelances, ParametresRelances, PanneauSuspensions } from '@logibtp/relance/ui';
import { choisirPersonne } from '@logibtp/annuaire/ui';
import { MODULE_FACULTATIF, urlDocument } from '../codes.js';
import { api } from '../api.js';

// Module Relances, lot 4 du cœur (plans/relances.md) : page /relances qui monte les écrans du module (liste de travail,
// suspensions, règle des niveaux). Les pièces en attente, le tiers relancé, le chargé et la portée viennent du serveur
// (Btp/SpecialisationRelanceBtp.cs) ; la page fournit les appels, les libellés des pièces et des tiers et l'ouverture
// d'une pièce. Onglet affiché retenu dans le navigateur.

const NOEUD = 'relances';
const CLE_ONGLET = 'relancesOnglet';
const ONGLETS = Object.freeze(['liste', 'suspensions', 'regle']);

export class PageRelances extends PageBase {
  icone = icone('relances_btp_page');
  #pieces = new Map();
  #tiers = new Map();

  urlCourante() { return '/relances'; }

  /** Libellés des pièces et des tiers inconnus (lot préparé, suspensions), lus avant l'affichage. */
  async #completer(pieces = [], tiers = []) {
    const p = [...new Set(pieces.filter((id) => id && !this.#pieces.has(id)))];
    const t = [...new Set(tiers.filter((id) => id && !this.#tiers.has(id)))];
    if (!p.length && !t.length) return;
    try {
      const l = await api.relances.libelles(p, t);
      Object.entries(l.pieces ?? {}).forEach(([id, v]) => this.#pieces.set(Number(id), v));
      Object.entries(l.tiers ?? {}).forEach(([id, v]) => this.#tiers.set(Number(id), v));
    } catch { /* libellés par défaut du module */ }
  }

  async #lot(id) {
    const lot = await api.relances.lot(id);
    const relances = (lot?.groupes ?? []).flatMap((g) => g.relances ?? []);
    await this.#completer(relances.map((r) => r.piece_id), (lot?.groupes ?? []).map((g) => g.tiers_id));
    return lot;
  }

  async ouvrir() {
    this.titre = texte('relances_btp.routes.relances');
    const peut = (a) => this.app.peut(NOEUD, a);
    // Suspensions : toute action d'écriture du nœud (route rattachée au nœud en mode module).
    const ecrire = peut(ACTION_DROIT.CREER) || peut(ACTION_DROIT.VALIDER);
    let onglet = lireStockage(CLE_ONGLET, 'liste');
    if (!ONGLETS.includes(onglet)) onglet = 'liste';
    this.conteneur.innerHTML = `<div class="page-parametres page-relances"><div class="entete-page"><h1 class="page-titre">${iconeHtml('relances_btp_page')} ${texteHtml('relances_btp.routes.relances')}</h1>
        <div class="barre-outils"><div class="groupe-outils" role="tablist">${ONGLETS.map((o) => `<button type="button" role="tab" data-onglet="${o}" title="${echapper(texte(`relances_btp.onglets.${o}_titre`))}">${iconeHtml(`relances_btp_${o}`)} ${texteHtml(`relances_btp.onglets.${o}`)}</button>`).join('')}</div></div></div>
      <p class="aide">${texteHtml('relances_btp.aide')}</p>
      ${ONGLETS.map((o) => `<section data-zone="${o}" hidden></section>`).join('')}</div>`;
    const zone = (o) => this.conteneur.querySelector(`[data-zone="${o}"]`);
    const erreur = (e) => this.app.erreur(e);
    const libellePiece = (id) => this.#pieces.get(id) ?? texte('relance.piece_sans_nom', { id });
    const libelleTiers = (id) => this.#tiers.get(id) ?? texte('relance.tiers_sans_nom', { id });

    this.suspensions = new PanneauSuspensions(zone('suspensions'), {
      peut: { creer: ecrire, modifier: ecrire, supprimer: ecrire },
      api: {
        liste: async () => {
          const l = await api.relances.suspensions();
          await this.#completer(l.map((s) => s.piece_id), l.map((s) => s.tiers_id));
          return l;
        },
        creer: (s) => api.relances.creerSuspension(s),
        modifier: (id, s) => api.relances.modifierSuspension(id, s),
        supprimer: (id) => api.relances.supprimerSuspension(id),
      },
      libellePiece,
      libelleTiers,
      choisirTiers: async () => {
        const { annuaire } = await this.app.services();
        const p = await choisirPersonne({ annuaire, titre: texte('relances_btp.choisir_tiers') });
        if (!p) return null;
        this.#tiers.set(p.id, p.raison_sociale);
        return { id: p.id };
      },
      apresEcriture: () => this.liste?.charger(),
      erreur,
    });

    this.liste = new ListeRelances(zone('liste'), {
      peut: { creer: peut(ACTION_DROIT.CREER), valider: peut(ACTION_DROIT.VALIDER) },
      api: {
        dues: async (date) => {
          const l = await api.relances.dues(date);
          for (const g of l) {
            if (g.tiers) this.#tiers.set(g.tiers_id, g.tiers);
            for (const p of g.pieces ?? []) if (p.numero) this.#pieces.set(p.id, p.numero);
          }
          return l;
        },
        preparer: (date) => api.relances.preparer(date),
        lots: () => api.relances.lots(),
        lot: (id) => this.#lot(id),
        valider: (id, corps) => api.relances.valider(id, corps),
        annuler: (id, corps) => api.relances.annuler(id, corps),
        numero: (id, numero) => api.relances.numero(id, numero),
        noter: (corps) => api.relances.noter(corps),
      },
      libellePiece,
      libelleTiers,
      ouvrirPiece: (id, nouvelleFenetre) => this.app.naviguer(urlDocument(id), { nouvelleFenetre }),
      // Suspension depuis une pièce : la saisie du panneau relit ensuite la liste (apresEcriture).
      suspendre: ecrire ? (pieceId) => this.suspensions.nouvelle({ piece_id: pieceId }) : undefined,
      apresEcriture: () => this.suspensions.charger(),
      erreur,
    });

    // Règle des niveaux : paramétrage réservé à l'administrateur (ServiceRelance.EnregistrerRegle).
    this.regle = new ParametresRelances(zone('regle'), {
      peut: { modifier: this.app.estAdmin() },
      api: { regles: () => api.relances.regles(), enregistrer: (nature, r) => api.relances.enregistrerRegle(nature, r) },
      reglements: this.app.moduleActif(MODULE_FACULTATIF.REGLEMENT),
      erreur,
    });

    const charges = new Set();
    const afficher = async (o) => {
      ecrireStockage(CLE_ONGLET, o);
      this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => {
        b.classList.toggle('actif', b.dataset.onglet === o);
        b.setAttribute('aria-selected', String(b.dataset.onglet === o));
      });
      ONGLETS.forEach((x) => { zone(x).hidden = x !== o; });
      if (charges.has(o)) return;
      charges.add(o);
      await { liste: this.liste, suspensions: this.suspensions, regle: this.regle }[o].charger();
    };
    this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => afficher(b.dataset.onglet)));
    await afficher(onglet);
  }
}
