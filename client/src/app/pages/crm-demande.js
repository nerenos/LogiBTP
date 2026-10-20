import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { ExplorateurGed } from '@logibtp/ged/ui';
import { choisirPersonne, choisirIndividu, creerTiersProvisoire } from '@logibtp/annuaire/ui';
import { ETATS_DEMANDE, MOTIFS_SANS_SUITE, controlerDemande, MESSAGES_DEMANDE } from '@logibtp/crm';
import { api } from '../api.js';
import { contexteCrm, individusCrm, zoneRiche, lienElement, formatDateHeure } from '../crm/crm.js';
import { PanneauSuivi } from '../crm/panneau-suivi.js';
import { pastilleDemande } from './crm-demandes.js';

const QUOI = { CREATION: 'Création', ETAT: 'État', RESPONSABLE: 'Responsable', SERVICE: 'Service' };
const libelleEtat = (v) => ETATS_DEMANDE.find((e) => e.valeur === v)?.libelle ?? v;

/**
 * Demande (module CRM) : `/crm/demande/<id>` ou `/crm/demande/nouveau?tiers=`. Pré-dossier de veille : objet, tiers
 * (existant ou nouveau tiers provisoire), contact, origine, service et responsable (ou à prendre), réponse attendue,
 * montant estimé, description ; notes, tâches et courriels (Suivi), pièces (GED), historique ; « Créer le projet »
 * (demande transformée, notes rattachées au projet), sans suite avec motif.
 */
export class PageDemandeCrm extends PageBase {
  icone = '📨';

  get modifiee() { return Boolean(this.modifie); }

  async ouvrir() {
    const app = this.app;
    if (!app.enLigne) { this.conteneur.innerHTML = '<p class="aide">Suivi (CRM) disponible en ligne seulement.</p>'; return; }
    [this.ctx, this.individus] = await Promise.all([contexteCrm(app), individusCrm(app)]);
    if (this.params.id === 'nouveau') {
      this.detail = null;
      this.saisie = { objet: '', description_html: null, etat: 'VEILLE', motif: null, tiers_id: this.requete.tiers ? Number(this.requete.tiers) : null, ind_id: null,
        srv_id: this.ctx.services[0]?.id ?? null, responsable_id: null, echeance: null, montant_estime: null, origine: '' };
      this.tiers = this.saisie.tiers_id ? (await api.crm.elements([{ type: 'personne', id: String(this.saisie.tiers_id) }]))[0] : null;
      this.contact = null;
      this.titre = 'Nouvelle demande';
    } else await this.charger(Number(this.params.id));
    this.rendre();
  }

  async charger(id) {
    this.detail = await api.crm.demande(id);
    const d = this.detail.demande;
    this.saisie = { objet: d.objet, description_html: d.description_html, etat: d.etat, motif: d.motif, tiers_id: d.tiers_id, ind_id: d.ind_id, srv_id: d.srv_id,
      responsable_id: d.responsable_id, echeance: d.echeance, montant_estime: d.montant_estime, origine: d.origine ?? '', maj_le: d.maj_le };
    this.tiers = d.tiers;
    this.contact = d.contact;
    this.titre = `${d.numero} – ${d.objet}`;
    this.modifie = false;
  }

  urlCourante() { return this.detail ? `/crm/demande/${this.detail.demande.id}` : null; }

  marquer() { this.modifie = true; this.app.majPage?.(); }

