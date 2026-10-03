import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createApi } from "./api.ts";
import { createBrowser } from "./browser.ts";
import { parseConfig } from "./config.ts";
import { HEARTBEAT_MS, createAgent } from "./loop.ts";
import { applyUpdate, confirmBoot, extractTar } from "./update.ts";

// "node main.ts --check" only proves the files load under Node's type stripping (tests and install.sh use it).
if (process.argv[2] === "--check") {
  console.log("ok");
  process.exit(0);
}

const run = promisify(execFile);
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const baseDir = process.env.M77_BASE ?? "/opt/market77";

const config = parseConfig(await readFile(join(baseDir, "config.json"), "utf8"));
const version = (await readFile(new URL("./VERSION", import.meta.url), "utf8")).trim();
const api = createApi(config);

const browser = createBrowser(
  {
    command: config.browserCommand,
    url: `${config.serverUrl}/pdv#token=${config.token}`,
    // Not hidden on purpose: the snap Chromium (Ubuntu default) cannot write dotdirs in $HOME (snap home interface).
    profileDir: join(homedir(), "market77-pdv"),
  },
  {
    spawn: (command, args) => {
      const child = spawn(command, args, { stdio: "ignore" });
      return {
        kill: () => {
          child.kill();
        },
        on: (_event, cb) => {
          child.on("exit", () => cb());
          child.on("error", () => cb()); // for example a missing browser binary
        },
      };
    },
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
    now: () => Date.now(),
    log,
  },
);

const agent = createAgent({
  api,
  browser,
  version,
  sleep,
  log,
  system: {
    reboot: async () => {
      await run("sudo", ["-n", "systemctl", "reboot"]);
    },
    exit: () => process.exit(0),
  },
  update: {
    apply: (v, sha256) =>
      applyUpdate(
        {
          baseDir,
          currentVersion: version,
          download: (x) => api.downloadRelease(x),
          extract: extractTar,
          nowSeconds: () => Math.floor(Date.now() / 1000),
        },
        v,
        sha256,
      ),
    confirmBoot: () => confirmBoot(baseDir),
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    browser.stop().finally(() => process.exit(0));
  });
}

browser.start();
log(`market77 agent ${version} started`);
for (;;) {
  let delay = HEARTBEAT_MS;
  try {
    delay = await agent.tick();
  } catch (e) {
    log(`tick failed: ${String(e)}`);
  }
  await sleep(delay);
}
