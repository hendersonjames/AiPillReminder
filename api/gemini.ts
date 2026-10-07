import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const MAX_MESSAGE_LENGTH = 10000;
const MAX_HISTORY_LENGTH = 50;
const MAX_PILL_NAME_LENGTH = 200;

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);
  
  if (!userLimit || now > userLimit.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  userLimit.count++;
  return true;
}

for (const [key, value] of rateLimitMap) {
  if (Date.now() > value.resetTime + RATE_LIMIT_WINDOW_MS * 10) {
    rateLimitMap.delete(key);
  }
}

async function verifyAuth(authHeader: string | undefined): Promise<{ userId: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Supabase configuration missing');
    return null;
  }
  
  const token = authHeader.substring(7);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    return null;
  }
  
  return { userId: user.id };
}

interface ChatMessage {
  author: 'user' | 'bot';
  text: string;
}

interface ChatRequestBody {
  action: 'chat' | 'suggestion';
  message?: string;
  history?: ChatMessage[];
  isThinkingMode?: boolean;
  pillName?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const auth = await verifyAuth(req.headers.authorization);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
  }
  
  if (!checkRateLimit(auth.userId)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment before trying again.' });
  }
  
  if (!GEMINI_API_KEY) {
    return res.status(503).json({ 
      error: 'AI features are currently unavailable.',
      configured: false 
    });
  }
  
  const body = req.body as ChatRequestBody;
  
  if (!body.action || !['chat', 'suggestion'].includes(body.action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  
  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    if (body.action === 'suggestion') {
      const pillName = body.pillName?.trim();
      
      if (!pillName) {
        return res.status(400).json({ error: 'Pill name is required' });
      }
      
      if (pillName.length > MAX_PILL_NAME_LENGTH) {
        return res.status(400).json({ error: 'Pill name too long' });
      }
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: `Provide a brief, one-sentence description for the medication "${pillName}". Do not include any warnings or medical advice. Keep it under 15 words.`,
      });
      
      return res.status(200).json({ text: response.text.trim() });
    }
    
    if (body.action === 'chat') {
      const message = body.message?.trim();
      const history = body.history || [];
      const isThinkingMode = body.isThinkingMode ?? false;
      
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }
      
      if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: 'Message too long' });
      }
      
      if (history.length > MAX_HISTORY_LENGTH) {
        return res.status(400).json({ error: 'Chat history too long' });
      }
      
      for (const msg of history) {
        if (!msg.text || msg.text.length > MAX_MESSAGE_LENGTH) {
          return res.status(400).json({ error: 'Invalid chat history' });
        }
      }
      
      const model = isThinkingMode ? 'gemini-3.5-flash' : 'gemini-3.5-flash-lite';
      
      const config: {
        systemInstruction: string;
        thinkingConfig?: { thinkingBudget: number };
      } = {
        systemInstruction: "You are a helpful assistant for a pill reminder app named ChronaCare. Provide concise and clear information. Do NOT provide medical advice under any circumstances. If asked for medical advice, gently decline and firmly suggest consulting a healthcare professional. You can answer general knowledge questions about medications, but always preface with a disclaimer that you are not a medical professional."
      };
      
      if (isThinkingMode) {
        config.thinkingConfig = { thinkingBudget: 32768 };
      }
      
      const contents = history.map((msg) => ({
        role: msg.author === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }],
      }));
      contents.push({ role: 'user', parts: [{ text: message }] });
      
      const response = await ai.models.generateContent({
        model: model,
        contents: contents,
        config: config,
      });
      
      return res.status(200).json({ text: response.text.trim() });
    }
    
    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    console.error('Gemini API error:', error);
    return res.status(500).json({ error: 'Failed to process request. Please try again.' });
  }
}
