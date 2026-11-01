import { texte, texteHtml, icone, iconeHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { urlFiche, SUJET_FENETRE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, htmlSur, confirmer, formatDateHeure } from '@logibtp/socle/ui';
import { ExplorateurGed } from '@logibtp/ged/ui';
import { NATURES_NOTE, ETATS_NOTE, controlerNote, MESSAGES_NOTE, LONGUEUR_OBJET, TYPES_RAPPEL, controlerRappel, MESSAGES_RAPPEL, NATURE_NOTE } from '@logibtp/crm';
import { api } from '../api.js';
import { choisirRattachement } from '../structure/selection.js';
import { contexteCrm, individusCrm, nouvelleSaisie, saisieDeNote, versChampDate, depuisChampDate, zoneRiche, lienElement, pastilleEtat, iconeNature, libelleEtat, pastilleRappel, libelleRappel } from '../crm/crm.js';

const QUOI = textesParCode('crm_btp.historique', ['CREATION', 'ETAT', 'RESPONSABLE', 'SERVICE', 'ECHEANCE']);
const STRUCTURE = { projet: 'projets', affaire: 'affaires', chantier: 'chantiers', marche: 'marches' };

/**
 * Note du CRM : `/crm/note/<id>` ou `/crm/note/nouveau?type_element=&id_element=&nature=&parent=`. Nature, état,
 * type, service, responsable (ou à prendre par le service), échéance, objet, message mis en forme, éléments rattachés,
 * destinataires, confidentialité (privée, données personnelles), fil d'actualité, pièces jointes (GED), réponses,
 * historique ; prise en charge, rendu au service, levée du masquage journalisée.
 */
export class PageNoteCrm extends PageBase {
  icone = icone('crm_btp_note_page');

  get modifiee() { return Boolean(this.modifie); }

  async ouvrir() {
    const app = this.app;
    [this.ctx, this.individus] = await Promise.all([contexteCrm(app), individusCrm(app)]);
    if (this.params.id === 'nouveau') {
      const r = this.requete;
      this.detail = null;
      this.saisie = nouvelleSaisie({
        nature: NATURES_NOTE.some((n) => n.valeur === r.nature) ? r.nature : NATURE_NOTE.ACTION,
        element: r.type_element && r.id_element ? { type: r.type_element, id: r.id_element } : null,
        parent: r.parent ? Number(r.parent) : null,
      });
      if (this.saisie.nature === NATURE_NOTE.TACHE) this.saisie.responsable_id = this.ctx.individu_id;
      this.liens = [];
      if (this.saisie.liens.length) this.liens = await this.decrire(this.saisie.liens);
      this.titre = texte('crm_btp.note.nouvelle');
    } else await this.charger(Number(this.params.id));
    this.rendre();
  }

  async charger(id, reveler = false) {
    this.detail = await api.crm.note(id, { reveler });
    this.saisie = saisieDeNote(this.detail);
    this.liens = this.detail.liens;
    this.titre = this.detail.note.objet;
    this.modifie = false;
    if (this.detail.note.non_lue) api.crm.lue(id).then(() => this.app.publier(SUJET_FENETRE.CRM, {})).catch(() => {});
  }

  /** Éléments rattachés d'une nouvelle note, décrits par le serveur (libellé, page, icône). */
  async decrire(liens) {
    return api.crm.elements(liens.map((l) => ({ type: l.type_element, id: String(l.id_element) })));
  }

  urlCourante() { return this.detail ? `/crm/note/${this.detail.note.id}` : null; }

  marquer() { this.modifie = true; this.app.majPage?.(); }

  rendre() {
    const d = this.detail;
    const n = this.saisie;
    const droits = d?.droits ?? { modifier: true, supprimer: false, prendre: false, rendre: false, reveler: false };
    const masquee = d?.note.masquee;
    const lecture = !droits.modifier;
    this.lecture = lecture;
    this.conteneur.innerHTML = `<div class="page-parametres page-crm-note">
      <h1 class="page-titre">${d ? (d.note.icone ?? iconeNature(n.nature)) : iconeHtml('crm_btp_note_page')} ${echapper(d ? (masquee ? (masquee === 'PRIVEE' ? texte('crm_btp.note.privee') : texte('crm_btp.note.rgpd')) : d.note.objet) : texte('crm_btp.note.nouvelle'))}
        ${d ? pastilleEtat(d.note) : ''}</h1>
      <div class="boutons crm-actions">
        ${lecture ? '' : `<button type="button" class="principal" data-enregistrer title="${texteHtml('crm_btp.commun.enregistrer_titre')}">${texteHtml('commun.enregistrer')}</button>`}
        ${droits.prendre ? `<button type="button" data-prendre title="${texteHtml('crm_btp.note.prendre_titre')}">${texteHtml('crm_btp.liste.prendre')}</button>` : ''}
        ${droits.rendre ? `<button type="button" data-rendre title="${texteHtml('crm_btp.note.rendre_titre')}">${texteHtml('crm_btp.commun.rendre')}</button>` : ''}
        ${d && !masquee ? `<button type="button" data-repondre title="${texteHtml('crm_btp.note.repondre_titre')}">${iconeHtml('crm_btp_repondre')} ${texteHtml('crm_btp.fil.repondre')}</button>` : ''}
        ${droits.reveler ? `<button type="button" data-reveler title="${texteHtml('crm_btp.note.reveler_titre', { droit: masquee === 'PRIVEE' ? 'SUPERVISER' : 'RGPD' })}">${iconeHtml('crm_btp_reveler')} ${texteHtml('crm_btp.note.reveler')}</button>` : ''}
        ${droits.supprimer ? `<button type="button" data-supprimer title="${texteHtml('crm_btp.note.supprimer_titre')}">${texteHtml('commun.supprimer')}</button>` : ''}
      </div>
      ${masquee ? `<p class="aide">${iconeHtml('verrou')} ${masquee === 'PRIVEE' ? texteHtml('crm_btp.note.privee_aide') : texteHtml('crm_btp.note.rgpd_aide')}</p>` : ''}
      <div class="crm-note-grille">
        <section class="crm-note-principal">
          <div class="formulaire crm-formulaire">
            <label>${texteHtml('crm_btp.liste.nature')} <span data-c="nature"></span></label>
            <label>${texteHtml('crm_btp.liste.etat')} <span data-c="etat"></span></label>
            <label>${texteHtml('crm_btp.note.type')} <span data-c="tno_id"></span></label>
            <label>${texteHtml('crm_btp.liste.service')} <span data-c="srv_id"></span></label>
            <label>${texteHtml('crm_btp.liste.responsable')} <span data-c="responsable_id"></span></label>
            <label>${texteHtml('crm_btp.liste.echeance')} <input type="datetime-local" data-c="echeance" value="${versChampDate(n.echeance)}" ${lecture ? 'disabled' : ''}></label>
          </div>
          <label class="crm-objet">${texteHtml('crm_btp.liste.objet')} <input data-c="objet" maxlength="${LONGUEUR_OBJET}" value="${echapper(masquee ? '' : n.objet)}" ${lecture ? 'disabled' : ''} placeholder="${texteHtml('crm_btp.note.objet_aide')}"></label>
          <div data-message></div>
          <div class="crm-options">
            <label class="fiche-option" title="${texteHtml('crm_btp.note.prive_titre')}"><input type="checkbox" data-c="prive" ${n.prive ? 'checked' : ''} ${lecture ? 'disabled' : ''}> ${texteHtml('crm_btp.note.prive')}</label>
            <label class="fiche-option" title="${texteHtml('crm_btp.note.rgpd_titre')}"><input type="checkbox" data-c="rgpd" ${n.rgpd ? 'checked' : ''} ${lecture ? 'disabled' : ''}> ${texteHtml('crm_btp.note.rgpd_case')}</label>
            <label class="fiche-option" title="${texteHtml('crm_btp.note.fil_titre')}"><input type="checkbox" data-c="dans_fil" ${n.dans_fil ? 'checked' : ''} ${lecture ? 'disabled' : ''}> ${texteHtml('crm_btp.note.fil')}</label>
          </div>
          <div class="crm-erreurs erreur" hidden></div>
          ${d?.reponses?.length ? `<h2>${texteHtml('crm_btp.note.reponses')}</h2><ul class="crm-reponses">${d.reponses.map((r) => `<li><b>${echapper(r.cree_par)}</b> <span class="aide">${echapper(formatDateHeure(r.cree_le))}</span>
            <a href="/crm/note/${r.id}">${echapper(r.objet)}</a><div class="crm-reponse-message">${htmlSur(r.message_html ?? '')}</div></li>`).join('')}</ul>` : ''}
        </section>
        <aside class="crm-note-cote">
          <h2>${texteHtml('crm_btp.note.rattachee')}</h2><div data-liens></div>
          <h2>${texteHtml('crm_btp.diffusions.destinataires')}</h2><div data-destinataires></div>
          ${d && !masquee ? `<h2>${texteHtml('crm_btp.note.rappels')}</h2><div data-rappels></div>` : ''}
          ${d ? `<h2>${texteHtml('crm_btp.note.pieces')}</h2><div data-pieces class="crm-pieces"></div>` : `<p class="aide">${texteHtml('crm_btp.note.pieces_apres')}</p>`}
          ${d ? `<h2>${texteHtml('crm_btp.commun.historique')}</h2><ul class="crm-historique">${d.historique.map((h) => `<li><span class="aide">${echapper(formatDateHeure(h.le))} · ${echapper(h.par ?? '')}</span>
            ${echapper(QUOI[h.quoi] ?? h.quoi)} ${h.quoi === 'ETAT' || h.quoi === 'CREATION' ? `${h.avant ? `${echapper(libelleEtat(h.avant))} ${iconeHtml('crm_btp_vers')} ` : ''}${echapper(libelleEtat(h.apres ?? ''))}`
              : h.quoi === 'ECHEANCE' ? `${echapper(formatDateHeure(h.avant))} ${iconeHtml('crm_btp_vers')} ${echapper(formatDateHeure(h.apres))}` : `${echapper(h.avant ?? icone('crm_btp_aucun'))} ${iconeHtml('crm_btp_vers')} ${echapper(h.apres ?? icone('crm_btp_aucun'))}`}</li>`).join('')}</ul>` : ''}
          ${d?.consultations?.length ? `<h2>${texteHtml('crm_btp.note.consultations')}</h2><ul class="crm-historique">${d.consultations.map((c) => `<li>${echapper(c.par)} <span class="aide">${echapper(formatDateHeure(c.le))} · ${c.motif === 'PRIVEE' ? texteHtml('crm_btp.note.masquage_leve') : texteHtml('crm_btp.note.lecture_rgpd')}</span></li>`).join('')}</ul>` : ''}
        </aside>
      </div></div>`;
    this.brancher(lecture, masquee);
  }

  brancher(lecture, masquee) {
    const $ = (s) => this.conteneur.querySelector(s);
    const n = this.saisie;
    const combo = (cle, options, vide = true) => {
      const c = creerCombo({ options, valeur: n[cle] ?? '', vide });
      c.readOnly = lecture;
      c.addEventListener('change', () => { n[cle] = c.valeurCombo === '' ? null : (typeof options[0]?.valeur === 'number' ? Number(c.valeurCombo) : c.valeurCombo); this.marquer(); this.controler(); });
      $(`[data-c="${cle}"]`).replaceWith(c);
    };
    combo('nature', NATURES_NOTE.map((x) => ({ valeur: x.valeur, libelle: `${x.icone} ${x.libelle}` })), false);
    combo('etat', ETATS_NOTE, false);
    combo('tno_id', this.ctx.types.filter((t) => t.actif || t.id === n.tno_id).map((t) => ({ valeur: t.id, libelle: `${t.icone ?? ''} ${t.libelle}`.trim() })));
    combo('srv_id', this.ctx.tous_services.map((s) => ({ valeur: s.id, libelle: s.libelle })));
    combo('responsable_id', this.individus);
    this.conteneur.querySelectorAll('input[data-c]').forEach((i) => i.addEventListener('input', () => {
      const c = i.dataset.c;
      n[c] = i.type === 'checkbox' ? i.checked : c === 'echeance' ? depuisChampDate(i.value) : i.value;
      this.marquer();
      this.controler();
    }));
    // Type de note choisi sur une note vide : son modèle de texte est proposé.
    if (!masquee) {
      this.message = zoneRiche(n.message_html, { lecture, surChange: () => { this.marquer(); } });
      $('[data-message]').replaceWith(this.message.element);
    }
    this.rendreLiens(lecture);
    this.rendreDestinataires(lecture);
    if (this.detail && !masquee) { this.rendrePieces(lecture); this.rendreRappels(); }
    $('[data-enregistrer]')?.addEventListener('click', () => this.enregistrer());
    $('[data-prendre]')?.addEventListener('click', () => this.action(() => api.crm.prendre(this.detail.note.id), texte('crm_btp.liste.prise')));
    $('[data-rendre]')?.addEventListener('click', () => this.action(() => api.crm.rendre(this.detail.note.id), texte('crm_btp.note.rendue')));
    $('[data-reveler]')?.addEventListener('click', async () => {
      try { await this.charger(this.detail.note.id, true); this.rendre(); } catch (e) { this.app.erreur(e); }
    });
    $('[data-repondre]')?.addEventListener('click', (e) => this.app.naviguer(`/crm/note/nouveau?nature=${NATURE_NOTE.MESSAGE}&parent=${this.detail.note.id}${this.liens[0] ? `&type_element=${this.liens[0].type}&id_element=${encodeURIComponent(this.liens[0].id)}` : ''}`, { nouvelleFenetre: e.ctrlKey || e.shiftKey }));
    $('[data-supprimer]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('crm_btp.note.supprimer_confirmer'))) return;
      try {
        await api.crm.supprimer(this.detail.note.id);
        this.modifie = false;
        this.app.publier(SUJET_FENETRE.CRM, {});
        this.app.message(texte('crm_btp.note.supprimee'), 'succes');
        this.app.routeur.retour('/crm');
      } catch (e) { this.app.erreur(e); }
    });
    this.controler();
  }

  /** Contrôle de la note (règle partagée avec le serveur) : erreurs affichées sous la saisie. */
  controler() {
    const zone = this.conteneur.querySelector('.crm-erreurs');
    if (!zone || this.lecture) return [];
    const erreurs = controlerNote(this.saisie);
    zone.hidden = !erreurs.length || !this.modifie;
    zone.innerHTML = erreurs.map((e) => `<div>${iconeHtml('avertissement')} ${echapper(MESSAGES_NOTE[e] ?? e)}</div>`).join('');
    return erreurs;
  }

  rendreLiens(lecture) {
    const zone = this.conteneur.querySelector('[data-liens]');
    zone.innerHTML = `${this.liens.length ? `<ul class="crm-liens">${this.liens.map((l, i) => `<li>${lienElement(l)}${i === 0 && this.liens.length > 1 ? ` <span class="aide">${texteHtml('crm_btp.note.principal')}</span>` : ''}
      ${lecture ? '' : `${i > 0 ? `<button type="button" data-principal="${i}" title="${texteHtml('crm_btp.note.principal_titre')}">${iconeHtml('crm_btp_principal')}</button>` : ''}<button type="button" data-retirer="${i}" title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>`}</li>`).join('')}</ul>` : `<p class="aide">${texteHtml('crm_btp.note.aucun_lien')}</p>`}
      ${lecture ? '' : `<div class="crm-ajout-lien"><span data-type></span> <input data-recherche placeholder="${texteHtml('crm_btp.note.rechercher')}" size="16"> <button type="button" data-ajouter title="${texteHtml('commun.ajouter')}">${iconeHtml('ajouter')}</button><div data-resultats></div></div>`}`;
    const maj = () => { this.saisie.liens = this.liens.map((l, i) => ({ type_element: l.type, id_element: String(l.id), principal: i === 0 })); this.marquer(); this.rendreLiens(lecture); };
    zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { this.liens.splice(Number(b.dataset.retirer), 1); maj(); }));
    zone.querySelectorAll('[data-principal]').forEach((b) => b.addEventListener('click', () => { const [x] = this.liens.splice(Number(b.dataset.principal), 1); this.liens.unshift(x); maj(); }));
    if (lecture) return;
    const types = this.ctx.types_elements;
    const type = creerCombo({ options: types.map((t) => ({ valeur: t.code, libelle: `${t.icone ?? ''} ${t.libelle}` })), valeur: 'personne', vide: false });
    zone.querySelector('[data-type]').replaceWith(type);
    const ajouter = (t, id, libelle, url = null) => {
      if (this.liens.some((l) => l.type === t && String(l.id) === String(id))) return;
      const def = this.ctx.types_elements.find((x) => x.code === t);
      this.liens.push({ type: t, id: String(id), libelle, icone: def?.icone, url: url ?? urlFiche(t, id) });
      maj();
    };
    const chercher = async () => {
      const t = type.valeurCombo;
      const recherche = zone.querySelector('[data-recherche]').value.trim();
      const res = zone.querySelector('[data-resultats]');
      const { annuaire, structure } = await this.app.services();
      if (STRUCTURE[t]) {
        const refs = await structure.referentiels();
        const choix = await choisirRattachement({ type: t, titre: texte('crm_btp.note.rattacher', { type: this.ctx.types_elements.find((x) => x.code === t)?.libelle }), liste: refs[STRUCTURE[t]] ?? [], refs });
        if (choix?.id) ajouter(t, choix.id, `${choix.code} – ${choix.libelle ?? ''}`);
        return;
      }
      const trouves = t === 'personne' ? (await annuaire.rechercherPersonnes({ recherche, limite: 15 })).map((p) => ({ id: p.id, libelle: p.nom_commercial || p.raison_sociale, detail: p.ville ?? '' }))
        : t === 'individu' ? (await annuaire.rechercherIndividus({ recherche, limite: 15 })).map((p) => ({ id: p.id, libelle: p.nom_complet, detail: p.personnes ?? '' }))
          : (await api.crm.rechercher(t, recherche)).map((e) => ({ id: e.id, libelle: e.libelle, detail: '', url: e.url }));
      res.innerHTML = trouves.length ? `<ul class="crm-resultats">${trouves.map((x, i) => `<li><button type="button" data-choix="${i}">${echapper(x.libelle)}</button> <span class="aide">${echapper(x.detail)}</span></li>`).join('')}</ul>` : `<p class="aide">${texteHtml('crm_btp.note.aucun_resultat')}</p>`;
      res.querySelectorAll('[data-choix]').forEach((b) => b.addEventListener('click', () => { const x = trouves[Number(b.dataset.choix)]; ajouter(t, x.id, x.libelle, x.url); }));
    };
    zone.querySelector('[data-ajouter]').addEventListener('click', () => chercher().catch((e) => this.app.erreur(e)));
    zone.querySelector('[data-recherche]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); chercher().catch((x) => this.app.erreur(x)); } });
  }

  rendreDestinataires(lecture) {
    const zone = this.conteneur.querySelector('[data-destinataires]');
    const noms = new Map([...this.individus.map((x) => [Number(x.valeur), x.libelle]), ...(this.detail?.destinataires ?? []).map((x) => [x.ind_id, x.individu])]);
    const lus = new Map((this.detail?.destinataires ?? []).map((x) => [x.ind_id, x.lu_le]));
    const liste = this.saisie.destinataires;
    zone.innerHTML = `${liste.length ? `<ul class="crm-liens">${liste.map((id, i) => `<li>${iconeHtml('annuaire_individu')} ${echapper(noms.get(Number(id)) ?? `#${id}`)}
      ${lus.get(Number(id)) ? `<span class="aide" title="${texteHtml('crm_btp.note.lu_le', { date: formatDateHeure(lus.get(Number(id))) })}">${iconeHtml('crm_btp_lu')} ${texteHtml('crm_btp.note.lu')}</span>` : ''}
      ${lecture ? '' : `<button type="button" data-retirer="${i}" title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>`}</li>`).join('')}</ul>` : `<p class="aide">${texteHtml('crm_btp.diffusion.aucun_destinataire')}</p>`}
      ${lecture ? '' : `<div><span data-ajout></span> <button type="button" data-ajouter title="${texteHtml('commun.ajouter')}">${iconeHtml('ajouter')}</button></div>`}`;
    zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { liste.splice(Number(b.dataset.retirer), 1); this.marquer(); this.rendreDestinataires(lecture); this.controler(); }));
    if (lecture) return;
    const ajout = creerCombo({ options: this.individus.filter((x) => !liste.includes(Number(x.valeur))), titre: texte('crm_btp.note.salarie') });
    zone.querySelector('[data-ajout]').replaceWith(ajout);
    zone.querySelector('[data-ajouter]').addEventListener('click', () => {
      const id = ajout.resoudre();
      if (id === '' || id === undefined || id === null) return;
      liste.push(Number(id));
      this.marquer();
      this.rendreDestinataires(lecture);
      this.controler();
    });
  }

  /** Rappels de la note : couleur (seuils globaux), destinataire, Fait / ✕ ; ajout à date ou avant l'échéance. */
  rendreRappels() {
    const zone = this.conteneur.querySelector('[data-rappels]');
    if (!zone) return;
    const rappels = this.detail.rappels ?? [];
    zone.innerHTML = `${rappels.length ? `<ul class="crm-liens">${rappels.map((r) => `<li class="${r.actif ? '' : 'discret'}">${pastilleRappel(r)} ${echapper(libelleRappel(r))}
      <span class="aide">${echapper(r.individu ?? r.cree_par)}${r.traite_le ? ` · ${texteHtml('crm_btp.note.rappel_fait')}` : ''}</span>
      ${r.actif ? `<button type="button" data-traiter="${r.id}" title="${texteHtml('crm_btp.note.traiter_titre')}">${texteHtml('crm_btp.rappels.fait')}</button>` : ''}<button type="button" data-supprimer-rappel="${r.id}" title="${texteHtml('crm_btp.note.supprimer_rappel')}">${iconeHtml('retirer')}</button></li>`).join('')}</ul>` : `<p class="aide">${texteHtml('crm_btp.rappels.aucun')}</p>`}
      <div class="crm-ajout-rappel"><span data-type-rappel></span> <input type="datetime-local" data-quand> <input data-delai size="3" inputmode="numeric" placeholder="${texteHtml('crm_btp.note.jours')}" hidden>
        <span data-pour></span> <button type="button" data-ajouter-rappel title="${texteHtml('crm_btp.note.ajouter_rappel')}">${iconeHtml('ajouter')}</button></div>`;
    const type = creerCombo({ options: TYPES_RAPPEL, valeur: this.saisie.echeance ? 'AVANT' : 'DATE', vide: false });
    const quand = zone.querySelector('[data-quand]');
    const delai = zone.querySelector('[data-delai]');
    const afficher = () => { quand.hidden = type.valeurCombo !== 'DATE'; delai.hidden = type.valeurCombo !== 'AVANT'; };
    type.addEventListener('change', afficher);
    zone.querySelector('[data-type-rappel]').replaceWith(type);
    afficher();
    const pour = creerCombo({ options: this.individus, valeur: this.ctx.individu_id ?? '', titre: texte('crm_btp.note.pour_qui') });
    zone.querySelector('[data-pour]').replaceWith(pour);
    const appliquer = async (f) => {
      try { this.detail.rappels = await f(); this.app.publier(SUJET_FENETRE.CRM, { rappels: true }); this.rendreRappels(); } catch (e) { this.app.erreur(e); }
    };
    zone.querySelector('[data-ajouter-rappel]').addEventListener('click', () => {
      const r = { type: type.valeurCombo, quand: depuisChampDate(quand.value), delai_jours: delai.value === '' ? null : Number(delai.value), ind_id: pour.valeurCombo === '' ? null : Number(pour.valeurCombo) };
      const erreurs = controlerRappel(r, { etat: this.detail.note.etat, echeance: this.detail.note.echeance });
      if (erreurs.length) { this.app.message(erreurs.map((e) => MESSAGES_RAPPEL[e] ?? e).join(' ; '), 'avertissement'); return; }
      appliquer(() => api.crm.ajouterRappel(this.detail.note.id, r));
    });
    zone.querySelectorAll('[data-traiter]').forEach((b) => b.addEventListener('click', () => appliquer(() => api.crm.traiterRappel(Number(b.dataset.traiter)))));
    zone.querySelectorAll('[data-supprimer-rappel]').forEach((b) => b.addEventListener('click', () => appliquer(() => api.crm.supprimerRappel(Number(b.dataset.supprimerRappel)))));
  }

  async rendrePieces(lecture) {
    const zone = this.conteneur.querySelector('[data-pieces]');
    const s = await this.app.services();
    this.explorateur = new ExplorateurGed(zone, {
      fournisseur: s.ged, contexte: { type_element: 'crm_note', id_element: String(this.detail.note.id), libelle: this.detail.note.objet, icone: icone('crm_btp_note_page') }, compact: true,
      ouvrirUrl: (url) => this.app.naviguer(url, { nouvelleFenetre: true }), modifiable: !lecture, admin: this.app.estAdmin(), utilisateur: this.app.utilisateur(),
      message: (t, niv) => this.app.message(t, niv),
    });
  }

  async enregistrer() {
    if (this.lecture) return;
    if (this.message) this.saisie.message_html = this.message.valeur();
    this.modifie = true;
    if (this.controler().length) { this.app.message(texte('crm_btp.note.incomplete'), 'avertissement'); return; }
    try {
      const nouveau = !this.detail;
      this.detail = nouveau ? await api.crm.creer(this.saisie) : await api.crm.enregistrer(this.detail.note.id, this.saisie);
      this.saisie = saisieDeNote(this.detail);
      this.liens = this.detail.liens;
      this.titre = this.detail.note.objet;
      this.modifie = false;
      if (nouveau) this.app.routeur.remplacerUrl(`/crm/note/${this.detail.note.id}`);
      this.app.publier(SUJET_FENETRE.CRM, { id: this.detail.note.id });
      this.app.message(texte('crm_btp.note.enregistree'), 'succes');
      this.rendre();
    } catch (e) { this.app.erreur(e); }
  }

  async action(f, message) {
    if (this.modifie && !await confirmer(texte('crm_btp.commun.perdues'))) return;
    try {
      this.detail = await f();
      this.saisie = saisieDeNote(this.detail);
      this.liens = this.detail.liens;
      this.modifie = false;
      this.app.publier(SUJET_FENETRE.CRM, { id: this.detail.note.id });
      this.app.message(message, 'succes');
      this.rendre();
    } catch (e) { this.app.erreur(e); }
  }
}
