import { describe, it, expect, vi } from 'vitest';
import { commandeRattachee, propositionArc, appliquerArc } from '../src/app/pages/mail.js';

// Proposition de l'accusé de réception dans la boîte de réception (plan ar-courriel, lot 4).
describe('accusé de réception reconnu dans un courriel', () => {
  const accuse = { numero: 'CF-2026-0042', numeros: ['CF-2026-0042'], date: '2026-11-20', semaine: null, precision: 'JOUR' };
  it('propose numéro, date de réception du courriel et livraison annoncée', () => {
    expect(propositionArc(accuse, '2026-11-08T09:30:00+01:00')).toEqual({ ent_arc_numero: 'CF-2026-0042', ent_arc_date: '2026-11-08', ent_arc_livraison: '2026-11-20' });
  });
  it('la commande est le premier lien de type document', () => {
    expect(commandeRattachee([{ type: 'chantier', id: '3' }, { type: 'document', id: '57' }])).toBe(57);
    expect(commandeRattachee([])).toBeNull();
  });
  it('appliquer pose les trois valeurs sur la commande par la route de l’ARC', async () => {
    const appel = vi.fn().mockResolvedValue({});
    await appliquerArc(57, propositionArc(accuse, '2026-11-08T09:30:00Z'), appel);
    expect(appel).toHaveBeenCalledWith(57, { ent_arc_numero: 'CF-2026-0042', ent_arc_date: '2026-11-08', ent_arc_livraison: '2026-11-20' });
  });
  it('champs vides envoyés à null ; ignorer n’appelle rien', async () => {
    const appel = vi.fn().mockResolvedValue({});
    await appliquerArc(57, { ent_arc_numero: '', ent_arc_date: '', ent_arc_livraison: '2026-11-20' }, appel);
    expect(appel).toHaveBeenCalledWith(57, { ent_arc_numero: null, ent_arc_date: null, ent_arc_livraison: '2026-11-20' });
    const aucun = vi.fn();
    propositionArc(accuse, null);
    expect(aucun).not.toHaveBeenCalled();
  });
});
