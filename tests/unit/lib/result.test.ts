import { describe, it, expect } from 'vitest';

import { ok, err, isOk, isErr, map, mapErr, flatMap, unwrapOr } from '@/lib/result';
import type { Result } from '@/lib/result';

describe('Result', () => {
  describe('ok', () => {
    it('creates a successful result with data', () => {
      const result: Result<number, string> = ok(42);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(42);
      }
    });

    it('creates a successful result with complex data', () => {
      const data = { name: 'Squat', sets: 3, reps: 5 };
      const result: Result<typeof data, string> = ok(data);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(data);
      }
    });
  });

  describe('err', () => {
    it('creates a failed result with error', () => {
      const result: Result<number, string> = err('Something went wrong');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Something went wrong');
      }
    });

    it('creates a failed result with structured error', () => {
      const error = { code: 'NOT_FOUND', message: 'Workout not found' };
      const result: Result<number, typeof error> = err(error);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual(error);
      }
    });
  });

  describe('isOk', () => {
    it('returns true for successful result', () => {
      const result = ok('data');

      expect(isOk(result)).toBe(true);
    });

    it('returns false for failed result', () => {
      const result = err('error');

      expect(isOk(result)).toBe(false);
    });

    it('narrows type to access data', () => {
      const result: Result<number, string> = ok(42);

      if (isOk(result)) {
        // TypeScript should allow accessing data here
        expect(result.data).toBe(42);
      } else {
        expect.fail('Expected ok result');
      }
    });
  });

  describe('isErr', () => {
    it('returns true for failed result', () => {
      const result = err('error');

      expect(isErr(result)).toBe(true);
    });

    it('returns false for successful result', () => {
      const result = ok('data');

      expect(isErr(result)).toBe(false);
    });

    it('narrows type to access error', () => {
      const result: Result<number, string> = err('failed');

      if (isErr(result)) {
        // TypeScript should allow accessing error here
        expect(result.error).toBe('failed');
      } else {
        expect.fail('Expected error result');
      }
    });
  });

  describe('map', () => {
    it('transforms data of successful result', () => {
      const result = ok(5);
      const mapped = map(result, (n) => n * 2);

      expect(mapped.ok).toBe(true);
      if (mapped.ok) {
        expect(mapped.data).toBe(10);
      }
    });

    it('propagates error unchanged', () => {
      const result: Result<number, string> = err('error');
      const mapped = map(result, (n) => n * 2);

      expect(mapped.ok).toBe(false);
      if (!mapped.ok) {
        expect(mapped.error).toBe('error');
      }
    });
  });

  describe('mapErr', () => {
    it('transforms error of failed result', () => {
      const result: Result<number, string> = err('original');
      const mapped = mapErr(result, (e) => `Transformed: ${e}`);

      expect(mapped.ok).toBe(false);
      if (!mapped.ok) {
        expect(mapped.error).toBe('Transformed: original');
      }
    });

    it('propagates data unchanged for successful result', () => {
      const result: Result<number, string> = ok(42);
      const mapped = mapErr(result, (e) => `Transformed: ${e}`);

      expect(mapped.ok).toBe(true);
      if (mapped.ok) {
        expect(mapped.data).toBe(42);
      }
    });
  });

  describe('flatMap', () => {
    it('chains successful operations', () => {
      const divide = (a: number, b: number): Result<number, string> => {
        if (b === 0) return err('Division by zero');
        return ok(a / b);
      };

      const result = flatMap(ok(10), (n) => divide(n, 2));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(5);
      }
    });

    it('propagates error from chained operation', () => {
      const divide = (a: number, b: number): Result<number, string> => {
        if (b === 0) return err('Division by zero');
        return ok(a / b);
      };

      const result = flatMap(ok(10), (n) => divide(n, 0));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Division by zero');
      }
    });

    it('propagates original error without calling function', () => {
      const result: Result<number, string> = err('original error');
      let called = false;

      const chained = flatMap(result, (n) => {
        called = true;
        return ok(n * 2);
      });

      expect(called).toBe(false);
      expect(chained.ok).toBe(false);
      if (!chained.ok) {
        expect(chained.error).toBe('original error');
      }
    });
  });

  describe('unwrapOr', () => {
    it('returns data for successful result', () => {
      const result = ok(42);

      expect(unwrapOr(result, 0)).toBe(42);
    });

    it('returns fallback for failed result', () => {
      const result: Result<number, string> = err('error');

      expect(unwrapOr(result, 0)).toBe(0);
    });
  });
});