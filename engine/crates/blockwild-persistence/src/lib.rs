//! Deterministic, renderer-independent Blockwild save authority.
//!
//! Rust owns schemas, record addressing, journal validation, checkpoint
//! compaction, migration fingerprints, recovery decisions, and portable wire
//! bytes. Browser TypeScript remains a narrow IndexedDB transaction adapter.

mod authority;
mod browser_runtime;
mod checkpoint;
mod contract;
mod dispatcher;
mod historical_external_descriptor;
mod journal;
mod legacy_descriptor;
mod migration;
mod paged_recovery;
mod platform_ops;
mod portable;
mod repair;
mod rich_migration;
mod save_set;
mod wire;

pub use authority::*;
pub use browser_runtime::*;
pub use checkpoint::*;
pub use contract::*;
pub use dispatcher::*;
pub use historical_external_descriptor::*;
pub use journal::*;
pub use legacy_descriptor::*;
pub use migration::*;
pub use paged_recovery::*;
pub use platform_ops::*;
pub use portable::*;
pub use repair::*;
pub use rich_migration::*;
pub use save_set::*;
pub use wire::*;

#[cfg(test)]
mod tests;
