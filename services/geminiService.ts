import { ChatMessage, MessageAuthor } from "../types";
import { supabase } from "../lib/supabase";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

let geminiConfiguredCache: boolean | null = null;

async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

async function callGeminiApi(body: object): Promise<{ text?: string; error?: string; configured?: boolean }> {
  const token = await getAuthToken();
  
  if (!token) {
    return { error: "Please sign in to use AI features." };
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
    
    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 503 && data.configured === false) {
        geminiConfiguredCache = false;
      }
      return { error: data.error || 'Failed to get AI response' };
    }
    
    geminiConfiguredCache = true;
    return data;
  } catch (error) {
    console.error('API call error:', error);
    return { error: 'Failed to connect to AI service. Please try again.' };
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
  
  if (result.error) {
    if (result.error.includes('unavailable')) {
      return "AI suggestions unavailable (API key not configured)";
    }
    return "Could not fetch suggestion.";
  }
  
  return result.text || "Could not fetch suggestion.";
};

export const getChatResponse = async (
  history: ChatMessage[],
  newMessage: string,
  isThinkingMode: boolean
): Promise<string> => {
  const result = await callGeminiApi({
    action: 'chat',
    message: newMessage,
    history: history.map(msg => ({
      author: msg.author === MessageAuthor.USER ? 'user' : 'bot',
      text: msg.text,
    })),
    isThinkingMode,
  });
  
  if (result.error) {
    if (result.error.includes('unavailable')) {
      return "AI chat is unavailable. Please configure the GEMINI_API_KEY environment variable to enable AI features.";
    }
    return result.error;
  }
  
  return result.text || "Sorry, I encountered an error. Please try again.";
};
