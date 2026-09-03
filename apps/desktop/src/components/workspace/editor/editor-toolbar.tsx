import { RefObject, useCallback, useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import {
  BoldIcon,
  ItalicIcon,
  ListIcon,
  Heading1Icon,
  Heading2Icon,
  CodeIcon,
  CropIcon,
  FunctionSquareIcon,
  FileTextIcon,
  ImageIcon,
  MinusIcon,
  PlusIcon,
  BookMarkedIcon,
  ExternalLinkIcon,
  XIcon,
} from "lucide-react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import vscodeIcon from "@/assets/vscode.svg";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { refreshSpellingDecorations } from "./spellcheck-extension";
import { forceGrammarRecheck } from "./grammar-check-extension";
import { useDocumentStore } from "@/stores/document-store";
import { CHECK_LANGUAGES, useSettingsStore } from "@/stores/settings-store";

interface EditorInfo {
  id: string;
  name: string;
}

const ZOOM_OPTIONS = [
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
  { value: "3", label: "300%" },
  { value: "4", label: "400%" },
];

function OpenEditorIcon({ editor }: { editor: EditorInfo }) {
  if (editor.id === "vscode") {
    return (
      <img
        src={vscodeIcon}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="size-5"
      />
    );
  }

  return <ExternalLinkIcon className="size-4" />;
}

function getOpenEditorButtonClassName(editor: EditorInfo) {
  return editor.id === "vscode"
    ? "h-7 w-7 border border-border/70 bg-muted/30 p-1 hover:bg-muted/50"
    : undefined;
}

interface EditorToolbarProps {
  editorView: RefObject<EditorView | null>;
  fileType?: "tex" | "image";
  imageScale?: number;
  onImageScaleChange?: (scale: number) => void;
  cropMode?: boolean;
  onCropToggle?: () => void;
}

export function EditorToolbar({
  editorView,
  fileType = "tex",
  imageScale = 1,
  onImageScaleChange,
  cropMode,
  onCropToggle,
}: EditorToolbarProps) {
  const vimMode = useSettingsStore((s) => s.vimMode);
  const setVimMode = useSettingsStore((s) => s.setVimMode);
  const grammarCheckEnabled = useSettingsStore((s) => s.grammarCheckEnabled);
  const setGrammarCheckEnabled = useSettingsStore(
    (s) => s.setGrammarCheckEnabled,
  );
  const checkLanguage = useSettingsStore((s) => s.checkLanguage);
  const setCheckLanguage = useSettingsStore((s) => s.setCheckLanguage);
  const ignoredWords = useSettingsStore((s) => s.ignoredWords);
  const removeIgnoredWord = useSettingsStore((s) => s.removeIgnoredWord);
  const handleRemoveIgnoredWord = useCallback(
    (word: string) => {
      removeIgnoredWord(word);
      const view = editorView.current;
      if (view) {
        refreshSpellingDecorations(view);
        forceGrammarRecheck(view);
      }
    },
    [removeIgnoredWord, editorView],
  );

  const fileName = useDocumentStore((s) => {
    const activeFile = s.files.find((f) => f.id === s.activeFileId);
    return activeFile?.name ?? "main.tex";
  });
  const activeFilePath = useDocumentStore((s) => {
    const activeFile = s.files.find((f) => f.id === s.activeFileId);
    return activeFile?.relativePath;
  });
  const projectRoot = useDocumentStore((s) => s.projectRoot);

  const [editors, setEditors] = useState<EditorInfo[]>([]);

  useEffect(() => {
    invoke<EditorInfo[]>("detect_editors")
      .then(setEditors)
      .catch(() => {});
  }, []);

  const openInEditor = useCallback(
    (editorId: string) => {
      if (!projectRoot) return;
      const view = editorView.current;
      const line = view
        ? view.state.doc.lineAt(view.state.selection.main.head).number
        : undefined;
      invoke("open_in_editor", {
        editorId,
        projectPath: projectRoot,
        filePath: activeFilePath,
        line,
      }).catch((err) => console.error("open_in_editor failed:", err));
    },
    [projectRoot, activeFilePath, editorView],
  );

  const insertText = (before: string, after: string = "") => {
    const view = editorView.current;
    if (!view) return;

    const { from, to } = view.state.selection.main;
    const selectedText = view.state.sliceDoc(from, to);

    view.dispatch({
      changes: {
        from,
        to,
        insert: before + selectedText + after,
      },
      selection: {
        anchor: from + before.length,
        head: from + before.length + selectedText.length,
      },
    });
    view.focus();
  };

  const wrapSelection = (wrapper: string) => {
    insertText(wrapper, wrapper);
  };

  const zoomIn = () => onImageScaleChange?.(Math.min(4, imageScale + 0.25));
  const zoomOut = () => onImageScaleChange?.(Math.max(0.25, imageScale - 0.25));

  if (fileType === "image") {
    return (
      <div className="flex h-[calc(var(--workspace-topbar-height)+var(--titlebar-height))] min-w-0 items-center justify-between border-border border-b bg-muted/30 px-2">
        <div className="flex min-w-0 max-w-[min(18rem,35vw)] items-center gap-1.5">
          <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
          <span
            className="min-w-0 truncate font-medium text-muted-foreground text-sm"
            title={activeFilePath ?? fileName}
          >
            {fileName}
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={zoomOut}
            disabled={imageScale <= 0.25}
          >
            <MinusIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={zoomIn}
            disabled={imageScale >= 4}
          >
            <PlusIcon className="size-3.5" />
          </Button>
          <Select
            value={imageScale.toString()}
            onValueChange={(v) => onImageScaleChange?.(Number(v))}
          >
            <SelectTrigger size="sm" className="h-6! w-auto text-xs">
              <SelectValue>{Math.round(imageScale * 100)}%</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ZOOM_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {onCropToggle && !fileName.toLowerCase().endsWith(".svg") && (
            <>
              <div className="mx-1 h-4 w-px bg-border" />
              <Button
                variant={cropMode ? "default" : "ghost"}
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={onCropToggle}
              >
                <CropIcon className="size-3.5" />
                Crop
              </Button>
            </>
          )}
          {editors.length === 1 && (
            <TooltipIconButton
              tooltip={`Open in ${editors[0].name}`}
              onClick={() => openInEditor(editors[0].id)}
              className={getOpenEditorButtonClassName(editors[0])}
            >
              <OpenEditorIcon editor={editors[0]} />
            </TooltipIconButton>
          )}
          {editors.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 p-1"
                  title="Open in Editor"
                >
                  <ExternalLinkIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {editors.map((editor) => (
                  <DropdownMenuItem
                    key={editor.id}
                    onClick={() => openInEditor(editor.id)}
                  >
                    {editor.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(var(--workspace-topbar-height)+var(--titlebar-height))] min-w-0 items-center gap-1 border-border border-b bg-muted/30 px-2">
      <div className="flex min-w-0 max-w-[min(18rem,35vw)] shrink items-center gap-1.5">
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 truncate font-medium text-muted-foreground text-sm"
          title={activeFilePath ?? fileName}
        >
          {fileName}
        </span>
      </div>
      <div className="mx-2 h-4 w-px shrink-0 bg-border" />
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto [&>*]:shrink-0">
        <TooltipIconButton
          tooltip="Bold (\\textbf)"
          onClick={() => insertText("\\textbf{", "}")}
        >
          <BoldIcon className="size-4" />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="Italic (\\textit)"
          onClick={() => insertText("\\textit{", "}")}
        >
          <ItalicIcon className="size-4" />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="Code (\\texttt)"
          onClick={() => insertText("\\texttt{", "}")}
        >
          <CodeIcon className="size-4" />
        </TooltipIconButton>
        <div className="mx-2 h-4 w-px bg-border" />
        <TooltipIconButton
          tooltip="Section"
          onClick={() => insertText("\\section{", "}")}
        >
          <Heading1Icon className="size-4" />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="Subsection"
          onClick={() => insertText("\\subsection{", "}")}
        >
          <Heading2Icon className="size-4" />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="List item"
          onClick={() => insertText("\\item ")}
        >
          <ListIcon className="size-4" />
        </TooltipIconButton>
        <div className="mx-2 h-4 w-px bg-border" />
        <TooltipIconButton
          tooltip="Inline math ($...$)"
          onClick={() => wrapSelection("$")}
        >
          <FunctionSquareIcon className="size-4" />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip="Display math (\\[...\\])"
          onClick={() => insertText("\\[\n  ", "\n\\]")}
        >
          <span className="font-mono text-xs">∫</span>
        </TooltipIconButton>
        <div className="mx-2 h-4 w-px bg-border" />
        <TooltipIconButton
          tooltip="Citation (\\cite)"
          onClick={() => insertText("\\cite{", "}")}
        >
          <BookMarkedIcon className="size-4" />
        </TooltipIconButton>
        <div className="mx-2 h-4 w-px bg-border" />
        <Button
          variant={vimMode ? "default" : "ghost"}
          size="sm"
          className="h-6 px-2 font-mono text-xs"
          onClick={() => setVimMode(!vimMode)}
          title="Toggle Vim mode"
        >
          VIM
        </Button>
        <Button
          variant={grammarCheckEnabled ? "default" : "ghost"}
          size="sm"
          className="h-6 px-2 font-mono text-xs"
          onClick={() => setGrammarCheckEnabled(!grammarCheckEnabled)}
          title="Toggle grammar checking (requires a local LanguageTool server at http://localhost:8081 — e.g. `brew install languagetool && brew services start languagetool`)"
        >
          GRAMMAR
        </Button>
        <Select value={checkLanguage} onValueChange={setCheckLanguage}>
          <SelectTrigger
            size="sm"
            className="h-6! w-auto text-xs"
            title="Spelling & grammar check language"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHECK_LANGUAGES.map((lang) => (
              <SelectItem key={lang.code} value={lang.code}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 font-mono text-xs"
              title="Words marked as not-a-typo"
            >
              IGNORED
              {ignoredWords.length > 0 ? ` (${ignoredWords.length})` : ""}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-0">
            <div className="border-border border-b px-3 py-2">
              <p className="font-medium text-sm">Ignored words</p>
              <p className="text-muted-foreground text-xs">
                Won't be flagged as spelling mistakes.
              </p>
            </div>
            <div className="max-h-64 overflow-y-auto p-1.5">
              {ignoredWords.length === 0 ? (
                <p className="px-1.5 py-2 text-muted-foreground text-xs">
                  No ignored words yet — right-click a misspelled word and
                  choose "Ignore".
                </p>
              ) : (
                ignoredWords.map((word) => (
                  <div
                    key={word}
                    className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
                  >
                    <span className="truncate">{word}</span>
                    <button
                      aria-label={`Stop ignoring "${word}"`}
                      onClick={() => handleRemoveIgnoredWord(word)}
                      className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      {editors.length === 1 && (
        <TooltipIconButton
          tooltip={`Open in ${editors[0].name}`}
          onClick={() => openInEditor(editors[0].id)}
          className={getOpenEditorButtonClassName(editors[0])}
        >
          <OpenEditorIcon editor={editors[0]} />
        </TooltipIconButton>
      )}
      {editors.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 p-1"
              title="Open in Editor"
            >
              <ExternalLinkIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {editors.map((editor) => (
              <DropdownMenuItem
                key={editor.id}
                onClick={() => openInEditor(editor.id)}
              >
                {editor.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
