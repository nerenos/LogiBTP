import { describe, it, expect } from 'vitest';
import { segmenterEmojis, emojisEnHtml, emojisDansHtml, contientEmoji } from '../src/dictionnaire/emojis.js';
import { emoji, emojisHtml, avecEmojis, nomsEmojis, initialiserDictionnaire } from '../src/dictionnaire/index.js';

const catalogue = { casque: 'emojis/casque.svg', valide: 'emojis/valide.svg' };
const adresse = (f) => `/personnalisation/images/${f}`;

describe('emojis par shortcode (§ 42)', () => {
  it('découpe le texte : seuls les noms du catalogue deviennent des emojis', () => {
    expect(segmenterEmojis('Port du :casque: obligatoire :inconnu: à 10:30:00', catalogue)).toEqual([
      { texte: 'Port du ' }, { emoji: 'casque', code: ':casque:' }, { texte: ' obligatoire :inconnu: à 10:30:00' },
    ]);
    expect(segmenterEmojis(':valide::casque:', catalogue).map((s) => s.emoji)).toEqual(['valide', 'casque']);
    expect(segmenterEmojis(':constructor: :toString:', catalogue)).toEqual([{ texte: ':constructor: :toString:' }]);
    expect(segmenterEmojis('', catalogue)).toEqual([]);
    expect(contientEmoji('rien ici', catalogue)).toBe(false);
    expect(contientEmoji('ok :valide:', catalogue)).toBe(true);
  });

  it('texte brut → HTML : texte échappé, image avec le shortcode en texte de remplacement', () => {
    const html = emojisEnHtml('<b>:casque:</b>', catalogue, adresse);
    expect(html).toBe('&lt;b&gt;<img class="emoji" src="/personnalisation/images/emojis/casque.svg" alt=":casque:" title=":casque:" draggable="false">&lt;/b&gt;');
  });

  it('HTML → HTML : jamais dans une balise ni un attribut', () => {
    const html = emojisDansHtml('<a title=":casque:">Chantier :casque:</a>', catalogue, adresse);
    expect(html.startsWith('<a title=":casque:">Chantier <img class="emoji"')).toBe(true);
    expect(html.endsWith('</a>')).toBe(true);
    expect(emojisDansHtml('<i>sans</i>', catalogue, adresse)).toBe('<i>sans</i>');
  });

  it('catalogue chargé : emoji(), emojisHtml(), avecEmojis() et adresse versionnée', () => {
    const libelles = { _meta: { langue: 'fr-FR' } };
    initialiserDictionnaire({ libelles, emojis: catalogue, version: 'v1' });
    expect(nomsEmojis()).toEqual(['casque', 'valide']);
    expect(emoji('valide')).toContain('src="/personnalisation/images/emojis/valide.svg?v=v1"');
    expect(emoji('absent', '?')).toBe('?');
    expect(emojisHtml('a & :casque:')).toMatch(/^a &amp; <img class="emoji"/);
    expect(avecEmojis('<p>:valide:</p>')).toMatch(/^<p><img class="emoji"[^>]*><\/p>$/);
  });
});
