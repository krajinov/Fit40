/**
 * M19 S6 — navigation integrity and UX regression guards.
 *
 * Source-scan idiom shared with the other architecture guards. Every assertion
 * targets a file this milestone owns; there is no repository-wide vocabulary or
 * formatting sweep. The S2 assertion is deliberately adapted to the shipped
 * implementation: S2 **removed every `loading.tsx`** so redirects and 404s stay
 * native, and replaced them with page-level `Suspense` + `RoutePlaceholder`.
 * Reintroducing `loading.tsx` to satisfy an outdated guard would be a
 * regression, so the guard pins the shipped architecture instead.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  NAV_ITEMS,
  authenticatedMobileTabs,
  visibleNavItems,
} from '@/components/shared/nav-items';
import { nextPathSchema } from '@/features/auth/schemas/auth-schemas';

const S6_COPY_FILES = ['src/app/page.tsx', 'src/app/not-found.tsx'];
const BOUNDARY_FILES = [
  'src/components/shared/ErrorState.tsx',
  'src/app/(app)/error.tsx',
  'src/app/(auth)/error.tsx',
  'src/app/global-error.tsx',
];
const STREAMED_ROUTES = [
  'src/app/(app)/dashboard/page.tsx',
  'src/app/(app)/history/page.tsx',
  'src/app/(app)/progress/page.tsx',
  'src/app/(app)/programs/[programSlug]/page.tsx',
  'src/app/(app)/programs/[programSlug]/weeks/[weekNumber]/workouts/[workoutOrder]/session/page.tsx',
];
const BANNED_VOCABULARY =
  /\b(?:adherence|streaks?|missed|failed|on[ -]track|readiness|e1rm|scores?)\b/i;

function source(file: string): string {
  return readFileSync(path.resolve(file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}

function importsIn(file: string): string[] {
  return [...source(file).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** TypeScript AST scan: no `any`, no non-null assertions, no TS suppressions. */
