import React, { useEffect, useMemo } from 'react';
import { Gift, Sparkles, Cake, Award, Palmtree, BellRing, X } from 'lucide-react';

export type CelebrationKind =
  | 'gift'
  | 'appreciation'
  | 'birthday'
  | 'festival'
  | 'leave_granted'
  | 'announcement';

export interface CelebrationPayload {
  id: string;
  kind: CelebrationKind;
  title: string;
  message: string;
  sender?: string;
  dropItems?: boolean;
}

export function parseCelebrationAnnouncement(ann: {
  id: number;
  title: string;
  message: string;
  author_name?: string;
}): CelebrationPayload {
  const rawTitle = ann.title || '';
  const upper = rawTitle.toUpperCase();
  let kind: CelebrationKind = 'announcement';
  let cleanTitle = rawTitle;

  if (upper.startsWith('[GIFT]')) {
    kind = 'gift';
    cleanTitle = rawTitle.replace(/^\[GIFT\]\s*/i, '');
  } else if (upper.startsWith('[APPRECIATION]')) {
    kind = 'appreciation';
    cleanTitle = rawTitle.replace(/^\[APPRECIATION\]\s*/i, '');
  } else if (upper.startsWith('[BIRTHDAY]') || upper.includes('BIRTHDAY')) {
    kind = 'birthday';
    cleanTitle = rawTitle.replace(/^\[BIRTHDAY\]\s*/i, '');
  } else if (upper.startsWith('[FESTIVAL]') || upper.includes('FESTIVAL') || upper.includes('DIWALI') || upper.includes('HOLI') || upper.includes('EID') || upper.includes('CHRISTMAS')) {
    kind = 'festival';
    cleanTitle = rawTitle.replace(/^\[FESTIVAL\]\s*/i, '');
  } else if (upper.startsWith('[LEAVE_GRANTED]')) {
    kind = 'leave_granted';
    cleanTitle = rawTitle.replace(/^\[LEAVE_GRANTED\]\s*/i, '');
  }

  return {
    id: `ann-${ann.id}`,
    kind,
    title: cleanTitle || 'Admin Update',
    message: ann.message,
    sender: ann.author_name || 'Admin',
    dropItems: kind !== 'announcement',
  };
}

const PARTICLE_SETS: Record<CelebrationKind, string[]> = {
  gift: ['🎁', '🎀', '✨', '💜', '🎊', '🎁'],
  appreciation: ['🏆', '⭐', '👏', '✨', '💎', '🎉'],
  birthday: ['🎂', '🎈', '🎁', '🎉', '✨', '🥳'],
  festival: ['🪔', '✨', '🎊', '🌸', '🎁', '🎆'],
  leave_granted: ['🌴', '✈️', '🎉', '☀️', '✨', '🎁'],
  announcement: ['✨', '💜', '📢'],
};

const KIND_META: Record<
  CelebrationKind,
  { badge: string; gradient: string; chipBg: string; icon: React.ReactNode }
> = {
  gift: {
    badge: 'Gift Drop',
    gradient: 'from-[#6D4AFF] to-[#EC4899]',
    chipBg: 'bg-gradient-to-br from-[#FDE8F1] to-[#EFEAFF] text-[#DB2777]',
    icon: <Gift className="h-5 w-5" strokeWidth={1.9} />,
  },
  appreciation: {
    badge: 'Team Appreciation',
    gradient: 'from-[#F59E0B] to-[#EA580C]',
    chipBg: 'bg-gradient-to-br from-[#FFF4E0] to-[#FFEDE3] text-[#D97706]',
    icon: <Award className="h-5 w-5" strokeWidth={1.9} />,
  },
  birthday: {
    badge: 'Birthday Wishes',
    gradient: 'from-[#EC4899] to-[#8B5CF6]',
    chipBg: 'bg-gradient-to-br from-[#FDE8F1] to-[#EFEAFF] text-[#DB2777]',
    icon: <Cake className="h-5 w-5" strokeWidth={1.9} />,
  },
  festival: {
    badge: 'Festival Celebration',
    gradient: 'from-[#EA580C] to-[#F59E0B]',
    chipBg: 'bg-gradient-to-br from-[#FFF4E0] to-[#FFEDE3] text-[#EA580C]',
    icon: <Sparkles className="h-5 w-5" strokeWidth={1.9} />,
  },
  leave_granted: {
    badge: 'Leave Approved',
    gradient: 'from-[#16A34A] to-[#0D9488]',
    chipBg: 'bg-gradient-to-br from-[#E8F8EE] to-[#CCFBF1] text-[#16A34A]',
    icon: <Palmtree className="h-5 w-5" strokeWidth={1.9} />,
  },
  announcement: {
    badge: 'Admin Broadcast',
    gradient: 'from-[#6D4AFF] to-[#8B5CF6]',
    chipBg: 'bg-gradient-to-br from-[#EFEAFF] to-[#E8F0FF] text-[#6D4AFF]',
    icon: <BellRing className="h-5 w-5" strokeWidth={1.9} />,
  },
};

