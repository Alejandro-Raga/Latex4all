/**
 * A PDF on this computer (in a project) added to your Zotero library, as a
 * paper with the PDF attached: from then on it's like any other paper,
 * highlights saved in Zotero, passages filed in notes, on every computer.
 * Zotero's web API: an item, its attachment, then the file (authorise,
 * upload to Zotero's storage, register).
 */
import { md5 } from "./md5";
import { createZoteroItems } from "./zotero-api";

const API = "https://api.zotero.org";

async function form(
  apiKey: string,
  path: string,
  fields: Record<string, string>,
): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Zotero-API-Key": apiKey,
      "Zotero-API-Version": "3",
      "Content-Type": "application/x-www-form-urlencoded",
      "If-None-Match": "*",
    },
    body: new URLSearchParams(fields).toString(),
  });
}

function created(result: { key: string } | { error: string } | undefined) {
  if (!result || "error" in result) {
    throw new Error(
      result && "error" in result ? result.error : "Zotero didn't save it.",
    );
  }
  return result.key;
}

export async function addPdfToZotero(
  apiKey: string,
  userID: string,
  pdf: { bytes: Uint8Array; filename: string; title: string; mtime?: number },
): Promise<{ itemKey: string; attachmentKey: string }> {
  const [paper] = await createZoteroItems(apiKey, userID, [
    { itemType: "document", title: pdf.title },
  ]);
  const itemKey = created(paper);
  const [attachment] = await createZoteroItems(apiKey, userID, [
    {
      itemType: "attachment",
      parentItem: itemKey,
      linkMode: "imported_file",
      title: pdf.filename,
      contentType: "application/pdf",
      filename: pdf.filename,
      tags: [],
      relations: {},
    },
  ]);
  const attachmentKey = created(attachment);

  // Authorise the upload.
  const auth = await form(
    apiKey,
    `/users/${userID}/items/${attachmentKey}/file`,
    {
      md5: md5(pdf.bytes),
      filename: pdf.filename,
      filesize: String(pdf.bytes.length),
      mtime: String(pdf.mtime ?? Date.now()),
    },
  );
  if (!auth.ok) {
    throw new Error(
      auth.status === 413
        ? "Your Zotero storage is full."
        : `Zotero didn't take the file (${auth.status}).`,
    );
  }
  const plan = (await auth.json()) as
    | { exists: 1 }
    | {
        url: string;
        contentType: string;
        prefix: string;
        suffix: string;
        uploadKey: string;
      };
  if ("exists" in plan) return { itemKey, attachmentKey };

  // Upload to Zotero's storage: its prefix, the file, its suffix.
  const encode = (s: string) => new TextEncoder().encode(s);
  const prefix = encode(plan.prefix);
  const suffix = encode(plan.suffix);
  const body = new Uint8Array(prefix.length + pdf.bytes.length + suffix.length);
  body.set(prefix, 0);
  body.set(pdf.bytes, prefix.length);
  body.set(suffix, prefix.length + pdf.bytes.length);
  const stored = await fetch(plan.url, {
    method: "POST",
    headers: { "Content-Type": plan.contentType },
    body,
  });
  if (!stored.ok) throw new Error(`The upload failed (${stored.status}).`);

  // Tell Zotero it's there.
  const done = await form(
    apiKey,
    `/users/${userID}/items/${attachmentKey}/file`,
    {
      upload: plan.uploadKey,
    },
  );
  if (!done.ok)
    throw new Error(`Zotero didn't register the file (${done.status}).`);
  return { itemKey, attachmentKey };
}
