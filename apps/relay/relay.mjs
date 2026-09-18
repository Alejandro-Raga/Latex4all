// Relay for Latex4All shared projects.
//
// Keeps each shared project's changes so that whoever opens it next gets them,
// whether or not anyone else is online, and passes changes on live to whoever
// has it open. Everything it stores and forwards is encrypted by the apps with
// a key that never reaches it: the invite link carries the key, and the relay
// only sees a token derived from it (and keeps just that token's hash).
//
// HTTP
//   POST /p/<id>                  create; body {"accessHash": sha256(token)}
//   PUT  /p/<id>/blobs/<blobId>   store a binary file (images, PDFs)
//   GET  /p/<id>/blobs/<blobId>
//   GET  /health
// WebSocket /p/<id>/sync          all need "Authorization: Bearer <token>", and
//                                 "Latex4All-Protocol: <n>" (absent means 1):
//                                 below `minProtocol` it's refused with 426
//   text   → {"type":"hello","after":n,"chatAfter":m}
//                                          send me everything after seq n, and
//                                          chat after m (no chat if absent)
//   text   → {"type":"gc","liveBlobs":[…]} blobs still in use
//   binary → [1][update]                   store and pass on an update
//   binary → [2][awareness]                pass on cursors; never stored
//   binary → [3][u64 upTo][snapshot]       replace updates ≤ upTo with this
//   binary → [4][message]                  store and pass on a chat message
//   binary ← [1][u64 seq][update]  [2][awareness]  [3][u64 upTo][snapshot]
//            [4][u64 seq][u64 at][message]
//   text   ← {"type":"caught-up","seq","logEntries","logBytes","minProtocol",
//            "chatDays"} {"type":"ack","seq"} {"type":"snapshot-ack","upTo","ok"}
//            {"type":"error","code"} {"type":"chat-ack","seq","at"}
//            {"type":"chat-error","code"}
//
// Protocol 2 added the version header, chat, and apps compressing what they
// encrypt. Apps only compress once `minProtocol` is 2, since older ones can't
// read it; raise it (MIN_PROTOCOL) once everyone has updated.
//
// The relay is open to anyone, so storage, connections and bandwidth are all
// capped (DEFAULT_LIMITS).

