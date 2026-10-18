import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { api } from '../api.js';

const CHAMPS_MENTIONS = [
  ['decennale.assureur', 'Assurance décennale : assureur'], ['decennale.adresse', 'Adresse de l’assureur'],
  ['decennale.police', 'Numéro de police'], ['decennale.couverture', 'Couverture géographique'],
  ['penalites', 'Pénalités de retard', 'zone'], ['indemnite', 'Indemnité forfaitaire de recouvrement', 'zone'],
  ['escompte', 'Escompte', 'zone'], ['mediateur.nom', 'Médiateur de la consommation'], ['mediateur.site', 'Site du médiateur'],
  ['retractation', 'Droit de rétractation (particuliers)', 'zone'], ['accord', 'Mention du bon pour accord', 'zone'],
  ['tva_debits', 'Option pour la TVA d’après les débits', 'case'], ['libre', 'Mention libre', 'zone'],
];

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
  icone = '🖨';

  async ouvrir() {
    this.titre = 'Paramétrage des éditions';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">🖨 Éditions</h1>
      <h2>Mentions de la société</h2><div class="mentions"></div>
      <h2>Modèle par défaut des documents</h2><div class="defauts"></div>
      <h2>Modèles et blocs</h2><div class="modeles"></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('.mentions').innerHTML = '<p class="aide">Disponible avec le serveur.</p>'; return; }
    await Promise.all([this.ouvrirMentions(), this.ouvrirDefauts(), this.ouvrirModeles()]);
  }

  async ouvrirMentions() {
    const zone = this.conteneur.querySelector('.mentions');
    const mentions = await api.editions.mentions();
    const admin = this.app.estAdmin();
    zone.innerHTML = `<table><tbody>${CHAMPS_MENTIONS.map(([c, l, t]) => `<tr><th>${echapper(l)}</th><td>${
      t === 'case' ? `<input type="checkbox" data-mention="${c}">`
        : t === 'zone' ? `<textarea rows="2" cols="70" data-mention="${c}"></textarea>` : `<input type="text" size="50" data-mention="${c}">`}</td></tr>`).join('')}</tbody></table>
      <p><button class="principal" data-enregistrer ${admin ? '' : 'disabled'}>Enregistrer les mentions</button></p>`;
    for (const el of zone.querySelectorAll('[data-mention]')) {
      const v = lire(mentions, el.dataset.mention);
      if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = v ?? '';
      el.disabled = !admin;
    }
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      const m = structuredClone(mentions);
      for (const el of zone.querySelectorAll('[data-mention]')) ecrire(m, el.dataset.mention, el.type === 'checkbox' ? el.checked : el.value.trim());
      try { await api.editions.enregistrerMentions(m); this.app.message('Mentions enregistrées', 'succes'); } catch (e) { this.app.erreur(e); }
    });
  }

  async ouvrirDefauts() {
    const zone = this.conteneur.querySelector('.defauts');
    const [types, defauts, rapports] = await Promise.all([api.typesDocument(), api.editions.defauts(), api.editions.modeles({ cible: 'DOCUMENT', genre: 'RAPPORT' })]);
    const admin = this.app.estAdmin();
    zone.innerHTML = `<table><thead><tr><th>Type de document</th><th>Modèle par défaut</th></tr></thead><tbody></tbody></table>`;
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
        try { await api.editions.enregistrerDefaut({ cible: 'DOCUMENT', type: code, modele: combo.valeurCombo }); this.app.message('Modèle par défaut enregistré', 'succes'); } catch (e) { this.app.erreur(e); }
      });
      tr.lastElementChild.append(combo);
      corps.append(tr);
    }
  }

  async ouvrirModeles() {
    const zone = this.conteneur.querySelector('.modeles');
    const modeles = await api.editions.modeles({});
    const admin = this.app.estAdmin();
    zone.innerHTML = `<table><thead><tr><th>Code</th><th>Libellé</th><th>Genre</th><th>Types</th><th>Version</th><th>Origine</th><th></th></tr></thead><tbody>${modeles.map((m) => `<tr data-code="${echapper(m.code)}">
      <td><code>${echapper(m.code)}</code></td><td>${echapper(m.libelle)}</td><td>${m.genre === 'BLOC' ? 'Bloc' : `Rapport ${echapper((m.cible ?? '').toLowerCase())}`}</td>
      <td><small>${echapper(m.types.join(', ') || (m.genre === 'BLOC' ? '' : 'tous'))}</small></td><td>${m.version}</td>
      <td>${m.fourni ? (m.modifie_local ? 'fourni, modifié' : 'fourni') : 'société'}</td>
      <td><button data-action="copier" ${admin ? '' : 'disabled'} title="Copie indépendante (un bloc copié est détaché des rapports qui le lient)">Copier…</button>
        ${m.genre === 'BLOC' ? '<button data-action="impacts" title="Rapports et blocs qui lient ce bloc">Utilisé par…</button>' : ''}
        <button data-action="supprimer" ${admin && !m.fourni ? '' : 'disabled'}>Supprimer</button></td></tr>`).join('')}</tbody></table>`;
    zone.onclick = async (e) => {
      const b = e.target.closest('button[data-action]');
      if (!b) return;
      const code = b.closest('tr').dataset.code;
      try {
        if (b.dataset.action === 'impacts') {
          const l = await api.editions.impacts(code);
          this.app.message(l.length ? `Utilisé par : ${l.map((x) => x.libelle).join(', ')}` : 'Bloc utilisé par aucun modèle', 'info');
        } else if (b.dataset.action === 'copier') {
          const nouveau = globalThis.prompt?.('Code du nouveau modèle (lettres, chiffres, _) :', `${code}_SOCIETE`);
          if (!nouveau?.trim()) return;
          await api.editions.copierModele(code, nouveau.trim().toUpperCase(), null);
          this.app.message('Modèle copié', 'succes');
          await this.ouvrirModeles();
        } else if (b.dataset.action === 'supprimer') {
          if (!globalThis.confirm?.(`Supprimer le modèle ${code} ?`)) return;
          await api.editions.supprimerModele(code);
          await this.ouvrirModeles();
        }
      } catch (x) { this.app.erreur(x); }
    };
  }
}
