import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './index';
import { InMemoryStore } from './store';

process.env.ALLOW_DEV_CODE = 'true';
process.env.JWT_SECRET = 'test-secret-for-phase0-only';

const store = new InMemoryStore(['DEN-WELCOME-2026', 'DEN-SECOND-2026', 'DEN-THIRD-2026', 'DEN-FOURTH-2026']);
const app = createApp(store);

async function signup(email: string, invite = 'DEN-WELCOME-2026') {
  const reqRes = await request(app)
    .post('/api/v1/auth/request-code')
    .send({ dateOfBirth: '2000-01-01', email, inviteCode: invite });
  const code = (reqRes.body as { devCode: string }).devCode;
  const verify = await request(app).post('/api/v1/auth/verify-code').send({ code, email });
  return verify.body as { profile: null; token: string; user: { id: string } };
}

describe('Den & Desk API, Phase 0', () => {
  beforeEach(async () => {
    await store.reset();
  });

  it('answers health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects under-18 signups', async () => {
    const res = await request(app)
      .post('/api/v1/auth/request-code')
      .send({ dateOfBirth: '2010-01-01', email: 'young@example.com', inviteCode: 'DEN-WELCOME-2026' });
    expect(res.status).toBe(403);
  });

  it('rejects invalid invite codes', async () => {
    const res = await request(app)
      .post('/api/v1/auth/request-code')
      .send({ dateOfBirth: '2000-01-01', email: 'a@example.com', inviteCode: 'WRONG' });
    expect(res.status).toBe(403);
  });

  it('rejects a wrong verification code', async () => {
    await request(app)
      .post('/api/v1/auth/request-code')
      .send({ dateOfBirth: '2000-01-01', email: 'b@example.com', inviteCode: 'DEN-WELCOME-2026' });
    const res = await request(app).post('/api/v1/auth/verify-code').send({ code: '000000', email: 'b@example.com' });
    expect(res.status).toBe(401);
  });

  it('signs up, creates a kitty profile, and blocks another user', async () => {
    const first = await signup('kitty@example.com');
    expect(first.token).toBeTruthy();
    const profile = await request(app)
      .post('/api/v1/profiles')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ displayName: 'Moss', petType: 'Kitty', role: 'Pet' });
    expect(profile.status).toBe(201);

    const second = await signup('owner@example.com', 'DEN-SECOND-2026');
    const secondProfile = await request(app)
      .post('/api/v1/profiles')
      .set('Authorization', `Bearer ${second.token}`)
      .send({ displayName: 'Rowan', petType: null, role: 'Owner' });
    expect(secondProfile.status).toBe(201);

    const block = await request(app)
      .post('/api/v1/blocks')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ blockedUserId: second.user.id });
    expect(block.status).toBe(201);

    const list = await request(app).get('/api/v1/profiles').set('Authorization', `Bearer ${first.token}`);
    expect(list.body.profiles).toHaveLength(0);
  });

  it('rejects pony profiles at launch', async () => {
    const first = await signup('pony@example.com');
    const res = await request(app)
      .post('/api/v1/profiles')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ displayName: 'Moss', petType: 'Pony', role: 'Pet' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/later phase/);
  });

  it('flags safety reports urgent and requires auth for profiles', async () => {
    const first = await signup('rep@example.com');
    const second = await signup('rep2@example.com', 'DEN-SECOND-2026');
    const report = await request(app)
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${first.token}`)
      .send({ category: 'safety', details: 'test', reportedUserId: second.user.id });
    expect(report.status).toBe(201);
    expect(report.body.report.urgent).toBe(true);

    const unauth = await request(app).get('/api/v1/profiles');
    expect(unauth.status).toBe(401);
  });

  it('states the policy plainly', async () => {
    const res = await request(app).get('/api/v1/policy');
    expect(res.body.bestialityBanned).toBe(true);
    expect(res.body.humanPetRoleplayWelcome).toBe(true);
  });
});

describe('Den & Desk API, Phase 1', () => {
  beforeEach(async () => {
    await store.reset();
    delete process.env.MODERATOR_EMAILS;
  });

  async function signupProfile(
    email: string,
    invite: string,
    profile: { displayName: string; petType: string | null; role: string; meetingMode?: string; region?: string },
  ) {
    const user = await signup(email, invite);
    const res = await request(app)
      .post('/api/v1/profiles')
      .set('Authorization', `Bearer ${user.token}`)
      .send(profile);
    expect(res.status).toBe(201);
    return { ...user, profile: res.body.profile as { id: string; userId: string } };
  }

  it('filters discovery by role, pet type, meeting mode and region', async () => {
    const owner = await signupProfile('o1@example.com', 'DEN-WELCOME-2026', {
      displayName: 'Rowan',
      meetingMode: 'Online',
      petType: null,
      region: 'Coquitlam',
      role: 'Owner',
    });
    await signupProfile('k1@example.com', 'DEN-SECOND-2026', {
      displayName: 'Moss',
      meetingMode: 'Both',
      petType: 'Kitty',
      region: 'Coquitlam',
      role: 'Pet',
    });
    await signupProfile('p1@example.com', 'DEN-THIRD-2026', {
      displayName: 'Biscuit',
      meetingMode: 'InPerson',
      petType: 'Puppy',
      region: 'Elsewhere',
      role: 'Pet',
    });
    const viewer = owner;
    const pets = await request(app)
      .get('/api/v1/profiles?role=Pet&petType=Kitty')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(pets.body.profiles).toHaveLength(1);
    expect(pets.body.profiles[0].displayName).toBe('Moss');
    const local = await request(app)
      .get('/api/v1/profiles?region=coquitlam')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(local.body.profiles).toHaveLength(1);
    const online = await request(app)
      .get('/api/v1/profiles?meetingMode=Online')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(online.body.profiles).toHaveLength(0);
    const bad = await request(app)
      .get('/api/v1/profiles?role=Dragon')
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(bad.status).toBe(400);
  });

  it('likes, passes, and hides passed profiles from discovery', async () => {
    const a = await signupProfile('la@example.com', 'DEN-WELCOME-2026', {
      displayName: 'Ari',
      petType: null,
      role: 'Owner',
    });
    const b = await signupProfile('lb@example.com', 'DEN-SECOND-2026', {
      displayName: 'Bee',
      petType: 'Kitty',
      role: 'Pet',
    });
    const like = await request(app)
      .post('/api/v1/likes')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ likedUserId: b.user.id });
    expect(like.status).toBe(201);
    const likes = await request(app).get('/api/v1/likes').set('Authorization', `Bearer ${a.token}`);
    expect(likes.body.likes).toHaveLength(1);
    const pass = await request(app)
      .post('/api/v1/passes')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ passedUserId: b.user.id });
    expect(pass.status).toBe(201);
    const list = await request(app).get('/api/v1/profiles').set('Authorization', `Bearer ${a.token}`);
    expect(list.body.profiles).toHaveLength(0);
  });

  it('blocks both ways in discovery and messaging', async () => {
    const a = await signupProfile('ba@example.com', 'DEN-WELCOME-2026', {
      displayName: 'Ari',
      petType: null,
      role: 'Owner',
    });
    const b = await signupProfile('bb@example.com', 'DEN-SECOND-2026', {
      displayName: 'Bee',
      petType: 'Kitty',
      role: 'Pet',
    });
    await request(app).post('/api/v1/blocks').set('Authorization', `Bearer ${a.token}`).send({ blockedUserId: b.user.id });
    const listForB = await request(app).get('/api/v1/profiles').set('Authorization', `Bearer ${b.token}`);
    expect(listForB.body.profiles).toHaveLength(0);
    const msg = await request(app)
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ body: 'hello', recipientUserId: a.user.id });
    expect(msg.status).toBe(403);
  });

  it('runs a fixed mailbox thread with unread counts', async () => {
    const a = await signupProfile('ma@example.com', 'DEN-WELCOME-2026', {
      displayName: 'Ari',
      petType: null,
      role: 'Owner',
    });
    const b = await signupProfile('mb@example.com', 'DEN-SECOND-2026', {
      displayName: 'Bee',
      petType: 'Kitty',
      role: 'Pet',
    });
    const sent = await request(app)
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ body: 'hello Bee', recipientUserId: b.user.id });
    expect(sent.status).toBe(201);
    const bad = await request(app)
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ body: '', recipientUserId: b.user.id });
    expect(bad.status).toBe(400);
    const threads = await request(app).get('/api/v1/messages/threads').set('Authorization', `Bearer ${b.token}`);
    expect(threads.body.threads).toHaveLength(1);
    expect(threads.body.threads[0].unreadCount).toBe(1);
    const thread = await request(app)
      .get(`/api/v1/messages/threads/${a.user.id}`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(thread.body.messages).toHaveLength(1);
    const threadsAfter = await request(app).get('/api/v1/messages/threads').set('Authorization', `Bearer ${b.token}`);
    expect(threadsAfter.body.threads[0].unreadCount).toBe(0);
    const reply = await request(app)
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ body: 'hi Ari', recipientUserId: a.user.id });
    expect(reply.status).toBe(201);
    const full = await request(app)
      .get(`/api/v1/messages/threads/${b.user.id}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(full.body.messages.map((m: { body: string }) => m.body)).toEqual(['hello Bee', 'hi Ari']);
  });

  it('counts trust only from mutual ratings', async () => {
    const a = await signupProfile('ta@example.com', 'DEN-WELCOME-2026', {
      displayName: 'Ari',
      petType: null,
      role: 'Owner',
    });
    const b = await signupProfile('tb@example.com', 'DEN-SECOND-2026', {
      displayName: 'Bee',
      petType: 'Kitty',
      role: 'Pet',
    });
    const c = await signupProfile('tc@example.com', 'DEN-THIRD-2026', {
      displayName: 'Cleo',
      petType: 'Puppy',
      role: 'Pet',
    });
    await request(app).post('/api/v1/ratings').set('Authorization', `Bearer ${a.token}`).send({ ratedUserId: b.user.id, score: 5 });
    let trust = await request(app).get(`/api/v1/trust/${b.user.id}`).set('Authorization', `Bearer ${a.token}`);
    expect(trust.body.trust.mutualRaterCount).toBe(0);
    expect(trust.body.trust.badge).toBeNull();
    await request(app).post('/api/v1/ratings').set('Authorization', `Bearer ${b.token}`).send({ ratedUserId: a.user.id, score: 4 });
    trust = await request(app).get(`/api/v1/trust/${b.user.id}`).set('Authorization', `Bearer ${a.token}`);
    expect(trust.body.trust.mutualRaterCount).toBe(1);
    expect(trust.body.trust.averageScore).toBe(5);
    expect(trust.body.trust.badge).toBe('Newly trusted');
    await request(app).post('/api/v1/ratings').set('Authorization', `Bearer ${c.token}`).send({ ratedUserId: b.user.id, score: 5 });
    await request(app).post('/api/v1/ratings').set('Authorization', `Bearer ${b.token}`).send({ ratedUserId: c.user.id, score: 5 });
    trust = await request(app).get(`/api/v1/trust/${b.user.id}`).set('Authorization', `Bearer ${a.token}`);
    expect(trust.body.trust.mutualRaterCount).toBe(2);
    expect(trust.body.trust.badge).toBe('Trusted');
    const self = await request(app)
      .post('/api/v1/ratings')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ ratedUserId: a.user.id, score: 5 });
    expect(self.status).toBe(400);
    const badScore = await request(app)
      .post('/api/v1/ratings')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ ratedUserId: b.user.id, score: 6 });
    expect(badScore.status).toBe(400);
  });

  it('keeps the safety queue moderator-only, urgent first, and resolvable', async () => {
    process.env.MODERATOR_EMAILS = 'mod@example.com';
    const mod = await signupProfile('mod@example.com', 'DEN-WELCOME-2026', {
      displayName: 'Mod',
      petType: null,
      role: 'Owner',
    });
    const a = await signupProfile('qa@example.com', 'DEN-SECOND-2026', {
      displayName: 'Ari',
      petType: null,
      role: 'Owner',
    });
    const b = await signupProfile('qb@example.com', 'DEN-THIRD-2026', {
      displayName: 'Bee',
      petType: 'Kitty',
      role: 'Pet',
    });
    const me = await request(app).get('/api/v1/profiles/me').set('Authorization', `Bearer ${mod.token}`);
    expect(me.body.isModerator).toBe(true);
    const denied = await request(app).get('/api/v1/reports/queue').set('Authorization', `Bearer ${a.token}`);
    expect(denied.status).toBe(403);
    await request(app)
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ category: 'other', details: 'spammy', reportedUserId: b.user.id });
    const safety = await request(app)
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ category: 'safety', details: 'unsafe', reportedUserId: b.user.id });
    expect(safety.body.report.urgent).toBe(true);
    const queue = await request(app).get('/api/v1/reports/queue').set('Authorization', `Bearer ${mod.token}`);
    expect(queue.body.reports).toHaveLength(2);
    expect(queue.body.reports[0].urgent).toBe(true);
    const resolve = await request(app)
      .post(`/api/v1/reports/${queue.body.reports[0].id}/resolve`)
      .set('Authorization', `Bearer ${mod.token}`);
    expect(resolve.status).toBe(200);
    const queueAfter = await request(app).get('/api/v1/reports/queue').set('Authorization', `Bearer ${mod.token}`);
    expect(queueAfter.body.reports).toHaveLength(1);
  });
});

