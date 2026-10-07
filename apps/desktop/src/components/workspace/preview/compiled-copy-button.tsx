import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { FileOutputIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  type CompiledCopy,
  fullPath,
  keptPath,
  readCompiledCopy,
  saveCompiledCopy,
  setCompiledCopy,
} from "@/lib/compiled-copy";
import { revealInFileManager, revealLabel } from "@/lib/reveal";
import { resolveCompileTarget } from "@/lib/latex-compiler";
import { getCurrentPdfBytes, useDocumentStore } from "@/stores/document-store";

/** The compiled PDF also saved under a name and folder you pick. */
export function CompiledCopyButton({ projectRoot }: { projectRoot: string }) {
  const [copy, setCopy] = useState<CompiledCopy | null>(null);
  useEffect(() => {
    let live = true;
    void readCompiledCopy(projectRoot).then((c) => live && setCopy(c));
    return () => {
      live = false;
    };
  }, [projectRoot]);

  const choose = async () => {
    const { files, activeFileId } = useDocumentStore.getState();
    const target = resolveCompileTarget(activeFileId, files);
    if (!target) return;
    const project = projectRoot
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop();
    const picked = await save({
      title: "Save each compile as",
      defaultPath: copy
        ? fullPath(projectRoot, copy.path)
        : `${projectRoot}/${project || "document"}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!picked) return;
    const next = {
      source: copy?.source ?? target.targetPath,
      path: keptPath(projectRoot, picked),
    };
    try {
      await setCompiledCopy(projectRoot, next);
      setCopy(next);
      // The PDF already compiled goes there now, not at the next compile.
      const pdf = getCurrentPdfBytes();
      if (pdf) await saveCompiledCopy(projectRoot, next.source, pdf);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const name = copy?.path.split("/").pop();
  const folder = copy?.path.includes("/")
    ? copy.path.slice(0, copy.path.lastIndexOf("/"))
    : "the project folder";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={copy ? "secondary" : "ghost"}
          size="icon"
          className="size-7"
          title={
            copy ? `Each compile is saved as ${name}` : "Save each compile as…"
          }
          aria-label="Compiled PDF"
        >
          <FileOutputIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 p-3 text-sm">
        {copy ? (
          <>
            <p className="text-muted-foreground text-xs">
              Each compile saved as
            </p>
            <p className="break-words font-medium">{name}</p>
            <p className="break-words text-muted-foreground text-xs">
              in {folder}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={choose}
              >
                Change…
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  revealInFileManager(fullPath(projectRoot, copy.path))
                }
              >
                {revealLabel()}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={async () => {
                  await setCompiledCopy(projectRoot, null);
                  setCopy(null);
                }}
              >
                Stop
              </Button>
            </div>
          </>
        ) : (
          <Button size="sm" className="h-7 w-full text-xs" onClick={choose}>
            Save each compile as…
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