import fs from "node:fs";
import { STATUS_CODES, createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { ACCESS_HASH, BLOB_ID, PROJECT_ID, Storage } from "./storage.mjs";

const MiB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_LIMITS = {
  /** Updates, snapshot and binary files of one project together. */
  maxProjectBytes: 100 * MiB,
  maxFileBytes: 25 * MiB,
  /** Everything the relay stores. */
  maxTotalBytes: 5 * 1024 * MiB,
  /** Projects nobody opens for this long are deleted. */
  inactiveDays: 180,
  projectsPerIpPerDay: 20,
  maxConnectionsPerProject: 50,
  /** WebSockets of any kind from one address. */
  maxConnectionsPerIp: 40,
  maxUpdateBytes: 2 * MiB,
  maxSnapshotBytes: 25 * MiB,
  /** Sustained throughput of one project's live traffic. */
  projectBytesPerSecond: 2 * MiB,
  projectBurstBytes: 64 * MiB,
  heartbeatMs: 30_000,
  /** Apps older than this are refused, and told to update. */
  minProtocol: 1,
  /** Chat messages are deleted after this long. */
  chatDays: 30,
  /** A project's chat; the oldest messages go past this. */
  maxChatBytes: 20 * MiB,
  /** One message, image included. */
  maxChatMessageBytes: 3 * MiB,
  sweepMs: 6 * 60 * 60 * 1000,
};

export const FRAME = { UPDATE: 1, AWARENESS: 2, SNAPSHOT: 3, CHAT: 4 };

/** What this relay speaks. */
export const PROTOCOL = 2;

function send(res, status, body = "") {
  res.writeHead(status, {
    "Content-Type": "text/plain",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function refuse(socket, status) {
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function bearer(req) {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function chatFrame({ seq, at, data }) {
  const header = Buffer.alloc(17);
  header[0] = FRAME.CHAT;
  header.writeBigUInt64BE(BigInt(seq), 1);
  header.writeBigUInt64BE(BigInt(at), 9);
  return Buffer.concat([header, data]);
}

function frame(type, seq, data) {
  if (seq === null) return Buffer.concat([Buffer.from([type]), data]);
  const header = Buffer.alloc(9);
  header[0] = type;
  header.writeBigUInt64BE(BigInt(seq), 1);
  return Buffer.concat([header, data]);
}

/** Reads a request body, or null if it's longer than `limit`. */
async function readBody(req, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Builds the relay's HTTP server without starting it. `log` gets one short
 * line per notable event; never content, tokens or addresses.
 */
export function createRelay({
  dataDir,
  limits = {},
  now = Date.now,
  log = () => {},
}) {
  const config = { ...DEFAULT_LIMITS, ...limits };
  const storage = new Storage({ dir: dataDir, limits: config, now });
  /** projectId → open sync sockets */
  const connections = new Map();
  /** projectId → requests and sockets using it; it stays in memory while > 0 */
  const users = new Map();
  const connectionsByIp = new Map();
  const createdByIp = new Map();
  const buckets = new Map();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxSnapshotBytes + 16,
  });

  function clientIp(req) {
    // cloudflared is the only thing that can reach the port, and it sets this.
    return req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "";
  }

  /** Pairs with a successful `authorize`. */
  function done(id) {
    const left = (users.get(id) ?? 1) - 1;
    if (left > 0) {
      users.set(id, left);
      return;
    }
    users.delete(id);
    connections.delete(id);
    buckets.delete(id);
    storage.release(id);
  }

  /**
   * The project if the request may use it, counted as in use until `done`;
   * otherwise answers and returns null.
   */
  function authorize(req, id, reply) {
    const project = storage.open(id);
    if (!project) {
      reply(404);
      return null;
    }
    if (!project.checkAccess(bearer(req))) {
      if (!users.has(id)) storage.release(id);
      reply(401);
      return null;
    }
    users.set(id, (users.get(id) ?? 0) + 1);
    project.touch();
    return project;
  }

  /** Counts bytes against the project's allowance; pauses `source` when spent. */
  function charge(id, source, bytes) {
    const time = now();
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { tokens: config.projectBurstBytes, last: time };
      buckets.set(id, bucket);
    }
    bucket.tokens = Math.min(
      config.projectBurstBytes,
      bucket.tokens +
        ((time - bucket.last) / 1000) * config.projectBytesPerSecond,
    );
    bucket.last = time;
    bucket.tokens -= bytes;
    if (bucket.tokens < 0 && !source.isPaused) {
      source.pause();
      setTimeout(
        () => {
          if (source.readyState === source.OPEN) source.resume();
        },
        Math.ceil((-bucket.tokens / config.projectBytesPerSecond) * 1000),
      );
    }
  }

  async function createProject(req, res, id) {
    const body = await readBody(req, 1024);
    let accessHash;
    try {
      accessHash = JSON.parse(body?.toString() ?? "").accessHash;
    } catch {}
    if (typeof accessHash !== "string" || !ACCESS_HASH.test(accessHash)) {
      return send(res, 400);
    }
    const ip = clientIp(req);
    const today = Math.floor(now() / DAY);
    const created = createdByIp.get(ip);
    const count = created?.day === today ? created.count : 0;
    if (count >= config.projectsPerIpPerDay) return send(res, 429);

    const result = storage.create(id, accessHash);
    if (result === "exists") return send(res, 409);
    if (result === "full") return send(res, 507);
    createdByIp.set(ip, { day: today, count: count + 1 });
    log("project created");
    send(res, 201);
  }

  async function putBlob(req, res, id, blobId) {
    const project = authorize(req, id, (status) => send(res, status));
    if (!project) return;
    try {
      const declared = Number(req.headers["content-length"]);
      if (!Number.isFinite(declared)) return send(res, 411);
      if (declared > config.maxFileBytes) return send(res, 413);
      if (project.hasBlob(blobId)) {
        req.resume();
        return send(res, 200);
      }
      if (!project.blobFits(declared)) {
        req.resume();
        return send(res, 507);
      }
      const data = await readBody(req, declared);
      if (!data || data.length !== declared) return send(res, 400);
      project.saveBlob(blobId, data);
      send(res, 201);
    } finally {
      done(id);
    }
  }

  function getBlob(req, res, id, blobId) {
    const project = authorize(req, id, (status) => send(res, status));
    if (!project) return;
    const found = project.hasBlob(blobId);
    const file = project.blobPath(blobId);
    done(id);
    if (!found) return send(res, 404);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": fs.statSync(file).size,
    });
    fs.createReadStream(file).pipe(res);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://relay");
    const parts = url.pathname.split("/").filter(Boolean);
    const handle = async () => {
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, `ok ${storage.projectIds().length}\n`);
      }
      if (parts[0] !== "p" || !PROJECT_ID.test(parts[1] ?? "")) {
        return send(res, 404);
      }
      if (parts.length === 2 && req.method === "POST") {
        return createProject(req, res, parts[1]);
      }
      if (
        parts.length === 4 &&
        parts[2] === "blobs" &&
        BLOB_ID.test(parts[3])
      ) {
        if (req.method === "PUT") return putBlob(req, res, parts[1], parts[3]);
        if (req.method === "GET") return getBlob(req, res, parts[1], parts[3]);
      }
      send(res, 404);
    };
    handle().catch((err) => {
      log(`request failed: ${err.message}`);
      if (!res.headersSent) send(res, 500);
      else res.destroy();
    });
  });

  function openSync(req, socket, head, id, ip) {
    const project = authorize(req, id, (status) => refuse(socket, status));
    if (!project) return;
    const open = connections.get(id) ?? new Set();
    if (open.size >= config.maxConnectionsPerProject) {
      done(id);
      return refuse(socket, 503);
    }
    let upgraded = false;
    socket.once("close", () => {
      if (!upgraded) done(id);
    });

    const protocol = Number(req.headers["latex4all-protocol"] ?? 1);
    if (!(protocol >= config.minProtocol)) {
      done(id);
      return refuse(socket, 426);
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      upgraded = true;
      connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
      open.add(ws);
      connections.set(id, open);
      ws.isAlive = true;
      ws.ready = false;
      ws.on("pong", () => {
        ws.isAlive = true;
      });

      const broadcast = (data) => {
        for (const other of open) {
          if (other !== ws && other.ready) other.send(data);
        }
      };
      const reply = (message) => ws.send(JSON.stringify(message));

      ws.on("message", (data, isBinary) => {
        if (!isBinary) {
          let message;
          try {
            message = JSON.parse(data.toString());
          } catch {
            return;
          }
          if (message?.type === "hello" && !ws.ready) {
            const after = Number.isSafeInteger(message.after)
              ? Math.max(0, message.after)
              : 0;
            // Sent in one go, before any live update can reach this socket,
            // so the client sees every seq in order.
            const { snapshot, entries } = project.since(after);
            if (snapshot) {
              ws.send(frame(FRAME.SNAPSHOT, snapshot.upTo, snapshot.data));
            }
            for (const entry of entries) {
              ws.send(frame(FRAME.UPDATE, entry.seq, entry.data));
            }
            if (Number.isSafeInteger(message.chatAfter)) {
              for (const chat of project.chatSince(message.chatAfter)) {
                ws.send(chatFrame(chat));
              }
            }
            // The log since the last snapshot, so clients know when to compact.
            reply({
              type: "caught-up",
              seq: project.head,
              logEntries: project.log.length,
              logBytes: project.log.reduce((sum, e) => sum + e.data.length, 0),
              minProtocol: config.minProtocol,
              chatDays: config.chatDays,
            });
            ws.ready = true;
          } else if (
            message?.type === "gc" &&
            ws.ready &&
            Array.isArray(message.liveBlobs) &&
            message.liveBlobs.length <= 100_000 &&
            message.liveBlobs.every((b) => BLOB_ID.test(b))
          ) {
            project.collectBlobs(message.liveBlobs);
          }
          return;
        }

        const type = data[0];
        if (type === FRAME.UPDATE) {
          const update = data.subarray(1);
          if (update.length > config.maxUpdateBytes) {
            ws.close(1009, "Update too large");
            return;
          }
          charge(id, ws, data.length);
          const seq = project.append(Buffer.from(update));
          if (seq === null) {
            reply({ type: "error", code: "quota" });
            return;
          }
          reply({ type: "ack", seq });
          broadcast(frame(FRAME.UPDATE, seq, update));
        } else if (type === FRAME.AWARENESS) {
          charge(id, ws, data.length);
          broadcast(data);
        } else if (type === FRAME.CHAT && ws.ready) {
          const message = data.subarray(1);
          if (message.length > config.maxChatMessageBytes) {
            reply({ type: "chat-error", code: "too-large" });
            return;
          }
          charge(id, ws, data.length);
          const stored = project.appendChat(Buffer.from(message));
          if (!stored) {
            reply({ type: "chat-error", code: "quota" });
            return;
          }
          reply({ type: "chat-ack", ...stored });
          broadcast(chatFrame({ ...stored, data: message }));
        } else if (type === FRAME.SNAPSHOT && data.length >= 9) {
          const upTo = Number(data.readBigUInt64BE(1));
          const ok = project.compact(upTo, Buffer.from(data.subarray(9)));
          reply({ type: "snapshot-ack", upTo, ok });
        }
      });

      ws.on("close", () => {
        open.delete(ws);
        const left = (connectionsByIp.get(ip) ?? 1) - 1;
        if (left > 0) connectionsByIp.set(ip, left);
        else connectionsByIp.delete(ip);
        done(id);
      });
    });
  }

  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => socket.destroy());
    const url = new URL(req.url ?? "/", "http://relay");
    const parts = url.pathname.split("/").filter(Boolean);
    const ip = clientIp(req);
    if ((connectionsByIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) {
      return refuse(socket, 429);
    }
    if (
      parts.length === 3 &&
      parts[0] === "p" &&
      PROJECT_ID.test(parts[1]) &&
      parts[2] === "sync"
    ) {
      return openSync(req, socket, head, parts[1], ip);
    }
    refuse(socket, 404);
  });

  // Drops sockets whose other end vanished without closing.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, config.heartbeatMs);
  heartbeat.unref();

  const sweep = () => {
    const removed = storage.sweep((id) => users.has(id));
    if (removed) log(`deleted ${removed} inactive project(s)`);
  };
  const sweeper = setInterval(sweep, config.sweepMs);
  sweeper.unref();

  server.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    for (const ws of wss.clients) ws.terminate();
  });

  server.sweep = sweep;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8082);
  const host = process.env.HOST ?? "127.0.0.1";
  const dataDir = process.env.DATA_DIR ?? "./data";
  const minProtocol = Number(process.env.MIN_PROTOCOL ?? 1);
  const server = createRelay({
    dataDir,
    limits: { minProtocol },
    log: (line) => console.log(`[relay] ${line}`),
  });
  server.listen(port, host, () => {
    console.log(`[relay] listening on ${host}:${port}, data in ${dataDir}`);
    server.sweep();
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
