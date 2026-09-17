import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import WebSocket from "ws";
import { FRAME, createRelay } from "./relay.mjs";

const DAY = 24 * 60 * 60 * 1000;
const running = [];

after(() => {
  for (const { server, dir } of running) {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function startRelay({ limits = {}, dir } = {}) {
  const clock = { now: Date.UTC(2026, 0, 1) };
  const dataDir = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "relay-"));
  const server = createRelay({ dataDir, limits, now: () => clock.now });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  running.push({ server, dir: dataDir });
  const port = server.address().port;
  return {
    server,
    clock,
    dataDir,
    http: `http://127.0.0.1:${port}`,
    ws: `ws://127.0.0.1:${port}`,
  };
}

const hex = (bytes) => randomBytes(bytes).toString("hex");

async function createProject(relay, token = hex(32)) {
  const id = hex(16);
  const accessHash = createHash("sha256").update(token).digest("hex");
  const res = await fetch(`${relay.http}/p/${id}`, {
    method: "POST",
    body: JSON.stringify({ accessHash }),
  });
  return { id, token, status: res.status };
}

function decode(data) {
  const type = data[0];
  if (type === FRAME.AWARENESS) {
    return { kind: "awareness", bytes: [...data.subarray(1)] };
  }
  return {
    kind: type === FRAME.UPDATE ? "update" : "snapshot",
    seq: Number(data.readBigUInt64BE(1)),
    bytes: [...data.subarray(9)],
  };
}

/** A sync client that records everything it receives. */
async function connect(relay, id, token) {
  const ws = new WebSocket(`${relay.ws}/p/${id}/sync`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const received = [];
  const waiters = [];
  ws.on("message", (data, isBinary) => {
    received.push(
      isBinary
        ? decode(data)
        : { kind: "json", ...JSON.parse(data.toString()) },
    );
    for (const waiter of waiters.splice(0)) waiter();
  });
  await once(ws, "open");
  const client = {
    ws,
    received,
    /** The first message from now on matching `predicate`. */
    async next(predicate) {
      const start = received.length;
      for (;;) {
        const found = received.slice(start).find(predicate);
        if (found) return found;
        await new Promise((resolve) => waiters.push(resolve));
      }
    },
    hello(after = 0) {
      const caughtUp = client.next((m) => m.type === "caught-up");
      ws.send(JSON.stringify({ type: "hello", after }));
      return caughtUp;
    },
    update(bytes) {
      const ack = client.next((m) => m.type === "ack" || m.type === "error");
      ws.send(Buffer.concat([Buffer.from([FRAME.UPDATE]), Buffer.from(bytes)]));
      return ack;
    },
    snapshot(upTo, bytes) {
      const ack = client.next((m) => m.type === "snapshot-ack");
      const header = Buffer.alloc(9);
      header[0] = FRAME.SNAPSHOT;
      header.writeBigUInt64BE(BigInt(upTo), 1);
      ws.send(Buffer.concat([header, Buffer.from(bytes)]));
      return ack;
    },
    close() {
      ws.close();
      return once(ws, "close");
    },
  };
  return client;
}

/** HTTP status of a refused WebSocket upgrade, or "open". */
function attempt(url, headers = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
    ws.on("open", () => {
      ws.close();
      resolve("open");
    });
    ws.on("error", () => {});
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test("creating projects and checking access", async () => {
  const relay = await startRelay();
  const project = await createProject(relay);
  assert.equal(project.status, 201);

  const again = await fetch(`${relay.http}/p/${project.id}`, {
    method: "POST",
    body: JSON.stringify({ accessHash: "a".repeat(64) }),
  });
  assert.equal(again.status, 409);
  const bad = await fetch(`${relay.http}/p/${hex(16)}`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(bad.status, 400);

  const url = `${relay.ws}/p/${project.id}/sync`;
  assert.equal(await attempt(url), 401);
  assert.equal(await attempt(url, { Authorization: `Bearer ${hex(32)}` }), 401);
  assert.equal(
    await attempt(`${relay.ws}/p/${hex(16)}/sync`, {
      Authorization: `Bearer ${project.token}`,
    }),
    404,
  );
  assert.equal(
    await attempt(url, { Authorization: `Bearer ${project.token}` }),
    "open",
  );
});

test("keeps updates for whoever connects later, and passes them on live", async () => {
  const relay = await startRelay();
  const { id, token } = await createProject(relay);

  const a = await connect(relay, id, token);
  assert.equal((await a.hello()).seq, 0);
  assert.equal((await a.update([1, 1])).seq, 1);
  assert.equal((await a.update([2, 2])).seq, 2);
  a.ws.send(Buffer.from([FRAME.AWARENESS, 9]));

  // B was offline for all of that and still gets it, in order.
  const b = await connect(relay, id, token);
  assert.equal((await b.hello()).seq, 2);
  assert.deepEqual(
    b.received.filter((m) => m.kind === "update"),
    [
      { kind: "update", seq: 1, bytes: [1, 1] },
      { kind: "update", seq: 2, bytes: [2, 2] },
    ],
  );
  // Cursors aren't kept.
  assert.equal(b.received.filter((m) => m.kind === "awareness").length, 0);

  // Both online: live updates and cursors go to the other one only.
  const toB = b.next((m) => m.kind === "update");
  assert.equal((await a.update([3])).seq, 3);
  assert.deepEqual(await toB, { kind: "update", seq: 3, bytes: [3] });
  const cursor = b.next((m) => m.kind === "awareness");
  a.ws.send(Buffer.from([FRAME.AWARENESS, 7]));
  assert.deepEqual((await cursor).bytes, [7]);
  await settle();
  assert.equal(a.received.filter((m) => m.kind === "update").length, 0);

  // Someone who had seen up to 2 only gets 3.
  const c = await connect(relay, id, token);
  await c.hello(2);
  assert.deepEqual(
    c.received.filter((m) => m.kind === "update").map((m) => m.seq),
    [3],
  );

  // What's on disk is exactly what the app sent.
  const log = fs.readFileSync(path.join(relay.dataDir, id, "log.bin"));
  assert.ok(log.includes(Buffer.from([2, 2])));
  for (const client of [a, b, c]) await client.close();
});

test("compacts into a snapshot, and survives a restart", async () => {
  const relay = await startRelay();
  const { id, token } = await createProject(relay);
  const a = await connect(relay, id, token);
  await a.hello();
  for (const n of [1, 2, 3]) await a.update([n]);

  assert.equal((await a.snapshot(5, [0])).ok, false); // beyond what exists
  assert.equal((await a.snapshot(2, [12])).ok, true);
  assert.equal((await a.snapshot(1, [1])).ok, false); // goes backwards
  await a.close();

  relay.server.close();
  const restarted = await startRelay({ dir: relay.dataDir });

  const fresh = await connect(restarted, id, token);
  assert.equal((await fresh.hello(0)).seq, 3);
  assert.deepEqual(
    fresh.received.filter((m) => m.kind !== "json"),
    [
      { kind: "snapshot", seq: 2, bytes: [12] },
      { kind: "update", seq: 3, bytes: [3] },
    ],
  );
  const current = await connect(restarted, id, token);
  await current.hello(2);
  assert.deepEqual(
    current.received.filter((m) => m.kind !== "json").map((m) => m.kind),
    ["update"],
  );
  // New updates carry on from where the log left off.
  assert.equal((await current.update([4])).seq, 4);
  await fresh.close();
  await current.close();

  // A crash halfway through writing an update loses only that update.
  restarted.server.close();
  fs.appendFileSync(
    path.join(relay.dataDir, id, "log.bin"),
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 9, 1]),
  );
  const recovered = await startRelay({ dir: relay.dataDir });
  const after = await connect(recovered, id, token);
  assert.equal((await after.hello(2)).seq, 4);
  assert.equal((await after.update([5])).seq, 5);
  const again = await connect(recovered, id, token);
  await again.hello(3);
  assert.deepEqual(
    again.received.filter((m) => m.kind === "update").map((m) => m.bytes),
    [[4], [5]],
  );
  await after.close();
  await again.close();
});

test("stores binary files, and deletes unused ones after a day", async () => {
  const relay = await startRelay({ limits: { maxFileBytes: 1000 } });
  const { id, token } = await createProject(relay);
  const auth = { Authorization: `Bearer ${token}` };
  const blob = `${relay.http}/p/${id}/blobs/${hex(32)}`;
  const body = randomBytes(600);

  assert.equal((await fetch(blob, { method: "PUT", body })).status, 401);
  assert.equal(
    (await fetch(blob, { method: "PUT", body, headers: auth })).status,
    201,
  );
  assert.equal(
    (await fetch(blob, { method: "PUT", body, headers: auth })).status,
    200,
  );
  const got = await fetch(blob, { headers: auth });
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), body);
  const tooBig = await fetch(`${relay.http}/p/${id}/blobs/${hex(32)}`, {
    method: "PUT",
    body: randomBytes(1001),
    headers: auth,
  });
  assert.equal(tooBig.status, 413);

  const client = await connect(relay, id, token);
  await client.hello();
  client.ws.send(JSON.stringify({ type: "gc", liveBlobs: [] }));
  await settle();
  assert.equal((await fetch(blob, { headers: auth })).status, 200); // too new

  const file = path.join(relay.dataDir, id, "blobs", blob.split("/").pop());
  const old = new Date(relay.clock.now - 2 * DAY);
  fs.utimesSync(file, old, old);
  client.ws.send(JSON.stringify({ type: "gc", liveBlobs: [] }));
  await settle();
  assert.equal((await fetch(blob, { headers: auth })).status, 404);
  await client.close();
});

