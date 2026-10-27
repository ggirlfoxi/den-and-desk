export type Role = 'Owner' | 'Pet' | 'Switch' | 'Curious';
export type PetType = 'Kitty' | 'Puppy';
export type MeetingMode = 'Online' | 'InPerson' | 'Both';

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
}
export interface Profile {
  id: string;
  userId: string;
  displayName: string;
  role: Role;
  petType: PetType | null;
  meetingMode: MeetingMode;
  region: string | null;
}
export interface Block {
  id: string;
  blockerUserId: string;
  blockedUserId: string;
}
export interface Report {
  id: string;
  reporterUserId: string;
  reportedUserId: string;
  category: string;
  details: string;
  urgent: boolean;
  status: 'open' | 'resolved';
  createdAt: number;
}
export interface PendingCode {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  inviteCode?: string;
}
export interface Like {
  id: string;
  likerUserId: string;
  likedUserId: string;
}
export interface Pass {
  id: string;
  passerUserId: string;
  passedUserId: string;
}
export interface Message {
  id: string;
  senderUserId: string;
  recipientUserId: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}
export interface Rating {
  id: string;
  raterUserId: string;
  ratedUserId: string;
  score: number;
  note: string;
}
export interface TrustSummary {
  userId: string;
  mutualRaterCount: number;
  averageScore: number | null;
  badge: string | null;
}
export interface DiscoveryFilters {
  role?: Role;
  petType?: PetType;
  meetingMode?: MeetingMode;
  region?: string;
}

/** Phase 2: a negotiated agreement between exactly two participants.
 *  Both parties must sign before it becomes active. A safeword stops
 *  it instantly (paused); resuming needs both parties to confirm, so
 *  one side cannot restart it alone after a stop. Ending is terminal
 *  and is always allowed, even if the parties have blocked each other
 *  — ending is an escape, not a continuation. */
export type ContractStatus = 'draft' | 'active' | 'paused' | 'ended';
export interface Contract {
  id: string;
  proposerUserId: string;
  partnerUserId: string;
  title: string;
  limits: string;
  safeword: string;
  status: ContractStatus;
  signedUserIds: string[];
  resumeUserIds: string[];
  pausedByUserId: string | null;
  safewordUsedAt: number | null;
  createdAt: number;
}
export type DutyStatus = 'open' | 'submitted' | 'approved';
export interface Duty {
  id: string;
  contractId: string;
  createdByUserId: string;
  assignedToUserId: string;
  title: string;
  description: string;
  status: DutyStatus;
  proofNote: string;
  reviewNote: string;
  createdAt: number;
}
export interface Reward {
  id: string;
  dutyId: string;
  grantedByUserId: string;
  title: string;
  createdAt: number;
}
export type BookingStatus = 'proposed' | 'confirmed' | 'declined' | 'cancelled';
export interface Booking {
  id: string;
  contractId: string;
  proposerUserId: string;
  startAt: number;
  endAt: number;
  meetingMode: MeetingMode;
  region: string | null;
  workDescription: string;
  status: BookingStatus;
  createdAt: number;
}
export interface AftercarePlan {
  id: string;
  contractId: string;
  createdByUserId: string;
  closurePhrase: string;
  selfCarePrompts: string[];
  checkInMinutes: number;
  createdAt: number;
}
export interface AftercareCheckin {
  id: string;
  contractId: string;
  planId: string | null;
  createdByUserId: string;
  kind: 'prompt' | 'scheduled';
  note: string;
  dueAt: number;
  completedAt: number | null;
  createdAt: number;
}
export type VideoHelloStatus = 'requested' | 'accepted' | 'declined' | 'completed';
export interface VideoHello {
  id: string;
  contractId: string;
  requesterUserId: string;
  recipientUserId: string;
  message: string;
  status: VideoHelloStatus;
  createdAt: number;
}
export interface ScheduledCheckin {
  id: string;
  contractId: string;
  creatorUserId: string;
  recipientUserId: string;
  note: string;
  dueAt: number;
  completedAt: number | null;
  createdAt: number;
}

/** Trust badge tiers, computed only from mutual ratings (see trustSummary).
 *  A rating counts only when the other person has also rated you back.
 *  This is the Phase 1 subset of the Once Upon a Little mutual-rating
 *  idea: one 1–5 score per direction, not a full dimension set. */
export function badgeFor(mutualRaterCount: number, averageScore: number | null): string | null {
  if (averageScore === null) return null;
  if (mutualRaterCount >= 3 && averageScore >= 4.5) return 'Highly trusted';
  if (mutualRaterCount >= 2 && averageScore >= 4.0) return 'Trusted';
  if (mutualRaterCount >= 1 && averageScore >= 3.5) return 'Newly trusted';
  return null;
}

