// Forward within Cloudflare; preserve the public URL for CSRF and Turnstile.
// The existing Worker owns data, secrets, static assets and scheduled jobs.
export default {
  async fetch(request, env) {
    if (!env.BACKEND) return new Response('質問箱の公開設定がまだ完了していません。', { status: 503 });
    return env.BACKEND.fetch(request);
  }
};