test("enforces the storage limits", async () => {
  const relay = await startRelay({
    limits: { maxProjectBytes: 1000, maxFileBytes: 900, maxTotalBytes: 2000 },
  });
  const { id, token } = await createProject(relay);
  const auth = { Authorization: `Bearer ${token}` };
  const put = (projectId, headers, size) =>
    fetch(`${relay.http}/p/${projectId}/blobs/${hex(32)}`, {
      method: "PUT",
      body: randomBytes(size),
      headers,
    });

  // Figures are refused at the project limit...
  assert.equal((await put(id, auth, 800)).status, 201);
  assert.equal((await put(id, auth, 300)).status, 507);

  // ...but text keeps going a little past it, then stops too.
  const client = await connect(relay, id, token);
  await client.hello();
  assert.equal((await client.update(randomBytes(200))).type, "ack");
  assert.equal((await client.update(randomBytes(200))).code, "quota");
  await client.close();

  // Once the relay as a whole is full, no new projects.
  const second = await createProject(relay);
  const secondAuth = { Authorization: `Bearer ${second.token}` };
  assert.equal((await put(second.id, secondAuth, 900)).status, 201);
  assert.equal((await createProject(relay)).status, 507);
});

test("limits new projects per address per day", async () => {
  const relay = await startRelay({ limits: { projectsPerIpPerDay: 2 } });
  assert.equal((await createProject(relay)).status, 201);
  assert.equal((await createProject(relay)).status, 201);
  assert.equal((await createProject(relay)).status, 429);
  relay.clock.now += DAY;
  assert.equal((await createProject(relay)).status, 201);
});

