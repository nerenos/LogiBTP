import { it, expect } from 'vitest';
it('les écrans se chargent et déclarent leurs raccourcis', async () => {
  const ui = await import('../ui/index.js');
  expect(Object.keys(ui)).toEqual(expect.arrayContaining(['ListeRelances', 'ParametresRelances', 'PanneauSuspensions']));
  const { actionDe } = await import('@logibtp/socle/ui');
  expect(actionDe({ key: 'Enter', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }, ui.GROUPE_RACCOURCIS)).toBe('valider');
});
