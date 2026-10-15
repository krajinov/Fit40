/**
 * Source scanner for viewport-bottom ("fixed bottom bar") surfaces.
 *
 * M19 S4 review fix (P3): the original guard only inspected literal
 * double-quoted `className="…"` attributes, so a bar written as
 * `className={cn('fixed inset-x-0', 'bottom-0')}` — or with single quotes or a
 * template literal — would have been invisible to it. This scanner understands
 * every form the codebase can use while staying precise:
 *
 * - it tokenizes string literals (double-quoted, single-quoted, template) and
 *   requires the exact class tokens `fixed` AND `bottom-0` (so
 *   `padding-bottom-0` or `inset-bottom-0` never match);
 * - position is checked, not just presence: `absolute bottom-0` is NOT a fixed
 *   bottom bar;
 * - a class expression may split the two utilities across several literals
 *   (`cn('fixed …', active && 'bottom-0')`), so the literals inside one
 *   `className` / class-helper window are unioned;
 * - comments are stripped first, so prose never satisfies or fails a guard.
 */

const FIXED = 'fixed';
const BOTTOM = 'bottom-0';

/** Source with comments removed, so prose never satisfies or fails a guard. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // `//` comments start at a line start or after whitespace (never inside a
    // URL such as `https://…`, where `//` follows `:`).
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/** Every string literal in the source (double, single or template). */
export function stringLiterals(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );
}

/** The class tokens a set of literals declares. */
function classTokens(source: string): Set<string> {
  const tokens = new Set<string>();
  for (const literal of stringLiterals(source)) {
    for (const token of literal.split(/\s+/)) {
      if (token.length > 0) tokens.add(token);
    }
  }
  return tokens;
}

/**
 * A bounded window after each `className` attribute or class-helper call: the
 * expression that decides an element's classes. The window is deliberately
 * generous (class lists are long) and the check is conservative — both
 * utilities must appear inside the SAME expression.
 */
function classExpressionWindows(source: string): string[] {
  const windows: string[] = [];
  for (const match of source.matchAll(/\bclassName\b|\bcn\(|\bcx\(|\bclsx\(|\btwMerge\(|\bcva\(/g)) {
    const start = match.index ?? 0;
    windows.push(source.slice(start, start + 400));
  }
  return windows;
}

/** True when the file declares an element pinned to the viewport bottom. */
export function hasFixedBottomBar(rawSource: string): boolean {
  const source = stripComments(rawSource);

  for (const literal of stringLiterals(source)) {
    const tokens = new Set(literal.split(/\s+/));
    if (tokens.has(FIXED) && tokens.has(BOTTOM)) return true;
  }

  for (const window of classExpressionWindows(source)) {
    const tokens = classTokens(window);
    if (tokens.has(FIXED) && tokens.has(BOTTOM)) return true;
  }

  return false;
}
