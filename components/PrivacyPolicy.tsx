// components/PrivacyPolicy.tsx
import React from 'react';

const PrivacyPolicy: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 bg-sky-50 z-50 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 pb-24">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Privacy Policy</h1>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">← Back</button>
        </div>

        <p className="text-xs text-slate-400 mb-8">Last updated: March 2026 · Effective immediately</p>

        <div className="space-y-8 text-slate-700 text-sm leading-relaxed">

          <section>
            <p className="text-base">
              Remedi is a personal medication reminder app. We built it to help you stay on top of your health — and we take that responsibility seriously. This policy explains exactly what we collect, why, and what we do (and don't do) with it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">What we collect</h2>
            <p className="mb-3">When you use Remedi, we collect the following:</p>
            <ul className="space-y-2 list-none">
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span><strong>Account information</strong> — your email address when you sign up. That's it. No name, no phone number, no demographics.</span></li>
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span><strong>Medication data</strong> — the pill names, dosages, and reminder schedules you enter. This is stored so your data syncs across your devices.</span></li>
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span><strong>Usage history</strong> — whether you marked a dose as taken or snoozed a reminder. Used only to show you your own history.</span></li>
            </ul>
            <p className="mt-3 text-slate-500">We do not collect your location, contacts, payment information, or any other personal data beyond what's listed above.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">What we don't do with your data</h2>
            <ul className="space-y-2">
              <li className="flex gap-2"><span className="text-green-500">✓</span><span>We do <strong>not</strong> sell your data to anyone. Ever.</span></li>
              <li className="flex gap-2"><span className="text-green-500">✓</span><span>We do <strong>not</strong> share your medication data with advertisers, data brokers, or third parties.</span></li>
              <li className="flex gap-2"><span className="text-green-500">✓</span><span>We do <strong>not</strong> use your data to build advertising profiles.</span></li>
              <li className="flex gap-2"><span className="text-green-500">✓</span><span>We do <strong>not</strong> send your medication information to any healthcare provider, insurance company, or government entity.</span></li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">How we store and protect your data</h2>
            <p className="mb-3">
              Your data is stored on Supabase, a trusted cloud database provider. All data is encrypted at rest and in transit using industry-standard TLS encryption. Your medication data is protected by Row Level Security — meaning only you can access your own records. Not even we can read your individual medication data without your account credentials.
            </p>
            <p>
              We use Google's Gemini AI to provide real-time medication suggestions as you type. When you search for a medication, the name you type is sent to Google's AI service to generate helpful information. This is the only instance where any data leaves our own servers. Google's data handling is governed by their privacy policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">AI-generated information</h2>
            <p>
              Remedi uses AI to provide general information about medications. This information is for general reference only. It is not medical advice, not a substitute for professional medical guidance, and should not be used to make healthcare decisions. Always consult a qualified healthcare provider about your medications.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Your rights and controls</h2>
            <p className="mb-3">You are in control of your data:</p>
            <ul className="space-y-2">
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span><strong>Access:</strong> All your data is visible to you directly in the app.</span></li>
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span><strong>Edit:</strong> You can update or delete any medication entry at any time.</span></li>
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span><strong>Delete your account:</strong> Email us at support@remediapp.com and we will permanently delete your account and all associated data within 7 days.</span></li>
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span><strong>Export:</strong> Contact us to request a copy of your data in a readable format.</span></li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Children's privacy</h2>
            <p>
              Remedi is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe a child under 13 has created an account, please contact us and we will delete the account promptly.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Changes to this policy</h2>
            <p>
              If we make significant changes to this policy, we will notify you within the app before the changes take effect. Continued use of the app after that point means you accept the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Contact us</h2>
            <p>
              Questions about your privacy? We're real people and we actually respond.
            </p>
            <p className="mt-2 text-sky-600 font-medium">support@remediapp.com</p>
          </section>

        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
