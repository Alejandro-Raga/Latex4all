import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setEditorFull, useEditorFull } from "@/stores/reader-full-store";

const KEY =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")
    ? "⌘⇧F"
    : "Ctrl+Shift+F";

/** In a project, the PDF pane across the whole window, and back. */
export function FullWindowButton() {
  const on = useEditorFull((s) => s.on);
  const label = on
    ? `Exit full window (Esc or ${KEY})`
    : `Read in full window (${KEY})`;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0"
      onClick={() => setEditorFull(!on)}
      title={label}
      aria-label={on ? "Exit full window" : "Read in full window"}
    >
      {on ? (
        <Minimize2Icon className="size-3.5" />
      ) : (
        <Maximize2Icon className="size-3.5" />
      )}
    </Button>
  );
}
