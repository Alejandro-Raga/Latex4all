import { useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { LibraryIcon, NotebookTextIcon } from "lucide-react";
import { PanelBoundary } from "@/components/panel-boundary";
import { QuickReferencePanel } from "@/components/workspace/quick-reference-panel";
import { VaultPanel } from "@/components/workspace/vault-panel";
import { VaultStandalone } from "@/components/workspace/vault-standalone";
import { confirmLeaveVaultEdit } from "@/stores/vault-store";

/**
 * The Zotero library and the vault side by side, with no project open:
 * reading, sorting papers into topics and ideas, writing notes. Either side
 * can be closed; with both closed, both come back.
 */
export function LibraryView() {
  const [shown, setShown] = useState({ reference: true, vault: true });
  const close = (side: "reference" | "vault") => {
    if (side === "vault" && !confirmLeaveVaultEdit()) return;
    setShown((s) => {
      const next = { ...s, [side]: false };
      return next.reference || next.vault
        ? next
        : { reference: true, vault: true };
    });
  };
  const both = shown.reference && shown.vault;

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <PanelGroup
        direction="horizontal"
        autoSaveId={both ? "library-view" : undefined}
        className="min-h-0 flex-1"
      >
        {shown.reference && (
          <Panel id="reference" order={1} minSize={25} className="min-w-0">
            <PanelBoundary name="Library">
              <QuickReferencePanel onClose={() => close("reference")} />
            </PanelBoundary>
          </Panel>
        )}
        {both && (
          <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring" />
        )}
        {shown.vault && (
          <Panel id="vault" order={2} minSize={25} className="min-w-0">
            <PanelBoundary name="Vault">
              <VaultStandalone.Provider value>
                <VaultPanel onClose={() => close("vault")} />
              </VaultStandalone.Provider>
            </PanelBoundary>
          </Panel>
        )}
      </PanelGroup>
      {!both && (
        <div className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5 text-muted-foreground text-xs">
          <button
            type="button"
            onClick={() => setShown({ reference: true, vault: true })}
            className="flex items-center gap-1.5 hover:text-foreground"
          >
            {shown.reference ? (
              <NotebookTextIcon className="size-3.5" />
            ) : (
              <LibraryIcon className="size-3.5" />
            )}
            Show {shown.reference ? "Vault" : "Library"} too
          </button>
        </div>
      )}
    </div>
  );
}
