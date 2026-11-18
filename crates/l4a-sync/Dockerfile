# The Latex4All hub. Build: docker build -t l4a-hub crates/l4a-sync
# Run:   docker run -d --restart unless-stopped -v l4a-hub:/data l4a-hub
# Code:  docker logs <container>   (the hub code to paste in the app)
FROM rust:1-slim AS build
WORKDIR /src
COPY . .
RUN cargo build --release --bin l4a-hub

FROM debian:stable-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/l4a-hub /usr/local/bin/l4a-hub
ENV L4A_HUB_DATA=/data
VOLUME /data
CMD ["l4a-hub"]
