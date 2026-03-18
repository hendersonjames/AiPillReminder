// components/TermsOfService.tsx
import React from 'react';

const TermsOfService: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 bg-sky-50 z-50 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8 pb-24">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Terms of Service</h1>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">← Back</button>
        </div>

        <p className="text-xs text-slate-400 mb-8">Last updated: March 2026 · Effective immediately</p>

        <div className="space-y-8 text-slate-700 text-sm leading-relaxed">

          <section>
            <p className="text-base">
              Welcome to Remedi. By using the app, you agree to these terms. We've written them in plain English because we think you deserve to actually understand what you're agreeing to.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">What Remedi is</h2>
            <p className="mb-3">
              Remedi is a personal medication reminder tool. It helps you track your pills, set reminders, and access general AI-generated information about medications.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="font-semibold text-amber-800 mb-1">⚕️ Not medical advice</p>
              <p className="text-amber-700">
                Remedi is not a medical device. It does not diagnose, treat, cure, or prevent any medical condition. The AI-generated information in the app is for general reference only. Always consult a qualified healthcare professional before making any decisions about your medications or health.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Your account</h2>
            <ul className="space-y-2">
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span>You must be 13 or older to create an account.</span></li>
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span>You are responsible for keeping your password secure. Don't share your account with others.</span></li>
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span>You are responsible for all activity that occurs under your account.</span></li>
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span>If you believe your account has been compromised, contact us immediately at support@remediapp.com.</span></li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">What you can and can't do</h2>
            <p className="mb-3">You can:</p>
            <ul className="space-y-1 mb-4">
              <li className="flex gap-2"><span className="text-green-500">✓</span><span>Use Remedi for personal medication tracking</span></li>
              <li className="flex gap-2"><span className="text-green-500">✓</span><span>Set reminders for yourself or family members in your care</span></li>
              <li className="flex gap-2"><span className="text-green-500">✓</span><span>Access your data and delete it at any time</span></li>
            </ul>
            <p className="mb-3">You cannot:</p>
            <ul className="space-y-1">
              <li className="flex gap-2"><span className="text-red-400">✗</span><span>Use Remedi to provide medical services to others commercially</span></li>
              <li className="flex gap-2"><span className="text-red-400">✗</span><span>Attempt to reverse engineer, hack, or disrupt the app or its infrastructure</span></li>
              <li className="flex gap-2"><span className="text-red-400">✗</span><span>Use the app in any way that violates applicable laws</span></li>
              <li className="flex gap-2"><span className="text-red-400">✗</span><span>Create multiple accounts to circumvent account restrictions</span></li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Your data</h2>
            <p>
              Your medication data belongs to you. We store it to make the app work, but we don't claim ownership of it. You can request a copy or deletion of your data at any time. See our <strong>Privacy Policy</strong> for full details on how we handle your data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Service availability</h2>
            <p>
              We work hard to keep Remedi available and working well, but we can't guarantee it will be available 100% of the time. We may occasionally update, modify, or temporarily suspend the app for maintenance. We'll try to give advance notice for planned downtime.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Limitation of liability</h2>
            <p className="mb-3">
              Remedi is provided "as is." To the maximum extent permitted by law:
            </p>
            <ul className="space-y-2">
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span>We are not liable for any missed doses, medication errors, or health outcomes resulting from your use of the app.</span></li>
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span>We are not liable for any inaccuracies in AI-generated medication information.</span></li>
              <li className="flex gap-2"><span className="text-sky-500 font-bold">•</span><span>Our total liability to you for any claim arising from use of the app will not exceed the amount you paid us in the past 12 months (if anything).</span></li>
            </ul>
            <p className="mt-3 text-slate-500 text-xs">
              Nothing in these terms limits our liability for fraud, death, or personal injury caused by our negligence, or any other liability that cannot be limited by law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Termination</h2>
            <p className="mb-2">
              <strong>You can stop using Remedi at any time.</strong> Just stop using the app, or contact us to delete your account permanently.
            </p>
            <p>
              We reserve the right to suspend or terminate accounts that violate these terms. If we do, we'll tell you why (unless prohibited by law) and give you an opportunity to retrieve your data.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Changes to these terms</h2>
            <p>
              If we make material changes to these terms, we'll notify you in the app at least 14 days before they take effect. If you disagree with the changes, you can delete your account before they take effect.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Governing law</h2>
            <p>
              These terms are governed by the laws of the United States. Any disputes will be resolved in the courts of the United States.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Contact us</h2>
            <p>Questions? Something unclear? We're here.</p>
            <p className="mt-2 text-sky-600 font-medium">support@remediapp.com</p>
          </section>

        </div>
      </div>
    </div>
  );
};

export default TermsOfService;
