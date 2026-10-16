/**
 * The mobile-header reading-order assertions (M19 S4 review fix, P2).
 *
 * Everything here reads the RENDERED page, never the JSX: positions come from
 * `getBoundingClientRect`, and the focus sequence comes from dispatching real
 * Tab key presses through the DevTools protocol.
 */
import { sleep } from './cdp.mjs';

/** DOM order, keyboard order and reading order must all be exactly this. */
export const EXPECTED_ORDER = ['/', '/programs', '/exercises', '/login'];

const EXPECTED_LABELS = {
  '/': 'Fit40',
  '/programs': 'Programs',
  '/exercises': 'Exercises',
  '/login': 'Sign in',
};

/** Destinations that must expose a ≥44px touch target (the wordmark is inline text). */
const TOUCH_TARGETS = ['/programs', '/exercises', '/login'];
const MIN_TOUCH_TARGET = 44;

export const MATRIX = [320, 375, 393].flatMap((width) =>
  [1, 1.5, 2].map((fontScale) => ({ width, fontScale })),
);

/**
 * Measures the *visible* header — the desktop one is `display:none` below `md`,
 * so filtering by computed display avoids any escaped-class selector.
 */
const READ_GEOMETRY = `
 const header = [...document.querySelectorAll('header')].find((h) => getComputedStyle(h).display !== 'none') ?? null;
 if (!header) return null;
 const items = [...header.querySelectorAll('a[href], button')].map((el) => {
   const box = el.getBoundingClientRect();
   return {
     href: el.getAttribute('href'),
     label: el.textContent.trim(),
     left: box.left,
     right: box.right,
     height: box.height,
     centerY: (box.top + box.bottom) / 2,
     truncated: el.scrollWidth > el.clientWidth + 1,
   };
 });
 const headerBox = header.getBoundingClientRect();
 return {
   headerHeight: headerBox.height,
   headerScrollWidth: header.scrollWidth,
   headerClientWidth: header.clientWidth,
   viewportWidth: window.innerWidth,
   items,
 };
`;

/** Lines of the header: items whose vertical centres are within 4px share a line. */
function groupLines(items) {
  const lines = [];
  for (const item of [...items].sort((a, b) => a.centerY - b.centerY)) {
    const line = lines.find((candidate) => Math.abs(candidate.centerY - item.centerY) <= 4);
    if (line) {
      line.items.push(item);
    } else {
      lines.push({ centerY: item.centerY, items: [item] });
    }
  }
  return lines.sort((a, b) => a.centerY - b.centerY);
}

/** The order a sighted user reads the header in: top line first, then left to right. */
function visualOrder(items) {
  return groupLines(items).flatMap((line) => [...line.items].sort((a, b) => a.left - b.left));
}

/**
 * Tabs through the header and returns the destinations in the order they
 * actually received keyboard focus, with their focus-visible state.
 */
async function tabWalk(client) {
  await client.evaluate(`
    window.scrollTo(0, 0);
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    return true;
  `);
  const reached = [];
  for (let i = 0; i < 8 && reached.length < EXPECTED_ORDER.length; i += 1) {
    await client.pressTab();
    const hit = await client.evaluate(`
      const el = document.activeElement;
      const header = el?.closest?.('header');
      if (!el || !header || getComputedStyle(header).display === 'none') return null;
      return {
        href: el.getAttribute('href'),
        focusVisible: el.matches(':focus-visible'),
        boxShadow: getComputedStyle(el).boxShadow,
      };
    `);
    if (hit && !reached.some((entry) => entry.href === hit.href)) {
      reached.push(hit);
    }
  }
  return reached;
}

function sameOrder(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Runs every assertion for one viewport/text-size combination.
 * Returns `{ combo, order, lines, headerHeight, findings }`.
 */
export async function checkCombo(client, combo) {
  const comboLabel = `${combo.width}px @ ${combo.fontScale * 100}%`;
  const findings = [];
  const fail = (name, detail) => findings.push(`${comboLabel} · ${name} — ${detail}`);

  await client.setViewport(combo.width, 820);
  await client.evaluate(
    `document.documentElement.style.fontSize = '${16 * combo.fontScale}px'; window.scrollTo(0, 0); return true;`,
  );
  await sleep(150);

  const geometry = await client.evaluate(READ_GEOMETRY);
  if (!geometry) {
    fail('mobile header', 'not rendered');
    return { combo: comboLabel, order: '—', lines: 0, headerHeight: 0, findings };
  }

  const { items } = geometry;
  const domOrder = items.map((item) => item.href);
  const visual = visualOrder(items).map((item) => item.href);
  const focused = await tabWalk(client);
  const focusOrder = focused.map((entry) => entry.href);

  if (!sameOrder(domOrder, EXPECTED_ORDER)) {
    fail('DOM order', `expected ${EXPECTED_ORDER.join(' → ')}, measured ${domOrder.join(' → ')}`);
  }
  if (!sameOrder(focusOrder, EXPECTED_ORDER)) {
    fail(
      'keyboard focus order',
      `expected ${EXPECTED_ORDER.join(' → ')}, measured ${focusOrder.join(' → ')}`,
    );
  }
  if (!sameOrder(visual, EXPECTED_ORDER)) {
    fail(
      'measured visual order',
      `expected ${EXPECTED_ORDER.join(' → ')}, measured ${visual.join(' → ')}`,
    );
  }
  if (!sameOrder(focusOrder, visual)) {
    fail(
      'keyboard order matches visual order',
      `keyboard ${focusOrder.join(' → ')} vs visual ${visual.join(' → ')}`,
    );
  }

  for (const item of items) {
    if (item.label !== EXPECTED_LABELS[item.href] || item.truncated) {
      fail(
        `label "${EXPECTED_LABELS[item.href] ?? item.href}"`,
        `rendered "${item.label}" (truncated: ${item.truncated})`,
      );
    }
  }

  for (const href of TOUCH_TARGETS) {
    const height = Math.round(items.find((item) => item.href === href)?.height ?? 0);
    if (height < MIN_TOUCH_TARGET) {
      fail(`touch target ${href}`, `height ${height}px < ${MIN_TOUCH_TARGET}px`);
    }
  }

  for (const entry of focused) {
    if (!entry.focusVisible || !entry.boxShadow.includes('3px')) {
      fail(
        `focus ring ${entry.href}`,
        `focus-visible=${entry.focusVisible}, box-shadow=${entry.boxShadow}`,
      );
    }
  }

  const maxItemRight = Math.max(...items.map((item) => item.right));
  if (
    geometry.headerScrollWidth > geometry.headerClientWidth + 1 ||
    maxItemRight > geometry.viewportWidth + 0.5
  ) {
    fail(
      'no header horizontal overflow',
      `scrollWidth ${geometry.headerScrollWidth} vs clientWidth ${geometry.headerClientWidth}, ` +
        `rightmost item ${Math.round(maxItemRight)} vs viewport ${geometry.viewportWidth}`,
    );
  }

  const lines = groupLines(items).length;
  if (combo.fontScale === 1 && (Math.round(geometry.headerHeight) !== 64 || lines !== 1)) {
    fail(
      'single 64px row at default text',
      `header ${Math.round(geometry.headerHeight)}px, ${lines} visual line(s)`,
    );
  }

  return {
    combo: comboLabel,
    order: visual.join(' → '),
    lines,
    headerHeight: Math.round(geometry.headerHeight),
    findings,
  };
}