describe('Den & Desk API, Phase 2', () => {
  beforeEach(async () => {
    await store.reset();
    delete process.env.MODERATOR_EMAILS;
  });

  async function signupProfile2(
    email: string,
    invite: string,
    profile: { displayName: string; petType: string | null; role: string },
  ) {
    const user = await signup(email, invite);
    const res = await request(app)
      .post('/api/v1/profiles')
      .set('Authorization', `Bearer ${user.token}`)
      .send(profile);
    expect(res.status).toBe(201);
    return { ...user, profile: res.body.profile as { id: string; userId: string } };
  }

  async function activeContract(a: { token: string; user: { id: string } }, b: { token: string; user: { id: string } }) {
    const created = await request(app)
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ limits: 'Kindness first.', partnerUserId: b.user.id, safeword: 'red', title: 'Our agreement' });
    expect(created.status).toBe(201);
    const id = created.body.contract.id as string;
    const signA = await request(app).post(`/api/v1/contracts/${id}/sign`).set('Authorization', `Bearer ${a.token}`);
    expect(signA.body.contract.status).toBe('draft');
    const signB = await request(app)
      .post(`/api/v1/contracts/${id}/sign`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(signB.body.contract.status).toBe('active');
    return id;
  }

  it('requires both sides to sign before a contract becomes active', async () => {
    const a = await signupProfile2('c1a@example.com', 'DEN-WELCOME-2026', { displayName: 'Rowan', petType: null, role: 'Owner' });
    const b = await signupProfile2('c1b@example.com', 'DEN-SECOND-2026', { displayName: 'Moss', petType: 'Kitty', role: 'Pet' });
    const created = await request(app)
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ partnerUserId: b.user.id, safeword: 'red', title: 'Our agreement' });
    expect(created.status).toBe(201);
    expect(created.body.contract.status).toBe('draft');
    const id = created.body.contract.id as string;
    const badSafeword = await request(app)
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ partnerUserId: b.user.id, safeword: '', title: 'No safeword' });
    expect(badSafeword.status).toBe(400);
    const signA = await request(app).post(`/api/v1/contracts/${id}/sign`).set('Authorization', `Bearer ${a.token}`);
    expect(signA.body.contract.status).toBe('draft');
    const signB = await request(app).post(`/api/v1/contracts/${id}/sign`).set('Authorization', `Bearer ${b.token}`);
    expect(signB.body.contract.status).toBe('active');
    const signAgain = await request(app).post(`/api/v1/contracts/${id}/sign`).set('Authorization', `Bearer ${a.token}`);
    expect(signAgain.status).toBe(400);
  });

  it('stops on a safeword, needs both sides to resume, and always allows ending', async () => {
    const a = await signupProfile2('c2a@example.com', 'DEN-WELCOME-2026', { displayName: 'Rowan', petType: null, role: 'Owner' });
    const b = await signupProfile2('c2b@example.com', 'DEN-SECOND-2026', { displayName: 'Moss', petType: 'Kitty', role: 'Pet' });
    const id = await activeContract(a, b);
    const stopped = await request(app).post(`/api/v1/contracts/${id}/safeword`).set('Authorization', `Bearer ${b.token}`);
    expect(stopped.body.contract.status).toBe('paused');
    const resumeOne = await request(app).post(`/api/v1/contracts/${id}/resume`).set('Authorization', `Bearer ${b.token}`);
    expect(resumeOne.body.contract.status).toBe('paused');
    const resumeTwo = await request(app).post(`/api/v1/contracts/${id}/resume`).set('Authorization', `Bearer ${a.token}`);
    expect(resumeTwo.body.contract.status).toBe('active');
    await request(app).post('/api/v1/blocks').set('Authorization', `Bearer ${a.token}`).send({ blockedUserId: b.user.id });
    const endAfterBlock = await request(app).post(`/api/v1/contracts/${id}/end`).set('Authorization', `Bearer ${a.token}`);
    expect(endAfterBlock.body.contract.status).toBe('ended');
    const dutyAfterEnd = await request(app)
      .post(`/api/v1/contracts/${id}/duties`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ assignedToUserId: b.user.id, title: 'Too late' });
    expect(dutyAfterEnd.status).toBe(400);
  });

  it('runs duties from open to approved with a reward, and back to open on decline', async () => {
    const a = await signupProfile2('d1a@example.com', 'DEN-WELCOME-2026', { displayName: 'Rowan', petType: null, role: 'Owner' });
    const b = await signupProfile2('d1b@example.com', 'DEN-SECOND-2026', { displayName: 'Moss', petType: 'Kitty', role: 'Pet' });
    const id = await activeContract(a, b);
    const duty = await request(app)
      .post(`/api/v1/contracts/${id}/duties`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ assignedToUserId: b.user.id, description: 'Tidy the den.', title: 'Tidy' });
    expect(duty.status).toBe(201);
    const dutyId = duty.body.duty.id as string;
    const selfApprove = await request(app).post(`/api/v1/duties/${dutyId}/approve`).set('Authorization', `Bearer ${b.token}`);
    expect(selfApprove.status).toBe(403);
    const submit = await request(app)
      .post(`/api/v1/duties/${dutyId}/submit`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ proofNote: 'Photo note: tidy den, cushions straight.' });
    expect(submit.body.duty.status).toBe('submitted');
    const approve = await request(app)
      .post(`/api/v1/duties/${dutyId}/approve`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ reviewNote: 'Lovely, thank you.' });
    expect(approve.body.duty.status).toBe('approved');
    const reward = await request(app)
      .post(`/api/v1/duties/${dutyId}/rewards`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ title: 'Extra cuddle time' });
    expect(reward.status).toBe(201);
    const secondReward = await request(app)
      .post(`/api/v1/duties/${dutyId}/rewards`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ title: 'Another' });
    expect(secondReward.status).toBe(409);

    const duty2 = await request(app)
      .post(`/api/v1/contracts/${id}/duties`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ assignedToUserId: b.user.id, title: 'Second task' });
    const duty2Id = duty2.body.duty.id as string;
    await request(app).post(`/api/v1/duties/${duty2Id}/submit`).set('Authorization', `Bearer ${b.token}`).send({ proofNote: 'Done-ish.' });
    const declined = await request(app)
      .post(`/api/v1/duties/${duty2Id}/decline`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ reviewNote: 'Not quite — please try again.' });
    expect(declined.body.duty.status).toBe('open');
    expect(declined.body.duty.proofNote).toBe('');
  });

  it('proposes, confirms, declines and cancels bookings', async () => {
    const a = await signupProfile2('b1a@example.com', 'DEN-WELCOME-2026', { displayName: 'Rowan', petType: null, role: 'Owner' });
    const b = await signupProfile2('b1b@example.com', 'DEN-SECOND-2026', { displayName: 'Moss', petType: 'Kitty', role: 'Pet' });
    const id = await activeContract(a, b);
    const start = Date.now() + 24 * 60 * 60 * 1000;
    const bad = await request(app)
      .post(`/api/v1/contracts/${id}/bookings`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ endAt: start, meetingMode: 'Online', startAt: start, workDescription: 'Backwards' });
    expect(bad.status).toBe(400);
    const booking = await request(app)
      .post(`/api/v1/contracts/${id}/bookings`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ endAt: start + 2 * 60 * 60 * 1000, meetingMode: 'Online', region: 'Tri-Cities', startAt: start, workDescription: 'Cleaning session' });
    expect(booking.status).toBe(201);
    const bookingId = booking.body.booking.id as string;
    const selfConfirm = await request(app).post(`/api/v1/bookings/${bookingId}/confirm`).set('Authorization', `Bearer ${a.token}`);
    expect(selfConfirm.status).toBe(403);
    const confirmed = await request(app).post(`/api/v1/bookings/${bookingId}/confirm`).set('Authorization', `Bearer ${b.token}`);
    expect(confirmed.body.booking.status).toBe('confirmed');
    const cancelled = await request(app).post(`/api/v1/bookings/${bookingId}/cancel`).set('Authorization', `Bearer ${a.token}`);
    expect(cancelled.body.booking.status).toBe('cancelled');
    const booking2 = await request(app)
      .post(`/api/v1/contracts/${id}/bookings`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ endAt: start + 60 * 60 * 1000, meetingMode: 'Both', startAt: start, workDescription: 'Chat' });
    const declined = await request(app).post(`/api/v1/bookings/${booking2.body.booking.id}/decline`).set('Authorization', `Bearer ${b.token}`);
    expect(declined.body.booking.status).toBe('declined');
  });

  it('runs aftercare plans, check-ins, video hellos and scheduled check-ins', async () => {
    const a = await signupProfile2('a1a@example.com', 'DEN-WELCOME-2026', { displayName: 'Rowan', petType: null, role: 'Owner' });
    const b = await signupProfile2('a1b@example.com', 'DEN-SECOND-2026', { displayName: 'Moss', petType: 'Kitty', role: 'Pet' });
    const c = await signupProfile2('a1c@example.com', 'DEN-THIRD-2026', { displayName: 'Cleo', petType: 'Puppy', role: 'Pet' });
    const id = await activeContract(a, b);
    const plan = await request(app)
      .post(`/api/v1/contracts/${id}/aftercare/plans`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ checkInMinutes: 0, closurePhrase: 'scene over, welcome back', selfCarePrompts: ['Get water', 'Grab a blanket'] });
    expect(plan.status).toBe(201);
    const checkin = await request(app)
      .post(`/api/v1/contracts/${id}/aftercare/checkins`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ kind: 'scheduled', note: 'How are you feeling?', planId: plan.body.plan.id });
    expect(checkin.status).toBe(201);
    const due = await request(app)
      .get(`/api/v1/contracts/${id}/aftercare/checkins?due=true`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(due.body.checkins).toHaveLength(1);
    const done = await request(app)
      .post(`/api/v1/aftercare/checkins/${checkin.body.checkin.id}/complete`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(done.body.checkin.completedAt).not.toBeNull();
    const dueAfter = await request(app)
      .get(`/api/v1/contracts/${id}/aftercare/checkins?due=true`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(dueAfter.body.checkins).toHaveLength(0);

    const hello = await request(app)
      .post(`/api/v1/contracts/${id}/video-hellos`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ message: 'Say hello on video?' });
    expect(hello.status).toBe(201);
    const helloId = hello.body.hello.id as string;
    const wrongAccept = await request(app).post(`/api/v1/video-hellos/${helloId}/accept`).set('Authorization', `Bearer ${a.token}`);
    expect(wrongAccept.status).toBe(403);
    const accepted = await request(app).post(`/api/v1/video-hellos/${helloId}/accept`).set('Authorization', `Bearer ${b.token}`);
    expect(accepted.body.hello.status).toBe('accepted');
    const completed = await request(app).post(`/api/v1/video-hellos/${helloId}/complete`).set('Authorization', `Bearer ${b.token}`);
    expect(completed.body.hello.status).toBe('completed');

    const sched = await request(app)
      .post(`/api/v1/contracts/${id}/checkins`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ dueAt: Date.now() + 60 * 60 * 1000, note: 'Evening check-in' });
    expect(sched.status).toBe(201);
    const schedDone = await request(app).post(`/api/v1/checkins/${sched.body.checkin.id}/complete`).set('Authorization', `Bearer ${b.token}`);
    expect(schedDone.body.checkin.completedAt).not.toBeNull();

    const outsiderPlan = await request(app)
      .post(`/api/v1/contracts/${id}/aftercare/plans`)
      .set('Authorization', `Bearer ${c.token}`)
      .send({ checkInMinutes: 30, closurePhrase: 'nope', selfCarePrompts: ['Water'] });
    expect(outsiderPlan.status).toBe(403);
  });

  it('blocks contract creation and duty work between blocked users, but still allows ending', async () => {
    const a = await signupProfile2('x1a@example.com', 'DEN-WELCOME-2026', { displayName: 'Rowan', petType: null, role: 'Owner' });
    const b = await signupProfile2('x1b@example.com', 'DEN-SECOND-2026', { displayName: 'Moss', petType: 'Kitty', role: 'Pet' });
    await request(app).post('/api/v1/blocks').set('Authorization', `Bearer ${a.token}`).send({ blockedUserId: b.user.id });
    const blockedContract = await request(app)
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ partnerUserId: b.user.id, safeword: 'red', title: 'Blocked' });
    expect(blockedContract.status).toBe(403);
  });
});

