import { randomUUID } from 'node:crypto';

import type { IdGenerator } from '@/application/ports/id-generator';

/** Node crypto implementation of IdGenerator (UUID v4). */
export class NodeIdGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}
