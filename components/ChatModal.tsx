import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, MessageAuthor } from '../types';
import { getChatResponse } from '../services/geminiService';
import { CloseIcon, SendIcon, UserIcon, BotIcon, BrainIcon } from './icons/Icons';

interface ChatModalProps {
  onClose: () => void;
}

const ChatModal: React.FC<ChatModalProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { author: MessageAuthor.BOT, text: "Hello! I'm ChronaCare's AI assistant. How can I help you today? Remember, I'm not a doctor, so please consult a healthcare professional for medical advice." }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isThinkingMode, setThinkingMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = { author: MessageAuthor.USER, text: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const responseText = await getChatResponse(messages, input, isThinkingMode);

    const botMessage: ChatMessage = { author: MessageAuthor.BOT, text: responseText };
    setMessages(prev => [...prev, botMessage]);
    setIsLoading(false);
  };
  
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };


  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex flex-col items-center justify-end z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl h-full sm:h-[90vh] flex flex-col transform transition-all duration-300 animate-fade-in-up">
        <header className="p-4 border-b border-slate-200 flex justify-between items-center flex-shrink-0">
          <div className="flex items-center">
            <h2 className="text-xl font-bold text-slate-800">AI Assistant</h2>
            <div className="ml-4 flex items-center space-x-2">
              <label htmlFor="thinking-mode" className={`text-sm font-medium transition-colors ${isThinkingMode ? 'text-sky-600' : 'text-slate-500'}`}>
                Thinking Mode
              </label>
              <button 
                onClick={() => setThinkingMode(!isThinkingMode)}
                role="switch"
                aria-checked={isThinkingMode}
                className={`${
                  isThinkingMode ? 'bg-sky-500' : 'bg-slate-300'
                } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2`}
              >
                <BrainIcon className={`h-4 w-4 text-white absolute left-1 transition-opacity ${isThinkingMode ? 'opacity-100' : 'opacity-0'}`} />
                <span
                  className={`${
                    isThinkingMode ? 'translate-x-6' : 'translate-x-1'
                  } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                />
              </button>
            </div>
          </div>
          <div className="relative group">
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-full" aria-label="Close chat">
                <CloseIcon className="w-6 h-6" />
            </button>
            <span className="absolute top-full right-0 mt-2 px-2 py-1 text-xs font-semibold text-white bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                Close
            </span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, index) => (
            <div key={index} className={`flex items-start gap-3 ${msg.author === MessageAuthor.USER ? 'justify-end' : ''}`}>
              {msg.author === MessageAuthor.BOT && (
                <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
                  <BotIcon className="w-5 h-5 text-white" />
                </div>
              )}
              <div className={`max-w-xs md:max-w-md px-4 py-2 rounded-2xl ${
                  msg.author === MessageAuthor.USER
                    ? 'bg-slate-800 text-white rounded-br-none'
                    : 'bg-slate-100 text-slate-800 rounded-bl-none'
                }`}>
                <p className="whitespace-pre-wrap">{msg.text}</p>
              </div>
              {msg.author === MessageAuthor.USER && (
                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                  <UserIcon className="w-5 h-5 text-slate-600" />
                </div>
              )}
            </div>
          ))}
          {isLoading && (
             <div className="flex items-start gap-3">
               <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
                  <BotIcon className="w-5 h-5 text-white" />
                </div>
               <div className="px-4 py-3 rounded-2xl bg-slate-100 rounded-bl-none">
                  <div className="flex items-center justify-center space-x-1">
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse"></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse [animation-delay:0.2s]"></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-pulse [animation-delay:0.4s]"></div>
                  </div>
               </div>
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <footer className="p-4 border-t border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask a question..."
              className="w-full px-4 py-2 border border-slate-300 rounded-full focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              disabled={isLoading}
            />
            <div className="relative group">
                <button
                  onClick={handleSend}
                  disabled={isLoading || !input.trim()}
                  className="bg-sky-500 text-white rounded-full p-3 shadow-sm hover:bg-sky-600 disabled:bg-slate-300 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-colors"
                  aria-label="Send message"
                >
                  <SendIcon className="w-5 h-5" />
                </button>
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs font-semibold text-white bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                    Send
                </span>
            </div>
          </div>
        </footer>
      </div>
      <style>{`
        @keyframes fade-in-up {
            0% {
              opacity: 0;
              transform: translateY(100%);
            }
            100% {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @media (min-width: 640px) {
            @keyframes fade-in-up {
                0% {
                    opacity: 0;
                    transform: translateY(20px) scale(0.95);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
          }
          .animate-fade-in-up {
            animation: fade-in-up 0.3s ease-out forwards;
          }
        `}</style>
    </div>
  );
};

export default ChatModal;