export interface Store {
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  createUser(email: string): Promise<User>;
  verifyUserEmail(id: string): Promise<void>;
  getProfileByUserId(userId: string): Promise<Profile | undefined>;
  createProfile(profile: Profile): Promise<void>;
  listProfiles(
    excludingUserId: string,
    blockedUserIds: Set<string>,
    options?: { filters?: DiscoveryFilters; passedUserIds?: Set<string> },
  ): Promise<Profile[]>;
  addBlock(block: Block): Promise<void>;
  blocksByUser(userId: string): Promise<Block[]>;
  blocksInvolving(userId: string): Promise<Block[]>;
  addReport(report: Report): Promise<void>;
  listReports(): Promise<Report[]>;
  updateReportStatus(id: string, status: 'open' | 'resolved'): Promise<boolean>;
  setCode(pending: PendingCode): Promise<void>;
  getCode(email: string): Promise<PendingCode | undefined>;
  clearCode(email: string): Promise<void>;
  isInviteValid(code: string): Promise<boolean>;
  useInvite(code: string, userId: string): Promise<void>;
  addLike(like: Like): Promise<void>;
  removeLike(likerUserId: string, likedUserId: string): Promise<void>;
  likesByUser(userId: string): Promise<Like[]>;
  addPass(pass: Pass): Promise<void>;
  passesByUser(userId: string): Promise<Pass[]>;
  addMessage(message: Message): Promise<void>;
  messagesBetween(a: string, b: string): Promise<Message[]>;
  messagesForUser(userId: string): Promise<Message[]>;
  markThreadRead(userId: string, partnerUserId: string): Promise<void>;
  upsertRating(rating: Rating): Promise<void>;
  ratingsForUser(ratedUserId: string): Promise<Rating[]>;
  trustSummary(userId: string): Promise<TrustSummary>;
  // Phase 2: dynamics (contracts, duties, rewards, bookings, aftercare,
  // video-hello requests, scheduled check-ins).
  createContract(contract: Contract): Promise<void>;
  getContract(id: string): Promise<Contract | undefined>;
  updateContract(contract: Contract): Promise<void>;
  contractsForUser(userId: string): Promise<Contract[]>;
  createDuty(duty: Duty): Promise<void>;
  getDuty(id: string): Promise<Duty | undefined>;
  updateDuty(duty: Duty): Promise<void>;
  dutiesForContract(contractId: string): Promise<Duty[]>;
  createReward(reward: Reward): Promise<void>;
  rewardsForDuty(dutyId: string): Promise<Reward[]>;
  createBooking(booking: Booking): Promise<void>;
  getBooking(id: string): Promise<Booking | undefined>;
  updateBooking(booking: Booking): Promise<void>;
  bookingsForContract(contractId: string): Promise<Booking[]>;
  createAftercarePlan(plan: AftercarePlan): Promise<void>;
  aftercarePlansForContract(contractId: string): Promise<AftercarePlan[]>;
  createAftercareCheckin(checkin: AftercareCheckin): Promise<void>;
  getAftercareCheckin(id: string): Promise<AftercareCheckin | undefined>;
  updateAftercareCheckin(checkin: AftercareCheckin): Promise<void>;
  aftercareCheckinsForContract(contractId: string): Promise<AftercareCheckin[]>;
  createVideoHello(hello: VideoHello): Promise<void>;
  getVideoHello(id: string): Promise<VideoHello | undefined>;
  updateVideoHello(hello: VideoHello): Promise<void>;
  videoHellosForContract(contractId: string): Promise<VideoHello[]>;
  createScheduledCheckin(checkin: ScheduledCheckin): Promise<void>;
  getScheduledCheckin(id: string): Promise<ScheduledCheckin | undefined>;
  updateScheduledCheckin(checkin: ScheduledCheckin): Promise<void>;
  scheduledCheckinsForContract(contractId: string): Promise<ScheduledCheckin[]>;
  reset(): Promise<void>;
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

function profileMatchesFilters(p: Profile, filters?: DiscoveryFilters): boolean {
  if (!filters) return true;
  if (filters.role && p.role !== filters.role) return false;
  if (filters.petType && p.petType !== filters.petType) return false;
  if (filters.meetingMode && p.meetingMode !== filters.meetingMode) return false;
  if (filters.region && !(p.region ?? '').toLowerCase().includes(filters.region.toLowerCase())) return false;
  return true;
}

export class InMemoryStore implements Store {
  private users = new Map<string, User>();
  private profiles = new Map<string, Profile>();
  private blocks: Block[] = [];
  private reports: Report[] = [];
  private codes = new Map<string, PendingCode>();
  private invites = new Map<string, string | null>();
  private likes: Like[] = [];
  private passes: Pass[] = [];
  private messages: Message[] = [];
  private ratings: Rating[] = [];
  private contracts: Contract[] = [];
  private duties: Duty[] = [];
  private rewards: Reward[] = [];
  private bookings: Booking[] = [];
  private aftercarePlans: AftercarePlan[] = [];
  private aftercareCheckins: AftercareCheckin[] = [];
  private videoHellos: VideoHello[] = [];
  private scheduledCheckins: ScheduledCheckin[] = [];

