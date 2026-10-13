import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const next = 'https://open-question-box.pages.dev/';
const original = 'C:/Code/yuhineru-hp/src/projects.json';
const clone = 'homepage-update/src/projects.json';
for (const path of [original, clone]) {
  const projects = JSON.parse(await readFile(path, 'utf8'));
  const item = projects.find(p => p.id === 'open-question-box');
  if (!item) throw new Error('Tool entry missing');
  item.url = next;
  await writeFile(path, JSON.stringify(projects, null, 2) + '\n');
}
// Publish a snapshot of the current live site with this one URL replaced.
// This cannot include unrelated uncommitted source changes.
const root = '.wrangler/homepage-url-release';
await mkdir(root + '/pages', { recursive: true });
const files = {};
let replaced = 0;
for (const [name, type] of Object.entries({ 'index.html': 'text/html; charset=utf-8', 'style.css': 'text/css; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'favicon.svg': 'image/svg+xml' })) {
  const response = await fetch('https://yuhineru.pages.dev/' + (name === 'index.html' ? '' : name));
  if (!response.ok) throw new Error('Cannot read current live homepage');
  let body = await response.text();
  if (name === 'index.html') {
    const old = 'https://open-question-box.vrc-ranking-board.workers.dev/';
    replaced = body.split(old).length - 1;
    if (replaced !== 2) throw new Error('Unexpected homepage link count: ' + replaced);
    body = body.replaceAll(old, next);
  }
  files['/' + name] = { type, body };
}
const module = `const files=${JSON.stringify(files)};\nexport default {async fetch(request){const path=new URL(request.url).pathname;const file=files[path==='/'?'/index.html':path];const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Content-Security-Policy':\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'\"};if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...headers,Allow:'GET, HEAD'}});if(!file)return new Response('ページが見つかりません。',{status:404,headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});return new Response(request.method==='HEAD'?null:file.body,{headers:{...headers,'Content-Type':file.type,'Cache-Control':'public, max-age=300'}});}};`;
await writeFile(root + '/pages/_worker.js', module);
await writeFile(root + '/wrangler.jsonc', JSON.stringify({ name: 'yuhineru', pages_build_output_dir: 'pages', compatibility_date: '2026-10-13' }, null, 2));
console.log('Prepared current public homepage with only its two question-box links updated.');
