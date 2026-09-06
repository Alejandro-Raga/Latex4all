# Contributing to Latex4All

Contributions are welcome! This guide covers the development environment, workflow, and testing.

## Development Environment

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10+
- [Rust](https://rustup.rs/) (stable)
- Platform-specific native dependencies (required by [Tectonic](https://tectonic-typesetting.github.io/)):
  - **macOS:** `brew install icu4c harfbuzz pkg-config`
  - **Linux:** `apt install libicu-dev libgraphite2-dev libharfbuzz-dev libfreetype-dev libfontconfig-dev libwebkit2gtk-4.1-dev libappindicator3-dev`
  - **Windows:** Visual Studio Build Tools (C++ workload) + vcpkg — see detailed steps below

#### Windows Setup (PowerShell)

```powershell
# 1. Install Visual Studio Build Tools (if not already installed)
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

# 2. Install vcpkg
git clone https://github.com/microsoft/vcpkg.git C:\vcpkg
C:\vcpkg\bootstrap-vcpkg.bat

# 3. Set environment variables (persistent)
[Environment]::SetEnvironmentVariable("VCPKG_ROOT", "C:\vcpkg", "User")
$path = [Environment]::GetEnvironmentVariable("PATH", "User")
[Environment]::SetEnvironmentVariable("PATH", "$path;C:\vcpkg", "User")
[Environment]::SetEnvironmentVariable("TECTONIC_DEP_BACKEND", "vcpkg", "User")

# 4. Restart PowerShell, then install native libraries (~10-20 min)
vcpkg install harfbuzz[graphite2]:x64-windows freetype:x64-windows icu:x64-windows fontconfig:x64-windows
```

### Setup

```bash
git clone https://github.com/Alejandro-Raga/Latex4all.git
cd Latex4all
pnpm install
```

The dictionary/thesaurus is backed by the Princeton WordNet 3.1 database, which
is ~27 MB and therefore not committed. `pnpm dev:desktop` and `pnpm build:desktop`
fetch it automatically (and skip when it's already present); CI does the same. To
fetch it by hand:

```bash
node scripts/fetch-wordnet.mjs
```

### Run

```bash
pnpm dev:desktop
```

### Build

```bash
pnpm build:desktop
```

### Building installers in CI

The **Build Desktop** workflow produces the installers for every platform.
Running it from the Actions tab (`workflow_dispatch`) takes a `platforms`
choice, so a fork can build just Windows without needing Apple signing
credentials. Leave `release_tag` empty for an artifact-only build; the Windows
installer lands in the `desktop-windows` artifact.

Two secrets are optional:

- `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — only
  needed for auto-updater artifacts. Without them the build still produces a
  working installer, just no updater bundle.
- `ZOTERO_CONSUMER_KEY` / `ZOTERO_CONSUMER_SECRET` — only enable Zotero's
  one-click OAuth button. Without them, users connect with a personal API key
  from [zotero.org/settings/keys](https://www.zotero.org/settings/keys).

## Project Structure

```
Latex4all/
├── apps/
│   └── desktop/              # Tauri desktop app
│       ├── src/              # React frontend (TypeScript)
│       └── src-tauri/        # Rust backend
│           ├── src/
│           │   ├── lib.rs           # Tauri plugin registration
│           │   ├── history.rs       # Git-based version history
│           │   ├── latex.rs         # Tectonic compilation & SyncTeX
│           │   ├── claude.rs        # Claude CLI integration & sessions
│           │   ├── slash_commands.rs # Slash command discovery & CRUD
│           │   ├── dictionary.rs    # Word lookup (macOS Dictionary Services / WordNet)
│           │   ├── wordnet.rs       # Bundled WordNet 3.1 reader (all platforms)
│           │   ├── spellcheck.rs    # NSSpellChecker (macOS) / ISpellChecker (Windows)
│           │   ├── languagetool.rs  # Local grammar server install & supervision
│           │   └── zotero.rs        # Zotero OAuth & citations
│           └── Cargo.toml
├── .github/workflows/        # CI/CD (build + release)
├── biome.json                # Linter config
└── turbo.json                # Turborepo config
```

## Testing

### Frontend (Vitest)

```bash
cd apps/desktop && pnpm test

# Watch mode
cd apps/desktop && pnpm test:watch
```

### Rust

```bash
cd apps/desktop/src-tauri && cargo test
```

Current test counts:
- **Frontend:** 212 tests (stores, components)
- **Rust:** 254 tests (unit + integration)

### What to test

- **Unit tests:** Pure functions, parsers, data transformations
- **Integration tests:** Filesystem/git operations using `tempfile` crate for isolation
- Tests live in `#[cfg(test)] mod tests` blocks within each source file (modules are private)

### Adding Rust integration tests

Use `tempfile::TempDir` for tests that touch the filesystem or git:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_example() {
        let dir = TempDir::new().unwrap();
        // ... test with dir.path() ...
    }

    #[tokio::test]
    async fn test_async_example() {
        // For async Tauri commands that don't need the runtime
    }
}
```

## Code Style

This project uses [Biome](https://biomejs.dev/) for TypeScript/React linting and formatting.

```bash
pnpm lint          # check
pnpm lint:fix      # auto-fix
```

Rust code follows standard `rustfmt` conventions.

### Pre-commit Hook

A [Husky](https://typicode.github.io/husky/) pre-commit hook runs automatically on every commit. It checks and auto-fixes staged files via `biome check --staged --write`, so lint issues are caught before they reach the repository.

The hook is set up automatically when you run `pnpm install`.

### CI

A GitHub Actions workflow runs `biome ci` on every pull request and push to `main`. PRs that fail lint checks cannot be merged.

## Releases and update channels

The app updates itself through the Tauri updater. There are two channels; the
user picks one on first launch and can switch under Settings → Updates.

| Channel   | Feed                  | Published by                        | Release on GitHub               |
|-----------|-----------------------|-------------------------------------|---------------------------------|
| `release` | `latest.json`         | pushing a `v*` tag                  | draft, published by hand        |
| `test`    | `latest-test.json`    | pushing to the `testing` branch     | `testing-latest`, prerelease    |

The release channel reads `releases/latest/...`, which GitHub resolves to the
newest **non-prerelease** tag — so marking test builds as prereleases is what
keeps them invisible to release-channel users.

Test builds cover Windows and macOS (Apple Silicon) only; macOS Intel and Linux
are skipped there.

### Required repository secrets

Without `TAURI_SIGNING_PRIVATE_KEY` the build falls back to
`tauri.local-build.conf.json`, which sets `createUpdaterArtifacts: false`. That
produces installers with no `.sig` files, the publish job's `if (WIN_SIG)`
guards skip every platform, and the manifest ships as `{"platforms": {}}` —
an updater that silently offers nothing. Both secrets must be set:

- `TAURI_SIGNING_PRIVATE_KEY` — contents of the minisign private key
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — its password (empty if generated without one)

The matching public key lives in `tauri.conf.json` under `plugins.updater.pubkey`.
Changing the keypair invalidates every already-installed copy of the app: the old
pubkey is compiled in, so those installs reject the new signatures and must be
reinstalled by hand once.

### Test-channel versioning

`scripts/stamp-test-version.mjs` rewrites the version to
`<major>.<minor>.<CI run number>` before a testing-branch build. Without it every
test build would report the same version as the last release and the updater
would never see anything newer. Run numbers only increase, so test builds climb
monotonically.

Because test versions outrun real releases (a test build might be `1.3.57` while
the newest release is `1.3.0`), moving a machine from `test` back to `release`
needs a manual reinstall — the release channel will not offer what looks to it
like a downgrade.

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run tests: `pnpm test` (frontend) and `cargo test` (Rust)
5. Commit — the pre-commit hook will auto-fix lint issues on staged files
6. Push to your fork and open a PR
7. CI will verify lint and tests pass

### Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Usage |
|--------|-------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation |
| `test:` | Adding or updating tests |
| `refactor:` | Code refactoring |
| `ci:` | CI/CD changes |
| `chore:` | Maintenance tasks |
