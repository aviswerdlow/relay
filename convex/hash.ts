import { sha256 } from 'js-sha256';

export function hashToken(value: string): string {
  return sha256(value);
}
