import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const WATCH_DEBOUNCE_MS = 500;
export const WATCH_FALLBACK_MS = 4000;

const NOISE_FILE = /^(?:\.DS_Store|Thumbs\.db)$/i;
const NOISE_EXT = /\.(?:tmp|temp|part|crdownload|download)$/i;

export function shouldIgnoreWatchName(name: string | null): boolean {
  if (name === null || name === "") return false;
  for (const part of name.split(/[\\/]/)) {
    if (part === "" || part === ".") continue;
    if (NOISE_FILE.test(part) || part.startsWith("._")) return true;
    if (part === "node_modules" || part === ".git") return true;
    if (NOISE_EXT.test(part) || part.startsWith("~")) return true;
  }
  return false;
}

export function createDebounced(run: () => void, waitMs: number): {
  trigger: () => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    trigger() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, waitMs);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export function startWorkspaceWatch(options: {
  workspaceRoot: string;
  overlayPath: string;
  onChange: () => void;
  debounceMs?: number;
  fallbackMs?: number;
  watchFileSystem?: typeof watch;
  fingerprint?: (workspaceRoot: string, overlayPath: string) => Promise<string>;
}): { ready: Promise<void>; close: () => void } {
  const debounce = createDebounced(options.onChange, options.debounceMs ?? WATCH_DEBOUNCE_MS);
  const watchers: FSWatcher[] = [];
  const watchFileSystem = options.watchFileSystem ?? watch;
  const fingerprintOf = options.fingerprint ?? workspaceFingerprint;

  let closed = false;
  let polling = false;
  let fingerprint: string | undefined;
  let fallback: ReturnType<typeof setInterval> | undefined;
  let startupCheck: ReturnType<typeof setTimeout> | undefined;
  let ready = Promise.resolve();
  const poll = async (): Promise<void> => {
    if (closed || polling) return;
    polling = true;
    try {
      const next = await fingerprintOf(options.workspaceRoot, options.overlayPath);
      if (fingerprint !== undefined && next !== fingerprint) debounce.trigger();
      fingerprint = next;
    } finally {
      polling = false;
    }
  };
  const startFallback = (): void => {
    if (closed || fallback !== undefined) return;
    if (startupCheck !== undefined) clearTimeout(startupCheck);
    ready = poll();
    fallback = setInterval(() => { void poll(); }, options.fallbackMs ?? WATCH_FALLBACK_MS);
    fallback.unref?.();
  };

  const attach = (
    path: string,
    recursive: boolean,
    accept?: (filename: string | null) => boolean,
    onError?: () => void,
  ): boolean => {
    try {
      const watcher = watchFileSystem(path, { persistent: false, recursive }, (_event, filename) => {
        const name = typeof filename === "string" ? filename : null;
        if (accept !== undefined && !accept(name)) return;
        if (shouldIgnoreWatchName(name)) return;
        debounce.trigger();
      });
      watcher.on("error", () => { onError?.(); });
      watchers.push(watcher);
      return true;
    } catch {
      return false;
    }
  };

  const recursiveWorkspaceWatch = attach(options.workspaceRoot, true, undefined, startFallback);
  attach(options.workspaceRoot, false);
  const overlayName = basename(options.overlayPath);
  const overlayWatch = attach(
    dirname(options.overlayPath),
    false,
    (filename) => filename === null || filename === overlayName,
    startFallback,
  );
  if (!recursiveWorkspaceWatch || !overlayWatch) {
    startFallback();
  } else {
    ready = poll();
    void ready.then(() => {
      if (closed || fallback !== undefined) return;
      startupCheck = setTimeout(() => {
        startupCheck = undefined;
        void poll();
      }, options.fallbackMs ?? WATCH_FALLBACK_MS);
      startupCheck.unref?.();
    });
  }

  return {
    ready,
    close() {
      closed = true;
      debounce.cancel();
      if (fallback !== undefined) clearInterval(fallback);
      if (startupCheck !== undefined) clearTimeout(startupCheck);
      for (const watcher of watchers) watcher.close();
    },
  };
}

async function workspaceFingerprint(workspaceRoot: string, overlayPath: string): Promise<string> {
  const rows: string[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (shouldIgnoreWatchName(relative)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path, relative);
        continue;
      }
      const info = await stat(path).catch(() => undefined);
      if (info !== undefined) rows.push(`${relative}:${info.size}:${info.mtimeMs}`);
    }
  };
  await visit(workspaceRoot, "");
  const overlay = await stat(overlayPath).catch(() => undefined);
  rows.push(`overlay:${overlay?.size ?? -1}:${overlay?.mtimeMs ?? -1}`);
  return rows.join("|");
}
