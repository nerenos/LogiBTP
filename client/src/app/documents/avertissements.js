import { texteHtml, pluriel } from '@logibtp/socle/dictionnaire';
import { api } from '../api.js';
import { confirmer, echapper } from '@logibtp/socle/ui';

/**
 * Avertissements de gestion avant une action (CONCEPTION-REGLES-DOCUMENTS.md, lot 6) : VALIDER (total nul, référence
 * externe en double, quantité dépassée, remise, marge, encours, prix d'achat) ou TRANSFORMER (validité dépassée,
 * document rejeté). Rien à signaler, ou contrôle indisponible : on poursuit ; sinon l'utilisateur choisit.
 */
export async function confirmerAvertissements(entId, action, verbe) {
  let liste = [];
  try {
    liste = await api.avertissements(entId, action);
  } catch {
    return true;
  }
  if (!liste?.length) return true;
  // Un élément par point (I5), titre « n points à vérifier ».
  return await confirmer('', {
    titre: pluriel('documents_btp.avertissements.points', liste.length, { nombre: liste.length }),
    html: `<ul class="liste-avertissements">${liste.map((m) => `<li>${echapper(m.message)}</li>`).join('')}</ul>
      <p class="dialogue-message">${texteHtml('documents_btp.avertissements.question', { verbe })}</p>`,
    ok: verbe,
  });
}
