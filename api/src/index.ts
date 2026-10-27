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
  type MeetingMode,
  type PetType,
  type Role,
  type Store,
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
