// Polices de l'édition dans le navigateur : mêmes fichiers que le serveur (paquet @logibtp/edition), lus une fois par
// fenêtre pour la mesure (fontkit) et déclarés en @font-face pour le dessin de l'aperçu.
import { chargerPolices, FACES_EDITION, policesCss } from '@logibtp/edition';
import interRegular from '@logibtp/edition/polices/inter/Inter-Regular.ttf?url';
import interItalic from '@logibtp/edition/polices/inter/Inter-Italic.ttf?url';
import interMedium from '@logibtp/edition/polices/inter/Inter-Medium.ttf?url';
import interMediumItalic from '@logibtp/edition/polices/inter/Inter-MediumItalic.ttf?url';
import interSemiBold from '@logibtp/edition/polices/inter/Inter-SemiBold.ttf?url';
import interSemiBoldItalic from '@logibtp/edition/polices/inter/Inter-SemiBoldItalic.ttf?url';
import interBold from '@logibtp/edition/polices/inter/Inter-Bold.ttf?url';
import interBoldItalic from '@logibtp/edition/polices/inter/Inter-BoldItalic.ttf?url';
import barcode39 from '@logibtp/edition/polices/libre-barcode-39/LibreBarcode39-Regular.ttf?url';

const URLS = {
  'inter/Inter-Regular.ttf': interRegular, 'inter/Inter-Italic.ttf': interItalic,
  'inter/Inter-Medium.ttf': interMedium, 'inter/Inter-MediumItalic.ttf': interMediumItalic,
  'inter/Inter-SemiBold.ttf': interSemiBold, 'inter/Inter-SemiBoldItalic.ttf': interSemiBoldItalic,
  'inter/Inter-Bold.ttf': interBold, 'inter/Inter-BoldItalic.ttf': interBoldItalic,
  'libre-barcode-39/LibreBarcode39-Regular.ttf': barcode39,
};

let promesse = null;

/** Polices de l'édition (mesure) ; la feuille @font-face de l'aperçu est posée à la première demande. */
export function policesEdition() {
  promesse ??= (async () => {
    const style = document.createElement('style');
    style.dataset.edition = 'polices';
    style.textContent = policesCss(FACES_EDITION.map((f) => ({ ...f, url: URLS[f.fichier] })));
    document.head.append(style);
    const polices = await chargerPolices(async (f) => new Uint8Array(await (await fetch(URLS[f])).arrayBuffer()));
    // Dessin : faces chargées avant d'afficher (sinon une police de remplacement s'affiche un instant).
    await Promise.all(FACES_EDITION.map((f) => document.fonts.load(`${f.italique ? 'italic ' : ''}${f.graisse} 12px "LogiBTP Edition ${f.famille}"`).catch(() => null)));
    return polices;
  })();
  return promesse;
}
