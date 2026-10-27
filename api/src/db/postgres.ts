/**
 * PostgreSQL adapter for Den & Desk (schema in schema.sql).
 *
 * Users, profiles, blocks, reports and invite codes live in Postgres.
 * Short-lived email codes (10-minute expiry) are kept in memory even
 * when Postgres is in use, by design — they must not survive a restart.
 *
 * NOTE: this adapter is code-complete but was NOT integration-tested
 * against a live database in Phase 0 or Phase 1, because no Postgres
 * server was available in the build environment and none was
 * provisioned (no paid plan, no hosted account). Run it once against a
 * staging DATABASE_URL before using it for a shared deployment.
 * Phase 1 adds likes, passes, messages and ratings tables; a database
 * created from the Phase 0 schema needs the ALTER / CREATE statements
 * noted at the bottom of schema.sql before Phase 1 code runs against it.
 */
import { Pool } from 'pg';
import type {
  AftercareCheckin,
  AftercarePlan,
  Block,
  Booking,
  Contract,
  Duty,
  Like,
  Message,
  Pass,
  PendingCode,
  Profile,
  Rating,
  Report,
  Reward,
  ScheduledCheckin,
  Store,
  TrustSummary,
  User,
  VideoHello,
} from '../store';
import { badgeFor } from '../store';

function toUser(row: Record<string, unknown>): User {
  return { email: row.email as string, emailVerified: row.email_verified as boolean, id: row.id as string };
}
function toProfile(row: Record<string, unknown>): Profile {
  return {
    displayName: row.display_name as string,
    id: row.id as string,
    meetingMode: (row.meeting_mode as Profile['meetingMode']) ?? 'Both',
    petType: (row.pet_type as Profile['petType']) ?? null,
    region: (row.region as string | null) ?? null,
    role: row.role as Profile['role'],
    userId: row.user_id as string,
  };
}
function toReport(row: Record<string, unknown>): Report {
  return {
    category: row.category as string,
    createdAt: new Date(row.created_at as string).getTime(),
    details: row.details as string,
    id: row.id as string,
    reportedUserId: row.reported_user_id as string,
    reporterUserId: row.reporter_user_id as string,
    status: (row.status as Report['status']) ?? 'open',
    urgent: row.urgent as boolean,
  };
}
function toContract(row: Record<string, unknown>): Contract {
  return {
    createdAt: new Date(row.created_at as string).getTime(),
    id: row.id as string,
    limits: row.limits as string,
    partnerUserId: row.partner_user_id as string,
    pausedByUserId: (row.paused_by_user_id as string | null) ?? null,
    proposerUserId: row.proposer_user_id as string,
    resumeUserIds: (row.resume_user_ids as string[]) ?? [],
    safeword: row.safeword as string,
    safewordUsedAt: row.safeword_used_at ? new Date(row.safeword_used_at as string).getTime() : null,
    signedUserIds: (row.signed_user_ids as string[]) ?? [],
    status: row.status as Contract['status'],
    title: row.title as string,
  };
}
function toDuty(row: Record<string, unknown>): Duty {
  return {
    assignedToUserId: row.assigned_to_user_id as string,
    contractId: row.contract_id as string,
    createdAt: new Date(row.created_at as string).getTime(),
    createdByUserId: row.created_by_user_id as string,
    description: row.description as string,
    id: row.id as string,
    proofNote: row.proof_note as string,
    reviewNote: row.review_note as string,
    status: row.status as Duty['status'],
    title: row.title as string,
  };
}
function toBooking(row: Record<string, unknown>): Booking {
  return {
    contractId: row.contract_id as string,
    createdAt: new Date(row.created_at as string).getTime(),
    endAt: new Date(row.end_at as string).getTime(),
    id: row.id as string,
    meetingMode: row.meeting_mode as Booking['meetingMode'],
    proposerUserId: row.proposer_user_id as string,
    region: (row.region as string | null) ?? null,
    startAt: new Date(row.start_at as string).getTime(),
    status: row.status as Booking['status'],
    workDescription: row.work_description as string,
  };
}
function toAftercarePlan(row: Record<string, unknown>): AftercarePlan {
  return {
    checkInMinutes: row.check_in_minutes as number,
    closurePhrase: row.closure_phrase as string,
    contractId: row.contract_id as string,
    createdAt: new Date(row.created_at as string).getTime(),
    createdByUserId: row.created_by_user_id as string,
    id: row.id as string,
    selfCarePrompts: (row.self_care_prompts as string[]) ?? [],
  };
}
function toAftercareCheckin(row: Record<string, unknown>): AftercareCheckin {
  return {
    completedAt: row.completed_at ? new Date(row.completed_at as string).getTime() : null,
    contractId: row.contract_id as string,
    createdAt: new Date(row.created_at as string).getTime(),
    createdByUserId: row.created_by_user_id as string,
    dueAt: new Date(row.due_at as string).getTime(),
    id: row.id as string,
    kind: row.kind as AftercareCheckin['kind'],
    note: row.note as string,
    planId: (row.plan_id as string | null) ?? null,
  };
}
function toVideoHello(row: Record<string, unknown>): VideoHello {
  return {
    contractId: row.contract_id as string,
    createdAt: new Date(row.created_at as string).getTime(),
    id: row.id as string,
    message: row.message as string,
    recipientUserId: row.recipient_user_id as string,
    requesterUserId: row.requester_user_id as string,
    status: row.status as VideoHello['status'],
  };
}
function toScheduledCheckin(row: Record<string, unknown>): ScheduledCheckin {
  return {
    completedAt: row.completed_at ? new Date(row.completed_at as string).getTime() : null,
    contractId: row.contract_id as string,
    createdAt: new Date(row.created_at as string).getTime(),
    creatorUserId: row.creator_user_id as string,
    dueAt: new Date(row.due_at as string).getTime(),
    id: row.id as string,
    note: row.note as string,
    recipientUserId: row.recipient_user_id as string,
  };
}
function toMessage(row: Record<string, unknown>): Message {
  return {
    body: row.body as string,
    createdAt: new Date(row.created_at as string).getTime(),
    id: row.id as string,
    readAt: row.read_at ? new Date(row.read_at as string).getTime() : null,
    recipientUserId: row.recipient_user_id as string,
    senderUserId: row.sender_user_id as string,
  };
}

