//! Deterministic, platform-neutral authority for Blockwild's bounded gameplay domains.
//!
//! The crate deliberately owns validation and state transitions, while presentation,
//! networking, persistence, and content authoring remain adapters around it.

mod authority;
mod block_action;
mod cardforge;
mod combat;
mod content_manifest;
mod content_runtime;
mod contract;
mod fixture;
mod inventory;
mod machines;
mod metadata_store;
mod progression;
mod snapshot;
mod world_view;
mod world_view_snapshot;

pub use authority::{GameplayAuthority, GameplayState, ReplayEntry};
pub use block_action::*;
pub use cardforge::*;
pub use combat::*;
pub use content_manifest::*;
pub use content_runtime::*;
pub use contract::*;
pub use fixture::{FixtureReport, run_reference_fixture};
pub use inventory::*;
pub use machines::*;
pub use metadata_store::*;
pub use progression::*;
pub use snapshot::*;
pub use world_view::*;
pub use world_view_snapshot::*;

#[cfg(test)]
mod block_action_tests;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod world_view_tests;
