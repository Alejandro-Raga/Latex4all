/**
 * Conflicted copies in the open project: those identical to their original,
 * or copies of system clutter, go without asking; the rest show as a notice
 * above the files, to compare with the original and keep one.
 */
import { readFile, stat, writeFile } from "@tauri-apps/plugin-fs";
import { CopyIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type ConflictedCopy,
  differences,
  findCopies,
  isClutterCopy,
} from "@/lib/conflicted-copies";
import { deleteFileFromDisk, join, whileLocked } from "@/lib/tauri/fs";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/stores/document-store";

const TEXT = /\.(tex|ltx|bib|sty|cls|bst|txt|md|csv|tsv|json|ya?ml|r|py|m)$/i;
const isText = (path: string) => TEXT.test(path);

async function bytes(root: string, path: string) {
  return whileLocked(async () =>
    readFile(await join(root, ...path.split("/"))),
  );
}

function same(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function remove(root: string, path: string) {
  await whileLocked(async () =>
    deleteFileFromDisk(await join(root, ...path.split("/"))),
  );
}

/** The copy's content becomes the original's, and the copy goes. */
async function keepCopy(root: string, c: ConflictedCopy) {
  await useDocumentStore.getState().saveAllFiles();
  const data = await bytes(root, c.copy);
  const target = await join(root, ...c.original.split("/"));
  await whileLocked(() => writeFile(target, data));
  await remove(root, c.copy);
}

/** Removes, once per copy, those identical to their original or clutter. */
function useAutoClean(root: string | null, copies: ConflictedCopy[]) {
  const checked = useRef(new Set<string>());
  useEffect(() => {
    if (!root || copies.length === 0) return;
    let stop = false;
    void (async () => {
      let removed = 0;
      for (const c of copies) {
        if (stop || checked.current.has(c.copy)) continue;
        checked.current.add(c.copy);
        try {
          let drop = isClutterCopy(c);
          if (!drop && c.originalExists) {
            drop = same(
              await bytes(root, c.copy),
              await bytes(root, c.original),
            );
          }
          if (drop) {
            await remove(root, c.copy);
            removed++;
          }
        } catch {
          // Left for the person to see.
        }
      }
      if (removed && !stop) {
        await useDocumentStore.getState().refreshFiles();
        toast(
          removed === 1
            ? "Removed a conflicted copy that was the same as its original."
            : `Removed ${removed} conflicted copies that were the same as their originals.`,
        );
      }
    })();
    return () => {
      stop = true;
    };
  }, [root, copies]);
}

function when(ms: number | undefined) {
  return ms
    ? new Date(ms).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}

function Compare({ root, c }: { root: string; c: ConflictedCopy }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "text"; diffs: ReturnType<typeof differences> }
    | { kind: "other" }
  >({ kind: "loading" });
  useEffect(() => {
    let live = true;
    void (async () => {
      if (!c.originalExists || !isText(c.original)) {
        if (live) setState({ kind: "other" });
        return;
      }
      const dec = new TextDecoder();
      const [a, b] = await Promise.all([
        bytes(root, c.original),
        bytes(root, c.copy),
      ]);
      if (live)
        setState({
          kind: "text",
          diffs: differences(dec.decode(a), dec.decode(b)),
        });
    })().catch(() => live && setState({ kind: "other" }));
    return () => {
      live = false;
    };
  }, [root, c]);
  if (state.kind === "loading") {
    return (
      <p className="px-3 py-2 text-muted-foreground text-xs">Comparing…</p>
    );
  }
  if (state.kind === "other") {
    return (
      <p className="px-3 py-2 text-muted-foreground text-xs">
        {c.originalExists
          ? "This kind of file can't be compared here. Open both to look."
          : "The original is gone: this copy is the only one."}
      </p>
    );
  }
  const shown = state.diffs.slice(0, 40);
  return (
    <div className="max-h-72 space-y-2 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
      <p className="font-sans text-muted-foreground text-xs">
        {state.diffs.length === 1
          ? "1 difference. Red is the original, green the copy."
          : `${state.diffs.length} differences. Red is the original, green the copy.`}
      </p>
      {shown.map((d, i) => (
        <div key={i} className="rounded-md bg-muted/60 px-2 py-1.5">
          <span className="mr-2 font-sans text-[10px] text-muted-foreground">
            Line {d.line}
          </span>
          <span className="whitespace-pre-wrap break-words text-muted-foreground">
            {d.before}
          </span>
          {d.original && (
            <span className="whitespace-pre-wrap break-words bg-destructive/15 text-destructive line-through">
              {d.original}
            </span>
          )}
          {d.copy && (
            <span className="whitespace-pre-wrap break-words bg-[color-mix(in_oklch,var(--chart-2)_20%,transparent)] text-foreground">
              {d.copy}
            </span>
          )}
          <span className="whitespace-pre-wrap break-words text-muted-foreground">
            {d.after}
          </span>
        </div>
      ))}
      {state.diffs.length > shown.length && (
        <p className="font-sans text-muted-foreground text-xs">
          And {state.diffs.length - shown.length} more.
        </p>
      )}
    </div>
  );
}

