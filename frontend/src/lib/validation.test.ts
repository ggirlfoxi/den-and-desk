import { describe, expect, it } from 'vitest';
import {
  isAdult,
  validateAftercarePlan,
  validateBooking,
  validateContract,
  validateDuty,
  validateMessage,
  validateProfile,
  validateProofNote,
  validateRating,
} from './validation';

describe('isAdult', () => {
  const ref = new Date('2026-10-26T00:00:00Z');
  it('accepts exactly 18', () => {
    expect(isAdult('2008-10-26', ref)).toBe(true);
  });
  it('rejects one day under 18', () => {
    expect(isAdult('2008-10-27', ref)).toBe(false);
  });
  it('rejects an invalid date', () => {
    expect(isAdult('not-a-date', ref)).toBe(false);
  });
});

describe('validateMessage and validateRating', () => {
  it('rejects an empty message and a message over 2000 characters', () => {
    expect(validateMessage('')).toMatch(/empty/);
    expect(validateMessage('x'.repeat(2001))).toMatch(/2000/);
    expect(validateMessage('hello')).toBeNull();
  });
  it('rejects out-of-range scores and long rating notes', () => {
    expect(validateRating(6, '')).toMatch(/1 to 5/);
    expect(validateRating(4, 'x'.repeat(201))).toMatch(/200/);
    expect(validateRating(4, 'kind and clear')).toBeNull();
  });
});

describe('validateProfile', () => {
  it('accepts a kitty pet', () => {
    expect(validateProfile({ displayName: 'Moss', role: 'Pet', petType: 'Kitty' })).toBeNull();
  });
  it('rejects pony at launch', () => {
    expect(validateProfile({ displayName: 'Moss', role: 'Pet', petType: 'Pony' })).toMatch(/later phase/);
  });
  it('requires a pet type for pets', () => {
    expect(validateProfile({ displayName: 'Moss', role: 'Pet' })).toMatch(/pet type/);
  });
  it('rejects a one-character pseudonym', () => {
    expect(validateProfile({ displayName: 'M', role: 'Owner' })).toMatch(/2 to 30/);
  });
});

describe('Phase 2 validation', () => {
  it('requires a contract title and safeword', () => {
    expect(validateContract({ safeword: 'red', title: '' })).toMatch(/title/);
    expect(validateContract({ safeword: '', title: 'Ours' })).toMatch(/safeword/);
    expect(validateContract({ limits: 'Kind.', safeword: 'red', title: 'Ours' })).toBeNull();
  });
  it('validates duties and proof notes', () => {
    expect(validateDuty({ title: '' })).toMatch(/title/);
    expect(validateProofNote('')).toMatch(/proof note/);
    expect(validateProofNote('Photo note: tidy den.')).toBeNull();
  });
  it('rejects backwards bookings and long regions', () => {
    expect(validateBooking({ endAt: 100, startAt: 200 })).toMatch(/start time/);
    expect(validateBooking({ endAt: 300, region: 'x'.repeat(61), startAt: 200 })).toMatch(/Region/);
    expect(validateBooking({ endAt: 300, startAt: 200 })).toBeNull();
  });
  it('validates aftercare plans', () => {
    expect(validateAftercarePlan({ checkInMinutes: 60, closurePhrase: '', selfCarePrompts: ['Water'] })).toMatch(/closure phrase/);
    expect(validateAftercarePlan({ checkInMinutes: 2000, closurePhrase: 'done', selfCarePrompts: ['Water'] })).toMatch(/minutes/);
    expect(validateAftercarePlan({ checkInMinutes: 60, closurePhrase: 'scene over, welcome back', selfCarePrompts: ['Get water', 'Grab a blanket'] })).toBeNull();
  });
});
