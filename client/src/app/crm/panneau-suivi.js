import { texte, texteHtml, pluriel, iconeHtml } from '@logibtp/socle/dictionnaire';
import { NATURE_NOTE, ETAT_NOTE } from '@logibtp/crm';
import { echapper, formatDateHeure } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { contexteCrm, nouvelleSaisie, iconeNature, pastilleEtat, echeanceNote, estCourriel, noteDepuisCourriel, estClose } from './crm.js';

/** Éléments de la structure des affaires : plans et bordereaux proposés depuis leur suivi. */
const STRUCTURE = ['projet', 'affaire', 'chantier', 'marche'];

/**
 * Suivi d'un élément (module CRM) : notes rattachées (tâches par échéance, puis les autres ; ouvertes seulement sur demande), saisie rapide sur une
 * ligne (Entrée : note pour mémo ; Ctrl+Entrée : tâche à moi, échéance demain 9 h), courriel glissé (.eml, .msg) → note
 * avec le fichier en pièce jointe, note complète ou fenêtre à côté. Utilisé par l'onglet Suivi des documents et des
 * fiches, et par la page /crm/suivi.
 */
export class PanneauSuivi {
  constructor(conteneur, { app, type, id, libelle = '', fenetre = true }) {
    this.conteneur = conteneur;
    this.app = app;
    this.element = { type, id: String(id) };
    this.libelle = libelle;
    this.fenetre = fenetre;
    this.ouvertes = false;
    // Notes modifiées ailleurs (page de la note, autre fenêtre) : liste rafraîchie.
    this.desabonner = app.abonner?.('crm', () => this.charger());
  }

