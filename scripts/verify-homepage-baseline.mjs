import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
// Rebuild the already-live homepage with our new card omitted. Publish only if
// its four files match the live site's current contents exactly.
const original = 'C:/Code/yuhineru-hp';
const root = resolve('.wrangler/homepage-release');
await mkdir(root + '/src', { recursive: true }); await mkdir(root + '/scripts', { recursive: true });
for (const file of ['src/index.html', 'src/style.css', 'src/app.js', 'src/favicon.svg', 'scripts/build.mjs', 'scripts/check.mjs']) await copyFile(original + '/' + file, root + '/' + file);
const projects = JSON.parse(await readFile(original + '/src/projects.json', 'utf8'));
await writeFile(root + '/src/projects.json', JSON.stringify(projects.filter(p => p.id !== 'open-question-box'), null, 2));
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
const checks = [];
for (const name of ['index.html', 'style.css', 'app.js', 'favicon.svg']) {
  const response = await fetch('https://yuhineru.pages.dev/' + (name === 'index.html' ? '' : name));
  if (!response.ok) throw new Error('Live homepage fetch failed');
  const live = await response.text();
  const baseline = await readFile(root + '/dist/' + name, 'utf8');
  checks.push({ file: name, identical: live.replaceAll('\r\n', '\n') === baseline.replaceAll('\r\n', '\n') });
}
console.log(JSON.stringify(checks));
if (checks.some(c => !c.identical)) throw new Error('Unrelated local content differs from live homepage; stop publication');
await writeFile(root + '/src/projects.json', JSON.stringify(projects, null, 2));
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['scripts/check.mjs'], { cwd: root, stdio: 'inherit' });
console.log('Clean release prepared from verified live baseline plus Open Question Box only: ' + root);