  rendre() {
    const d = this.detail?.demande;
    const s = this.saisie;
    const droits = this.detail?.droits ?? { modifier: true, supprimer: false, prendre: false, rendre: false };
    const lecture = !droits.modifier;
    const ouverte = !['TRANSFORMEE', 'SANS_SUITE'].includes(d?.etat);
    this.conteneur.innerHTML = `<div class="page-parametres page-crm-note">
      <h1 class="page-titre">📨 ${echapper(d ? `${d.numero} – ${d.objet}` : 'Nouvelle demande')} ${d ? pastilleDemande(d) : ''}</h1>
      <div class="boutons crm-actions">
        ${lecture ? '' : '<button type="button" class="principal" data-enregistrer title="Enregistrer (Ctrl+S)">Enregistrer</button>'}
        ${droits.prendre ? '<button type="button" data-prendre>Prendre</button>' : ''}
        ${droits.rendre ? '<button type="button" data-rendre>Rendre au service</button>' : ''}
        ${d && ouverte && !lecture ? '<button type="button" data-projet title="Créer le projet (chiffrage) : la demande est transformée, ses notes suivent le projet">🎯 Créer le projet</button>' : ''}
        ${d?.cible ? `<span>Projet : ${lienElement(d.cible)}</span>` : ''}
        ${droits.supprimer ? '<button type="button" data-supprimer title="Supprimer (sinon : sans suite)">Supprimer</button>' : ''}
      </div>
      <div class="crm-note-grille">
        <section class="crm-note-principal">
          <label class="crm-objet">Objet <input data-c="objet" maxlength="200" value="${echapper(s.objet)}" ${lecture ? 'disabled' : ''} placeholder="Objet de la demande"></label>
          <div class="formulaire crm-formulaire">
            <label>Tiers <span class="crm-tiers">${this.tiers ? lienElement(this.tiers) : '<span class="aide">—</span>'}
              ${lecture ? '' : '<button type="button" data-choisir-tiers title="Choisir un tiers de l\'annuaire">…</button><button type="button" data-nouveau-tiers title="Nouveau tiers (provisoire, doublons contrôlés)">＋</button>'}</span></label>
            <label>Contact <span class="crm-tiers">${this.contact ? lienElement(this.contact) : '<span class="aide">—</span>'}
              ${lecture ? '' : '<button type="button" data-choisir-contact title="Choisir un contact">…</button>'}${!lecture && this.contact ? '<button type="button" data-retirer-contact>✕</button>' : ''}</span></label>
            <label>Origine <input data-c="origine" maxlength="80" value="${echapper(s.origine ?? '')}" ${lecture ? 'disabled' : ''} placeholder="Appel d'offres, recommandation, site…"></label>
            <label>État <span data-etat></span></label>
            <label data-zone-motif ${s.etat === 'SANS_SUITE' ? '' : 'hidden'}>Motif <span data-motif></span></label>
            <label>Service <span data-srv></span></label>
            <label>Responsable <span data-responsable></span></label>
            <label>Réponse attendue <input type="date" data-c="echeance" value="${s.echeance ?? ''}" ${lecture ? 'disabled' : ''}></label>
            <label>Montant estimé (HT) <input data-c="montant_estime" inputmode="decimal" value="${s.montant_estime ?? ''}" ${lecture ? 'disabled' : ''}></label>
          </div>
          <div data-description></div>
          <div class="crm-erreurs erreur" hidden></div>
          ${d ? '<h2>Suivi</h2><div data-suivi></div>' : '<p class="aide">Notes, tâches et courriels : après le premier enregistrement.</p>'}
        </section>
        <aside class="crm-note-cote">
          ${d ? '<h2>Pièces</h2><div data-pieces class="crm-pieces"></div>' : ''}
          ${d ? `<h2>Historique</h2><ul class="crm-historique">${this.detail.historique.map((h) => `<li><span class="aide">${echapper(formatDateHeure(h.le))} · ${echapper(h.par ?? '')}</span>
            ${echapper(QUOI[h.quoi] ?? h.quoi)} ${h.quoi === 'ETAT' || h.quoi === 'CREATION' ? `${h.avant ? `${echapper(libelleEtat(h.avant))} → ` : ''}${echapper(libelleEtat(h.apres ?? ''))}` : `${echapper(h.avant ?? '—')} → ${echapper(h.apres ?? '—')}`}</li>`).join('')}</ul>` : ''}
        </aside>
      </div></div>`;
    this.brancher(lecture);
  }

