#!/usr/bin/env bun
// Regenerates docs/screenshot.png: a fixture repo from this repo's history, a review seeded via the API, headless Chromium over CDP.
//   bun scripts/screenshot.ts [--no-build] [--keep] [--out <path>] [--port <n>] [--browser <path>] [--width <n>] [--height <n>] [--scale <n>]
// --keep leaves the seeded server running and skips the capture, for framing a shot by hand.

import { $ } from "bun";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

// The fixture commit spans Go and TypeScript, and its useReview.ts changes are mostly *modified* lines — what puts the word-level shading in shot.
const FIXTURE_SHA = "ada5041";
const FIXTURE_BRANCH = "repo-picker-order";
const FIXTURE_REPO = "local-review";

const FRAME_FILE = "web/src/useReview.ts";

// Never the default port or data dir: a real instance is usually on 7777, and a seeding POST would write into its reviews.
const DEFAULT_PORT = 7793;

// The CSS viewport is the framing; the scale factor is only pixel density.
const VIEWPORT = { width: 1920, height: 1080, scale: 2 };

const CHROMIUMS = [
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/brave-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const port = Number(value("--port", String(DEFAULT_PORT)));
const outPath = value("--out", join(REPO_ROOT, "docs/screenshot.png"));
const keep = flag("--keep");

if (port === 7777) {
  console.error("refusing to use port 7777 — that's where a real instance lives");
  process.exit(1);
}

const api = `http://127.0.0.1:${port}`;

async function main() {
  if (!flag("--no-build")) await build();

  const tmp = mkdtempSync(join(tmpdir(), "lr-shot-"));
  const root = join(tmp, "repos");
  const dataDir = join(tmp, "data");
  const server = { proc: null as ReturnType<typeof Bun.spawn> | null };

  try {
    await fixture(root);
    server.proc = await startServer(root, dataDir);
    const reviewID = await seed();

    if (keep) {
      console.log(`\nseeded review ${reviewID} — open ${api} and capture by hand`);
      console.log("ctrl-c to tear down\n");
      await server.proc.exited;
      return;
    }

    await capture(tmp);
    console.log(`wrote ${outPath}`);
  } finally {
    server.proc?.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function build() {
  console.log("==> building frontend");
  await $`bun install --cwd web`.cwd(REPO_ROOT).quiet();
  await $`bun run --cwd web build`.cwd(REPO_ROOT).quiet();
  console.log("==> building binary");
  await $`go build -o local-review .`.cwd(REPO_ROOT);
}

async function fixture(root: string) {
  console.log(`==> building fixture repo at ${FIXTURE_SHA}`);
  const dest = join(root, FIXTURE_REPO);
  await $`mkdir -p ${root}`.quiet();
  await $`git clone --quiet --no-hardlinks ${REPO_ROOT} ${dest}`.quiet();
  // main sits at the commit's parent so the merge-base is the commit itself: the review is exactly its diff.
  await $`git -C ${dest} checkout -q -B main ${FIXTURE_SHA}~1`.quiet();
  await $`git -C ${dest} checkout -q -b ${FIXTURE_BRANCH} ${FIXTURE_SHA}`.quiet();
  // origin/main points at today's HEAD and would outrank the local trunk we just moved.
  await $`git -C ${dest} remote remove origin`.quiet();
}

async function startServer(root: string, dataDir: string) {
  console.log(`==> starting local-review on :${port}`);
  const proc = Bun.spawn(
    [join(REPO_ROOT, "local-review"), "-root", root, "-port", String(port), "-data-dir", dataDir, "-no-open"],
    { stdout: "pipe", stderr: "pipe" }
  );

  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`server exited: ${err.trim()}`);
    }
    try {
      const repos = await (await fetch(`${api}/api/repos`)).json();
      const names = (repos.repos ?? []).map((r: { name: string }) => r.name);
      // A stray instance that won the port would be serving real repos.
      if (names.length !== 1 || names[0] !== FIXTURE_REPO) {
        throw new Error(`:${port} is serving ${JSON.stringify(names)}, not our fixture`);
      }
      return proc;
    } catch (e) {
      if (e instanceof Error && e.message.includes("not our fixture")) throw e;
    }
    await Bun.sleep(100);
  }
  throw new Error(`server did not answer on :${port}`);
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${api}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : await res.json();
}

