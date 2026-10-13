import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createHmac } from 'node:crypto';
let mf, db;
const secret = 'test-admin-key-with-at-least-32-characters';
let ip = 1;
async function request(path, { method = 'GET', data, cookie, token, origin = 'https://oqb.test', address } = {}) {
  return mf.dispatchFetch(`https://oqb.test/api/v1${path}`, { method, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}), 'CF-Connecting-IP': address || `192.0.2.${ip++}` }, ...(data ? { body: JSON.stringify(data) } : {}) });
}
async function login() { const res = await request('/auth/login', { method: 'POST', data: { secret } }); assert.equal(res.status, 200); return res.headers.get('set-cookie').split(';')[0]; }
async function submit(text = 'テストのひとこと') { const res = await request('/messages', { method: 'POST', data: { body: text, kind: 'question' } }); assert.equal(res.status, 201); return (await res.json()).id; }
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ name: 'test-worker', modules: true, scriptPath: 'dist/worker.js', compatibilityDate: '2026-10-13', assets: { directory: 'public', binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { html_handling: 'none' } }, d1Databases: ['DB'], bindings: { ADMIN_SECRET: secret, RATE_LIMIT_SECRET: 'test-rate-secret-with-at-least-32-characters', ALLOW_UNPROTECTED_SUBMISSIONS: 'true', TURNSTILE_SITE_KEY: '', WEBHOOK_URL: '' } }));
  db = await mf.getD1Database('DB');
  const sql = await readFile('migrations/0001_initial.sql', 'utf8');
  for (const statement of sql.split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(statement).run();
  const ready = await request('/health');
  assert.equal(ready.status, 200, await ready.text());
});
after(async () => { await mf?.dispose(); });
test('anonymous content remains private, explicit answered publication only', async () => {
  const id = await submit('<script>alert(1)</script> 質問');
  assert.equal((await request('/messages')).status, 401);
  const cookie = await login();
  const inbox = await (await request('/messages', { cookie })).json();
  assert.ok(inbox.data.some(m => m.id === id));
  assert.equal((await (await request('/answers')).json()).data.length, 0);
  assert.equal((await request(`/messages/${id}`, { method: 'PATCH', cookie, data: { published: true } })).status, 400);
  assert.equal((await request(`/messages/${id}`, { method: 'PATCH', cookie, data: { answer: 'ありがとう', published: false } })).status, 200);
  assert.equal((await (await request('/answers')).json()).data.length, 0);
  assert.equal((await request(`/messages/${id}`, { method: 'PATCH', cookie, data: { published: true } })).status, 200);
  assert.ok((await (await request('/answers')).json()).data.some(m => m.id === id));
  await request(`/messages/${id}`, { method: 'PATCH', cookie, data: { status: 'archived', published: false } });
  assert.equal((await (await request('/answers')).json()).data.length, 0);
});
test('CSRF, wrong key, secure cookie attributes, logout', async () => {
  assert.equal((await request('/auth/login', { method: 'POST', origin: 'https://evil.test', data: { secret } })).status, 403);
  assert.equal((await request('/auth/login', { method: 'POST', data: { secret: 'incorrect' } })).status, 401);
  const res = await request('/auth/login', { method: 'POST', data: { secret } });
  const setCookie = res.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/); assert.match(setCookie, /Secure/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await request('/profile', { method: 'PATCH', cookie, origin: 'https://evil.test', data: { name: 'hacked', bio: '', accepting: false } })).status, 403);
  assert.equal((await request('/auth/logout', { method: 'POST', cookie, origin: null })).status, 403);
  assert.equal((await request('/auth/logout', { method: 'POST', cookie })).status, 200);
  assert.equal((await request('/auth/session', { cookie })).status, 401);
});
test('API scopes and revocation enforce access and hide hashes', async () => {
  const cookie = await login(); const id = await submit();
  const read = await (await request('/tokens', { method: 'POST', cookie, data: { name: 'Reader', scope: 'read' } })).json();
  assert.equal((await request('/messages', { token: read.token })).status, 200);
  assert.equal((await request(`/messages/${id}`, { method: 'DELETE', token: read.token })).status, 403);
  assert.equal((await request('/export', { token: read.token })).status, 403);
  assert.equal((await request('/tokens', { token: read.token })).status, 403);
  const listed = await (await request('/tokens', { cookie })).json(); assert.ok(listed.data.every(t => !t.hash && !t.token));
  const write = await (await request('/tokens', { method: 'POST', cookie, data: { name: 'Writer', scope: 'write' } })).json();
  assert.equal((await request(`/messages/${id}`, { method: 'PATCH', token: write.token, data: { answer: 'Bot回答', published: false } })).status, 200);
  await request(`/tokens/${read.id}`, { method: 'DELETE', cookie });
  assert.equal((await request('/messages', { token: read.token })).status, 401);
});
test('validation, SQL-safe search, paused submissions, atomic rate limit', async () => {
  const cookie = await login();
  for (const data of [{ body: '' }, { body: 'x'.repeat(2001) }, { body: 'hello', kind: 'invalid' }, { body: 'hello', website: 'spam' }]) assert.equal((await request('/messages', { method: 'POST', data })).status, 400);
  assert.equal((await request('/messages?limit=-1', { cookie })).status, 400);
  const id = await submit('100% real_question');
  const result = await (await request('/messages?q=' + encodeURIComponent('% real_'), { cookie })).json(); assert.ok(result.data.some(m => m.id === id));
  assert.equal((await request('/messages?q=' + encodeURIComponent("' OR 1=1 --"), { cookie })).status, 200);
  await request('/profile', { method: 'PATCH', cookie, data: { name: 'テスト', bio: '', accepting: false } });
  assert.equal((await request('/messages', { method: 'POST', data: { body: 'hi' } })).status, 403);
  await request('/profile', { method: 'PATCH', cookie, data: { name: 'テスト', bio: '', accepting: true } });
  const responses = await Promise.all(Array.from({ length: 7 }, () => request('/messages', { method: 'POST', data: { body: 'rate' }, address: '198.51.100.10' })));
  assert.equal(responses.filter(r => r.status === 201).length, 5); assert.equal(responses.filter(r => r.status === 429).length, 2);
  const limits = await db.prepare('SELECT key FROM rate_limits').all(); assert.ok(limits.results.every(r => /^[a-f0-9]{64}$/.test(r.key)));
});
test('export/import preserves IDs, invalid batch rolls back, delete purges webhook copies', async () => {
  const cookie = await login(); const id = await submit();
  const exported = await (await request('/export', { cookie })).json();
  assert.equal(exported.version, 1); assert.ok(exported.messages.some(m => m.id === id));
  assert.equal((await request('/import', { method: 'POST', cookie, data: exported })).status, 200);
  const source = exported.messages.find(m => m.id === id);
  const newId = crypto.randomUUID();
  const imported = await request('/import', { method: 'POST', cookie, data: { version: 1, messages: [{ ...source, id: newId }] } });
  assert.equal((await imported.json()).imported, 1);
  const invalidId = crypto.randomUUID();
  assert.equal((await request('/import', { method: 'POST', cookie, data: { version: 1, messages: [{ ...source, id: invalidId }, { ...source, id: crypto.randomUUID(), published: 1, answer: null }] } })).status, 400);
  assert.equal(await db.prepare('SELECT id FROM messages WHERE id=?').bind(invalidId).first(), null);
  await db.prepare('INSERT INTO webhook_events (id,payload,next_attempt_at,created_at) VALUES (?,?,0,0)').bind(crypto.randomUUID(), JSON.stringify({ data: source })).run();
  assert.equal((await request(`/messages/${id}`, { method: 'DELETE', cookie })).status, 200);
  assert.equal(await db.prepare('SELECT id FROM messages WHERE id=?').bind(id).first(), null);
  assert.equal(await db.prepare("SELECT id FROM webhook_events WHERE json_extract(payload,'$.data.id')=?").bind(id).first(), null);
});
test('security headers and unknown API routes', async () => {
  const res = await request('/health'); assert.equal(res.status, 200); assert.equal(res.headers.get('x-content-type-options'), 'nosniff'); assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await request('/missing')).status, 404);
});
test('HTML routes serve without canonical redirect loops; iframe policy isolated', async () => {
  for (const path of ['/', '/admin', '/embed', '/privacy']) {
    const res = await mf.dispatchFetch(`https://oqb.test${path}`, { redirect: 'manual' });
    assert.equal(res.status, 200, path);
    assert.match(await res.text(), /Open Question Box/);
    assert.match(res.headers.get('content-security-policy'), path === '/embed' ? /frame-ancestors \*/ : /frame-ancestors 'none'/);
  }
  assert.equal((await mf.dispatchFetch('https://oqb.test/style.css')).status, 200);
  assert.equal((await mf.dispatchFetch('https://oqb.test/not-found')).status, 404);
});
test('webhook outbox retries and authenticates raw payload; claims prevent parallel duplication', async () => {
  const { deliverWebhooks } = await import('../dist/worker.js');
  const id = crypto.randomUUID();
  const payload = JSON.stringify({ id, type: 'message.created', data: { body: 'private question' } });
  const now = Math.floor(Date.now() / 1000);
  await db.prepare('INSERT INTO webhook_events (id,payload,next_attempt_at,created_at) VALUES (?,?,?,?)').bind(id, payload, now - 1, now).run();
  const original = globalThis.fetch;
  const calls = [];
  let succeed = false;
  globalThis.fetch = async (url, options) => {
    calls.push(options);
    assert.equal(url.href, 'https://webhook.example/events');
    assert.equal(options.redirect, 'error');
    const h = options.headers;
    assert.equal(h['X-OQB-Event'], id);
    assert.equal(h['X-OQB-Signature'], 'sha256=' + createHmac('sha256', 'webhook-test-secret').update(h['X-OQB-Timestamp'] + '.' + options.body).digest('hex'));
    return new Response(null, { status: succeed ? 204 : 503 });
  };
  try {
    const env = { DB: db, WEBHOOK_URL: 'https://webhook.example/events', WEBHOOK_SECRET: 'webhook-test-secret' };
    await Promise.all([deliverWebhooks(env), deliverWebhooks(env)]);
    assert.equal(calls.length, 1);
    let row = await db.prepare('SELECT * FROM webhook_events WHERE id=?').bind(id).first();
    assert.equal(row.attempts, 1); assert.equal(row.delivered_at, null); assert.ok(row.next_attempt_at > now);
    succeed = true;
    await db.prepare('UPDATE webhook_events SET next_attempt_at=? WHERE id=?').bind(now - 1, id).run();
    await deliverWebhooks(env);
    row = await db.prepare('SELECT * FROM webhook_events WHERE id=?').bind(id).first();
    assert.equal(row.attempts, 2); assert.ok(row.delivered_at);
    await deliverWebhooks(env); assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});