test("deletes projects nobody has opened for 180 days", async () => {
  const relay = await startRelay();
  const idle = await createProject(relay);
  const active = await createProject(relay);
  const open = await connect(relay, active.id, active.token);
  await open.hello();

  relay.clock.now += 181 * DAY;
  relay.server.sweep();
  const url = (p) => `${relay.ws}/p/${p.id}/sync`;
  assert.equal(
    await attempt(url(idle), { Authorization: `Bearer ${idle.token}` }),
    404,
  );
  // Open right now, so it stays.
  assert.equal(
    await attempt(url(active), { Authorization: `Bearer ${active.token}` }),
    "open",
  );
  await open.close();
});

test("slows a project down once its bandwidth allowance is spent", async () => {
  const relay = await startRelay({
    limits: { projectBytesPerSecond: 100_000, projectBurstBytes: 100_000 },
  });
  // The allowance refills with the clock, so this one needs real time.
  relay.clock.now = Date.now();
  const tick = setInterval(() => {
    relay.clock.now = Date.now();
  }, 10);
  const { id, token } = await createProject(relay);
  const a = await connect(relay, id, token);
  const b = await connect(relay, id, token);
  await a.hello();
  await b.hello();
  try {
    const started = Date.now();
    let received = 0;
    const done = new Promise((resolve) =>
      b.ws.on("message", (data, isBinary) => {
        if (!isBinary || data[0] !== FRAME.AWARENESS) return;
        received += data.length;
        if (received >= 400_000) resolve();
      }),
    );
    for (let i = 0; i < 4; i++) {
      a.ws.send(
        Buffer.concat([Buffer.from([FRAME.AWARENESS]), randomBytes(99_999)]),
      );
    }
    await done;
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 1800, `took ${elapsed}ms`);
  } finally {
    clearInterval(tick);
    await a.close();
    await b.close();
  }
});