async function seed() {
  console.log("==> seeding the review");
  // Base omitted so the server resolves it as the browser will; the review is keyed on (repo, base, head).
  const review = await post("/api/reviews", { repo: FIXTURE_REPO, head: FIXTURE_BRANCH });
  const id = review.id;

  await post(`/api/reviews/${id}/summary`, {
    summary:
      "Good change — dating a repo by its reflog mtime is the right trade, and keeping the order day-granular is what makes it stable enough to be worth having.\n\nOne thing I want settled before this merges: the DST rounding in `relativeDay`. The rest is questions rather than blockers.",
  });

  // The framed thread: first, so it reads as the opening question, and short enough to fit in frame with its reply.
  const c1 = await post(`/api/reviews/${id}/comments`, {
    filePath: "web/src/useReview.ts",
    startLine: 116,
    endLine: 116,
    type: "question",
    author: "reviewer",
    body: "If the remembered repo is gone from the root, this drops to whichever repo now sorts first — and with the new ordering that's a different one than it used to be. Worth telling the user?",
  });
  await post(`/api/comments/${c1.id}/replies`, {
    author: "agent",
    body: "It always fell back to the first repo; what changed is which one that is. The picker names it and now shows the date it was ordered on (#2), so the switch is visible — happy to make it explicit if you'd rather.",
  });

  await post(`/api/reviews/${id}/comments`, {
    filePath: "web/src/time.ts",
    startLine: 47,
    endLine: 47,
    type: "bug",
    author: "correctness-review-agent",
    body: "Across a DST boundary two local midnights are 23 or 25 hours apart, so this division isn't whole — `Math.round` is what absorbs it. Worth stating, since a later \"simplification\" to `Math.floor` would shift every date by one on those two days a year.",
  });

  const c3 = await post(`/api/reviews/${id}/comments`, {
    filePath: "internal/api/api.go",
    startLine: 77,
    endLine: 79,
    type: "suggestion",
    author: "design-review-agent",
    body: "One `os.Stat` per entry, on the endpoint the picker hits every load. Fine at tens of repos — worth knowing if a root ever holds hundreds.",
  });
  await post(`/api/comments/${c3.id}/replies`, {
    author: "agent",
    body: "Measured at 200 repos: 4ms total. Leaving it — the alternative is caching that has to be invalidated by the same filesystem watch.",
  });
  await post(`/api/comments/${c3.id}/resolved`, { resolved: true });

  const c4 = await post(`/api/reviews/${id}/comments`, {
    filePath: "web/src/types.ts",
    startLine: 6,
    endLine: 6,
    type: "nit",
    author: "reviewer",
    body: "Empty-string-as-absent works, but the comment is carrying the contract. Would `lastActivity?: string` say it in the type instead?",
  });
  await post(`/api/comments/${c4.id}/replies`, {
    author: "agent",
    body: "The Go side always emits the field, so an optional would make every consumer handle an `undefined` the server can't produce. Kept as `\"\"`.",
  });

  await post(`/api/reviews/${id}/reviewed`, {
    filePaths: ["web/src/api.ts", "web/src/time.test.ts", "internal/api/api_test.go"],
    reviewed: true,
  });

  return id;
}

function chromium() {
  const override = value("--browser", process.env.CHROME ?? "");
  if (override) {
    if (!existsSync(override)) throw new Error(`no browser at ${override}`);
    return override;
  }
  const found = CHROMIUMS.find((p) => existsSync(p));
  if (!found) throw new Error(`no Chromium-based browser found; pass --browser <path>`);
  return found;
}

