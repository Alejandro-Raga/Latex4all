import type { RefObject } from "react";
import { startCompletion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import {
  BoldIcon,
  BookMarkedIcon,
  ChevronDownIcon,
  CodeIcon,
  FileDownIcon,
  FunctionSquareIcon,
  HashIcon,
  HeadingIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  SuperscriptIcon,
  TableIcon,
  UnderlineIcon,
} from "lucide-react";
import { toast } from "sonner";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  citeCommand,
  citeStyle,
  listFrom,
  packageInsertion,
  tableSnippet,
} from "@/lib/latex-snippets";
import { resolveTexRoot, useDocumentStore } from "@/stores/document-store";

const HEADINGS = [
  { command: "chapter", label: "Chapter" },
  { command: "section", label: "Section" },
  { command: "subsection", label: "Subsection" },
  { command: "subsubsection", label: "Subsubsection" },
  { command: "paragraph", label: "Paragraph heading" },
];

const Divider = () => <div className="mx-1.5 h-4 w-px bg-border" />;

/** The project's main file: the one that has the preamble. */
function rootFile() {
  const { files, activeFileId } = useDocumentStore.getState();
  const id = resolveTexRoot(activeFileId, files);
  return files.find((f) => f.id === id);
}

/**
 * Formatting, structure, math, citations and inserts, as buttons: what
 * each one types is LaTeX the reader never has to remember, and a package
 * it needs is added to the preamble on the way.
 */
