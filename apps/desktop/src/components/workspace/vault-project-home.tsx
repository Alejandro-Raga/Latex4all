import { useEffect, useMemo, useState } from "react";
import {
  NotebookTextIcon,
  PlusIcon,
  QuoteIcon,
  RefreshCwIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { checkCitations } from "@/lib/citations";
import { projectNoteFor, projectNoteId } from "@/lib/vault/note-changes";
import type { VaultIndex, VaultNote } from "@/lib/vault/vault-index";
import { useDocumentStore } from "@/stores/document-store";
import { useVaultStore } from "@/stores/vault-store";
import { addCitekeysToVault, useCitationCheck } from "./citation-check";
import { useCitedNotes } from "./cited-here";
import { syncProjectNote } from "./project-note-sync";
import { FoldSection, NoteRow } from "./vault-panel";

/** Makes or refreshes the project's note; the panel stays where it is. */
function updateProjectNote() {
  const root = useDocumentStore.getState().projectRoot;
  if (!root) return;
  useVaultStore.getState().linkProject(root, true);
  const id = toast.loading("Updating the project note…");
  syncProjectNote()
    .then((name) => {
      toast.success(name ? `“${name}” is up to date` : "Up to date", {
        id,
        ...(name
          ? {
              action: {
                label: "Open",
                onClick: () => useVaultStore.getState().open(name),
              },
            }
          : {}),
      });
    })
    .catch((err) =>
      toast.error(err instanceof Error ? err.message : String(err), { id }),
    );
}

/** The project's own note in the vault, once it has one. */
function useProjectNote(index: VaultIndex): VaultNote | undefined {
  const root = useDocumentStore((s) => s.projectRoot);
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    if (!root) return;
    let alive = true;
    projectNoteId(root)
      .catch(() => null)
      .then((id) => alive && setPath(projectNoteFor(id, root)));
    return () => {
      alive = false;
    };
  }, [root, index]);
  return path ? index.list.find((n) => n.path === path) : undefined;
}

/**
 * The vault from where the open project stands: its note, the health of its
 * citations, the papers it cites (where, and whether they have notes), and
 * the ideas and topics those papers feed. Every action is a button here;
 * the whole vault is in the "All notes" tab.
 */
