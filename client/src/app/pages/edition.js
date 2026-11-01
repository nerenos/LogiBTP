import { texte, texteHtml, textesParCode, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { creerCombo, lirePreferences, ecrirePreferences, echapper, separateur } from '@logibtp/socle/ui';
import { editer, pageSvg, base64VersOctets } from '@logibtp/edition';
import { api } from '../api.js';
import { policesEdition } from '../editions/polices.js';
import { EditeurModeleApercu } from '../editions/editeur-modele.js';

const GABARIT = `
  <div class="edition-barre">
    <h1 class="page-titre">${iconeHtml('edition_btp_imprimer')} <span data-titre>${texteHtml('edition_btp.apercu.titre')}</span></h1>
    <label>${texteHtml('edition_btp.apercu.modele')} <span data-combo="modele"></span></label>
    <label data-zone="presentation">${texteHtml('edition_btp.apercu.presentation')} <span data-combo="presentation"></span></label>
    <label data-zone="format">${texteHtml('edition_btp.apercu.format')} <span data-combo="format"></span></label>
    <span class="edition-parametres" data-zone="parametres"></span>
    <label>${texteHtml('edition_btp.apercu.zoom')} <span data-combo="zoom"></span></label>
    <span class="edition-actions">
      <button data-action="imprimer" class="principal" title="${texteHtml('edition_btp.apercu.imprimer_aide')}">${iconeHtml('edition_btp_imprimer')} ${texteHtml('edition_btp.apercu.imprimer')}</button>
      <button data-action="pdf" title="${texteHtml('edition_btp.apercu.pdf_aide')}">${iconeHtml('edition_btp_pdf')} ${texteHtml('edition_btp.apercu.pdf')}</button>
      <button data-action="ranger" title="${texteHtml('edition_btp.apercu.ranger_aide')}">${iconeHtml('edition_btp_ranger')} ${texteHtml('edition_btp.apercu.ranger')}</button>
      <button data-action="double" title="${texteHtml('edition_btp.apercu.double_aide')}">${iconeHtml('edition_btp_double')} ${texteHtml('edition_btp.apercu.double')}</button>
      <button data-action="actualiser" title="${texteHtml('edition_btp.apercu.actualiser')}">${iconeHtml('edition_btp_actualiser')}</button>
      <button data-action="editer" data-admin hidden title="${texteHtml('edition_btp.apercu.editer_aide')}">${iconeHtml('edition_btp_modele')} ${texteHtml('edition_btp.editeur.modele')}</button>
    </span>
  </div>
  <div class="edition-alertes" data-zone="alertes" hidden></div>
  <div class="edition-productions" data-zone="productions" hidden></div>
  <div class="edition-corps">
    <div class="edition-pages" data-zone="pages"><p class="aide">${texteHtml('edition_btp.apercu.preparation')}</p></div>
    <div class="edition-separateur" data-zone="separateur" hidden title="${texteHtml('edition_btp.apercu.separateur')}"></div>
    <div class="edition-editeur" data-zone="editeur" hidden></div>
  </div>`;

const ZOOMS = [50, 75, 100, 125, 150].map((z) => ({ valeur: String(z), libelle: `${z} %` }));

/**
 * Aperçu d'une édition : /edition?source=document&id=12&modele=DEVIS&presentation=DETAILLEE&format=A4.
 * Le serveur fournit en un appel le modèle, les données, la charte, les blocs et les ressources ; le moteur du
 * navigateur (même code que le serveur) produit les pages, dessinées en SVG. Imprimer et PDF : PDF du serveur.
 * Administrateur : ✎ Modèle ouvre l'éditeur du modèle (fermé à l'ouverture de l'aperçu) sur les données et paramètres de
 * l'aperçu, à droite des pages ; séparateur déplaçable, largeur gardée dans le navigateur.
 */
export class PageEdition extends PageBase {
  icone = icone('edition_btp_imprimer');

  async ouvrir() {
    const q = this.requete;
    this.demande = {
      source: q.source ?? 'document', id: String(q.id ?? ''), modele: q.modele || null, presentation: q.presentation || null,
      format: q.format || null, orientation: null, parametres: q.recherche ? { recherche: q.recherche } : {},
    };
    this.conteneur.innerHTML = GABARIT;
    this.conteneur.classList.add('page-edition-apercu');
    this.conteneur.querySelector('.edition-barre').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const action = {
        imprimer: () => this.pdf(true), pdf: () => this.pdf(false), actualiser: () => this.charger(),
        ranger: () => this.ranger(), double: () => this.double(), editer: () => this.basculerEditeur(),
      }[b.dataset.action];
      Promise.resolve(action?.()).catch((x) => this.app.erreur(x));
    });
    this.$('[data-action="editer"]').hidden = !this.app.estAdmin();
    this.editionDemandee = false;
    this.separateur();
    await this.charger();
  }

  $(s) { return this.conteneur.querySelector(s); }

  /**
   * Éditeur du modèle (administrateur) : panneau à droite des pages, masqué à l'ouverture ; masqué puis rouvert, il
   * garde ses onglets et sa saisie (reconstruit seulement après une nouvelle préparation : autre modèle, ⟳).
   */
  basculerEditeur(ouvrir = this.$('[data-zone="editeur"]').hidden) {
    const zone = this.$('[data-zone="editeur"]');
    zone.hidden = !ouvrir;
    this.$('[data-zone="separateur"]').hidden = !ouvrir;
    this.conteneur.classList.toggle('avec-editeur', ouvrir);
    this.$('[data-action="editer"]').classList.toggle('actif', ouvrir);
    this.editionDemandee = ouvrir;
    if (!ouvrir) return;
    zone.style.flexBasis = lirePreferences().apercuEditeurLargeur ? `${lirePreferences().apercuEditeurLargeur}px` : '';
    this.editeur ??= new EditeurModeleApercu(zone, this);
    if (this.prepEditee !== this.prep) { this.editeur.construire(); this.prepEditee = this.prep; }
  }

  /** Séparateur entre les pages et l'éditeur : glisser pour régler la largeur de l'éditeur (préférence du navigateur). */
  separateur() {
    const sep = this.$('[data-zone="separateur"]');
    const zone = this.$('[data-zone="editeur"]');
    separateur(sep, {
      cible: zone, sens: -1, min: 280, max: () => this.$('.edition-corps').getBoundingClientRect().width - 200,
      appliquer: (z, v) => { z.style.flexBasis = `${v}px`; },
      surFin: (v) => ecrirePreferences({ apercuEditeurLargeur: v }),
      surDoubleClic: () => { zone.style.flexBasis = ''; ecrirePreferences({ apercuEditeurLargeur: null }); },
    });
  }

  /** Préparation par le serveur (modèle, données, charte, blocs, ressources), puis rendu. */
  async charger() {
    const zone = this.$('[data-zone="pages"]');
    try {
      this.prep = await api.editions.apercu(this.demande);
    } catch (e) {
      zone.innerHTML = `<p class="aide">${echapper(e.message)}</p>`;
      throw e;
    }
    this.demande.modele = this.prep.modele.code;
    this.titre = texte('edition_btp.apercu.titre_element', { element: this.prep.element });
    this.$('[data-titre]').textContent = this.prep.element;
    this.construireBarre();
    await this.rendre();
    if (this.editionDemandee) this.basculerEditeur(true);
    await this.majProductions();
    this.app.majPage();
  }

  construireBarre() {
    const p = this.prep;
    const contenu = p.modele.contenu;
    const placer = (nom, combo) => { const z = this.$(`[data-combo="${nom}"]`); z.replaceChildren(combo); };
    const modele = creerCombo({ options: p.modeles.map((m) => ({ valeur: m.code, libelle: m.libelle })), valeur: p.modele.code, vide: false });
    modele.addEventListener('change', () => { this.demande.modele = modele.valeurCombo; this.demande.presentation = null; this.demande.format = null; this.majUrl(); this.charger().catch((e) => this.app.erreur(e)); });
    placer('modele', modele);

    const presentations = contenu.presentations ?? [];
    this.$('[data-zone="presentation"]').hidden = presentations.length === 0;
    if (presentations.length) {
      const pres = creerCombo({ options: presentations.map((x) => ({ valeur: x.code, libelle: x.libelle })), valeur: this.demande.presentation ?? p.presentation ?? '', vide: false });
      pres.addEventListener('change', () => { this.demande.presentation = pres.valeurCombo; this.majUrl(); this.rendre(); });
      placer('presentation', pres);
      this.comboPresentation = pres;
    }

    const formats = [...new Set([contenu.page?.format ?? 'A4', ...(contenu.page?.flexible ?? [])])];
    this.$('[data-zone="format"]').hidden = formats.length < 2;
    const format = creerCombo({ options: formats.map((f) => ({ valeur: f, libelle: f })), valeur: this.demande.format ?? formats[0], vide: false });
    format.addEventListener('change', () => { this.demande.format = format.valeurCombo; this.majUrl(); this.rendre(); });
    placer('format', format);

    const prefs = lirePreferences();
    const zoom = creerCombo({ options: ZOOMS, valeur: String(prefs.apercuZoom ?? 100), vide: false });
    zoom.addEventListener('change', () => { ecrirePreferences({ apercuZoom: Number(zoom.valeurCombo) }); this.appliquerZoom(); });
    placer('zoom', zoom);

    // Paramètres du modèle : cases à cocher (booléens), nombres (étiquette de départ, exemplaires…).
    const zp = this.$('[data-zone="parametres"]');
    zp.replaceChildren();
    for (const par of (contenu.parametres ?? []).filter((x) => x.type === 'nombre')) {
      const l = document.createElement('label');
      l.innerHTML = `${echapper(par.libelle ?? par.nom)} <input type="number" min="1" step="1" style="width:4.5em">`;
      const c = l.querySelector('input');
      c.value = String(this.demande.parametres[par.nom] ?? par.defaut ?? 1);
      c.addEventListener('change', () => { this.demande.parametres[par.nom] = Number(c.value) || 1; this.rendre(); });
      zp.append(l);
    }
    for (const par of (contenu.parametres ?? []).filter((x) => x.type === 'booleen')) {
      const l = document.createElement('label');
      l.className = 'coche';
      l.innerHTML = `<input type="checkbox"> ${echapper(par.libelle ?? par.nom)}`;
      const c = l.querySelector('input');
      c.checked = Boolean(this.demande.parametres[par.nom] ?? par.defaut);
      c.addEventListener('change', () => { this.demande.parametres[par.nom] = c.checked; this.rendre(); });
      zp.append(l);
    }
  }

  majUrl() {
    const d = this.demande;
    const q = new URLSearchParams({
      source: d.source, id: d.id, ...(d.modele ? { modele: d.modele } : {}), ...(d.presentation ? { presentation: d.presentation } : {}),
      ...(d.format ? { format: d.format } : {}), ...(d.parametres.recherche ? { recherche: d.parametres.recherche } : {}),
    });
    this.app.routeur.remplacerUrl(`/edition?${q}`);
  }

  ressources() {
    const res = {};
    for (const [code, r] of Object.entries(this.prep.ressources ?? {})) {
      res[code] = { ...r, octets: base64VersOctets(r.base64), url: `data:image/${r.type};base64,${r.base64}` };
    }
    return res;
  }

  /** Mise en page par le moteur du navigateur (mêmes pages que le PDF du serveur). */
  async rendre() {
    const p = this.prep;
    const polices = await policesEdition();
    const ressources = this.ressources();
    const t0 = performance.now();
    const r = editer(p.modele.contenu, p.donnees, {
      polices, charte: p.charte, blocs: p.blocs, rapports: p.rapports, ressources, parametres: this.demande.parametres,
      presentation: this.demande.presentation ?? p.presentation, format: this.demande.format, aujourdhui: p.aujourdhui,
    });
    const duree = Math.round(performance.now() - t0);
    if (r.presentation && this.comboPresentation && !this.demande.presentation) this.comboPresentation.definirValeur(r.presentation);
    this.resultat = r;
    const zone = this.$('[data-zone="pages"]');
    zone.innerHTML = r.pages.map((pg) => `<div class="edition-page">${pageSvg(pg, { ressources })}<span class="edition-numero">${pg.numero} / ${r.pages.length}</span></div>`).join('');
    this.appliquerZoom();
    const alertes = this.$('[data-zone="alertes"]');
    alertes.hidden = r.alertes.length === 0;
    alertes.innerHTML = r.alertes.length
      ? `${texteHtml('edition_btp.apercu.alertes_html', { icone: icone('avertissement'), nombre: r.alertes.length })}<ul>${r.alertes.map((a) => `<li><code>${echapper(a.code)}</code> ${echapper(a.message)}</li>`).join('')}</ul>`
      : '';
    zone.dataset.duree = String(duree);
  }

  appliquerZoom() {
    const z = Number(lirePreferences().apercuZoom ?? 100) / 100;
    for (const s of this.conteneur.querySelectorAll('svg.page-edition')) {
      s.style.width = `calc(${s.getAttribute('width')} * ${z})`;
      s.style.height = `calc(${s.getAttribute('height')} * ${z})`;
    }
  }

  /** Productions en GED de l'élément (file du serveur) : dernière production et son état. */
  async majProductions() {
    const zone = this.$('[data-zone="productions"]');
    const liste = await api.editions.productions(this.demande.source, this.demande.id).catch(() => []);
    zone.hidden = liste.length === 0;
    if (!liste.length) return;
    const t = liste[0];
    const ICONES = { A_FAIRE: 'edition_btp_attente', EN_COURS: 'edition_btp_attente', FAIT: 'edition_btp_fait', ECHEC: 'erreur' };
    const etats = textesParCode('edition_btp.apercu.etats', ['A_FAIRE', 'EN_COURS', 'FAIT', 'ECHEC']);
    const motifs = textesParCode('edition_btp.apercu.motifs', ['VALIDATION', 'ENVOI', 'DEMANDE', 'LOT']);
    const etat = etats[t.etat] ? `${icone(ICONES[t.etat])} ${etats[t.etat]}` : t.etat;
    zone.innerHTML = texteHtml('edition_btp.apercu.production_html', { motif: motifs[t.motif] ?? t.motif, etat })
      + `${t.pages ? ` ${texteHtml('edition_btp.apercu.production_pages', { pages: t.pages, modele: t.modele ?? '' })}` : ''}${t.erreur ? ` — ${echapper(t.erreur)}` : ''}`;
    if (t.etat === 'A_FAIRE' || t.etat === 'EN_COURS') setTimeout(() => this.majProductions(), 3000);
  }

  /** Production par le serveur et rangement en GED (modèle et présentation choisis). */
  async ranger() {
    await api.editions.produire({ ...this.demande, presentation: this.demande.presentation ?? this.resultat?.presentation ?? null });
    this.app.message(texte('edition_btp.apercu.production_demandee'), 'succes');
    await this.majProductions();
  }

  /** Double : dernier PDF rangé dans la GED (jamais régénéré). */
  async double() {
    const r = await api.editions.rangee(this.demande.source, this.demande.id).catch(() => null);
    if (!r) { this.app.message(texte('edition_btp.apercu.aucune_rangee'), 'avertissement'); return; }
    window.open(`/api/ged/versions/${r.version_id}/contenu`, '_blank');
  }

  /**
   * PDF du serveur (même moteur, dans Jint). Imprimer : impression du PDF (100 %), modèle et présentation retenus
   * pour ce document (Q13) ; sinon téléchargement.
   */
  async pdf(imprimer) {
    const b = this.$(`[data-action="${imprimer ? 'imprimer' : 'pdf'}"]`);
    b.disabled = true;
    try {
      const { blob } = await api.editions.pdf({ ...this.demande, presentation: this.demande.presentation ?? this.resultat?.presentation ?? null }, imprimer);
      const url = URL.createObjectURL(blob);
      const nom = `${(this.prep.element || 'edition').replace(/[^\p{L}\p{N}_-]+/gu, '-')}.pdf`;
      if (!imprimer) {
        const a = document.createElement('a');
        a.href = url;
        a.download = nom;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
      }
      const cadre = document.createElement('iframe');
      cadre.className = 'edition-impression';
      cadre.src = url;
      cadre.addEventListener('load', () => {
        try { cadre.contentWindow.focus(); cadre.contentWindow.print(); } catch { window.open(url, '_blank'); }
        setTimeout(() => { cadre.remove(); URL.revokeObjectURL(url); }, 120000);
      });
      document.body.append(cadre);
      this.app.message(texte('edition_btp.apercu.impression'), 'succes');
    } finally {
      b.disabled = false;
    }
  }
}
