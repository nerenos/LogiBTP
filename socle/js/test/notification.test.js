import { describe, it, expect } from 'vitest';
import { titreNotification, corpsNotificationHtml } from '../src/ui/notification.js';
import { bulleHtml, positionBulle } from '../src/ui/infobulle.js';

describe('fenêtre des messages (I4, I5)', () => {
  it('titre : donné, sinon nombre de champs ou de points, sinon le niveau', () => {
    expect(titreNotification({ titre: 'Refus' })).toBe('Refus');
    expect(titreNotification({ details: [{}, {}, {}] })).toBe('3 champs à corriger');
    expect(titreNotification({ details: [{}] })).toBe('1 champ à corriger');
    expect(titreNotification({ details: [{}, {}], niveau: 'avertissement' })).toBe('2 points à vérifier');
    expect(titreNotification({ niveau: 'avertissement' })).toBe('Attention');
    expect(titreNotification({})).toBe('Erreur');
  });

  it('corps : message et détails échappés, lien Aller seulement avec une action', () => {
    const html = corpsNotificationHtml({ message: 'Fiche <incomplète>', details: [{ libelle: 'Nom', message: 'obligatoire', aller: () => {} }, { message: 'autre' }] });
    expect(html).toContain('Fiche &lt;incomplète&gt;');
    expect(html).toContain('<b>Nom</b> : obligatoire');
    expect(html.match(/data-aller/g)).toHaveLength(1);
    expect(corpsNotificationHtml({})).toBe('');
  });
});

describe('infobulles (I8)', () => {
  it('raccourcis en kbd, texte échappé, sauts de ligne', () => {
    expect(bulleHtml('Enregistrer (Ctrl+S)')).toBe('Enregistrer (<kbd>Ctrl+S</kbd>)');
    expect(bulleHtml('Liste : F4 ou Alt+↓')).toBe('Liste : <kbd>F4</kbd> ou <kbd>Alt+↓</kbd>');
    expect(bulleHtml('Notifications (Maj+F8)')).toBe('Notifications (<kbd>Maj+F8</kbd>)');
    expect(bulleHtml('Fermer (Échap)\n<b>')).toBe('Fermer (<kbd>Échap</kbd>)<br>&lt;b&gt;');
    expect(bulleHtml('Format F2023 et AF4')).toBe('Format F2023 et AF4');
  });

  it('placement : au-dessus si la place le permet, sinon au-dessous ; dans la largeur de la fenêtre', () => {
    const vue = { width: 800, height: 600 };
    const bulle = { width: 200, height: 40 };
    expect(positionBulle({ left: 300, top: 200, width: 100, bottom: 220 }, bulle, vue)).toEqual({ left: 250, top: 154, cote: 'dessus' });
    expect(positionBulle({ left: 300, top: 10, width: 100, bottom: 30 }, bulle, vue)).toEqual({ left: 250, top: 36, cote: 'dessous' });
    expect(positionBulle({ left: 760, top: 200, width: 30, bottom: 220 }, bulle, vue).left).toBe(594);
    expect(positionBulle({ left: 0, top: 200, width: 30, bottom: 220 }, bulle, vue).left).toBe(6);
  });
});
