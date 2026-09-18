import { fromBase64, toBase64 } from "lib0/buffer";

/**
 * A shared project's chat. Messages go through the relay like everything
 * else, encrypted, and are deleted there (and here) after a while; see
 * `chatDays` in apps/relay/relay.mjs.
 */

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface ChatImage {
  type: (typeof IMAGE_TYPES)[number];
  /** base64 */
  data: string;
  width: number;
  height: number;
}

/** A message as its sender wrote it: what's encrypted and sent. */
export interface ChatPayload {
  id: string;
  author: string;
  color: string;
  text: string;
  image?: ChatImage;
}

export interface ChatMessage extends ChatPayload {
  /** The relay's number for it; null until the relay has it. */
  seq: number | null;
  /** ms since epoch: the relay's time once it has it, the sender's until then. */
  at: number;
  /** Couldn't be sent. */
  failed?: boolean;
}

/** Past this, an image is shrunk further before sending. */
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20_000;

export function newMessageId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function encodeChat(payload: ChatPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

/** Someone's message, or null if it isn't one this app can show. */
export function decodeChat(data: Uint8Array | string): ChatPayload | null {
  try {
    const bytes = typeof data === "string" ? fromBase64(data) : data;
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (
      typeof value?.id !== "string" ||
      typeof value.author !== "string" ||
      typeof value.color !== "string" ||
      typeof value.text !== "string"
    ) {
      return null;
    }
    const payload: ChatPayload = {
      id: value.id,
      author: value.author.slice(0, 100),
      // Only a plain color goes into a style.
      color: /^#[0-9a-f]{3,8}$/i.test(value.color) ? value.color : "#888888",
      text: value.text.slice(0, MAX_TEXT_LENGTH),
    };
    const image = value.image;
    if (
      image &&
      IMAGE_TYPES.includes(image.type) &&
      typeof image.data === "string" &&
      /^[A-Za-z0-9+/=]*$/.test(image.data) &&
      Number.isFinite(image.width) &&
      Number.isFinite(image.height)
    ) {
      payload.image = {
        type: image.type,
        data: image.data,
        width: image.width,
        height: image.height,
      };
    }
    return payload.text || payload.image ? payload : null;
  } catch {
    return null;
  }
}

/**
 * `list` with `message` in it, in the relay's order: a message the relay
 * confirmed replaces its unconfirmed copy, and one already there is skipped.
 */
export function withMessage(
  list: ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  const existing = list.findIndex((m) => m.id === message.id);
  if (existing >= 0 && (list[existing].seq !== null || message.seq === null)) {
    return list;
  }
  const rest = existing >= 0 ? list.filter((_, i) => i !== existing) : list;
  const confirmed = rest.filter((m) => m.seq !== null);
  const pending = rest.filter((m) => m.seq === null);
  if (message.seq === null) return [...rest, message];
  const index = confirmed.findIndex((m) => (m.seq ?? 0) > (message.seq ?? 0));
  if (index < 0) return [...confirmed, message, ...pending];
  return [
    ...confirmed.slice(0, index),
    message,
    ...confirmed.slice(index),
    ...pending,
  ];
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
}

/**
 * An image made small enough to send: scaled down to at most 1600 pixels
 * across and saved as JPEG, smaller still if it needs to be.
 */
export async function prepareImage(file: Blob): Promise<ChatImage> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const side of [1600, 1200, 900, 600]) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) break;
      // JPEG has no transparency; show it on white rather than black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.85, 0.7]) {
        const blob = await canvasBlob(canvas, quality);
        if (blob && blob.size <= MAX_IMAGE_BYTES) {
          const data = toBase64(new Uint8Array(await blob.arrayBuffer()));
          return { type: "image/jpeg", data, width, height };
        }
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error("That image couldn't be made small enough to send.");
}