  async ouvrir() {
    const c = this.conteneur;
    c.classList.add('crm-suivi');
    c.innerHTML = `<div class="crm-suivi-barre">
        <input class="crm-saisie-rapide" placeholder="${texteHtml('crm_btp.suivi.saisie_rapide')}" maxlength="200">
        <button type="button" data-complete title="${texteHtml('crm_btp.suivi.note_complete_titre')}">${iconeHtml('ajouter')} ${texteHtml('crm_btp.suivi.note_complete')}</button>
        ${this.fenetre ? `<button type="button" data-fenetre title="${texteHtml('crm_btp.suivi.fenetre')}">${iconeHtml('crm_btp_fenetre')}</button>` : ''}
        <a href="/crm/fil?type=${this.element.type}&id=${encodeURIComponent(this.element.id)}" title="${texteHtml('crm_btp.suivi.fil_titre')}">${iconeHtml('crm_btp_fil')} ${texteHtml('crm_btp.suivi.fil')}</a>
        ${STRUCTURE.includes(this.element.type) ? `<a href="/crm/plans?type=${this.element.type}&id=${encodeURIComponent(this.element.id)}" title="${texteHtml('crm_btp.suivi.plans_titre')}">${iconeHtml('crm_btp_plans')} ${texteHtml('crm_btp.suivi.plans')}</a>
          <a href="/crm/diffusions?type=${this.element.type}&id=${encodeURIComponent(this.element.id)}" title="${texteHtml('crm_btp.suivi.bordereaux_titre')}">${iconeHtml('crm_btp_bordereaux')} ${texteHtml('crm_btp.suivi.bordereaux')}</a>` : ''}
        <label class="fiche-option" title="${texteHtml('crm_btp.suivi.ouvertes_titre')}"><input type="checkbox" data-ouvertes> ${texteHtml('crm_btp.suivi.ouvertes')}</label>
      </div>
      <div class="crm-depot" hidden>${texteHtml('crm_btp.suivi.depot')}</div>
      <div class="crm-suivi-liste"><p class="aide">${texteHtml('crm_btp.suivi.chargement')}</p></div>`;
    const saisie = c.querySelector('.crm-saisie-rapide');
    saisie.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !saisie.value.trim()) return;
      e.preventDefault();
      this.noteRapide(saisie.value.trim(), e.ctrlKey || e.metaKey).then((ok) => { if (ok) saisie.value = ''; });
    });
    c.querySelector('[data-complete]').addEventListener('click', (e) => this.app.naviguer(this.urlNouvelle(), { nouvelleFenetre: !e.altKey }));
    c.querySelector('[data-fenetre]')?.addEventListener('click', () => this.app.naviguer(`/crm/suivi?type=${this.element.type}&id=${encodeURIComponent(this.element.id)}`, { nouvelleFenetre: true }));
    c.querySelector('[data-ouvertes]').addEventListener('change', (e) => { this.ouvertes = e.target.checked; this.charger(); });
    this.brancherDepot();
    await this.charger();
  }

  urlNouvelle(nature = NATURE_NOTE.ACTION) {
    return `/crm/note/nouveau?type_element=${this.element.type}&id_element=${encodeURIComponent(this.element.id)}&nature=${nature}`;
  }

  async charger() {
    const zone = this.conteneur.querySelector('.crm-suivi-liste');
    if (!zone) return;
    try {
      const page = await api.crm.notes({ type_element: this.element.type, id_element: this.element.id, etat: this.ouvertes ? 'ouvertes' : null, taille: 100 });
      this.rendre(zone, page);
    } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; }
  }

  rendre(zone, page) {
    if (!page.notes.length) {
      zone.innerHTML = `<p class="aide">${this.ouvertes ? texteHtml('crm_btp.suivi.aucune_ouverte') : texteHtml('crm_btp.suivi.aucune')}</p>`;
      return;
    }
    zone.innerHTML = `<ul class="crm-notes">${page.notes.map((n) => {
      const e = echeanceNote(n);
      return `<li class="crm-note${estClose(n) ? ' discret' : ''}${n.non_lue ? ' crm-non-lue' : ''}" data-id="${n.id}">
        <span class="crm-note-icone" title="${echapper(n.type ?? '')}">${n.icone ?? iconeNature(n.nature)}</span>
        <a href="/crm/note/${n.id}" class="crm-note-objet">${n.masquee ? `${iconeHtml('verrou')} ` : ''}${echapper(n.objet)}</a>
        ${pastilleEtat(n)}
        <span class="crm-note-qui">${echapper(n.responsable ?? (n.a_prendre ? texte('crm_btp.suivi.a_prendre', { service: n.service ?? '' }) : n.service ?? ''))}</span>
        <span class="crm-note-echeance ${e.classe}">${echapper(e.texte)}</span>
        <span class="aide">${echapper(n.cree_par)} · ${echapper(formatDateHeure(n.cree_le))}${n.nb_reponses ? ` · ${iconeHtml('crm_btp_note')} ${n.nb_reponses}` : ''}</span></li>`;
    }).join('')}</ul>${page.total > page.notes.length ? `<p class="aide">${texteHtml('crm_btp.suivi.tronquee', { nombre: page.notes.length, total: page.total })}</p>` : ''}`;
  }

  /** Note rapide : pour mémo, ou tâche pour l'utilisateur (son individu, sinon son service principal) échéance demain 9 h. */
  async noteRapide(objet, tache) {
    try {
      const s = nouvelleSaisie({ nature: tache ? NATURE_NOTE.TACHE : NATURE_NOTE.ACTION, etat: tache ? ETAT_NOTE.A_FAIRE : ETAT_NOTE.MEMO, element: this.element });
      s.objet = objet;
      if (tache) {
        const ctx = await contexteCrm(this.app);
        const demain = new Date();
        demain.setDate(demain.getDate() + 1);
        demain.setHours(9, 0, 0, 0);
        s.echeance = demain.toISOString();
        s.responsable_id = ctx.individu_id;
        s.srv_id = ctx.services[0]?.id ?? null;
        if (!s.responsable_id && !s.srv_id) { this.app.message(texte('crm_btp.suivi.sans_individu'), 'avertissement'); return false; }
      }
      await api.crm.creer(s);
      this.app.publier?.('crm', { element: this.element });
      await this.charger();
      return true;
    } catch (e) { this.app.erreur(e); return false; }
  }

  brancherDepot() {
    const c = this.conteneur;
    const bandeau = c.querySelector('.crm-depot');
    const avecFichier = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    c.addEventListener('dragover', (e) => { if (!avecFichier(e)) return; e.preventDefault(); bandeau.hidden = false; });
    c.addEventListener('dragleave', (e) => { if (!c.contains(e.relatedTarget)) bandeau.hidden = true; });
    c.addEventListener('drop', async (e) => {
      if (!avecFichier(e)) return;
      e.preventDefault();
      bandeau.hidden = true;
      const fichiers = [...e.dataTransfer.files];
      const courriels = fichiers.filter(estCourriel);
      if (!courriels.length) { this.app.message(texte('crm_btp.suivi.depot_courriel'), 'avertissement'); return; }
      for (const f of courriels) {
        try { await noteDepuisCourriel(this.app, f, this.element); } catch (err) { this.app.erreur(err); }
      }
      this.app.message(pluriel('crm_btp.suivi.courriels_enregistres', courriels.length), 'succes');
      this.app.publier?.('crm', { element: this.element });
      await this.charger();
    });
  }

  fermer() { this.desabonner?.(); }
}