  brancher(lecture) {
    const $ = (sel) => this.conteneur.querySelector(sel);
    const s = this.saisie;
    const combo = (sel, cle, options, vide = true, apres = () => {}) => {
      const c = creerCombo({ options, valeur: s[cle] ?? '', vide });
      c.readOnly = lecture;
      c.addEventListener('change', () => { s[cle] = c.valeurCombo === '' ? null : (typeof options[0]?.valeur === 'number' ? Number(c.valeurCombo) : c.valeurCombo); this.marquer(); apres(); this.controler(); });
      $(sel).replaceWith(c);
    };
    // Transformée : seul « Créer le projet » y conduit (état non proposé à la saisie).
    combo('[data-etat]', 'etat', ETATS_DEMANDE.filter((e) => e.valeur !== 'TRANSFORMEE' || s.etat === 'TRANSFORMEE'), false, () => {
      $('[data-zone-motif]').hidden = s.etat !== 'SANS_SUITE';
      if (s.etat !== 'SANS_SUITE') s.motif = null;
    });
    combo('[data-motif]', 'motif', MOTIFS_SANS_SUITE);
    combo('[data-srv]', 'srv_id', this.ctx.tous_services.map((x) => ({ valeur: x.id, libelle: x.libelle })));
    combo('[data-responsable]', 'responsable_id', this.individus);
    this.conteneur.querySelectorAll('input[data-c]').forEach((i) => i.addEventListener('input', () => {
      const c = i.dataset.c;
      s[c] = c === 'montant_estime' ? (i.value.trim() === '' ? null : String(i.value).replace(',', '.').replace(/\s/g, '')) : (i.value === '' && c === 'echeance' ? null : i.value);
      this.marquer();
      this.controler();
    }));
    this.description = zoneRiche(s.description_html, { lecture, surChange: () => this.marquer() });
    $('[data-description]').replaceWith(this.description.element);
    $('[data-choisir-tiers]')?.addEventListener('click', async () => {
      const { annuaire } = await this.app.services();
      const p = await choisirPersonne({ annuaire, titre: 'Tiers de la demande' });
      if (p) this.definirTiers(p);
    });
    $('[data-nouveau-tiers]')?.addEventListener('click', async () => {
      const { annuaire } = await this.app.services();
      const p = await creerTiersProvisoire({ annuaire, casquettes: ['CLIENT'], titre: 'Nouveau tiers (prospect)' });
      if (p) this.definirTiers(p);
    });
    $('[data-choisir-contact]')?.addEventListener('click', async () => {
      const { annuaire } = await this.app.services();
      const r = await choisirIndividu({ annuaire, titre: 'Contact de la demande' });
      if (r?.individu) { s.ind_id = r.individu.id; this.contact = { type: 'individu', id: String(r.individu.id), libelle: r.individu.nom_complet, icone: '👤', url: `/fiche/individu/${r.individu.id}` }; this.marquer(); this.rendre(); } else if (r?.nouveau) this.app.message('Créez d\'abord le contact dans l\'annuaire (fiche individu)', 'avertissement');
    });
    $('[data-retirer-contact]')?.addEventListener('click', () => { s.ind_id = null; this.contact = null; this.marquer(); this.rendre(); });
    $('[data-enregistrer]')?.addEventListener('click', () => this.enregistrer());
    $('[data-prendre]')?.addEventListener('click', () => this.action(() => api.crm.prendreDemande(this.detail.demande.id), 'Demande prise en charge'));
    $('[data-rendre]')?.addEventListener('click', () => this.action(() => api.crm.rendreDemande(this.detail.demande.id), 'Demande rendue au service'));
    $('[data-projet]')?.addEventListener('click', async () => {
      if (this.modifie) { this.app.message('Enregistrez d\'abord la demande', 'avertissement'); return; }
      if (!confirm('Créer le projet de chiffrage depuis cette demande ? Elle passera « Transformée en projet ».')) return;
      await this.action(() => api.crm.creerProjet(this.detail.demande.id), 'Projet créé');
    });
    $('[data-supprimer]')?.addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement cette demande ?')) return;
      try { await api.crm.supprimerDemande(this.detail.demande.id); this.modifie = false; this.app.publier('crm', {}); this.app.routeur.retour('/crm/demandes'); } catch (e) { this.app.erreur(e); }
    });
    if (this.detail) {
      this.suivi?.fermer();
      this.suivi = new PanneauSuivi($('[data-suivi]'), { app: this.app, type: 'crm_demande', id: this.detail.demande.id, libelle: this.detail.demande.numero });
      this.suivi.ouvrir().catch((e) => this.app.erreur(e));
      this.app.services().then((sv) => {
        this.ged = new ExplorateurGed($('[data-pieces]'), {
          fournisseur: sv.ged, contexte: { type_element: 'crm_demande', id_element: String(this.detail.demande.id), libelle: this.detail.demande.numero, icone: '📨' }, compact: true,
          ouvrirUrl: (url) => this.app.naviguer(url, { nouvelleFenetre: true }), modifiable: !lecture, admin: this.app.estAdmin(), utilisateur: this.app.utilisateur(),
          message: (t, n) => this.app.message(t, n),
        });
      });
    }
    this.controler();
  }

  definirTiers(p) {
    this.saisie.tiers_id = p.id;
    this.tiers = { type: 'personne', id: String(p.id), libelle: p.nom_commercial || p.raison_sociale, icone: '🏢', url: `/fiche/personne/${p.id}` };
    this.marquer();
    this.rendre();
  }

  controler() {
    const zone = this.conteneur.querySelector('.crm-erreurs');
    const erreurs = controlerDemande({ ...this.saisie, cible_type: this.detail?.demande.cible?.type, cible_id: this.detail?.demande.cible?.id });
    if (zone) { zone.hidden = !erreurs.length || !this.modifie; zone.innerHTML = erreurs.map((e) => `<div>⚠ ${echapper(MESSAGES_DEMANDE[e] ?? e)}</div>`).join(''); }
    return erreurs;
  }

  async enregistrer() {
    if (!this.conteneur.querySelector('[data-enregistrer]')) return;
    this.saisie.description_html = this.description?.valeur() ?? null;
    this.modifie = true;
    if (this.controler().length) { this.app.message('Demande incomplète : voir les messages sous la saisie', 'avertissement'); return; }
    try {
      const nouveau = !this.detail;
      const s = { ...this.saisie, montant_estime: this.saisie.montant_estime === null ? null : this.saisie.montant_estime };
      const d = nouveau ? await api.crm.creerDemande(s) : await api.crm.enregistrerDemande(this.detail.demande.id, s);
      await this.apres(d, 'Demande enregistrée');
      if (nouveau) this.app.routeur.remplacerUrl(`/crm/demande/${d.demande.id}`);
    } catch (e) { this.app.erreur(e); }
  }

  async apres(d, texte) {
    this.detail = d;
    await this.charger(d.demande.id);
    this.app.publier('crm', { demande: d.demande.id });
    this.app.message(texte, 'succes');
    this.rendre();
  }

  async action(f, texte) {
    if (this.modifie && !confirm('Les modifications non enregistrées seront perdues. Continuer ?')) return;
    try { await this.apres(await f(), texte); } catch (e) { this.app.erreur(e); }
  }

  fermer() { this.suivi?.fermer(); }
}
