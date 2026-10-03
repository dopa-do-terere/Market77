export type ChildLike = { kill(): void; on(event: "exit", cb: () => void): void };

export type BrowserDeps = {
  spawn(command: string, args: string[]): ChildLike;
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  now(): number;
  log(message: string): void;
};

export type Browser = {
  start(): void;
  stop(): Promise<void>;
  restart(): Promise<void>;
  running(): boolean;
};

const STABLE_AFTER_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
const KILL_WAIT_MS = 5_000;

/** Keeps the kiosk browser alive: relaunches it when it dies by itself, and replaces it on demand. */
export function createBrowser(opts: { command: string; url: string; profileDir: string }, deps: BrowserDeps): Browser {
  let child: ChildLike | null = null;
  let wanted = false;
  let failures = 0;
  let startedAt = 0;
  let retry: unknown = null;
  let chain: Promise<void> | null = null; // in-flight stop/restart; later ones queue behind it

  // Runs fn at once when idle (so kill() is synchronous), otherwise after the previous one.
  function serial(fn: () => Promise<void>): Promise<void> {
    const p = chain === null ? fn() : chain.then(fn);
    const tail: Promise<void> = p.catch(() => {}).then(() => {
      if (chain === tail) chain = null;
    });
    chain = tail;
    return p;
  }

  function launch(): void {
    const c = deps.spawn(opts.command, [
      "--kiosk",
      "--noerrdialogs",
      "--disable-infobars",
      "--no-first-run",
      `--user-data-dir=${opts.profileDir}`,
      opts.url,
    ]);
    child = c;
    startedAt = deps.now();
    c.on("exit", () => {
      if (child !== c) return; // replaced or already handled
      child = null;
      if (!wanted) return;
      if (deps.now() - startedAt >= STABLE_AFTER_MS) failures = 0;
      failures += 1;
      const wait = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (failures - 1));
      deps.log(`browser exited, relaunching in ${wait} ms`);
      retry = deps.schedule(() => {
        retry = null;
        if (wanted && child === null) launch();
      }, wait);
    });
  }

  async function stopChild(): Promise<void> {
    const old = child;
    child = null;
    if (retry !== null) {
      deps.cancel(retry);
      retry = null;
    }
    if (old === null) return;
    await new Promise<void>((resolve) => {
      let timer: unknown = null;
      const done = () => {
        if (timer !== null) deps.cancel(timer);
        resolve();
      };
      old.on("exit", done);
      // no SIGKILL after the wait: we give up and move on, a stuck process is left to the OS
      timer = deps.schedule(done, KILL_WAIT_MS);
      old.kill();
    });
  }

  return {
    start() {
      wanted = true;
      failures = 0;
      if (child === null) launch();
    },
    stop() {
      wanted = false;
      return serial(stopChild);
    },
    restart() {
      wanted = true;
      failures = 0;
      return serial(async () => {
        await stopChild();
        if (wanted && child === null) launch(); // stop() may have landed while we waited
      });
    },
    running: () => child !== null,
  };
}
