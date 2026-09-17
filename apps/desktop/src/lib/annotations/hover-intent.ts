/**
 * When to show and hide a hover card for highlights.
 *
 * The card opens once the pointer has been over the same highlight for
 * `openDelay`, however much it moves within it — restarting the wait on every
 * mouse move would mean it only ever opened over something tiny the pointer
 * could rest on. It closes `closeDelay` after the pointer has left both the
 * highlight and the card, unless the card is pinned (being typed in).
 */
export class HoverIntent {
  private pending: string | null = null;
  private shown: string | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private overCard = false;

  constructor(
    private readonly options: {
      openDelay: number;
      closeDelay: number;
      onOpen: (id: string) => void;
      onClose: () => void;
      isPinned: () => boolean;
    },
  ) {}

  /** The highlight under the pointer, or null. */
  over(id: string | null) {
    if (id === null) {
      this.cancelOpen();
      if (this.shown !== null) this.scheduleClose();
      return;
    }
    this.cancelClose();
    if (id === this.shown || id === this.pending) return;
    if (this.options.isPinned()) return;
    this.cancelOpen();
    this.pending = id;
    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      this.pending = null;
      this.shown = id;
      this.options.onOpen(id);
    }, this.options.openDelay);
  }

  enterCard() {
    this.overCard = true;
    this.cancelClose();
  }

  leaveCard() {
    this.overCard = false;
    this.scheduleClose();
  }

  /** The pointer left the area the highlights are in. */
  leave() {
    this.over(null);
  }

  /** The card was closed some other way (Escape, a click elsewhere). */
  reset() {
    this.cancelOpen();
    this.cancelClose();
    this.shown = null;
    this.overCard = false;
  }

  scheduleClose() {
    if (this.closeTimer) return;
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      if (this.overCard || this.options.isPinned()) return;
      this.shown = null;
      this.options.onClose();
    }, this.options.closeDelay);
  }

  private cancelOpen() {
    if (this.openTimer) clearTimeout(this.openTimer);
    this.openTimer = null;
    this.pending = null;
  }

  private cancelClose() {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }
}
