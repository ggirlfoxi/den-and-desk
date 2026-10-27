import { createHash, randomInt } from 'crypto';
import jwt from 'jsonwebtoken';

export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function generateCode(): string {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

export function ageOn(dateOfBirth: string, on: Date = new Date()): number | null {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = on.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

export function isAdult(dateOfBirth: string, on: Date = new Date()): boolean {
  const age = ageOn(dateOfBirth, on);
  return age !== null && age >= 18;
}

export function signToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: '7d' });
}

export function verifyToken(token: string, secret: string): string | null {
  try {
    const payload = jwt.verify(token, secret) as { sub?: string };
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
