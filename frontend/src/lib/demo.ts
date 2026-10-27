/**
 * Test/dev demo backend for Den & Desk — in-browser only.
 *
 * OFF by default. When demo mode is on, the frontend talks to this
 * module instead of the network: all state lives in localStorage
 * (key dd_demo_state_v1, with an in-memory fallback for tests), no
 * email is ever sent, no GPS/geolocation is used, no payment or
 * checkout is involved, and no real name, phone, address, or precise
 * location is stored. Demo data is clearly marked as demo, stays in
 * this browser, and can be reset with one button.
 *
 * Demo mode must NOT weaken real mode: when it is off, the app uses
 * the real API, invite-only gating, 18+ declaration, block/report,
 * and safeword rules exactly as before. The only deliberate demo
 * convenience (documented in the UI) is that a seeded demo partner
 * auto-signs / auto-agrees, so one person can test a full contract
 * or sit without a second account. That convenience never applies
 * outside demo mode.
 */
export const DEMO_INVITE_CODE = 'TEST';
export const DEMO_CODE = '123456';
export const DEMO_TOKEN = 'demo-token';

const MODE_KEY = 'dd_demo_mode';
const STATE_KEY = 'dd_demo_state_v1';

type Rec = Record<string, unknown>;
type Msg = { body: string; senderUserId: string };

function isBrowserStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

let memoryState: string | null = null;

