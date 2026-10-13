type RuntimeEnv = Env & {
  ADMIN_SECRET?: string;
  RATE_LIMIT_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  WEBHOOK_SECRET?: string;
};
type Message = { id: string; body: string; kind: string; status: string; answer: string | null; published: number; created_at: string; updated_at: string };
const kinds = ['question', 'feedback', 'idea', 'bug'];
const statuses = ['unanswered', 'answered', 'archived'];
const encoder = new TextEncoder();
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
function textField(value: unknown, max: number, label: string, required = true): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new HttpError(400, `${label}を${max}文字以内で入力してください。`);
  return value.trim();
}
function booleanField(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, '真偽値を指定してください。');
  return value;
}
async function body(request: Request, max = 16384): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'application/jsonで送信してください。');
  if (!request.body) throw new HttpError(400, 'データがありません。');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > max) { await reader.cancel(); throw new HttpError(413, '送信データが大きすぎます。'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw new HttpError(400, 'JSONの形式を確認してください。'); }
}
async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}
async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}
async function equalSecret(a: string, b: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(b), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(b));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(a));
}
function randomToken() { return crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''); }
function sameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new HttpError(403, 'このサイトから操作してください。');
}
function assertConfigured(env: RuntimeEnv) {
  if (!env.ADMIN_SECRET || env.ADMIN_SECRET.length < 32 || !env.RATE_LIMIT_SECRET || env.RATE_LIMIT_SECRET.length < 32) throw new HttpError(503, '管理者の初期設定がまだ完了していません。');
}
async function rateLimit(request: Request, env: RuntimeEnv, bucket: string, limit: number, seconds: number) {
  assertConfigured(env);
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / seconds);
  // A rotating keyed digest is stored, never the raw network address.
  const key = await sign(env.RATE_LIMIT_SECRET!, `${bucket}:${window}:${request.headers.get('CF-Connecting-IP') || 'local'}`);
  const result = await env.DB.prepare('INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key, (window + 1) * seconds).first<{ count: number }>();
  if (!result || result.count > limit) throw new HttpError(429, '少し時間をおいてから、もう一度お試しください。');
}
async function authorize(request: Request, env: RuntimeEnv, write = false, ownerOnly = false) {
  const bearer = request.headers.get('authorization');
  if (bearer) {
    if (ownerOnly || !bearer.startsWith('Bearer ')) throw new HttpError(403, '管理画面へのログインが必要です。');
    const token = await env.DB.prepare('SELECT scope FROM api_tokens WHERE hash = ?').bind(await digest(bearer.slice(7))).first<{ scope: string }>();
    if (!token) throw new HttpError(401, 'APIキーが無効です。');
    if (write && token.scope !== 'write') throw new HttpError(403, '書き込み権限がありません。');
    return;
  }
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)oqb_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!cookie) throw new HttpError(401, 'ログインしてください。');
  const session = await env.DB.prepare('SELECT hash FROM sessions WHERE hash = ? AND expires_at > ?').bind(await digest(cookie), Math.floor(Date.now() / 1000)).first();
  if (!session) throw new HttpError(401, 'ログインの有効期限が切れました。');
  if (write) sameOrigin(request);
}
function sessionCookie(request: Request, token: string, age: number) {
  return `oqb_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function pagination(url: URL, max = 50) {
  const limit = Number(url.searchParams.get('limit') || max);
  const offset = Number(url.searchParams.get('offset') || 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > max || !Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new HttpError(400, 'ページ指定が無効です。');
  return { limit, offset };
}
function eventStatement(env: RuntimeEnv, type: string, message: Message) {
  if (!env.WEBHOOK_URL || !env.WEBHOOK_SECRET) return null;
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ id, type, created_at: new Date().toISOString(), data: message });
  return env.DB.prepare('INSERT INTO webhook_events (id, payload, next_attempt_at, created_at) VALUES (?, ?, ?, ?)').bind(id, payload, now, now);
}
async function saveWithEvent(env: RuntimeEnv, statement: D1PreparedStatement, type: string, message: Message) {
  const event = eventStatement(env, type, message);
  await env.DB.batch(event ? [statement, event] : [statement]);
}
async function route(request: Request, env: RuntimeEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (path === '/api/v1/health' && method === 'GET') return json({ status: 'ok', version: '0.1.0' });
  if (path === '/api/v1/profile' && method === 'GET') {
    const profile = await env.DB.prepare('SELECT name, bio, accepting FROM profile WHERE id = 1').first();
    return json({ ...profile, turnstile_site_key: env.TURNSTILE_SITE_KEY || null, payments_enabled: false });
  }
  if (path === '/api/v1/profile' && method === 'PATCH') {
    await authorize(request, env, true, true);
    const data = await body(request);
    const name = textField(data.name, 60, '名前');
    const bio = textField(data.bio, 500, '紹介文', false);
    const accepting = booleanField(data.accepting);
    await env.DB.prepare('UPDATE profile SET name=?, bio=?, accepting=? WHERE id=1').bind(name, bio, Number(accepting)).run();
    return json({ name, bio, accepting });
  }
  if (path === '/api/v1/messages' && method === 'POST') {
    await rateLimit(request, env, 'submit', 5, 600);
    const data = await body(request);
    if (data.website) throw new HttpError(400, '送信できませんでした。');
    const messageBody = textField(data.body, 2000, 'メッセージ');
    const kind = data.kind ?? 'question';
    if (typeof kind !== 'string' || !kinds.includes(kind)) throw new HttpError(400, 'メッセージの種類が無効です。');
    if (env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY) {
      const token = textField(data.turnstile_token, 2048, '確認トークン');
      let verification: { success: boolean; hostname?: string; action?: string };
      try {
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }), signal: AbortSignal.timeout(8000) });
        verification = await response.json();
      } catch { throw new HttpError(503, '送信確認に接続できません。時間をおいてお試しください。'); }
      if (!verification.success || verification.hostname !== url.hostname || verification.action !== 'submit') throw new HttpError(400, '送信確認をやり直してください。');
    } else if (env.ALLOW_UNPROTECTED_SUBMISSIONS !== 'true') throw new HttpError(503, '送信確認の設定がまだ完了していません。');
    const profile = await env.DB.prepare('SELECT accepting FROM profile WHERE id=1').first<{ accepting: number }>();
    if (!profile?.accepting) throw new HttpError(403, '今はメッセージの受付をお休みしています。');
    const now = new Date().toISOString();
    const message: Message = { id: crypto.randomUUID(), body: messageBody, kind, status: 'unanswered', answer: null, published: 0, created_at: now, updated_at: now };
    await saveWithEvent(env, env.DB.prepare('INSERT INTO messages (id, body, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(message.id, message.body, message.kind, now, now), 'message.created', message);
    ctx.waitUntil(deliverWebhooks(env));
    return json({ id: message.id, message: 'メッセージを届けました。' }, 201);
  }
  if (path === '/api/v1/answers' && method === 'GET') {
    const { limit, offset } = pagination(url);
    const result = await env.DB.prepare("SELECT id, body, kind, answer, created_at, updated_at FROM messages WHERE published=1 AND status='answered' ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?").bind(limit + 1, offset).all();
    return json({ data: result.results.slice(0, limit), has_more: result.results.length > limit });
  }
  if (path === '/api/v1/auth/login' && method === 'POST') {
    sameOrigin(request);
    await rateLimit(request, env, 'login', 10, 900);
    const data = await body(request);
    const secret = textField(data.secret, 256, '管理キー');
    if (!await equalSecret(secret, env.ADMIN_SECRET!)) throw new HttpError(401, '管理キーを確認してください。');
    const token = randomToken();
    const age = 60 * 60 * 12;
    await env.DB.prepare('INSERT INTO sessions (hash, expires_at) VALUES (?, ?)').bind(await digest(token), Math.floor(Date.now() / 1000) + age).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, token, age) });
  }
  if (path === '/api/v1/auth/session' && method === 'GET') {
    await authorize(request, env, false, true);
    return json({ authenticated: true });
  }
  if (path === '/api/v1/auth/logout' && method === 'POST') {
    await authorize(request, env, true, true);
    const token = request.headers.get('cookie')?.match(/oqb_session=([a-f0-9]{64})/)?.[1];
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await digest(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
  }
  if (path === '/api/v1/messages' && method === 'GET') {
    await authorize(request, env);
    const { limit, offset } = pagination(url);
    const status = url.searchParams.get('status') || 'unanswered';
    if (!statuses.includes(status)) throw new HttpError(400, '状態が無効です。');
    const search = (url.searchParams.get('q') || '').slice(0, 100).replace(/[!%_]/g, '!$&');
    const result = await env.DB.prepare("SELECT * FROM messages WHERE status=? AND body LIKE ? ESCAPE '!' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").bind(status, `%${search}%`, limit + 1, offset).all();
    const counts = await env.DB.prepare('SELECT status, count(*) AS count FROM messages GROUP BY status').all();
    return json({ data: result.results.slice(0, limit), has_more: result.results.length > limit, counts: Object.fromEntries(counts.results.map(row => [row.status, row.count])) });
  }
  const messageMatch = path.match(/^\/api\/v1\/messages\/([a-f0-9-]{36})$/);
  if (messageMatch && (method === 'PATCH' || method === 'DELETE')) {
    await authorize(request, env, true);
    const old = await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(messageMatch[1]).first<Message>();
    if (!old) throw new HttpError(404, 'メッセージが見つかりません。');
    if (method === 'DELETE') {
      // Purge queued copies of private content as well as the primary record.
      await env.DB.batch([env.DB.prepare('DELETE FROM messages WHERE id=?').bind(old.id), env.DB.prepare("DELETE FROM webhook_events WHERE json_extract(payload, '$.data.id')=?").bind(old.id)]);
      return json({ ok: true });
    }
    const data = await body(request);
    const answer = data.answer === undefined ? old.answer : textField(data.answer, 4000, '回答', false) || null;
    const status = data.status === undefined ? (data.answer === undefined ? old.status : answer ? 'answered' : 'unanswered') : data.status;
    if (typeof status !== 'string' || !statuses.includes(status)) throw new HttpError(400, '状態が無効です。');
    const published = data.published === undefined ? old.published : Number(booleanField(data.published));
    if ((published && (status !== 'answered' || !answer)) || (status === 'answered' && !answer)) throw new HttpError(400, '公開には回答が必要です。アーカイブ時は公開を解除してください。');
    const message = { ...old, answer, status, published, updated_at: new Date().toISOString() };
    await saveWithEvent(env, env.DB.prepare('UPDATE messages SET answer=?, status=?, published=?, updated_at=? WHERE id=?').bind(answer, status, published, message.updated_at, old.id), 'message.updated', message);
    ctx.waitUntil(deliverWebhooks(env));
    return json(message);
  }
  if (path === '/api/v1/tokens') {
    await authorize(request, env, method !== 'GET', true);
    if (method === 'GET') return json({ data: (await env.DB.prepare('SELECT id, name, scope, created_at FROM api_tokens ORDER BY created_at DESC').all()).results });
    if (method === 'POST') {
      const data = await body(request);
      const name = textField(data.name, 60, 'キーの名前');
      if (data.scope !== 'read' && data.scope !== 'write') throw new HttpError(400, '権限が無効です。');
      const count = await env.DB.prepare('SELECT count(*) AS count FROM api_tokens').first<{ count: number }>();
      if (count && count.count >= 20) throw new HttpError(400, 'APIキーは20個までです。');
      const token = `oqb_${randomToken()}`;
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO api_tokens (id, name, hash, scope, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, name, await digest(token), data.scope, new Date().toISOString()).run();
      return json({ id, token, name, scope: data.scope }, 201);
    }
  }
  const tokenMatch = path.match(/^\/api\/v1\/tokens\/([a-f0-9-]{36})$/);
  if (tokenMatch && method === 'DELETE') {
    await authorize(request, env, true, true);
    await env.DB.prepare('DELETE FROM api_tokens WHERE id=?').bind(tokenMatch[1]).run();
    return json({ ok: true });
  }
  if (path === '/api/v1/export' && method === 'GET') {
    await authorize(request, env, false, true);
    const { limit, offset } = pagination(url, 500);
    const result = await env.DB.prepare('SELECT * FROM messages ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?').bind(limit + 1, offset).all();
    const profile = await env.DB.prepare('SELECT name, bio, accepting FROM profile WHERE id=1').first();
    return json({ version: 1, profile, messages: result.results.slice(0, limit), has_more: result.results.length > limit });
  }
  if (path === '/api/v1/import' && method === 'POST') {
    await authorize(request, env, true, true);
    const data = await body(request, 4000000);
    if (data.version !== 1 || !Array.isArray(data.messages) || data.messages.length > 500) throw new HttpError(400, 'バージョン1のJSONで、500件ずつ取り込んでください。');
    const statements: D1PreparedStatement[] = [];
    if (data.profile && typeof data.profile === 'object') {
      const p = data.profile as Record<string, unknown>;
      const accepting = p.accepting === true || p.accepting === 1 ? 1 : p.accepting === false || p.accepting === 0 ? 0 : null;
      if (accepting === null) throw new HttpError(400, '受付設定が無効です。');
      statements.push(env.DB.prepare('UPDATE profile SET name=?, bio=?, accepting=? WHERE id=1').bind(textField(p.name, 60, '名前'), textField(p.bio, 500, '紹介文', false), accepting));
    }
    for (const value of data.messages) {
      if (!value || typeof value !== 'object') throw new HttpError(400, 'メッセージ形式が無効です。');
      const m = value as Record<string, unknown>;
      if (typeof m.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(m.id) || typeof m.kind !== 'string' || !kinds.includes(m.kind) || typeof m.status !== 'string' || !statuses.includes(m.status) || (m.published !== 0 && m.published !== 1)) throw new HttpError(400, 'メッセージ形式が無効です。');
      const answer = m.answer === null ? null : textField(m.answer, 4000, '回答', false) || null;
      if ((m.status === 'answered' && !answer) || (m.published && (m.status !== 'answered' || !answer))) throw new HttpError(400, '公開状態が無効です。');
      for (const field of ['created_at', 'updated_at']) if (typeof m[field] !== 'string' || !Number.isFinite(Date.parse(m[field] as string)) || new Date(m[field] as string).toISOString() !== m[field]) throw new HttpError(400, '日時形式が無効です。');
      statements.push(env.DB.prepare('INSERT INTO messages (id, body, kind, status, answer, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(m.id, textField(m.body, 2000, 'メッセージ'), m.kind, m.status, answer, Number(m.published), m.created_at, m.updated_at));
    }
    const results = statements.length ? await env.DB.batch(statements) : [];
    return json({ imported: results.slice(data.profile ? 1 : 0).reduce((sum, r) => sum + r.meta.changes, 0) });
  }
  if (path === '/api/v1/webhooks/status' && method === 'GET') {
    await authorize(request, env, false, true);
    const stats = await env.DB.prepare('SELECT sum(CASE WHEN delivered_at IS NULL AND attempts < 8 THEN 1 ELSE 0 END) AS pending, sum(CASE WHEN delivered_at IS NULL AND attempts >= 8 THEN 1 ELSE 0 END) AS failed FROM webhook_events').first();
    return json({ configured: Boolean(env.WEBHOOK_URL && env.WEBHOOK_SECRET), ...stats });
  }
  if (path.startsWith('/api/')) throw new HttpError(404, 'APIが見つかりません。');
  if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'この操作は利用できません。');
  if (['/', '/admin', '/embed', '/privacy'].includes(path)) return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
  return env.ASSETS.fetch(request);
}
export async function deliverWebhooks(env: RuntimeEnv) {
  if (!env.WEBHOOK_URL || !env.WEBHOOK_SECRET) return;
  const target = new URL(env.WEBHOOK_URL);
  if (target.protocol !== 'https:' || target.username || target.password || target.hostname === 'localhost') return;
  const now = Math.floor(Date.now() / 1000);
  const rows = await env.DB.prepare('SELECT id, payload, attempts FROM webhook_events WHERE delivered_at IS NULL AND attempts < 8 AND next_attempt_at <= ? AND claim_until < ? ORDER BY created_at LIMIT 10').bind(now, now).all<{ id: string; payload: string; attempts: number }>();
  for (const row of rows.results) {
    const claim = await env.DB.prepare('UPDATE webhook_events SET claim_until=? WHERE id=? AND delivered_at IS NULL AND claim_until < ?').bind(now + 120, row.id, now).run();
    if (!claim.meta.changes) continue;
    let delivered = false;
    try {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OQB-Event': row.id, 'X-OQB-Timestamp': timestamp, 'X-OQB-Signature': `sha256=${await sign(env.WEBHOOK_SECRET, `${timestamp}.${row.payload}`)}` }, body: row.payload, redirect: 'error', signal: AbortSignal.timeout(8000) });
      delivered = response.ok;
      await response.body?.cancel();
    } catch { /* retry through the durable outbox */ }
    await env.DB.prepare('UPDATE webhook_events SET attempts=attempts+1, delivered_at=?, next_attempt_at=?, claim_until=0 WHERE id=?').bind(delivered ? now : null, now + Math.min(86400, 60 * 2 ** row.attempts), row.id).run();
  }
}
export default {
  async fetch(request: Request, env: RuntimeEnv, ctx: ExecutionContext) {
    let response: Response;
    try { response = await route(request, env, ctx); }
    catch (error) {
      if (error instanceof HttpError) response = json({ error: error.message }, error.status, error.status === 429 ? { 'Retry-After': '900' } : {});
      else {
        console.error(JSON.stringify({ event: 'request_failed', request_id: crypto.randomUUID() }));
        response = json({ error: '処理できませんでした。時間をおいてお試しください。' }, 500);
      }
    }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    headers.set('Content-Security-Policy', `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors ${new URL(request.url).pathname === '/embed' ? '*' : "'none'"}; base-uri 'none'; form-action 'self'`);
    if (new URL(request.url).pathname !== '/embed') headers.set('X-Frame-Options', 'DENY');
    if (new URL(request.url).protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event: ScheduledController, env: RuntimeEnv, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      await deliverWebhooks(env);
      const now = Math.floor(Date.now() / 1000);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now),
        env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
        env.DB.prepare('DELETE FROM webhook_events WHERE created_at < ?').bind(now - 7 * 86400)
      ]);
    })());
  }
} satisfies ExportedHandler<RuntimeEnv>;
