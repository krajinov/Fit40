/**
 * Data transfer objects for user identity crossing layer boundaries.
 *
 * DTOs are plain, serializable shapes: branded IDs and value objects are
 * stripped to plain strings, Dates are serialized to ISO 8601 strings.
 * The password hash is never part of any DTO.
 */

import type { User } from '@/domain/entities/user';

export interface UserDto {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}