export function LatexRibbon({
  editorView,
}: {
  editorView: RefObject<EditorView | null>;
}) {
  const images = useDocumentStore((s) => s.files)
    .filter((f) => f.type === "image" || f.type === "pdf")
    .map((f) => f.relativePath);

  /** Adds `\usepackage{name}` to the main file if it isn't loaded yet. */
  const ensurePackage = (view: EditorView, name: string) => {
    const { activeFileId, updateFileContent } = useDocumentStore.getState();
    const root = rootFile();
    if (!root) return;
    if (root.id === activeFileId) {
      const add = packageInsertion(view.state.doc.toString(), name);
      if (!add) return;
      view.dispatch({ changes: { from: add.at, insert: add.text } });
    } else {
      const content = root.content ?? "";
      const add = packageInsertion(content, name);
      if (!add) return;
      updateFileContent(
        root.id,
        content.slice(0, add.at) + add.text + content.slice(add.at),
      );
    }
    toast.success(`Added \\usepackage{${name}} to ${root.name}`);
  };

  /** The preamble, wherever it is: for which citation commands to use. */
  const preamble = (view: EditorView) => {
    const root = rootFile();
    return root?.id === useDocumentStore.getState().activeFileId
      ? view.state.doc.toString()
      : (root?.content ?? "");
  };

  /**
   * Puts `before` + the selection (or `fill`) + `after` in place of the
   * selection, with the cursor at `cursor` chars into what's inserted (by
   * default, around the selection).
   */
  const insert = (
    before: string,
    after = "",
    opts: {
      needs?: string;
      complete?: boolean;
      fill?: (selected: string) => string;
      /** Where the cursor goes, in what's inserted; a function gets that text. */
      cursor?: number | ((text: string) => number);
      block?: boolean;
    } = {},
  ) => {
    const view = editorView.current;
    if (!view) return;
    if (opts.needs) ensurePackage(view, opts.needs);
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    const body = opts.fill ? opts.fill(selected) : selected;
    // A block starts on a line of its own.
    const line = view.state.doc.lineAt(from);
    const lead =
      opts.block && view.state.sliceDoc(line.from, from).trim() ? "\n" : "";
    const inserted = before + body + after;
    const text = lead + inserted;
    const start = from + lead.length + before.length;
    const cursor =
      typeof opts.cursor === "function" ? opts.cursor(inserted) : opts.cursor;
    view.dispatch({
      changes: { from, to, insert: text },
      selection:
        cursor !== undefined
          ? { anchor: from + lead.length + cursor }
          : { anchor: start, head: start + body.length },
      scrollIntoView: true,
    });
    view.focus();
    if (opts.complete) startCompletion(view);
  };

  const cite = (kind: "text" | "paren") => {
    const view = editorView.current;
    if (!view) return;
    const { command, needs } = citeCommand(kind, citeStyle(preamble(view)));
    insert(`${command}{`, "}", { needs, complete: true });
  };

  const list = (env: "itemize" | "enumerate") =>
    insert("", "", {
      block: true,
      fill: (selected) => {
        const l = listFrom(selected, env);
        return l.before + l.body + l.after;
      },
      // At the end of the last item.
      cursor: (text) => text.lastIndexOf("\n\\end{"),
    });

  const figure = (file: string) => {
    // Paths are read from the main file's folder.
    const dir = rootFile()?.relativePath.split("/").slice(0, -1).join("/");
    const path =
      dir && file.startsWith(`${dir}/`) ? file.slice(dir.length + 1) : file;
    const head = [
      "\\begin{figure}[htbp]",
      "  \\centering",
      `  \\includegraphics[width=0.8\\linewidth]{${path}}`,
      "  \\caption{",
    ].join("\n");
    const tail = [
      "}",
      `  \\label{fig:${figureLabel(path)}}`,
      "\\end{figure}",
    ].join("\n");
    insert(head, tail, { needs: "graphicx", block: true });
  };

  const table = () => {
    const text = tableSnippet(3, 3);
    insert(text, "", {
      block: true,
      fill: () => "",
      cursor: text.indexOf("\\caption{") + "\\caption{".length,
    });
  };

  return (
    <>
      <TooltipIconButton
        tooltip="Bold"
        onClick={() => insert("\\textbf{", "}")}
      >
        <BoldIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Italic"
        onClick={() => insert("\\textit{", "}")}
      >
        <ItalicIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Underline"
        onClick={() => insert("\\underline{", "}")}
      >
        <UnderlineIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Monospace"
        onClick={() => insert("\\texttt{", "}")}
      >
        <CodeIcon className="size-4" />
      </TooltipIconButton>
      <Divider />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TooltipIconButton tooltip="Heading" className="w-auto gap-0.5 px-1">
            <HeadingIcon className="size-4" />
            <ChevronDownIcon className="size-3 opacity-60" />
          </TooltipIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {HEADINGS.map((h) => (
            <DropdownMenuItem
              key={h.command}
              onSelect={() => insert(`\\${h.command}{`, "}", { block: true })}
            >
              {h.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipIconButton
        tooltip="Bulleted list (from the selected lines)"
        onClick={() => list("itemize")}
      >
        <ListIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Numbered list (from the selected lines)"
        onClick={() => list("enumerate")}
      >
        <ListOrderedIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Quotation"
        onClick={() =>
          insert("\\begin{quote}\n  ", "\n\\end{quote}", { block: true })
        }
      >
        <QuoteIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Footnote"
        onClick={() => insert("\\footnote{", "}")}
      >
        <SuperscriptIcon className="size-4" />
      </TooltipIconButton>
      <Divider />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TooltipIconButton tooltip="Cite" className="w-auto gap-0.5 px-1">
            <BookMarkedIcon className="size-4" />
            <ChevronDownIcon className="size-3 opacity-60" />
          </TooltipIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onSelect={() => cite("text")}>
            <span className="flex flex-col">
              <span>In the sentence</span>
              <span className="text-muted-foreground text-xs">
                Nelson (1959) argues…
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => cite("paren")}>
            <span className="flex flex-col">
              <span>In parentheses</span>
              <span className="text-muted-foreground text-xs">
                … as argued (Nelson, 1959)
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => insert("\\ref{", "}", { complete: true })}
          >
            <span className="flex flex-col">
              <span>Refer to a figure, table or section</span>
              <span className="text-muted-foreground text-xs">
                see Figure 2
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Divider />

      <TooltipIconButton
        tooltip="Math in the line"
        onClick={() => insert("$", "$")}
      >
        <FunctionSquareIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Numbered equation"
        onClick={() =>
          insert("\\begin{equation}\n  ", "\n  \\label{eq:}\n\\end{equation}", {
            block: true,
          })
        }
      >
        <HashIcon className="size-4" />
      </TooltipIconButton>
      <Divider />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TooltipIconButton tooltip="Figure" className="w-auto gap-0.5 px-1">
            <ImageIcon className="size-4" />
            <ChevronDownIcon className="size-3 opacity-60" />
          </TooltipIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 w-64 overflow-y-auto"
        >
          {images.length > 0 && (
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              An image in this project
            </DropdownMenuLabel>
          )}
          {images.map((path) => (
            <DropdownMenuItem key={path} onSelect={() => figure(path)}>
              <span className="truncate">{path}</span>
            </DropdownMenuItem>
          ))}
          {images.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => figure("")}>
            Empty figure
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipIconButton tooltip="Table" onClick={table}>
        <TableIcon className="size-4" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip="Link (the selection becomes its text)"
        onClick={() =>
          insert("\\href{", "", {
            needs: "hyperref",
            fill: (selected) => `}{${selected || "text"}}`,
            cursor: "\\href{".length,
          })
        }
      >
        <LinkIcon className="size-4" />
      </TooltipIconButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <TooltipIconButton tooltip="More" className="w-auto px-1">
            <ChevronDownIcon className="size-3.5" />
          </TooltipIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem
            onSelect={() => insert("\\[\n  ", "\n\\]", { block: true })}
          >
            <FunctionSquareIcon className="size-3.5" />
            Math on its own line
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <TableIcon className="size-3.5" />
              Table of size
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {[
                [2, 2],
                [3, 3],
                [4, 4],
                [5, 6],
              ].map(([c, r]) => (
                <DropdownMenuItem
                  key={`${c}x${r}`}
                  onSelect={() => {
                    const text = tableSnippet(c, r);
                    insert(text, "", {
                      block: true,
                      fill: () => "",
                      cursor: text.indexOf("\\caption{") + "\\caption{".length,
                    });
                  }}
                >
                  {c} columns × {r} rows
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onSelect={() =>
              insert("", "", {
                fill: () => "\\url{}",
                needs: "hyperref",
                cursor: "\\url{".length,
              })
            }
          >
            <LinkIcon className="size-3.5" />
            Web address
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              insert("\\newpage\n", "", { block: true, fill: () => "" })
            }
          >
            <FileDownIcon className="size-3.5" />
            Page break
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** A label from an image's file name: "figs/Growth rate.png" → "growth-rate". */
function figureLabel(path: string) {
  return (
    (path.split("/").pop() ?? "")
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || ""
  );
}