export class PostgresStore implements Store {
  private pool: Pool;
  private codes = new Map<string, PendingCode>();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async init(schemaSql: string): Promise<void> {
    await this.pool.query(schemaSql);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const res = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0] ? toUser(res.rows[0]) : undefined;
  }
  async getUserById(id: string): Promise<User | undefined> {
    const res = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] ? toUser(res.rows[0]) : undefined;
  }
  async createUser(email: string): Promise<User> {
    const id = `user_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000)}`;
    await this.pool.query('INSERT INTO users (id, email) VALUES ($1, $2)', [id, email]);
    return { email, emailVerified: false, id };
  }
  async verifyUserEmail(id: string): Promise<void> {
    await this.pool.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [id]);
  }
  async getProfileByUserId(userId: string): Promise<Profile | undefined> {
    const res = await this.pool.query('SELECT * FROM profiles WHERE user_id = $1', [userId]);
    return res.rows[0] ? toProfile(res.rows[0]) : undefined;
  }
  async createProfile(profile: Profile): Promise<void> {
    await this.pool.query(
      'INSERT INTO profiles (id, user_id, display_name, role, pet_type, meeting_mode, region) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [profile.id, profile.userId, profile.displayName, profile.role, profile.petType, profile.meetingMode, profile.region],
    );
  }
  async listProfiles(
    excludingUserId: string,
    blockedUserIds: Set<string>,
    options?: { filters?: import('../store').DiscoveryFilters; passedUserIds?: Set<string> },
  ): Promise<Profile[]> {
    const filters = options?.filters;
    const params: unknown[] = [excludingUserId, [...blockedUserIds], [...(options?.passedUserIds ?? [])]];
    let sql = 'SELECT * FROM profiles WHERE user_id <> $1 AND NOT (user_id = ANY($2::text[])) AND NOT (user_id = ANY($3::text[]))';
    if (filters?.role) {
      params.push(filters.role);
      sql += ` AND role = $${params.length}`;
    }
    if (filters?.petType) {
      params.push(filters.petType);
      sql += ` AND pet_type = $${params.length}`;
    }
    if (filters?.meetingMode) {
      params.push(filters.meetingMode);
      sql += ` AND meeting_mode = $${params.length}`;
    }
    if (filters?.region) {
      params.push(`%${filters.region}%`);
      sql += ` AND region ILIKE $${params.length}`;
    }
    const res = await this.pool.query(sql, params);
    return res.rows.map(toProfile);
  }
  async addBlock(block: Block): Promise<void> {
    await this.pool.query(
      'INSERT INTO blocks (id, blocker_user_id, blocked_user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [block.id, block.blockerUserId, block.blockedUserId],
    );
  }
  async blocksByUser(userId: string): Promise<Block[]> {
    const res = await this.pool.query('SELECT * FROM blocks WHERE blocker_user_id = $1', [userId]);
    return res.rows.map((r) => ({
      blockedUserId: r.blocked_user_id as string,
      blockerUserId: r.blocker_user_id as string,
      id: r.id as string,
    }));
  }
  async blocksInvolving(userId: string): Promise<Block[]> {
    const res = await this.pool.query('SELECT * FROM blocks WHERE blocker_user_id = $1 OR blocked_user_id = $1', [userId]);
    return res.rows.map((r) => ({
      blockedUserId: r.blocked_user_id as string,
      blockerUserId: r.blocker_user_id as string,
      id: r.id as string,
    }));
  }
  async addReport(report: Report): Promise<void> {
    await this.pool.query(
      'INSERT INTO reports (id, reporter_user_id, reported_user_id, category, details, urgent, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [report.id, report.reporterUserId, report.reportedUserId, report.category, report.details, report.urgent, report.status],
    );
  }
  async listReports(): Promise<Report[]> {
    const res = await this.pool.query('SELECT * FROM reports ORDER BY urgent DESC, created_at DESC');
    return res.rows.map(toReport);
  }
  async updateReportStatus(id: string, status: 'open' | 'resolved'): Promise<boolean> {
    const res = await this.pool.query('UPDATE reports SET status = $2 WHERE id = $1', [id, status]);
    return (res.rowCount ?? 0) > 0;
  }
  async setCode(pending: PendingCode): Promise<void> {
    this.codes.set(pending.email, pending);
  }
  async getCode(email: string): Promise<PendingCode | undefined> {
    return this.codes.get(email);
  }
  async clearCode(email: string): Promise<void> {
    this.codes.delete(email);
  }
  async isInviteValid(code: string): Promise<boolean> {
    const res = await this.pool.query('SELECT used_by_user_id FROM invite_codes WHERE code = $1', [code]);
    return res.rows.length > 0 && res.rows[0].used_by_user_id === null;
  }
  async useInvite(code: string, userId: string): Promise<void> {
    await this.pool.query('UPDATE invite_codes SET used_by_user_id = $1, used_at = NOW() WHERE code = $2', [userId, code]);
  }
  async addLike(like: Like): Promise<void> {
    await this.pool.query(
      'INSERT INTO likes (id, liker_user_id, liked_user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [like.id, like.likerUserId, like.likedUserId],
    );
  }
  async removeLike(likerUserId: string, likedUserId: string): Promise<void> {
    await this.pool.query('DELETE FROM likes WHERE liker_user_id = $1 AND liked_user_id = $2', [likerUserId, likedUserId]);
  }
  async likesByUser(userId: string): Promise<Like[]> {
    const res = await this.pool.query('SELECT * FROM likes WHERE liker_user_id = $1', [userId]);
    return res.rows.map((r) => ({ id: r.id as string, likedUserId: r.liked_user_id as string, likerUserId: r.liker_user_id as string }));
  }
  async addPass(pass: Pass): Promise<void> {
    await this.pool.query(
      'INSERT INTO passes (id, passer_user_id, passed_user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [pass.id, pass.passerUserId, pass.passedUserId],
    );
  }
  async passesByUser(userId: string): Promise<Pass[]> {
    const res = await this.pool.query('SELECT * FROM passes WHERE passer_user_id = $1', [userId]);
    return res.rows.map((r) => ({ id: r.id as string, passedUserId: r.passed_user_id as string, passerUserId: r.passer_user_id as string }));
  }
  async addMessage(message: Message): Promise<void> {
    await this.pool.query(
      'INSERT INTO messages (id, sender_user_id, recipient_user_id, body) VALUES ($1, $2, $3, $4)',
      [message.id, message.senderUserId, message.recipientUserId, message.body],
    );
  }
  async messagesBetween(a: string, b: string): Promise<Message[]> {
    const res = await this.pool.query(
      'SELECT * FROM messages WHERE (sender_user_id = $1 AND recipient_user_id = $2) OR (sender_user_id = $2 AND recipient_user_id = $1) ORDER BY created_at ASC, id ASC',
      [a, b],
    );
    return res.rows.map(toMessage);
  }
  async messagesForUser(userId: string): Promise<Message[]> {
    const res = await this.pool.query(
      'SELECT * FROM messages WHERE sender_user_id = $1 OR recipient_user_id = $1 ORDER BY created_at ASC, id ASC',
      [userId],
    );
    return res.rows.map(toMessage);
  }
  async markThreadRead(userId: string, partnerUserId: string): Promise<void> {
    await this.pool.query(
      'UPDATE messages SET read_at = NOW() WHERE recipient_user_id = $1 AND sender_user_id = $2 AND read_at IS NULL',
      [userId, partnerUserId],
    );
  }
  async upsertRating(rating: Rating): Promise<void> {
    await this.pool.query(
      `INSERT INTO ratings (id, rater_user_id, rated_user_id, score, note) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (rater_user_id, rated_user_id) DO UPDATE SET score = EXCLUDED.score, note = EXCLUDED.note`,
      [rating.id, rating.raterUserId, rating.ratedUserId, rating.score, rating.note],
    );
  }
  async ratingsForUser(ratedUserId: string): Promise<Rating[]> {
    const res = await this.pool.query('SELECT * FROM ratings WHERE rated_user_id = $1', [ratedUserId]);
    return res.rows.map((r) => ({
      id: r.id as string,
      note: r.note as string,
      ratedUserId: r.rated_user_id as string,
      raterUserId: r.rater_user_id as string,
      score: r.score as number,
    }));
  }
  async trustSummary(userId: string): Promise<TrustSummary> {
    const received = await this.ratingsForUser(userId);
    const mutual: number[] = [];
    for (const r of received) {
      const back = await this.pool.query('SELECT 1 FROM ratings WHERE rater_user_id = $1 AND rated_user_id = $2', [userId, r.raterUserId]);
      if ((back.rowCount ?? 0) > 0) mutual.push(r.score);
    }
    if (mutual.length === 0) return { averageScore: null, badge: null, mutualRaterCount: 0, userId };
    const averageScore = mutual.reduce((sum, s) => sum + s, 0) / mutual.length;
    return { averageScore, badge: badgeFor(mutual.length, averageScore), mutualRaterCount: mutual.length, userId };
  }
  async createContract(contract: Contract): Promise<void> {
    await this.pool.query(
      'INSERT INTO contracts (id, proposer_user_id, partner_user_id, title, limits, safeword, status, signed_user_ids, resume_user_ids, paused_by_user_id, safeword_used_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
      [contract.id, contract.proposerUserId, contract.partnerUserId, contract.title, contract.limits, contract.safeword, contract.status, contract.signedUserIds, contract.resumeUserIds, contract.pausedByUserId, contract.safewordUsedAt ? new Date(contract.safewordUsedAt) : null],
    );
  }
  async getContract(id: string): Promise<Contract | undefined> {
    const res = await this.pool.query('SELECT * FROM contracts WHERE id = $1', [id]);
    return res.rows[0] ? toContract(res.rows[0]) : undefined;
  }
  async updateContract(contract: Contract): Promise<void> {
    await this.pool.query(
      'UPDATE contracts SET status = $2, signed_user_ids = $3, resume_user_ids = $4, paused_by_user_id = $5, safeword_used_at = $6 WHERE id = $1',
      [contract.id, contract.status, contract.signedUserIds, contract.resumeUserIds, contract.pausedByUserId, contract.safewordUsedAt ? new Date(contract.safewordUsedAt) : null],
    );
  }
  async contractsForUser(userId: string): Promise<Contract[]> {
    const res = await this.pool.query('SELECT * FROM contracts WHERE proposer_user_id = $1 OR partner_user_id = $1 ORDER BY created_at DESC, id DESC', [userId]);
    return res.rows.map(toContract);
  }
  async createDuty(duty: Duty): Promise<void> {
    await this.pool.query(
      'INSERT INTO duties (id, contract_id, created_by_user_id, assigned_to_user_id, title, description, status, proof_note, review_note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [duty.id, duty.contractId, duty.createdByUserId, duty.assignedToUserId, duty.title, duty.description, duty.status, duty.proofNote, duty.reviewNote],
    );
  }
  async getDuty(id: string): Promise<Duty | undefined> {
    const res = await this.pool.query('SELECT * FROM duties WHERE id = $1', [id]);
    return res.rows[0] ? toDuty(res.rows[0]) : undefined;
  }
  async updateDuty(duty: Duty): Promise<void> {
    await this.pool.query('UPDATE duties SET status = $2, proof_note = $3, review_note = $4 WHERE id = $1', [duty.id, duty.status, duty.proofNote, duty.reviewNote]);
  }
  async dutiesForContract(contractId: string): Promise<Duty[]> {
    const res = await this.pool.query('SELECT * FROM duties WHERE contract_id = $1 ORDER BY created_at ASC, id ASC', [contractId]);
    return res.rows.map(toDuty);
  }
  async createReward(reward: Reward): Promise<void> {
    await this.pool.query('INSERT INTO rewards (id, duty_id, granted_by_user_id, title) VALUES ($1, $2, $3, $4)', [reward.id, reward.dutyId, reward.grantedByUserId, reward.title]);
  }
  async rewardsForDuty(dutyId: string): Promise<Reward[]> {
    const res = await this.pool.query('SELECT * FROM rewards WHERE duty_id = $1 ORDER BY created_at ASC, id ASC', [dutyId]);
    return res.rows.map((r) => ({ createdAt: new Date(r.created_at as string).getTime(), dutyId: r.duty_id as string, grantedByUserId: r.granted_by_user_id as string, id: r.id as string, title: r.title as string }));
  }
  async createBooking(booking: Booking): Promise<void> {
    await this.pool.query(
      'INSERT INTO bookings (id, contract_id, proposer_user_id, start_at, end_at, meeting_mode, region, work_description, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [booking.id, booking.contractId, booking.proposerUserId, new Date(booking.startAt), new Date(booking.endAt), booking.meetingMode, booking.region, booking.workDescription, booking.status],
    );
  }
  async getBooking(id: string): Promise<Booking | undefined> {
    const res = await this.pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
    return res.rows[0] ? toBooking(res.rows[0]) : undefined;
  }
  async updateBooking(booking: Booking): Promise<void> {
    await this.pool.query('UPDATE bookings SET status = $2 WHERE id = $1', [booking.id, booking.status]);
  }
  async bookingsForContract(contractId: string): Promise<Booking[]> {
    const res = await this.pool.query('SELECT * FROM bookings WHERE contract_id = $1 ORDER BY start_at ASC, id ASC', [contractId]);
    return res.rows.map(toBooking);
  }
  async createAftercarePlan(plan: AftercarePlan): Promise<void> {
    await this.pool.query(
      'INSERT INTO aftercare_plans (id, contract_id, created_by_user_id, closure_phrase, self_care_prompts, check_in_minutes) VALUES ($1, $2, $3, $4, $5, $6)',
      [plan.id, plan.contractId, plan.createdByUserId, plan.closurePhrase, plan.selfCarePrompts, plan.checkInMinutes],
    );
  }
  async aftercarePlansForContract(contractId: string): Promise<AftercarePlan[]> {
    const res = await this.pool.query('SELECT * FROM aftercare_plans WHERE contract_id = $1 ORDER BY created_at ASC, id ASC', [contractId]);
    return res.rows.map(toAftercarePlan);
  }
  async createAftercareCheckin(checkin: AftercareCheckin): Promise<void> {
    await this.pool.query(
      'INSERT INTO aftercare_checkins (id, contract_id, plan_id, created_by_user_id, kind, note, due_at, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [checkin.id, checkin.contractId, checkin.planId, checkin.createdByUserId, checkin.kind, checkin.note, new Date(checkin.dueAt), checkin.completedAt ? new Date(checkin.completedAt) : null],
    );
  }
  async getAftercareCheckin(id: string): Promise<AftercareCheckin | undefined> {
    const res = await this.pool.query('SELECT * FROM aftercare_checkins WHERE id = $1', [id]);
    return res.rows[0] ? toAftercareCheckin(res.rows[0]) : undefined;
  }
  async updateAftercareCheckin(checkin: AftercareCheckin): Promise<void> {
    await this.pool.query('UPDATE aftercare_checkins SET completed_at = $2 WHERE id = $1', [checkin.id, checkin.completedAt ? new Date(checkin.completedAt) : null]);
  }
  async aftercareCheckinsForContract(contractId: string): Promise<AftercareCheckin[]> {
    const res = await this.pool.query('SELECT * FROM aftercare_checkins WHERE contract_id = $1 ORDER BY due_at ASC, id ASC', [contractId]);
    return res.rows.map(toAftercareCheckin);
  }
  async createVideoHello(hello: VideoHello): Promise<void> {
    await this.pool.query(
      'INSERT INTO video_hellos (id, contract_id, requester_user_id, recipient_user_id, message, status) VALUES ($1, $2, $3, $4, $5, $6)',
      [hello.id, hello.contractId, hello.requesterUserId, hello.recipientUserId, hello.message, hello.status],
    );
  }
  async getVideoHello(id: string): Promise<VideoHello | undefined> {
    const res = await this.pool.query('SELECT * FROM video_hellos WHERE id = $1', [id]);
    return res.rows[0] ? toVideoHello(res.rows[0]) : undefined;
  }
  async updateVideoHello(hello: VideoHello): Promise<void> {
    await this.pool.query('UPDATE video_hellos SET status = $2 WHERE id = $1', [hello.id, hello.status]);
  }
  async videoHellosForContract(contractId: string): Promise<VideoHello[]> {
    const res = await this.pool.query('SELECT * FROM video_hellos WHERE contract_id = $1 ORDER BY created_at ASC, id ASC', [contractId]);
    return res.rows.map(toVideoHello);
  }
  async createScheduledCheckin(checkin: ScheduledCheckin): Promise<void> {
    await this.pool.query(
      'INSERT INTO scheduled_checkins (id, contract_id, creator_user_id, recipient_user_id, note, due_at, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [checkin.id, checkin.contractId, checkin.creatorUserId, checkin.recipientUserId, checkin.note, new Date(checkin.dueAt), checkin.completedAt ? new Date(checkin.completedAt) : null],
    );
  }
  async getScheduledCheckin(id: string): Promise<ScheduledCheckin | undefined> {
    const res = await this.pool.query('SELECT * FROM scheduled_checkins WHERE id = $1', [id]);
    return res.rows[0] ? toScheduledCheckin(res.rows[0]) : undefined;
  }
  async updateScheduledCheckin(checkin: ScheduledCheckin): Promise<void> {
    await this.pool.query('UPDATE scheduled_checkins SET completed_at = $2 WHERE id = $1', [checkin.id, checkin.completedAt ? new Date(checkin.completedAt) : null]);
  }
  async scheduledCheckinsForContract(contractId: string): Promise<ScheduledCheckin[]> {
    const res = await this.pool.query('SELECT * FROM scheduled_checkins WHERE contract_id = $1 ORDER BY due_at ASC, id ASC', [contractId]);
    return res.rows.map(toScheduledCheckin);
  }
  // Phase 3 storage is not yet implemented for Postgres. These stubs
  // keep the Store contract typed while making the gap explicit:
  // Phase 3 endpoints work with the in-memory store and must not be
  // offered on a Postgres deployment until real tables are added and
  // tested against a live database. Existing Phase 0–2 behaviour is
  // unaffected.
  private phase3Unsupported(): never {
    throw new Error('Phase 3 storage is not implemented for Postgres yet.');
  }
  async createOwnerCommand(): Promise<void> {
    this.phase3Unsupported();
  }
  async getOwnerCommand(): Promise<undefined> {
    this.phase3Unsupported();
  }
  async updateOwnerCommand(): Promise<void> {
    this.phase3Unsupported();
  }
  async ownerCommandsForContract(): Promise<[]> {
    this.phase3Unsupported();
  }
  async createRoutineItem(): Promise<void> {
    this.phase3Unsupported();
  }
  async routineItemsForUserOnDate(): Promise<[]> {
    this.phase3Unsupported();
  }
  async getRoutineItem(): Promise<undefined> {
    this.phase3Unsupported();
  }
  async updateRoutineItem(): Promise<void> {
    this.phase3Unsupported();
  }
  async createWishlistItem(): Promise<void> {
    this.phase3Unsupported();
  }
  async wishlistForUser(): Promise<[]> {
    this.phase3Unsupported();
  }
  async getWishlistItem(): Promise<undefined> {
    this.phase3Unsupported();
  }
  async updateWishlistItem(): Promise<void> {
    this.phase3Unsupported();
  }
  async deleteWishlistItem(): Promise<void> {
    this.phase3Unsupported();
  }
  async createLostAlert(): Promise<void> {
    this.phase3Unsupported();
  }
  async getLostAlert(): Promise<undefined> {
    this.phase3Unsupported();
  }
  async updateLostAlert(): Promise<void> {
    this.phase3Unsupported();
  }
  async openLostAlertForContract(): Promise<undefined> {
    this.phase3Unsupported();
  }
  async openLostAlerts(): Promise<[]> {
    this.phase3Unsupported();
  }
  async getLostOptIn(): Promise<boolean> {
    this.phase3Unsupported();
  }
  async setLostOptIn(): Promise<void> {
    this.phase3Unsupported();
  }
  async getLostSound(): Promise<boolean> {
    this.phase3Unsupported();
  }
  async setLostSound(): Promise<void> {
    this.phase3Unsupported();
  }
  async setGameToken(): Promise<void> {
    this.phase3Unsupported();
  }
  async getGameToken(): Promise<null> {
    this.phase3Unsupported();
  }
  async createPraiseNote(): Promise<void> {
    this.phase3Unsupported();
  }
  async praiseNotesForContract(): Promise<[]> {
    this.phase3Unsupported();
  }
  async reset(): Promise<void> {
    throw new Error('PostgresStore reset is not supported in production.');
  }
}
