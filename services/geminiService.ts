import { ChatMessage, MessageAuthor } from "../types";
import { supabase } from "../lib/supabase";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const MAX_HISTORY_TURNS = 20;

let geminiConfiguredCache: boolean | null = null;

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

interface ApiResponse {
  text?: string;
  error?: string;
  code?: string;
}

async function callGeminiApi(body: object): Promise<ApiResponse> {
  const token = await getAuthToken();
  
  if (!token) {
    return { error: "Please sign in to use AI features.", code: 'AUTH_REQUIRED' };
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/gemini`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    
    const data = await response.json() as ApiResponse;
    
    if (!response.ok) {
      if (response.status === 503) {
        geminiConfiguredCache = false;
      }
      return { error: data.error, code: data.code };
    }
    
    geminiConfiguredCache = true;
    return data;
  } catch {
    return { error: 'Failed to connect to AI service. Please try again.', code: 'NETWORK_ERROR' };
  }
}

export const isGeminiConfigured = (): boolean => {
  return geminiConfiguredCache !== false;
};

export const getQuickSuggestion = async (pillName: string): Promise<string> => {
  if (!pillName.trim()) return "";
  
  const result = await callGeminiApi({
    action: 'suggestion',
    pillName: pillName.trim(),
  });
  
  if (result.code === 'AI_UNAVAILABLE') {
    return "AI suggestions are unavailable right now.";
  }
  
  if (result.error) {
    return "Could not fetch suggestion.";
  }
  
  return result.text || "Could not fetch suggestion.";
};

export const getChatResponse = async (
  history: ChatMessage[],
  newMessage: string,
  isThinkingMode: boolean
): Promise<string> => {
  // Send only the last MAX_HISTORY_TURNS to avoid hitting size limits
  const trimmedHistory = history.slice(-MAX_HISTORY_TURNS);
  
  const result = await callGeminiApi({
    action: 'chat',
    message: newMessage,
    history: trimmedHistory.map(msg => ({
      author: msg.author === MessageAuthor.USER ? 'user' : 'bot',
      text: msg.text,
    })),
    isThinkingMode,
  });
  
  if (result.code === 'AI_UNAVAILABLE') {
    return "AI features are unavailable right now.";
  }
  
  if (result.error) {
    return result.error;
  }
  
  return result.text || "Sorry, I encountered an error. Please try again.";
};
