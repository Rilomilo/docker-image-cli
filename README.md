# docker-image-cli

[![npm version](https://img.shields.io/npm/v/docker-image-cli.svg)](https://www.npmjs.com/package/docker-image-cli)
[![npm downloads](https://img.shields.io/npm/dm/docker-image-cli.svg)](https://www.npmjs.com/package/docker-image-cli)
[![license](https://img.shields.io/npm/l/docker-image-cli.svg)](LICENSE)

**Search, inspect, audit, and fast download Docker images — without installing Docker.**


https://github.com/user-attachments/assets/b28cf71e-539d-4596-a894-33739f1981fa


## Features

- **Search** Docker Hub and display stars, pull counts, and official status
- **List tags** with compressed size and last-updated date
- **Inspect** image config: platform, environment, entrypoint, ports, layers, and build history
- **Pull** images as `docker load`-compatible tars with **concurrent layer downloads** and live progress
  
- Works with Docker Hub and any registry that speaks the [OCI Distribution Spec](https://github.com/opencontainers/distribution-spec) (Docker Registry HTTP API v2).

---

## Installation

Install globally via npm:

```bash
npm install -g docker-image-cli
```

Then use the `docker-img` command anywhere:

```bash
docker-img <command> [options]
```

For local development, clone the repo and link it:

```bash
git clone https://github.com/Rilomilo/docker-image-cli.git
cd docker-image-cli
npm install
npm link
```

---

## Commands

### `search <query>`

Search Docker Hub for images.

```bash
docker-img search nginx
docker-img search postgres -n 10
```

| Option | Description | Default |
|--------|-------------|---------|
| `-n, --limit <number>` | Max results to show | `25` |

**Example output:**

```
Found 284287 results (showing 5):

NAME                            DESCRIPTION                                         STARS    PULLS       OFFICIAL
------------------------------  --------------------------------------------------  -------  ----------  --------
nginx                           Official build of Nginx.                            21268    13.0B       [OK]
nginx/nginx-ingress             NGINX and NGINX Plus Ingress Controllers for K...   120      1.1B
...
```

---

### `tags <image>`

List available tags for an image. For Docker Hub images, shows compressed size and last-updated date. Falls back to the registry API for custom registries.

```bash
docker-img tags ubuntu
docker-img tags alpine
docker-img tags myregistry.example.com/myapp
```

| Option | Description |
|--------|-------------|
| `-u, --username <user>` | Registry username (for private images) |
| `-p, --password <pass>` | Registry password |

**Example output:**

```
Tags for ubuntu (214 total):

TAG                                  COMPRESSED SIZE    LAST UPDATED
-----------------------------------  -----------------  ----------------------
22.04                                29.7 MB            4/17/2026, 7:53:26 AM
20.04                                31.7 MB            4/17/2026, 7:51:14 AM
...
```

---

### `inspect <image>`

Show detailed image metadata: platform, config (env, cmd, ports, volumes, labels), compressed layer sizes, and build history.

```bash
docker-img inspect ubuntu:22.04
docker-img inspect nginx:alpine
docker-img inspect alpine:latest --platform linux/arm64
```

| Option | Description | Default |
|--------|-------------|---------|
| `--platform <os/arch>` | Platform to inspect for multi-arch images | `linux/amd64` |
| `-u, --username <user>` | Registry username | |
| `-p, --password <pass>` | Registry password | |

**Example output:**

```
Image:       nginx:alpine
Digest:      sha256:3bcf852aed06...
Platform:    linux/amd64
Created:     4/16/2026, 5:19:04 AM

Config:
  Entrypoint: ["/docker-entrypoint.sh"]
  Cmd:        ["nginx","-g","daemon off;"]
  Ports:      80/tcp
  Env:
    PATH=/usr/local/sbin:/usr/local/bin:...
    NGINX_VERSION=1.29.8

Layers: (8 total, 26 MB compressed)
   1. sha256:6a0ac1617861…  3.86 MB
   2. sha256:82736a35d0e7…  1.87 MB
   ...

Build History:
   1. ADD alpine-minirootfs-3.23.4-x86_64.tar.gz / # buildkit
   2. RUN set -x && addgroup -g 101 -S nginx ...
   ...
```

---

### `pull <image>`

Download a Docker image as a tar file. The output is compatible with `docker load`.

Layers are downloaded **concurrently** (default: 3 at a time) with a live per-layer progress display. Each compressed layer blob is gunzipped on the fly and written to a temp file, then assembled into the final tar.

```bash
# Basic pull (saves as nginx_alpine_latest.tar in current directory)
docker-img pull nginx:alpine

# Custom output path
docker-img pull ubuntu:22.04 -o /tmp/ubuntu.tar

# Increase concurrency for faster downloads on fast connections
docker-img pull python:3.12 -c 6

# Pull a specific platform from a multi-arch image
docker-img pull ubuntu:22.04 --platform linux/arm64 -o ubuntu_arm64.tar

# Private registry
docker-img pull myregistry.example.com/myapp:v1.2 -u user -p secret
```

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <file>` | Output tar file path | `<image>_<tag>.tar` |
| `--platform <os/arch>` | Target platform for multi-arch images | `linux/amd64` |
| `-c, --concurrency <n>` | Max parallel layer downloads | all layers |
| `-u, --username <user>` | Registry username | |
| `-p, --password <pass>` | Registry password | |

**Load the downloaded image into Docker:**

```bash
docker load -i nginx_alpine.tar
docker run --rm nginx:alpine nginx -v
```

**Example output (TTY):**

```
Pulling nginx:alpine  —  8 layers, 26 MB compressed  (4 concurrent)

  ✔ Layer  1/8  sha256:6a0ac1617861…  3.86 MB compressed → 8.73 MB uncompressed
  ✔ Layer  2/8  sha256:82736a35d0e7…  1.87 MB compressed → 4.74 MB uncompressed
  ⬇ Layer  3/8  sha256:583599bb7d38…  [████████████░░░░]  75%  470 B / 627 B
  ⬇ Layer  4/8  sha256:aee4e54b3865…  [██░░░░░░░░░░░░░░]  12%  115 B / 956 B
    Layer  5/8  sha256:781ff50d2644…  waiting
  ...

  All layers downloaded in 7.0s

✔ Done!
  File:  /path/to/nginx_alpine.tar
  Size:  63.6 MB

  Load with: docker load -i "nginx_alpine.tar"
```

---

## Project Structure

```
docker-image-cli/
├── bin/
│   └── docker-img.js        # CLI entry point — defines all commands and options
│
├── src/
│   ├── registry.js          # Docker Registry API v2 client
│   │                        #   parseImageRef()  — parses image references
│   │                        #   RegistryClient   — auth, manifests, blobs, Hub search
│   │
│   ├── utils.js             # Shared formatting helpers
│   │                        #   formatBytes, formatPulls, printTable,
│   │                        #   selectPlatform, handleError
│   │
│   └── commands/
│       ├── search.js        # `search` command — queries Docker Hub search API
│       ├── tags.js          # `tags` command  — Hub tags API + registry fallback
│       ├── inspect.js       # `inspect` command — resolves manifest, fetches config
│       └── pull.js          # `pull` command  — concurrent download + tar assembly
│
├── package.json
└── README.md
```

---

## How It Works

### Authentication

Docker Hub uses a token-based auth flow. Before any registry request the client fetches a short-lived bearer token from `auth.docker.io`:

```
GET https://auth.docker.io/token
  ?service=registry.docker.io
  &scope=repository:{name}:pull
```

Tokens are cached in memory per image name.

### Multi-arch Images

Images like `ubuntu:22.04` are published as *manifest lists* (OCI index). The tool transparently resolves the list and selects the right platform entry before fetching the actual image manifest.

### Concurrent Download

```
manifest list  →  platform manifest  →  config blob
                                     ↘
                                       layer 1 ─┐
                                       layer 2  │ up to N concurrent
                                       layer 3  │ workers drain a
                                       ...     ─┘ shared queue

  each worker:  HTTP blob stream  →  zlib.gunzip  →  temp file
```

After all layers are downloaded, they are packed sequentially into a single tar using the [Docker Image Specification](https://github.com/moby/moby/blob/master/image/spec/spec.md) format:

```
output.tar
├── manifest.json              # [{Config, RepoTags, Layers}]
├── <config_sha256>.json       # image config (env, cmd, history, …)
└── <layer_digest>/
    ├── layer.tar              # uncompressed filesystem tar
    ├── VERSION                # "1.0"
    └── json                   # minimal legacy metadata
```

### Supported Registries

| Registry | Notes |
|----------|-------|
| Docker Hub (`docker.io`) | Default; search, Hub tags API, anonymous pull |
| Any OCI-compliant registry | Pass full reference, e.g. `ghcr.io/user/repo:tag` |
| Private registries | Use `-u`/`-p` for Basic auth |
