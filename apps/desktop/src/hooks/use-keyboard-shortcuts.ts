import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getAppZoomAction, shouldHandleAppZoomShortcut } from "@/lib/app-zoom";
import { useDocumentStore } from "@/stores/document-store";

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleZoomKeyDown = (e: KeyboardEvent) => {
      const zoomAction = getAppZoomAction(e);
      if (!zoomAction || !shouldHandleAppZoomShortcut(e.target)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        const state = useDocumentStore.getState();
        state.setIsSaving(true);
        state.saveCurrentFile().finally(() => {
          setTimeout(() => state.setIsSaving(false), 500);
        });
      }

      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "n"
      ) {
        e.preventDefault();
        invoke("create_new_window").catch(console.error);
      }

      // Cmd+X (macOS) / Ctrl+X (others): Capture & Ask
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "x" &&
        !e.shiftKey &&
        !e.altKey
      ) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-capture-mode"));
      }

      // Cmd+Shift+D (macOS) / Ctrl+Shift+D (others): Toggle debug panel
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "d"
      ) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-debug-panel"));
      }

      // Cmd+Option+I (macOS) / Ctrl+Shift+I (others): Open native devtools.
      // The app disables the native right-click menu, so this is otherwise unreachable.
      if (
        (e.metaKey && e.altKey && e.key.toLowerCase() === "i") ||
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i")
      ) {
        e.preventDefault();
        invoke("open_devtools").catch(console.error);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keydown", handleZoomKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keydown", handleZoomKeyDown, true);
    };
  }, []);
}
