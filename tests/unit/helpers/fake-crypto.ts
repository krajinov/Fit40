/**
 * Deterministic test doubles for the crypto ports.
 *
 * Values are fully predictable so use-case tests can assert exact IDs,
 * tokens, and hashes instead of regex/random-value assertions.
 */

import type { IdGenerator } from '@/application/ports/id-generator';
import type { SessionTokenService } from '@/application/ports/session-token-service';

export class FakeIdGenerator implements IdGenerator {
  private counter = 0;

  generate(): string {
    this.counter += 1;
    return `fake-id-${this.counter}`;
  }
}

export class FakeSessionTokenService implements SessionTokenService {
  private counter = 0;

  generate(): string {
    this.counter += 1;
    return `fake-token-${this.counter}`;
  }

  hash(token: string): string {
    return `fake-hash:${token}`;
  }
}
