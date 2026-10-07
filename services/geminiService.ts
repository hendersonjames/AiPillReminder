import { GoogleGenAI } from "@google/genai";
import { ChatMessage, MessageAuthor } from "../types";

const API_KEY = import.meta.env.GEMINI_API_KEY;

let ai: GoogleGenAI | null = null;

const getAI = (): GoogleGenAI | null => {
  if (!API_KEY) return null;
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: API_KEY });
  }
  return ai;
};

export const isGeminiConfigured = (): boolean => Boolean(API_KEY);

export const getQuickSuggestion = async (pillName: string): Promise<string> => {
  if (!pillName.trim()) return "";
  
  const client = getAI();
  if (!client) {
    return "AI suggestions unavailable (API key not configured)";
  }
  
  try {
    const response = await client.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: `Provide a brief, one-sentence description for the medication "${pillName}". Do not include any warnings or medical advice. Keep it under 15 words.`,
    });
    return response.text.trim();
  } catch (error) {
    console.error("Error fetching quick suggestion:", error);
    return "Could not fetch suggestion.";
  }
};

export const getChatResponse = async (
  history: ChatMessage[],
  newMessage: string,
  isThinkingMode: boolean
): Promise<string> => {
  const client = getAI();
  if (!client) {
    return "AI chat is unavailable. Please configure the GEMINI_API_KEY environment variable to enable AI features.";
  }
  
  try {
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
      role: msg.author === MessageAuthor.USER ? 'user' : 'model',
      parts: [{ text: msg.text }],
    }));
    contents.push({ role: 'user', parts: [{ text: newMessage }] });

    const response = await client.models.generateContent({
        model: model,
        contents: contents,
        config: config,
    });
    
    return response.text.trim();
  } catch (error) {
    console.error("Error fetching chat response:", error);
    return "Sorry, I encountered an error. Please try again.";
  }
};