async function capture(tmp: string) {
  console.log("==> capturing");
  const profile = join(tmp, "browser");
  const browser = Bun.spawn(
    [
      chromium(),
      "--headless=new",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdout: "pipe", stderr: "pipe" }
  );

  try {
    const devPort = await devtoolsPort(join(profile, "DevToolsActivePort"));
    const targets = await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json();
    const page = targets.find((t: { type: string }) => t.type === "page");
    if (!page) throw new Error("no page target");

    const cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    // The stored preference is "system", so the emulated media query is what resolves dark before first paint.
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    const width = Number(value("--width", String(VIEWPORT.width)));
    const height = Number(value("--height", String(VIEWPORT.height)));
    const scale = Number(value("--scale", String(VIEWPORT.scale)));
    console.log(`    ${width}×${height} at ${scale}× → ${width * scale}×${height * scale}`);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: scale,
      mobile: false,
    });

    await cdp.send("Page.navigate", { url: api });
    await settled(cdp);
    await frameThread(cdp);

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await Bun.write(outPath, Buffer.from(shot.data, "base64"));
    cdp.close();
  } finally {
    browser.kill();
  }
}

async function evaluate(cdp: Cdp, expression: string) {
  const res = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
  return res.result?.value;
}

async function frameThread(cdp: Cdp) {
  const card = `document.getElementById(${JSON.stringify(`file-${FRAME_FILE}`)})`;

  if (!(await evaluate(cdp, `!!${card} && (${card}.scrollIntoView({ block: "start" }), true)`))) {
    throw new Error(`no file card for ${FRAME_FILE}`);
  }

  // LazyFile mounts a card only near the viewport, so the thread exists only after the scroll above.
  let mounted = false;
  for (let i = 0; i < 50 && !mounted; i++) {
    await Bun.sleep(100);
    mounted = await evaluate(cdp, `!!${card}?.querySelector(".thread")`);
  }
  if (!mounted) throw new Error(`no thread rendered in ${FRAME_FILE}`);

  // Should already be in Changed view; correct it rather than assume, and say what it was.
  const was = await evaluate(
    cdp,
    `(() => {
      const mode = ${card}.dataset.viewMode;
      if (mode !== "changed") {
        [...${card}.querySelectorAll("button")]
          .find((b) => b.textContent.trim() === "Changed")
          ?.click();
      }
      return mode ?? "(none)";
    })()`
  );
  console.log(`    view mode was ${was}`);
  await settled(cdp);

  // Centre only once the rows are final: switching view moves everything below.
  if (!(await evaluate(cdp, `!!${card}.querySelector(".thread") &&
    (${card}.querySelector(".thread").scrollIntoView({ block: "center", behavior: "instant" }), true)`))) {
    throw new Error(`thread in ${FRAME_FILE} vanished before framing`);
  }
  await settled(cdp);
}

async function devtoolsPort(file: string) {
  for (let i = 0; i < 100; i++) {
    if (existsSync(file)) {
      const port = readFileSync(file, "utf8").split("\n")[0]?.trim();
      if (port) return port;
    }
    await Bun.sleep(100);
  }
  throw new Error("browser never reported a devtools port");
}

interface Cdp {
  send: (method: string, params?: object) => Promise<any>;
  close: () => void;
}

function connect(url: string): Promise<Cdp> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
    let nextID = 1;

    ws.onerror = () => reject(new Error("devtools socket failed"));
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data));
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.error) waiter.fail(new Error(`${msg.error.message}`));
      else waiter.ok(msg.result);
    };
    ws.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((ok, fail) => {
            const id = nextID++;
            pending.set(id, { ok, fail });
            ws.send(JSON.stringify({ id, method, params }));
          }),
        close: () => ws.close(),
      });
  });
}

// Shiki tokenizes async and fetches grammars lazily, so wait for the token count to stop moving, not a delay.
async function settled(cdp: Cdp) {
  const probe = `JSON.stringify({
    files: document.querySelectorAll(".file").length,
    tokens: document.querySelectorAll(".diff .line-content span").length,
    threads: document.querySelectorAll(".thread").length,
    fonts: document.fonts.status,
  })`;

  let last = "";
  let stable = 0;
  for (let i = 0; i < 150; i++) {
    await Bun.sleep(200);
    const res = await cdp.send("Runtime.evaluate", { expression: probe, returnByValue: true });
    const seen = res.result?.value ?? "";
    const state = seen ? JSON.parse(seen) : {};
    if (state.files > 0 && state.tokens > 0 && state.fonts === "loaded" && seen === last) {
      if (++stable >= 3) return;
    } else {
      stable = 0;
    }
    last = seen;
  }
  throw new Error(`page never settled (last saw ${last || "nothing"})`);
}

await main();
