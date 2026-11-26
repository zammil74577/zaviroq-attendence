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
      <div className="min-h-screen bg-gradient-to-b from-[#F7F5FF] to-white text-[#1A1635] flex items-center justify-center p-4 relative overflow-hidden">
        <div className="relative w-full max-w-md rounded-[24px] border border-[#ECE9F7] bg-white p-7 shadow-[0_16px_48px_rgba(91,72,180,0.12)] space-y-5">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#FDE68A] bg-[#FFF4E0] px-3 py-1 text-[11px] font-semibold text-[#D97706] mb-3">
              <KeyRound className="h-3.5 w-3.5" />
              First-Login Security Setup
            </div>
            <h1 className="text-xl font-bold font-heading text-[#1A1635]">Set Your 6-Digit Password / PIN</h1>
            <p className="text-xs text-[#6B6785] mt-1">
              Hi {pendingUser.name}, please set a new non-trivial 6-digit PIN (avoid repeated or sequential digits).
            </p>
          </div>
          <form onSubmit={handleChangePin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#4B4668] mb-1">New 6-Digit PIN</label>
              <input
                required
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="6 digits (e.g. 482915)"
                className="w-full rounded-xl border border-[#DDD6FE] bg-white px-3.5 py-2.5 text-sm text-[#1A1635] font-mono-num focus:border-[#6D4AFF] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#4B4668] mb-1">Confirm 6-Digit PIN</label>
              <input
                required
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                placeholder="Re-enter 6-digit PIN"
                className="w-full rounded-xl border border-[#DDD6FE] bg-white px-3.5 py-2.5 text-sm text-[#1A1635] font-mono-num focus:border-[#6D4AFF] focus:outline-none"
              />
            </div>
            {error && (
              <div className="rounded-xl border border-[#FECACA] bg-[#FDECEC] px-3.5 py-2.5 text-xs text-[#DC2626] font-medium">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl zv-btn-primary py-2.5 text-sm font-semibold text-white cursor-pointer"
            >
              {submitting ? 'Saving PIN...' : 'Save PIN & Enter Dashboard'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F7F5FF] via-white to-[#EFEAFF] text-[#1A1635] flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 rounded-[28px] border border-[#ECE9F7] bg-white shadow-[0_24px_64px_rgba(91,72,180,0.12)] overflow-hidden">
        {/* Left: Lavender Brand & Hero Panel */}
        <div className="hidden lg:flex flex-col justify-between bg-gradient-to-br from-[#EFEAFF] via-[#F7F5FF] to-[#E9E3FF] p-8 relative overflow-hidden border-r border-[#ECE9F7]">
          <div className="relative z-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6D4AFF] to-[#8B5CF6] font-extrabold text-lg text-white shadow-lg shadow-violet-500/30 zv-text-white-keep">
              Z
            </div>
            <div>
              <div className="text-base font-extrabold tracking-tight font-heading text-[#1A1635] flex items-center gap-1.5">
                ZAVIROQ WORKFORCE OS
                <Sparkles className="h-3.5 w-3.5 text-[#6D4AFF]" />
              </div>
              <div className="text-xs text-[#6B6785]">Employee &amp; Operations Portal</div>
            </div>
          </div>

          <div className="relative z-10 my-6 space-y-3">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#DDD6FE] bg-white/80 px-3 py-1 text-[11px] font-semibold text-[#6D4AFF]">
              <ShieldCheck className="h-3.5 w-3.5 text-[#16A34A]" />
              Workforce Telemetry &amp; Payroll
            </div>
            <h2 className="text-3xl font-extrabold font-heading leading-tight text-[#1A1635]">
              Your Workforce at a Glance.
            </h2>
            <p className="text-sm text-[#4B4668] leading-relaxed">
              Track attendance, productivity, leaves, tasks, and team activity — all in one calm, airy workspace.
            </p>
          </div>

          <div className="relative z-10 rounded-2xl overflow-hidden border border-[#DDD6FE] shadow-md">
            <img
              src="/hero-office.webp"
              alt="Zaviroq modern office"
              className="w-full h-36 object-cover"
              loading="lazy"
            />
          </div>
        </div>

        {/* Right: White Card Sign-In Form */}
        <div className="p-7 sm:p-10 flex flex-col justify-center space-y-6 bg-white">
          <div className="flex lg:hidden items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#6D4AFF] to-[#8B5CF6] font-extrabold text-base text-white shadow-md zv-text-white-keep">
              Z
            </div>
            <div>
              <div className="text-sm font-extrabold font-heading text-[#1A1635]">ZAVIROQ WORKFORCE OS</div>
              <div className="text-[11px] text-[#6B6785]">Employee &amp; Admin Portal</div>
            </div>
          </div>

          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#ECE9F7] bg-[#FAF8FF] px-3 py-1 text-[11px] font-semibold text-[#4B4668] mb-2">
              <ShieldCheck className="h-3.5 w-3.5 text-[#16A34A]" />
              Secure Sign In
            </div>
            <h1 className="text-2xl font-extrabold font-heading text-[#1A1635]">Sign In to Zaviroq</h1>
            <p className="text-xs text-[#6B6785] mt-1">
              Enter your Employee ID or Work Email and Password / PIN.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#4B4668] mb-1">
                Username (Employee ID or Work Email)
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B6785]" />
                <input
                  required
                  autoFocus
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="e.g. ZAV-001 or name@zaviroq.com"
                  className="w-full rounded-xl border border-[#DDD6FE] bg-white pl-10 pr-3.5 py-2.5 text-sm text-[#1A1635] placeholder:text-[#8C87A6] focus:border-[#6D4AFF] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#4B4668] mb-1">
                Password / PIN
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#6B6785]" />
                <input
                  required
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter your password / PIN"
                  className="w-full rounded-xl border border-[#DDD6FE] bg-white pl-10 pr-3.5 py-2.5 text-sm text-[#1A1635] placeholder:text-[#8C87A6] focus:border-[#6D4AFF] focus:outline-none font-mono-num"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-[#FECACA] bg-[#FDECEC] px-3.5 py-2.5 text-xs text-[#DC2626] font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl zv-btn-primary disabled:opacity-50 py-2.5 text-sm font-semibold text-white cursor-pointer"
            >
              {submitting ? 'Signing In...' : 'Sign In & Open Dashboard'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {demoMode && demoBadges.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-[#ECE9F7]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#6B6785]">
                Quick Select (Demo Mode)
              </div>
              <div className="grid grid-cols-2 gap-2">
                {demoBadges.map((b) => (
                  <button
                    key={b.emp_code}
                    type="button"
                    onClick={() => setIdentifier(b.emp_code)}
                    className="rounded-xl border border-[#DDD6FE] bg-[#EFEAFF] hover:bg-[#E4DCFF] p-2 text-left cursor-pointer transition-colors"
                  >
                    <div className="text-xs font-bold text-[#6D4AFF] capitalize">{b.role}</div>
                    <div className="text-[11px] text-[#4B4668]">{b.emp_code} &bull; {b.name}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
