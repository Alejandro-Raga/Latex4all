/**
 * Pulling a paper out of quick reference and into the open project.
 *
 * Both destinations — the reference files folder and the chat — put the PDF in
 * `attachments/` first: the chat reads project files, so a paper it is asked
 * about has to be one. A paper already imported is reused rather than copied
 * again, so right-clicking the same one twice does not fill the folder with
 * duplicates.
 */

import { join } from "@tauri-apps/api/path";
import { copyFileToProject, exists, writeBytesToProject } from "@/lib/tauri/fs";
import { useDocumentStore } from "@/stores/document-store";
import { useClaudeChatStore } from "@/stores/claude-chat-store";
import { useZoteroStore } from "@/stores/zotero-store";
import { downloadAttachmentFile, findPdfAttachment } from "@/lib/zotero-api";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("reference-import");

/** Where the wizard's "Reference files" land, and where these land too. */
export const REFERENCE_FOLDER = "attachments";

export type ReferencePdfSource =
  | { kind: "zotero"; itemKey: string; title: string }
  | { kind: "file"; absolutePath: string; fileName: string };

export class ReferenceImportError extends Error {}

/** Keep a readable name — Zotero's own filenames carry author and year. */
function safeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : "reference.pdf";
}

async function zoteroPdfBytes(
  itemKey: string,
  title: string,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { apiKey, userID } = useZoteroStore.getState();
  if (!apiKey || !userID) {
    throw new ReferenceImportError("Not connected to Zotero.");
  }
  const attachment = await findPdfAttachment(apiKey, userID, itemKey);
  if (!attachment) {
    throw new ReferenceImportError("This item has no PDF attachment.");
  }
  if (!attachment.downloadable) {
    throw new ReferenceImportError(
      "This item's PDF is a link to a local file in Zotero, not stored in Zotero cloud storage.",
    );
  }
  const bytes = await downloadAttachmentFile(apiKey, userID, attachment.key);
  const name = attachment.filename || `${title}.pdf`;
  return {
    bytes,
    fileName: safeFileName(
      name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`,
    ),
  };
}

/**
 * Copies the paper's PDF into the project's reference files folder and returns
 * its project-relative path.
 */
export async function importReferencePdf(
  source: ReferencePdfSource,
): Promise<string> {
  const projectRoot = useDocumentStore.getState().projectRoot;
  if (!projectRoot) {
    throw new ReferenceImportError("No project is open.");
  }

  const desiredName =
    source.kind === "zotero" ? null : safeFileName(source.fileName);

  // A paper already in the folder is the one to use.
  if (desiredName) {
    const existingPath = `${REFERENCE_FOLDER}/${desiredName}`;
    if (await exists(await join(projectRoot, existingPath))) {
      return existingPath;
    }
  }

  let relativePath: string;
  if (source.kind === "zotero") {
    const { bytes, fileName } = await zoteroPdfBytes(
      source.itemKey,
      source.title,
    );
    const existingPath = `${REFERENCE_FOLDER}/${fileName}`;
    if (await exists(await join(projectRoot, existingPath))) {
      relativePath = existingPath;
    } else {
      relativePath = await writeBytesToProject(
        projectRoot,
        existingPath,
        bytes,
      );
    }
  } else {
    relativePath = await copyFileToProject(
      projectRoot,
      source.absolutePath,
      `${REFERENCE_FOLDER}/${desiredName}`,
    );
  }

  await useDocumentStore.getState().refreshFiles();
  log.info("Imported reference PDF", { relativePath });
  return relativePath;
}

/** Imports the PDF, then pins it to the chat composer so it can be asked about. */
export async function addReferencePdfToChat(
  source: ReferencePdfSource,
): Promise<string> {
  const relativePath = await importReferencePdf(source);
  useClaudeChatStore.getState().addPendingAttachment({
    label: `@${relativePath}`,
    filePath: relativePath,
    selectedText: `[Attached file: ${relativePath} (PDF)]`,
  });
  return relativePath;
}
