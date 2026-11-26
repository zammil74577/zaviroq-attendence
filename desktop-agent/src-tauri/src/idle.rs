use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const DEBOUNCE_SECONDS: i64 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PresenceState {
    Active,
    Idle,
    Break,
}

impl PresenceState {
    pub fn as_str(&self) -> &'static str {
        match self {
            PresenceState::Active => "active",
            PresenceState::Idle => "idle",
            PresenceState::Break => "break",
        }
    }
}

#[derive(Debug, Clone)]
pub struct IdleDebouncer {
    pub current_state: PresenceState,
    pub pending_state: Option<PresenceState>,
    pub pending_since: Option<DateTime<Utc>>,
}

impl IdleDebouncer {
    pub fn new(initial: PresenceState) -> Self {
        Self {
            current_state: initial,
            pending_state: None,
            pending_since: None,
        }
    }

    /// Evaluates the next presence state given OS idle seconds, threshold, lock/sleep status, and break flag.
    /// - Break overrides everything to `Break`.
    /// - Screen lock or sleep forces `Idle` immediately (no 10s debounce).
    /// - Otherwise, transitions between `Active` and `Idle` are debounced by `DEBOUNCE_SECONDS` (10s).
    pub fn evaluate(
        &mut self,
        os_idle_seconds: u64,
        idle_threshold_seconds: u64,
        screen_locked_or_sleeping: bool,
        on_break: bool,
        now: DateTime<Utc>,
    ) -> PresenceState {
        if on_break {
            self.current_state = PresenceState::Break;
            self.pending_state = None;
            self.pending_since = None;
            return self.current_state;
        }

        if screen_locked_or_sleeping {
            self.current_state = PresenceState::Idle;
            self.pending_state = None;
            self.pending_since = None;
            return self.current_state;
        }

        let desired = if os_idle_seconds < idle_threshold_seconds {
            PresenceState::Active
        } else {
            PresenceState::Idle
        };

        if desired == self.current_state {
            self.pending_state = None;
            self.pending_since = None;
            return self.current_state;
        }

        match (self.pending_state, self.pending_since) {
            (Some(pending), Some(since)) if pending == desired => {
                if (now - since).num_seconds() >= DEBOUNCE_SECONDS {
                    self.current_state = desired;
                    self.pending_state = None;
                    self.pending_since = None;
                }
            }
            _ => {
                self.pending_state = Some(desired);
                self.pending_since = Some(now);
            }
        }

        self.current_state
    }
}

/// Reads OS-level idle seconds without capturing keystrokes, window titles, or app names.
#[cfg(target_os = "windows")]
pub fn get_os_idle_seconds() -> u64 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info) != 0 {
            let now_ticks = GetTickCount();
            let elapsed_ms = now_ticks.wrapping_sub(info.dwTime);
            (elapsed_ms / 1000) as u64
        } else {
            0
        }
    }
}

#[cfg(target_os = "macos")]
pub fn get_os_idle_seconds() -> u64 {
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    // kCGAnyInputEventType = !0u32
    let secs = CGEventSource::seconds_since_last_event_type(
        CGEventSourceStateID::CombinedSessionState,
        u32::MAX,
    );
    if secs.is_finite() && secs >= 0.0 {
        secs.floor() as u64
    } else {
        0
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn get_os_idle_seconds() -> u64 {
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    #[test]
    fn debounces_active_to_idle_over_10_seconds() {
        let t0 = Utc::now();
        let mut debouncer = IdleDebouncer::new(PresenceState::Active);

        // First idle reading starts the 10s debounce timer, stays Active
        assert_eq!(debouncer.evaluate(65, 60, false, false, t0), PresenceState::Active);
        // At +5s still Active
        assert_eq!(
            debouncer.evaluate(70, 60, false, false, t0 + Duration::seconds(5)),
            PresenceState::Active
        );
        // At +10s transitions to Idle
        assert_eq!(
            debouncer.evaluate(75, 60, false, false, t0 + Duration::seconds(10)),
            PresenceState::Idle
        );
    }

    #[test]
    fn screen_lock_forces_idle_immediately() {
        let t0 = Utc::now();
        let mut debouncer = IdleDebouncer::new(PresenceState::Active);
        assert_eq!(debouncer.evaluate(0, 60, true, false, t0), PresenceState::Idle);
    }

    #[test]
    fn flickering_input_does_not_flap_state() {
        let t0 = Utc::now();
        let mut debouncer = IdleDebouncer::new(PresenceState::Active);
        assert_eq!(debouncer.evaluate(65, 60, false, false, t0), PresenceState::Active);
        // User moves mouse at +4s -> resets pending
        assert_eq!(
            debouncer.evaluate(0, 60, false, false, t0 + Duration::seconds(4)),
            PresenceState::Active
        );
        // Idle again at +5s -> timer restarts, so at +11s it is still Active
        assert_eq!(
            debouncer.evaluate(65, 60, false, false, t0 + Duration::seconds(5)),
            PresenceState::Active
        );
        assert_eq!(
            debouncer.evaluate(71, 60, false, false, t0 + Duration::seconds(11)),
            PresenceState::Active
        );
    }
}
