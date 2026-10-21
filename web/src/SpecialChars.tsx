// Special character picker: the characters the font can sew that aren't plain letters or digits.

import type { LetterFont } from '@stitchpro/engine';

export function SpecialChars({ font, onPick }: { font: LetterFont | undefined; onPick: (ch: string) => void }) {
  if (!font) return null;
  const chars = font.chars().filter((c) => !/^[A-Za-z0-9]$/.test(c));
  if (!chars.length) return null;
  return (
    <div className="special-chars" aria-label="Special characters">
      {chars.map((c) => (
        <button key={c} type="button" className="char-button" title={`Insert ${c}`} onClick={() => onPick(c)}>
          {c}
        </button>
      ))}
    </div>
  );
}