export function ProjectHome({
  index,
  onOpen,
}: {
  index: VaultIndex;
  onOpen: (name: string) => void;
}) {
  const root = useDocumentStore((s) => s.projectRoot);
  const files = useDocumentStore((s) => s.files);
  const linked = useVaultStore((s) =>
    root ? Boolean(s.linkedProjects[root]) : false,
  );
  const projectNote = useProjectNote(index);
  const cited = useCitedNotes(true);

  const report = useMemo(
    () =>
      checkCitations(
        files
          .filter((f) => f.type === "tex")
          .map((f) => ({ content: f.content ?? "" })),
        files
          .filter((f) => f.name.toLowerCase().endsWith(".bib"))
          .map((f) => ({ path: f.relativePath, content: f.content ?? "" })),
      ),
    [files],
  );

  const citedNotes = useMemo(
    () =>
      [...cited.byNote.keys()]
        .map((name) => index.notes.get(name.toLowerCase()))
        .filter((n): n is VaultNote => n !== undefined),
    [cited, index],
  );

  // Ideas and topics the cited papers feed, the busiest first.
  const inPlay = useMemo(() => {
    const count = new Map<string, number>();
    for (const paper of citedNotes) {
      for (const name of paper.incoming) {
        const n = index.notes.get(name.toLowerCase());
        if (n && (n.kind === "idea" || n.kind === "topic")) {
          count.set(n.name, (count.get(n.name) ?? 0) + 1);
        }
      }
    }
    return [...count]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, papers]) => ({
        note: index.notes.get(name.toLowerCase()) as VaultNote,
        papers,
      }));
  }, [citedNotes, index]);

  // Papers in the same ideas and topics that this project doesn't cite yet,
  // those sharing the most first.
  const worthCiting = useMemo(() => {
    const cited = new Set(citedNotes.map((n) => n.name));
    const shared = new Map<string, number>();
    for (const { note } of inPlay) {
      for (const name of note.outgoing) {
        const n = index.notes.get(name.toLowerCase());
        if (!n || n.kind !== "paper" || cited.has(n.name)) continue;
        shared.set(n.name, (shared.get(n.name) ?? 0) + 1);
      }
    }
    return [...shared]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 15)
      .map(([name, count]) => ({
        note: index.notes.get(name.toLowerCase()) as VaultNote,
        count,
      }));
  }, [citedNotes, inPlay, index]);

  const issues = [
    report.missing.length > 0 && `${report.missing.length} not in a .bib`,
    report.unused.length > 0 && `${report.unused.length} unused`,
    cited.missing.length > 0 && `${cited.missing.length} not in the vault`,
  ].filter(Boolean);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-2 pb-2">
      <div className="mx-1 mb-2 rounded-md border px-2.5 py-2">
        <div className="flex items-center gap-2">
          <NotebookTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
          {projectNote ? (
            <button
              type="button"
              onClick={() => onOpen(projectNote.name)}
              className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
              title="Open the project's note"
            >
              {projectNote.name}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
              No note for this project yet
            </span>
          )}
          <Button
            variant={projectNote ? "ghost" : "secondary"}
            size="sm"
            className="h-6 shrink-0 gap-1 px-2 text-xs"
            onClick={updateProjectNote}
            title="The papers it cites, its outline and its highlights, in a note in your vault"
          >
            {projectNote ? (
              <RefreshCwIcon className="size-3" />
            ) : (
              <PlusIcon className="size-3" />
            )}
            {projectNote ? "Update" : "Create project note"}
          </Button>
        </div>
        {projectNote && !linked && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Not kept up to date. Update to keep it current as you write.
          </p>
        )}
      </div>

      <div className="mx-1 mb-2 rounded-md border px-2.5 py-2 text-xs">
        <div className="flex items-center gap-2">
          <QuoteIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            {report.cited.length} cited
            {issues.length > 0 ? (
              <span className="text-amber-700 dark:text-amber-400">
                {" · "}
                {issues.join(" · ")}
              </span>
            ) : (
              report.cited.length > 0 && (
                <span className="text-muted-foreground"> · all in order</span>
              )
            )}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {cited.missing.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => void addCitekeysToVault(cited.missing)}
              title={cited.missing.join(", ")}
            >
              <PlusIcon className="size-3" />
              Add {cited.missing.length} to the vault
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => useCitationCheck.getState().show()}
          >
            Check citations
          </Button>
        </div>
      </div>

      <FoldSection
        id="project:cited"
        label="Cited in this project"
        count={citedNotes.length + cited.missing.length}
        defaultOpen
      >
        {citedNotes.length === 0 && cited.missing.length === 0 && (
          <p className="px-3 py-2 text-muted-foreground text-xs">
            Nothing cited yet.
          </p>
        )}
        {citedNotes.map((n) => (
          <NoteRow
            key={n.name}
            note={n}
            index={index}
            places={cited.byNote.get(n.name)}
            onOpen={onOpen}
          />
        ))}
        {cited.missing.map((key) => (
          <div
            key={key}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
          >
            <span className="mt-0.5 size-1.5 shrink-0 rounded-full border border-muted-foreground/60" />
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
              {key}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() => void addCitekeysToVault([key])}
            >
              Add to vault
            </Button>
          </div>
        ))}
      </FoldSection>

      <FoldSection
        id="project:ideas"
        label="Ideas & topics in play"
        count={inPlay.length}
        defaultOpen
      >
        {inPlay.length === 0 ? (
          <p className="px-3 py-2 text-muted-foreground text-xs">
            None of the cited papers is in an idea or topic yet.
          </p>
        ) : (
          inPlay.map(({ note, papers }) => (
            <NoteRow
              key={note.name}
              note={note}
              index={index}
              aside={`${papers} cited`}
              onOpen={onOpen}
            />
          ))
        )}
      </FoldSection>

      <FoldSection
        id="project:worth"
        label="Worth citing?"
        count={worthCiting.length}
        defaultOpen
      >
        {worthCiting.length === 0 ? (
          <p className="px-3 py-2 text-muted-foreground text-xs">
            Papers in the same ideas and topics as the ones you cite show up
            here, once they have notes in your vault.
          </p>
        ) : (
          <>
            <p className="px-3 pb-1 text-[11px] text-muted-foreground">
              In the same ideas and topics as what you cite, not cited yet.
            </p>
            {worthCiting.map(({ note, count }) => (
              <NoteRow
                key={note.name}
                note={note}
                index={index}
                aside={count > 1 ? `${count} shared` : "1 shared"}
                onOpen={onOpen}
              />
            ))}
          </>
        )}
      </FoldSection>
    </div>
  );
}
