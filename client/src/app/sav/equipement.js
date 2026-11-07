import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatDate, formatDateHeure, creerCombo, saisir, confirmer } from '@logibtp/socle/ui';
import { urlFiche, urlDocument, TYPE_FICHE } from '../codes.js';
import { choisirTiers } from '../annuaire/choix.js';
import { api } from '../api.js';

// Module SAV, équipements installés, lot 5 du plan Stock (plans/stock.md ; ANALYSE-MODULE-STOCK.md § 11, S24.8) : fiche
// d'un équipement (numéro de série posé chez un client : article, chantier, client, pose, garantie, pièce et lot d'origine),
// modification, retrait et remplacement ; page « nouveau » pour la création manuelle (?lieu=ID : chantier de départ).
const NOUVEAU = 'nouveau';

export class PageEquipement extends PageBase {
  icone = icone('sav_btp_equipement');

  async ouvrir() {
    this.titre = texte('sav_btp.routes.equipement');
    this.conteneur.innerHTML = '<div class="page-parametres page-equipement"></div>';
    this.nouveau = this.params.id === NOUVEAU;
    if (this.nouveau) {
      [this.articles, this.lieux] = await Promise.all([api.stock.articles(), api.stock.lieux()]);
      this.eq = null;
      this.tiers = null;
      this.#rendre();
    } else await this.#charger();
  }