// Test/dev demo mode is tracked separately from the data itself so
// tests can enable it without a browser.
let memoryMode = false;
export function setDemoMode(on: boolean): void {
  memoryMode = on;
  try {
    if (isBrowserStorage()) localStorage.setItem(MODE_KEY, on ? 'on' : 'off');
  } catch {
    // Storage is optional; the in-memory flag still applies in tests.
  }
}
export function demoModeEnabled(): boolean {
  if (memoryMode) return true;
  try {
    return isBrowserStorage() && localStorage.getItem(MODE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function resetDemo(): void {
  try {
    if (isBrowserStorage()) localStorage.removeItem(STATE_KEY);
  } catch {
    // ignore
  }
  memoryState = null;
}

interface DemoState {
  email: string | null;
  profile: Rec | null;
  profiles: Rec[];
  likes: string[];
  passes: string[];
  blocks: string[];
  threads: Record<string, Msg[]>;
  contracts: Rec[];
  duties: Rec[];
  bookings: Rec[];
  plans: Rec[];
  aftercareCheckins: Rec[];
  hellos: Rec[];
  schedCheckins: Rec[];
  commands: Rec[];
  praise: Rec[];
  wishlist: Rec[];
  routine: Rec[];
  lostAlerts: Rec[];
  lostOptIn: boolean;
  lostSound: boolean;
  gameAreas: Record<string, string>;
  sittings: Rec[];
  reports: Rec[];
  ratings: Rec[];
}

const ME = 'demo-user';
let counter = 0;
function nid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

function seededProfiles(): Rec[] {
  return [
    { id: 'demo-owner-profile', userId: 'demo-owner', displayName: 'Demo Owner', role: 'Owner', petType: null, meetingMode: 'Both', region: 'Tri-Cities' },
    { id: 'demo-kitty-profile', userId: 'demo-kitty', displayName: 'Demo Kitty', role: 'Pet', petType: 'Kitty', meetingMode: 'Online', region: 'Tri-Cities' },
    { id: 'demo-pup-profile', userId: 'demo-pup', displayName: 'Demo Pup', role: 'Pet', petType: 'Puppy', meetingMode: 'Both', region: 'Tri-Cities' },
  ];
}

function seedState(): DemoState {
  return {
    email: null,
    profile: null,
    profiles: seededProfiles(),
    likes: [],
    passes: [],
    blocks: [],
    threads: {},
    contracts: [],
    duties: [],
    bookings: [],
    plans: [],
    aftercareCheckins: [],
    hellos: [],
    schedCheckins: [],
    commands: [],
    praise: [],
    wishlist: [],
    routine: [],
    lostAlerts: [],
    lostOptIn: false,
    lostSound: true,
    gameAreas: { 'demo-kitty': 'Forest clearing', 'demo-pup': 'Forest clearing', 'demo-owner': '' },
    sittings: [],
    reports: [],
    ratings: [],
  };
}

function load(): DemoState {
  try {
    const raw = isBrowserStorage() ? localStorage.getItem(STATE_KEY) : memoryState;
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed && Array.isArray(parsed.profiles)) return { ...seedState(), ...parsed };
    }
  } catch {
    // Corrupt demo data resets cleanly; it is test data only.
  }
  return seedState();
}

function save(state: DemoState): void {
  try {
    const raw = JSON.stringify(state);
    if (isBrowserStorage()) localStorage.setItem(STATE_KEY, raw);
    else memoryState = raw;
  } catch {
    // ignore: demo state is best-effort browser storage
  }
}

function fail(message: string): never {
  throw new Error(message);
}

function otherParty(contract: Rec, userId: string): string {
  return contract.proposerUserId === userId ? (contract.partnerUserId as string) : (contract.proposerUserId as string);
}

function contractOf(state: DemoState, id: string): Rec {
  const c = state.contracts.find((x) => x.id === id);
  if (!c) fail('That contract was not found.');
  return c;
}

function visibleProfiles(state: DemoState): Rec[] {
  return state.profiles.filter(
    (p) => p.userId !== ME && !state.blocks.includes(p.userId as string) && !state.passes.includes(p.userId as string),
  );
}

function applyFilters(profiles: Rec[], query: string): Rec[] {
  const params = new URLSearchParams(query);
  return profiles.filter((p) => {
    const role = params.get('role');
    const petType = params.get('petType');
    const meetingMode = params.get('meetingMode');
    const region = params.get('region');
    if (role && p.role !== role) return false;
    if (petType && p.petType !== petType) return false;
    if (meetingMode && p.meetingMode !== meetingMode) return false;
    if (region && !String(p.region ?? '').toLowerCase().includes(region.toLowerCase())) return false;
    return true;
  });
}

/** Handle one API-style call against the in-browser demo backend. */
export function demoRequest(path: string, method: string, body?: unknown): Rec {
  const state = load();
  const b = (body ?? {}) as Rec;
  const [rawPath, query] = path.split('?');
  const parts = rawPath.split('/').filter(Boolean); // ['api','v1',...]
  const rest = parts.slice(2);

  const finish = (data: Rec): Rec => {
    save(state);
    return data;
  };

  // --- auth ---
  if (rest[0] === 'auth' && rest[1] === 'request-code' && method === 'POST') {
    if (b.inviteCode !== DEMO_INVITE_CODE) fail('Demo invite code is TEST.');
    const dob = String(b.dateOfBirth ?? '');
    const birth = new Date(dob).getTime();
    if (!birth || Date.now() - birth < 18 * 365.25 * 24 * 3600 * 1000) fail('You must be 18 or older to use Den & Desk.');
    state.email = String(b.email ?? '');
    return finish({ devCode: DEMO_CODE });
  }
  if (rest[0] === 'auth' && rest[1] === 'verify-code' && method === 'POST') {
    if (b.code !== DEMO_CODE) fail('That demo code is not correct. In demo mode the code is 123456.');
    state.email = String(b.email ?? state.email ?? '');
    return finish({ token: DEMO_TOKEN, profile: state.profile });
  }

  // --- profiles ---
  if (rest[0] === 'profiles' && rest[1] === 'me') {
    return { profile: state.profile, isModerator: false };
  }
  if (rest[0] === 'profiles' && method === 'GET' && rest.length === 1) {
    return { profiles: applyFilters(visibleProfiles(state), query ?? '') };
  }
  if (rest[0] === 'profiles' && method === 'POST') {
    const profile: Rec = {
      id: 'demo-profile',
      userId: ME,
      displayName: String(b.displayName ?? 'Demo Tester'),
      role: b.role ?? 'Pet',
      petType: b.petType ?? null,
      meetingMode: b.meetingMode ?? 'Both',
      region: b.region ?? null,
    };
    state.profile = profile;
    state.profiles = [...seededProfiles(), profile];
    return finish({ profile });
  }

  if (rest[0] === 'likes' && method === 'GET') return { likes: state.likes.map((likedUserId) => ({ likedUserId })) };
  if (rest[0] === 'likes' && method === 'POST') {
    if (!state.likes.includes(String(b.likedUserId))) state.likes.push(String(b.likedUserId));
    return finish({});
  }
  if (rest[0] === 'likes' && method === 'DELETE') {
    state.likes = state.likes.filter((x) => x !== rest[1]);
    return finish({});
  }
  if (rest[0] === 'passes' && method === 'POST') {
    if (!state.passes.includes(String(b.passedUserId))) state.passes.push(String(b.passedUserId));
    return finish({});
  }
  if (rest[0] === 'blocks' && method === 'POST') {
    if (!state.blocks.includes(String(b.blockedUserId))) state.blocks.push(String(b.blockedUserId));
    return finish({});
  }
  if (rest[0] === 'reports' && method === 'POST') {
    state.reports.push({ category: b.category, details: b.details, reportedUserId: b.reportedUserId, urgent: b.category === 'safety' });
    return finish({});
  }
  if (rest[0] === 'reports' && rest[1] === 'queue') return { reports: [] };
  if (rest[0] === 'reports' && rest[2] === 'resolve') {
    const r = state.reports.find((x) => x.id === rest[1]);
    if (r) r.status = 'resolved';
    return finish({});
  }
  if (rest[0] === 'ratings' && method === 'POST') {
    state.ratings.push({ note: b.note, ratedUserId: b.ratedUserId, score: b.score });
    return finish({ trust: { averageScore: Number(b.score), badge: null, mutualRaterCount: 0 } });
  }

  // --- messages ---
  if (rest[0] === 'messages' && rest[1] === 'threads' && method === 'GET' && rest.length === 2) {
    const threads = Object.entries(state.threads).map(([partnerUserId, msgs]) => ({
      partnerUserId,
      partnerProfile: state.profiles.find((p) => p.userId === partnerUserId) ?? null,
      lastMessage: msgs[msgs.length - 1] ?? { body: '', senderUserId: ME },
      unreadCount: 0,
    }));
    return { threads };
  }
  if (rest[0] === 'messages' && rest[1] === 'threads' && rest.length === 3) {
    return { messages: state.threads[rest[2]] ?? [] };
  }
  if (rest[0] === 'messages' && method === 'POST') {
    const partner = String(b.recipientUserId);
    const msgs = state.threads[partner] ?? [];
    msgs.push({ body: String(b.body), senderUserId: ME });
    state.threads[partner] = msgs;
    return finish({});
  }

  // --- contracts ---
  if (rest[0] === 'contracts' && method === 'GET' && rest.length === 1) return { contracts: state.contracts };
  if (rest[0] === 'contracts' && method === 'POST' && rest.length === 1) {
    const contract: Rec = {
      id: nid('contract'),
      proposerUserId: ME,
      partnerUserId: String(b.partnerUserId),
      title: String(b.title ?? ''),
      limits: String(b.limits ?? ''),
      safeword: String(b.safeword ?? ''),
      status: 'draft',
      signedUserIds: [],
      resumeUserIds: [],
    };
    state.contracts.push(contract);
    return finish({ contract });
  }
  if (rest[0] === 'contracts' && rest.length >= 3) {
    const contract = contractOf(state, rest[1]);
    const action = rest[2];
    if (action === 'sign') {
      // Demo convenience: the seeded partner auto-signs, so one
      // tester can reach an active contract. Real mode never does this.
      const signed = new Set([...(contract.signedUserIds as string[]), ME, otherParty(contract, ME)]);
      contract.signedUserIds = [...signed];
      if (signed.size >= 2) contract.status = 'active';
      return finish({ contract });
    }
    if (action === 'safeword' || action === 'pause') {
      contract.status = 'paused';
      return finish({ contract });
    }
    if (action === 'resume') {
      contract.status = 'active';
      return finish({ contract });
    }
    if (action === 'end') {
      contract.status = 'ended';
      return finish({ contract });
    }
    if (action === 'duties' && method === 'GET') return { duties: state.duties.filter((d) => d.contractId === rest[1]) };
    if (action === 'duties' && method === 'POST') {
      const duty: Rec = { id: nid('duty'), contractId: rest[1], assignedToUserId: b.assignedToUserId, title: b.title, description: b.description, status: 'open', proofNote: '', reviewNote: '' };
      state.duties.push(duty);
      return finish({ duty });
    }
    if (action === 'bookings' && method === 'GET') return { bookings: state.bookings.filter((x) => x.contractId === rest[1]) };
    if (action === 'bookings' && method === 'POST') {
      const booking: Rec = { id: nid('booking'), contractId: rest[1], proposerUserId: ME, startAt: b.startAt, endAt: b.endAt, meetingMode: b.meetingMode, region: b.region, workDescription: b.workDescription, status: 'proposed' };
      state.bookings.push(booking);
      return finish({ booking });
    }
    if (action === 'aftercare' && rest[3] === 'plans' && method === 'GET') return { plans: state.plans.filter((x) => x.contractId === rest[1]) };
    if (action === 'aftercare' && rest[3] === 'plans' && method === 'POST') {
      const plan: Rec = { id: nid('plan'), contractId: rest[1], closurePhrase: b.closurePhrase, selfCarePrompts: b.selfCarePrompts, checkInMinutes: b.checkInMinutes };
      state.plans.push(plan);
      return finish({ plan });
    }
    if (action === 'aftercare' && rest[3] === 'checkins' && method === 'POST') {
      const checkin: Rec = { id: nid('aftercare-checkin'), contractId: rest[1], kind: b.kind, note: b.note, dueAt: Date.now(), completedAt: null };
      state.aftercareCheckins.push(checkin);
      return finish({ checkin });
    }
    if (action === 'aftercare' && rest[3] === 'checkins' && method === 'GET') return { checkins: state.aftercareCheckins.filter((x) => x.contractId === rest[1]) };
    if (action === 'video-hellos' && method === 'GET') return { hellos: state.hellos.filter((x) => x.contractId === rest[1]) };
    if (action === 'video-hellos' && method === 'POST') {
      const hello: Rec = { id: nid('hello'), contractId: rest[1], requesterUserId: ME, recipientUserId: otherParty(contractOf(state, rest[1]), ME), message: b.message, status: 'requested' };
      state.hellos.push(hello);
      return finish({ hello });
    }
    if (action === 'checkins' && method === 'GET') return { checkins: state.schedCheckins.filter((x) => x.contractId === rest[1]) };
    if (action === 'checkins' && method === 'POST') {
      const checkin: Rec = { id: nid('sched-checkin'), contractId: rest[1], creatorUserId: ME, recipientUserId: otherParty(contractOf(state, rest[1]), ME), note: b.note, dueAt: b.dueAt, completedAt: null };
      state.schedCheckins.push(checkin);
      return finish({ checkin });
    }
    if (action === 'commands' && method === 'GET') return { commands: state.commands.filter((x) => x.contractId === rest[1]) };
    if (action === 'commands' && method === 'POST') {
      const cmd: Rec = { id: nid('command'), contractId: rest[1], senderUserId: ME, recipientUserId: otherParty(contractOf(state, rest[1]), ME), kind: b.kind, note: b.note, status: 'sent' };
      state.commands.push(cmd);
      return finish({ command: cmd });
    }
    if (action === 'praise' && method === 'GET') return { notes: state.praise.filter((x) => x.contractId === rest[1]) };
    if (action === 'praise' && method === 'POST') {
      const note: Rec = { id: nid('praise'), contractId: rest[1], senderUserId: ME, recipientUserId: otherParty(contractOf(state, rest[1]), ME), kind: b.kind, text: b.text };
      state.praise.push(note);
      return finish({ note });
    }
    if (action === 'wishlist' && method === 'GET') {
      return { items: state.wishlist.filter((w) => w.shared === true) };
    }
    if (action === 'lost' && method === 'POST') {
      const contract = contractOf(state, rest[1]);
      const petUserId = contract.proposerUserId === ME && (state.profile?.role === 'Owner' || true) ? otherParty(contract, ME) : ME;
      const ownerUserId = petUserId === ME ? otherParty(contract, ME) : ME;
      // In demo, a seeded pet is treated as opted in; the user's own
      // opt-in is state.lostOptIn. An owner-side alert for a seeded
      // pet is therefore allowed, mirroring the demo partner rule.
      const alert: Rec = {
        id: nid('lost'),
        contractId: rest[1],
        petUserId,
        ownerUserId,
        petDisplayName: state.profiles.find((p) => p.userId === petUserId)?.displayName ?? 'Demo Pet',
        petType: state.profiles.find((p) => p.userId === petUserId)?.petType ?? null,
        generalArea: String(b.generalArea ?? ''),
        createdAt: Date.now(),
        reward: String(b.reward ?? 'badge'),
        soundEnabled: state.lostSound,
        status: 'lost',
      };
      state.lostAlerts.push(alert);
      return finish({ alert });
    }
  }

  // --- duties / bookings / hellos / checkins by id ---
  if (rest[0] === 'duties' && rest.length === 3) {
    const duty = state.duties.find((d) => d.id === rest[1]);
    if (!duty) fail('That duty was not found.');
    if (rest[2] === 'submit') {
      duty.status = 'submitted';
      duty.proofNote = String((b as Rec).proofNote ?? '');
    } else if (rest[2] === 'approve') duty.status = 'approved';
    else if (rest[2] === 'decline') duty.status = 'declined';
    return finish({ duty });
  }
  if (rest[0] === 'duties' && rest[2] === 'rewards') return finish({});
  if (rest[0] === 'bookings' && rest.length === 3) {
    const booking = state.bookings.find((x) => x.id === rest[1]);
    if (!booking) fail('That booking was not found.');
    booking.status = rest[2] === 'confirm' ? 'confirmed' : rest[2] === 'decline' ? 'declined' : 'cancelled';
    return finish({ booking });
  }
  if (rest[0] === 'aftercare' && rest[1] === 'checkins' && rest[3] === 'complete') {
    const c = state.aftercareCheckins.find((x) => x.id === rest[2]);
    if (c) c.completedAt = Date.now();
    return finish({ checkin: c ?? null });
  }
  if (rest[0] === 'video-hellos' && rest.length === 3) {
    const h = state.hellos.find((x) => x.id === rest[1]);
    if (h) h.status = rest[2] === 'accept' ? 'accepted' : rest[2] === 'decline' ? 'declined' : 'completed';
    return finish({ hello: h ?? null });
  }
  if (rest[0] === 'checkins' && rest[2] === 'complete') {
    const c = state.schedCheckins.find((x) => x.id === rest[1]);
    if (c) c.completedAt = Date.now();
    return finish({ checkin: c ?? null });
  }
  if (rest[0] === 'commands' && rest[2] === 'respond') {
    const c = state.commands.find((x) => x.id === rest[1]);
    if (c) c.status = String(b.status);
    return finish({ command: c ?? null });
  }

  // --- Phase 3 personal ---
  if (rest[0] === 'routine' && method === 'GET') {
    const date = new URLSearchParams(query ?? '').get('date');
    return { items: state.routine.filter((r) => !date || r.date === date) };
  }
  if (rest[0] === 'routine' && rest[1] === 'items' && method === 'POST' && rest.length === 2) {
    const item: Rec = { id: nid('routine'), date: b.date, label: b.label, status: 'open', userId: ME };
    state.routine.push(item);
    return finish({ item });
  }
  if (rest[0] === 'routine' && rest[1] === 'items' && rest[3] === 'respond') {
    const item = state.routine.find((r) => r.id === rest[2]);
    if (item) item.status = String(b.status);
    return finish({ item: item ?? null });
  }
  if (rest[0] === 'wishlist' && method === 'GET') return { items: state.wishlist.filter((w) => w.userId === ME) };
  if (rest[0] === 'wishlist' && method === 'POST') {
    const item: Rec = { id: nid('wish'), userId: ME, category: b.category, label: b.label, note: b.note, shared: Boolean(b.shared) };
    state.wishlist.push(item);
    return finish({ item });
  }
  if (rest[0] === 'wishlist' && method === 'PATCH') {
    const item = state.wishlist.find((w) => w.id === rest[1]);
    if (item) item.shared = Boolean(b.shared);
    return finish({ item: item ?? null });
  }
  if (rest[0] === 'wishlist' && method === 'DELETE') {
    state.wishlist = state.wishlist.filter((w) => w.id !== rest[1]);
    return finish({});
  }
  if (rest[0] === 'lost' && rest.length === 1 && method === 'GET') {
    return { alerts: state.lostAlerts.filter((a) => a.status === 'lost') };
  }
  if (rest[0] === 'lost' && rest[1] === 'nearby') {
    const myArea = state.gameAreas[ME] ?? '';
    const nearby = state.lostAlerts.filter((a) => {
      if (a.status !== 'lost') return false;
      if (a.petUserId === ME) return false;
      return myArea !== '' && state.gameAreas[String(a.petUserId)] === myArea;
    });
    return { alerts: nearby };
  }
  if (rest[0] === 'lost-opt-in' && method === 'GET') return { enabled: state.lostOptIn };
  if (rest[0] === 'lost-opt-in' && method === 'POST') {
    state.lostOptIn = Boolean(b.enabled);
    if (!state.lostOptIn) state.lostAlerts.forEach((a) => { if (a.petUserId === ME && a.status === 'lost') a.status = 'off'; });
    return finish({ enabled: state.lostOptIn });
  }
  if (rest[0] === 'lost-sound' && method === 'GET') return { enabled: state.lostSound };
  if (rest[0] === 'lost-sound' && method === 'POST') {
    state.lostSound = Boolean(b.enabled);
    return finish({ enabled: state.lostSound });
  }
  if (rest[0] === 'game-area' && method === 'GET') return { area: state.gameAreas[ME] ?? null };
  if (rest[0] === 'game-area' && method === 'POST') {
    state.gameAreas[ME] = String(b.area ?? '');
    return finish({ area: state.gameAreas[ME] });
  }
  if (rest[0] === 'lost' && rest.length === 3) {
    const alert = state.lostAlerts.find((a) => a.id === rest[1]);
    if (!alert) fail('That lost alert was not found.');
    if (rest[2] === 'home' || rest[2] === 'off') alert.status = rest[2];
    else if (rest[2] === 'resolve') alert.status = 'owner-resolved';
    else if (rest[2] === 'found') {
      const owner = String(alert.ownerUserId);
      const msgs = state.threads[owner] ?? [];
      msgs.push({ body: 'Demo: I think I found them (in-app only — no meeting, no transport).', senderUserId: ME });
      state.threads[owner] = msgs;
    } else if (rest[2] === 'message') {
      const owner = String(alert.ownerUserId);
      const msgs = state.threads[owner] ?? [];
      msgs.push({ body: String(b.body), senderUserId: ME });
      state.threads[owner] = msgs;
    }
    return finish({ alert });
  }
  if (rest[0] === 'lost' && rest[2] === 'message') {
    const alert = state.lostAlerts.find((a) => a.id === rest[1]);
    if (!alert) fail('That lost alert was not found.');
    const owner = String(alert.ownerUserId);
    const msgs = state.threads[owner] ?? [];
    msgs.push({ body: String(b.body), senderUserId: ME });
    state.threads[owner] = msgs;
    return finish({});
  }

  // --- sittings ---
  if (rest[0] === 'sittings' && method === 'GET' && rest.length === 1) return { sittings: state.sittings };
  if (rest[0] === 'sittings' && method === 'POST' && rest.length === 1) {
    const contract = contractOf(state, String(b.baseContractId));
    const sitting: Rec = {
      id: nid('sitting'),
      baseContractId: b.baseContractId,
      ownerUserId: ME,
      petUserId: otherParty(contract, ME),
      sitterUserId: null,
      status: 'requested',
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      routineSummary: b.routineSummary,
      limits: b.limits,
      safewordNote: b.safewordNote,
      agreedUserIds: [],
      notes: [],
      handoverReport: '',
      badgeAwarded: false,
      endedReason: null,
    };
    state.sittings.push(sitting);
    return finish({ sitting });
  }
  if (rest[0] === 'sittings' && rest.length === 3) {
    const sit = state.sittings.find((s) => s.id === rest[1]);
    if (!sit) fail('That sitting was not found.');
    const action = rest[2];
    if (action === 'apply') sit.sitterUserId = ME;
    else if (action === 'agree') {
      const agreed = new Set([...(sit.agreedUserIds as string[]), ME, String(sit.ownerUserId), String(sit.petUserId)]);
      sit.agreedUserIds = [...agreed];
      // Demo convenience: seeded owner/pet auto-agree, so one tester
      // can start a sit. Real mode requires both real agreements.
      if (agreed.has(String(sit.ownerUserId)) && agreed.has(String(sit.petUserId))) sit.status = 'active';
    } else if (action === 'pause') sit.status = 'paused';
    else if (action === 'resume') sit.status = 'active';
    else if (action === 'reclaim') {
      sit.status = 'ended';
      sit.endedReason = 'reclaimed';
    } else if (action === 'end') {
      sit.status = 'ended';
      sit.endedReason = 'ended';
    } else if (action === 'commands' || action === 'routine-items' || action === 'checkins') {
      (sit.notes as Rec[]).push({ userId: ME, text: `${action}: ${String(b.kind ?? b.label ?? b.note ?? '')}`, createdAt: Date.now() });
    } else if (action === 'handover') sit.handoverReport = String(b.report ?? '');
    else if (action === 'badge') {
      const blocked = state.reports.some((r) => r.reportedUserId === sit.sitterUserId);
      if (blocked) fail('A safety report blocks the sitter badge.');
      sit.badgeAwarded = true;
    }
    return finish({ sitting: sit });
  }

  fail(`Demo backend does not implement ${path}`);
}
