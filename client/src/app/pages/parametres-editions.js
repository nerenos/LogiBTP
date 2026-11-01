import { texte, texteHtml, textesParCode, pairesParCode, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, telechargerFichier, saisir, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';

// Mentions : [chemin, genre] ; libellé « edition_btp.mentions.<chemin, points en _> ».
const CHAMPS_MENTIONS = [
  ['decennale.assureur'], ['decennale.adresse'], ['decennale.police'], ['decennale.couverture'],
  ['penalites', 'zone'], ['indemnite', 'zone'], ['escompte', 'zone'], ['mediateur.nom'], ['mediateur.site'],
  ['retractation', 'zone'], ['accord', 'zone'], ['tva_debits', 'case'], ['libre', 'zone'],
];
const LIBELLES_MENTIONS = textesParCode('edition_btp.mentions', CHAMPS_MENTIONS.map(([c]) => c.replace('.', '_')));

const lire = (o, chemin) => chemin.split('.').reduce((v, k) => (v ? v[k] : undefined), o);
const ecrire = (o, chemin, v) => {
  const parts = chemin.split('.');
  let c = o;
  for (const k of parts.slice(0, -1)) c = (c[k] ??= {});
  c[parts.at(-1)] = v;
};

/**
 * Paramétrage des éditions : mentions imprimées de la société (§ 15.4), modèle par défaut de chaque type de document
 * (Q12), modèles et blocs (copie, suppression, rapports qui utilisent un bloc). Écriture : administrateur.
 */
export class PageParametresEditions extends PageBase {
  icone = icone('edition_btp_imprimer');

  async ouvrir() {
    this.titre = texte('edition_btp.routes.parametres');
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">${iconeHtml('edition_btp_imprimer')} ${texteHtml('edition_btp.parametres.titre')}</h1>
      <h2>${texteHtml('edition_btp.parametres.mentions')}</h2><div class="mentions"></div>
      <h2>${texteHtml('edition_btp.parametres.defauts')}</h2><div class="defauts"></div>
      <h2>${texteHtml('edition_btp.parametres.modeles')}</h2><div class="import"></div><div class="modeles"></div>
      <p class="aide">${texteHtml('edition_btp.parametres.images_html')}</p></div>`;
    await Promise.all([this.ouvrirMentions(), this.ouvrirDefauts(), this.ouvrirModeles()]);
    this.ouvrirImport();
  }

  async ouvrirMentions() {
    const zone = this.conteneur.querySelector('.mentions');
    const mentions = await api.editions.mentions();
    const admin = this.app.estAdmin();
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><tbody>${CHAMPS_MENTIONS.map(([c, t]) => `<tr><th>${echapper(LIBELLES_MENTIONS[c.replace('.', '_')])}</th><td>${
      t === 'case' ? `<input type="checkbox" data-mention="${c}">`
        : t === 'zone' ? `<textarea rows="2" cols="70" data-mention="${c}"></textarea>` : `<input type="text" size="50" data-mention="${c}">`}</td></tr>`).join('')}</tbody></table>
      <p><button class="principal" data-enregistrer ${admin ? '' : 'disabled'}>${texteHtml('edition_btp.parametres.enregistrer_mentions')}</button></p>`;
    for (const el of zone.querySelectorAll('[data-mention]')) {
      const v = lire(mentions, el.dataset.mention);
      if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = v ?? '';
      el.disabled = !admin;
    }
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      const m = structuredClone(mentions);
      for (const el of zone.querySelectorAll('[data-mention]')) ecrire(m, el.dataset.mention, el.type === 'checkbox' ? el.checked : el.value.trim());
      try { await api.editions.enregistrerMentions(m); this.app.message(texte('edition_btp.parametres.mentions_enregistrees'), 'succes'); } catch (e) { this.app.erreur(e); }
    });
  }

  async ouvrirDefauts() {
    const zone = this.conteneur.querySelector('.defauts');
    const [types, defauts, rapports] = await Promise.all([api.typesDocument(), api.editions.defauts(), api.editions.modeles({ cible: 'DOCUMENT', genre: 'RAPPORT' })]);
    const admin = this.app.estAdmin();
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('edition_btp.parametres.type_document')}</th><th>${texteHtml('edition_btp.parametres.modele_defaut')}</th></tr></thead><tbody></tbody></table>`;
    const corps = zone.querySelector('tbody');
    for (const t of types) {
      const code = t.tyd_code ?? t.code;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${echapper(t.tyd_libelle ?? t.libelle ?? code)} <small>${echapper(code)}</small></td><td></td>`;
      const options = rapports.filter((m) => !m.types.length || m.types.includes(code)).map((m) => ({ valeur: m.code, libelle: m.libelle }));
      const combo = creerCombo({ options, valeur: defauts.find((d) => d.type === code)?.modele ?? '', vide: true });
      combo.disabled = !admin;
      combo.addEventListener('change', async () => {
        if (!combo.valeurCombo) return;
        try { await api.editions.enregistrerDefaut({ cible: 'DOCUMENT', type: code, modele: combo.valeurCombo }); this.app.message(texte('edition_btp.parametres.defaut_enregistre'), 'succes'); } catch (e) { this.app.erreur(e); }
      });
      tr.lastElementChild.append(combo);
      corps.append(tr);
    }
  }

  /** Import d'un paquet de modèles (Q17) : codes existants liés, remplacés ou renommés ; compte rendu. */
  ouvrirImport() {
    const zone = this.conteneur.querySelector('.import');
    if (!this.app.estAdmin()) { zone.replaceChildren(); return; }
    zone.innerHTML = `<p>${texteHtml('edition_btp.parametres.importer_paquet')} <input type="file" accept=".json,application/json" data-fichier>
      ${texteHtml('edition_btp.parametres.codes_presents')} <span data-conflits></span> <button data-importer>${texteHtml('edition_btp.parametres.importer')}</button></p><div data-compte-rendu></div>`;
    const conflits = creerCombo({ options: pairesParCode('edition_btp.parametres.conflits', ['LIER', 'REMPLACER', 'RENOMMER'])
      .map(([valeur, libelle]) => ({ valeur, libelle })), valeur: 'LIER', vide: false });
    zone.querySelector('[data-conflits]').append(conflits);
    zone.querySelector('[data-importer]').addEventListener('click', async () => {
      const f = zone.querySelector('[data-fichier]').files?.[0];
      if (!f) { this.app.message(texte('edition_btp.parametres.choisir_fichier'), 'avertissement'); return; }
      try {
        const r = await api.editions.importer(JSON.parse(await f.text()), conflits.valeurCombo);
        const libelles = textesParCode('edition_btp.parametres.actions', ['CREE', 'REMPLACE', 'LIE', 'RENOMME', 'EXISTANTE', 'CREEE', 'IGNOREE']);
        zone.querySelector('[data-compte-rendu]').innerHTML = `<ul>${[...r.modeles, ...r.ressources].map((x) => `<li><code>${echapper(x.code)}</code> : ${echapper(libelles[x.action] ?? x.action)}${x.nouveau_code ? ` <code>${echapper(x.nouveau_code)}</code>` : ''}</li>`).join('')}</ul>`;
        this.app.message(texte('edition_btp.parametres.import_termine'), 'succes');
        await this.ouvrirModeles();
      } catch (e) { this.app.erreur(e); }
    });
  }

  async ouvrirModeles() {
    const zone = this.conteneur.querySelector('.modeles');
    const modeles = await api.editions.modeles({});
    const admin = this.app.estAdmin();
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('edition_btp.parametres.colonnes.code')}</th><th>${texteHtml('edition_btp.parametres.colonnes.libelle')}</th><th>${texteHtml('edition_btp.parametres.colonnes.genre')}</th><th>${texteHtml('edition_btp.parametres.colonnes.types')}</th><th>${texteHtml('edition_btp.parametres.colonnes.version')}</th><th>${texteHtml('edition_btp.parametres.colonnes.origine')}</th><th></th></tr></thead><tbody>${modeles.map((m) => `<tr data-code="${echapper(m.code)}">
      <td><code>${echapper(m.code)}</code></td><td>${echapper(m.libelle)}</td><td>${m.genre === 'BLOC' ? texteHtml('edition_btp.parametres.bloc') : texteHtml('edition_btp.parametres.rapport', { cible: (m.cible ?? '').toLowerCase() })}</td>
      <td><small>${echapper(m.types.join(', ') || (m.genre === 'BLOC' ? '' : texte('edition_btp.parametres.tous')))}</small></td><td>${m.version}</td>
      <td>${m.fourni ? (m.modifie_local ? texteHtml('edition_btp.parametres.fourni_modifie') : texteHtml('edition_btp.parametres.fourni')) : texteHtml('edition_btp.parametres.societe')}</td>
      <td><button data-action="copier" ${admin ? '' : 'disabled'} title="${texteHtml('edition_btp.parametres.copier_aide')}">${texteHtml('edition_btp.parametres.copier')}</button>
        ${m.genre === 'BLOC' ? `<button data-action="impacts" title="${texteHtml('edition_btp.parametres.impacts_aide')}">${texteHtml('edition_btp.parametres.impacts')}</button>` : ''}
        <button data-action="exporter" title="${texteHtml('edition_btp.parametres.exporter_aide')}">${texteHtml('edition_btp.parametres.exporter')}</button>
        <button data-action="supprimer" ${admin && !m.fourni ? '' : 'disabled'}>${texteHtml('edition_btp.parametres.supprimer')}</button></td></tr>`).join('')}</tbody></table>`;
    zone.onclick = async (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const code = b.closest('tr').dataset.code;
      try {
        if (b.dataset.action === 'impacts') {
          const l = await api.editions.impacts(code);
          this.app.message(l.length ? texte('edition_btp.parametres.utilise_par', { elements: l.map((x) => x.libelle).join(', ') }) : texte('edition_btp.parametres.inutilise'), 'info');
        } else if (b.dataset.action === 'exporter') {
          const paquet = await api.editions.exporter(code);
          telechargerFichier(`${code}.logibtp-edition.json`, JSON.stringify(paquet, null, 2), 'application/json');
        } else if (b.dataset.action === 'copier') {
          const nouveau = await saisir(texte('edition_btp.parametres.nouveau_code'), `${code}_SOCIETE`, { obligatoire: true });
          if (!nouveau?.trim()) return;
          await api.editions.copierModele(code, nouveau.trim().toUpperCase(), null);
          this.app.message(texte('edition_btp.parametres.copie'), 'succes');
          await this.ouvrirModeles();
        } else if (b.dataset.action === 'supprimer') {
          if (!(await confirmer(texte('edition_btp.parametres.confirmer_suppression', { code })))) return;
          await api.editions.supprimerModele(code);
          await this.ouvrirModeles();
        }
      } catch (x) { this.app.erreur(x); }
    };
  }
}
