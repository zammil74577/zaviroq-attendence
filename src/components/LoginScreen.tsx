import React, { useEffect, useState } from 'react';
import { ShieldCheck, KeyRound, ArrowRight, User, Sparkles } from 'lucide-react';
import type { Employee } from '../types';

interface LoginScreenProps {
  onLoginSuccess: (employee: Employee) => void;
  initialNotice?: string | null;
}

interface DemoBadge {
  emp_code: string;
  name: string;
  role: string;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, initialNotice = null }) => {
  const [demoMode, setDemoMode] = useState(false);
  const [demoBadges, setDemoBadges] = useState<DemoBadge[]>([]);
  const [identifier, setIdentifier] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(initialNotice);
  const [submitting, setSubmitting] = useState(false);

  // Forced 6-digit PIN change on first login
  const [pendingUser, setPendingUser] = useState<Employee | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  useEffect(() => {
    fetch('/api/auth/config')
      .then((r) => r.json())
      .then((j) => {
        setDemoMode(Boolean(j.demoMode));
        if (Array.isArray(j.demoBadges)) setDemoBadges(j.demoBadges);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !pin.trim()) {
      setError('Please enter your Username / Employee ID and Password / PIN.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, pin, scanEntry: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Login failed');
        return;
      }
      if (json.employee?.must_change_pin === 1) {
        setPendingUser(json.employee);
        setPin('');
        return;
      }
      onLoginSuccess(json.employee);
    } catch {
      setError('Unable to reach Zaviroq server.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPin !== confirmPin) {
      setError('PINs do not match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPin }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to update PIN');
        return;
      }
      onLoginSuccess(json.employee);
    } catch {
      setError('Unable to reach Zaviroq server.');
    } finally {
      setSubmitting(false);
    }
  };

  if (pendingUser) {
    return (
      <div className="min-h-screen bg-[#060913] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="relative w-full max-w-md rounded-3xl border border-slate-800/90 bg-slate-900/90 backdrop-blur-xl p-7 shadow-2xl space-y-5">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[11px] font-semibold text-amber-300 mb-3">
              <KeyRound className="h-3.5 w-3.5" />
              First-Login Security Setup
            </div>
            <h1 className="text-xl font-bold text-white">Set Your 6-Digit Password / PIN</h1>
            <p className="text-xs text-slate-400 mt-1">
              Hi {pendingUser.name}, please set a new non-trivial 6-digit PIN (avoid repeated or sequential digits).
            </p>
          </div>
          <form onSubmit={handleChangePin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">New 6-Digit PIN</label>
              <input
                required
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="6 digits (e.g. 482915)"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white font-mono-num focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Confirm 6-Digit PIN</label>
              <input
                required
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                placeholder="Re-enter 6-digit PIN"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white font-mono-num focus:border-indigo-500 focus:outline-none"
              />
            </div>
            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-200">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 py-2.5 text-sm font-semibold text-white cursor-pointer shadow-lg shadow-indigo-950/50"
            >
              {submitting ? 'Saving PIN...' : 'Save PIN & Enter Dashboard'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#060913] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-48 left-1/4 h-[420px] w-[420px] rounded-full bg-indigo-600/15 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-48 right-1/4 h-[380px] w-[380px] rounded-full bg-cyan-500/15 blur-[120px]" />

      <div className="relative w-full max-w-md rounded-3xl border border-slate-800/90 bg-slate-900/80 backdrop-blur-2xl p-7 sm:p-8 shadow-[0_24px_80px_rgba(0,0,0,0.65)] space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-cyan-500 font-bold text-lg text-white shadow-lg shadow-indigo-500/30">
            Z
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
              ZAVIROQ WORKFORCE OS
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            </div>
            <div className="text-xs text-slate-400">Employee & Admin Portal</div>
          </div>
        </div>

        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1 text-[11px] font-semibold text-slate-300 mb-2">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Secure Sign In
          </div>
          <h1 className="text-2xl font-bold text-white">Sign In to Zaviroq</h1>
          <p className="text-xs text-slate-400 mt-1">
            Enter your Employee ID or Work Email and Password / PIN.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Username (Employee ID or Work Email)
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                required
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="e.g. ZAV-001 or name@zaviroq.com"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/90 pl-10 pr-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Password / PIN
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                required
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter your password / PIN"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/90 pl-10 pr-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none font-mono-num"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-950/60 cursor-pointer"
          >
            {submitting ? 'Signing In...' : 'Sign In & Open Dashboard'}
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        {demoMode && demoBadges.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Quick Select (Demo Mode)
            </div>
            <div className="grid grid-cols-2 gap-2">
              {demoBadges.map((b) => (
                <button
                  key={b.emp_code}
                  type="button"
                  onClick={() => setIdentifier(b.emp_code)}
                  className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 p-2 text-left cursor-pointer"
                >
                  <div className="text-xs font-bold text-indigo-300 capitalize">{b.role}</div>
                  <div className="text-[11px] text-slate-400">{b.emp_code} • {b.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
