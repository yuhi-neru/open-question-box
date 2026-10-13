import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const origin = process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'https://open-question-box.pages.dev';
if (!['https://open-question-box.pages.dev', 'http://127.0.0.1:8788'].includes(origin)) throw new Error('Unexpected origin');
const vars = Object.fromEntries((await readFile('.dev.vars', 'utf8')).trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
const login = await fetch(origin + '/api/v1/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: vars.ADMIN_SECRET }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
if (process.argv.includes('--profile')) {
  const update = await fetch(origin + '/api/v1/profile', { method: 'PATCH', headers, body: JSON.stringify({ name: 'ゆうひねるの質問箱', bio: '質問でも、感想でも、ツールへの要望やバグ報告でも。\n気軽にひとこと、送ってください。あなたのペースでどうぞ。', accepting: true }) });
  assert.equal(update.status, 200);
}
for (const path of ['/', '/admin', '/embed', '/privacy', '/openapi.json', '/api/v1/health', '/api/v1/profile', '/api/v1/answers']) assert.equal((await fetch(origin + path, { redirect: 'manual' })).status, 200, path);
assert.equal((await fetch(origin + '/api/v1/messages')).status, 401);
const list = await fetch(origin + '/api/v1/messages', { headers }); assert.equal(list.status, 200);
if (process.argv.includes('--cleanup-test')) {
  const marker = '公開前の動作確認（この投稿は確認後に削除します）';
  const found = (await list.json()).data.filter(m => m.body === marker);
  for (const m of found) {
    const answer = await fetch(origin + '/api/v1/messages/' + m.id, { method: 'PATCH', headers, body: JSON.stringify({ answer: '本番の匿名送信と非公開回答を確認しました。', published: false }) });
    assert.equal(answer.status, 200);
    const published = await (await fetch(origin + '/api/v1/answers')).json();
    assert.ok(!published.data.some(a => a.id === m.id));
    assert.equal((await fetch(origin + '/api/v1/messages/' + m.id, { method: 'DELETE', headers })).status, 200);
  }
  console.log('Verified and removed ' + found.length + ' explicitly marked release-test messages.');
}
const key = await fetch(origin + '/api/v1/tokens', { method: 'POST', headers, body: JSON.stringify({ name: 'Temporary release validation', scope: 'read' }) }); assert.equal(key.status, 201);
const issued = await key.json();
try {
  assert.equal((await fetch(origin + '/api/v1/messages', { headers: { Authorization: 'Bearer ' + issued.token } })).status, 200);
  assert.equal((await fetch(origin + '/api/v1/profile', { method: 'PATCH', headers: { Authorization: 'Bearer ' + issued.token, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
} finally { assert.equal((await fetch(origin + '/api/v1/tokens/' + issued.id, { method: 'DELETE', headers })).status, 200); }
assert.equal((await fetch(origin + '/api/v1/messages', { headers: { Authorization: 'Bearer ' + issued.token } })).status, 401);
if (origin.startsWith('https:')) {
  const invalid = await fetch(origin + '/api/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'release validation - rejected token', turnstile_token: 'invalid-token' }) });
  assert.equal(invalid.status, 400);
}
assert.equal((await fetch(origin + '/api/v1/auth/logout', { method: 'POST', headers })).status, 200);
console.log('Live routes, owner authentication, API scopes/revocation, and Turnstile rejection verified. No test API key retained.');
