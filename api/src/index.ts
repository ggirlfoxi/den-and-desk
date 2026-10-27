import express, { type NextFunction, type Request, type Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateCode, hashCode, isAdult, signToken, verifyToken } from './auth';
import { PostgresStore } from './db/postgres';
import {
  InMemoryStore,
  newId,
  type Contract,
  type DiscoveryFilters,
  type LostReward,
  type MeetingMode,
  type OwnerCommandKind,
  type PetType,
  type Role,
  type RoutineLabel,
  type Store,
  type WishlistCategory,
} from './store';

export function inviteCodesFromEnv(): string[] {
  const raw = process.env.INVITE_CODES;
  if (raw && raw.trim().length > 0) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return ['DEN-WELCOME-2026'];
}

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn('WARNING: JWT_SECRET is not set — using a development-only secret. Set JWT_SECRET before any shared deployment.');
    return 'den-and-desk-dev-secret-do-not-use-in-production';
  }
  return secret;
}

export function createApp(store: Store) {
  const app = express();
  app.use(express.json());
  const secret = jwtSecret();
  const allowDevCode = process.env.ALLOW_DEV_CODE === 'true';
  if (allowDevCode && process.env.NODE_ENV === 'production') {
    console.warn('WARNING: ALLOW_DEV_CODE=true in production is unsafe and must be turned off.');
  }

  function authed(req: Request): string | null {
    const header = req.header('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return token ? verifyToken(token, secret) : null;
  }

  // Moderators are named by email in MODERATOR_EMAILS (comma-separated).
  // Until that list is set, nobody can view the safety queue — reports
  // are still stored, urgent ones flagged, but not exposed to users.
  function moderatorEmails(): Set<string> {
    const raw = process.env.MODERATOR_EMAILS ?? '';
    return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  }

  async function isModerator(userId: string): Promise<boolean> {
    const user = await store.getUserById(userId);
    return !!user && moderatorEmails().has(user.email.toLowerCase());
  }

  function requireAuth(req: Request, res: Response, next: NextFunction) {
    const userId = authed(req);
    if (!userId) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    (req as Request & { userId: string }).userId = userId;
    next();
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'den-and-desk-api' });
  });

  app.get('/api/v1/policy', (_req, res) => {
    res.json({
      bestialityBanned: true,
      explicitBehindLogin: true,
      humanPetRoleplayWelcome: true,
      policy:
        'Human pet roleplay is welcome: kitty, puppy, pony, hoods, tails, collars, fetch, and other roleplay between consenting adults. Bestiality — a real non-human animal as a sexual participant — is banned.',
    });
  });

  app.post('/api/v1/auth/request-code', async (req, res) => {
    const { dateOfBirth, email, inviteCode } = req.body as {
      dateOfBirth?: string;
      email?: string;
      inviteCode?: string;
    };
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'A valid email is required.' });
      return;
    }
    if (typeof dateOfBirth !== 'string' || !isAdult(dateOfBirth)) {
      res.status(403).json({ error: 'You must be 18 or older to use Den & Desk.' });
      return;
    }
    // Returning users may request a code without an invite. New signups
    // must present a valid, unused invite code (invite-only beta).
    const existing = await store.getUserByEmail(email);
    if (!existing && (typeof inviteCode !== 'string' || !(await store.isInviteValid(inviteCode)))) {
      res.status(403).json({ error: 'A valid, unused invite code is required. Den & Desk is invite-only in beta.' });
      return;
    }
    const code = generateCode();
    await store.setCode({
      attempts: 0,
      codeHash: hashCode(code),
      email,
      expiresAt: Date.now() + 10 * 60 * 1000,
      inviteCode,
    });
    // Real email delivery is not wired in Phase 0 (no SMTP provider was
    // chosen or paid for). In development the code is logged and, only
    // with ALLOW_DEV_CODE=true, returned so the flow can be tested.
    console.log(`[den-and-desk] email code requested for ${email} (delivery not wired in Phase 0)`);
    res.json({
      message: 'If this email is eligible, a code was sent.',
      ok: true,
      ...(allowDevCode ? { devCode: code } : {}),
    });
  });

  app.post('/api/v1/auth/verify-code', async (req, res) => {
    const { code, email } = req.body as { code?: string; email?: string };
    if (typeof email !== 'string' || typeof code !== 'string') {
      res.status(400).json({ error: 'Email and code are required.' });
      return;
    }
    const pending = await store.getCode(email);
    if (!pending || pending.expiresAt < Date.now() || pending.codeHash !== hashCode(code)) {
      res.status(401).json({ error: 'Invalid or expired code.' });
      return;
    }
    await store.clearCode(email);
    let user = await store.getUserByEmail(email);
    const wasNew = !user;
    if (!user) {
      user = await store.createUser(email);
    }
    if (wasNew && pending.inviteCode) {
      await store.useInvite(pending.inviteCode, user.id);
    }
    await store.verifyUserEmail(user.id);
    const profile = await store.getProfileByUserId(user.id);
    res.json({
      profile: profile ?? null,
      token: signToken(user.id, secret),
      user: { email: user.email, emailVerified: true, id: user.id },
    });
  });

  app.get('/api/v1/profiles/me', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const profile = await store.getProfileByUserId(userId);
    res.json({ isModerator: await isModerator(userId), profile: profile ?? null });
  });

  app.post('/api/v1/profiles', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const { displayName, meetingMode, petType, region, role } = req.body as {
      displayName?: string;
      meetingMode?: string;
      petType?: string;
      region?: string;
      role?: string;
    };
    const existing = await store.getProfileByUserId(userId);
    if (existing) {
      res.status(409).json({ error: 'Profile already exists.' });
      return;
    }
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    if (name.length < 2 || name.length > 30) {
      res.status(400).json({ error: 'Display name must be 2 to 30 characters. Use a pseudonym — never your real name.' });
      return;
    }
    if (!['Owner', 'Pet', 'Switch', 'Curious'].includes(role ?? '')) {
      res.status(400).json({ error: 'Role must be Owner, Pet, Switch, or Curious.' });
      return;
    }
    if (role === 'Pet' && !petType) {
      res.status(400).json({ error: 'Pets choose a pet type at launch: Kitty or Puppy.' });
      return;
    }
    if (petType && !['Kitty', 'Puppy'].includes(petType)) {
      res.status(400).json({ error: 'Only Kitty and Puppy are available at launch. Other pet types are a later phase.' });
      return;
    }
    if (meetingMode && !['Online', 'InPerson', 'Both'].includes(meetingMode)) {
      res.status(400).json({ error: 'Meeting mode must be Online, InPerson, or Both.' });
      return;
    }
    // Region is a free-form, user-typed label (e.g. "Tri-Cities BC") —
    // never a street address and never geocoded. Keep it short.
    const regionText = typeof region === 'string' ? region.trim() : '';
    if (regionText.length > 60) {
      res.status(400).json({ error: 'Region must be 60 characters or fewer.' });
      return;
    }
    const profile = {
      displayName: name,
      id: newId('profile'),
      meetingMode: (meetingMode as MeetingMode) ?? 'Both',
      petType: (petType as PetType) ?? null,
      region: regionText || null,
      role: role as Role,
      userId,
    };
    await store.createProfile(profile);
    res.status(201).json({ profile });
  });

  app.get('/api/v1/profiles', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const { meetingMode, petType, region, role } = req.query as Record<string, string | undefined>;
    const filters: DiscoveryFilters = {};
    if (role !== undefined) {
      if (!['Owner', 'Pet', 'Switch', 'Curious'].includes(role)) {
        res.status(400).json({ error: 'Role filter must be Owner, Pet, Switch, or Curious.' });
        return;
      }
      filters.role = role as Role;
    }
    if (petType !== undefined) {
      if (!['Kitty', 'Puppy'].includes(petType)) {
        res.status(400).json({ error: 'Pet type filter must be Kitty or Puppy.' });
        return;
      }
      filters.petType = petType as PetType;
    }
    if (meetingMode !== undefined) {
      if (!['Online', 'InPerson', 'Both'].includes(meetingMode)) {
        res.status(400).json({ error: 'Meeting mode filter must be Online, InPerson, or Both.' });
        return;
      }
      filters.meetingMode = meetingMode as MeetingMode;
    }
    if (region !== undefined && region.trim().length > 0) filters.region = region.trim();
    // Blocking severs both ways in discovery: people you blocked and
    // people who blocked you are both hidden from you.
    const involving = await store.blocksInvolving(userId);
    const blocked = new Set(
      involving.map((b) => (b.blockerUserId === userId ? b.blockedUserId : b.blockerUserId)),
    );
    const passes = await store.passesByUser(userId);
    const passed = new Set(passes.map((p) => p.passedUserId));
    const profiles = await store.listProfiles(userId, blocked, { filters, passedUserIds: passed });
    const withTrust = await Promise.all(
      profiles.map(async (p) => ({ ...p, trust: await store.trustSummary(p.userId) })),
    );
    res.json({ profiles: withTrust });
  });

  app.post('/api/v1/blocks', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const { blockedUserId } = req.body as { blockedUserId?: string };
    if (typeof blockedUserId !== 'string' || blockedUserId === userId) {
      res.status(400).json({ error: 'A different, valid user id is required to block.' });
      return;
    }
    const target = await store.getUserById(blockedUserId);
    if (!target) {
      res.status(404).json({ error: 'That user was not found.' });
      return;
    }
    await store.addBlock({ blockedUserId, blockerUserId: userId, id: newId('block') });
    res.status(201).json({ ok: true });
  });

  app.get('/api/v1/blocks', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    res.json({ blocks: await store.blocksByUser(userId) });
  });

  app.post('/api/v1/reports', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const { category, details, reportedUserId } = req.body as {
      category?: string;
      details?: string;
      reportedUserId?: string;
    };
    if (typeof reportedUserId !== 'string' || reportedUserId === userId) {
      res.status(400).json({ error: 'A different, valid user id is required to report.' });
      return;
    }
    const target = await store.getUserById(reportedUserId);
    if (!target) {
      res.status(404).json({ error: 'That user was not found.' });
      return;
    }
    const report = {
      category: category ?? 'other',
      createdAt: Date.now(),
      details: details ?? '',
      id: newId('report'),
      reportedUserId,
      reporterUserId: userId,
      status: 'open' as const,
      urgent: category === 'safety',
    };
    await store.addReport(report);
    res.status(201).json({ report });
  });

  // ---- Phase 1: like / pass ----
  async function blockedEitherWay(a: string, b: string): Promise<boolean> {
    const involving = await store.blocksInvolving(a);
    return involving.some(
      (x) => (x.blockerUserId === a && x.blockedUserId === b) || (x.blockerUserId === b && x.blockedUserId === a),
    );
  }

  app.post('/api/v1/likes', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const { likedUserId } = req.body as { likedUserId?: string };
    if (typeof likedUserId !== 'string' || likedUserId === userId) {
      res.status(400).json({ error: 'A different, valid user id is required to like.' });
      return;
    }
    if (!(await store.getUserById(likedUserId))) {
      res.status(404).json({ error: 'That user was not found.' });
      return;
    }
    if (await blockedEitherWay(userId, likedUserId)) {
      res.status(403).json({ error: 'You cannot like someone you are blocked from.' });
      return;
    }
    await store.addLike({ id: newId('like'), likedUserId, likerUserId: userId });
    res.status(201).json({ ok: true });
  });

  app.get('/api/v1/likes', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    res.json({ likes: await store.likesByUser(userId) });
  });

  app.delete('/api/v1/likes/:userId', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    await store.removeLike(userId, req.params.userId);
    res.json({ ok: true });
  });

  app.post('/api/v1/passes', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const { passedUserId } = req.body as { passedUserId?: string };
    if (typeof passedUserId !== 'string' || passedUserId === userId) {
      res.status(400).json({ error: 'A different, valid user id is required to pass.' });
      return;
    }
    if (!(await store.getUserById(passedUserId))) {
      res.status(404).json({ error: 'That user was not found.' });
      return;
    }
    // Passing only hides someone from your own discovery. It is not a
    // block: it does not stop them messaging you, and it is not shown
    // to them. Use Block for that.
    await store.addPass({ id: newId('pass'), passedUserId, passerUserId: userId });
    res.status(201).json({ ok: true });
  });

  app.get('/api/v1/passes', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    res.json({ passes: await store.passesByUser(userId) });
  });

  // ---- Phase 1: fixed mailbox messaging ----
  // One thread per pair of users, in the fixed mailbox. Messaging is
  // NOT match-gated: any two registered, non-blocked users can message
  // each other. Likes and passes only shape discovery. This is a
  // deliberate choice, documented in the README, so nobody assumes a
  // like is required before a message can be sent.
  app.post('/api/v1/messages', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const { body, recipientUserId } = req.body as { body?: string; recipientUserId?: string };
    if (typeof recipientUserId !== 'string' || recipientUserId === userId) {
      res.status(400).json({ error: 'A different, valid user id is required to message.' });
      return;
    }
    if (typeof body !== 'string' || body.trim().length < 1 || body.length > 2000) {
      res.status(400).json({ error: 'Message must be 1 to 2000 characters.' });
      return;
    }
    if (!(await store.getUserById(recipientUserId))) {
      res.status(404).json({ error: 'That user was not found.' });
      return;
    }
    if (await blockedEitherWay(userId, recipientUserId)) {
      res.status(403).json({ error: 'You cannot message someone you are blocked from.' });
      return;
    }
    const message = {
      body,
      createdAt: Date.now(),
      id: newId('message'),
      readAt: null,
      recipientUserId,
      senderUserId: userId,
    };
    await store.addMessage(message);
    res.status(201).json({ message });
  });

  app.get('/api/v1/messages/threads', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const involving = await store.blocksInvolving(userId);
    const blocked = new Set(
      involving.map((b) => (b.blockerUserId === userId ? b.blockedUserId : b.blockerUserId)),
    );
    const all = await store.messagesForUser(userId);
    const byPartner = new Map<string, { lastMessage: (typeof all)[number]; unreadCount: number }>();
    for (const m of all) {
      const partner = m.senderUserId === userId ? m.recipientUserId : m.senderUserId;
      if (blocked.has(partner)) continue;
      const entry = byPartner.get(partner) ?? { lastMessage: m, unreadCount: 0 };
      entry.lastMessage = m;
      if (m.recipientUserId === userId && m.readAt === null) entry.unreadCount += 1;
      byPartner.set(partner, entry);
    }
    const threads = await Promise.all(
      [...byPartner.entries()].map(async ([partnerUserId, entry]) => ({
        lastMessage: entry.lastMessage,
        partnerProfile: (await store.getProfileByUserId(partnerUserId)) ?? null,
        partnerUserId,
        unreadCount: entry.unreadCount,
      })),
    );
    threads.sort((a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt);
    res.json({ threads });
  });

  app.get('/api/v1/messages/threads/:partnerUserId', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const partnerUserId = req.params.partnerUserId;
    if (await blockedEitherWay(userId, partnerUserId)) {
      res.status(403).json({ error: 'You cannot view messages with someone you are blocked from.' });
      return;
    }
    const messages = await store.messagesBetween(userId, partnerUserId);
    await store.markThreadRead(userId, partnerUserId);
    res.json({ messages, partnerProfile: (await store.getProfileByUserId(partnerUserId)) ?? null });
  });

  // ---- Phase 1: mutual-rating trust badges ----
  app.post('/api/v1/ratings', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const { note, ratedUserId, score } = req.body as { note?: string; ratedUserId?: string; score?: number };
    if (typeof ratedUserId !== 'string' || ratedUserId === userId) {
      res.status(400).json({ error: 'A different, valid user id is required to rate.' });
      return;
    }
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
      res.status(400).json({ error: 'Score must be a whole number from 1 to 5.' });
      return;
    }
    const noteText = typeof note === 'string' ? note.trim() : '';
    if (noteText.length > 200) {
      res.status(400).json({ error: 'Rating note must be 200 characters or fewer.' });
      return;
    }
    if (!(await store.getUserById(ratedUserId))) {
      res.status(404).json({ error: 'That user was not found.' });
      return;
    }
    if (await blockedEitherWay(userId, ratedUserId)) {
      res.status(403).json({ error: 'You cannot rate someone you are blocked from.' });
      return;
    }
    // One rating per direction; rating again replaces the earlier one.
    await store.upsertRating({ id: newId('rating'), note: noteText, ratedUserId, raterUserId: userId, score });
    res.status(201).json({ trust: await store.trustSummary(ratedUserId) });
  });

  app.get('/api/v1/trust/:userId', requireAuth, async (req, res) => {
    const target = req.params.userId;
    if (!(await store.getUserById(target))) {
      res.status(404).json({ error: 'That user was not found.' });
      return;
    }
    res.json({ trust: await store.trustSummary(target) });
  });

  // ---- Phase 1: moderator safety queue ----
  app.get('/api/v1/reports/queue', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    if (!(await isModerator(userId))) {
      res.status(403).json({ error: 'The safety queue is moderator-only.' });
      return;
    }
    const open = (await store.listReports()).filter((r) => r.status === 'open');
    const withProfiles = await Promise.all(
      open.map(async (r) => ({
        ...r,
        reportedProfile: (await store.getProfileByUserId(r.reportedUserId)) ?? null,
        reporterProfile: (await store.getProfileByUserId(r.reporterUserId)) ?? null,
      })),
    );
    res.json({ reports: withProfiles });
  });

  app.post('/api/v1/reports/:id/resolve', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    if (!(await isModerator(userId))) {
      res.status(403).json({ error: 'Resolving reports is moderator-only.' });
      return;
    }
    const ok = await store.updateReportStatus(req.params.id, 'resolved');
    if (!ok) {
      res.status(404).json({ error: 'That report was not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // ---- Phase 2: contracts, duties, rewards, bookings, aftercare,
  // video-hello requests, scheduled check-ins ----
  // Safety rules shared by these endpoints: a contract's two parties are
  // the only people who can see or change it; a block between them
  // stops new activity (403) but never stops an escape — ending a
  // contract, using a safeword, or pausing always still works.
  function isParticipant(contract: { proposerUserId: string; partnerUserId: string }, userId: string): boolean {
    return contract.proposerUserId === userId || contract.partnerUserId === userId;
  }
  function otherParty(contract: { proposerUserId: string; partnerUserId: string }, userId: string): string {
    return contract.proposerUserId === userId ? contract.partnerUserId : contract.proposerUserId;
  }
  async function loadContract(
    res: Response,
    contractId: string,
    userId: string,
  ): Promise<Contract | null> {
    const contract = await store.getContract(contractId);
    if (!contract) {
      res.status(404).json({ error: 'That contract was not found.' });
      return null;
    }
    if (!isParticipant(contract, userId)) {
      res.status(403).json({ error: 'That contract is not yours.' });
      return null;
    }
    return contract;
  }
  async function blockedPair(contract: { proposerUserId: string; partnerUserId: string }): Promise<boolean> {
    return blockedEitherWay(contract.proposerUserId, contract.partnerUserId);
  }
  // Phase 3 helpers. A lost alert is never a location: it carries only
  // a user-typed general-area label, and it ends the moment the pet
  // checks in, turns it off, uses a safeword, or the contract is
  // paused or ended — whichever comes first.
  async function resolveOpenLostAlert(contractId: string, reason: string): Promise<void> {
    const open = await store.openLostAlertForContract(contractId);
    if (open) {
      open.status = 'resolved';
      open.resolvedReason = reason;
      open.resolvedAt = Date.now();
      await store.updateLostAlert(open);
    }
  }
  async function isOwnerRole(userId: string): Promise<boolean> {
    const profile = await store.getProfileByUserId(userId);
    return profile?.role === 'Owner' || profile?.role === 'Switch';
  }

  app.post('/api/v1/contracts', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const { limits, partnerUserId, safeword, title } = req.body as {
      limits?: string;
      partnerUserId?: string;
      safeword?: string;
      title?: string;
    };
    if (typeof partnerUserId !== 'string' || partnerUserId === userId) {
      res.status(400).json({ error: 'A different, valid user id is required as the other party.' });
      return;
    }
    if (!(await store.getUserById(partnerUserId))) {
      res.status(404).json({ error: 'That user was not found.' });
      return;
    }
    if (await blockedEitherWay(userId, partnerUserId)) {
      res.status(403).json({ error: 'You cannot start a contract with someone you are blocked from.' });
      return;
    }
    const titleText = typeof title === 'string' ? title.trim() : '';
    if (titleText.length < 1 || titleText.length > 80) {
      res.status(400).json({ error: 'Contract title must be 1 to 80 characters.' });
      return;
    }
    const limitsText = typeof limits === 'string' ? limits.trim() : '';
    if (limitsText.length > 2000) {
      res.status(400).json({ error: 'Limits must be 2000 characters or fewer.' });
      return;
    }
    const safewordText = typeof safeword === 'string' ? safeword.trim() : '';
    if (safewordText.length < 1 || safewordText.length > 40) {
      res.status(400).json({ error: 'A safeword of 1 to 40 characters is required.' });
      return;
    }
    const contract = {
      createdAt: Date.now(),
      id: newId('contract'),
      limits: limitsText,
      partnerUserId,
      pausedByUserId: null,
      proposerUserId: userId,
      resumeUserIds: [] as string[],
      safeword: safewordText,
      safewordUsedAt: null,
      signedUserIds: [] as string[],
      status: 'draft' as const,
      title: titleText,
    };
    await store.createContract(contract);
    res.status(201).json({ contract });
  });

  app.get('/api/v1/contracts', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    res.json({ contracts: await store.contractsForUser(userId) });
  });

  app.get('/api/v1/contracts/:id', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    res.json({ contract });
  });

  app.post('/api/v1/contracts/:id/sign', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'draft') {
      res.status(400).json({ error: 'Only a draft contract can be signed.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot sign a contract with someone you are blocked from.' });
      return;
    }
    if (!contract.signedUserIds.includes(userId)) contract.signedUserIds.push(userId);
    if (contract.signedUserIds.includes(contract.proposerUserId) && contract.signedUserIds.includes(contract.partnerUserId)) {
      contract.status = 'active';
    }
    await store.updateContract(contract);
    res.json({ contract });
  });

  app.post('/api/v1/contracts/:id/safeword', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'active' && contract.status !== 'paused') {
      res.status(400).json({ error: 'A safeword only stops an active or paused contract.' });
      return;
    }
    contract.status = 'paused';
    contract.pausedByUserId = userId;
    contract.safewordUsedAt = Date.now();
    contract.resumeUserIds = [];
    await store.updateContract(contract);
    await resolveOpenLostAlert(contract.id, 'safeword');
    res.json({ contract });
  });

  app.post('/api/v1/contracts/:id/pause', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'active') {
      res.status(400).json({ error: 'Only an active contract can be paused.' });
      return;
    }
    contract.status = 'paused';
    contract.pausedByUserId = userId;
    contract.resumeUserIds = [];
    await store.updateContract(contract);
    await resolveOpenLostAlert(contract.id, 'pause');
    res.json({ contract });
  });

  app.post('/api/v1/contracts/:id/resume', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'paused') {
      res.status(400).json({ error: 'Only a paused contract can be resumed.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot resume a contract with someone you are blocked from.' });
      return;
    }
    if (!contract.resumeUserIds.includes(userId)) contract.resumeUserIds.push(userId);
    if (contract.resumeUserIds.includes(contract.proposerUserId) && contract.resumeUserIds.includes(contract.partnerUserId)) {
      contract.status = 'active';
      contract.resumeUserIds = [];
      contract.pausedByUserId = null;
    }
    await store.updateContract(contract);
    res.json({ contract });
  });

  app.post('/api/v1/contracts/:id/end', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status === 'ended') {
      res.status(400).json({ error: 'That contract is already ended.' });
      return;
    }
    contract.status = 'ended';
    contract.resumeUserIds = [];
    await store.updateContract(contract);
    await resolveOpenLostAlert(contract.id, 'end');
    res.json({ contract });
  });

  // ---- Phase 2: duties with photo-proof-style check-ins ----
  // No file upload or photo storage is built in Phase 2: a "proof"
  // check-in is a written note (for example describing the photo the
  // assignee took) that the other party reviews and approves or
  // declines. Photo upload/storage is a later phase — the API and UI
  // never claim a photo was uploaded.
  app.post('/api/v1/contracts/:id/duties', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'active') {
      res.status(400).json({ error: 'Duties can only be created on an active contract.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot add a duty with someone you are blocked from.' });
      return;
    }
    const { assignedToUserId, description, title } = req.body as {
      assignedToUserId?: string;
      description?: string;
      title?: string;
    };
    if (typeof assignedToUserId !== 'string' || !isParticipant(contract, assignedToUserId)) {
      res.status(400).json({ error: 'A duty must be assigned to one of the contract parties.' });
      return;
    }
    const titleText = typeof title === 'string' ? title.trim() : '';
    if (titleText.length < 1 || titleText.length > 120) {
      res.status(400).json({ error: 'Duty title must be 1 to 120 characters.' });
      return;
    }
    const descriptionText = typeof description === 'string' ? description.trim() : '';
    if (descriptionText.length > 1000) {
      res.status(400).json({ error: 'Duty description must be 1000 characters or fewer.' });
      return;
    }
    const duty = {
      assignedToUserId,
      contractId: contract.id,
      createdAt: Date.now(),
      createdByUserId: userId,
      description: descriptionText,
      id: newId('duty'),
      proofNote: '',
      reviewNote: '',
      status: 'open' as const,
      title: titleText,
    };
    await store.createDuty(duty);
    res.status(201).json({ duty });
  });

  app.get('/api/v1/contracts/:id/duties', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    res.json({ duties: await store.dutiesForContract(contract.id) });
  });

  async function loadDuty(res: Response, dutyId: string, userId: string) {
    const duty = await store.getDuty(dutyId);
    if (!duty) {
      res.status(404).json({ error: 'That duty was not found.' });
      return null;
    }
    const contract = await store.getContract(duty.contractId);
    if (!contract || !isParticipant(contract, userId)) {
      res.status(403).json({ error: 'That duty is not yours.' });
      return null;
    }
    return { contract, duty };
  }

  app.post('/api/v1/duties/:id/submit', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadDuty(res, req.params.id, userId);
    if (!found) return;
    const { contract, duty } = found;
    if (duty.assignedToUserId !== userId) {
      res.status(403).json({ error: 'Only the person a duty is assigned to can submit it.' });
      return;
    }
    if (contract.status !== 'active') {
      res.status(400).json({ error: 'Duties can only be submitted on an active contract.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot submit a duty with someone you are blocked from.' });
      return;
    }
    if (duty.status !== 'open') {
      res.status(400).json({ error: 'Only an open duty can be submitted.' });
      return;
    }
    const proofNote = typeof req.body.proofNote === 'string' ? req.body.proofNote.trim() : '';
    if (proofNote.length < 1 || proofNote.length > 500) {
      res.status(400).json({ error: 'A proof note of 1 to 500 characters is required.' });
      return;
    }
    duty.status = 'submitted';
    duty.proofNote = proofNote;
    await store.updateDuty(duty);
    res.json({ duty });
  });

  app.post('/api/v1/duties/:id/approve', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadDuty(res, req.params.id, userId);
    if (!found) return;
    const { contract, duty } = found;
    if (duty.assignedToUserId === userId) {
      res.status(403).json({ error: 'You cannot approve your own duty.' });
      return;
    }
    if (contract.status !== 'active' || duty.status !== 'submitted') {
      res.status(400).json({ error: 'Only a submitted duty on an active contract can be approved.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot approve a duty with someone you are blocked from.' });
      return;
    }
    const reviewNote = typeof req.body.reviewNote === 'string' ? req.body.reviewNote.trim() : '';
    if (reviewNote.length > 500) {
      res.status(400).json({ error: 'Review note must be 500 characters or fewer.' });
      return;
    }
    duty.status = 'approved';
    duty.reviewNote = reviewNote;
    await store.updateDuty(duty);
    res.json({ duty });
  });

  app.post('/api/v1/duties/:id/decline', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadDuty(res, req.params.id, userId);
    if (!found) return;
    const { contract, duty } = found;
    if (duty.assignedToUserId === userId) {
      res.status(403).json({ error: 'You cannot decline your own duty.' });
      return;
    }
    if (contract.status !== 'active' || duty.status !== 'submitted') {
      res.status(400).json({ error: 'Only a submitted duty on an active contract can be declined.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot decline a duty with someone you are blocked from.' });
      return;
    }
    const reviewNote = typeof req.body.reviewNote === 'string' ? req.body.reviewNote.trim() : '';
    if (reviewNote.length > 500) {
      res.status(400).json({ error: 'Review note must be 500 characters or fewer.' });
      return;
    }
    duty.status = 'open';
    duty.proofNote = '';
    duty.reviewNote = reviewNote;
    await store.updateDuty(duty);
    res.json({ duty });
  });

  app.get('/api/v1/duties/:id/rewards', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadDuty(res, req.params.id, userId);
    if (!found) return;
    res.json({ rewards: await store.rewardsForDuty(found.duty.id) });
  });

  app.post('/api/v1/duties/:id/rewards', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadDuty(res, req.params.id, userId);
    if (!found) return;
    const { duty } = found;
    if (duty.status !== 'approved') {
      res.status(400).json({ error: 'A reward can only be granted for an approved duty.' });
      return;
    }
    const existing = await store.rewardsForDuty(duty.id);
    if (existing.length > 0) {
      res.status(409).json({ error: 'That duty already has a reward.' });
      return;
    }
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    if (title.length < 1 || title.length > 120) {
      res.status(400).json({ error: 'Reward title must be 1 to 120 characters.' });
      return;
    }
    const reward = { createdAt: Date.now(), dutyId: duty.id, grantedByUserId: userId, id: newId('reward'), title };
    await store.createReward(reward);
    res.status(201).json({ reward });
  });

  // ---- Phase 2: bookings (general owner/pet scheduling) ----
  app.post('/api/v1/contracts/:id/bookings', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'active') {
      res.status(400).json({ error: 'Bookings can only be created on an active contract.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot book with someone you are blocked from.' });
      return;
    }
    const { endAt, meetingMode, region, startAt, workDescription } = req.body as {
      endAt?: number;
      meetingMode?: string;
      region?: string;
      startAt?: number;
      workDescription?: string;
    };
    if (typeof startAt !== 'number' || typeof endAt !== 'number' || endAt <= startAt) {
      res.status(400).json({ error: 'A booking needs a start time before its end time.' });
      return;
    }
    if (!['Online', 'InPerson', 'Both'].includes(meetingMode ?? '')) {
      res.status(400).json({ error: 'Meeting mode must be Online, InPerson, or Both.' });
      return;
    }
    const regionText = typeof region === 'string' ? region.trim() : '';
    if (regionText.length > 60) {
      res.status(400).json({ error: 'Region must be 60 characters or fewer, and a general area only — never a street address.' });
      return;
    }
    const workText = typeof workDescription === 'string' ? workDescription.trim() : '';
    if (workText.length > 500) {
      res.status(400).json({ error: 'Work description must be 500 characters or fewer.' });
      return;
    }
    const booking = {
      contractId: contract.id,
      createdAt: Date.now(),
      endAt,
      id: newId('booking'),
      startAt,
      meetingMode: meetingMode as 'Online' | 'InPerson' | 'Both',
      proposerUserId: userId,
      region: regionText || null,
      status: 'proposed' as const,
      workDescription: workText,
    };
    await store.createBooking(booking);
    res.status(201).json({ booking });
  });

  app.get('/api/v1/contracts/:id/bookings', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    res.json({ bookings: await store.bookingsForContract(contract.id) });
  });

  async function loadBooking(res: Response, bookingId: string, userId: string) {
    const booking = await store.getBooking(bookingId);
    if (!booking) {
      res.status(404).json({ error: 'That booking was not found.' });
      return null;
    }
    const contract = await store.getContract(booking.contractId);
    if (!contract || !isParticipant(contract, userId)) {
      res.status(403).json({ error: 'That booking is not yours.' });
      return null;
    }
    return { booking, contract };
  }

  app.post('/api/v1/bookings/:id/confirm', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadBooking(res, req.params.id, userId);
    if (!found) return;
    const { booking, contract } = found;
    if (booking.proposerUserId === userId) {
      res.status(403).json({ error: 'You cannot confirm your own booking — the other party confirms it.' });
      return;
    }
    if (contract.status !== 'active' || booking.status !== 'proposed') {
      res.status(400).json({ error: 'Only a proposed booking on an active contract can be confirmed.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot confirm a booking with someone you are blocked from.' });
      return;
    }
    booking.status = 'confirmed';
    await store.updateBooking(booking);
    res.json({ booking });
  });

  app.post('/api/v1/bookings/:id/decline', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadBooking(res, req.params.id, userId);
    if (!found) return;
    const { booking } = found;
    if (booking.proposerUserId === userId) {
      res.status(403).json({ error: 'You cannot decline your own booking — the other party declines it.' });
      return;
    }
    if (booking.status !== 'proposed') {
      res.status(400).json({ error: 'Only a proposed booking can be declined.' });
      return;
    }
    booking.status = 'declined';
    await store.updateBooking(booking);
    res.json({ booking });
  });

  app.post('/api/v1/bookings/:id/cancel', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadBooking(res, req.params.id, userId);
    if (!found) return;
    const { booking } = found;
    if (booking.status !== 'proposed' && booking.status !== 'confirmed') {
      res.status(400).json({ error: 'Only a proposed or confirmed booking can be cancelled.' });
      return;
    }
    booking.status = 'cancelled';
    await store.updateBooking(booking);
    res.json({ booking });
  });

  // ---- Phase 2: aftercare plans and check-ins, incl. long-distance ----
  app.post('/api/v1/contracts/:id/aftercare/plans', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'active' && contract.status !== 'paused') {
      res.status(400).json({ error: 'Aftercare plans can only be made on an active or paused contract.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot make an aftercare plan with someone you are blocked from.' });
      return;
    }
    const { checkInMinutes, closurePhrase, selfCarePrompts } = req.body as {
      checkInMinutes?: number;
      closurePhrase?: string;
      selfCarePrompts?: unknown;
    };
    const phrase = typeof closurePhrase === 'string' ? closurePhrase.trim() : '';
    if (phrase.length < 1 || phrase.length > 200) {
      res.status(400).json({ error: 'A closure phrase of 1 to 200 characters is required (for example, "scene over, welcome back").' });
      return;
    }
    if (!Array.isArray(selfCarePrompts) || selfCarePrompts.length > 10 || selfCarePrompts.some((p) => typeof p !== 'string' || p.trim().length < 1 || p.trim().length > 200)) {
      res.status(400).json({ error: 'Self-care prompts must be up to 10 short lines, each 1 to 200 characters.' });
      return;
    }
    if (typeof checkInMinutes !== 'number' || !Number.isInteger(checkInMinutes) || checkInMinutes < 0 || checkInMinutes > 1440) {
      res.status(400).json({ error: 'Check-in delay must be a whole number of minutes from 0 to 1440.' });
      return;
    }
    const plan = {
      checkInMinutes,
      closurePhrase: phrase,
      contractId: contract.id,
      createdAt: Date.now(),
      createdByUserId: userId,
      id: newId('aftercare-plan'),
      selfCarePrompts: (selfCarePrompts as string[]).map((p) => p.trim()),
    };
    await store.createAftercarePlan(plan);
    res.status(201).json({ plan });
  });

  app.get('/api/v1/contracts/:id/aftercare/plans', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    res.json({ plans: await store.aftercarePlansForContract(contract.id) });
  });

  app.post('/api/v1/contracts/:id/aftercare/checkins', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'active' && contract.status !== 'paused') {
      res.status(400).json({ error: 'Aftercare check-ins can only be made on an active or paused contract.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot make an aftercare check-in with someone you are blocked from.' });
      return;
    }
    const { dueAt, kind, note, planId } = req.body as { dueAt?: number; kind?: string; note?: string; planId?: string };
    if (kind !== 'prompt' && kind !== 'scheduled') {
      res.status(400).json({ error: 'Check-in kind must be prompt or scheduled.' });
      return;
    }
    const noteText = typeof note === 'string' ? note.trim() : '';
    if (noteText.length > 500) {
      res.status(400).json({ error: 'Check-in note must be 500 characters or fewer.' });
      return;
    }
    let plan = null;
    if (planId) {
      const plans = await store.aftercarePlansForContract(contract.id);
      plan = plans.find((p) => p.id === planId) ?? null;
      if (!plan) {
        res.status(404).json({ error: 'That aftercare plan was not found on this contract.' });
        return;
      }
    }
    const due = kind === 'prompt' ? Date.now() : typeof dueAt === 'number' ? dueAt : Date.now() + (plan ? plan.checkInMinutes : 60) * 60 * 1000;
    const checkin = {
      contractId: contract.id,
      createdAt: Date.now(),
      createdByUserId: userId,
      dueAt: due,
      id: newId('aftercare-checkin'),
      kind: kind as 'prompt' | 'scheduled',
      note: noteText,
      planId: plan ? plan.id : null,
      completedAt: null,
    };
    await store.createAftercareCheckin(checkin);
    res.status(201).json({ checkin });
  });

  app.get('/api/v1/contracts/:id/aftercare/checkins', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    const all = await store.aftercareCheckinsForContract(contract.id);
    const dueOnly = req.query.due === 'true';
    res.json({ checkins: dueOnly ? all.filter((c) => c.completedAt === null && c.dueAt <= Date.now()) : all });
  });

  app.post('/api/v1/aftercare/checkins/:id/complete', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const checkin = await store.getAftercareCheckin(req.params.id);
    if (!checkin) {
      res.status(404).json({ error: 'That check-in was not found.' });
      return;
    }
    const contract = await store.getContract(checkin.contractId);
    if (!contract || !isParticipant(contract, userId)) {
      res.status(403).json({ error: 'That check-in is not yours.' });
      return;
    }
    if (checkin.completedAt !== null) {
      res.status(400).json({ error: 'That check-in is already completed.' });
      return;
    }
    checkin.completedAt = Date.now();
    await store.updateAftercareCheckin(checkin);
    res.json({ checkin });
  });

  // ---- Phase 2: video-hello requests and scheduled check-ins ----
  // A video-hello is a request/accept flow only. No video call is built
  // in Phase 2 (no WebRTC) — the parties use their own call tool once
  // a request is accepted. The API and UI never claim a call happened
  // inside Den & Desk.
  app.post('/api/v1/contracts/:id/video-hellos', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'active' && contract.status !== 'paused') {
      res.status(400).json({ error: 'Video-hello requests can only be made on an active or paused contract.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot request a video hello with someone you are blocked from.' });
      return;
    }
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (message.length > 500) {
      res.status(400).json({ error: 'Video-hello message must be 500 characters or fewer.' });
      return;
    }
    const hello = {
      contractId: contract.id,
      createdAt: Date.now(),
      id: newId('video-hello'),
      message,
      recipientUserId: otherParty(contract, userId),
      requesterUserId: userId,
      status: 'requested' as const,
    };
    await store.createVideoHello(hello);
    res.status(201).json({ hello });
  });

  app.get('/api/v1/contracts/:id/video-hellos', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    res.json({ hellos: await store.videoHellosForContract(contract.id) });
  });

  async function loadVideoHello(res: Response, helloId: string, userId: string) {
    const hello = await store.getVideoHello(helloId);
    if (!hello) {
      res.status(404).json({ error: 'That video-hello request was not found.' });
      return null;
    }
    const contract = await store.getContract(hello.contractId);
    if (!contract || !isParticipant(contract, userId)) {
      res.status(403).json({ error: 'That video-hello request is not yours.' });
      return null;
    }
    return { contract, hello };
  }

  app.post('/api/v1/video-hellos/:id/accept', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadVideoHello(res, req.params.id, userId);
    if (!found) return;
    const { hello } = found;
    if (hello.recipientUserId !== userId) {
      res.status(403).json({ error: 'Only the recipient can accept a video-hello request.' });
      return;
    }
    if (hello.status !== 'requested') {
      res.status(400).json({ error: 'Only a requested video hello can be accepted.' });
      return;
    }
    hello.status = 'accepted';
    await store.updateVideoHello(hello);
    res.json({ hello });
  });

  app.post('/api/v1/video-hellos/:id/decline', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadVideoHello(res, req.params.id, userId);
    if (!found) return;
    const { hello } = found;
    if (hello.recipientUserId !== userId) {
      res.status(403).json({ error: 'Only the recipient can decline a video-hello request.' });
      return;
    }
    if (hello.status !== 'requested') {
      res.status(400).json({ error: 'Only a requested video hello can be declined.' });
      return;
    }
    hello.status = 'declined';
    await store.updateVideoHello(hello);
    res.json({ hello });
  });

  app.post('/api/v1/video-hellos/:id/complete', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadVideoHello(res, req.params.id, userId);
    if (!found) return;
    const { hello } = found;
    if (hello.status !== 'accepted') {
      res.status(400).json({ error: 'Only an accepted video hello can be completed.' });
      return;
    }
    hello.status = 'completed';
    await store.updateVideoHello(hello);
    res.json({ hello });
  });

  app.post('/api/v1/contracts/:id/checkins', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'active' && contract.status !== 'paused') {
      res.status(400).json({ error: 'Scheduled check-ins can only be made on an active or paused contract.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot schedule a check-in with someone you are blocked from.' });
      return;
    }
    const { dueAt, note } = req.body as { dueAt?: number; note?: string };
    if (typeof dueAt !== 'number' || dueAt <= 0) {
      res.status(400).json({ error: 'A scheduled check-in needs a due time.' });
      return;
    }
    const noteText = typeof note === 'string' ? note.trim() : '';
    if (noteText.length > 500) {
      res.status(400).json({ error: 'Check-in note must be 500 characters or fewer.' });
      return;
    }
    const checkin = {
      contractId: contract.id,
      createdAt: Date.now(),
      creatorUserId: userId,
      dueAt,
      id: newId('scheduled-checkin'),
      note: noteText,
      recipientUserId: otherParty(contract, userId),
      completedAt: null,
    };
    await store.createScheduledCheckin(checkin);
    res.status(201).json({ checkin });
  });

  app.get('/api/v1/contracts/:id/checkins', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    res.json({ checkins: await store.scheduledCheckinsForContract(contract.id) });
  });

  app.post('/api/v1/checkins/:id/complete', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const checkin = await store.getScheduledCheckin(req.params.id);
    if (!checkin) {
      res.status(404).json({ error: 'That check-in was not found.' });
      return;
    }
    const contract = await store.getContract(checkin.contractId);
    if (!contract || !isParticipant(contract, userId)) {
      res.status(403).json({ error: 'That check-in is not yours.' });
      return;
    }
    if (checkin.completedAt !== null) {
      res.status(400).json({ error: 'That check-in is already completed.' });
      return;
    }
    checkin.completedAt = Date.now();
    await store.updateScheduledCheckin(checkin);
    res.json({ checkin });
  });

  // ---- Phase 3: owner commands, routine, wishlist, lost alerts, praise ----
  // Commands and praise live only inside an active contract and never
  // override a safeword, a pause, a block, or a contract end. Cage time
  // is framed as cozy den / quiet time, never as confinement punishment.
  const COMMAND_KINDS = ['Come home', 'Bedtime', 'Cage time', 'Eat', 'Walk', 'Potty break'];
  app.post('/api/v1/contracts/:id/commands', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'active') {
      res.status(400).json({ error: 'Commands can only be sent on an active contract.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot send a command to someone you are blocked from.' });
      return;
    }
    if (!(await isOwnerRole(userId))) {
      res.status(403).json({ error: 'Only the owner side of a contract can send commands.' });
      return;
    }
    const kind = req.body.kind as string | undefined;
    if (!kind || !COMMAND_KINDS.includes(kind)) {
      res.status(400).json({ error: 'Command must be one of: Come home, Bedtime, Cage time, Eat, Walk, Potty break.' });
      return;
    }
    const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
    if (note.length > 200) {
      res.status(400).json({ error: 'Command note must be 200 characters or fewer.' });
      return;
    }
    const command = {
      contractId: contract.id,
      createdAt: Date.now(),
      id: newId('command'),
      kind: kind as OwnerCommandKind,
      note,
      recipientUserId: otherParty(contract, userId),
      respondedAt: null,
      senderUserId: userId,
      status: 'sent' as const,
    };
    await store.createOwnerCommand(command);
    res.status(201).json({ command });
  });

  app.get('/api/v1/contracts/:id/commands', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot view commands with someone you are blocked from.' });
      return;
    }
    res.json({ commands: await store.ownerCommandsForContract(contract.id) });
  });

  app.post('/api/v1/commands/:id/respond', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const command = await store.getOwnerCommand(req.params.id);
    if (!command) {
      res.status(404).json({ error: 'That command was not found.' });
      return;
    }
    const contract = await store.getContract(command.contractId);
    if (!contract || !isParticipant(contract, userId)) {
      res.status(403).json({ error: 'That command is not yours.' });
      return;
    }
    if (command.recipientUserId !== userId) {
      res.status(403).json({ error: 'Only the pet a command was sent to can respond to it.' });
      return;
    }
    if (command.status !== 'sent') {
      res.status(400).json({ error: 'That command has already been answered.' });
      return;
    }
    if (contract.status !== 'active') {
      res.status(400).json({ error: 'Commands can only be answered on an active contract.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot answer a command from someone you are blocked from.' });
      return;
    }
    const status = req.body.status as string | undefined;
    if (status !== 'done' && status !== 'need-help' && status !== 'passed') {
      res.status(400).json({ error: 'A command response must be done, need-help, or passed (excused).' });
      return;
    }
    command.status = status;
    command.respondedAt = Date.now();
    await store.updateOwnerCommand(command);
    res.json({ command });
  });

  // ---- Phase 3: daily pet-care routine ----
  // A template for the day, not a streak: Eat, Walk, Potty, Nap, Play.
  // Pass is excused, and nothing punishes a missed or passed item.
  const ROUTINE_LABELS = ['Eat', 'Walk', 'Potty', 'Nap', 'Play'];
  app.get('/api/v1/routine', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : new Date().toISOString().slice(0, 10);
    res.json({ date, items: await store.routineItemsForUserOnDate(userId, date) });
  });

  app.post('/api/v1/routine/items', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const date = typeof req.body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
      ? req.body.date
      : new Date().toISOString().slice(0, 10);
    if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      res.status(400).json({ error: 'Date must be a real YYYY-MM-DD date.' });
      return;
    }
    const label = req.body.label as string | undefined;
    if (!label || !ROUTINE_LABELS.includes(label)) {
      res.status(400).json({ error: 'Routine item must be one of: Eat, Walk, Potty, Nap, Play.' });
      return;
    }
    const existing = (await store.routineItemsForUserOnDate(userId, date)).find((r) => r.label === label);
    if (existing) {
      res.json({ item: existing });
      return;
    }
    const item = {
      createdAt: Date.now(),
      date,
      id: newId('routine'),
      label: label as RoutineLabel,
      status: 'open' as const,
      userId,
    };
    await store.createRoutineItem(item);
    res.status(201).json({ item });
  });

  app.post('/api/v1/routine/items/:id/respond', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const item = await store.getRoutineItem(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'That routine item was not found.' });
      return;
    }
    if (item.userId !== userId) {
      res.status(403).json({ error: 'That routine item is not yours.' });
      return;
    }
    if (item.status !== 'open') {
      res.status(400).json({ error: 'That routine item has already been answered.' });
      return;
    }
    const status = req.body.status as string | undefined;
    if (status !== 'done' && status !== 'passed') {
      res.status(400).json({ error: 'A routine item can be marked done or passed (excused).' });
      return;
    }
    item.status = status;
    await store.updateRoutineItem(item);
    res.json({ item });
  });

  // ---- Phase 3: gear wishlist (no purchases) ----
  // Private by default. No prices, no checkout, no shop links, no
  // payment of any kind — a wishlist is a list of wants, not a store.
  const WISHLIST_CATEGORIES = ['collar', 'leash', 'outfit', 'den', 'toy', 'other'];
  app.get('/api/v1/wishlist', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    res.json({ items: await store.wishlistForUser(userId) });
  });

  app.post('/api/v1/wishlist', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
    if (label.length < 1 || label.length > 80) {
      res.status(400).json({ error: 'Wishlist item must be 1 to 80 characters.' });
      return;
    }
    const category = req.body.category as string | undefined;
    if (!category || !WISHLIST_CATEGORIES.includes(category)) {
      res.status(400).json({ error: 'Wishlist category must be one of: collar, leash, outfit, den, toy, other.' });
      return;
    }
    const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
    if (note.length > 200) {
      res.status(400).json({ error: 'Wishlist note must be 200 characters or fewer.' });
      return;
    }
    const item = {
      category: category as WishlistCategory,
      createdAt: Date.now(),
      id: newId('wishlist'),
      label,
      note,
      shared: req.body.shared === true,
      userId,
    };
    await store.createWishlistItem(item);
    res.status(201).json({ item });
  });

  app.patch('/api/v1/wishlist/:id', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const item = await store.getWishlistItem(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'That wishlist item was not found.' });
      return;
    }
    if (item.userId !== userId) {
      res.status(403).json({ error: 'That wishlist item is not yours.' });
      return;
    }
    if (typeof req.body.shared !== 'boolean') {
      res.status(400).json({ error: 'Share must be true or false.' });
      return;
    }
    item.shared = req.body.shared;
    await store.updateWishlistItem(item);
    res.json({ item });
  });

  app.delete('/api/v1/wishlist/:id', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const item = await store.getWishlistItem(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'That wishlist item was not found.' });
      return;
    }
    if (item.userId !== userId) {
      res.status(403).json({ error: 'That wishlist item is not yours.' });
      return;
    }
    await store.deleteWishlistItem(item.id);
    res.json({ ok: true });
  });

  app.get('/api/v1/contracts/:id/wishlist', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot view a wishlist with someone you are blocked from.' });
      return;
    }
    const partnerId = otherParty(contract, userId);
    const shared = (await store.wishlistForUser(partnerId)).filter((w) => w.shared);
    res.json({ items: shared });
  });

  // ---- Phase 3: safe lost-pet mode ----
  // Safety rules, enforced here and nowhere else: a lost alert carries
  // only a user-typed general-area label — never a street address,
  // never a precise location, never an auto-detected location. There
  // is no geolocation, GPS, or real-time tracking anywhere in Den &
  // Desk. A helper is never given a location, a phone number, or any
  // private detail, and is never told to meet the pet in person: their
  // only action is an in-app message to the original owner, who
  // decides what happens next. "Brought home" means only that the pet
  // checked in as home, or the owner marked the alert resolved — never
  // that a stranger physically retrieved a person. Lost alerts are
  // visible only to logged-in users, never indexed, and a blocked pair
  // cannot see or message about each other's alerts. Caught protocol
  // (also shown in the UI): DO ask first in-app, respect the safeword
  // instantly, stop if the pet is out of headspace or distressed,
  // contact the original owner in-app first, and let the original
  // owner confirm. DO NOT follow, touch without consent, share a photo
  // or location, approach a pet who is alone and distressed, or
  // transport a person in a vehicle. A pet's in-app tag shows
  // pseudonym and pet type only — never a real name, phone, address,
  // or precise location, and no QR or tag links to a real identity.
  function generalAreaError(area: string): string | null {
    if (area.length < 1 || area.length > 60) return 'General area must be 1 to 60 characters, and a general area only — never a street address.';
    if (/^\d{1,6}\s+\S/.test(area)) return 'That looks like a street address. Use a general area only (for example, a neighbourhood or town).';
    return null;
  }

  app.post('/api/v1/contracts/:id/lost', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'active') {
      res.status(400).json({ error: 'Lost mode can only be turned on for an active contract.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot turn on lost mode with someone you are blocked from.' });
      return;
    }
    if (await store.openLostAlertForContract(contract.id)) {
      res.status(409).json({ error: 'That contract already has an open lost alert.' });
      return;
    }
    const generalArea = typeof req.body.generalArea === 'string' ? req.body.generalArea.trim() : '';
    const areaError = generalAreaError(generalArea);
    if (areaError) {
      res.status(400).json({ error: areaError });
      return;
    }
    // Digital lost poster reward: in-app only. No cash, no payment,
    // no real contact details on the poster, ever.
    const LOST_REWARDS = ['badge', 'thank-you', 'treat', 'wishlist-gift'];
    const reward = typeof req.body.reward === 'string' && LOST_REWARDS.includes(req.body.reward)
      ? (req.body.reward as LostReward)
      : typeof req.body.reward === 'string'
        ? null
        : ('badge' as LostReward);
    if (reward === null) {
      res.status(400).json({ error: 'Reward must be badge, thank-you, treat, or wishlist-gift.' });
      return;
    }
    const creatorProfile = await store.getProfileByUserId(userId);
    const petUserId = creatorProfile?.role === 'Pet' ? userId : otherParty(contract, userId);
    const ownerUserId = petUserId === userId ? otherParty(contract, userId) : userId;
    // Refinement safety rule (safer than the original Phase 3 draft, which
    // let the owner start lost mode for any active contract pet): lost
    // mode is separately opt-in by the pet. An owner may only start it
    // when the pet has opted in. A pet turning lost mode on themselves
    // counts as opting in at that moment, and the pet can end it
    // instantly at any time.
    if (petUserId !== userId && !(await store.getLostOptIn(petUserId))) {
      res.status(403).json({ error: 'The pet has not opted into lost-game mode, so lost mode cannot be started for them.' });
      return;
    }
    if (petUserId === userId) {
      await store.setLostOptIn(petUserId, true);
    }
    const alert = {
      contractId: contract.id,
      createdAt: Date.now(),
      createdByUserId: userId,
      foundAt: null,
      foundByUserId: null,
      generalArea,
      id: newId('lost'),
      ownerUserId,
      petUserId,
      resolvedAt: null,
      resolvedReason: null,
      reward,
      status: 'lost' as const,
    };
    await store.createLostAlert(alert);
    res.status(201).json({ alert });
  });

  app.get('/api/v1/lost', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const open = await store.openLostAlerts();
    const visible = [];
    for (const alert of open) {
      if (await blockedEitherWay(userId, alert.petUserId)) continue;
      if (await blockedEitherWay(userId, alert.ownerUserId)) continue;
      const petProfile = await store.getProfileByUserId(alert.petUserId);
      visible.push({
        contractId: alert.contractId,
        createdAt: alert.createdAt,
        generalArea: alert.generalArea,
        id: alert.id,
        ownerUserId: alert.ownerUserId,
        petDisplayName: petProfile?.displayName ?? 'A pet',
        petType: petProfile?.petType ?? null,
        petUserId: alert.petUserId,
        reward: alert.reward,
        soundEnabled: await store.getLostSound(alert.petUserId),
      });
    }
    res.json({ alerts: visible });
  });

  // Lost-game opt-in is separate from any contract: only the pet's own
  // choice enables lost mode for them. Turning it off also closes any
  // open alert for that pet at once.
  app.get('/api/v1/lost-opt-in', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    res.json({ enabled: await store.getLostOptIn(userId) });
  });

  app.post('/api/v1/lost-opt-in', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    if (typeof req.body.enabled !== 'boolean') {
      res.status(400).json({ error: 'Enabled must be true or false.' });
      return;
    }
    await store.setLostOptIn(userId, req.body.enabled);
    if (!req.body.enabled) {
      const open = (await store.openLostAlerts()).filter((a) => a.petUserId === userId);
      for (const alert of open) {
        alert.status = 'resolved';
        alert.resolvedReason = 'pet-opt-out';
        alert.resolvedAt = Date.now();
        await store.updateLostAlert(alert);
      }
    }
    res.json({ enabled: req.body.enabled });
  });

  // Pet-controlled lost-game sound: the pet can mute it at any time.
  // A finder sound plays only when this is on AND the finder's own
  // device toggle is on AND the alert is open AND both are in the
  // same in-game play area (see game-area endpoints below).
  app.get('/api/v1/lost-sound', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    res.json({ enabled: await store.getLostSound(userId) });
  });

  app.post('/api/v1/lost-sound', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    if (typeof req.body.enabled !== 'boolean') {
      res.status(400).json({ error: 'Enabled must be true or false.' });
      return;
    }
    await store.setLostSound(userId, req.body.enabled);
    res.json({ enabled: req.body.enabled });
  });

  // In-game play area only: the user types a play-area label
  // themselves, or moves their game token to another label. This is
  // never browser geolocation, GPS, watchPosition, or a real distance.
  app.get('/api/v1/game-area', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    res.json({ area: await store.getGameToken(userId) });
  });

  app.post('/api/v1/game-area', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const area = typeof req.body.area === 'string' ? req.body.area.trim() : '';
    if (area.length < 1 || area.length > 60) {
      res.status(400).json({ error: 'Play-area label must be 1 to 60 characters.' });
      return;
    }
    await store.setGameToken(userId, area);
    res.json({ area });
  });

  // Proximity in game mode only: open lost alerts whose pet's game
  // token is in the same play-area label as the caller's token.
  app.get('/api/v1/lost/nearby', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const myArea = await store.getGameToken(userId);
    if (!myArea) {
      res.json({ alerts: [] });
      return;
    }
    const open = await store.openLostAlerts();
    const nearby = [];
    for (const alert of open) {
      if (await blockedEitherWay(userId, alert.petUserId)) continue;
      if (await blockedEitherWay(userId, alert.ownerUserId)) continue;
      if ((await store.getGameToken(alert.petUserId)) !== myArea) continue;
      const petProfile = await store.getProfileByUserId(alert.petUserId);
      nearby.push({
        contractId: alert.contractId,
        createdAt: alert.createdAt,
        generalArea: alert.generalArea,
        id: alert.id,
        ownerUserId: alert.ownerUserId,
        petDisplayName: petProfile?.displayName ?? 'A pet',
        petType: petProfile?.petType ?? null,
        petUserId: alert.petUserId,
        reward: alert.reward,
        soundEnabled: await store.getLostSound(alert.petUserId),
      });
    }
    res.json({ alerts: nearby });
  });

  async function loadLostAlert(res: Response, alertId: string, userId: string) {
    const alert = await store.getLostAlert(alertId);
    if (!alert) {
      res.status(404).json({ error: 'That lost alert was not found.' });
      return null;
    }
    const contract = await store.getContract(alert.contractId);
    if (!contract) {
      res.status(404).json({ error: 'That lost alert was not found.' });
      return null;
    }
    // Board visibility rules apply to actions too: a blocked pair
    // cannot act on each other's alerts, except the pet's own escapes
    // (home/off), which are handled by the callers below before this
    // check would ever matter for a blocked pet — so keep this strict
    // for owner resolve and helper messages, and let pet home/off
    // check the pet identity first in their own handlers.
    void userId;
    return { alert, contract };
  }

  app.post('/api/v1/lost/:id/home', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const alert = await store.getLostAlert(req.params.id);
    if (!alert) {
      res.status(404).json({ error: 'That lost alert was not found.' });
      return;
    }
    if (alert.petUserId !== userId) {
      res.status(403).json({ error: 'Only the pet can check in as home.' });
      return;
    }
    if (alert.status !== 'lost') {
      res.status(400).json({ error: 'That lost alert is already closed.' });
      return;
    }
    alert.status = 'home';
    alert.resolvedReason = 'pet-checkin';
    alert.resolvedAt = Date.now();
    await store.updateLostAlert(alert);
    res.json({ alert });
  });

  app.post('/api/v1/lost/:id/off', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const alert = await store.getLostAlert(req.params.id);
    if (!alert) {
      res.status(404).json({ error: 'That lost alert was not found.' });
      return;
    }
    if (alert.petUserId !== userId) {
      res.status(403).json({ error: 'Only the pet can turn their lost mode off.' });
      return;
    }
    if (alert.status !== 'lost') {
      res.status(400).json({ error: 'That lost alert is already closed.' });
      return;
    }
    alert.status = 'resolved';
    alert.resolvedReason = 'pet-off';
    alert.resolvedAt = Date.now();
    await store.updateLostAlert(alert);
    res.json({ alert });
  });

  app.post('/api/v1/lost/:id/resolve', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadLostAlert(res, req.params.id, userId);
    if (!found) return;
    const { alert } = found;
    if (alert.ownerUserId !== userId) {
      res.status(403).json({ error: 'Only the original owner can mark a lost alert resolved.' });
      return;
    }
    if (alert.status !== 'lost') {
      res.status(400).json({ error: 'That lost alert is already closed.' });
      return;
    }
    if (await blockedEitherWay(userId, alert.petUserId)) {
      res.status(403).json({ error: 'You cannot resolve a lost alert with someone you are blocked from.' });
      return;
    }
    alert.status = 'resolved';
    alert.resolvedReason = 'owner-resolved';
    alert.resolvedAt = Date.now();
    await store.updateLostAlert(alert);
    res.json({ alert });
  });

  // A helper marking "found" is an in-app flag only. It does not close
  // the alert, share any location or private detail, or authorise
  // meeting or transport. The owner still confirms (resolve) and the
  // pet still checks in as home. "Transported home" in this app means
  // only: found marked in-app, owner confirmed, pet checked in as home.
  // The original owner, or the pet themselves, is the only person who
  // physically moves the pet, and only if already agreed separately.
  app.post('/api/v1/lost/:id/found', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadLostAlert(res, req.params.id, userId);
    if (!found) return;
    const { alert } = found;
    if (alert.status !== 'lost') {
      res.status(400).json({ error: 'That lost alert is already closed.' });
      return;
    }
    if (alert.petUserId === userId || alert.ownerUserId === userId) {
      res.status(400).json({ error: 'The pet and owner use home and resolve for this alert; found is for a helper.' });
      return;
    }
    if (await blockedEitherWay(userId, alert.ownerUserId) || await blockedEitherWay(userId, alert.petUserId)) {
      res.status(403).json({ error: 'You cannot mark found on a lost alert with someone you are blocked from.' });
      return;
    }
    if (alert.foundByUserId) {
      res.status(409).json({ error: 'That lost alert is already marked found in-app.' });
      return;
    }
    alert.foundByUserId = userId;
    alert.foundAt = Date.now();
    await store.updateLostAlert(alert);
    // Finder action, unchanged by the poster refinement: tapping
    // "I think I found them" sends an in-app message to the original
    // owner only — no location, no contact details, no meeting, no
    // transport. The owner confirms and the pet checks in as home.
    await store.addMessage({
      body: 'I think I found them — marked found in-app only. I have no location or contact details for the pet, and I will not meet, follow, or transport anyone. Please confirm in-app.',
      createdAt: Date.now(),
      id: newId('msg'),
      readAt: null,
      recipientUserId: alert.ownerUserId,
      senderUserId: userId,
    });
    res.json({ alert: { foundAt: alert.foundAt, foundByUserId: alert.foundByUserId, id: alert.id, status: alert.status } });
  });

  app.post('/api/v1/lost/:id/message', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const found = await loadLostAlert(res, req.params.id, userId);
    if (!found) return;
    const { alert } = found;
    if (alert.status !== 'lost') {
      res.status(400).json({ error: 'That lost alert is already closed.' });
      return;
    }
    if (await blockedEitherWay(userId, alert.ownerUserId) || await blockedEitherWay(userId, alert.petUserId)) {
      res.status(403).json({ error: 'You cannot message about a lost alert with someone you are blocked from.' });
      return;
    }
    const body = typeof req.body.body === 'string' ? req.body.body : '';
    if (body.trim().length < 1 || body.length > 2000) {
      res.status(400).json({ error: 'Message must be 1 to 2000 characters.' });
      return;
    }
    // The helper is told nothing private: no location, no phone, no
    // address. This is an ordinary in-app message to the owner, who
    // decides what happens next. Never meet a stranger in person
    // because of a lost alert.
    const message = {
      body,
      createdAt: Date.now(),
      id: newId('message'),
      readAt: null,
      recipientUserId: alert.ownerUserId,
      senderUserId: userId,
    };
    await store.addMessage(message);
    res.status(201).json({ message });
  });

  // ---- Phase 3: good/bad praise, private between the pair ----
  app.post('/api/v1/contracts/:id/praise', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (contract.status !== 'active') {
      res.status(400).json({ error: 'Praise can only be sent on an active contract.' });
      return;
    }
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot send praise to someone you are blocked from.' });
      return;
    }
    if (!(await isOwnerRole(userId))) {
      res.status(403).json({ error: 'Only the owner side of a contract can send praise or correction notes.' });
      return;
    }
    const kind = req.body.kind as string | undefined;
    if (kind !== 'praise' && kind !== 'correction') {
      res.status(400).json({ error: 'Praise kind must be praise or correction.' });
      return;
    }
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (text.length < 1 || text.length > 200) {
      res.status(400).json({ error: 'Praise text must be 1 to 200 characters.' });
      return;
    }
    const note = {
      contractId: contract.id,
      createdAt: Date.now(),
      id: newId('praise'),
      kind: kind as 'praise' | 'correction',
      recipientUserId: otherParty(contract, userId),
      senderUserId: userId,
      text,
    };
    await store.createPraiseNote(note);
    res.status(201).json({ note });
  });

  app.get('/api/v1/contracts/:id/praise', requireAuth, async (req, res) => {
    const userId = (req as Request & { userId: string }).userId;
    const contract = await loadContract(res, req.params.id, userId);
    if (!contract) return;
    if (await blockedPair(contract)) {
      res.status(403).json({ error: 'You cannot view praise with someone you are blocked from.' });
      return;
    }
    res.json({ notes: await store.praiseNotesForContract(contract.id) });
  });

  return app;
}

export async function buildStore(): Promise<Store> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const pgStore = new PostgresStore(databaseUrl);
    const schema = readFileSync(join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pgStore.init(schema);
    // Seed invite codes that are not already present.
    // (PostgresStore init runs the schema only; seeding is done by the
    // deployer with INSERT ... ON CONFLICT DO NOTHING — see README.)
    return pgStore;
  }
  const codes = inviteCodesFromEnv();
  if (!process.env.INVITE_CODES) {
    console.warn('WARNING: INVITE_CODES is not set — using the development invite code only.');
  }
  console.warn('WARNING: DATABASE_URL is not set — using an in-memory store for local development only. Data does not persist.');
  return new InMemoryStore(codes);
}

if (require.main === module) {
  void (async () => {
    const store = await buildStore();
    const app = createApp(store);
    const port = Number(process.env.PORT ?? 4000);
    app.listen(port, () => {
      console.log(`Den & Desk API listening on port ${port}`);
    });
  })();
}
