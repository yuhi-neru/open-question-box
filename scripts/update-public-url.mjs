import { readFile, writeFile } from 'node:fs/promises';
const old = 'https://open-question-box.vrc-ranking-board.workers.dev';
const next = 'https://open-question-box.pages.dev';
for (const path of ['README.md', 'scripts/configure-secrets.mjs', 'scripts/github.mjs', 'scripts/live-check.mjs', 'scripts/prepare-homepage.mjs', '.production-admin.txt']) {
  const content = await readFile(path, 'utf8');
  await writeFile(path, content.replaceAll(old, next));
}
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
packageJson.scripts['deploy:pages'] = 'wrangler pages deploy --cwd hosting --project-name=open-question-box --branch=main';
await writeFile('package.json', JSON.stringify(packageJson, null, 2) + '\n');
console.log('Public links updated; secret values were preserved and not printed.');
