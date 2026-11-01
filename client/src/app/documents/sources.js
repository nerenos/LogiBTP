import { texteHtml, pluriel } from '@logibtp/socle/dictionnaire';
import { echapper, formatNombre, ouvrirModale } from '@logibtp/socle/ui';

// Choix de documents sources (CONCEPTION-ACHATS-MARCHES.md Q10, 13.4 bis) : documents validés encore ouverts (BL et
// commandes en attente de facturation…), cochés puis repris dans le document, une section par document.

/** Fenêtre de choix ; résout la liste des identifiants cochés, ou null (abandon). documents : GET /documents/en-attente. */
export function choisirSources({ documents, titre }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure dialogue-options';
  dlg.innerHTML = `<form method="dialog">
    <h3>${echapper(titre)}</h3>
    ${documents.length ? `<p class="aide">${texteHtml('documents_btp.sources.aide')}</p>
    <div class="options-choix"><table><tbody>${documents.map((d) => `<tr>
      <td><input type="checkbox" value="${d.ent_id}"></td><td><span class="pastille">${echapper(d.type_libelle)}</span></td>
      <td>${echapper(d.numero ?? '')}</td><td>${echapper(d.date ?? '')}</td><td class="libelle">${echapper(d.objet ?? '')}</td>
      <td class="nombre">${formatNombre(d.total_ht ?? 0, 2)}</td><td><small>${pluriel('documents_btp.sources.lignes_ouvertes', d.lignes_ouvertes)}</small></td></tr>`).join('')}
    </tbody></table></div>` : `<p class="aide">${texteHtml('documents_btp.sources.aucun')}</p>`}
    <div class="boutons"><button value="annuler">${texteHtml('commun.annuler')}</button>${documents.length ? `<button type="button" class="principal" data-valider>${texteHtml('documents_btp.sources.reprendre')}</button>` : ''}</div></form>`;
  document.body.append(dlg);
  return new Promise((resoudre) => {
    let fini = false;
    const finir = (r) => {
      if (fini) return;
      fini = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resoudre(r);
    };
    dlg.addEventListener('close', () => finir(null));
    dlg.querySelector('[data-valider]')?.addEventListener('click', () => {
      finir([...dlg.querySelectorAll('input[type="checkbox"]:checked')].map((c) => Number(c.value)));
    });
    ouvrirModale(dlg, () => dlg.close());
  });
}
