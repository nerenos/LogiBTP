// Origine des écritures d'une pièce (module MCP, lot 11 ; ANALYSE-MODULE-MCP.md § 9) : lignes de l'historique écrites par un
// agent IA (`his_origine` AGENT, GET /api/documents/{id}/origines) marquées « 🤖 via <client> » dans l'historique, et
// pastille 🤖 dans l'entête d'une pièce créée par un agent tant qu'aucun humain n'y a écrit depuis.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { ORIGINE_ECRITURE } from '@logibtp/socle';
import { echapper } from '@logibtp/socle/ui';

/** Action de création d'une pièce dans l'historique (module Document). */
export const ACTION_CREATION = 'CREATION';

const parAgent = (l) => l?.his_origine === ORIGINE_ECRITURE.AGENT;

/** Lignes écrites par un agent, par identifiant de l'historique : Map his_id → { client, delegation }. */
export function originesAgent(lignes) {
  return new Map((lignes ?? []).filter(parAgent).map((l) => [Number(l.his_id), { client: l.his_client ?? '', delegation: l.his_delegation ?? '' }]));
}

/**
 * Pièce créée par un agent et pas encore reprise par un humain : la création est d'un agent et toutes les lignes qui
 * suivent aussi (une modification, une validation ou un numéro posé par un humain retire la pastille). Rend le client
 * de la création, ou null.
 */
export function creeeParAgent(lignes) {
  const tri = [...(lignes ?? [])].sort((a, b) => Number(a.his_id) - Number(b.his_id));
  const i = tri.findIndex((l) => l.his_action === ACTION_CREATION);
  if (i < 0 || !tri.slice(i).every(parAgent)) return null;
  return { client: tri[i].his_client ?? '', utilisateur: tri[i].his_utilisateur ?? '' };
}

/** Mention d'une ligne de l'historique écrite par un agent (HTML) : « 🤖 via <client> ». */
export function mentionAgentHtml(origine) {
  if (!origine) return '';
  return ` <span class="agent-pastille" title="${echapper(texte('agents_btp.origine.aide', { client: origine.client || texte('agents_btp.origine.agent') }))}">${iconeHtml('agents_btp_agent')} ${texteHtml('agents_btp.origine.via', { client: origine.client || texte('agents_btp.origine.agent') })}</span>`;
}

/** Pastille de l'entête d'une pièce créée par un agent (HTML), vide sinon. */
export function pastillePieceHtml(creation) {
  if (!creation) return '';
  return `<span class="agent-pastille">${iconeHtml('agents_btp_agent')} ${texteHtml('agents_btp.origine.piece', { client: creation.client || texte('agents_btp.origine.agent'), utilisateur: creation.utilisateur })}</span>
    <span class="aide">${texteHtml('agents_btp.origine.piece_aide')}</span>`;
}
