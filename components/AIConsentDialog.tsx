import React from 'react';
import { createPortal } from 'react-dom';
import { SparklesIcon } from './icons/Icons';

interface AIConsentDialogProps {
  onAccept: () => void;
  onDecline: () => void;
}

const AIConsentDialog: React.FC<AIConsentDialogProps> = ({ onAccept, onDecline }) => {
  const dialogContent = (
    <div
      data-testid="ai-consent-dialog-overlay"
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4"
      style={{ zIndex: 9999 }}
    >
      <div
        data-testid="ai-consent-dialog"
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md m-auto transform transition-all duration-300 animate-fade-in-up"
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full bg-sky-100 flex items-center justify-center">
              <SparklesIcon className="w-6 h-6 text-sky-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Enable AI Features?</h2>
          </div>

          <div className="space-y-4 text-slate-600 text-sm">
            <p>
              Remedí's AI features use Google's Gemini AI to provide helpful information
              about your medications and answer your questions.
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="font-medium text-amber-800 mb-1">What data is shared with Google:</p>
              <ul className="list-disc list-inside text-amber-700 space-y-1">
                <li>Pill names you enter (for AI suggestions)</li>
                <li>Messages and conversation history in AI chat</li>
              </ul>
            </div>

            <p className="text-slate-500">
              This data is sent to Google's servers and processed according to their
              {' '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-500 underline hover:text-sky-600"
              >
                Privacy Policy
              </a>
              . Note that chat is free-form text, so avoid entering sensitive personal
              information in your messages.
            </p>

            <p className="text-slate-500">
              You can change your choice anytime using the "AI Privacy" link near the AI features.
            </p>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={onAccept}
              className="w-full bg-sky-500 text-white font-semibold py-3 px-4 rounded-lg hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-colors"
            >
              Enable AI Features
            </button>
            <button
              onClick={onDecline}
              className="w-full bg-slate-100 text-slate-600 font-semibold py-3 px-4 rounded-lg hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400 transition-colors"
            >
              No Thanks
            </button>
          </div>
        </div>
      </div>
      <style>{`
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
        .animate-fade-in-up {
          animation: fade-in-up 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );

  return createPortal(dialogContent, document.body);
};

export default AIConsentDialog;