function CopyRow({ root, c }: { root: string; c: ConflictedCopy }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [times, setTimes] = useState<{ copy?: number; original?: number }>({});
  useEffect(() => {
    void (async () => {
      const t = async (p: string) =>
        (
          await stat(await join(root, ...p.split("/"))).catch(() => null)
        )?.mtime?.getTime();
      setTimes({
        copy: await t(c.copy),
        original: c.originalExists ? await t(c.original) : undefined,
      });
    })();
  }, [root, c]);
  const act = async (what: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await what();
      await useDocumentStore.getState().refreshFiles();
      toast(done);
    } catch (err) {
      toast.error(
        `Couldn't do that: ${err instanceof Error ? err.message : String(err)}`,
      );
      setBusy(false);
    }
  };
  const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  return (
    <div className="rounded-lg border">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <CopyIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm" title={c.copy}>
            {name(c.copy)}
          </p>
          <p className="text-muted-foreground text-xs">
            {c.originalExists ? (
              <>
                A copy of {name(c.original)}
                {times.original ? ` (changed ${when(times.original)})` : ""}
              </>
            ) : (
              <>The original, {name(c.original)}, is gone</>
            )}
            {times.copy ? ` · copy from ${when(times.copy)}` : ""}
          </p>
        </div>
      </div>
      {open && (
        <div className="border-t">
          <Compare root={root} c={c} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1.5 border-t px-3 py-2">
        {c.originalExists && (
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide differences" : "Compare"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void act(
              () => keepCopy(root, c),
              c.originalExists
                ? `${name(c.original)} now has the copy's version.`
                : `Restored as ${name(c.original)}.`,
            )
          }
        >
          {c.originalExists ? "Keep the copy" : `Rename to ${name(c.original)}`}
        </Button>
        <Button
          size="sm"
          variant={c.originalExists ? "default" : "outline"}
          disabled={busy}
          onClick={() => void act(() => remove(root, c.copy), "Copy deleted.")}
        >
          {c.originalExists ? "Keep the original" : "Delete"}
        </Button>
      </div>
    </div>
  );
}

/** Above the file tree: how many copies there are, and a way to settle them. */
export function ConflictedCopies() {
  const root = useDocumentStore((s) => s.projectRoot);
  const files = useDocumentStore((s) => s.files);
  const paths = useMemo(
    () => files.map((f) => f.relativePath).join("\n"),
    [files],
  );
  const copies = useMemo(
    () => findCopies(paths ? paths.split("\n") : []),
    [paths],
  );
  const [open, setOpen] = useState(false);
  useAutoClean(root, copies);
  const shown = copies.filter((c) => !isClutterCopy(c));
  useEffect(() => {
    if (shown.length === 0) setOpen(false);
  }, [shown.length]);
  if (!root || shown.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "mx-2 mb-1 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
          "bg-[color-mix(in_oklch,var(--chart-4)_14%,transparent)] hover:bg-[color-mix(in_oklch,var(--chart-4)_22%,transparent)]",
        )}
      >
        <TriangleAlertIcon
          className="size-3.5 shrink-0"
          style={{ color: "var(--chart-4)" }}
        />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap">
          {shown.length === 1
            ? "1 conflicted copy"
            : `${shown.length} conflicted copies`}
        </span>
        <span className="shrink-0 whitespace-nowrap font-medium">Review</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Conflicted copies</DialogTitle>
            <DialogDescription>
              These files changed in two places at once, so both versions were
              kept. Compare each copy with the original and keep one.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {shown.map((c) => (
              <CopyRow key={c.copy} root={root} c={c} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
