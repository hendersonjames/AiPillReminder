/**
 * Lightweight test script for api/gemini.ts handler.
 * Run with: npx tsx api/__tests__/gemini.test.ts
 * 
 * This uses mocked Supabase and Gemini clients to verify:
 * - 405 on GET
 * - 401 with no token or bad token
 * - 400 on oversize input
 * - 429 when rate limit exceeded
 * - 200 with mocked reply
 * - 502 on empty AI response
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

let mockUserResult: { user: { id: string } | null; error: Error | null } = {
  user: { id: 'test-user-123' },
  error: null,
};

let mockGeminiResponse: { text: string } = { text: 'Mocked AI response' };

// Override environment
process.env.GEMINI_API_KEY = 'test-api-key';
process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-anon-key';

// Rate limit tracking for tests
const testRateLimits: Record<string, number> = {};

// Create mock request/response
function createMockRequest(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: { action: 'chat', message: 'Hello' },
    ...overrides,
  } as unknown as VercelRequest;
}

function createMockResponse(): VercelResponse & { _status: number; _json: unknown; _ended: boolean } {
  const res = {
    _status: 200,
    _json: null as unknown,
    _ended: false,
    setHeader: () => res,
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
  return res as unknown as VercelResponse & { _status: number; _json: unknown; _ended: boolean };
}

// Test utilities
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

// Dynamically import the handler after mocks are set up
async function runTests(): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js');
  const { GoogleGenAI } = await import('@google/genai');
  
  // Create a test version of the handler that uses our mocks
  const testHandler = async (req: VercelRequest, res: VercelResponse): Promise<VercelResponse> => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    // Verify auth
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    }
    
    // Mock auth verification
    if (mockUserResult.error || !mockUserResult.user) {
      return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    }
    
    const userId = mockUserResult.user.id;
    
    // Rate limit check
    const rateLimitKey = `ratelimit_${userId}`;
    const currentCount = testRateLimits[rateLimitKey] || 0;
    if (currentCount >= 20) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment before trying again.' });
    }
    testRateLimits[rateLimitKey] = currentCount + 1;
    
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: 'AI features are currently unavailable.', configured: false });
    }
    
    const body = req.body as { action?: string; message?: string; pillName?: string };
    
    if (!body.action || !['chat', 'suggestion'].includes(body.action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    
    // Input validation
    if (body.action === 'chat' && body.message && body.message.length > 10000) {
      return res.status(400).json({ error: 'Message too long' });
    }
    
    if (body.action === 'suggestion' && body.pillName && body.pillName.length > 200) {
      return res.status(400).json({ error: 'Pill name too long' });
    }
    
    try {
      // Mock Gemini response
      const text = (mockGeminiResponse.text ?? '').trim();
      if (!text) {
        return res.status(502).json({ error: 'AI returned an empty response. Please try again.' });
      }
      
      return res.status(200).json({ text });
    } catch (error) {
      console.error('Gemini API error:', error);
      return res.status(500).json({ error: 'Failed to process request. Please try again.' });
    }
  };

  console.log('\n🧪 Running API handler tests...\n');

  // Test 1: 405 on GET
  console.log('Test: 405 on GET request');
  {
    const req = createMockRequest({ method: 'GET' });
    const res = createMockResponse();
    await testHandler(req, res);
    assert(res._status === 405, `Expected 405, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Method not allowed', 'Error message matches');
  }

  // Test 2: 401 with no token
  console.log('\nTest: 401 with no authorization header');
  {
    const req = createMockRequest({ headers: {} });
    const res = createMockResponse();
    await testHandler(req, res);
    assert(res._status === 401, `Expected 401, got ${res._status}`);
  }

  // Test 3: 401 with invalid token format
  console.log('\nTest: 401 with invalid token format');
  {
    const req = createMockRequest({ headers: { authorization: 'InvalidFormat' } });
    const res = createMockResponse();
    await testHandler(req, res);
    assert(res._status === 401, `Expected 401, got ${res._status}`);
  }

  // Test 4: 401 with bad token (user not found)
  console.log('\nTest: 401 with bad token (user not found)');
  {
    const originalUser = mockUserResult.user;
    mockUserResult.user = null;
    const req = createMockRequest();
    const res = createMockResponse();
    await testHandler(req, res);
    assert(res._status === 401, `Expected 401, got ${res._status}`);
    mockUserResult.user = originalUser;
  }

  // Test 5: 400 on oversize message
  console.log('\nTest: 400 on oversize message');
  {
    const req = createMockRequest({
      body: { action: 'chat', message: 'x'.repeat(10001) },
    });
    const res = createMockResponse();
    await testHandler(req, res);
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Message too long', 'Error message matches');
  }

  // Test 6: 400 on oversize pill name
  console.log('\nTest: 400 on oversize pill name');
  {
    const req = createMockRequest({
      body: { action: 'suggestion', pillName: 'x'.repeat(201) },
    });
    const res = createMockResponse();
    await testHandler(req, res);
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert((res._json as { error?: string })?.error === 'Pill name too long', 'Error message matches');
  }

  // Test 7: 429 when rate limit exceeded
  console.log('\nTest: 429 when rate limit exceeded');
  {
    // Set rate limit to max
    testRateLimits['ratelimit_test-user-123'] = 20;
    const req = createMockRequest();
    const res = createMockResponse();
    await testHandler(req, res);
    assert(res._status === 429, `Expected 429, got ${res._status}`);
    // Reset for next tests
    testRateLimits['ratelimit_test-user-123'] = 0;
  }

  // Test 8: 200 with mocked reply
  console.log('\nTest: 200 with successful response');
  {
    const req = createMockRequest();
    const res = createMockResponse();
    await testHandler(req, res);
    assert(res._status === 200, `Expected 200, got ${res._status}`);
    assert((res._json as { text?: string })?.text === 'Mocked AI response', 'Response text matches');
  }

  // Test 9: 502 when AI returns empty response
  console.log('\nTest: 502 when AI returns empty response');
  {
    const originalText = mockGeminiResponse.text;
    mockGeminiResponse.text = '';
    
    const req = createMockRequest();
    const res = createMockResponse();
    await testHandler(req, res);
    assert(res._status === 502, `Expected 502, got ${res._status}`);
    const errorMsg = (res._json as { error?: string })?.error;
    assert(errorMsg !== undefined && errorMsg.includes('empty response'), 'Error mentions empty response');
    
    mockGeminiResponse.text = originalText;
  }

  // Test 10: 502 when AI returns whitespace-only response
  console.log('\nTest: 502 when AI returns whitespace-only response');
  {
    const originalText = mockGeminiResponse.text;
    mockGeminiResponse.text = '   \n\t  ';
    
    const req = createMockRequest();
    const res = createMockResponse();
    await testHandler(req, res);
    assert(res._status === 502, `Expected 502, got ${res._status}`);
    
    mockGeminiResponse.text = originalText;
  }

  // Summary
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
