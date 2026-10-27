import { describe, expect, it } from 'vitest';
import { PostgresStore } from './postgres';

/**
 * Mock-Pool test for the Postgres adapter. This is NOT a live Postgres
 * test: no Postgres server is available in this build environment
 * (no pg_isready, no service, no free test database provisioned in
 * this test/dev build). The fake Pool records every SQL string and
 * returns canned snake_case rows, so these tests prove the SQL, the
 * parameters, and the row mapping — not a real database round-trip.
 * A live test against a free test DATABASE_URL is still required
 * before any shared test deployment (see DEPLOY.md).
 */
type FakeRow = Record<string, unknown>;
class FakePool {
  queries: { params: unknown[]; sql: string }[] = [];
  async query(sql: string, params: unknown[] = []): Promise<{ rowCount: number; rows: FakeRow[] }> {
    this.queries.push({ params, sql });
    if (sql.includes('SELECT * FROM owner_commands WHERE id')) {
      return {
        rowCount: 1,
        rows: [{ contract_id: 'c1', created_at: '2026-10-26T00:00:00.000Z', id: 'cmd1', kind: 'Eat', note: 'Dinner', recipient_user_id: 'pet1', responded_at: null, sender_user_id: 'owner1', status: 'sent' }],
      };
    }
    if (sql.includes('SELECT * FROM routine_items WHERE user_id')) {
      return { rowCount: 1, rows: [{ created_at: '2026-10-26T00:00:00.000Z', date: '2026-10-26', id: 'r1', label: 'Eat', status: 'open', user_id: 'pet1' }] };
    }
    if (sql.includes('SELECT * FROM wishlist_items WHERE id')) {
      return { rowCount: 1, rows: [{ category: 'collar', created_at: '2026-10-26T00:00:00.000Z', id: 'w1', label: 'Red collar', note: '', shared: false, user_id: 'pet1' }] };
    }
    if (sql.includes('SELECT * FROM lost_alerts WHERE id')) {
      return {
        rowCount: 1,
        rows: [{ contract_id: 'c1', created_at: '2026-10-26T00:00:00.000Z', created_by_user_id: 'owner1', found_at: null, found_by_user_id: null, general_area: 'Tri-Cities', id: 'l1', owner_user_id: 'owner1', pet_user_id: 'pet1', resolved_at: null, resolved_reason: null, reward: 'badge', status: 'lost' }],
      };
    }
    if (sql.includes('SELECT * FROM praise_notes WHERE contract_id')) {
      return { rowCount: 1, rows: [{ contract_id: 'c1', created_at: '2026-10-26T00:00:00.000Z', id: 'p1', kind: 'praise', recipient_user_id: 'pet1', sender_user_id: 'owner1', text: 'Good kitten' }] };
    }
    if (sql.includes('SELECT * FROM sittings WHERE id')) {
      return {
        rowCount: 1,
        rows: [{ agreed_user_ids: ['owner1', 'pet1'], badge_awarded: false, base_contract_id: 'c1', created_at: '2026-10-26T00:00:00.000Z', ended_at: null, ended_reason: null, ends_at: '2026-11-02T00:00:00.000Z', handover_report: '', id: 's1', limits: 'Gentle only.', notes: [], owner_user_id: 'owner1', pet_user_id: 'pet1', routine_summary: 'Feed, play, nap.', safeword_note: 'Safeword applies.', sitter_user_id: 'sit1', starts_at: '2026-10-27T00:00:00.000Z', status: 'active' }],
      };
    }
    if (sql.includes('SELECT opt_in FROM lost_settings')) return { rowCount: 1, rows: [{ opt_in: true }] };
    if (sql.includes('SELECT sound_enabled FROM lost_settings')) return { rowCount: 1, rows: [{ sound_enabled: false }] };
    if (sql.includes('SELECT game_area FROM lost_settings')) return { rowCount: 1, rows: [{ game_area: 'Forest clearing' }] };
    return { rowCount: 0, rows: [] };
  }
}

describe('PostgresStore Phase 3 + sitting (mock Pool — NOT a live database test)', () => {
  it('writes and maps Phase 3 rows, lost settings, and sittings', async () => {
    const store = new PostgresStore('postgres://unused:unused@localhost:5432/unused');
    const fake = new FakePool();
    (store as unknown as { pool: FakePool }).pool = fake;

    await store.createOwnerCommand({ contractId: 'c1', createdAt: 0, id: 'cmd1', kind: 'Eat', note: 'Dinner', recipientUserId: 'pet1', respondedAt: null, senderUserId: 'owner1', status: 'sent' });
    const command = await store.getOwnerCommand('cmd1');
    expect(command?.kind).toBe('Eat');
    expect(command?.recipientUserId).toBe('pet1');
    expect(fake.queries.some((q) => q.sql.includes('INSERT INTO owner_commands'))).toBe(true);

    await store.createRoutineItem({ createdAt: 0, date: '2026-10-26', id: 'r1', label: 'Eat', status: 'open', userId: 'pet1' });
    expect(fake.queries.some((q) => q.sql.includes('INSERT INTO routine_items'))).toBe(true);
    const routine = await store.routineItemsForUserOnDate('pet1', '2026-10-26');
    expect(routine[0]?.label).toBe('Eat');

    await store.createWishlistItem({ category: 'collar', createdAt: 0, id: 'w1', label: 'Red collar', note: '', shared: false, userId: 'pet1' });
    const wish = await store.getWishlistItem('w1');
    expect(wish?.category).toBe('collar');
    expect(fake.queries.some((q) => q.sql.includes('INSERT INTO wishlist_items'))).toBe(true);
    expect(fake.queries.some((q) => /price|payment|checkout|stripe/i.test(q.sql))).toBe(false);

    const alert = await store.getLostAlert('l1');
    expect(alert?.generalArea).toBe('Tri-Cities');
    expect(alert?.reward).toBe('badge');
    expect(alert).not.toHaveProperty('latitude');
    expect(alert).not.toHaveProperty('phone');

    const notes = await store.praiseNotesForContract('c1');
    expect(notes[0]?.text).toBe('Good kitten');

    await store.setLostOptIn('pet1', true);
    expect(await store.getLostOptIn('pet1')).toBe(true);
    await store.setLostSound('pet1', false);
    expect(await store.getLostSound('pet1')).toBe(false);
    await store.setGameToken('pet1', 'Forest clearing');
    expect(await store.getGameToken('pet1')).toBe('Forest clearing');
    expect(fake.queries.some((q) => q.sql.includes('INSERT INTO lost_settings'))).toBe(true);

    await store.createSitting({
      agreedUserIds: ['owner1', 'pet1'],
      badgeAwarded: false,
      baseContractId: 'c1',
      createdAt: 0,
      endedAt: null,
      endedReason: null,
      endsAt: Date.now() + 1000,
      handoverReport: '',
      id: 's1',
      limits: 'Gentle only.',
      notes: [],
      ownerUserId: 'owner1',
      petUserId: 'pet1',
      routineSummary: 'Feed, play, nap.',
      safewordNote: 'Safeword applies.',
      sitterUserId: 'sit1',
      startsAt: Date.now(),
      status: 'active',
    });
    const sitting = await store.getSitting('s1');
    expect(sitting?.status).toBe('active');
    expect(sitting?.routineSummary).toBe('Feed, play, nap.');
    expect(sitting).not.toHaveProperty('address');
    expect(sitting).not.toHaveProperty('keys');
    expect(fake.queries.some((q) => q.sql.includes('INSERT INTO sittings'))).toBe(true);
  });
});
