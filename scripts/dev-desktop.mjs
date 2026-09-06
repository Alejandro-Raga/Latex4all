import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const env = { ...process.env };

function appendEnvFlag(name, flag) {
  const current = env[name] ?? "";
  env[name] = current.includes(flag)
    ? current
    : [current, flag].filter(Boolean).join(" ");
}

if (process.platform === "win32") {
  env.VCPKG_ROOT ||= join(env.USERPROFILE ?? "", "vcpkg");
  env.TECTONIC_DEP_BACKEND = "vcpkg";
  env.VCPKGRS_TRIPLET = "x64-windows-static-release";
  env.VCPKG_DEFAULT_TRIPLET = env.VCPKGRS_TRIPLET;
  appendEnvFlag("RUSTFLAGS", "-Ctarget-feature=+crt-static");
  env.CXXFLAGS = [env.CXXFLAGS, "/std:c++17"].filter(Boolean).join(" ");
}

// The bundled WordNet database (see wordnet.rs) is ~27 MB and isn't committed,
// so make sure it's on disk before Tauri tries to bundle it as a resource.
// The fetch script is a no-op once the files are present.
const wordnet = spawnSync(
  process.execPath,
  [join(fileURLToPath(new URL(".", import.meta.url)), "fetch-wordnet.mjs")],
  { stdio: "inherit" },
);
if (wordnet.status !== 0) {
  process.exit(wordnet.status ?? 1);
}

const child =
  process.platform === "win32"
    ? spawn(
        process.env.ComSpec ?? "cmd.exe",
        [
          "/d",
          "/s",
          "/c",
          "corepack pnpm --filter=@latex4all/desktop tauri dev",
        ],
        {
          env,
          stdio: "inherit",
        },
      )
    : spawn("pnpm", ["--filter=@latex4all/desktop", "tauri", "dev"], {
        env,
        stdio: "inherit",
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
