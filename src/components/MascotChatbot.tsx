import React, { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, X, CheckCircle2 } from 'lucide-react';
import type { ChatMessage, Employee, Task } from '../types';
import { calcProductivity, formatClockTime, formatHM } from '../utils/format';

interface MascotChatbotProps {
  currentUser: Employee | null;
  tasks: Task[];
  liveState: 'active' | 'idle' | 'break';
  todayDate: string;
}

type MascotMood = 'happy' | 'angry' | 'sleepy' | 'break' | 'curious';

export const MascotChatbot: React.FC<MascotChatbotProps> = ({
  currentUser,
  tasks,
  liveState,
  todayDate,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [bubbleDismissed, setBubbleDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('zavi_bubble_dismissed') === '1';
    } catch {
      return false;
    }
  });
  const dismissBubble = (e: React.MouseEvent) => {
    e.stopPropagation();
    setBubbleDismissed(true);
    try {
      localStorage.setItem('zavi_bubble_dismissed', '1');
    } catch {
      // ignore
    }
  };
  const [moodOverride, setMoodOverride] = useState<'auto' | MascotMood>('auto');
  const [isCurious, setIsCurious] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const curiousTimerRef = useRef<number | null>(null);

  const triggerCuriosity = () => {
    setIsCurious(true);
    if (curiousTimerRef.current) window.clearTimeout(curiousTimerRef.current);
    curiousTimerRef.current = window.setTimeout(() => {
      setIsCurious(false);
    }, 6000);
  };

  const userId = currentUser?.id || 1;
  const firstName = currentUser?.name.split(' ')[0] || 'champ';
  const myTasks = tasks.filter((t) => t.assignee_id === userId);
  const myPending = myTasks.filter((t) => t.status !== 'completed');
  const myOverdue = myPending.filter((t) => t.due_date < todayDate);
  const productivity = currentUser
    ? calcProductivity(currentUser.active_seconds, currentUser.idle_seconds)
    : 100;

  let autoMood: MascotMood = 'happy';
  if (liveState === 'break') {
    autoMood = 'break';
  } else if (liveState === 'idle') {
    autoMood = 'sleepy';
  } else if (myOverdue.length > 0 || (productivity !== null && productivity < 70)) {
    autoMood = 'angry';
  } else {
    autoMood = 'happy';
  }

  const baseMood: MascotMood = moodOverride === 'auto' ? autoMood : moodOverride;
  const mood: MascotMood = isCurious ? 'curious' : baseMood;

  const moodMessages: Record<MascotMood, string> = {
    happy: `Awesome focus, ${firstName}! ${myPending.length} task(s) left — dancing on your dashboard!`,
    angry: `Hey ${firstName}! ${myOverdue.length > 0 ? `${myOverdue.length} overdue task(s)` : 'Low focus'}! Lock in & finish your tasks now!`,
    sleepy: `You're idle, so I'm laying on my bed... Wake up & complete your ${myPending.length} task(s)!`,
    break: `Chai break time! Sipping hot masala chai — recharge & come back fresh!`,
    curious: `Ooh, you messaged me! I'm wide awake and listening — what can I help you with, ${firstName}?`,
  };
  const moodBubble = moodMessages[mood];

  const loadBotChat = async () => {
    const res = await fetch(`/api/chat/messages?userId=${userId}&peerId=0`);
    if (res.ok) setMessages(await res.json());
  };

  useEffect(() => {
    if (isOpen) loadBotChat();
  }, [isOpen, userId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, isOpen]);

  const sendToBot = async (textOverride?: string) => {
    const text = (textOverride ?? draft).trim();
    if (!text || sending) return;
    triggerCuriosity();
    setSending(true);
    if (!textOverride) setDraft('');
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender_id: userId, recipient_id: 0, message: text }),
      });
      if (res.ok) await loadBotChat();
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`fixed z-40 flex flex-col items-start gap-2 ${
        isOpen
          ? 'bottom-4 left-4 lg:left-[276px]'
          : 'bottom-4 left-4 lg:bottom-[108px] lg:left-4'
      }`}
    >
      {/* Expanded Floating Chatbot Window with Zavi OUTSIDE & ABOVE on the Top Border */}
      {isOpen && (
        <div className="relative mt-24 w-[360px] max-w-[calc(100vw-2rem)]">
          {/* Zavi Character OUTSIDE the chatbot layer, walking/climbing/dancing ON TOP of the border */}
          <div
            className={`pointer-events-none absolute -top-[82px] z-20 ${
              mood === 'happy'
                ? 'animate-zavi-walk'
                : mood === 'curious'
                ? 'left-1/2 -translate-x-1/2 animate-zavi-curious'
                : mood === 'angry'
                ? 'left-10 animate-zavi-shake'
                : mood === 'sleepy'
                ? 'left-6'
                : 'right-8'
            }`}
          >
            <ZaviCharacterStage mood={mood} size="lg" />
          </div>

          {/* Side-climbing mini peek on right border when Happy */}
          {mood === 'happy' && (
            <div className="pointer-events-none absolute -right-4 top-28 z-20 hidden sm:block animate-zavi-climb">
              <span className="text-base drop-shadow">✨</span>
            </div>
          )}

          {/* Chatbot Card */}
          <div className="h-[460px] rounded-2xl border border-purple-500/40 bg-slate-900/95 backdrop-blur-md shadow-2xl shadow-indigo-950/80 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 border-b border-slate-800 px-3.5 py-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="h-4 w-4 text-purple-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white">Zavi Coach</div>
                  <div className="text-[11px] text-emerald-300 truncate">
                    {productivity}% focus • {myPending.length} pending
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                aria-label="Close Zavi Chatbot"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Mood Previewer */}
            <div className="bg-slate-950/80 border-b border-slate-800 px-3 py-1.5 flex items-center gap-1 overflow-x-auto">
              {(
                [
                  ['auto', 'Auto'],
                  ['happy', 'Happy / Dance'],
                  ['angry', 'Angry'],
                  ['sleepy', 'Bed'],
                  ['break', 'Chai'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setMoodOverride(key)}
                  className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                    moodOverride === key
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Live Encouragement Banner */}
            <div
              className={`border-b px-3.5 py-2 text-xs flex items-start gap-2 ${
                mood === 'angry'
                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-200'
                  : mood === 'sleepy'
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
                  : mood === 'break'
                  ? 'bg-sky-500/15 border-sky-500/30 text-sky-200'
                  : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-200'
              }`}
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-white">Zavi: </span>
                {moodBubble}
                {currentUser && (
                  <div className="mt-0.5 text-[10px] text-slate-400 font-mono-num">
                    Active: {formatHM(currentUser.active_seconds)} • Idle: {formatHM(currentUser.idle_seconds)}
                  </div>
                )}
              </div>
            </div>

            {/* Chat Thread */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {messages.map((m) => {
                const isMine = m.sender_id === userId;
                return (
                  <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs whitespace-pre-line ${
                        isMine
                          ? 'bg-indigo-600 text-white rounded-br-sm'
                          : 'border border-slate-700 bg-slate-950/90 text-slate-100 rounded-bl-sm'
                      }`}
                    >
                      <div className="leading-relaxed">{m.message}</div>
                      <div className={`mt-1 text-[9px] text-right ${isMine ? 'text-indigo-200' : 'text-slate-500'}`}>
                        {formatClockTime(m.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Chips */}
            <div className="px-3 py-1.5 border-t border-slate-800/80 bg-slate-950/50 flex flex-wrap gap-1">
              {['Show pending tasks', 'Motivate me!', 'Office timings & breaks'].map((q) => (
                <button
                  key={q}
                  onClick={() => sendToBot(q)}
                  className="rounded-full border border-slate-700 bg-slate-800/80 hover:bg-indigo-600/30 px-2 py-0.5 text-[10px] text-slate-200 cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendToBot();
              }}
              className="border-t border-slate-800 p-2.5 bg-slate-950 flex items-center gap-2"
            >
              <input
                value={draft}
                onFocus={triggerCuriosity}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (!isCurious) triggerCuriosity();
                }}
                placeholder="Chat with Zavi..."
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || !draft.trim()}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 p-2 text-white cursor-pointer"
                aria-label="Send message to Zavi"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Closed State: Bottom-Left Sidebar Slot (Desktop) / Corner (Mobile) */}
      {!isOpen && (
        <div className="flex items-end gap-2 lg:max-w-[228px]">
          <button
            onClick={() => setIsOpen(true)}
            className="relative bg-transparent border-0 p-0 hover:scale-105 transition-transform cursor-pointer focus:outline-none shrink-0"
            aria-label="Toggle Zavi Mascot Chatbot"
            title="Click to chat with Zavi"
          >
            <ZaviCharacterStage mood={mood} size="md" />
            {myPending.length > 0 && (
              <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-[#6D4AFF] text-white text-[10px] font-bold flex items-center justify-center border-2 border-white font-mono-num shadow zv-text-white-keep">
                {myPending.length}
              </span>
            )}
          </button>
          {!bubbleDismissed && (
            <div className="hidden sm:flex items-start gap-1.5 max-w-[156px] rounded-2xl border border-[var(--zv-border)] bg-[var(--zv-surface)] px-2.5 py-2 shadow-[0_8px_24px_rgba(91,72,180,0.12)] text-[11px] text-[var(--zv-text)] mb-1">
              <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="text-left leading-snug cursor-pointer"
              >
                <span className="font-bold text-[#6D4AFF]">Need help?</span>{' '}
                <span className="text-[var(--zv-text-secondary)]">I&apos;m Zavi, your workforce assistant. 👋</span>
              </button>
              <button
                type="button"
                onClick={dismissBubble}
                aria-label="Dismiss Zavi greeting"
                className="text-[var(--zv-muted)] hover:text-[var(--zv-text)] p-0.5 cursor-pointer shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* Transparent-BG Big Zavi Character Stage with Walking/Dancing/Climbing, Bed, Chai & Angry Props */
const ZaviCharacterStage: React.FC<{ mood: MascotMood; size?: 'md' | 'lg' }> = ({ mood, size = 'lg' }) => {
  const imgClass = size === 'lg' ? 'w-24 h-24' : 'w-14 h-14';

  if (mood === 'sleepy') {
    return (
      <div className="relative w-32 h-20 flex items-end justify-center">
        <span className="absolute top-0 right-2 text-xs font-bold text-amber-300 animate-zavi-steam">
          zZz
        </span>
        {/* Bed Frame & Pillow */}
        <div className="absolute bottom-0 inset-x-1 h-5 rounded-md bg-indigo-950 border border-indigo-400/50 shadow-lg" />
        <div className="absolute bottom-4 left-2 w-6 h-3 rounded-sm bg-slate-100 border border-slate-400" />
        {/* Zavi laying down on bed */}
        <img
          src="/zavi-mascot.png"
          alt="Zavi sleeping on bed"
          className="w-16 h-16 object-contain -rotate-90 translate-y-1 drop-shadow-[0_6px_12px_rgba(0,0,0,0.6)]"
        />
        {/* Cozy Blanket */}
        <div className="absolute bottom-1 right-2 w-20 h-5 rounded-t-lg bg-gradient-to-r from-purple-600/90 to-indigo-600/90 border-t border-purple-300/50" />
      </div>
    );
  }

  if (mood === 'break') {
    return (
      <div className="relative flex items-center justify-center">
        <img
          src="/zavi-mascot.png"
          alt="Zavi drinking chai"
          className={`${imgClass} object-contain animate-zavi-bounce drop-shadow-[0_8px_16px_rgba(56,189,248,0.45)]`}
        />
        {/* Steaming Hot Chai Cup */}
        <div className="absolute bottom-1 -right-2 flex flex-col items-center">
          <span className="text-xs font-bold text-amber-200 animate-zavi-steam leading-none">~</span>
          <div className="w-6 h-5 rounded-b-lg bg-amber-700 border border-amber-300/80 flex items-center justify-center text-[11px] shadow-md">
            ☕
          </div>
        </div>
      </div>
    );
  }

  if (mood === 'angry') {
    return (
      <div className="relative flex items-center justify-center">
        <img
          src="/zavi-mascot.png"
          alt="Zavi angry"
          className={`${imgClass} object-contain animate-zavi-shake drop-shadow-[0_0_16px_rgba(244,63,94,0.85)]`}
        />
        <span className="absolute -top-1 right-0 text-base animate-zavi-shake">💢</span>
      </div>
    );
  }

  if (mood === 'curious') {
    return (
      <div className="relative flex items-center justify-center">
        <img
          src="/zavi-mascot.png"
          alt="Zavi woke up curious"
          className={`${imgClass} object-contain animate-zavi-curious drop-shadow-[0_8px_18px_rgba(34,211,238,0.7)]`}
        />
        <span className="absolute -top-2 -right-1 rounded-full bg-cyan-500 text-slate-950 text-xs font-extrabold px-1.5 py-0.5 shadow animate-bounce">
          ?
        </span>
      </div>
    );
  }

  // Happy & Dancing!
  return (
    <div className="relative flex items-center justify-center">
      <img
        src="/zavi-mascot.png"
        alt="Zavi happy"
        className={`${imgClass} object-contain animate-zavi-dance drop-shadow-[0_8px_18px_rgba(168,85,247,0.65)]`}
      />
    </div>
  );
};
