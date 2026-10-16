#!/usr/bin/env node
/**
 * M19 S4 review fix (P2) — real-browser regression test for the signed-out
 * mobile header's reading order.
 *
 * The defect it pins (GitHub Codex, PR #27, `src/components/shared/MobileHeader.tsx:39`):
 * at 320px with 200% base text the compact nav used to be `flex-1`, so it sat on
 * the header's first line with a near-zero basis and wrapped its own links into a
 * narrow column while the sign-in control kept sharing that line. The rendered
 * reading order became `Fit40 / Programs · Sign in / Exercises` while the DOM and
 * the keyboard order stayed `Fit40 → Programs → Exercises → Sign in`.
 *
 * This test never reads JSX or class names to decide the order. It renders the
 * production build in real Chrome, walks the header with real Tab key presses
 * (`Input.dispatchKeyEvent`), measures every destination's bounding box, and
 * fails unless the DOM order, the keyboard focus order and the measured visual
 * order are identical — at 320, 375 and 393px with 100%, 150% and 200% text.
 * It also guards what must survive the fix: full (untruncated) labels, ≥44px
 * touch targets, a visible focus ring, no header horizontal overflow, and the
 * single 64px row at the default text size.
 *
 * Usage:
 *   npm run test:e2e                              (boots `next start`; build first)
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e
 *   CHROME_PATH=/path/to/chrome npm run test:e2e   (non-standard browser location)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sleep } from './support/cdp.mjs';
import {
  findChrome,
  freePort,
  openPage,
  startChrome,
  startServer,
  stopChrome,
  stopProcess,
} from './support/browser.mjs';
import { MATRIX, checkCombo } from './support/mobile-header-order.mjs';
import { assertWebsocketTransport } from './support/websocket.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGE_PATH = '/programs'; // public catalog: the signed-out mobile header renders here

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error(
      'E2E: no Chrome/Chromium binary found. Install Chrome, or set CHROME_PATH, to run this test.',
    );
    process.exitCode = 1;
    return;
  }

  // Explicit runtime compatibility check (M19 S4 review fix, P2): the CDP
  // client must have a usable WebSocket on every Node version this project
  // supports, including Node 20.9 where the global `WebSocket` does not exist.
  let transport;
  try {
    transport = assertWebsocketTransport();
  } catch (error) {
    console.error(`E2E: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const rows = [];
  const findings = [];
  const debugPort = await freePort();
  let server = null;
  let browser = null;
  let client = null;

  try {
    let baseUrl = process.env.E2E_BASE_URL;
    if (!baseUrl) {
      const port = await freePort();
      server = await startServer(port, REPO_ROOT);
      baseUrl = `http://127.0.0.1:${port}`;
    }

    browser = await startChrome(chromePath, debugPort);
    client = await openPage(debugPort);
    await client.setViewport(MATRIX[0].width, 820);
    const loaded = client.waitFor('Page.loadEventFired');
    await client.send('Page.navigate', { url: `${baseUrl}${PAGE_PATH}` });
    await loaded;
    await sleep(700);

    for (const combo of MATRIX) {
      const row = await checkCombo(client, combo);
      rows.push(row);
      findings.push(...row.findings);
    }
  } finally {
    client?.close();
    await stopChrome(browser);
    stopProcess(server);
  }

  console.log('M19 S4 review fix (P2) — mobile header reading order, real Chrome');
  console.log(`  page ${PAGE_PATH} · browser ${chromePath}`);
  console.log(`  transport ${transport.label} · Node ${process.version}`);
  for (const row of rows) {
    console.log(
      `  ${row.combo.padEnd(14)} visual order: ${row.order} · ${row.lines} row(s), header ${row.headerHeight}px`,
    );
  }

  if (findings.length === 0) {
    console.log(`\nOK — ${rows.length}/${MATRIX.length} viewport/text combinations passed.`);
    return;
  }
  console.error(`\nFAILED — ${findings.length} assertion(s):`);
  for (const finding of findings) {
    console.error(`  · ${finding}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});