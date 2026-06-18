//! x_kernel — Rust kernel for x_harness.
//!
//! Spiral 1 scope:
//!   - actor tag (read/write OS-level actor identity)
//!   - dangerous-op guard (intercept + IPC)
//!
//! Nothing implemented yet — this file is intentionally a placeholder so the
//! workspace builds and the architecture seam is visible to readers.

#![allow(dead_code)]

/// Identity of who is performing an action.
#[derive(Debug, Clone)]
pub enum Actor {
    Human { user_id: String, surface: String },
    Model { provider: String, model: String, session_id: String },
    System { subsystem: String },
}

/// Placeholder. Real implementation lands in spiral 1.
pub fn current_actor() -> Option<Actor> {
    None
}