  constructor(inviteCodes: string[]) {
    for (const code of inviteCodes) this.invites.set(code, null);
  }

  async getUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email);
  }
  async getUserById(id: string) {
    return this.users.get(id);
  }
  async createUser(email: string): Promise<User> {
    const user: User = { email, emailVerified: false, id: newId('user') };
    this.users.set(user.id, user);
    return user;
  }
  async verifyUserEmail(id: string) {
    const user = this.users.get(id);
    if (user) user.emailVerified = true;
  }
  async getProfileByUserId(userId: string) {
    return [...this.profiles.values()].find((p) => p.userId === userId);
  }
  async createProfile(profile: Profile) {
    this.profiles.set(profile.id, profile);
  }
  async listProfiles(excludingUserId: string, blockedUserIds: Set<string>, options?: { filters?: DiscoveryFilters; passedUserIds?: Set<string> }) {
    return [...this.profiles.values()].filter(
      (p) =>
        p.userId !== excludingUserId &&
        !blockedUserIds.has(p.userId) &&
        !(options?.passedUserIds?.has(p.userId) ?? false) &&
        profileMatchesFilters(p, options?.filters),
    );
  }
  async addBlock(block: Block) {
    if (!this.blocks.some((b) => b.blockerUserId === block.blockerUserId && b.blockedUserId === block.blockedUserId)) {
      this.blocks.push(block);
    }
  }
  async blocksByUser(userId: string) {
    return this.blocks.filter((b) => b.blockerUserId === userId);
  }
  async blocksInvolving(userId: string) {
    return this.blocks.filter((b) => b.blockerUserId === userId || b.blockedUserId === userId);
  }
  async addReport(report: Report) {
    this.reports.push(report);
  }
  async listReports() {
    return [...this.reports].sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.createdAt - a.createdAt);
  }
  async updateReportStatus(id: string, status: 'open' | 'resolved') {
    const report = this.reports.find((r) => r.id === id);
    if (!report) return false;
    report.status = status;
    return true;
  }
  async setCode(pending: PendingCode) {
    this.codes.set(pending.email, pending);
  }
  async getCode(email: string) {
    return this.codes.get(email);
  }
  async clearCode(email: string) {
    this.codes.delete(email);
  }
  async isInviteValid(code: string) {
    return this.invites.has(code) && this.invites.get(code) === null;
  }
  async useInvite(code: string, userId: string) {
    if (this.invites.has(code)) this.invites.set(code, userId);
  }
  async addLike(like: Like) {
    if (!this.likes.some((l) => l.likerUserId === like.likerUserId && l.likedUserId === like.likedUserId)) {
      this.likes.push(like);
    }
  }
  async removeLike(likerUserId: string, likedUserId: string) {
    this.likes = this.likes.filter((l) => !(l.likerUserId === likerUserId && l.likedUserId === likedUserId));
  }
  async likesByUser(userId: string) {
    return this.likes.filter((l) => l.likerUserId === userId);
  }
  async addPass(pass: Pass) {
    if (!this.passes.some((p) => p.passerUserId === pass.passerUserId && p.passedUserId === pass.passedUserId)) {
      this.passes.push(pass);
    }
  }
  async passesByUser(userId: string) {
    return this.passes.filter((p) => p.passerUserId === userId);
  }
  async addMessage(message: Message) {
    this.messages.push(message);
  }
  async messagesBetween(a: string, b: string) {
    return this.messages
      .filter((m) => (m.senderUserId === a && m.recipientUserId === b) || (m.senderUserId === b && m.recipientUserId === a))
      .sort((x, y) => x.createdAt - y.createdAt);
  }
  async messagesForUser(userId: string) {
    return this.messages
      .filter((m) => m.senderUserId === userId || m.recipientUserId === userId)
      .sort((x, y) => x.createdAt - y.createdAt);
  }
  async markThreadRead(userId: string, partnerUserId: string) {
    for (const m of this.messages) {
      if (m.recipientUserId === userId && m.senderUserId === partnerUserId && m.readAt === null) {
        m.readAt = Date.now();
      }
    }
  }
  async upsertRating(rating: Rating) {
    const existing = this.ratings.find((r) => r.raterUserId === rating.raterUserId && r.ratedUserId === rating.ratedUserId);
    if (existing) {
      existing.score = rating.score;
      existing.note = rating.note;
    } else {
      this.ratings.push(rating);
    }
  }
  async ratingsForUser(ratedUserId: string) {
    return this.ratings.filter((r) => r.ratedUserId === ratedUserId);
  }
  async trustSummary(userId: string): Promise<TrustSummary> {
    const received = await this.ratingsForUser(userId);
    const mutual = received.filter((r) => this.ratings.some((x) => x.raterUserId === userId && x.ratedUserId === r.raterUserId));
    if (mutual.length === 0) return { averageScore: null, badge: null, mutualRaterCount: 0, userId };
    const averageScore = mutual.reduce((sum, r) => sum + r.score, 0) / mutual.length;
    return { averageScore, badge: badgeFor(mutual.length, averageScore), mutualRaterCount: mutual.length, userId };
  }
  async createContract(contract: Contract) {
    this.contracts.push(contract);
  }
  async getContract(id: string) {
    return this.contracts.find((c) => c.id === id);
  }
  async updateContract(contract: Contract) {
    const i = this.contracts.findIndex((c) => c.id === contract.id);
    if (i >= 0) this.contracts[i] = contract;
  }
  async contractsForUser(userId: string) {
    return this.contracts.filter((c) => c.proposerUserId === userId || c.partnerUserId === userId);
  }
  async createDuty(duty: Duty) {
    this.duties.push(duty);
  }
  async getDuty(id: string) {
    return this.duties.find((d) => d.id === id);
  }
  async updateDuty(duty: Duty) {
    const i = this.duties.findIndex((d) => d.id === duty.id);
    if (i >= 0) this.duties[i] = duty;
  }
  async dutiesForContract(contractId: string) {
    return this.duties.filter((d) => d.contractId === contractId);
  }
  async createReward(reward: Reward) {
    this.rewards.push(reward);
  }
  async rewardsForDuty(dutyId: string) {
    return this.rewards.filter((r) => r.dutyId === dutyId);
  }
  async createBooking(booking: Booking) {
    this.bookings.push(booking);
  }
  async getBooking(id: string) {
    return this.bookings.find((b) => b.id === id);
  }
  async updateBooking(booking: Booking) {
    const i = this.bookings.findIndex((b) => b.id === booking.id);
    if (i >= 0) this.bookings[i] = booking;
  }
  async bookingsForContract(contractId: string) {
    return this.bookings.filter((b) => b.contractId === contractId);
  }
  async createAftercarePlan(plan: AftercarePlan) {
    this.aftercarePlans.push(plan);
  }
  async aftercarePlansForContract(contractId: string) {
    return this.aftercarePlans.filter((p) => p.contractId === contractId);
  }
  async createAftercareCheckin(checkin: AftercareCheckin) {
    this.aftercareCheckins.push(checkin);
  }
  async getAftercareCheckin(id: string) {
    return this.aftercareCheckins.find((c) => c.id === id);
  }
  async updateAftercareCheckin(checkin: AftercareCheckin) {
    const i = this.aftercareCheckins.findIndex((c) => c.id === checkin.id);
    if (i >= 0) this.aftercareCheckins[i] = checkin;
  }
  async aftercareCheckinsForContract(contractId: string) {
    return this.aftercareCheckins.filter((c) => c.contractId === contractId);
  }
  async createVideoHello(hello: VideoHello) {
    this.videoHellos.push(hello);
  }
  async getVideoHello(id: string) {
    return this.videoHellos.find((h) => h.id === id);
  }
  async updateVideoHello(hello: VideoHello) {
    const i = this.videoHellos.findIndex((h) => h.id === hello.id);
    if (i >= 0) this.videoHellos[i] = hello;
  }
  async videoHellosForContract(contractId: string) {
    return this.videoHellos.filter((h) => h.contractId === contractId);
  }
  async createScheduledCheckin(checkin: ScheduledCheckin) {
    this.scheduledCheckins.push(checkin);
  }
  async getScheduledCheckin(id: string) {
    return this.scheduledCheckins.find((c) => c.id === id);
  }
  async updateScheduledCheckin(checkin: ScheduledCheckin) {
    const i = this.scheduledCheckins.findIndex((c) => c.id === checkin.id);
    if (i >= 0) this.scheduledCheckins[i] = checkin;
  }
  async scheduledCheckinsForContract(contractId: string) {
    return this.scheduledCheckins.filter((c) => c.contractId === contractId);
  }
  async reset() {
    this.users.clear();
    this.profiles.clear();
    this.blocks = [];
    this.reports = [];
    this.codes.clear();
    this.likes = [];
    this.passes = [];
    this.messages = [];
    this.ratings = [];
    this.contracts = [];
    this.duties = [];
    this.rewards = [];
    this.bookings = [];
    this.aftercarePlans = [];
    this.aftercareCheckins = [];
    this.videoHellos = [];
    this.scheduledCheckins = [];
    for (const key of this.invites.keys()) this.invites.set(key, null);
  }
}