export const CelebrationOverlay: React.FC<{
  celebration: CelebrationPayload | null;
  onDismiss: () => void;
}> = ({ celebration, onDismiss }) => {
  useEffect(() => {
    if (!celebration) return;
    const t = window.setTimeout(onDismiss, 9000);
    return () => window.clearTimeout(t);
  }, [celebration, onDismiss]);

  const particles = useMemo(() => {
    if (!celebration || !celebration.dropItems) return [];
    const glyphs = PARTICLE_SETS[celebration.kind] || PARTICLE_SETS.gift;
    return Array.from({ length: 30 }).map((_, i) => ({
      id: `${celebration.id}-${i}`,
      glyph: glyphs[i % glyphs.length],
      left: `${3 + ((i * 37) % 94)}%`,
      dur: `${3.0 + ((i * 19) % 24) / 10}s`,
      delay: `${((i * 11) % 16) / 10}s`,
      drift: `${((i % 2 === 0 ? 1 : -1) * (15 + ((i * 13) % 45)))}px`,
      rot: `${(i % 2 === 0 ? 1 : -1) * (180 + ((i * 29) % 220))}deg`,
      size: `${20 + (i % 4) * 5}px`,
    }));
  }, [celebration]);

  if (!celebration) return null;
  const meta = KIND_META[celebration.kind] || KIND_META.announcement;

  return (
    <>
      {/* Falling Gifts / Appreciation / Confetti Rain */}
      {particles.length > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
        >
          {particles.map((p) => (
            <span
              key={p.id}
              className="zv-fall-item absolute top-0 select-none drop-shadow-md"
              style={
                {
                  left: p.left,
                  fontSize: p.size,
                  '--zv-dur': p.dur,
                  '--zv-delay': p.delay,
                  '--zv-drift': p.drift,
                  '--zv-rot': p.rot,
                } as React.CSSProperties
              }
            >
              {p.glyph}
            </span>
          ))}
        </div>
      )}

      {/* Admin / Celebration Glassmorphic Popup */}
      <div className="fixed top-20 right-4 sm:right-6 z-[75] w-[360px] max-w-[calc(100vw-2rem)] zv-enter">
        <div className="zv-card relative overflow-hidden p-4 shadow-[0_20px_50px_rgba(91,72,180,0.22)]">
          <div className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${meta.gradient}`} />
          <div className="flex items-start gap-3.5 pt-1">
            <div className={`zv-icon-chip h-11 w-11 rounded-2xl ${meta.chipBg} flex items-center justify-center shrink-0`}>
              {meta.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-[#EFEAFF] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#6D4AFF]">
                  {meta.badge}
                </span>
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Close notification popup"
                  className="rounded-lg p-1 text-[var(--zv-muted)] hover:text-[var(--zv-text)] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1.5 text-sm font-bold font-heading text-[var(--zv-text)]">
                {celebration.title}
              </div>
              <p className="mt-0.5 text-xs text-[var(--zv-text-secondary)] leading-relaxed">
                {celebration.message}
              </p>
              {celebration.sender && (
                <div className="mt-2 text-[11px] font-medium text-[var(--zv-muted)]">
                  From <span className="text-[var(--zv-text)] font-semibold">{celebration.sender}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
