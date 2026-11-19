# Latex4All server

A small program that keeps your group's shared Latex4All projects in sync
while your computers are off. Run it on any computer that stays on: a home
server, a NAS, a Raspberry Pi or a cloud machine.

It keeps every change and file of the projects you give it, and passes them
on to your collaborators when they come online. Everything is encrypted
before it leaves your computer, and the server can't read it. No open ports,
domain or certificates needed.

## With Docker

```sh
git clone https://github.com/Alejandro-Raga/Latex4all.git
docker build -t l4a-hub Latex4all/crates/l4a-sync
docker run -d --name l4a-hub --restart unless-stopped -v l4a-hub:/data l4a-hub
docker logs l4a-hub
```

The last command prints the **hub code**. In Latex4All, open
**Settings → Sync**, choose **Your own server**, paste the code and click
**Use**. Your shared projects are added to the server the next time you
open them.

The server keeps its data in the `l4a-hub` volume. Keep the same volume
when you update it, so the code stays the same.

## Without Docker

With [Rust](https://rustup.rs) installed:

```sh
cargo run --release --bin l4a-hub -- /path/to/data
```

## Updating

```sh
cd Latex4all && git pull
docker build -t l4a-hub crates/l4a-sync
docker rm -f l4a-hub
docker run -d --name l4a-hub --restart unless-stopped -v l4a-hub:/data l4a-hub
```

## For developers

This folder is also the sync library Latex4All uses: the design is in
[`docs/sync.md`](../../docs/sync.md).
