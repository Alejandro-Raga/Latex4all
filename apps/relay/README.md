# Latex4All relay

Keeps shared projects in sync. Each project's changes are stored here so that
whoever opens it next gets them, whether or not anyone else is online, and are
passed on live to whoever has it open.

Everything is encrypted by the apps with a key that stays in the invite link:
the relay stores and forwards ciphertext and only knows a hash of the access
token. See the comment at the top of `relay.mjs` for the protocol, and
`collab.rs` in the desktop app for the other side.

It is open to anyone using the app, so everything is capped (`DEFAULT_LIMITS`):

| | |
| --- | --- |
| Per project | 100 MB (updates, snapshot and files together) |
| Per file | 25 MB |
| Whole relay | 5 GB; no new projects past 90% |
| Inactive projects | deleted after 180 days unopened |
| Chat | deleted after 30 days; 20 MB per project, oldest dropped first; 3 MB per message |
| New projects | 20 per address per day |

plus connections per project and per address, message size, and bandwidth per
project.

## Running

```sh
node relay.mjs               # 127.0.0.1:8082, data in ./data; PORT, HOST, DATA_DIR override
node --test                  # tests
```

`MIN_PROTOCOL` (default 1) turns away apps older than that protocol with
426, which the app shows as "update Latex4All". Apps only compress what they
send once it's 2 or more, since older apps can't read compressed data. So:
deploy the relay, ship the app, and once everyone has updated set
`MIN_PROTOCOL=2` in `.env` beside `compose.yml` on the vm and redeploy.

## Deployment

Runs on the `vm` host as a locked-down container (`compose.yml`), published at
`https://collab.alejandroraga.com` by the Cloudflare Tunnel that also serves
the blog. The tunnel is token-managed, so the route (that hostname →
`http://localhost:8082`) lives in the Zero Trust dashboard. Stored projects are
in `~/latex4all-relay/data` on the vm.

To deploy a change:

```sh
scp apps/relay/{package.json,relay.mjs,storage.mjs,Dockerfile,compose.yml,.dockerignore} vm:latex4all-relay/
ssh vm 'cd latex4all-relay && mkdir -p data && docker compose up -d --build'
ssh vm 'curl -s 127.0.0.1:8082/health'   # "ok <stored projects>"
```
