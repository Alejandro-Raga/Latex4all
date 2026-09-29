import type { ReactNode } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { CopyIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("panel");

function details(name: string, error: unknown): string {
  const e = error instanceof Error ? error : new Error(String(error));
  return [
    `Latex4All — ${name} stopped working`,
    `${e.name}: ${e.message}`,
    e.stack ?? "",
    `(${navigator.userAgent})`,
  ].join("\n");
}

function PanelFallback({
  name,
  error,
  resetErrorBoundary,
}: FallbackProps & { name: string }) {
  return (
    <div
      role="alert"
      className="flex h-full min-h-24 flex-col items-center justify-center gap-2 p-4 text-center"
    >
      <TriangleAlertIcon className="size-5 text-amber-500" />
      <p className="font-medium text-sm">{name} stopped working</p>
      <p className="max-w-64 truncate text-muted-foreground text-xs">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" onClick={resetErrorBoundary}>
          <RotateCcwIcon className="size-3.5" />
          Reload panel
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            navigator.clipboard
              .writeText(details(name, error))
              .then(() => toast.success("Copied"))
              .catch(() => toast.error("Couldn't copy"))
          }
        >
          <CopyIcon className="size-3.5" />
          Copy details
        </Button>
      </div>
    </div>
  );
}

/**
 * Keeps a failure inside one panel: the rest of the window carries on, and
 * the panel offers to reload itself or copy what went wrong.
 */
export function PanelBoundary({
  name,
  children,
  resetKeys,
}: {
  /** What the user calls this part, e.g. "Vault". */
  name: string;
  children: ReactNode;
  /** Values that, when changed, clear the error and try again. */
  resetKeys?: unknown[];
}) {
  return (
    <ErrorBoundary
      resetKeys={resetKeys}
      onError={(error) => {
        // Logging is best effort: the fallback must show even if it fails.
        try {
          log.error(`${name} crashed`, { error: String(error) });
        } catch {}
      }}
      fallbackRender={(props) => <PanelFallback name={name} {...props} />}
    >
      {children}
    </ErrorBoundary>
  );
}
