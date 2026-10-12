// components/ResetPassword.tsx
import React, { useState } from 'react';
import { updatePassword, signOut } from '../services/authService';

interface ResetPasswordProps {
  onComplete: () => void;
}

const ResetPassword: React.FC<ResetPasswordProps> = ({ onComplete }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      await updatePassword(password);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    await signOut();
    onComplete();
  };

  return (
    <div className="min-h-screen bg-sky-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black text-sky-600 mb-2">💊 ChronaCare</h1>
          <p className="text-slate-500 text-sm">Your AI-powered medication companion</p>
        </div>

        <div className="bg-white rounded-2xl p-8 border border-sky-100 shadow-xl">
          {success ? (
            <>
              <div className="text-center">
                <div className="text-5xl mb-4">✅</div>
                <h2 className="text-xl font-bold text-slate-800 mb-2">Password Updated!</h2>
                <p className="text-slate-500 text-sm mb-6">
                  Your password has been successfully changed. You can now sign in with your new password.
                </p>
                <button
                  onClick={handleContinue}
                  className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 rounded-lg transition-colors"
                >
                  Continue to Sign In
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-slate-800 mb-2">Set your new password</h2>
              <p className="text-slate-500 text-sm mb-6">
                Please enter your new password below. Make sure it's at least 6 characters long.
              </p>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">New Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="••••••••"
                    className="w-full border border-slate-300 text-slate-800 rounded-lg p-3 focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="••••••••"
                    className="w-full border border-slate-300 text-slate-800 rounded-lg p-3 focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? 'Please wait...' : 'Update Password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
