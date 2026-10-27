import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveApiBase } from './apiBase';
import { DEMO_CODE, DEMO_INVITE_CODE, demoModeEnabled, demoRequest, resetDemo, setDemoMode } from './demo';

describe('API base configurability', () => {
  it('falls back to relative calls when unset', () => {
    expect(resolveApiBase(undefined)).toBe('');
    expect(resolveApiBase('')).toBe('');
  });
  it('strips trailing slashes from a configured host', () => {
    expect(resolveApiBase('https://api.example.test///')).toBe('https://api.example.test');
  });
});

describe('mobile polish: Quick exit cannot overlap a heading', () => {
  it('is in a top-bar flow layout, not fixed over content', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
    const quickExitRule = css.match(/\.quick-exit \{[^}]*\}/)?.[0] ?? '';
    expect(quickExitRule).toContain('position: static');
    expect(quickExitRule).not.toContain('position: fixed');
    expect(css).toContain('.topbar');
    const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8');
    expect(app).toContain('<header className="topbar">');
    // Only one Quick exit button remains, inside the top bar, not
    // duplicated inside the landing card where it overlapped the
    // "Join with an invite code" heading.
    expect(app.match(/Quick exit/g)?.length).toBe(1);
  });
});

describe('test/dev demo mode', () => {
  it('is off by default and toggles on/off', () => {
    setDemoMode(false);
    expect(demoModeEnabled()).toBe(false);
    setDemoMode(true);
    expect(demoModeEnabled()).toBe(true);
    setDemoMode(false);
    expect(demoModeEnabled()).toBe(false);
  });

  it('runs the full demo flow locally with TEST / 123456, then resets', () => {
    setDemoMode(true);
    resetDemo();
    expect(demoRequest('/api/v1/auth/request-code', 'POST', { dateOfBirth: '1990-01-01', email: 'demo@test.local', inviteCode: DEMO_INVITE_CODE }).devCode).toBe(DEMO_CODE);
    expect(() => demoRequest('/api/v1/auth/request-code', 'POST', { dateOfBirth: '1990-01-01', email: 'demo@test.local', inviteCode: 'WRONG' })).toThrow(/TEST/);
    const verified = demoRequest('/api/v1/auth/verify-code', 'POST', { code: DEMO_CODE, email: 'demo@test.local' });
    expect(verified.token).toBe('demo-token');
    const saved = demoRequest('/api/v1/profiles', 'POST', { displayName: 'Demo Tester', role: 'Owner', petType: 'Kitty', meetingMode: 'Both', region: 'Tri-Cities' });
    expect((saved.profile as Record<string, unknown>).displayName).toBe('Demo Tester');
    const discovered = demoRequest('/api/v1/profiles', 'GET') as { profiles: { displayName: string }[] };
    expect(discovered.profiles.some((p) => p.displayName === 'Demo Kitty')).toBe(true);
    const contract = demoRequest('/api/v1/contracts', 'POST', { partnerUserId: 'demo-kitty', title: 'Demo contract', limits: '', safeword: 'red' }) as { contract: Record<string, unknown> };
    const contractId = String(contract.contract.id);
    const signed = demoRequest(`/api/v1/contracts/${contractId}/sign`, 'POST') as { contract: Record<string, unknown> };
    expect(signed.contract.status).toBe('active');
    demoRequest('/api/v1/messages', 'POST', { body: 'hello demo', recipientUserId: 'demo-kitty' });
    const threads = demoRequest('/api/v1/messages/threads', 'GET') as { threads: { lastMessage: { body: string } }[] };
    expect(threads.threads[0].lastMessage.body).toBe('hello demo');
    demoRequest(`/api/v1/contracts/${contractId}/duties`, 'POST', { assignedToUserId: 'demo-kitty', title: 'Demo duty', description: '' });
    const duties = demoRequest(`/api/v1/contracts/${contractId}/duties`, 'GET') as { duties: unknown[] };
    expect(duties.duties.length).toBe(1);
    demoRequest('/api/v1/routine/items', 'POST', { date: '2026-10-26', label: 'Eat' });
    demoRequest('/api/v1/wishlist', 'POST', { category: 'collar', label: 'Demo collar', note: '', shared: false });
    demoRequest('/api/v1/game-area', 'POST', { area: 'Forest clearing' });
    const alert = demoRequest(`/api/v1/contracts/${contractId}/lost`, 'POST', { generalArea: 'Tri-Cities', reward: 'badge' }) as { alert: Record<string, unknown> };
    expect(alert.alert.petDisplayName).toBe('Demo Kitty');
    const nearby = demoRequest('/api/v1/lost/nearby', 'GET') as { alerts: unknown[] };
    expect(nearby.alerts.length).toBe(1);
    const sitting = demoRequest('/api/v1/sittings', 'POST', { baseContractId: contractId, startsAt: Date.now(), endsAt: Date.now() + 3600000, routineSummary: 'Demo routine', limits: '', safewordNote: 'red' }) as { sitting: Record<string, unknown> };
    const sittingId = String(sitting.sitting.id);
    demoRequest(`/api/v1/sittings/${sittingId}/apply`, 'POST');
    const agreed = demoRequest(`/api/v1/sittings/${sittingId}/agree`, 'POST') as { sitting: Record<string, unknown> };
    expect(agreed.sitting.status).toBe('active');
    resetDemo();
    const me = demoRequest('/api/v1/profiles/me', 'GET') as { profile: unknown };
    expect(me.profile).toBeNull();
    setDemoMode(false);
  });
});
