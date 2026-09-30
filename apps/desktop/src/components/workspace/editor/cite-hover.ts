import { hoverTooltip } from "@codemirror/view";
import { citeKeyAtCursor } from "@/lib/vault/cite-at-cursor";
import { useDockStore } from "@/stores/dock-store";
import { useVaultStore } from "@/stores/vault-store";
import { addCitekeysToVault } from "../citation-check";
import { citeInfo } from "../cited-here";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function action(label: string, run: () => void) {
  const button = el(
    "button",
    "rounded border border-border px-2 py-0.5 text-xs hover:bg-muted",
    label,
  );
  button.type = "button";
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", run);
  return button;
}

/** Hovering a key in \cite{…} shows the paper, with its note a click away. */
export const citeHover = hoverTooltip(
  (view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const key = citeKeyAtCursor(line.text, pos - line.from);
    if (!key) return null;
    return {
      pos,
      above: true,
      create: () => {
        const info = citeInfo(key);
        const dom = el("div", "max-w-80 space-y-1 px-2.5 py-2");
        dom.append(
          el(
            "div",
            "text-sm leading-snug",
            info.title ?? "Not in the bibliography",
          ),
        );
        if (info.detail) {
          dom.append(el("div", "text-muted-foreground text-xs", info.detail));
        }
        const actions = el("div", "flex gap-1.5 pt-1");
        const { note } = info;
        if (note) {
          actions.append(
            action("Open note", () => {
              useDockStore.getState().setOpen("vault", true);
              useVaultStore.getState().open(note);
            }),
          );
        } else if (useVaultStore.getState().index && info.title) {
          actions.append(
            action("Add to vault", () => void addCitekeysToVault([key])),
          );
        }
        if (actions.childElementCount) dom.append(actions);
        return { dom };
      },
    };
  },
  { hoverTime: 400 },
);
