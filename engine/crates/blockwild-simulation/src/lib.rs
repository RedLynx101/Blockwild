//! Deterministic R5 simulation kernels for Blockwild.
//!
//! Every public job is coarse, bounded, and revision-bound. Unknown world
//! cells fail closed for collision and leak for atmosphere topology.

mod air;
mod batch;
mod broadphase;
mod camera;
mod collision;
mod contract;
pub mod fixture;
mod gas;
mod kinematics;
mod liquid;
mod navigation;
mod profile;
mod projectile;
mod raycast;
mod shapes;
mod swimming;

pub use air::*;
pub use batch::*;
pub use broadphase::*;
pub use camera::*;
pub use collision::*;
pub use contract::*;
pub use gas::*;
pub use kinematics::*;
pub use liquid::*;
pub use navigation::*;
pub use profile::*;
pub use projectile::*;
pub use raycast::*;
pub use shapes::*;
pub use swimming::*;

#[cfg(test)]
mod tests;
