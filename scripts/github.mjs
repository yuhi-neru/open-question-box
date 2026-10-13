// Use Git Credential Manager without writing or printing its credential.
// This helper manages only the repository explicitly named below.
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const credential = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
const fields = Object.fromEntries(credential.trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
if (!fields.password) throw new Error('GitHub authentication is unavailable');
const headers = { Authorization: `Bearer ${fields.password}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
const who = await fetch('https://api.github.com/user', { headers });
if (!who.ok) throw new Error(`GitHub authentication failed (${who.status})`);
const user = await who.json();
if (user.login !== 'yuhi-neru') throw new Error('Authenticated GitHub account is not yuhi-neru');
if (args[0] === 'inspect') { console.log(JSON.stringify({ login: user.login })); process.exit(0); }
if (args[0] === 'update-homepage') {
  const res = await fetch('https://api.github.com/repos/yuhi-neru/open-question-box', { method: 'PATCH', headers, body: JSON.stringify({ homepage: 'https://open-question-box.pages.dev/' }) });
  if (!res.ok) throw new Error(`Repository update failed (${res.status})`);
  console.log(JSON.stringify({ homepage: (await res.json()).homepage })); process.exit(0);
}
if (args[0] !== 'create') throw new Error('Use inspect or create');
const existing = await fetch('https://api.github.com/repos/yuhi-neru/open-question-box', { headers });
if (existing.ok) { const repo = await existing.json(); console.log(JSON.stringify({ url: repo.html_url, existing: true, private: repo.private })); process.exit(0); }
if (existing.status !== 404) throw new Error(`Repository check failed (${existing.status})`);
const res = await fetch('https://api.github.com/user/repos', { method: 'POST', headers, body: JSON.stringify({ name: 'open-question-box', description: '誰でも送れる。AIにも届く。誰でも運営できる。API対応のオープンソース匿名質問箱。', private: false, auto_init: false, homepage: 'https://open-question-box.pages.dev/' }) });
if (!res.ok) throw new Error(`Repository creation failed (${res.status})`);
const repo = await res.json(); console.log(JSON.stringify({ url: repo.html_url, private: repo.private }));
