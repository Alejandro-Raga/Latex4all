# Latex4All relay

Lets people share a project over the internet. The host's app keeps a
connection open to the relay; guests connect to the relay, and it hands each
connection to the host, who checks the invite token. The relay stores nothing
and never sees whether a token is valid. See the comment at the top of
`relay.mjs` for the protocol, and `collab.rs` in the desktop app for the other
side.

It is open to anyone using the app, so everything it hands out is capped
(`DEFAULT_LIMITS`): rooms, guests per room, connections per address, message
size, and bandwidth per room.

## Running

```sh
node relay.mjs               # 127.0.0.1:8082; PORT and HOST override
node --test                  # tests
```

## Deployment

Runs on the `vm` host as a locked-down container (`compose.yml`), published at
`https://collab.alejandroraga.com` by the Cloudflare Tunnel that also serves
the blog. The tunnel is token-managed, so the route (that hostname →
`http://localhost:8082`) lives in the Zero Trust dashboard.

To deploy a change:

```sh
scp apps/relay/{package.json,relay.mjs,Dockerfile,compose.yml,.dockerignore} vm:latex4all-relay/
ssh vm 'cd latex4all-relay && docker compose up -d --build'
ssh vm 'curl -s 127.0.0.1:8082/health'   # "ok <open rooms>"
```

The app has the relay's address built in (`RELAY_URL` in
`src/stores/collab-store.ts`).
