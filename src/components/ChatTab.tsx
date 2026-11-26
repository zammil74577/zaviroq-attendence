import React, { useEffect, useRef, useState } from 'react';
import { Bot, ImagePlus, Send, Sparkles, X } from 'lucide-react';
import type { ChatContact, ChatMessage, Employee, ViewMode } from '../types';
import { formatClockTime, getInitials } from '../utils/format';
import { LiveStatusBadge } from './StatusBadge';

interface ChatTabProps {
  viewMode: ViewMode;
  currentUser: Employee | null;
}

export const ChatTab: React.FC<ChatTabProps> = ({ viewMode, currentUser }) => {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState<boolean>(true);
  const [selectedPeerId, setSelectedPeerId] = useState<number>(0); // 0 = Zaviroq Bot
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [imageData, setImageData] = useState<string>('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const userId = currentUser?.id || 1;
  const peers = contacts;
  const selectedPeer = selectedPeerId === 0 ? null : peers.find((p) => p.id === selectedPeerId) || null;

  useEffect(() => {
    setContactsLoading(true);
    fetch('/api/chat/contacts')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => setContacts(Array.isArray(rows) ? rows : []))
      .catch(() => {})
      .finally(() => setContactsLoading(false));
  }, [userId]);

  const lastIdRef = useRef<number>(0);

  const loadMessages = async (incremental = false) => {
    const after = incremental ? lastIdRef.current : 0;
    const res = await fetch(`/api/chat/messages?peerId=${selectedPeerId}&after=${after}`);
    if (res.ok) {
      const rows: ChatMessage[] = await res.json();
      if (incremental && after > 0) {
        if (rows.length > 0) {
          setMessages((prev) => [...prev, ...rows]);
          lastIdRef.current = rows[rows.length - 1].id;
        }
      } else {
        setMessages(rows);
        lastIdRef.current = rows.length > 0 ? rows[rows.length - 1].id : 0;
      }
    }
  };

  useEffect(() => {
    lastIdRef.current = 0;
    loadMessages(false);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') loadMessages(true);
    }, 4000);
    return () => clearInterval(t);
  }, [userId, selectedPeerId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageData(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const sendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? draft).trim();
    if ((!text && !imageData) || sending) return;
    setSending(true);
    const attachedImg = textToSend ? '' : imageData;
    if (!textToSend) {
      setDraft('');
      setImageData('');
    }
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_id: userId,
          recipient_id: selectedPeerId,
          message: text,
          image_data: attachedImg,
        }),
      });
      if (res.ok) {
        await loadMessages(true);
      }
    } finally {
      setSending(false);
    }
  };

  const quickPrompts = [
    viewMode === 'employee' ? 'My live status' : 'Who is idle right now?',
    'Show pending tasks',
    "Today's attendance",
    'Pending leaves',
    'Office timings & breaks',
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Team Chat & Zaviroq Assistant Bot</h1>
        <p className="text-xs text-slate-400">
          Direct conversations with image sharing & live AI-assisted workforce queries
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[620px]">
        {/* Left Pane */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-3 flex flex-col overflow-y-auto space-y-2">
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            AI Assistant
          </div>
          <button
            onClick={() => setSelectedPeerId(0)}
            className={`w-full flex items-center gap-3 rounded-xl p-2.5 text-left transition-colors cursor-pointer ${
              selectedPeerId === 0
                ? 'bg-indigo-500/20 border border-indigo-500/40'
                : 'hover:bg-slate-800/70 border border-transparent'
            }`}
          >
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white shrink-0">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-white">Zaviroq Bot</span>
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
              </div>
              <div className="text-[11px] text-slate-400 truncate">Live attendance & tasks Q&A</div>
            </div>
          </button>

          <div className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Direct Messages {!contactsLoading && `(${peers.length})`}
          </div>
          {contactsLoading ? (
            <div className="space-y-2 px-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-800/60" />
              ))}
            </div>
          ) : (
            peers.map((emp) => (
            <button
              key={emp.id}
              onClick={() => setSelectedPeerId(emp.id)}
              className={`w-full flex items-center justify-between gap-2 rounded-xl p-2.5 text-left transition-colors cursor-pointer ${
                selectedPeerId === emp.id
                  ? 'bg-indigo-500/20 border border-indigo-500/40'
                  : 'hover:bg-slate-800/70 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ backgroundColor: emp.avatar_color }}
                >
                  {getInitials(emp.name)}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{emp.name}</div>
                  <div className="text-[11px] text-slate-400 truncate">{emp.designation}</div>
                </div>
              </div>
              <LiveStatusBadge status={emp.status} />
            </button>
            ))
          )}
        </div>

        {/* Right Pane */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/75 flex flex-col overflow-hidden">
          <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between bg-slate-950/60">
            <div className="flex items-center gap-2.5">
              {selectedPeerId === 0 ? (
                <>
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">Zaviroq Assistant Bot</div>
                    <div className="text-[11px] text-emerald-400">Online • Connected to live Workforce DB</div>
                  </div>
                </>
              ) : selectedPeer ? (
                <>
                  <div
                    className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: selectedPeer.avatar_color }}
                  >
                    {getInitials(selectedPeer.name)}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">{selectedPeer.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {selectedPeer.emp_code} • {selectedPeer.department}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
            {selectedPeer && <LiveStatusBadge status={selectedPeer.status} />}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m) => {
              const isMine = m.sender_id === userId;
              return (
                <div key={m.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line ${
                      isMine
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : m.is_bot
                        ? 'border border-cyan-500/30 bg-slate-950/90 text-slate-100 rounded-bl-sm'
                        : 'border border-slate-800 bg-slate-800/90 text-slate-100 rounded-bl-sm'
                    }`}
                  >
                    {!isMine && (
                      <div className="text-[10px] font-semibold text-cyan-300 mb-0.5">
                        {m.sender_name || (m.is_bot ? 'Zaviroq Bot' : 'Teammate')}
                      </div>
                    )}
                    {m.image_data && (
                      <img
                        src={m.image_data}
                        alt="Uploaded attachment"
                        className="mb-1.5 max-h-56 rounded-xl border border-white/10 object-contain"
                      />
                    )}
                    {m.message && <div className="leading-relaxed text-[13px]">{m.message}</div>}
                    <div className={`mt-1 text-[10px] ${isMine ? 'text-indigo-200' : 'text-slate-400'} text-right`}>
                      {formatClockTime(m.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}

            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                Start a conversation with {selectedPeer ? selectedPeer.name : 'Zaviroq Bot'} below.
              </div>
            )}
          </div>

          {selectedPeerId === 0 && (
            <div className="px-4 py-2 border-t border-slate-800/80 bg-slate-950/40 flex flex-wrap gap-1.5">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  onClick={() => sendMessage(p)}
                  className="rounded-full border border-slate-700 bg-slate-800/80 hover:bg-indigo-600/30 hover:border-indigo-500/50 px-2.5 py-1 text-[11px] text-slate-200 transition-colors cursor-pointer"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* Image Attachment Preview */}
          {imageData && (
            <div className="px-4 py-2 border-t border-slate-800 bg-slate-950/80 flex items-center gap-3">
              <img src={imageData} alt="Preview" className="h-14 w-14 rounded-lg object-cover border border-slate-700" />
              <span className="text-xs text-slate-300 flex-1">Image ready to send</span>
              <button
                type="button"
                onClick={() => setImageData('')}
                className="rounded-lg p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="border-t border-slate-800 p-3 bg-slate-950/60 flex items-center gap-2"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 p-2 text-slate-300 hover:text-white cursor-pointer"
              title="Upload image"
              aria-label="Upload image"
            >
              <ImagePlus className="h-4 w-4" />
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                selectedPeerId === 0
                  ? 'Ask Zaviroq Bot or upload an image...'
                  : `Message ${selectedPeer?.name || 'employee'}...`
              }
              className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || (!draft.trim() && !imageData)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
