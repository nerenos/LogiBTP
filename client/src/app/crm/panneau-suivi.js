import { echapper } from '@logibtp/socle/ui';
import { api } from '../api.js';
import {
  contexteCrm, nouvelleSaisie, iconeNature, pastilleEtat, echeanceNote, formatDateHeure, estCourriel, noteDepuisCourriel, estClose,
} from './crm.js';

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
        <input class="crm-saisie-rapide" placeholder="Note rapide : Entrée = pour mémo · Ctrl+Entrée = tâche pour moi (demain)" maxlength="200">
        <button type="button" data-complete title="Note complète (nature, responsable, destinataires, pièces) dans une autre fenêtre">＋ Note…</button>
        ${this.fenetre ? '<button type="button" data-fenetre title="Ouvrir ce suivi dans une fenêtre à côté">⧉</button>' : ''}
        <label class="fiche-option" title="Masquer les notes terminées, pour mémo et annulées"><input type="checkbox" data-ouvertes> Ouvertes seulement</label>
      </div>
      <div class="crm-depot" hidden>Déposez le courriel (.eml, .msg) : une note est créée avec le fichier en pièce jointe</div>
      <div class="crm-suivi-liste"><p class="aide">Chargement…</p></div>`;
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

  urlNouvelle(nature = 'ACTION') {
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
      zone.innerHTML = `<p class="aide">${this.ouvertes ? 'Aucune note ouverte.' : 'Aucune note : saisissez une note rapide, déposez un courriel ou créez une note complète.'}</p>`;
      return;
    }
    zone.innerHTML = `<ul class="crm-notes">${page.notes.map((n) => {
      const e = echeanceNote(n);
      return `<li class="crm-note${estClose(n) ? ' discret' : ''}${n.non_lue ? ' crm-non-lue' : ''}" data-id="${n.id}">
        <span class="crm-note-icone" title="${echapper(n.type ?? '')}">${n.icone ?? iconeNature(n.nature)}</span>
        <a href="/crm/note/${n.id}" class="crm-note-objet">${n.masquee ? '🔒 ' : ''}${echapper(n.objet)}</a>
        ${pastilleEtat(n)}
        <span class="crm-note-qui">${echapper(n.responsable ?? (n.a_prendre ? `À prendre (${n.service ?? ''})` : n.service ?? ''))}</span>
        <span class="crm-note-echeance ${e.classe}">${echapper(e.texte)}</span>
        <span class="aide">${echapper(n.cree_par)} · ${echapper(formatDateHeure(n.cree_le))}${n.nb_reponses ? ` · 💬 ${n.nb_reponses}` : ''}</span></li>`;
    }).join('')}</ul>${page.total > page.notes.length ? `<p class="aide">${page.notes.length} notes sur ${page.total} : voir la liste complète dans le menu Suivi.</p>` : ''}`;
  }

  /** Note rapide : pour mémo, ou tâche pour l'utilisateur (son individu, sinon son service principal) échéance demain 9 h. */
  async noteRapide(objet, tache) {
    try {
      const s = nouvelleSaisie({ nature: tache ? 'TACHE' : 'ACTION', etat: tache ? 'A_FAIRE' : 'MEMO', element: this.element });
      s.objet = objet;
      if (tache) {
        const ctx = await contexteCrm(this.app);
        const demain = new Date();
        demain.setDate(demain.getDate() + 1);
        demain.setHours(9, 0, 0, 0);
        s.echeance = demain.toISOString();
        s.responsable_id = ctx.individu_id;
        s.srv_id = ctx.services[0]?.id ?? null;
        if (!s.responsable_id && !s.srv_id) { this.app.message('Votre compte n\'est relié à aucun individu ni service : utilisez « ＋ Note… »', 'avertissement'); return false; }
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
      if (!courriels.length) { this.app.message('Déposez un courriel (.eml ou .msg) ; les autres pièces se joignent depuis la note', 'avertissement'); return; }
      for (const f of courriels) {
        try { await noteDepuisCourriel(this.app, f, this.element); } catch (err) { this.app.erreur(err); }
      }
      this.app.message(`${courriels.length} courriel(s) enregistré(s) en note`, 'succes');
      this.app.publier?.('crm', { element: this.element });
      await this.charger();
    });
  }

  fermer() { this.desabonner?.(); }
}
