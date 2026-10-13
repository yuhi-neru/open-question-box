import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
// Read an ignored secret file; no secret values appear in arguments or logs.
const { turnstileSecret } = JSON.parse(await readFile('.production-secrets.json', 'utf8'));
if (!turnstileSecret) throw new Error('Missing Turnstile secret');
const vars = Object.fromEntries((await readFile('.dev.vars', 'utf8')).trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
const secrets = { ADMIN_SECRET: vars.ADMIN_SECRET, RATE_LIMIT_SECRET: vars.RATE_LIMIT_SECRET, TURNSTILE_SECRET_KEY: turnstileSecret };
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'secret', 'bulk'], { input: JSON.stringify(secrets), stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
// Wrangler only prints binding names, but keep its output private defensively.
if (result.status !== 0) throw new Error(`Secret configuration failed (${result.status}); check Cloudflare permissions.`);
await writeFile('.production-admin.txt', `Open Question Box\n管理画面: https://open-question-box.pages.dev/admin\n管理キー: ${vars.ADMIN_SECRET}\n\nこのファイルは秘密情報です。GitHubや公開ページに貼らないでください。\n`);
console.log('Production secrets configured; owner key saved in ignored .production-admin.txt');
