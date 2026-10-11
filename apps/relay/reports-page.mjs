// A private page for reading bug reports: GET /reports/admin, behind HTTP
// basic auth with the password in REPORTS_PASSWORD (no password set: no
// page). Wrong passwords are counted per address and refused for an hour
// past a few, so a short password can't simply be guessed through.
//
//   GET  /reports/admin                       the reports, newest first
//   GET  /reports/admin/<id>/<image>          a screenshot
//   POST /reports/admin/<id>/delete           remove one (once dealt with)
//   GET  /reports/admin/sync                  the Zotero→Obsidian sync's switch
//   POST /reports/admin/sync/pause|resume     turn it off or on
//   GET  /reports/admin/sync/state            {paused, changedAt}, for the sync
//                                             itself, which asks every half
//                                             minute (when it last asked shows
//                                             on the page)

import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPORT_ID = /^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d_[0-9a-f]{6}$/;
const IMAGE_NAME = /^image-\d+\.(png|jpg|webp|gif)$/;
const IMAGE_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
const HOUR = 60 * 60 * 1000;

const html = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

function samePassword(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createReportsPage({
  dir,
  password,
  now = Date.now,
  maxFailures = 10,
}) {
  const reportsDir = path.join(dir, "reports");
  const syncFile = path.join(dir, "sync-control.json");
  /** When the sync last asked whether it's paused, and what it said it was doing. */
  let lastSeen = null;

  function syncState() {
    try {
      const s = JSON.parse(fs.readFileSync(syncFile, "utf8"));
      return { paused: Boolean(s.paused), changedAt: s.changedAt ?? null };
    } catch {
      return { paused: false, changedAt: null };
    }
  }

  function setPaused(paused) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${syncFile}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({ paused, changedAt: new Date(now()).toISOString() }),
    );
    fs.renameSync(tmp, syncFile);
  }

  function syncPage() {
    const { paused, changedAt } = syncState();
    const ago = lastSeen ? Math.round((now() - lastSeen.at) / 1000) : null;
    const seen =
      ago === null
        ? "It hasn't asked since the relay started."
        : `It last asked ${ago < 90 ? `${ago} s` : `${Math.round(ago / 60)} min`} ago${lastSeen.note ? ` (${html(lastSeen.note)})` : ""}.`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Zotero sync</title><style>
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--text:#1d1d1b;--muted:#6b6b66;--line:#e2e2dd}
@media (prefers-color-scheme:dark){:root{--bg:#18181a;--card:#222225;--text:#ececea;--muted:#9a9a95;--line:#34343a}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,system-ui,sans-serif}
main{max-width:560px;margin:0 auto;padding:24px 16px}h1{font-size:20px;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.state{font-size:18px;font-weight:600}.on{color:#2e8b57}.off{color:#c0392b}
p{color:var(--muted);margin:8px 0}button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--text);cursor:pointer}
a{color:inherit}</style></head><body><main><h1>Zotero → Obsidian sync</h1>
<div class="card"><div class="state ${paused ? "off" : "on"}">${paused ? "Paused" : "Running"}</div>
<p>${paused ? "The sync writes nothing to the vault until you resume it." : "The sync keeps the vault in step with Zotero."}${changedAt ? ` Changed ${html(changedAt.replace("T", " ").slice(0, 16))} UTC.` : ""}</p>
<p>${seen}</p>
<form method="post" action="/reports/admin/sync/${paused ? "resume" : "pause"}"><button>${paused ? "Resume" : "Pause"}</button></form></div>
<p><a href="/reports/admin">Bug reports</a></p></main></body></html>`;
  }
  /** address → { count, since } of wrong passwords */
  const failures = new Map();

  function allowed(req, res, ip) {
    const record = failures.get(ip);
    if (record && now() - record.since > HOUR) failures.delete(ip);
    if ((failures.get(ip)?.count ?? 0) >= maxFailures) {
      res.writeHead(429, { "Content-Type": "text/plain" });
      res.end("Too many wrong passwords. Try again in an hour.\n");
      return false;
    }
    const header = req.headers.authorization ?? "";
    const given = header.startsWith("Basic ")
      ? Buffer.from(header.slice(6), "base64")
          .toString("utf8")
          .split(":")
          .slice(1)
          .join(":")
      : null;
    if (given !== null && samePassword(given, password)) {
      failures.delete(ip);
      return true;
    }
    if (given !== null) {
      const r = failures.get(ip) ?? { count: 0, since: now() };
      failures.set(ip, { ...r, count: r.count + 1 });
    }
    res.writeHead(401, {
      "WWW-Authenticate":
        'Basic realm="Latex4All bug reports", charset="UTF-8"',
      "Content-Type": "text/plain",
    });
    res.end("Password needed.\n");
    return false;
  }

  function list() {
    let ids = [];
    try {
      ids = fs.readdirSync(reportsDir).filter((n) => REPORT_ID.test(n));
    } catch {}
    return ids
      .sort()
      .reverse()
      .flatMap((id) => {
        try {
          const report = JSON.parse(
            fs.readFileSync(path.join(reportsDir, id, "report.json"), "utf8"),
          );
          return [{ id, ...report }];
        } catch {
          return [];
        }
      });
  }

  function page(reports) {
    const items = reports
      .map((r) => {
        const app = Object.entries(r.app ?? {})
          .map(([k, v]) => `<span><b>${html(k)}</b> ${html(v)}</span>`)
          .join("");
        const images = (r.images ?? [])
          .map(
            (name) =>
              `<a href="/reports/admin/${r.id}/${html(name)}" target="_blank"><img src="/reports/admin/${r.id}/${html(name)}" alt="${html(name)}"></a>`,
          )
          .join("");
        return `<article>
  <header><time>${html(r.at?.replace("T", " ").slice(0, 16))}</time>
    ${r.contact ? `<a href="mailto:${html(r.contact)}">${html(r.contact)}</a>` : "<i>no contact</i>"}
    <form method="post" action="/reports/admin/${r.id}/delete" onsubmit="return confirm('Delete this report?')"><button>Delete</button></form>
  </header>
  <p class="text">${html(r.text)}</p>
  ${images ? `<div class="images">${images}</div>` : ""}
  ${app ? `<div class="app">${app}</div>` : ""}
  ${r.log ? `<details><summary>Recent warnings and errors</summary><pre>${html(r.log)}</pre></details>` : ""}
  <footer>${html(r.id)}</footer>
</article>`;
      })
      .join("\n");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Bug reports</title><style>
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--text:#1d1d1b;--muted:#6b6b66;--line:#e2e2dd}
@media (prefers-color-scheme:dark){:root{--bg:#18181a;--card:#222225;--text:#ececea;--muted:#9a9a95;--line:#34343a}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 16px}h1 small{color:var(--muted);font-weight:400}
article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:14px}
article header{display:flex;gap:12px;align-items:center;color:var(--muted);font-size:13px}
article header form{margin-left:auto}button{font:inherit;font-size:12px;background:none;border:1px solid var(--line);color:var(--muted);border-radius:6px;padding:2px 8px;cursor:pointer}
button:hover{color:#c0392b;border-color:#c0392b}
.text{white-space:pre-wrap;margin:10px 0}
.images{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.images img{height:160px;width:auto;max-width:100%;object-fit:contain;background:var(--bg);border:1px solid var(--line);border-radius:6px}
.app{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted)}
details{margin-top:8px;font-size:13px}pre{white-space:pre-wrap;font-size:11px;background:var(--bg);padding:8px;border-radius:6px;overflow:auto}
footer{margin-top:8px;font-size:11px;color:var(--muted)}a{color:inherit}
</style></head><body><main><h1>Bug reports <small>${reports.length}</small> <small style="float:right"><a href="/reports/admin/sync">Zotero sync</a></small></h1>
${items || "<p>No reports.</p>"}</main></body></html>`;
  }

  /** Handles /reports/admin…; returns false for other paths. */
  return function handle(req, res, url, ip) {
    if (!url.pathname.startsWith("/reports/admin")) return false;
    if (!password) {
      res.writeHead(404);
      res.end();
      return true;
    }
    if (!allowed(req, res, ip)) return true;
    const parts = url.pathname.split("/").filter(Boolean); // reports admin id file
    if (parts[2] === "sync") {
      const headers = { "Cache-Control": "no-store" };
      if (parts.length === 3 && req.method === "GET") {
        res.writeHead(200, {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
        });
        res.end(syncPage());
        return true;
      }
      if (
        parts.length === 4 &&
        req.method === "POST" &&
        (parts[3] === "pause" || parts[3] === "resume")
      ) {
        setPaused(parts[3] === "pause");
        res.writeHead(303, { Location: "/reports/admin/sync" });
        res.end();
        return true;
      }
      if (parts.length === 4 && req.method === "GET" && parts[3] === "state") {
        lastSeen = {
          at: now(),
          note: (url.searchParams.get("note") ?? "").slice(0, 120),
        };
        res.writeHead(200, { ...headers, "Content-Type": "application/json" });
        res.end(JSON.stringify(syncState()));
        return true;
      }
      res.writeHead(404);
      res.end();
      return true;
    }
    if (parts.length === 2 && req.method === "GET") {
      const html = page(list());
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'",
      });
      res.end(html);
      return true;
    }
    const id = parts[2];
    if (!REPORT_ID.test(id ?? "")) {
      res.writeHead(404);
      res.end();
      return true;
    }
    if (parts.length === 4 && parts[3] === "delete" && req.method === "POST") {
      fs.rmSync(path.join(reportsDir, id), { recursive: true, force: true });
      res.writeHead(303, { Location: "/reports/admin" });
      res.end();
      return true;
    }
    if (
      parts.length === 4 &&
      req.method === "GET" &&
      IMAGE_NAME.test(parts[3])
    ) {
      const file = path.join(reportsDir, id, parts[3]);
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return true;
      }
      res.writeHead(200, {
        "Content-Type": IMAGE_MIME[parts[3].split(".").pop()],
        "Cache-Control": "private, max-age=3600",
      });
      fs.createReadStream(file).pipe(res);
      return true;
    }
    res.writeHead(404);
    res.end();
    return true;
  };
}
