import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

/** "Show in Finder", "Show in File Explorer": the menu item, by system. */
export function revealLabel(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "Show in Finder";
  if (ua.includes("Windows")) return "Show in File Explorer";
  return "Show in file manager";
}

/** A file selected in its folder, or a folder opened, in the system's file manager. */
export function revealInFileManager(path: string) {
  invoke("reveal_in_file_manager", { path }).catch((err) =>
    toast.error(String(err)),
  );
}