function unsafeTyping(file: string): string[] {
  const raw = readFileSync(file, 'utf8');
  const found: string[] = [];
  if (/@ts-(?:ignore|nocheck|expect-error)/.test(raw)) {
    found.push('typescript suppression');
  }
  const program = ts.createSourceFile(
    file,
    raw,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function visit(node: ts.Node): void {
    if (ts.isNonNullExpression(node)) {
      found.push(`non-null assertion in ${file}`);
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      found.push(`any in ${file}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(program);
  return found;
}

describe('M19 navigation isolation', () => {
  it('keeps every shared shell component free of feature imports', () => {
    for (const file of filesIn('src/components/shared')) {
      expect(importsIn(file).filter((name) => name.startsWith('@/features/')), file).toEqual([]);
    }
  });

  it('reads destinations from nav-items instead of hard-coding routes in the shell', () => {
    for (const file of [
      'src/components/shared/AppNavLinks.tsx',
      'src/components/shared/MobileTabBar.tsx',
    ]) {
      const text = source(file);
      expect(text).toMatch(/@\/components\/shared\/nav-items/);
      for (const href of NAV_ITEMS.map((item) => item.href)) {
        expect(text, `${file} hard-codes ${href}`).not.toContain(`"${href}"`);
      }
    }
    expect(source('src/components/shared/AppNavLinks.tsx')).toContain('visibleNavItems(');
    expect(source('src/components/shared/MobileTabBar.tsx')).toContain('authenticatedMobileTabs(');
  });

  it('keeps nav-items server-safe and declarative', () => {
    const model = source('src/components/shared/nav-items.ts');
    expect(model).not.toMatch(/from ['"]next\//);
    expect(model).not.toMatch(/['"]use (?:client|server)['"]/);
    expect(model).not.toMatch(/\buse(?:State|Effect|Reducer)\s*\(/);
  });
});

describe('M19 locked mobile tab set', () => {
  it('resolves exactly the approved four tabs, in order', () => {
    expect(authenticatedMobileTabs().map((tab) => tab.href)).toEqual([
      '/dashboard',
      '/programs',
      '/exercises',
      '/progress',
    ]);
    expect(authenticatedMobileTabs()).toHaveLength(4);
    expect(NAV_ITEMS.filter((item) => item.mobileTab)).toHaveLength(4);
  });

  it('never offers History or Profile as a fifth tab', () => {
    const hrefs = authenticatedMobileTabs().map((tab) => tab.href);
    expect(hrefs).not.toContain('/history');
    expect(hrefs).not.toContain('/profile');
  });

  it('filters private destinations out of signed-out navigation', () => {
    expect(visibleNavItems(false).map((item) => item.href)).toEqual(['/programs', '/exercises']);
    expect(visibleNavItems(true).map((item) => item.href)).toEqual(
      NAV_ITEMS.map((item) => item.href),
    );
  });

  it('hides the signed-out tab bar entirely', () => {
    const tabBar = source('src/components/shared/MobileTabBar.tsx');
    expect(tabBar).toMatch(/if \(!isAuthenticated\) \{\s*return null;/);
    expect(tabBar).toContain('isAuthenticated: boolean');
  });

  it('keeps History reachable from the dashboard without a tab', () => {
    expect(source('src/app/(app)/dashboard/page.tsx')).toContain('<RecentTrainingCard');
    const card = source('src/features/dashboard/components/RecentTrainingCard.tsx');
    expect(card).toContain('href="/history"');
    expect(card).toContain('min-h-[44px]');
  });
});

describe('M19 navigation copy and accessibility', () => {
  it('names the primary landmark and exposes active state on every navigation surface', () => {
    for (const file of [
      'src/components/shared/AppNavLinks.tsx',
      'src/components/shared/MobileTabBar.tsx',
    ]) {
      const text = source(file);
      expect(text, file).toContain('aria-label="Primary"');
      expect(text, file).toContain("aria-current={active ? 'page' : undefined}");
    }
  });

  it('keeps visible focus rings and 44px mobile targets', () => {
    const tabBar = source('src/components/shared/MobileTabBar.tsx');
    const navLinks = source('src/components/shared/AppNavLinks.tsx');
    const mobileHeader = source('src/components/shared/MobileHeader.tsx');
    expect(tabBar).toContain('focus-visible:ring-3');
    expect(navLinks).toContain('focus-visible:ring-3');
    expect(navLinks).toContain('min-h-11');
    expect(mobileHeader).toContain('min-h-[44px]');
    // Native anchors keep the DOM order as the tab order.
    expect(tabBar).not.toContain('tabIndex');
    expect(navLinks).not.toContain('tabIndex');
  });
});

describe('M19 safe redirects', () => {
  it('builds every login deep link with the existing validated next mechanism', () => {
    const deepLinks = filesIn('src')
      .filter((file) => source(file).includes('/login?next='))
      .map((file) => file.split(path.sep).join('/'))
      .sort();
    expect(deepLinks).toEqual([
      'src/features/auth/current-user.ts',
      'src/features/enrollment/components/AnonymousVisitorCard.tsx',
      'src/features/sessions/components/WorkoutStartPanel.tsx',
    ]);
    for (const file of deepLinks) {
      expect(source(file), file).toMatch(/\/login\?next=\$\{encodeURIComponent\(/);
    }
  });

  it('validates the next parameter at every auth boundary', () => {
    for (const file of [
      'src/app/(auth)/login/page.tsx',
      'src/app/(auth)/register/page.tsx',
      'src/features/auth/actions/login.ts',
      'src/features/auth/actions/register.ts',
    ]) {
      expect(source(file), file).toContain('nextPathSchema.safeParse(');
    }
    expect(nextPathSchema.safeParse('/programs/p/weeks/2/workouts/3/session').success).toBe(true);
    for (const unsafe of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
    ]) {
      expect(nextPathSchema.safeParse(unsafe).success, unsafe).toBe(false);
    }
  });

  it('keeps the 404 free of redirect, authorization and database helpers', () => {
    const notFound = source('src/app/not-found.tsx');
    expect(notFound).not.toMatch(/\brequireUser\s*\(/);
    expect(notFound).not.toMatch(/\bredirect\s*\(/);
    expect(notFound).not.toMatch(/@\/(?:infrastructure|application)/);
  });
});

describe('M19 feature-layer boundaries', () => {
  it('keeps exercise presentation out of ports and infrastructure', () => {
    for (const file of filesIn('src/features/exercises')) {
      if (file.endsWith('services.ts')) continue;
      for (const dependency of importsIn(file)) {
        expect(dependency, file).not.toMatch(/^@\/application\/ports/);
        expect(dependency, file).not.toMatch(/^@\/infrastructure/);
        expect(dependency, file).not.toBe('drizzle-orm');
      }
    }
  });
});

describe('M19 error and copy privacy', () => {
  it('never renders internal error detail in an error surface', () => {
    for (const file of BOUNDARY_FILES) {
      const text = source(file);
      expect(text, file).not.toMatch(/error\.(?:message|stack)/);
      expect(text, file).not.toContain('{error}');
    }
  });

  it('keeps banned product vocabulary out of S6 copy', () => {
    for (const file of S6_COPY_FILES) {
      expect(source(file), file).not.toMatch(BANNED_VOCABULARY);
    }
  });

  it('adds no unsafe typing to S6 source files', () => {
    for (const file of S6_COPY_FILES) {
      expect(unsafeTyping(file), file).toEqual([]);
    }
  });
});

describe('M19 S2 loading architecture (adapted — loading.tsx stays removed)', () => {
  it('has no segment loading.tsx anywhere', () => {
    expect(filesIn('src/app').filter((file) => file.endsWith('loading.tsx'))).toEqual([]);
  });

  it('defines the single shared placeholder exactly once', () => {
    const definitions = filesIn('src').filter((file) =>
      /export function RoutePlaceholder\s*\(/.test(source(file)),
    );
    expect(definitions.map((file) => file.split(path.sep).join('/'))).toEqual([
      'src/components/shared/RoutePlaceholder.tsx',
    ]);
  });

  it('streams slow success paths behind page-level Suspense with the placeholder', () => {
    for (const file of STREAMED_ROUTES) {
      const text = source(file);
      expect(text, file).toContain('<Suspense');
      expect(text, file).toContain('<RoutePlaceholder');
    }
  });
});

describe('M19 clocks stay explicit', () => {
  it('never reads Date.now implicitly in Domain or Application', () => {
    for (const file of [...filesIn('src/domain'), ...filesIn('src/application')]) {
      expect(source(file), file).not.toMatch(/\bDate\.now\s*\(/);
    }
  });
});

