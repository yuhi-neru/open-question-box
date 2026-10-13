import { writeFile } from 'node:fs/promises';
const string = (maxLength, extra = {}) => ({ type: 'string', ...(maxLength ? { maxLength } : {}), ...extra });
const json = schema => ({ 'application/json': { schema } });
const object = (properties, required = []) => ({ type: 'object', properties, required });
const error = { description: 'Request rejected', content: json(object({ error: string() }, ['error'])) };
const owner = [{ session: [] }];
const authenticated = [{ bearer: [] }, { session: [] }];
const paging = [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 50 } }, { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 } }];
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const array = items => ({ type: 'array', items });
function operation(summary, security, request, response, code = 200, parameters = []) {
  return { summary, security, ...(request ? { requestBody: { required: true, content: json(request) } } : {}), ...(parameters.length ? { parameters } : {}), responses: { [code]: { description: 'Success', content: json(response) }, 400: error, 401: error, 403: error, 404: error, 413: error, 415: error, 429: error, 503: error } };
}
const profile = object({ name: string(60), bio: string(500), accepting: { type: 'integer', enum: [0, 1] }, turnstile_site_key: { type: ['string', 'null'] }, payments_enabled: { type: 'boolean', const: false } });
const profileInput = object({ name: string(60, { minLength: 1 }), bio: string(500), accepting: { type: 'boolean' } }, ['name', 'bio', 'accepting']);
const kinds = { type: 'string', enum: ['question', 'feedback', 'idea', 'bug'] };
const statuses = { type: 'string', enum: ['unanswered', 'answered', 'archived'] };
const message = object({ id: string(null, { format: 'uuid' }), body: string(2000), kind: kinds, status: statuses, answer: { type: ['string', 'null'], maxLength: 4000 }, published: { type: 'integer', enum: [0, 1] }, created_at: string(null, { format: 'date-time' }), updated_at: string(null, { format: 'date-time' }) }, ['id', 'body', 'kind', 'status', 'answer', 'published', 'created_at', 'updated_at']);
const answer = object(Object.fromEntries(Object.entries(message.properties).filter(([key]) => !['status', 'published'].includes(key))));
const transfer = object({ version: { const: 1, type: 'integer' }, profile: object({ name: string(60), bio: string(500), accepting: { type: ['integer', 'boolean'] } }), messages: { ...array(ref('Message')), maxItems: 500 } }, ['version', 'messages']);
const token = object({ id: string(null, { format: 'uuid' }), name: string(60), scope: { type: 'string', enum: ['read', 'write'] }, created_at: string(null, { format: 'date-time' }) });
const idParam = { name: 'id', in: 'path', required: true, schema: string(null, { format: 'uuid' }) };
const ok = object({ ok: { type: 'boolean' } });
const spec = {
  openapi: '3.1.0', info: { title: 'Open Question Box API', version: '0.1.0', description: 'Single recipient instance. read/write API keys authorize inbox operations; owner-only operations require a session cookie. Browser mutations using session cookies must send same-origin Origin. No CORS. Anonymous submission always requires configured anti-spam checks.' },
  servers: [{ url: '/api/v1' }],
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'oqb_…' }, session: { type: 'apiKey', in: 'cookie', name: 'oqb_session' } }, schemas: { Message: message, PublicAnswer: answer, Transfer: transfer } },
  paths: {
    '/health': { get: operation('Health', [], null, object({ status: string(), version: string() })) },
    '/profile': { get: operation('Public profile', [], null, profile), patch: operation('Update profile (owner)', owner, profileInput, object(profileInput.properties)) },
    '/messages': {
      post: operation('Anonymous submission (5 attempts / 10 minutes per network)', [], object({ body: string(2000, { minLength: 1 }), kind: kinds, website: { type: 'string', maxLength: 0 }, turnstile_token: string(2048, { description: 'Required with configured Turnstile; action must be submit.' }) }, ['body']), object({ id: string(null, { format: 'uuid' }), message: string() }), 201),
      get: operation('Private inbox (read or write scope)', authenticated, null, object({ data: array(ref('Message')), has_more: { type: 'boolean' }, counts: { type: 'object', additionalProperties: { type: 'integer' } } }), 200, [...paging, { name: 'status', in: 'query', schema: { ...statuses, default: 'unanswered' } }, { name: 'q', in: 'query', schema: string(100) }])
    },
    '/messages/{id}': {
      patch: operation('Answer, publish or archive (write scope). Publishing requires an answer; archive with published:false.', authenticated, object({ answer: string(4000), status: statuses, published: { type: 'boolean' } }), ref('Message'), 200, [idParam]),
      delete: operation('Permanently delete message and webhook copies (write scope)', authenticated, null, ok, 200, [idParam])
    },
    '/answers': { get: operation('Published question-answer pairs only', [], null, object({ data: array(ref('PublicAnswer')), has_more: { type: 'boolean' } }), 200, paging) },
    '/auth/login': { post: operation('Owner login (same-origin Origin required; 10 attempts / 15 minutes)', [], object({ secret: string(256) }, ['secret']), ok) },
    '/auth/session': { get: operation('Check owner session', owner, null, object({ authenticated: { type: 'boolean' } })) },
    '/auth/logout': { post: operation('Invalidate owner session', owner, null, ok) },
    '/tokens': { get: operation('List API key metadata (owner)', owner, null, object({ data: array(token) })), post: operation('Issue API key, secret returned only once (owner)', owner, object({ name: string(60, { minLength: 1 }), scope: token.properties.scope }, ['name', 'scope']), object({ id: token.properties.id, name: string(60), scope: token.properties.scope, token: string() }), 201) },
    '/tokens/{id}': { delete: operation('Revoke API key (owner)', owner, null, ok, 200, [idParam]) },
    '/export': { get: operation('Export a page (owner). Pause submissions and editing for a consistent migration.', owner, null, object({ ...transfer.properties, has_more: { type: 'boolean' } }), 200, paging.map(p => p.name === 'limit' ? { ...p, schema: { ...p.schema, maximum: 500, default: 500 } } : p)) },
    '/import': { post: operation('Import up to 500 records atomically (owner). Existing IDs skipped; profile updated. No webhook emitted.', owner, ref('Transfer'), object({ imported: { type: 'integer' } })) },
    '/webhooks/status': { get: operation('Webhook configuration and delivery counts (owner)', owner, null, object({ configured: { type: 'boolean' }, pending: { type: ['integer', 'null'] }, failed: { type: ['integer', 'null'] } })) }
  }
};
await writeFile('public/openapi.json', JSON.stringify(spec, null, 2) + '\n');
console.log('OpenAPI specification generated.');
