/**
 * Tests for api/gemini.ts handler.
 * Run with: npm run test:api
 * 
 * These tests import the real createHandler and inject fake dependencies,
 * ensuring the actual handler logic is exercised.
 */

import { ThinkingLevel } from '@google/genai';
import {
  createHandler,
  validateRequestBody,
  validatePillName,
  type HandlerDependencies,
  type GenerateContentParams,
  type GenerateContentResult,
  type RateLimitState,
  type HandlerRequest,
  type HandlerResponse,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  MAX_MESSAGE_LENGTH,
  MAX_HISTORY_TURNS,
  MAX_TOTAL_BODY_CHARS,
  MAX_RAW_BODY_SIZE,
  MAX_PILL_NAME_LENGTH,
  MAX_OUTPUT_TOKENS_CHAT,
  MAX_OUTPUT_TOKENS_CHAT_THINKING,
  MAX_OUTPUT_TOKENS_SUGGESTION,
} from '../../api/gemini';

// ─── Test Utilities ──────────────────────────────────────────────────────────

interface MockResponse extends HandlerResponse {
  _status: number;
  _json: unknown;
  _ended: boolean;
  _headers: Map<string, string>;
}

function createMockRequest(overrides: Partial<HandlerRequest> = {}): HandlerRequest {
  return {
    method: 'POST',
    headers: { 
      authorization: 'Bearer valid-token',
      origin: 'https://ai-pill-reminder.vercel.app',
    },
    body: { action: 'chat', message: 'Hello' },
    ...overrides,
  };
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    _status: 200,
    _json: null as unknown,
    _ended: false,
    _headers: new Map(),
    setHeader: (name: string, value: string) => {
      res._headers.set(name.toLowerCase(), value);
      return res;
    },
    status: (code: number) => {
      res._status = code;
      return res;
    },
    json: (data: unknown) => {
      res._json = data;
      return res;
    },
    end: () => {
      res._ended = true;
      return res;
    },
  };
  return res;
}

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    testsPassed++;
  } else {
    console.log(`  ✗ ${message}`);
    testsFailed++;
  }
}

// ─── Fake Dependencies ───────────────────────────────────────────────────────

interface FakeState {
  verifyUserResult: { userId: string } | null;
  generateContentResult: GenerateContentResult;
  generateContentError: Error | null;
  lastGenerateContentParams: GenerateContentParams | null;
  currentTime: number;
}

function createFakeDeps(state: FakeState): HandlerDependencies {
  return {
    verifyUser: async () => state.verifyUserResult,
    generateContent: async (params) => {
      state.lastGenerateContentParams = params;
      if (state.generateContentError) {
        throw state.generateContentError;
      }
      return state.generateContentResult;
    },
    now: () => state.currentTime,
    geminiApiKey: 'test-api-key',
  };
}

