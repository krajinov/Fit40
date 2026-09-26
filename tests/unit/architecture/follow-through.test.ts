/**
 * M16 Slice 7 — architecture and product-semantics guards for Plan
 * Follow-Through.
 *
 * Source-level rather than snapshot-level: each assertion pins a boundary the
 * locked M16 contract depends on — layer isolation, the Server Component rule,
 * no M16 persistence object, wiring through the feature composition root, no
 * clock in presentation, and the neutral product vocabulary — so an edit that
 * quietly crosses a boundary fails here instead of arriving in review.
 *
 * Scope is deliberate: nothing here bans words or imports that are legitimate
 * elsewhere in Fit40 (`skipped` is a real workout-session state, `goal` is
 * profile vocabulary). These guards read M16 sources only, and the vocabulary
 * check strips comments first so documentation may keep naming what it bans.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vitest runs from the repository root (the `global-setup` path convention). */
const ROOT = process.cwd();

const DOMAIN_FILES = [
  'src/domain/services/plan-follow-through.ts',
  'src/domain/services/follow-through-week.ts',
];

const APPLICATION_FILES = [
  'src/application/dto/follow-through.ts',
  'src/application/use-cases/get-enrollment-follow-through.ts',
];

const PRESENTATION_FILES = [
  'src/features/schedule/follow-through-view.ts',
  'src/features/schedule/components/PlanFollowThroughSection.tsx',
];

const PAGE_FILE = 'src/app/(app)/programs/[programSlug]/page.tsx';
const PROGRAM_DETAIL_FILE = 'src/features/programs/components/ProgramDetail.tsx';

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Every module specifier the file imports, from static `import` statements. */
function importsOf(relativePath: string): ReadonlyArray<string> {
  const specifiers: string[] = [];
  for (const match of read(relativePath).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

/** Code with block and line comments removed, so doc prose is not "code". */
function codeOf(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('M16 layer boundaries', () => {
  it('imports only Domain modules', () => {
    // Domain must depend on nothing outside itself — no Application, no
    // Infrastructure, no features, no React, no Next.js, no Drizzle.
    for (const file of DOMAIN_FILES) {
      for (const specifier of importsOf(file)) {
        expect(specifier.startsWith('@/domain/'), `${file} imports "${specifier}"`).toBe(true);
      }
    }
  });

  it('imports only Application and Domain modules', () => {
    // Application may reach Domain and its own ports/DTOs — never Infrastructure,
    // features, React, Next.js or Drizzle.
    for (const file of APPLICATION_FILES) {
      for (const specifier of importsOf(file)) {
        const allowed = specifier.startsWith('@/domain/') || specifier.startsWith('@/application/');
        expect(allowed, `${file} imports "${specifier}"`).toBe(true);
      }
    }
  });

  it('reaches no repository, port, use case or persistence module', () => {
    // Presentation consumes DTOs only; the read is reached from the page through
    // the feature composition root.
    for (const file of PRESENTATION_FILES) {
      for (const specifier of importsOf(file)) {
        expect(specifier.startsWith('@/infrastructure'), `${file} imports "${specifier}"`).toBe(
          false,
        );
        expect(specifier.startsWith('@/application/ports'), `${file} imports "${specifier}"`).toBe(
          false,
        );
        expect(
          specifier.startsWith('@/application/use-cases'),
          `${file} imports "${specifier}"`,
        ).toBe(false);
        expect(specifier.startsWith('drizzle-orm'), `${file} imports "${specifier}"`).toBe(false);
        expect(specifier.startsWith('next'), `${file} imports "${specifier}"`).toBe(false);
      }
    }
  });
});

describe('M16 page wiring', () => {
  it('reads through the feature composition root, never the use case or a repository', () => {
    const specifiers = importsOf(PAGE_FILE);

    expect(specifiers).toContain('@/features/schedule/services');
    for (const specifier of specifiers) {
      expect(specifier.startsWith('@/application/use-cases'), `page imports "${specifier}"`).toBe(
        false,
      );
      expect(specifier.startsWith('@/infrastructure'), `page imports "${specifier}"`).toBe(false);
    }
  });

  it('renders the section through ProgramDetail', () => {
    const source = read(PROGRAM_DETAIL_FILE);

    expect(importsOf(PROGRAM_DETAIL_FILE)).toContain(
      '@/features/schedule/components/PlanFollowThroughSection',
    );
    expect(source).toContain('<PlanFollowThroughSection followThrough={followThrough}');
  });

  it('stays a Server Component (no "use client")', () => {
    for (const file of [...PRESENTATION_FILES, PROGRAM_DETAIL_FILE]) {
      expect(read(file), `${file} must stay server-side`).not.toContain('"use client"');
      expect(read(file), `${file} must stay server-side`).not.toContain("'use client'");
    }
  });
});

describe('M16 persistence boundary', () => {
  const SCHEMA_BARREL = 'src/infrastructure/database/schema/index.ts';

  it('adds no follow-through table: M16 rides the existing tables', () => {
    const barrel = read(SCHEMA_BARREL);

    expect(barrel.toLowerCase()).not.toContain('follow');
    // The three tables the read is allowed to see are still the only source.
    expect(barrel).toContain('plannedWorkouts');
    expect(barrel).toContain('workoutSessions');
    expect(barrel).toContain('programEnrollments');
  });

  it('adds no follow-through migration file', () => {
    const migrations = readdirSync(path.join(ROOT, 'src/infrastructure/database/migrations'));

    expect(migrations.filter((name) => /follow/i.test(name))).toEqual([]);
  });

  it('never imports the schema or Drizzle from any M16 source', () => {
    for (const file of [...DOMAIN_FILES, ...APPLICATION_FILES, ...PRESENTATION_FILES]) {
      const source = read(file);
      expect(source, `${file} must not reach Drizzle`).not.toContain("from 'drizzle-orm");
      expect(source, `${file} must not reach the schema`).not.toContain(
        '@/infrastructure/database/schema',
      );
    }
  });
});

describe('M16 product vocabulary and clock', () => {
  // The banned framing must not appear in M16 presentation CODE — comments and
  // docs may keep naming what they forbid, and these words remain legal elsewhere
  // in Fit40 (e.g. `skipped` is a real session state).
  const BANNED = [
    'missed',
    'failed',
    'skipped',
    'streak',
    'adherence',
    'score',
    'goal',
    'on track',
    'off track',
  ];

  it('keeps judgemental vocabulary and percentages out of presentation code', () => {
    for (const file of PRESENTATION_FILES) {
      const code = codeOf(file).toLowerCase();

      expect(code, `${file} renders a percentage`).not.toContain('%');
      for (const token of BANNED) {
        expect(code, `${file} contains "${token}"`).not.toContain(token);
      }
      // Factual terms the locked copy allows are deliberately not banned:
      // "past due", "completed early", "completed late".
    }
  });

  it('reads no clock in presentation', () => {
    // The DTO supplies `today` and the window bounds; `closed` is never
    // recomputed from a server or browser clock.
    for (const file of PRESENTATION_FILES) {
      const code = codeOf(file);

      expect(code, `${file} reads the clock`).not.toContain('Date.now(');
      expect(code, `${file} constructs a clock Date`).not.toMatch(/new Date\(\s*\)/);
    }
  });
});