  async #charger() {
    this.eq = await api.sav.equipement(this.params.id);
    this.interventions = await api.sav.interventions(this.params.id).catch(() => []);
    this.titre = texte('sav_btp.equipement.titre', { numero: this.eq.numero });
    this.tiers = this.eq.tiers ? { id: this.eq.tiers, nom: this.eq.description?.tiers_nom } : null;
    if (!this.lieux) [this.articles, this.lieux] = await Promise.all([api.stock.articles(), api.stock.lieux()]);
    this.#rendre();
  }

  #rendre() {
    const e = this.eq;
    const z = this.conteneur.querySelector('.page-equipement');
    const d = e?.description ?? {};
    const modifiable = !e || e.etat === 'INSTALLE';
    const lien = (url, contenu) => `<a href="${url}" data-url>${contenu}</a>`;
    const g = e?.garantie;
    const ligne = (cle, contenu) => `<tr><th>${texteHtml(`sav_btp.equipement.${cle}`)}</th><td>${contenu}</td></tr>`;
    z.innerHTML = `<div class="entete-page"><h1 class="page-titre">${iconeHtml('sav_btp_equipement')} ${e ? texteHtml('sav_btp.equipement.titre', { numero: e.numero }) : texteHtml('sav_btp.equipement.nouveau')}</h1>
        ${e ? `<span class="etiquette">${texteHtml(`sav_btp.etats.${e.etat}`)}</span>` : ''}
        ${g ? `<span class="${g.etat === 'ECHUE' ? 'avertissement' : 'etiquette'}">${texteHtml(`sav_btp.garanties.${g.etat}`)}${g.etat === 'EN_COURS' && g.jours_restants !== null ? ` · ${texteHtml('sav_btp.equipement.jours_restants', { jours: g.jours_restants })}` : ''}</span>` : ''}</div>
      <table class="tableau-compact largeur-contenu"><tbody>
        ${ligne('numero', modifiable ? '<input data-numero size="30" maxlength="60">' : echapper(e.numero))}
        ${ligne('article', e && !modifiable ? lien(urlFiche(TYPE_FICHE.ELEMENT, e.article), `${echapper(d.article_code ?? '')} ${echapper(d.article_libelle ?? '')}`) : '<span data-article></span>')}
        ${ligne('libelle', modifiable ? '<input data-libelle size="50" maxlength="200">' : echapper(e.libelle ?? ''))}
        ${ligne('chantier', modifiable ? '<span data-lieu></span>' : (e.lieu ? lien(urlFiche(TYPE_FICHE.CHANTIER, e.lieu), `${echapper(d.lieu_code ?? '')} ${echapper(d.lieu_libelle ?? '')}`) : ''))}
        ${ligne('client', modifiable ? '<span data-tiers></span>' : (e.tiers ? lien(urlFiche(TYPE_FICHE.PERSONNE, e.tiers), echapper(d.tiers_nom ?? '')) : ''))}
        ${ligne('pose', modifiable ? '<input type="date" data-pose>' : formatDate(e.pose))}
        ${ligne('garantie_mois', modifiable ? '<input type="number" min="0" max="600" step="1" data-mois class="nombre">' : echapper(e.garantie_mois ?? ''))}
        ${ligne('fin_garantie', modifiable ? '<input type="date" data-fin>' : formatDate(e.fin_garantie_saisie))}
        ${e ? ligne('fin_calculee', formatDate(g?.fin)) : ''}
        ${ligne('commentaire', modifiable ? '<textarea data-commentaire rows="3" cols="50"></textarea>' : echapper(e.commentaire ?? ''))}
        ${e?.lot ? ligne('lot', lien(`/stock/lot/${e.lot}`, texteHtml('sav_btp.equipement.voir_lot'))) : ''}
        ${e?.piece ? ligne('piece', lien(urlDocument(e.piece), echapper(d.piece ?? String(e.piece)))) : ''}
        ${e ? ligne('origine', texteHtml(`sav_btp.origines.${e.origine}`)) : ''}
        ${e?.retire_le ? ligne('retire_le', formatDate(e.retire_le)) : ''}
        ${e?.remplace ? ligne('remplace', lien(`/sav/equipement/${e.remplace}`, texteHtml('sav_btp.equipement.voir'))) : ''}
        ${e?.remplacant ? ligne('remplacant', lien(`/sav/equipement/${e.remplacant}`, texteHtml('sav_btp.equipement.voir'))) : ''}
        ${e ? ligne('cree', `${formatDateHeure(e.cree_le)} · ${echapper(e.cree ?? '')}`) : ''}
      </tbody></table>
      ${e ? `<h2>${texteHtml('sav_btp.equipement.interventions')}</h2>
      ${this.interventions.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('sav_btp.equipement.int_date')}</th><th>${texteHtml('sav_btp.equipement.int_ordre')}</th>
        <th>${texteHtml('sav_btp.equipement.int_constat')}</th><th>${texteHtml('sav_btp.equipement.int_travaux')}</th><th>${texteHtml('sav_btp.equipement.int_suite')}</th></tr></thead><tbody>
        ${this.interventions.map((i) => `<tr><td>${formatDate(i.le)}</td><td>${lien(urlDocument(i.ent_id), echapper(i.numero ?? ''))} ${echapper(i.objet ?? '')}</td><td>${echapper(i.constat)}</td><td>${echapper(i.travaux)}</td>
          <td>${texteHtml(i.terminee ? 'sav_btp.equipement.int_terminee' : 'sav_btp.equipement.int_a_reprendre')}</td></tr>`).join('')}
      </tbody></table>` : `<p class="aide">${texteHtml('sav_btp.equipement.aucune_intervention')}</p>`}` : ''}
      <p class="ligne">
        ${modifiable ? `<button type="button" data-enregistrer>${iconeHtml('sav_btp_enregistrer')} ${texteHtml('sav_btp.equipement.enregistrer')}</button>` : ''}
        ${e && modifiable ? `<input type="date" data-retrait title="${texteHtml('sav_btp.equipement.retrait_date')}">
        <button type="button" data-retirer>${iconeHtml('sav_btp_retirer')} ${texteHtml('sav_btp.equipement.retirer')}</button>
        <button type="button" data-remplacer>${iconeHtml('sav_btp_remplacer')} ${texteHtml('sav_btp.equipement.remplacer')}</button>` : ''}
      </p>`;
    if (modifiable) this.#champs(z);
  }

  /** Champs de saisie : combos article (création seulement) et chantier, tiers, valeurs de l'équipement. */
  #champs(z) {
    const e = this.eq;
    const val = (sel, v) => { z.querySelector(sel).value = v ?? ''; };
    val('[data-numero]', e?.numero); val('[data-libelle]', e?.libelle); val('[data-pose]', e?.pose?.slice(0, 10)); val('[data-mois]', e?.garantie_mois);
    val('[data-retrait]', new Date().toISOString().slice(0, 10));
    val('[data-fin]', e?.fin_garantie_saisie?.slice(0, 10)); val('[data-commentaire]', e?.commentaire);
    const lieuInitial = e?.lieu ?? (Number(new URLSearchParams(location.search).get('lieu')) || '');
    this.comboLieu = creerCombo({ options: this.lieux.filter((l) => !l.depot).map((l) => ({ valeur: l.id, libelle: `${l.code} – ${l.libelle}` })), valeur: lieuInitial });
    z.querySelector('[data-lieu]').append(this.comboLieu);
    if (!e) {
      this.comboArticle = creerCombo({ options: this.articles.map((a) => ({ valeur: a.id, libelle: `${a.code} – ${a.libelle}` })), valeur: '', vide: false });
      z.querySelector('[data-article]').append(this.comboArticle);
    } else z.querySelector('[data-article]').textContent = `${this.eq.description?.article_code ?? ''} ${this.eq.description?.article_libelle ?? ''}`;
    const zoneTiers = z.querySelector('[data-tiers]');
    const afficherTiers = () => {
      zoneTiers.innerHTML = `${this.tiers ? echapper(this.tiers.nom ?? this.tiers.raison_sociale ?? String(this.tiers.id)) : ''}
        <button type="button" data-choisir-tiers title="${texteHtml('sav_btp.equipement.choisir_client')}">${iconeHtml('sav_btp_client')}</button>
        ${this.tiers ? `<button type="button" data-vider-tiers title="${texteHtml('sav_btp.equipement.vider_client')}">${iconeHtml('sav_btp_vider')}</button>` : ''}`;
      zoneTiers.querySelector('[data-choisir-tiers]').addEventListener('click', async () => {
        const t = await choisirTiers({ relations: ['CLIENT', 'PROSPECT'], titre: texte('sav_btp.equipement.choisir_client') });
        if (t && !('creer' in t)) { this.tiers = { id: t.id, nom: t.raison_sociale ?? t.nom }; afficherTiers(); }
      });
      zoneTiers.querySelector('[data-vider-tiers]')?.addEventListener('click', () => { this.tiers = null; afficherTiers(); });
    };
    afficherTiers();
    z.querySelector('[data-enregistrer]').addEventListener('click', () => this.#enregistrer(z));
    z.querySelector('[data-retirer]')?.addEventListener('click', () => this.#retirer());
    z.querySelector('[data-remplacer]')?.addEventListener('click', () => this.#remplacer());
  }

  #saisie(z) {
    const nb = z.querySelector('[data-mois]').value;
    return {
      numero: z.querySelector('[data-numero]').value, article: this.eq ? this.eq.article : (Number(this.comboArticle.valeurCombo) || null),
      lot: this.eq?.lot ?? null, libelle: z.querySelector('[data-libelle]').value.trim() || null, lieu: Number(this.comboLieu.valeurCombo) || null,
      tiers: this.tiers?.id ?? null, pose: z.querySelector('[data-pose]').value || null, garantie_mois: nb === '' ? null : Number(nb),
      fin_garantie: z.querySelector('[data-fin]').value || null, commentaire: z.querySelector('[data-commentaire]').value.trim() || null,
    };
  }

  async #enregistrer(z) {
    try {
      const saisie = this.#saisie(z);
      if (this.eq) {
        this.eq = await api.sav.modifierEquipement(this.eq.id, saisie);
        this.app.message(texte('sav_btp.equipement.enregistre'));
        await this.#charger();
      } else {
        const cree = await api.sav.creerEquipement(saisie);
        this.app.message(texte('sav_btp.equipement.cree_message'));
        this.app.naviguer(`/sav/equipement/${cree.id}`);
      }
    } catch (err) { this.app.erreur(err); }
  }

  async #retirer() {
    const jour = this.conteneur.querySelector('[data-retrait]').value;
    try {
      await api.sav.retirerEquipement(this.eq.id, { le: jour || null, commentaire: null });
      this.app.message(texte('sav_btp.equipement.retire_message'));
      await this.#charger();
    } catch (err) { this.app.erreur(err); }
  }

  async #remplacer() {
    const numero = await saisir(texte('sav_btp.equipement.remplacement_numero'), '', { titre: texte('sav_btp.equipement.remplacer'), obligatoire: true });
    if (numero === null) return;
    if (!await confirmer(texte('sav_btp.equipement.remplacement_confirmer', { ancien: this.eq.numero, nouveau: numero.trim() }))) return;
    try {
      const nouveau = await api.sav.remplacerEquipement(this.eq.id, {
        numero: numero.trim(), article: this.eq.article, lieu: this.eq.lieu, tiers: this.eq.tiers, garantie_mois: this.eq.garantie_mois,
      });
      this.app.message(texte('sav_btp.equipement.remplace_message'));
      this.app.naviguer(`/sav/equipement/${nouveau.id}`);
    } catch (err) { this.app.erreur(err); }
  }
}
