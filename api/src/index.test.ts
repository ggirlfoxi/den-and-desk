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
