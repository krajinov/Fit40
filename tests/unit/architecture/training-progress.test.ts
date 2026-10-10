/** M18 Slice 9: source guards for the approved read-only progress boundaries. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { formatHistoryVolume } from '@/features/history/history-labels';

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

const PROGRESS_FILES = filesIn('src/features/progress');
const COMPOSITION_ROOT = 'src/features/progress/services.ts';

/** Resolve relative specifiers too, so moving an import cannot bypass a guard. */
function dependencies(file: string): string[] {
  const result: string[] = [];
  for (const match of source(file).matchAll(
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g,
  )) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    result.push(specifier.startsWith('.')
      ? path.relative(process.cwd(), path.resolve(path.dirname(file), specifier))
      : specifier.replace(/^@\//, 'src/'));
  }
  return result;
}

describe('M18 architecture guards', () => {
  it('keeps ports out of Progress and persistence exclusively in its composition root', () => {
    for (const file of PROGRESS_FILES) {
      for (const dependency of dependencies(file)) {
        expect(dependency, file).not.toMatch(/^src\/application\/ports(?:\/|$)/);
        if (file !== COMPOSITION_ROOT) {
          expect(dependency, file).not.toMatch(/^(src\/infrastructure(?:\/|$)|drizzle-orm)/);
          expect(dependency, file).not.toMatch(/^src\/application\/use-cases(?:\/|$)/);
        }
      }
    }
    // S4/S6 explicitly require this DI wiring; it is the only exception to
    // S9's literal feature-wide infrastructure ban (reported in the plan).
    expect(dependencies(COMPOSITION_ROOT)).toContain('src/infrastructure/database/repositories');
  });

  it('never calls repositories from the Progress view mappers', () => {
    for (const file of PROGRESS_FILES.filter((file) => /-view\.ts$/.test(file))) {
      expect(source(file), file).not.toMatch(/\b\w*Repository\s*(?:\?\.)?\s*\./i);
      expect(source(file), file).not.toMatch(/\b(?:findBestValuesBefore|findCurrentPersonalBests|listCompletedSessionsSince|listProgressSessionActivity)\s*\(/);
    }
  });

  it('has no implicit Date.now clock anywhere in Application or Domain', () => {
    for (const file of [...filesIn('src/application'), ...filesIn('src/domain')]) {
      expect(source(file), file).not.toMatch(/\bDate\s*\.\s*now\s*\(/);
    }
  });

  it('keeps the route server-rendered and passes one request clock to both reads', () => {
    const page = source('src/app/(app)/progress/page.tsx');
    expect(page).not.toMatch(/['"]use client['"]/);
    expect(page.match(/new Date\(\)/g)).toHaveLength(1);
    expect(page).toContain('buildProgressView(user.id, now)');
    expect(page).toContain('buildProgressRecordTimeline(user.id, now)');
  });

  it('adds desktop Progress while preserving exactly the four existing mobile tabs', () => {
    expect(source('src/components/shared/AppNavLinks.tsx')).toMatch(/href: ['"]\/progress['"]/);
    const mobile = source('src/components/shared/MobileTabBar.tsx');
    const hrefs = [...mobile.matchAll(/href: ['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(hrefs).toEqual(['/dashboard', '/programs', '/exercises', '/profile']);
  });

  it('keeps the locked factual vocabulary in Progress and history labels', () => {
    const files = [...PROGRESS_FILES, 'src/features/history/history-labels.ts'];
    for (const file of files) {
      expect(source(file), file).not.toMatch(/\b(?:adherence|streaks?|missed|failed|on[ -]track|readiness|e1rm)\b/i);
    }
  });

  it('keeps progress volume arithmetic in the shared Domain authority', () => {
    const repository = source('src/infrastructure/database/repositories/drizzle-training-history-repository.ts');
    const activity = repository.split('async listProgressSessionActivity(')[1]?.split('async listCompletedSessionsSince(')[0];
    expect(activity).toContain('calculateLoggedSetMetrics(');
    expect(activity).not.toMatch(/\b(?:sum|filter)\s*\(/i);
    expect(activity).not.toContain('setLogs.weightKg');
    expect(source('src/domain/services/session-metrics.ts')).toContain('calculateLoggedSetMetrics(');
  });

  it('consumes Domain external-load presence without a presentation eligibility predicate', () => {
    for (const file of filesIn('src/features/history')) {
      expect(source(file), file).not.toContain('hasEligibleExternalLoad');
      expect(source(file), file).not.toMatch(/\.some\(\s*\(?set\)?\s*=>[\s\S]*?set\.type\s*===\s*['"]reps['"][\s\S]*?set\.weightKg\s*!==\s*null/);
    }
    for (const file of ['history-view.ts', 'completed-session-view.ts']) {
      expect(source(`src/features/history/${file}`)).toContain('metrics.hasExternalLoad');
    }
  });

  it('formats volume with load-times-repetitions units, including genuine zero', () => {
    expect(formatHistoryVolume(6000)).toBe('6,000 kg × reps');
    expect(formatHistoryVolume(0)).toBe('0 kg × reps');
  });
});
