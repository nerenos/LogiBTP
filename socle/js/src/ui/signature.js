// Signature tracée sur l'écran (doigt, stylet ou souris) : cadre de dessin, effacement, image PNG. Sans métier :
// l'application range l'image avec le nom et la qualité du signataire, l'horodatage et l'empreinte du document signé.

/** Épaisseur du trait selon la pression (stylet), sinon une valeur fixe ; bornée. */
export const epaisseurTrait = (pression) => (pression > 0 && pression < 1 ? 1.2 + pression * 2.6 : 2.4);

export class PadSignature {
  #canvas;
  #ctx;
  #traits = 0;
  #precedent = null;
  #changer;

  /** conteneur : élément qui reçoit le cadre ; options : hauteur (px), changer(vide) appelé après chaque trait ou effacement. */
  constructor(conteneur, { hauteur = 180, changer = () => {} } = {}) {
    this.#changer = changer;
    conteneur.innerHTML = `<div class="pad-signature"><canvas aria-label="Zone de signature : signer avec le doigt ou le stylet"></canvas>
      <span class="pad-signature-ligne" aria-hidden="true"></span>
      <button type="button" class="pad-signature-effacer" title="Effacer la signature">✕ Effacer</button></div>`;
    this.#canvas = conteneur.querySelector('canvas');
    this.#canvas.style.height = `${hauteur}px`;
    this.#ctx = this.#canvas.getContext('2d');
    this.#dimensionner();
    conteneur.querySelector('.pad-signature-effacer').addEventListener('click', () => this.effacer());
    const point = (e) => { const r = this.#canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure }; };
    this.#canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.#canvas.setPointerCapture(e.pointerId);
      this.#precedent = point(e);
      this.#trait(this.#precedent, { ...this.#precedent, x: this.#precedent.x + 0.1 });
    });
    this.#canvas.addEventListener('pointermove', (e) => {
      if (!this.#precedent) return;
      e.preventDefault();
      const p = point(e);
      this.#trait(this.#precedent, p);
      this.#precedent = p;
    });
    const fin = () => {
      if (!this.#precedent) return;
      this.#precedent = null;
      this.#traits++;
      this.#changer(this.vide);
    };
    this.#canvas.addEventListener('pointerup', fin);
    this.#canvas.addEventListener('pointercancel', fin);
  }

  /** Cadre à la résolution de l'écran (trait net sur les écrans denses). */
  #dimensionner() {
    const r = this.#canvas.getBoundingClientRect();
    const d = globalThis.devicePixelRatio || 1;
    this.#canvas.width = Math.max(1, Math.round((r.width || 600) * d));
    this.#canvas.height = Math.max(1, Math.round((r.height || 180) * d));
    this.#ctx.setTransform(d, 0, 0, d, 0, 0);
    this.#ctx.lineCap = 'round';
    this.#ctx.lineJoin = 'round';
    this.#ctx.strokeStyle = '#111827';
  }

  #trait(a, b) {
    this.#ctx.lineWidth = epaisseurTrait(b.p);
    this.#ctx.beginPath();
    this.#ctx.moveTo(a.x, a.y);
    this.#ctx.lineTo(b.x, b.y);
    this.#ctx.stroke();
  }

  /** Aucun trait tracé. */
  get vide() { return this.#traits === 0; }

  effacer() {
    this.#ctx.save();
    this.#ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#ctx.restore();
    this.#traits = 0;
    this.#changer(true);
  }

  /** Image de la signature en PNG (data URL, fond transparent), null si rien n'est tracé. */
  enPng() { return this.vide ? null : this.#canvas.toDataURL('image/png'); }
}
