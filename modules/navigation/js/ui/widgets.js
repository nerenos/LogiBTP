import { echapper } from '@logibtp/socle/ui';
import { texteHtml, langue } from '@logibtp/socle/dictionnaire';

// Widgets de l'accueil (classes mères) : le cœur fournit les données par definition.charger() ; le module les
// affiche. Les éléments portant une URL ouvrent la page correspondante (Ctrl+clic : nouvelle fenêtre).
//   indicateurs : [{ libelle, valeur, unite, niveau ('alerte' | 'erreur' | 'succes'), detail, url }]
//   alertes     : [{ niveau ('erreur' | 'alerte' | 'info'), texte, detail, url }]
//   tableau     : { colonnes: [{ code, libelle, nombre }], lignes: [{ …, _url }] }
//   graphique   : { series: [{ libelle, valeur, couleur, url }], unite }

const nombre = (v, decimales = 0) => (typeof v === 'number' ? v.toLocaleString(langue(), { maximumFractionDigits: decimales }) : echapper(v ?? ''));
const lien = (url) => (url ? ` data-url="${echapper(url)}" tabindex="0"` : '');

export class Widget {
  constructor({ definition, corps, naviguer }) {
    this.definition = definition;
    this.corps = corps;
    this.naviguer = naviguer;
    corps.addEventListener('click', (e) => {
      const el = e.target.closest('[data-url]');
      if (el) this.naviguer(el.dataset.url, { nouvelleFenetre: e.ctrlKey || e.shiftKey || e.metaKey });
    });
    corps.addEventListener('keydown', (e) => {
      const el = e.target.closest('[data-url]');
      if (el && e.key === 'Enter') this.naviguer(el.dataset.url, { nouvelleFenetre: e.ctrlKey || e.shiftKey });
    });
  }

  async actualiser() {
    this.corps.classList.add('widget-chargement');
    try {
      const donnees = await this.definition.charger();
      this.corps.innerHTML = '';
      this.rendre(donnees);
    } catch (e) {
      this.corps.innerHTML = `<p class="widget-erreur">${texteHtml('navigation.widgets.indisponible', { erreur: e.message ?? String(e) })}</p>`;
    } finally {
      this.corps.classList.remove('widget-chargement');
    }
  }

  rendre() {}
}

export class WidgetIndicateurs extends Widget {
  rendre(indicateurs) {
    this.corps.innerHTML = `<div class="widget-indicateurs">${indicateurs.map((i) => `
      <div class="widget-indicateur ${echapper(i.niveau ?? '')}"${lien(i.url)} title="${echapper(i.detail ?? '')}">
        <span class="valeur">${nombre(i.valeur, i.decimales)}${i.unite ? `<small> ${echapper(i.unite)}</small>` : ''}</span>
        <span class="libelle">${echapper(i.libelle)}</span>
      </div>`).join('')}</div>`;
  }
}

export class WidgetAlertes extends Widget {
  rendre(alertes) {
    const icones = { erreur: '⛔', alerte: '⚠️', info: 'ℹ️' };
    this.corps.innerHTML = alertes.length
      ? `<ul class="widget-alertes">${alertes.map((a) => `<li class="${echapper(a.niveau ?? 'info')}"${lien(a.url)}>
          <span>${icones[a.niveau] ?? 'ℹ️'}</span><span><b>${echapper(a.texte)}</b>${a.detail ? `<small>${echapper(a.detail)}</small>` : ''}</span></li>`).join('')}</ul>`
      : `<p class="widget-vide">✓ ${texteHtml('navigation.widgets.aucune_alerte')}</p>`;
  }
}

export class WidgetTableau extends Widget {
  rendre({ colonnes, lignes }) {
    this.corps.innerHTML = lignes.length
      ? `<table class="widget-tableau"><thead><tr>${colonnes.map((c) => `<th class="${c.nombre ? 'nombre' : ''}">${echapper(c.libelle)}</th>`).join('')}</tr></thead>
        <tbody>${lignes.map((l) => `<tr${lien(l._url)}>${colonnes.map((c) => `<td class="${c.nombre ? 'nombre' : ''}">${c.nombre ? nombre(l[c.code], 2) : echapper(l[c.code] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : `<p class="widget-vide">${texteHtml('navigation.widgets.aucune_ligne')}</p>`;
  }
}

export class WidgetGraphique extends Widget {
  rendre({ series, unite = '' }) {
    const max = Math.max(1, ...series.map((s) => Number(s.valeur) || 0));
    const total = series.reduce((t, s) => t + (Number(s.valeur) || 0), 0);
    this.corps.innerHTML = series.length
      ? `<div class="widget-barres">${series.map((s, i) => `<div class="widget-barre"${lien(s.url)} title="${echapper(`${s.libelle} : ${nombre(s.valeur, 2)} ${unite}`)}">
          <span class="libelle">${echapper(s.libelle)}</span>
          <span class="piste"><span class="remplissage" style="width:${((Number(s.valeur) || 0) / max) * 100}%;${s.couleur ? `background:${echapper(s.couleur)}` : `--teinte:${(i * 47) % 360}`}"></span></span>
          <span class="valeur">${nombre(s.valeur, 2)}</span></div>`).join('')}
        <div class="widget-total">${texteHtml('navigation.widgets.total', { total: nombre(total, 2), unite })}</div></div>`
      : `<p class="widget-vide">${texteHtml('navigation.widgets.aucune_donnee')}</p>`;
  }
}

export const TYPES_WIDGET = { indicateurs: WidgetIndicateurs, alertes: WidgetAlertes, tableau: WidgetTableau, graphique: WidgetGraphique };
