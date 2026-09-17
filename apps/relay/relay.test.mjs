import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { createRelay } from "./relay.mjs";

let server;
let base;

before(async () => {
  server = createRelay({
    limits: { maxRooms: 3, pendingTimeoutMs: 300, maxConnectionsPerRoom: 2 },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `ws://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const hex = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Resolves with the HTTP status of a refused upgrade, or "open". */
function attempt(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode));
    ws.on("open", () => {
      ws.close();
      resolve("open");
    });
    ws.on("error", () => {});
  });
}

async function open(url) {
  const ws = new WebSocket(url);
  await once(ws, "open");
  return ws;
}

function nextMessage(ws) {
  return new Promise((resolve) =>
    ws.once("message", (data, isBinary) => resolve({ data, isBinary })),
  );
}

function closeCode(ws) {
  return new Promise((resolve) => ws.once("close", (code) => resolve(code)));
}

async function hostRoom() {
  const room = hex();
  const secret = hex();
  const control = await open(`${base}/host?room=${room}&secret=${secret}`);
  return { room, secret, control };
}

test("connects a guest to the host and passes messages both ways", async () => {
  const { room, secret, control } = await hostRoom();

  const connect = nextMessage(control);
  const guest = await open(`${base}/r/${room}/sync?token=abc123`);
  // Sent before the host has picked up; must arrive, not be lost.
  guest.send(Buffer.from([1, 2, 3]));
  const request = JSON.parse((await connect).data.toString());
  assert.equal(request.type, "connect");
  assert.equal(request.path, "/sync?token=abc123");

  const host = new WebSocket(
    `${base}/accept/${room}/${request.id}?secret=${secret}`,
  );
  const early = nextMessage(host);
  await once(host, "open");
  assert.deepEqual([...(await early).data], [1, 2, 3]);

  const toGuest = nextMessage(guest);
  host.send(Buffer.from([9]));
  const received = await toGuest;
  assert.equal(received.isBinary, true);
  assert.deepEqual([...received.data], [9]);

  const text = nextMessage(host);
  guest.send("hello");
  const textReceived = await text;
  assert.equal(textReceived.isBinary, false);
  assert.equal(textReceived.data.toString(), "hello");

  // Ending the session closes everyone.
  const guestClosed = closeCode(guest);
  control.close();
  assert.equal(await guestClosed, 1001);
  assert.equal(await attempt(`${base}/r/${room}/sync?token=x`), 404);
});

test("refuses bad requests", async () => {
  const { room, secret, control } = await hostRoom();
  assert.equal(await attempt(`${base}/host?room=${room}&secret=${hex()}`), 409);
  assert.equal(await attempt(`${base}/host?room=nothex&secret=${secret}`), 400);
  assert.equal(await attempt(`${base}/r/${hex()}/sync`), 404);
  assert.equal(await attempt(`${base}/r/${room}/other`), 404);
  assert.equal(await attempt(`${base}/elsewhere`), 404);

  const connect = nextMessage(control);
  const guest = await open(`${base}/r/${room}/snapshot?token=t`);
  const { id } = JSON.parse((await connect).data.toString());
  // Only the host, who holds the secret, can pick up a guest.
  assert.equal(
    await attempt(`${base}/accept/${room}/${id}?secret=${hex()}`),
    403,
  );

  const closed = closeCode(guest);
  control.send(JSON.stringify({ type: "reject", id }));
  assert.equal(await closed, 4403);
  control.close();
});

test("gives up on a guest the host never picks up", async () => {
  const { room, control } = await hostRoom();
  const guest = await open(`${base}/r/${room}/sync?token=t`);
  assert.equal(await closeCode(guest), 4408);
  control.close();
});

test("caps guests per room and rooms overall", async () => {
  const { room, control } = await hostRoom();
  const a = await open(`${base}/r/${room}/sync?token=t`);
  const b = await open(`${base}/r/${room}/sync?token=t`);
  assert.equal(await attempt(`${base}/r/${room}/sync?token=t`), 503);
  a.close();
  b.close();

  const others = [await hostRoom(), await hostRoom()];
  assert.equal(
    await attempt(`${base}/host?room=${hex()}&secret=${hex()}`),
    503,
  );
  for (const other of [...others, { control }]) other.control.close();
});

test("slows a room down once its bandwidth allowance is spent", async () => {
  const slow = createRelay({
    limits: { roomBytesPerSecond: 100_000, roomBurstBytes: 100_000 },
  });
  slow.listen(0, "127.0.0.1");
  await once(slow, "listening");
  const slowBase = `ws://127.0.0.1:${slow.address().port}`;
  const room = hex();
  const secret = hex();
  const control = await open(`${slowBase}/host?room=${room}&secret=${secret}`);
  const connect = nextMessage(control);
  const guest = await open(`${slowBase}/r/${room}/sync?token=t`);
  const { id } = JSON.parse((await connect).data.toString());
  const host = await open(`${slowBase}/accept/${room}/${id}?secret=${secret}`);

  try {
    const started = Date.now();
    let received = 0;
    const done = new Promise((resolve) =>
      guest.on("message", (data) => {
        received += data.length;
        if (received >= 400_000) resolve();
      }),
    );
    for (let i = 0; i < 4; i++) host.send(Buffer.alloc(100_000));
    await done;
    // A message is charged after it's passed on: the first uses up the burst,
    // and each one after that has to wait a second for the allowance to refill.
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 1800, `took ${elapsed}ms`);
  } finally {
    for (const ws of [guest, host, control]) ws.terminate();
    slow.close();
  }
});
