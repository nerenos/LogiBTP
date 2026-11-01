import { texte, pluriel } from '@logibtp/socle/dictionnaire';
import { api } from '../api.js';
import { confirmer } from '@logibtp/socle/ui';

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
  return await confirmer(texte('documents_btp.avertissements.confirmer', { titre: pluriel('documents_btp.avertissements.points', liste.length), liste: liste.map((m) => `• ${m.message}`).join('\n'), verbe }));
}
