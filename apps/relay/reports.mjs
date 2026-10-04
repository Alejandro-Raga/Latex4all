// Bug reports sent from the app's "Report a bug" window.
//
// Unlike shared projects these aren't encrypted: they're meant to be read, by
// whoever runs the relay. Each report is a folder under `reports/`, named so
// they list in order:
//
//   reports/<YYYY-MM-DD_HH-MM-SS>_<6 hex>/
//     report.json   { at, text, contact, app, log, images: [names] }
//     image-1.png   the screenshots, as sent
//
// Capped like everything else here: a report's size, how many one address
// sends a day, and the total kept (the oldest go first past it).

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function folderSize(dir) {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    total += fs.statSync(path.join(dir, name)).size;
  }
  return total;
}

/** A report's content checked and trimmed, or null if it isn't one. */
export function parseReport(body, limits) {
  let report;
  try {
    report = JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
  if (!report || typeof report.text !== "string" || !report.text.trim()) {
    return null;
  }
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const images = [];
  for (const image of Array.isArray(report.images) ? report.images : []) {
    const ext = IMAGE_TYPES[image?.type];
    if (!ext || typeof image.data !== "string") continue;
    const data = Buffer.from(image.data, "base64");
    if (data.length === 0 || data.length > limits.maxReportImageBytes) continue;
    images.push({ ext, data });
    if (images.length >= limits.maxReportImages) break;
  }
  const app =
    report.app && typeof report.app === "object"
      ? Object.fromEntries(
          Object.entries(report.app)
            .slice(0, 20)
            .map(([k, v]) => [str(k, 40), str(String(v), 300)]),
        )
      : {};
  return {
    text: str(report.text, 20_000),
    contact: str(report.contact, 200),
    app,
    log: str(report.log, 50_000),
    images,
  };
}

export class Reports {
  constructor({ dir, limits, now = Date.now }) {
    this.dir = path.join(dir, "reports");
    this.limits = limits;
    this.now = now;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  ids() {
    return fs
      .readdirSync(this.dir)
      .filter((name) => /^\d{4}-\d\d-\d\d_/.test(name))
      .sort();
  }

  totalBytes() {
    return this.ids().reduce(
      (sum, id) => sum + folderSize(path.join(this.dir, id)),
      0,
    );
  }

  /** Stores a parsed report; returns its id. Makes room by dropping the oldest. */
  save(report) {
    const size =
      Buffer.byteLength(report.text) +
      Buffer.byteLength(report.log) +
      report.images.reduce((sum, i) => sum + i.data.length, 0);
    let total = this.totalBytes();
    for (const old of this.ids()) {
      if (total + size <= this.limits.maxReportsBytes) break;
      const dir = path.join(this.dir, old);
      total -= folderSize(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const stamp = new Date(this.now())
      .toISOString()
      .slice(0, 19)
      .replace("T", "_")
      .replaceAll(":", "-");
    const id = `${stamp}_${randomBytes(3).toString("hex")}`;
    const dir = path.join(this.dir, id);
    fs.mkdirSync(dir);
    const names = report.images.map((image, i) => {
      const name = `image-${i + 1}.${image.ext}`;
      fs.writeFileSync(path.join(dir, name), image.data);
      return name;
    });
    fs.writeFileSync(
      path.join(dir, "report.json"),
      JSON.stringify(
        {
          at: new Date(this.now()).toISOString(),
          text: report.text,
          contact: report.contact || null,
          app: report.app,
          log: report.log || null,
          images: names,
        },
        null,
        2,
      ),
    );
    return id;
  }
}
