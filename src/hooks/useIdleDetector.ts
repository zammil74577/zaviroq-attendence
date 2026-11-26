import { useEffect, useRef, useState, useCallback } from 'react';
import type { LiveStatus } from '../types';

interface IdleDetectorInstance {
  userState: 'active' | 'idle';
  screenState: 'locked' | 'unlocked';
  start: (opts: { threshold: number; signal?: AbortSignal }) => Promise<void>;
  addEventListener: (type: 'change', listener: () => void) => void;
}

interface IdleDetectorCtor {
  new (): IdleDetectorInstance;
  requestPermission: () => Promise<'granted' | 'denied'>;
}

export function mapIdleDetectorState(
  userState: 'active' | 'idle',
  screenState: 'locked' | 'unlocked'
): 'active' | 'idle' {
  if (userState === 'idle' || screenState === 'locked') return 'idle';
  return 'active';
}

interface UseIdleDetectorOptions {
  employeeId: number | null;
  isClockedIn: boolean;
  initialStatus: LiveStatus;
  idleThresholdSeconds: number;
  onSync?: () => void;
  onSessionExpired?: () => void;
}

export function useIdleDetector({
  employeeId,
  isClockedIn,
  initialStatus,
  idleThresholdSeconds,
  onSync,
  onSessionExpired,
}: UseIdleDetectorOptions) {
  const [liveState, setLiveState] = useState<'active' | 'idle' | 'break'>(
    initialStatus === 'break' ? 'break' : initialStatus === 'idle' ? 'idle' : 'active'
  );
  const [secondsSinceActivity, setSecondsSinceActivity] = useState(0);
  const [pausedByOtherTab, setPausedByOtherTab] = useState(false);
  const [trackingMode, setTrackingMode] = useState<'system' | 'tab_only'>('tab_only');

  const getOrCreateTabSessionId = () => {
    try {
      const existing = sessionStorage.getItem('zaviroq_tab_session_id');
      if (existing) return existing;
      const created =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('zaviroq_tab_session_id', created);
      return created;
    } catch {
      return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  };
  const sessionIdRef = useRef<string>(getOrCreateTabSessionId());
  const lastActivityRef = useRef<number>(Date.now());
  const stateRef = useRef<'active' | 'idle' | 'break'>(liveState);
  const tickCountRef = useRef<number>(0);
  const trackingModeRef = useRef<'system' | 'tab_only'>('tab_only');
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (initialStatus === 'break' || initialStatus === 'idle' || initialStatus === 'active') {
      setLiveState(initialStatus);
      stateRef.current = initialStatus;
    }
  }, [employeeId, initialStatus]);

  const sendHeartbeat = useCallback(
    async (
      state: 'active' | 'idle' | 'break',
      reason = '',
      claimSession = false,
      modeOverride?: 'system' | 'tab_only'
    ) => {
      if (!employeeId || !isClockedIn) return;
      try {
        const res = await fetch('/api/activity/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state,
            reason,
            sessionId: sessionIdRef.current,
            claimSession,
            trackingMode: modeOverride || trackingModeRef.current,
          }),
        });
        if (res.status === 401) {
          onSessionExpired?.();
          return;
        }
        if (res.ok) {
          const j = await res.json();
          setPausedByOtherTab(Boolean(j.pausedByOtherTab));
        }
        onSync?.();
      } catch {
        // Retry on next heartbeat
      }
    },
    [employeeId, isClockedIn, onSync, onSessionExpired]
  );

  // Must be called from a user gesture (e.g. Clock In button click)
  const requestSystemIdleDetection = useCallback(async (): Promise<'system' | 'tab_only'> => {
    const Ctor = (window as unknown as { IdleDetector?: IdleDetectorCtor }).IdleDetector;
    if (!Ctor) {
      trackingModeRef.current = 'tab_only';
      setTrackingMode('tab_only');
      return 'tab_only';
    }
    try {
      const perm = await Ctor.requestPermission();
      if (perm !== 'granted') {
        trackingModeRef.current = 'tab_only';
        setTrackingMode('tab_only');
        return 'tab_only';
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const detector = new Ctor();
      detector.addEventListener('change', () => {
        if (stateRef.current === 'break') return;
        const mapped = mapIdleDetectorState(detector.userState, detector.screenState);
        if (mapped !== stateRef.current) {
          stateRef.current = mapped;
          setLiveState(mapped);
          lastActivityRef.current = Date.now();
          setSecondsSinceActivity(0);
          tickCountRef.current = 0;
          sendHeartbeat(
            mapped,
            `System IdleDetector: user=${detector.userState}, screen=${detector.screenState}`,
            false,
            'system'
          );
        }
      });

      await detector.start({
        threshold: Math.max(60000, idleThresholdSeconds * 1000),
        signal: controller.signal,
      });

      trackingModeRef.current = 'system';
      setTrackingMode('system');
      return 'system';
    } catch {
      trackingModeRef.current = 'tab_only';
      setTrackingMode('tab_only');
      return 'tab_only';
    }
  }, [idleThresholdSeconds, sendHeartbeat]);

  useEffect(() => {
    if (!isClockedIn) {
      abortControllerRef.current?.abort();
    }
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [isClockedIn]);

  // Fallback in-tab mouse/keyboard listener
  useEffect(() => {
    if (!isClockedIn) return;

    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      setSecondsSinceActivity(0);
      if (stateRef.current === 'idle') {
        stateRef.current = 'active';
        setLiveState('active');
        tickCountRef.current = 0;
        sendHeartbeat('active', 'User activity resumed');
      }
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, handleActivity, { passive: true }));

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, handleActivity));
    };
  }, [isClockedIn, sendHeartbeat]);

  useEffect(() => {
    if (!isClockedIn || !employeeId) {
      setSecondsSinceActivity(0);
      tickCountRef.current = 0;
      setPausedByOtherTab(false);
      return;
    }

    const interval = setInterval(() => {
      const elapsedIdle = Math.floor((Date.now() - lastActivityRef.current) / 1000);
      setSecondsSinceActivity(elapsedIdle);

      if (stateRef.current === 'active' && elapsedIdle >= idleThresholdSeconds) {
        stateRef.current = 'idle';
        setLiveState('idle');
        tickCountRef.current = 0;
        sendHeartbeat('idle', `Auto-idle after ${idleThresholdSeconds}s inactivity`);
        return;
      }

      tickCountRef.current += 1;
      if (tickCountRef.current >= 15) {
        tickCountRef.current = 0;
        sendHeartbeat(stateRef.current);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isClockedIn, employeeId, idleThresholdSeconds, sendHeartbeat]);

  const toggleBreak = useCallback(async () => {
    if (!isClockedIn) return;
    const next = stateRef.current === 'break' ? 'active' : 'break';
    stateRef.current = next;
    setLiveState(next);
    lastActivityRef.current = Date.now();
    setSecondsSinceActivity(0);
    tickCountRef.current = 0;
    await sendHeartbeat(
      next,
      next === 'break' ? 'Manual break started' : 'Returned from break',
      true
    );
  }, [isClockedIn, sendHeartbeat]);

  const forceIdle = useCallback(async () => {
    if (!isClockedIn) return;
    stateRef.current = 'idle';
    setLiveState('idle');
    tickCountRef.current = 0;
    await sendHeartbeat('idle', 'Marked idle', true);
  }, [isClockedIn, sendHeartbeat]);

  const claimActiveTab = useCallback(async () => {
    await sendHeartbeat(stateRef.current, 'Switched active tracking to this tab', true);
  }, [sendHeartbeat]);

  return {
    liveState,
    secondsSinceActivity,
    pausedByOtherTab,
    trackingMode,
    requestSystemIdleDetection,
    toggleBreak,
    forceIdle,
    claimActiveTab,
  };
}
