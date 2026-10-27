export type Role = 'Owner' | 'Pet' | 'Switch' | 'Curious';
export type PetType = 'Kitty' | 'Puppy';

export const ROLES: Role[] = ['Owner', 'Pet', 'Switch', 'Curious'];
export const PET_TYPES_LAUNCH: PetType[] = ['Kitty', 'Puppy'];

/** Age in whole years on a given reference date (UTC). */
export function ageOn(dateOfBirth: string, on: Date = new Date()): number | null {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = on.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function isAdult(dateOfBirth: string, on: Date = new Date()): boolean {
  const age = ageOn(dateOfBirth, on);
  return age !== null && age >= 18;
}

export function validateMessage(body: string): string | null {
  if (body.trim().length < 1) return 'Message cannot be empty.';
  if (body.length > 2000) return 'Message must be 2000 characters or fewer.';
  return null;
}

export function validateRating(score: number, note: string): string | null {
  if (!Number.isInteger(score) || score < 1 || score > 5) return 'Score must be a whole number from 1 to 5.';
  if (note.trim().length > 200) return 'Rating note must be 200 characters or fewer.';
  return null;
}

export function validateContract(input: { title: string; safeword: string; limits?: string }): string | null {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 80) return 'Contract title must be 1 to 80 characters.';
  const safeword = input.safeword.trim();
  if (safeword.length < 1 || safeword.length > 40) return 'A safeword of 1 to 40 characters is required.';
  if ((input.limits ?? '').trim().length > 2000) return 'Limits must be 2000 characters or fewer.';
  return null;
}

export function validateDuty(input: { title: string; description?: string }): string | null {
  const title = input.title.trim();
  if (title.length < 1 || title.length > 120) return 'Duty title must be 1 to 120 characters.';
  if ((input.description ?? '').trim().length > 1000) return 'Duty description must be 1000 characters or fewer.';
  return null;
}

export function validateProofNote(note: string): string | null {
  const text = note.trim();
  if (text.length < 1 || text.length > 500) return 'A proof note of 1 to 500 characters is required.';
  return null;
}

export function validateBooking(input: { startAt: number; endAt: number; region?: string; workDescription?: string }): string | null {
  if (!(input.startAt > 0) || !(input.endAt > input.startAt)) return 'A booking needs a start time before its end time.';
  if ((input.region ?? '').trim().length > 60) return 'Region must be 60 characters or fewer, and a general area only — never a street address.';
  if ((input.workDescription ?? '').trim().length > 500) return 'Work description must be 500 characters or fewer.';
  return null;
}

export function validateAftercarePlan(input: { closurePhrase: string; selfCarePrompts: string[]; checkInMinutes: number }): string | null {
  const phrase = input.closurePhrase.trim();
  if (phrase.length < 1 || phrase.length > 200) return 'A closure phrase of 1 to 200 characters is required.';
  if (input.selfCarePrompts.length > 10 || input.selfCarePrompts.some((p) => p.trim().length < 1 || p.trim().length > 200)) {
    return 'Self-care prompts must be up to 10 short lines, each 1 to 200 characters.';
  }
  if (!Number.isInteger(input.checkInMinutes) || input.checkInMinutes < 0 || input.checkInMinutes > 1440) {
    return 'Check-in delay must be a whole number of minutes from 0 to 1440.';
  }
  return null;
}

export function validateNote(note: string, max = 500): string | null {
  if (note.trim().length > max) return `Note must be ${max} characters or fewer.`;
  return null;
}

export function validateProfile(input: {
  displayName: string;
  role: string;
  petType?: string;
}): string | null {
  const name = input.displayName.trim();
  if (name.length < 2 || name.length > 30) {
    return 'Display name must be 2 to 30 characters. Use a pseudonym — never your real name.';
  }
  if (!(ROLES as string[]).includes(input.role)) {
    return 'Role must be Owner, Pet, Switch, or Curious.';
  }
  if (input.role === 'Pet' && !input.petType) {
    return 'Pets choose a pet type at launch: Kitty or Puppy.';
  }
  if (input.petType && !(PET_TYPES_LAUNCH as string[]).includes(input.petType)) {
    return 'Only Kitty and Puppy are available at launch. Other pet types are a later phase.';
  }
  return null;
}
