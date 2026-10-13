const app = document.querySelector('#app');
const state = { profile: null, authenticated: false, view: 'inbox', status: 'unanswered', kind: 'question', messages: [], counts: {}, offset: 0, query: '', hasMore: false, answers: [], answerOffset: 0, answerMore: false, reply: null, tokens: [], webhook: {}, sent: false, turnstileToken: '', widget: null, newToken: null };
const kindNames = { question: '質問', feedback: '感想', idea: '要望・アイデア', bug: 'バグ報告' };
const kindSymbols = { question: '?', feedback: '♡', idea: '✧', bug: '⚑' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = value => new Intl.DateTimeFormat('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const brand = () => `<a class="brand" href="/"><img src="/icon.svg" alt=""><span>Open Question Box<small>ひとことから、つながろう。</small></span></a>`;
const badge = kind => `<span class="badge ${escape(kind)}">${kindSymbols[kind] || '?'} &nbsp;${escape(kindNames[kind])}</span>`;
let toastTimer;
let turnstileLoad;
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4000); }
async function api(path, options = {}) {
  const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await res.json();
  if (!res.ok) { const error = new Error(data.error || '処理できませんでした。'); error.status = res.status; throw error; }
  return data;
}
function footer() { return `<footer class="footer"><span>Open Question Box · 誰でも送れる。AIにも届く。誰でも運営できる。</span><div class="footer-links"><a href="/privacy">プライバシー</a><a href="https://github.com/yuhi-neru/open-question-box" target="_blank" rel="noopener noreferrer">ソースコード ↗</a></div></footer>`; }
function header() { return `<header class="header">${brand()}<nav class="header-nav"><a class="optional" href="/#answers">公開された回答</a><a class="btn small-btn" href="/admin">受信箱を開く ↗</a></nav></header>`; }
function compose() {
  const p = state.profile;
  return `<section class="compose" aria-label="メッセージを送る"><div class="compose-head"><div class="avatar" aria-hidden="true">${escape(p.name.slice(0, 1))}</div><div><h2>${escape(p.name)}</h2><p>あなたのひとこと、お待ちしています。</p></div></div>${state.sent ? `<div class="success"><div class="success-symbol">✓</div><h2>ひとこと、届けました。</h2><p class="small">送ってくれてありがとうございます。<br>回答が公開されたら、この質問箱で読めます。</p><button class="btn soft" data-action="another">もうひとこと送る</button></div>` : `<form id="compose-form" class="compose-body"><p class="bio">${escape(p.bio)}</p>${p.accepting ? `<div class="kind-group" role="group" aria-label="メッセージの種類">${Object.entries(kindNames).map(([key, value]) => `<button type="button" class="kind ${state.kind === key ? 'active' : ''}" data-action="kind" data-kind="${key}" aria-pressed="${state.kind === key}">${kindSymbols[key]} &nbsp; ${value}</button>`).join('')}</div><label for="message" class="small">届けたいひとこと</label><textarea id="message" name="body" maxlength="2000" placeholder="ずっと気になっていたこと、伝えたいこと。&#10;あなたの言葉で、気軽にどうぞ。" required></textarea><div class="counter"><span id="char-count">0</span> / 2,000</div><div class="honey" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><div id="turnstile-widget"></div><div class="form-error" role="alert"></div><button class="btn primary" type="submit">ひとことを届ける &nbsp; ↗</button><p class="privacy-note">♧ &nbsp; 匿名・登録不要。質問や回答は受信者が選んだ場合に公開されます。</p>` : `<div class="notice">今はメッセージの受付をお休みしています。</div>`}</form>`}</section>`;
}
function publicPage() {
  const embed = location.pathname === '/embed';
  if (embed) { app.innerHTML = `<main class="embed-page">${compose()}<p class="small">Powered by <a href="/" target="_blank" rel="noopener noreferrer">Open Question Box ↗</a> · <a href="/privacy" target="_blank" rel="noopener noreferrer">プライバシー</a></p></main>`; }
  else app.innerHTML = `${header()}<main class="page"><div class="public-layout"><section class="intro"><span class="eyebrow">A LITTLE MESSAGE, A NEW CONNECTION</span><h1>あなたのひとことが、<br>次の<em>きっかけ</em>になる。</h1><p>聞きたいこと、伝えたいこと。<br>名前がなくても、あなたの声は届きます。</p><div class="mail-art" aria-hidden="true"><span class="spark">✧</span><div class="mail-note">?</div><div class="mail-envelope"></div><span class="spark two">✧</span></div><span class="pill"><i class="dot"></i> 誰にでも開かれた、ちいさな質問箱</span></section>${compose()}</div><section id="answers"><div class="section-title"><h2>ひとことの、その先。</h2><span>公開された質問と回答</span></div><div class="answer-grid">${state.answers.length ? state.answers.map(m => `<article class="answer-card"><div class="message-meta">${badge(m.kind)}<time datetime="${escape(m.updated_at)}">${date(m.updated_at)}</time></div><p class="question">${escape(m.body)}</p><div class="answer-text">${escape(m.answer)}</div></article>`).join('') : `<div class="empty"><span>✉</span><b>まだ、まっさらな質問箱。</b><p>公開された回答が、ここに並んでいきます。</p></div>`}</div>${state.answerMore ? `<button class="btn load-more" data-action="more-answers">もっと読む ↓</button>` : ''}</section></main>${footer()}`;
  setupTurnstile();
}
async function setupTurnstile() {
  state.turnstileToken = '';
  if (!state.profile.turnstile_site_key || !document.querySelector('#turnstile-widget')) return;
  try {
    if (typeof window.turnstile?.render !== 'function') {
      if (!turnstileLoad) turnstileLoad = new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.id = 'turnstile-script';
        window.oqbTurnstileReady = resolve;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=oqbTurnstileReady';
        script.onerror = () => { script.remove(); turnstileLoad = null; reject(new Error('script-load-failed')); };
        document.head.append(script);
      });
      await turnstileLoad;
    }
    if (document.querySelector('#turnstile-widget')) state.widget = window.turnstile.render('#turnstile-widget', { sitekey: state.profile.turnstile_site_key, action: 'submit', callback: token => { state.turnstileToken = token; }, 'expired-callback': () => { state.turnstileToken = ''; }, 'error-callback': () => { state.turnstileToken = ''; } });
  } catch (error) { console.warn('Turnstile initialization:', error.message || 'unavailable'); const el = document.querySelector('.form-error'); if (el) el.innerHTML = '<p class="error">送信確認を読み込めません。ページを再読み込みしてください。</p>'; }
}
function resetWidget() { if (state.widget !== null && window.turnstile) { window.turnstile.remove(state.widget); state.widget = null; } }
function loginPage() { app.innerHTML = `${header()}<main class="login-wrap"><div class="login-card"><span class="eyebrow">YOUR QUESTION BOX</span><h1>おかえりなさい。</h1><p class="small">届いたひとことを、見てみましょう。<br>運営者の管理キーでログインできます。</p><form id="login-form"><label for="secret">管理キー</label><input id="secret" name="secret" type="password" autocomplete="current-password" required maxlength="256"><div class="form-error" role="alert"></div><button class="btn primary" type="submit">受信箱を開く →</button></form></div><p class="small">送信する人のログインは不要です。<br>管理キーはサーバーの初期設定で発行します。</p></main>${footer()}`; }
function navItem(view, icon, label, count) { return `<button class="nav-item ${state.view === view ? 'active' : ''}" data-action="view" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}><span class="nav-icon">${icon}</span>${label}${count === undefined ? '' : `<span class="count">${count}</span>`}</button>`; }
function adminShell(content) {
  app.innerHTML = `<div class="workspace"><aside class="sidebar">${brand()}<div class="owner"><div class="avatar">${escape(state.profile.name.slice(0, 1))}</div><div><strong>${escape(state.profile.name)}</strong><small>あなたの質問箱</small></div></div><span class="nav-label">MY QUESTION BOX</span><nav>${navItem('inbox', '✉', '受信箱', state.counts.unanswered || 0)}${navItem('connect', '⌘', 'API・外部連携')}${navItem('settings', '⚙', '質問箱の設定')}</nav><div class="sidebar-bottom"><div class="notice">ちいさな声から、次のアイデアへ。<br>あなたのペースで、お返事を。</div><a href="/" target="_blank" rel="noopener noreferrer">公開ページを見る ↗</a><p class="small">OPEN SOURCE, OPEN POSSIBILITIES.</p></div></aside><div class="main"><header class="topbar"><span>マイ質問箱 &nbsp; / &nbsp; ${state.view === 'inbox' ? '受信箱' : state.view === 'connect' ? 'API・外部連携' : '質問箱の設定'}</span><div class="topbar-actions"><a href="/" target="_blank" rel="noopener noreferrer">公開ページ ↗</a><button class="btn small-btn" data-action="share">質問箱を共有 ↗</button><button class="small" data-action="logout">ログアウト</button></div></header><main class="admin-content">${content}</main></div></div>`;
}
function messageCard(m) {
  return `<article class="message-card" data-id="${m.id}"><div class="message-meta"><div class="left">${badge(m.kind)}<span>匿名さんから</span></div><time datetime="${m.created_at}">${date(m.created_at)}</time></div><p class="message-body">${escape(m.body)}</p>${m.answer ? `<div class="answer-text">${escape(m.answer)}</div>` : ''}<div class="message-actions"><span class="status-label">${m.published ? '● 公開中' : m.status === 'answered' ? '✓ 非公開の回答' : m.status === 'archived' ? 'アーカイブ済み' : '● 返事を待っています'}</span><div class="group">${m.status !== 'archived' ? `<button class="btn small-btn soft" data-action="reply" data-id="${m.id}">↩ ${m.answer ? '回答を編集' : '回答する'}</button><button class="btn small-btn" data-action="archive" data-id="${m.id}">アーカイブ</button>` : `<button class="btn small-btn" data-action="restore" data-id="${m.id}">受信箱に戻す</button>`}<button class="btn small-btn danger" data-action="delete" data-id="${m.id}">削除</button></div></div>${state.reply === m.id ? `<form class="reply-form" data-id="${m.id}"><label for="answer-${m.id}">あなたからのお返事</label><textarea id="answer-${m.id}" name="answer" maxlength="4000" required>${escape(m.answer)}</textarea><label class="check-label"><input name="published" type="checkbox" ${m.published ? 'checked' : ''}>質問と回答を公開ページに掲載する</label><p class="small">公開すると、質問の本文も誰でも読めるようになります。</p><div class="form-error" role="alert"></div><div class="reply-buttons"><button class="btn primary" type="submit">回答を保存</button><button class="btn" type="button" data-action="cancel-reply">キャンセル</button></div></form>` : ''}</article>`;
}
function inboxPage() {
  const title = { unanswered: 'まだ届いていないみたい。', answered: '回答は、ここに残ります。', archived: 'アーカイブは空です。' }[state.status];
  adminShell(`<div class="page-heading"><div><span class="eyebrow">YOUR INBOX</span><h1>届いた、ひとこと。</h1><p>質問も、感想も。あなた宛ての声が集まる場所。</p></div><button class="btn" data-action="refresh">↻ &nbsp; 更新</button></div><div class="welcome-note"><span class="nav-icon">✧</span><div><strong>回答は、あなたのペースで。</strong>すべてに答えなくても大丈夫。公開するお返事も、自分で選べます。</div></div><div class="stats">${[['unanswered', '未回答', '✉'], ['answered', '回答済み', '↩'], ['archived', 'アーカイブ', '▤']].map(([key, label, icon]) => `<div class="stat"><span class="stat-label">${label}</span><span class="stat-icon">${icon}</span><strong class="stat-number">${state.counts[key] || 0}<span class="small"> 件</span></strong></div>`).join('')}</div><div class="toolbar"><div class="tabs" role="group" aria-label="受信箱の表示">${[['unanswered', '未回答'], ['answered', '回答済み'], ['archived', 'アーカイブ']].map(([key, label]) => `<button class="tab ${state.status === key ? 'active' : ''}" data-action="filter" data-status="${key}" aria-pressed="${state.status === key}">${label} &nbsp; ${state.counts[key] || 0}</button>`).join('')}</div><form id="search-form"><input class="search" name="q" aria-label="メッセージを検索" placeholder="⌕  メッセージを検索" value="${escape(state.query)}" maxlength="100"></form></div><div class="message-list">${state.messages.length ? state.messages.map(messageCard).join('') : `<div class="empty"><span class="nav-icon">✉</span><b>${state.query ? '見つかりませんでした。' : title}</b><p>${state.query ? '別の言葉で探してみてください。' : state.status === 'unanswered' ? '質問箱のリンクを共有して、最初のひとことを待ってみましょう。' : 'メッセージを整理すると、ここに表示されます。'}</p>${state.status === 'unanswered' && !state.query ? `<button class="btn soft" data-action="share">質問箱のリンクをコピー ↗</button>` : ''}</div>`}</div>${state.hasMore ? `<button class="btn load-more" data-action="more">もっと読む ↓</button>` : ''}<p class="small">♧ 送信者のアカウントや名前を記録しない、匿名の質問箱です。</p>`);
}
function connectPage() {
  const origin = location.origin;
  adminShell(`<div class="page-heading"><div><span class="eyebrow">OPEN POSSIBILITIES</span><h1>質問箱を、つなげよう。</h1><p>AIにも、Botにも、あなたのサイトにも。</p></div></div><section class="panel"><h2>APIキー</h2><p>読み取り専用、または回答・整理のできるキーを発行します。キーは発行時に一度だけ表示されます。</p>${state.newToken ? `<div class="notice">このキーを安全な場所に保存してください。画面を離れると再表示できません。<pre>${escape(state.newToken)}</pre><button class="btn small-btn" data-action="copy-token">コピー</button><button class="btn small-btn" data-action="dismiss-token">保存したので閉じる</button></div>` : ''}<form id="token-form"><div class="form-row"><div><label for="token-name">キーの名前</label><input id="token-name" name="name" maxlength="60" placeholder="例：わたしのAIエージェント" required></div><div><label for="scope">権限</label><select id="scope" name="scope"><option value="read">読み取りのみ</option><option value="write">読み取り・回答・整理</option></select></div><button class="btn primary" type="submit">キーを発行</button></div><div class="form-error" role="alert"></div></form><div>${state.tokens.map(t => `<div class="token-row"><div><strong>${escape(t.name)}</strong><small>${t.scope === 'read' ? '読み取りのみ' : '読み取り・回答・整理'} · ${date(t.created_at)}</small></div><button class="btn small-btn danger" data-action="revoke" data-id="${t.id}">失効させる</button></div>`).join('')}</div><p class="small">書き込みキーは、質問の削除や回答の公開もできます。信頼できるアプリだけに渡してください。</p></section><section class="panel"><h2>使い始める</h2><p>セルフホスト版のAPIに、有効化料金や従量課金はありません。外部AIの利用料は別です。</p><pre>curl '${escape(origin)}/api/v1/messages?status=unanswered' \\\n  -H 'Authorization: Bearer YOUR_API_KEY'</pre><p><a href="/openapi.json" target="_blank" rel="noopener noreferrer">API仕様を開く ↗</a></p></section><section class="panel"><h2>サイトに、ひとことの入口を。</h2><p>以下のコードを、あなたのブログやサイトに貼り付けてください。</p><pre>&lt;iframe src="${escape(origin)}/embed" title="匿名フィードバック"\n  width="100%" height="620" loading="lazy"\n  style="border:0;max-width:560px"&gt;&lt;/iframe&gt;</pre><button class="btn" data-action="copy-embed">埋め込みコードをコピー</button><a class="btn" href="/embed" target="_blank" rel="noopener noreferrer">フォームを見る ↗</a></section><section class="panel"><h2>Webhook</h2><p>新着と回答・状態変更を、署名付きで外部アプリに届けます。送信先と署名キーは、サーバー設定で指定します。</p><span class="pill"><i class="dot"></i>${state.webhook.configured ? '設定済み' : '未設定'}</span><p class="small">送信待ち ${state.webhook.pending || 0} 件 · 再試行上限 ${state.webhook.failed || 0} 件。設定・署名検証の手順はREADMEに記載しています。</p></section>`);
}
function settingsPage() {
  const p = state.profile;
  adminShell(`<div class="page-heading"><div><span class="eyebrow">MAKE IT YOURS</span><h1>あなたらしい、質問箱に。</h1><p>名前と紹介文、受け取り方を整えましょう。</p></div></div><section class="panel"><h2>公開プロフィール</h2><form id="profile-form"><label for="profile-name">質問箱の名前</label><input id="profile-name" name="name" value="${escape(p.name)}" maxlength="60" required><label for="bio">紹介文</label><textarea id="bio" name="bio" maxlength="500">${escape(p.bio)}</textarea><label class="check-label"><input name="accepting" type="checkbox" ${p.accepting ? 'checked' : ''}>新しいメッセージを受け取る</label><div class="form-error" role="alert"></div><button class="btn primary" type="submit">変更を保存</button></form></section><section class="panel"><h2>あなたのデータは、あなたのもの。</h2><p>プロフィール、質問、回答をJSONで持ち出せます。別のOpen Question Boxに取り込んで、続きから運営できます。</p><div class="notice">非公開の質問・回答も含まれます。ファイルを公開しないでください。完全な移行の際は受付を止め、回答の編集も休止してから書き出してください。</div><button class="btn" data-action="export">↓ データを書き出す</button><form id="import-form"><label for="import-file">JSONを取り込む</label><input id="import-file" name="file" type="file" accept="application/json,.json" required><p class="small">同じIDのメッセージは上書きせずスキップします。プロフィールは取り込んだ値に更新します。</p><div class="form-error" role="alert"></div><button class="btn" type="submit">データを取り込む</button></form></section><section class="panel"><h2>JPYCでの応援</h2><p>ウォレット間の直接送金とプラットフォーム手数料0%を目指しています。法的・技術的な確認を進めるため、現在は準備中です。</p><span class="pill">準備中 · 決済は無効</span><p class="small">通常の匿名質問やAPIは、JPYCを持っていなくても使えます。</p></section>`);
}
async function loadMessages(append = false) {
  const data = await api(`/messages?status=${state.status}&q=${encodeURIComponent(state.query)}&limit=20&offset=${append ? state.offset + 20 : 0}`);
  state.offset = append ? state.offset + 20 : 0; state.messages = append ? [...state.messages, ...data.data] : data.data; state.counts = data.counts; state.hasMore = data.has_more; inboxPage();
}
async function loadConnect() { const [tokens, webhook] = await Promise.all([api('/tokens'), api('/webhooks/status')]); state.tokens = tokens.data; state.webhook = webhook; connectPage(); }
async function loadAnswers(append = false) { const data = await api(`/answers?limit=12&offset=${append ? state.answerOffset + 12 : 0}`); state.answerOffset = append ? state.answerOffset + 12 : 0; state.answers = append ? [...state.answers, ...data.data] : data.data; state.answerMore = data.has_more; resetWidget(); publicPage(); }
async function copy(value) { try { await navigator.clipboard.writeText(value); toast('コピーしました。'); } catch { toast('コピーできませんでした。ブラウザの権限を確認してください。'); } }
document.addEventListener('input', event => { if (event.target.id === 'message') document.querySelector('#char-count').textContent = event.target.value.length; });
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action; const id = button.dataset.id;
  try {
    if (action === 'kind') { state.kind = button.dataset.kind; document.querySelectorAll('.kind').forEach(el => { el.classList.toggle('active', el === button); el.setAttribute('aria-pressed', el === button ? 'true' : 'false'); }); }
    if (action === 'another') { state.sent = false; resetWidget(); publicPage(); }
    if (action === 'share') await copy(location.origin + '/');
    if (action === 'refresh') { state.reply = null; await loadMessages(); toast('受信箱を更新しました。'); }
    if (action === 'filter') { state.status = button.dataset.status; state.reply = null; await loadMessages(); }
    if (action === 'more') await loadMessages(true);
    if (action === 'more-answers') await loadAnswers(true);
    if (action === 'reply') { state.reply = state.reply === id ? null : id; inboxPage(); document.querySelector('.reply-form textarea')?.focus(); }
    if (action === 'cancel-reply') { state.reply = null; inboxPage(); }
    if (['archive', 'restore', 'delete'].includes(action)) {
      if (action === 'delete' && !confirm('このメッセージと回答を完全に削除します。元に戻せません。削除しますか？')) return;
      button.disabled = true;
      const m = state.messages.find(m => m.id === id);
      await api(`/messages/${id}`, action === 'delete' ? { method: 'DELETE' } : { method: 'PATCH', body: JSON.stringify({ status: action === 'archive' ? 'archived' : m.answer ? 'answered' : 'unanswered', published: false }) });
      state.reply = null; await loadMessages(); toast(action === 'delete' ? '削除しました。' : action === 'archive' ? 'アーカイブしました。' : '受信箱に戻しました。');
    }
    if (action === 'view') { state.newToken = null; state.view = button.dataset.view; state.reply = null; if (state.view === 'inbox') await loadMessages(); else if (state.view === 'connect') await loadConnect(); else settingsPage(); }
    if (action === 'logout') { await api('/auth/logout', { method: 'POST' }); state.newToken = null; state.messages = []; state.tokens = []; state.authenticated = false; loginPage(); }
    if (action === 'copy-token') await copy(state.newToken);
    if (action === 'dismiss-token') { state.newToken = null; connectPage(); }
    if (action === 'copy-embed') await copy(`<iframe src="${location.origin}/embed" title="匿名フィードバック" width="100%" height="620" loading="lazy" style="border:0;max-width:560px"></iframe>`);
    if (action === 'revoke') { if (!confirm('このAPIキーを失効させますか？連携アプリからのアクセスが止まります。')) return; await api(`/tokens/${id}`, { method: 'DELETE' }); state.newToken = null; await loadConnect(); toast('APIキーを失効させました。'); }
    if (action === 'export') {
      button.disabled = true; const messages = []; let offset = 0; let page;
      do { page = await api(`/export?limit=500&offset=${offset}`); messages.push(...page.messages); offset += 500; } while (page.has_more);
      const download = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exported_at: new Date().toISOString(), profile: page.profile, messages }, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = download; link.download = `open-question-box-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(download), 10000); button.disabled = false; toast('データを書き出しました。');
    }
  } catch (error) { button.disabled = false; handleError(error); }
});
document.addEventListener('submit', async event => {
  const form = event.target; event.preventDefault(); const submit = form.querySelector('[type="submit"]'); const errorEl = form.querySelector('.form-error'); if (errorEl) errorEl.innerHTML = ''; if (submit) submit.disabled = true;
  const data = new FormData(form);
  try {
    if (form.id === 'compose-form') {
      if (state.profile.turnstile_site_key && !state.turnstileToken) throw new Error('送信確認が終わるまで、少しお待ちください。');
      await api('/messages', { method: 'POST', body: JSON.stringify({ body: data.get('body'), kind: state.kind, website: data.get('website'), turnstile_token: state.turnstileToken }) }); state.sent = true; resetWidget(); publicPage();
    } else if (form.id === 'login-form') { await api('/auth/login', { method: 'POST', body: JSON.stringify({ secret: data.get('secret') }) }); form.reset(); state.authenticated = true; await loadMessages(); }
    else if (form.classList.contains('reply-form')) { await api(`/messages/${form.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ answer: data.get('answer'), published: data.has('published') }) }); state.reply = null; await loadMessages(); toast('回答を保存しました。'); }
    else if (form.id === 'profile-form') { await api('/profile', { method: 'PATCH', body: JSON.stringify({ name: data.get('name'), bio: data.get('bio'), accepting: data.has('accepting') }) }); state.profile = await api('/profile'); settingsPage(); toast('設定を保存しました。'); }
    else if (form.id === 'search-form') { state.query = String(data.get('q') || ''); await loadMessages(); }
    else if (form.id === 'token-form') { const token = await api('/tokens', { method: 'POST', body: JSON.stringify({ name: data.get('name'), scope: data.get('scope') }) }); state.newToken = token.token; await loadConnect(); }
    else if (form.id === 'import-form') {
      const file = data.get('file'); if (!file || file.size > 20 * 1024 * 1024) throw new Error('20MB以下のJSONファイルを選んでください。');
      const imported = JSON.parse(await file.text()); if (imported.version !== 1 || !Array.isArray(imported.messages)) throw new Error('Open Question Boxのバージョン1のJSONを選んでください。');
      if (!confirm(`${imported.messages.length}件のメッセージを取り込み、プロフィールを更新しますか？`)) return;
      let total = 0;
      for (let offset = 0; offset < Math.max(1, imported.messages.length); offset += 500) { const result = await api('/import', { method: 'POST', body: JSON.stringify({ version: 1, ...(offset === 0 ? { profile: imported.profile } : {}), messages: imported.messages.slice(offset, offset + 500) }) }); total += result.imported; }
      state.profile = await api('/profile'); settingsPage(); toast(`${total}件を取り込みました。`);
    }
  } catch (error) {
    if (form.id === 'compose-form' && state.widget !== null && window.turnstile) { window.turnstile.reset(state.widget); state.turnstileToken = ''; }
    if (errorEl && errorEl.isConnected) errorEl.innerHTML = `<p class="error">${escape(error.message)}</p>`; else handleError(error);
  } finally { if (submit) submit.disabled = false; }
});
function handleError(error) { if (error.status === 401 && location.pathname === '/admin') { state.authenticated = false; state.newToken = null; loginPage(); } toast(error.message); }
function privacyPage() { app.innerHTML = `${header()}<main class="document"><span class="eyebrow">PRIVACY & TRUST</span><h1>安心して、ひとことを。</h1><h2>質問箱に保存するもの</h2><p>メッセージ本文、種類、送信日時、回答、公開状態を保存します。送信者の名前、メールアドレス、アカウント登録は必要ありません。個人を特定できる情報や秘密は書かないでください。</p><h2>匿名性とスパム対策</h2><p>アプリは生のIPアドレスをデータベースに保存しません。スパム防止のため、IPアドレスから有効期間の短い署名付きハッシュを生成し、送信回数を制限します。Cloudflareは通信の処理にIPアドレス等を使用します。インフラ運営者を含めた完全な匿名性を保証するものではありません。</p><h2>公開と外部連携</h2><p>送ったメッセージは、まず受信者だけが読めます。受信者が公開を選ぶと、質問本文と回答が公開されます。受信者が設定したAPI・Webhookを通じて、外部サービスやAIに内容が渡ることがあります。</p><h2>Cookieと管理画面</h2><p>管理者のログイン維持のため、最大12時間のCookieを使用します。広告や行動追跡のためのCookieは使用しません。送信確認を設定している場合、Cloudflare Turnstileを読み込みます。</p><h2>保存期間と削除</h2><p>メッセージは受信者が削除するまで保存されます。送信回数のハッシュと期限切れセッションは定期処理で削除します。Webhook送信履歴は最大7日間で削除します。外部連携先に渡ったデータは、受信者が外部サービス側で管理する必要があります。</p><h2>不適切なメッセージ</h2><p>嫌がらせや機密情報を含む投稿は避けてください。運営者はメッセージを非公開のままアーカイブ・削除したり、受付を一時停止したりできます。</p><a class="btn soft" href="/">質問箱に戻る ←</a></main>${footer()}`; }
async function init() {
  try {
    state.profile = await api('/profile');
    if (location.pathname === '/privacy') return privacyPage();
    if (location.pathname === '/admin') {
      try { await api('/auth/session'); state.authenticated = true; } catch (error) { if (error.status !== 401) throw error; }
      if (state.authenticated) await loadMessages(); else loginPage();
    } else await loadAnswers();
  } catch (error) { app.innerHTML = `${header()}<main class="page"><div class="empty"><b>質問箱を開けませんでした。</b><p>${escape(error.message)}</p><a class="btn" href="${escape(location.pathname)}">もう一度開く</a></div></main>`; }
}
init();

