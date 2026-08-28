import { createHash, randomBytes } from 'node:crypto';

import type { SessionTokenService } from '@/application/ports/session-token-service';

/**
 * Node crypto implementation of SessionTokenService.
 *
 * Tokens are 256 bits of CSPRNG entropy (base64url, ~43 chars). Persisted
 * identifiers are SHA-256 hex digests, so a database leak does not expose
 * usable sessions.
 */
export class NodeSessionTokenService implements SessionTokenService {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
