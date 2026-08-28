/**
 * Shared session issuance for register and login.
 *
 * Generates a 256-bit opaque bearer token, persists only its SHA-256 hash,
 * and returns the raw token exactly once so the caller (a Server Action) can
 * hand it to the client as an HttpOnly cookie. The raw token is never stored
 * or logged.
 */

import crypto from 'crypto';

import type { SessionRepository } from '@/application/ports/session-repository';
import type { UserId } from '@/domain/types/ids';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, fixed expiry

export interface IssuedSession {
  /** Raw bearer token — return to the client once, never persist. */
  readonly token: string;
  readonly expiresAt: Date;
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function issueSession(
  sessionRepository: SessionRepository,
  userId: UserId,
  now: Date = new Date(),
): Promise<IssuedSession> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await sessionRepository.create({
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt,
    createdAt: now,
  });

  return { token, expiresAt };
}
