import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || 'homepage-update');
if (![resolve('homepage-update'), 'C:\\Code\\yuhineru-hp'].includes(root)) throw new Error('Unexpected target');
const file = resolve(root, 'src/projects.json');
const projects = JSON.parse(await readFile(file, 'utf8'));
const project = {
  id: 'open-question-box', name: 'Open Question Box', subtitle: '開かれた匿名質問箱', category: 'ツール',
  description: '質問も、感想も、ちょっとしたひとことも。登録なしで気軽に送れて、APIでAIやアプリにもつなげられる質問箱。',
  detail: '誰でも送れる。AIにも届く。誰でも運営できる。ゆうひねるへの匿名メッセージを送れる、MITライセンスのオープンソース質問箱です。受信者が選んだ質問と回答だけを公開。API・署名付きWebhook・サイトへの埋め込み・データの移行に対応し、自分のCloudflareでも運営できます。公開サービスはゆうひねるの質問箱で、他の人はセルフホストで利用できます。JPYC投げ銭とAPI課金は準備中です。',
  features: ['匿名・登録不要の質問とフィードバック', 'API・Webhook・埋め込みフォーム', 'MITライセンス・セルフホスト・データ移行'],
  url: 'https://open-question-box.pages.dev/', repo: 'https://github.com/yuhi-neru/open-question-box', status: '公開中', art: 'question', tags: ['Open source', 'API', 'Web app']
};
const at = projects.findIndex(p => p.id === project.id);
if (at < 0) projects.push(project); else projects[at] = project;
await writeFile(file, JSON.stringify(projects, null, 2) + '\n');
const buildFile = resolve(root, 'scripts/build.mjs');
let build = await readFile(buildFile, 'utf8');
if (!build.includes(' question:')) build = build.replace('const art={', `const art={\n question: '<svg viewBox="0 0 320 210" aria-hidden="true"><circle cx="160" cy="103" r="83" fill="#e5eee1"/><rect x="112" y="32" width="102" height="123" rx="7" fill="#fffdf7" stroke="#78957d" stroke-width="2" transform="rotate(8 163 94)"/><text x="156" y="92" fill="#486f54" font-size="40" font-family="sans-serif">?</text><path d="M136 108h52m-49 12h40" stroke="#c0d1bf" stroke-width="3"/><rect x="73" y="97" width="174" height="95" rx="7" fill="#edce98" stroke="#b69461" stroke-width="2"/><path d="m73 97 87 64 87-64m-174 95 66-55m108 55-65-55" fill="none" stroke="#b69461" stroke-width="2"/><path d="M63 50v18m-9-9h18m178-7v16m-8-8h16" stroke="#b69a68" stroke-width="2"/></svg>',`);
await writeFile(buildFile, build);
console.log('Added Open Question Box to tools in ' + root);