function createFakeState(): FakeState {
  return {
    verifyUserResult: { userId: 'test-user-123' },
    generateContentResult: { text: 'Mocked AI response' },
    generateContentError: null,
    lastGenerateContentParams: null,
    currentTime: 1000000,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log('\n🧪 Running API handler tests...\n');

  // ══════════════════════════════════════════════════════════════════════════
  // HTTP Method Tests
  // ══════════════════════════════════════════════════════════════════════════

  console.log('Test: 405 on GET request');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({ method: 'GET' });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 405, `Expected 405, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Method not allowed', 'Error message matches');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CORS Tests
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\nTest: CORS allowed for production origin');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      headers: {
        authorization: 'Bearer valid-token',
        origin: 'https://ai-pill-reminder.vercel.app',
      },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._headers.get('access-control-allow-origin') === 'https://ai-pill-reminder.vercel.app', 'CORS origin set');
    assert(res._headers.get('vary') === 'Origin', 'Vary header set');
  }

  console.log('\nTest: CORS allowed for Vercel preview URL');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const previewOrigin = 'https://ai-pill-reminder-abc123-hendersonjames-projects.vercel.app';
    const req = createMockRequest({
      headers: {
        authorization: 'Bearer valid-token',
        origin: previewOrigin,
      },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._headers.get('access-control-allow-origin') === previewOrigin, 'CORS origin set for preview');
  }

  console.log('\nTest: CORS allowed for localhost with port');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      headers: {
        authorization: 'Bearer valid-token',
        origin: 'http://localhost:3000',
      },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._headers.get('access-control-allow-origin') === 'http://localhost:3000', 'CORS origin set for localhost');
  }

  console.log('\nTest: CORS allowed for capacitor://localhost');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      headers: {
        authorization: 'Bearer valid-token',
        origin: 'capacitor://localhost',
      },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._headers.get('access-control-allow-origin') === 'capacitor://localhost', 'CORS origin set for capacitor');
  }

  console.log('\nTest: CORS denied for disallowed origin');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      headers: {
        authorization: 'Bearer valid-token',
        origin: 'https://evil-site.com',
      },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(!res._headers.has('access-control-allow-origin'), 'CORS origin not set for disallowed origin');
    assert(res._headers.get('vary') === 'Origin', 'Vary header still set');
  }

  console.log('\nTest: CORS preflight denied for disallowed origin');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil-site.com',
      },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 403, `Expected 403 for disallowed preflight, got ${res._status}`);
  }

  console.log('\nTest: CORS preflight allowed for valid origin');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      method: 'OPTIONS',
      headers: {
        origin: 'https://ai-pill-reminder.vercel.app',
      },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 200, `Expected 200 for allowed preflight, got ${res._status}`);
    assert(res._ended === true, 'Response ended for preflight');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Body Validation Tests
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\nTest: 400 on null body');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({ body: null });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Invalid request body', 'Error message matches');
  }

  console.log('\nTest: 400 on array body');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({ body: [] });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
  }

  console.log('\nTest: 400 on string body');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({ body: 'not an object' });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
  }

  console.log('\nTest: 400 on invalid action');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({ body: { action: 'invalid' } });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Invalid action', 'Error message matches');
  }

  console.log('\nTest: 400 on non-string message');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({ body: { action: 'chat', message: 123 } });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Invalid message type', 'Error message matches');
  }

  console.log('\nTest: 400 on non-array history');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({ body: { action: 'chat', message: 'Hi', history: 'not an array' } });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Invalid history type', 'Error message matches');
  }

  console.log('\nTest: 400 on invalid history entry (bad author)');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      body: { action: 'chat', message: 'Hi', history: [{ author: 'invalid', text: 'Hello' }] },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Invalid history entry', 'Error message matches');
  }

  console.log('\nTest: 400 on non-boolean isThinkingMode');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({ body: { action: 'chat', message: 'Hi', isThinkingMode: 'true' } });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Invalid isThinkingMode type', 'Error message matches');
  }

  console.log('\nTest: 400 on non-string pillName');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({ body: { action: 'suggestion', pillName: 123 } });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Invalid pillName type', 'Error message matches');
  }

  console.log('\nTest: 400 on body exceeding raw size limit');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      headers: {
        authorization: 'Bearer valid-token',
        origin: 'https://ai-pill-reminder.vercel.app',
        'content-length': String(MAX_RAW_BODY_SIZE + 1),
      },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Request body too large', 'Error message matches');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Auth Tests
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\nTest: 401 with missing authorization header');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({ headers: { origin: 'https://ai-pill-reminder.vercel.app' } });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 401, `Expected 401, got ${res._status}`);
  }

  console.log('\nTest: 401 with malformed authorization header (no Bearer prefix)');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      headers: { authorization: 'InvalidFormat token', origin: 'https://ai-pill-reminder.vercel.app' },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 401, `Expected 401, got ${res._status}`);
  }

  console.log('\nTest: 401 with rejected token (user not found)');
  {
    const state = createFakeState();
    state.verifyUserResult = null;
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest();
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 401, `Expected 401, got ${res._status}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Size Limit Tests
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\nTest: 400 on oversize message');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      body: { action: 'chat', message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Message too long', 'Error message matches');
  }

  console.log('\nTest: 400 on oversize history message');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      body: {
        action: 'chat',
        message: 'Hello',
        history: [{ author: 'user', text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }],
      },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'History message too long', 'Error message matches');
  }

  console.log('\nTest: History trimmed to last 20 turns');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const history = Array.from({ length: 30 }, (_, i) => ({
      author: (i % 2 === 0 ? 'user' : 'bot') as 'user' | 'bot',
      text: `Message ${i}`,
    }));
    
    const req = createMockRequest({
      body: { action: 'chat', message: 'Hello', history },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 200, `Expected 200, got ${res._status}`);
    
    // Check that generateContent received only 20 history items + 1 new message
    const params = state.lastGenerateContentParams;
    assert(params !== null, 'generateContent was called');
    const contents = params?.contents;
    assert(Array.isArray(contents), 'contents is array');
    assert(contents?.length === MAX_HISTORY_TURNS + 1, `Expected ${MAX_HISTORY_TURNS + 1} messages, got ${contents?.length}`);
    
    // Verify the first message is Message 10 (0-indexed, first of trimmed history starting at index 10)
    const firstContent = contents?.[0];
    const firstText = typeof firstContent === 'object' && firstContent?.parts?.[0]?.text;
    assert(
      firstText === 'Message 10',
      `Expected first message to be 'Message 10' (trimmed), got '${firstText}'`
    );
  }

  console.log('\nTest: 400 on total content exceeding 16k chars');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    // Create history that exceeds total limit
    const history = Array.from({ length: 10 }, () => ({
      author: 'user' as const,
      text: 'x'.repeat(1800), // 1800 * 10 = 18000 > 16000
    }));
    
    const req = createMockRequest({
      body: { action: 'chat', message: 'Hello', history },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Request content too large', 'Error message matches');
  }

  console.log('\nTest: 400 on oversize pill name');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      body: { action: 'suggestion', pillName: 'x'.repeat(MAX_PILL_NAME_LENGTH + 1) },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Pill name too long', 'Error message matches');
  }

  console.log('\nTest: 400 on pill name with invalid characters');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      body: { action: 'suggestion', pillName: 'Aspirin<script>alert(1)</script>' },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Pill name contains invalid characters', 'Error message matches');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Rate Limit Tests
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\nTest: 429 on 11th request within rate limit window');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    // Make 10 successful requests
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);
      assert(res._status === 200, `Request ${i + 1} should succeed`);
    }
    
    // 11th request should be rate limited
    const req = createMockRequest();
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 429, `Expected 429 on 11th request, got ${res._status}`);
  }

  console.log('\nTest: Rate limit resets after window expires');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    // Make 10 requests
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);
    }
    
    // 11th should fail
    {
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);
      assert(res._status === 429, 'Should be rate limited');
    }
    
    // Advance time past the window
    state.currentTime += RATE_LIMIT_WINDOW_MS + 1;
    
    // Now request should succeed
    {
      const req = createMockRequest();
      const res = createMockResponse();
      await handler(req, res);
      assert(res._status === 200, `Expected 200 after window reset, got ${res._status}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // API Key Tests
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\nTest: 503 when Gemini API key is missing');
  {
    const state = createFakeState();
    const deps = createFakeDeps(state);
    deps.geminiApiKey = undefined;
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(deps, rateLimitState);
    
    const req = createMockRequest();
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 503, `Expected 503, got ${res._status}`);
    assert((res._json as { code?: string })?.code === 'AI_UNAVAILABLE', 'code should be AI_UNAVAILABLE');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Success Tests
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\nTest: 200 with successful chat response');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest();
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 200, `Expected 200, got ${res._status}`);
    assert((res._json as { text?: string })?.text === 'Mocked AI response', 'Response text matches');
  }

  console.log('\nTest: 200 with successful suggestion response');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      body: { action: 'suggestion', pillName: 'Aspirin' },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 200, `Expected 200, got ${res._status}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Error Response Tests
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\nTest: 502 on empty AI response');
  {
    const state = createFakeState();
    state.generateContentResult = { text: '' };
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest();
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 502, `Expected 502, got ${res._status}`);
    assert((res._json as { code?: string })?.code === 'EMPTY_RESPONSE', 'code should be EMPTY_RESPONSE');
  }

  console.log('\nTest: 502 on undefined AI response text');
  {
    const state = createFakeState();
    state.generateContentResult = { text: undefined };
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest();
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 502, `Expected 502, got ${res._status}`);
  }

  console.log('\nTest: 500 when generateContent throws');
  {
    const state = createFakeState();
    state.generateContentError = new Error('Gemini API failure');
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest();
    const res = createMockResponse();
    await handler(req, res);
    
    assert(res._status === 500, `Expected 500, got ${res._status}`);
    assert((res._json as { code?: string })?.code === 'INTERNAL_ERROR', 'code should be INTERNAL_ERROR');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // generateContent Parameter Tests
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\nTest: thinkingLevel is MINIMAL and maxOutputTokens is 2048 for normal chat mode');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      body: { action: 'chat', message: 'Hello', isThinkingMode: false },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    const params = state.lastGenerateContentParams;
    assert(params !== null, 'generateContent was called');
    assert(
      params?.config?.thinkingConfig?.thinkingLevel === ThinkingLevel.MINIMAL,
      `Expected MINIMAL, got ${params?.config?.thinkingConfig?.thinkingLevel}`
    );
    assert(
      params?.config?.maxOutputTokens === MAX_OUTPUT_TOKENS_CHAT,
      `Expected ${MAX_OUTPUT_TOKENS_CHAT}, got ${params?.config?.maxOutputTokens}`
    );
    assert(params?.model === 'gemini-3.5-flash-lite', `Expected gemini-3.5-flash-lite, got ${params?.model}`);
  }

  console.log('\nTest: thinkingLevel is MEDIUM (no thinkingBudget) and maxOutputTokens is 8192 for thinking mode');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      body: { action: 'chat', message: 'Hello', isThinkingMode: true },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    const params = state.lastGenerateContentParams;
    assert(params !== null, 'generateContent was called');
    assert(
      params?.config?.thinkingConfig?.thinkingLevel === ThinkingLevel.MEDIUM,
      `Expected MEDIUM, got ${params?.config?.thinkingConfig?.thinkingLevel}`
    );
    // Gemini 3 returns 400 if both thinkingLevel and thinkingBudget are set
    assert(
      !('thinkingBudget' in (params?.config?.thinkingConfig || {})),
      'thinkingBudget should not be present'
    );
    assert(
      params?.config?.maxOutputTokens === MAX_OUTPUT_TOKENS_CHAT_THINKING,
      `Expected ${MAX_OUTPUT_TOKENS_CHAT_THINKING}, got ${params?.config?.maxOutputTokens}`
    );
    assert(params?.model === 'gemini-3.5-flash', `Expected gemini-3.5-flash, got ${params?.model}`);
  }

  console.log('\nTest: maxOutputTokens is 64 for suggestions');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      body: { action: 'suggestion', pillName: 'Aspirin' },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    const params = state.lastGenerateContentParams;
    assert(params !== null, 'generateContent was called');
    assert(
      params?.config?.maxOutputTokens === MAX_OUTPUT_TOKENS_SUGGESTION,
      `Expected ${MAX_OUTPUT_TOKENS_SUGGESTION}, got ${params?.config?.maxOutputTokens}`
    );
  }

  console.log('\nTest: Pill name is passed as JSON-quoted data');
  {
    const state = createFakeState();
    const rateLimitState: RateLimitState = { map: new Map() };
    const handler = createHandler(createFakeDeps(state), rateLimitState);
    
    const req = createMockRequest({
      body: { action: 'suggestion', pillName: 'Aspirin' },
    });
    const res = createMockResponse();
    await handler(req, res);
    
    const params = state.lastGenerateContentParams;
    assert(params !== null, 'generateContent was called');
    const contents = params?.contents;
    assert(Array.isArray(contents), 'contents is array');
    const firstContent = contents?.[0];
    const firstPart = typeof firstContent === 'object' && firstContent?.parts?.[0]?.text;
    assert(
      firstPart === 'Medication name: "Aspirin"',
      `Expected JSON-quoted pill name, got '${firstPart}'`
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Validation Function Unit Tests
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\nTest: validateRequestBody rejects body over raw size limit');
  {
    const result = validateRequestBody({ action: 'chat', message: 'Hi' }, MAX_RAW_BODY_SIZE + 1);
    assert(!result.valid, 'Should be invalid');
    assert(result.error === 'Request body too large', `Error: ${result.error}`);
  }

  console.log('\nTest: validatePillName rejects empty name');
  {
    const result = validatePillName('   ');
    assert(!result.valid, 'Should be invalid');
    assert(result.error === 'Pill name is required', `Error: ${result.error}`);
  }

  console.log('\nTest: validatePillName accepts valid characters');
  {
    const result = validatePillName("Tylenol Extra-Strength (500mg)");
    assert(result.valid, 'Should be valid');
  }

  console.log('\nTest: validatePillName rejects script tags');
  {
    const result = validatePillName('<script>');
    assert(!result.valid, 'Should be invalid');
    assert(result.error === 'Pill name contains invalid characters', `Error: ${result.error}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════════

  console.log('\n' + '='.repeat(50));
  console.log(`Tests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsFailed}`);
  console.log('='.repeat(50) + '\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