describe('Den & Desk API, Phase 3', () => {
  beforeEach(async () => {
    await store.reset();
    delete process.env.MODERATOR_EMAILS;
  });

  async function signupProfile3(
    email: string,
    invite: string,
    profile: { displayName: string; petType: string | null; role: string },
  ) {
    const user = await signup(email, invite);
    const res = await request(app)
      .post('/api/v1/profiles')
      .set('Authorization', `Bearer ${user.token}`)
      .send(profile);
    expect(res.status).toBe(201);
    return { ...user, profile: res.body.profile as { id: string; userId: string } };
  }

  async function activeContract3(a: { token: string; user: { id: string } }, b: { token: string; user: { id: string } }) {
    const created = await request(app)
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ limits: 'Kindness first.', partnerUserId: b.user.id, safeword: 'red', title: 'Our agreement' });
    expect(created.status).toBe(201);
    const id = created.body.contract.id as string;
    await request(app).post(`/api/v1/contracts/${id}/sign`).set('Authorization', `Bearer ${a.token}`);
    const signB = await request(app).post(`/api/v1/contracts/${id}/sign`).set('Authorization', `Bearer ${b.token}`);
    expect(signB.body.contract.status).toBe('active');
    return id;
  }

  async function pair() {
    const owner = await signupProfile3('p3o@example.com', 'DEN-WELCOME-2026', { displayName: 'Rowan', petType: null, role: 'Owner' });
    const pet = await signupProfile3('p3k@example.com', 'DEN-SECOND-2026', { displayName: 'Moss', petType: 'Kitty', role: 'Pet' });
    const contractId = await activeContract3(owner, pet);
    return { contractId, owner, pet };
  }

  it('sends owner commands and lets the pet answer Done, Need help, or Pass', async () => {
    const { contractId, owner, pet } = await pair();
    const badKind = await request(app)
      .post(`/api/v1/contracts/${contractId}/commands`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'Teleport' });
    expect(badKind.status).toBe(400);
    const petSend = await request(app)
      .post(`/api/v1/contracts/${contractId}/commands`)
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ kind: 'Eat' });
    expect(petSend.status).toBe(403);
    const command = await request(app)
      .post(`/api/v1/contracts/${contractId}/commands`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'Come home', note: 'Time to come home, please.' });
    expect(command.status).toBe(201);
    expect(command.body.command.status).toBe('sent');
    const commandId = command.body.command.id as string;
    const ownerAnswer = await request(app)
      .post(`/api/v1/commands/${commandId}/respond`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ status: 'done' });
    expect(ownerAnswer.status).toBe(403);
    const answered = await request(app)
      .post(`/api/v1/commands/${commandId}/respond`)
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ status: 'done' });
    expect(answered.body.command.status).toBe('done');
    const again = await request(app)
      .post(`/api/v1/commands/${commandId}/respond`)
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ status: 'passed' });
    expect(again.status).toBe(400);
    const list = await request(app).get(`/api/v1/contracts/${contractId}/commands`).set('Authorization', `Bearer ${pet.token}`);
    expect(list.body.commands).toHaveLength(1);
  });

  it('runs the daily routine template with Pass excused and no streak', async () => {
    const { pet } = await pair();
    const date = '2026-10-27';
    for (const label of ['Eat', 'Walk', 'Potty', 'Nap', 'Play']) {
      const created = await request(app)
        .post('/api/v1/routine/items')
        .set('Authorization', `Bearer ${pet.token}`)
        .send({ date, label });
      expect(created.status).toBe(201);
    }
    const duplicate = await request(app)
      .post('/api/v1/routine/items')
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ date, label: 'Eat' });
    expect(duplicate.status).toBe(200);
    const badLabel = await request(app)
      .post('/api/v1/routine/items')
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ date, label: 'Teleport' });
    expect(badLabel.status).toBe(400);
    const list = await request(app).get(`/api/v1/routine?date=${date}`).set('Authorization', `Bearer ${pet.token}`);
    expect(list.body.items).toHaveLength(5);
    const firstId = list.body.items[0].id as string;
    const passed = await request(app)
      .post(`/api/v1/routine/items/${firstId}/respond`)
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ status: 'passed' });
    expect(passed.body.item.status).toBe('passed');
  });

  it('adds, shares, and removes wishlist items with no prices or shop links', async () => {
    const { contractId, owner, pet } = await pair();
    const item = await request(app)
      .post('/api/v1/wishlist')
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ category: 'collar', label: 'Soft rose collar', note: 'Breakaway, please.' });
    expect(item.status).toBe(201);
    expect(item.body.item.shared).toBe(false);
    expect(JSON.stringify(item.body)).not.toMatch(/price|checkout|stripe|http/);
    const itemId = item.body.item.id as string;
    const partnerBefore = await request(app)
      .get(`/api/v1/contracts/${contractId}/wishlist`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(partnerBefore.body.items).toHaveLength(0);
    const shared = await request(app)
      .patch(`/api/v1/wishlist/${itemId}`)
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ shared: true });
    expect(shared.body.item.shared).toBe(true);
    const partnerAfter = await request(app)
      .get(`/api/v1/contracts/${contractId}/wishlist`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(partnerAfter.body.items).toHaveLength(1);
    const removed = await request(app).delete(`/api/v1/wishlist/${itemId}`).set('Authorization', `Bearer ${pet.token}`);
    expect(removed.status).toBe(200);
    const mine = await request(app).get('/api/v1/wishlist').set('Authorization', `Bearer ${pet.token}`);
    expect(mine.body.items).toHaveLength(0);
  });

  it('runs safe lost mode: board shows pseudonym only, pet can end it, safeword ends it, helpers only message the owner', async () => {
    const { contractId, owner, pet } = await pair();
    const helper = await signupProfile3('p3h@example.com', 'DEN-THIRD-2026', { displayName: 'Fern', petType: null, role: 'Curious' });
    const optIn = await request(app)
      .post('/api/v1/lost-opt-in')
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ enabled: true });
    expect(optIn.body.enabled).toBe(true);
    const street = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ generalArea: '123 Main Street' });
    expect(street.status).toBe(400);
    const alert = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ generalArea: 'Tri-Cities' });
    expect(alert.status).toBe(201);
    expect(alert.body.alert.generalArea).toBe('Tri-Cities');
    expect(JSON.stringify(alert.body)).not.toMatch(/latitude|longitude|gps|geolocation|watchPosition/);
    const alertId = alert.body.alert.id as string;
    const second = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ generalArea: 'Elsewhere' });
    expect(second.status).toBe(409);
    const board = await request(app).get('/api/v1/lost').set('Authorization', `Bearer ${helper.token}`);
    expect(board.body.alerts).toHaveLength(1);
    expect(board.body.alerts[0].petDisplayName).toBe('Moss');
    expect(board.body.alerts[0].petType).toBe('Kitty');
    expect(JSON.stringify(board.body)).not.toMatch(/phone|latitude|longitude/);
    const helperMessage = await request(app)
      .post(`/api/v1/lost/${alertId}/message`)
      .set('Authorization', `Bearer ${helper.token}`)
      .send({ body: 'I may have information — please message me back here.' });
    expect(helperMessage.status).toBe(201);
    const ownerCannotHome = await request(app)
      .post(`/api/v1/lost/${alertId}/home`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerCannotHome.status).toBe(403);
    const home = await request(app).post(`/api/v1/lost/${alertId}/home`).set('Authorization', `Bearer ${pet.token}`);
    expect(home.body.alert.status).toBe('home');
    expect(home.body.alert.resolvedReason).toBe('pet-checkin');
    const boardAfter = await request(app).get('/api/v1/lost').set('Authorization', `Bearer ${helper.token}`);
    expect(boardAfter.body.alerts).toHaveLength(0);

    const alert2 = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ generalArea: 'Tri-Cities' });
    expect(alert2.status).toBe(201);
    const stopped = await request(app).post(`/api/v1/contracts/${contractId}/safeword`).set('Authorization', `Bearer ${pet.token}`);
    expect(stopped.body.contract.status).toBe('paused');
    const boardAfterSafeword = await request(app).get('/api/v1/lost').set('Authorization', `Bearer ${helper.token}`);
    expect(boardAfterSafeword.body.alerts).toHaveLength(0);
  });

  it('requires the pet opt-in before an owner can start lost mode, and lets a helper mark found in-app only', async () => {
    const { contractId, owner, pet } = await pair();
    const helper = await signupProfile3('p3h2@example.com', 'DEN-THIRD-2026', { displayName: 'Fern', petType: null, role: 'Curious' });
    const withoutOptIn = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ generalArea: 'Tri-Cities' });
    expect(withoutOptIn.status).toBe(403);
    await request(app).post('/api/v1/lost-opt-in').set('Authorization', `Bearer ${pet.token}`).send({ enabled: true });
    const alert = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ generalArea: 'Tri-Cities' });
    expect(alert.status).toBe(201);
    const alertId = alert.body.alert.id as string;
    const found = await request(app).post(`/api/v1/lost/${alertId}/found`).set('Authorization', `Bearer ${helper.token}`);
    expect(found.status).toBe(200);
    expect(found.body.alert.status).toBe('lost');
    expect(found.body.alert.foundByUserId).toBe(helper.user.id);
    const board = await request(app).get('/api/v1/lost').set('Authorization', `Bearer ${helper.token}`);
    expect(board.body.alerts).toHaveLength(1);
    expect(board.body.alerts[0]).not.toHaveProperty('foundByUserId');
    const ownerResolve = await request(app).post(`/api/v1/lost/${alertId}/resolve`).set('Authorization', `Bearer ${owner.token}`);
    expect(ownerResolve.body.alert.status).toBe('resolved');
    expect(ownerResolve.body.alert.resolvedReason).toBe('owner-resolved');
  });

  it('lets the pet turn lost-game opt-in off, closing open alerts at once', async () => {
    const { contractId, owner, pet } = await pair();
    await request(app).post('/api/v1/lost-opt-in').set('Authorization', `Bearer ${pet.token}`).send({ enabled: true });
    const alert = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ generalArea: 'Tri-Cities' });
    expect(alert.status).toBe(201);
    const off = await request(app).post('/api/v1/lost-opt-in').set('Authorization', `Bearer ${pet.token}`).send({ enabled: false });
    expect(off.body.enabled).toBe(false);
    const board = await request(app).get('/api/v1/lost').set('Authorization', `Bearer ${owner.token}`);
    expect(board.body.alerts).toHaveLength(0);
  });

  it('generates a poster with only pseudonym, pet type, general area, and an in-app-only reward', async () => {
    const { contractId, owner, pet } = await pair();
    await request(app).post('/api/v1/lost-opt-in').set('Authorization', `Bearer ${pet.token}`).send({ enabled: true });
    const badReward = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ generalArea: 'Tri-Cities', reward: 'cash' });
    expect(badReward.status).toBe(400);
    const alert = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ generalArea: 'Tri-Cities', reward: 'treat' });
    expect(alert.status).toBe(201);
    expect(alert.body.alert.reward).toBe('treat');
    const helper = await signupProfile3('p3p@example.com', 'DEN-THIRD-2026', { displayName: 'Fern', petType: null, role: 'Curious' });
    const board = await request(app).get('/api/v1/lost').set('Authorization', `Bearer ${helper.token}`);
    expect(board.body.alerts).toHaveLength(1);
    const poster = board.body.alerts[0];
    expect(poster.petDisplayName).toBe('Moss');
    expect(poster.petType).toBe('Kitty');
    expect(poster.generalArea).toBe('Tri-Cities');
    expect(poster.reward).toBe('treat');
    expect(poster.soundEnabled).toBe(true);
    expect(JSON.stringify(poster)).not.toMatch(/phone|latitude|longitude|gps|geolocation/i);
  });

  it('lets the pet mute the lost-game sound, and matches proximity only by shared in-game play-area label', async () => {
    const { contractId, owner, pet } = await pair();
    await request(app).post('/api/v1/lost-opt-in').set('Authorization', `Bearer ${pet.token}`).send({ enabled: true });
    const helper = await signupProfile3('p3g@example.com', 'DEN-THIRD-2026', { displayName: 'Fern', petType: null, role: 'Curious' });
    const alert = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ generalArea: 'Tri-Cities' });
    expect(alert.status).toBe(201);
    const empty = await request(app).get('/api/v1/lost/nearby').set('Authorization', `Bearer ${helper.token}`);
    expect(empty.body.alerts).toHaveLength(0);
    await request(app).post('/api/v1/game-area').set('Authorization', `Bearer ${pet.token}`).send({ area: 'Forest clearing' });
    await request(app).post('/api/v1/game-area').set('Authorization', `Bearer ${helper.token}`).send({ area: 'Meadow' });
    const different = await request(app).get('/api/v1/lost/nearby').set('Authorization', `Bearer ${helper.token}`);
    expect(different.body.alerts).toHaveLength(0);
    await request(app).post('/api/v1/game-area').set('Authorization', `Bearer ${helper.token}`).send({ area: 'Forest clearing' });
    const nearby = await request(app).get('/api/v1/lost/nearby').set('Authorization', `Bearer ${helper.token}`);
    expect(nearby.body.alerts).toHaveLength(1);
    expect(nearby.body.alerts[0].soundEnabled).toBe(true);
    await request(app).post('/api/v1/lost-sound').set('Authorization', `Bearer ${pet.token}`).send({ enabled: false });
    const muted = await request(app).get('/api/v1/lost/nearby').set('Authorization', `Bearer ${helper.token}`);
    expect(muted.body.alerts[0].soundEnabled).toBe(false);
  });

  it('sends an in-app message to the owner only when a helper taps I think I found them', async () => {
    const { contractId, owner, pet } = await pair();
    await request(app).post('/api/v1/lost-opt-in').set('Authorization', `Bearer ${pet.token}`).send({ enabled: true });
    const helper = await signupProfile3('p3f@example.com', 'DEN-THIRD-2026', { displayName: 'Fern', petType: null, role: 'Curious' });
    const alert = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ generalArea: 'Tri-Cities' });
    const found = await request(app).post(`/api/v1/lost/${alert.body.alert.id}/found`).set('Authorization', `Bearer ${helper.token}`);
    expect(found.status).toBe(200);
    const threads = await request(app).get('/api/v1/messages/threads').set('Authorization', `Bearer ${owner.token}`);
    const thread = threads.body.threads.find((t: { partnerUserId: string }) => t.partnerUserId === helper.user.id);
    expect(thread).toBeDefined();
    expect(thread.lastMessage.body).toMatch(/found in-app/);
    expect(thread.lastMessage.body).toMatch(/will not meet/);
  });

  it('blocks lost-alert interaction between blocked users, while the pet can still turn lost mode off', async () => {
    const { contractId, owner, pet } = await pair();
    await request(app).post('/api/v1/lost-opt-in').set('Authorization', `Bearer ${pet.token}`).send({ enabled: true });
    const alert = await request(app)
      .post(`/api/v1/contracts/${contractId}/lost`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ generalArea: 'Tri-Cities' });
    const alertId = alert.body.alert.id as string;
    await request(app).post('/api/v1/blocks').set('Authorization', `Bearer ${owner.token}`).send({ blockedUserId: pet.user.id });
    const board = await request(app).get('/api/v1/lost').set('Authorization', `Bearer ${owner.token}`);
    expect(board.body.alerts).toHaveLength(0);
    const resolveBlocked = await request(app)
      .post(`/api/v1/lost/${alertId}/resolve`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(resolveBlocked.status).toBe(403);
    const petOff = await request(app).post(`/api/v1/lost/${alertId}/off`).set('Authorization', `Bearer ${pet.token}`);
    expect(petOff.body.alert.status).toBe('resolved');
    expect(petOff.body.alert.resolvedReason).toBe('pet-off');
  });

  it('sends private praise and correction notes inside an active contract only', async () => {
    const { contractId, owner, pet } = await pair();
    const note = await request(app)
      .post(`/api/v1/contracts/${contractId}/praise`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'praise', text: 'Good kitten' });
    expect(note.status).toBe(201);
    const petSend = await request(app)
      .post(`/api/v1/contracts/${contractId}/praise`)
      .set('Authorization', `Bearer ${pet.token}`)
      .send({ kind: 'praise', text: 'Good owner' });
    expect(petSend.status).toBe(403);
    const list = await request(app).get(`/api/v1/contracts/${contractId}/praise`).set('Authorization', `Bearer ${pet.token}`);
    expect(list.body.notes).toHaveLength(1);
    expect(list.body.notes[0].text).toBe('Good kitten');
    await request(app).post(`/api/v1/contracts/${contractId}/end`).set('Authorization', `Bearer ${owner.token}`);
    const afterEnd = await request(app)
      .post(`/api/v1/contracts/${contractId}/praise`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ kind: 'correction', text: 'Too late' });
    expect(afterEnd.status).toBe(400);
  });
});
