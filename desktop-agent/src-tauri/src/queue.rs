use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

pub const MAX_OFFLINE_AGE_HOURS: i64 = 8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct QueuedHeartbeat {
    pub state: String,
    pub timestamp: DateTime<Utc>,
    pub device_id: Option<String>,
}

#[derive(Debug, Default)]
pub struct OfflineHeartbeatQueue {
    items: VecDeque<QueuedHeartbeat>,
}

impl OfflineHeartbeatQueue {
    pub fn new() -> Self {
        Self {
            items: VecDeque::new(),
        }
    }

    pub fn push(&mut self, item: QueuedHeartbeat, now: DateTime<Utc>) {
        self.prune_expired(now);
        self.items.push_back(item);
    }

    pub fn prune_expired(&mut self, now: DateTime<Utc>) {
        let cutoff = now - Duration::hours(MAX_OFFLINE_AGE_HOURS);
        while let Some(front) = self.items.front() {
            if front.timestamp < cutoff {
                self.items.pop_front();
            } else {
                break;
            }
        }
    }

    pub fn drain_for_replay(&mut self, now: DateTime<Utc>) -> Vec<QueuedHeartbeat> {
        self.prune_expired(now);
        self.items.drain(..).collect()
    }

    pub fn requeue_front(&mut self, failed: Vec<QueuedHeartbeat>, now: DateTime<Utc>) {
        for item in failed.into_iter().rev() {
            self.items.push_front(item);
        }
        self.prune_expired(now);
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prunes_entries_older_than_8_hours_and_replays_fifo() {
        let now = Utc::now();
        let mut q = OfflineHeartbeatQueue::new();

        // 9 hours old -> should be pruned
        q.push(
            QueuedHeartbeat {
                state: "active".into(),
                timestamp: now - Duration::hours(9),
                device_id: Some("dev-1".into()),
            },
            now,
        );
        // 2 hours old -> kept
        q.push(
            QueuedHeartbeat {
                state: "active".into(),
                timestamp: now - Duration::hours(2),
                device_id: Some("dev-1".into()),
            },
            now,
        );
        // 1 hour old -> kept
        q.push(
            QueuedHeartbeat {
                state: "idle".into(),
                timestamp: now - Duration::hours(1),
                device_id: Some("dev-1".into()),
            },
            now,
        );

        let replayed = q.drain_for_replay(now);
        assert_eq!(replayed.len(), 2);
        assert_eq!(replayed[0].state, "active");
        assert_eq!(replayed[1].state, "idle");
        assert!(q.is_empty());
    }
}
