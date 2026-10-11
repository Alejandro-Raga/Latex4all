import { useMemo, useState } from "react";
import { CheckIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  applyCleanup,
  type BibProblems,
  type CleanupChoice,
} from "@/lib/bib-cleanup";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/stores/document-store";

type Files = { path: string; content: string }[];

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The bibliography's tidying, one choice per problem: which key a paper keeps,
 * which copy of a twice-written key stays, and citations to point at the
 * entry they mean. Nothing changes until "Clean up"; Undo puts it all back.
 */
export function BibCleanupPanel({
  problems,
  tex,
  bib,
  onDone,
}: {
  problems: BibProblems;
  tex: Files;
  bib: Files;
  onDone: () => void;
}) {
  // Every change starts chosen; each can be left out.
  const [keep, setKeep] = useState<Record<number, string>>(() =>
    Object.fromEntries(problems.duplicates.map((d, i) => [i, d.keep])),
  );
  const [skipDup, setSkipDup] = useState<Set<number>>(new Set());
  const [copy, setCopy] = useState<Record<string, number>>(() =>
    Object.fromEntries(problems.sameKey.map((k) => [k.key, 0])),
  );
  const [skipStray, setSkipStray] = useState<Set<string>>(new Set());

  const choice: CleanupChoice = useMemo(
    () => ({
      merges: problems.duplicates
        .map((d, i) => ({ d, i }))
        .filter(({ i }) => !skipDup.has(i))
        .map(({ d, i }) => ({
          from: d.keys.filter((k) => k !== keep[i]),
          to: keep[i],
        })),
      keepCopy: problems.sameKey.map((k) => ({
        key: k.key,
        index: copy[k.key] ?? 0,
      })),
      strays: problems.strays.filter((s) => !skipStray.has(s.key)),
    }),
    [problems, keep, skipDup, copy, skipStray],
  );
  const result = useMemo(
    () => applyCleanup(tex, bib, choice),
    [tex, bib, choice],
  );
  const changes = result.tex.size + result.bib.size;

  const run = () => {
    const docs = useDocumentStore.getState();
    const byPath = new Map(docs.files.map((f) => [f.relativePath, f]));
    const before: { id: string; content: string }[] = [];
    for (const [path, next] of [...result.tex, ...result.bib]) {
      const file = byPath.get(path);
      if (!file) continue;
      before.push({ id: file.id, content: file.content ?? "" });
      docs.updateFileContent(file.id, next);
    }
    onDone();
    toast.success(
      `Cleaned up: ${plural(result.removed, "entry", "entries")} removed${
        result.renamed
          ? `, citations rewritten in ${plural(result.renamed, "file", "files")}`
          : ""
      }`,
      {
        action: {
          label: "Undo",
          onClick: () => {
            const store = useDocumentStore.getState();
            for (const b of before) store.updateFileContent(b.id, b.content);
            onDone();
          },
        },
      },
    );
  };

  const nothing =
    problems.duplicates.length +
      problems.sameKey.length +
      problems.strays.length ===
    0;
  if (nothing) {
    return (
      <p className="flex items-center justify-center gap-1.5 py-8 text-muted-foreground text-sm">
        <CheckIcon className="size-4 text-emerald-500" />
        No duplicates in the bibliography.
      </p>
    );
  }

  const Check = ({
    on,
    toggle,
    label,
  }: {
    on: boolean;
    toggle: () => void;
    label: string;
  }) => (
    <input
      type="checkbox"
      className="mt-0.5 size-3.5 shrink-0 accent-primary"
      checked={on}
      onChange={toggle}
      aria-label={label}
    />
  );

  return (
    <>
      <div className="flex shrink-0 items-center gap-3">
        <span className="flex-1 text-muted-foreground text-xs">
          {changes === 0
            ? "Nothing chosen"
            : `Removes ${plural(result.removed, "entry", "entries")}${
                result.renamed
                  ? `, rewrites citations in ${plural(result.renamed, "file", "files")}`
                  : ""
              }`}
        </span>
        <Button
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs"
          disabled={changes === 0}
          onClick={run}
        >
          <SparklesIcon className="size-3.5" />
          Clean up
        </Button>
      </div>
      <ul className="-mx-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {problems.duplicates.map((d, i) => (
          <li
            key={d.keys.join()}
            className="rounded-md px-2 py-1.5 hover:bg-muted/60"
          >
            <div className="flex items-start gap-2">
              <Check
                on={!skipDup.has(i)}
                label="Merge these"
                toggle={() =>
                  setSkipDup((s) => {
                    const n = new Set(s);
                    n.has(i) ? n.delete(i) : n.add(i);
                    return n;
                  })
                }
              />
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-xs"
                  title={d.entries[0]?.title ?? ""}
                >
                  One paper, {d.keys.length} keys:{" "}
                  <span className="text-muted-foreground">
                    {d.entries[0]?.title}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {d.keys.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKeep((s) => ({ ...s, [i]: k }))}
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[11px]",
                        keep[i] === k
                          ? "border-primary bg-primary/10"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      title={keep[i] === k ? "Kept" : "Keep this key instead"}
                    >
                      {k}
                      <span className="ml-1 font-sans text-muted-foreground">
                        {d.uses[k] ? `cited ${d.uses[k]}×` : "not cited"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </li>
        ))}
        {problems.sameKey.map((k) => (
          <li key={k.key} className="rounded-md px-2 py-1.5 hover:bg-muted/60">
            <div className="text-xs">
              <span className="font-mono">{k.key}</span> is written{" "}
              {k.entries.length} times
              {k.identical ? (
                <span className="text-muted-foreground">
                  {" "}
                  — the same each time; one copy stays.
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">
                  {" "}
                  — the copies differ; pick the one to keep:
                </span>
              )}
            </div>
            {!k.identical && (
              <div className="mt-1 space-y-0.5">
                {k.entries.map((e, n) => (
                  <label
                    key={`${e.file}:${e.start}`}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <input
                      type="radio"
                      name={`copy-${k.key}`}
                      className="size-3 accent-primary"
                      checked={(copy[k.key] ?? 0) === n}
                      onChange={() => setCopy((s) => ({ ...s, [k.key]: n }))}
                    />
                    <span className="truncate text-muted-foreground">
                      {e.file}: {e.title ?? "no title"}
                      {e.year ? ` (${e.year})` : ""}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </li>
        ))}
        {problems.strays.map((s) => (
          <li
            key={s.key}
            className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
          >
            <Check
              on={!skipStray.has(s.key)}
              label="Cite the existing entry"
              toggle={() =>
                setSkipStray((set) => {
                  const n = new Set(set);
                  n.has(s.key) ? n.delete(s.key) : n.add(s.key);
                  return n;
                })
              }
            />
            <div className="min-w-0 flex-1 text-xs">
              <span className="font-mono">{s.key}</span> is in no .bib; cite it
              as <span className="font-mono">{s.to}</span>, which is.
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
