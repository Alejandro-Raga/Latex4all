/** Landscape pages: slides, and the odd landscape document. */
export function isWide(aspectRatio: number) {
  return aspectRatio > 1.05;
}

/**
 * A wide document in the portrait card: its first two pages one above the
 * other, and how many there are. Fitted to the 3:4 card by width alone
 * (WebKit won't shrink an aspect-ratio box to a max-height; see pageFit), so
 * two pages, the gap and the count fit from 16:9 down to 4:3.
 */
export function DeckSurface({
  deck,
  slides,
  projectName,
}: {
  deck: { url: string; nextUrl?: string; aspectRatio: number; pages: number };
  slides: boolean;
  projectName: string;
}) {
  // In card widths (180–250px): the card is 4/3 tall; a margin above and
  // below, the count, and an 8px gap (about 0.045) after each page take the
  // rest of what the pages may use.
  const shown = deck.nextUrl ? 2 : 1;
  const room = 4 / 3 - 2 * 0.07 - 0.08 - shown * 0.045;
  const width = Math.min(0.86, (room * deck.aspectRatio) / shown);
  const noun = slides ? "slide" : "page";
  const page = (url: string, alt: string) => (
    <img
      src={url}
      alt={alt}
      className="block rounded-[3px] bg-white object-cover shadow-sm ring-1 ring-border/60"
      style={{ width: `${width * 100}%`, aspectRatio: deck.aspectRatio }}
    />
  );
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/30">
      {page(deck.url, `${projectName} preview`)}
      {deck.nextUrl && page(deck.nextUrl, `${projectName}, ${noun} 2`)}
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {deck.pages} {deck.pages === 1 ? noun : `${noun}s`}
      </span>
    </div>
  );
}
