// Relay for Latex4All live collaboration over the internet.
//
// The relay never runs a session itself. Whoever shares keeps a "control"
// WebSocket open to it for their room. When a guest connects to
// /r/<room>/<endpoint>, the relay tells the host over that control socket;
// the host's app checks the invite token in the guest's path and, if it's
// right, opens a fresh WebSocket to /accept/<room>/<id>. From then on the
// relay just passes messages between those two sockets, unchanged.
//
// So the token is checked by the host, not here, and nothing is stored: the
// relay only knows which rooms are open. It is also open to anyone, which is
// why every resource it hands out has a cap (see LIMITS).

import { randomBytes, timingSafeEqual } from "node:crypto";
import { STATUS_CODES, createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

export const DEFAULT_LIMITS = {
  maxRooms: 100,
  /** Guests connected or waiting in one room. */
  maxConnectionsPerRoom: 20,
  /** WebSockets of any kind from one address. */
  maxConnectionsPerIp: 40,
  /** The app splits files into 1 MiB pieces, so this leaves headroom. */
  maxMessageBytes: 2 * 1024 * 1024,
  /** How long a guest may wait for the host to pick up. */
  pendingTimeoutMs: 15_000,
  /** What a waiting guest may send before the host picks up. */
  maxPendingBytes: 4 * 1024 * 1024,
  /** Sustained throughput for everything in one room, in both directions. */
  roomBytesPerSecond: 2 * 1024 * 1024,
  /** How far a room can burst above that, e.g. to download a project. */
  roomBurstBytes: 64 * 1024 * 1024,
  heartbeatMs: 30_000,
};

const HEX_ID = /^[0-9a-f]{32}$/;

function sameSecret(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function refuse(socket, status) {
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/**
 * Builds the relay's HTTP server without starting it.
 * `log` receives one short line per room opened or closed; no content, no
 * addresses.
 */
export function createRelay({ limits = {}, log = () => {} } = {}) {
  const config = { ...DEFAULT_LIMITS, ...limits };
  const rooms = new Map();
  const connectionsByIp = new Map();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxMessageBytes,
  });

  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`ok ${rooms.size}\n`);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  function clientIp(req) {
    // cloudflared is the only thing that can reach the port, and it sets this.
    return req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "";
  }

  function track(ws, ip) {
    connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("close", () => {
      const left = (connectionsByIp.get(ip) ?? 1) - 1;
      if (left > 0) connectionsByIp.set(ip, left);
      else connectionsByIp.delete(ip);
    });
  }

  /** Counts bytes against the room's allowance; pauses `source` when it's spent. */
  function charge(room, source, bytes) {
    const now = Date.now();
    const bucket = room.bucket;
    bucket.tokens = Math.min(
      config.roomBurstBytes,
      bucket.tokens + ((now - bucket.last) / 1000) * config.roomBytesPerSecond,
    );
    bucket.last = now;
    bucket.tokens -= bytes;
    if (bucket.tokens < 0 && !source.isPaused) {
      source.pause();
      const waitMs = Math.ceil(
        (-bucket.tokens / config.roomBytesPerSecond) * 1000,
      );
      setTimeout(() => {
        if (source.readyState === source.OPEN) source.resume();
      }, waitMs);
    }
  }

  function closeRoom(room) {
    if (rooms.get(room.id) !== room) return;
    rooms.delete(room.id);
    for (const link of room.links) {
      clearTimeout(link.timer);
      link.guest.close(1001, "Session ended");
      link.host?.close(1001, "Session ended");
    }
    room.links.clear();
    log(`room closed (${rooms.size} open)`);
  }

  function openHost(req, socket, head, url, ip) {
    const roomId = url.searchParams.get("room") ?? "";
    const secret = url.searchParams.get("secret") ?? "";
    if (!HEX_ID.test(roomId) || !HEX_ID.test(secret))
      return refuse(socket, 400);
    if (rooms.has(roomId)) return refuse(socket, 409);
    if (rooms.size >= config.maxRooms) return refuse(socket, 503);

    wss.handleUpgrade(req, socket, head, (control) => {
      track(control, ip);
      if (rooms.has(roomId)) {
        control.close(4409, "Room taken");
        return;
      }
      const room = {
        id: roomId,
        secret,
        control,
        links: new Set(),
        pending: new Map(),
        bucket: { tokens: config.roomBurstBytes, last: Date.now() },
      };
      rooms.set(roomId, room);
      log(`room opened (${rooms.size} open)`);

      control.on("message", (data, isBinary) => {
        if (isBinary) return;
        let message;
        try {
          message = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (message?.type !== "reject") return;
        const link = room.pending.get(message.id);
        if (!link) return;
        room.pending.delete(message.id);
        room.links.delete(link);
        clearTimeout(link.timer);
        link.guest.close(4403, "Invite not accepted");
      });
      control.on("close", () => closeRoom(room));
    });
  }

  function openGuest(req, socket, head, url, ip, roomId, endpoint) {
    const room = rooms.get(roomId);
    if (!room) return refuse(socket, 404);
    if (room.links.size >= config.maxConnectionsPerRoom) {
      return refuse(socket, 503);
    }

    wss.handleUpgrade(req, socket, head, (guest) => {
      track(guest, ip);
      const id = randomBytes(16).toString("hex");
      const link = {
        guest,
        host: null,
        buffered: [],
        bufferedBytes: 0,
        timer: setTimeout(() => {
          room.pending.delete(id);
          room.links.delete(link);
          guest.close(4408, "Host didn't answer");
        }, config.pendingTimeoutMs),
      };
      room.pending.set(id, link);
      room.links.add(link);

      guest.on("message", (data, isBinary) => {
        if (link.host) {
          charge(room, guest, data.length);
          link.host.send(data, { binary: isBinary });
          return;
        }
        link.bufferedBytes += data.length;
        if (link.bufferedBytes > config.maxPendingBytes) {
          guest.close(1009, "Too much data before the host answered");
          return;
        }
        link.buffered.push({ data, isBinary });
      });
      guest.on("close", () => {
        clearTimeout(link.timer);
        room.pending.delete(id);
        room.links.delete(link);
        link.host?.close();
      });

      room.control.send(
        JSON.stringify({
          type: "connect",
          id,
          path: `/${endpoint}${url.search}`,
        }),
      );
    });
  }

  function openAccept(req, socket, head, url, ip, roomId, linkId) {
    const room = rooms.get(roomId);
    const secret = url.searchParams.get("secret") ?? "";
    if (!room || !sameSecret(secret, room.secret)) return refuse(socket, 403);
    const link = room.pending.get(linkId);
    if (!link) return refuse(socket, 404);
    room.pending.delete(linkId);
    clearTimeout(link.timer);

    wss.handleUpgrade(req, socket, head, (host) => {
      track(host, ip);
      if (link.guest.readyState !== link.guest.OPEN) {
        host.close();
        return;
      }
      link.host = host;
      for (const { data, isBinary } of link.buffered.splice(0)) {
        host.send(data, { binary: isBinary });
      }
      host.on("message", (data, isBinary) => {
        charge(room, host, data.length);
        link.guest.send(data, { binary: isBinary });
      });
      host.on("close", () => link.guest.close());
    });
  }

  server.on("upgrade", (req, socket, head) => {
    socket.on("error", () => socket.destroy());
    const url = new URL(req.url ?? "/", "http://relay");
    const ip = clientIp(req);
    if ((connectionsByIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) {
      return refuse(socket, 429);
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 1 && parts[0] === "host") {
      return openHost(req, socket, head, url, ip);
    }
    if (parts.length === 3 && parts[0] === "r" && HEX_ID.test(parts[1])) {
      if (parts[2] !== "sync" && parts[2] !== "snapshot") {
        return refuse(socket, 404);
      }
      return openGuest(req, socket, head, url, ip, parts[1], parts[2]);
    }
    if (
      parts.length === 3 &&
      parts[0] === "accept" &&
      HEX_ID.test(parts[1]) &&
      HEX_ID.test(parts[2])
    ) {
      return openAccept(req, socket, head, url, ip, parts[1], parts[2]);
    }
    refuse(socket, 404);
  });

  // Drops sockets whose other end vanished without closing, so their room
  // and connection counts are freed.
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
  server.on("close", () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
  });

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8082);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = createRelay({
    log: (line) => console.log(`[relay] ${line}`),
  });
  server.listen(port, host, () =>
    console.log(`[relay] listening on ${host}:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
