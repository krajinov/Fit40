/**
 * Real-browser lifecycle for the Fit40 E2E layer (M19 S4 review fix, P2).
 *
 * Fit40 has no installed E2E runner: the `tests/e2e/` folder exists and
 * `docs/testing.md` points at Playwright, but neither Playwright nor its
 * browsers are dependencies of this repository and `AGENTS.md` forbids adding a
 * library without explicit approval. This module therefore drives the real
 * Chrome already installed on the machine over the Chrome DevTools Protocol —
 * the same technique the S4 browser evidence used.
 *
 * It picks a free port, boots the production server, launches headless Chrome
 * and opens a page target. The protocol client lives in `./cdp.mjs`.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { connect, sleep } from './cdp.mjs';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

/** Absolute path of the browser to drive, or null when none is installed. */
export function findChrome() {
  if (process.env.CHROME_PATH) {
    return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  }
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Nothing is listening yet; retry until the deadline.
    }
    await sleep(200);
  }
  return false;
}

/** Boots `next start` for an already-built app and waits for the first 200. */
export async function startServer(port, repoRoot) {
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: repoRoot,
    stdio: 'ignore',
    // Its own process group, so the whole `npx` → `next` tree can be stopped.
    detached: true,
  });
  if (await waitForHttp(`http://127.0.0.1:${port}/programs`, 60_000)) {
    return child;
  }
  stopProcess(child);
  throw new Error(
    `the production server never answered on :${port} — run \`npm run build\` before \`npm run test:e2e\``,
  );
}

/** Stops a detached child and everything it spawned, without ever throwing. */
export function stopProcess(child) {
  if (!child?.pid) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/** Launches headless Chrome with the DevTools protocol enabled. */
export async function startChrome(executable, debugPort) {
  const profile = path.join(os.tmpdir(), `fit40-e2e-chrome-${debugPort}`);
  rmSync(profile, { recursive: true, force: true });
  const child = spawn(
    executable,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  if (await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 30_000)) {
    return { child, profile };
  }
  child.kill('SIGKILL');
  throw new Error('headless Chrome did not expose its DevTools endpoint');
}

/** Stops Chrome and removes its throwaway profile; never fails the run. */
export async function stopChrome(browser) {
  if (!browser) {
    return;
  }
  browser.child.kill('SIGKILL');
  // Chrome keeps writing to the profile for a moment after the signal.
  await sleep(300);
  try {
    rmSync(browser.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A leftover temp profile is harmless; it must never fail an assertion run.
  }
}

/** Opens a blank page target and returns a connected protocol client. */
export async function openPage(debugPort) {
  const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
    method: 'PUT',
  });
  const target = await created.json();
  const client = await connect(target.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  return client;
}