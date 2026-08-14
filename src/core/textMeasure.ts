/**
 * Mesure de texte 2D (canvas) → largeur/hauteur monde.
 * Partagé entre rendu EntityLayer et /textbox (rectangle).
 */

export interface TextMeasureStyle {
  height: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface TextWorldSize {
  /** Largeur totale du bloc (multi-lignes = max des lignes). */
  width: number;
  /** Hauteur totale (nb lignes × height × lineHeight). */
  height: number;
  lines: string[];
  lineHeight: number;
}

const FONT_PX = 128;
const LINE_HEIGHT = 1.25;

function cssFont(style: TextMeasureStyle): string {
  const weight = style.bold ? 'bold' : 'normal';
  const italic = style.italic ? 'italic ' : '';
  const family = style.fontFamily?.trim() || 'Arial, Helvetica, sans-serif';
  return `${italic}${weight} ${FONT_PX}px ${family}`;
}

let measureCanvas: HTMLCanvasElement | null = null;

function getCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

export function splitTextLines(content: string): string[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return lines.length ? lines : [''];
}

/**
 * Taille monde du bloc texte (hauteur caractère = style.height).
 */
export function measureTextWorld(
  content: string,
  style: TextMeasureStyle,
): TextWorldSize {
  const height = Math.max(style.height, 1e-6);
  const lines = splitTextLines(content || ' ');
  const ctx = getCtx();
  const font = cssFont(style);
  let maxWpx = FONT_PX * 0.5;
  if (ctx) {
    ctx.font = font;
    for (const line of lines) {
      const m = ctx.measureText(line || ' ');
      maxWpx = Math.max(maxWpx, m.width);
    }
  } else {
    // Fallback headless
    maxWpx = Math.max(...lines.map((l) => (l.length || 1) * FONT_PX * 0.55));
  }
  const padPx = FONT_PX * 0.15;
  const cw = maxWpx + padPx * 2;
  const ch = FONT_PX * LINE_HEIGHT + padPx * 2;
  // Une ligne : height monde = height ; largeur prop. au canvas d’une ligne
  const worldLineH = height;
  const worldW = worldLineH * (cw / ch);
  const totalH = worldLineH * LINE_HEIGHT * lines.length;
  return {
    width: worldW,
    height: totalH,
    lines,
    lineHeight: LINE_HEIGHT,
  };
}

export function textCssFont(style: TextMeasureStyle, fontPx = FONT_PX): string {
  const weight = style.bold ? 'bold' : 'normal';
  const italic = style.italic ? 'italic ' : '';
  const family = style.fontFamily?.trim() || 'Arial, Helvetica, sans-serif';
  return `${italic}${weight} ${fontPx}px ${family}`;
}

export { FONT_PX, LINE_HEIGHT };
