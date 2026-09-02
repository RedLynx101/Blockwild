//! Stable type registrations carried inside the coarse BWRQ/BWRS envelope.
//!
//! A type id selects exactly one native decoder.  The browser never infers a
//! Rust DTO from the outer domain enum alone, and unknown ids fail closed.

pub const SIMULATION_PHYSICS_REQUEST_TYPE_V1: &str = "blockwild.simulation.physics-step.r5.v1";
pub const SIMULATION_PHYSICS_RESPONSE_TYPE_V1: &str = "blockwild.simulation.physics-result.r5.v1";
pub const SIMULATION_LIQUID_REQUEST_TYPE_V1: &str = "blockwild.simulation.liquid-frontier.r5.v1";
pub const SIMULATION_LIQUID_RESPONSE_TYPE_V1: &str = "blockwild.simulation.liquid-result.r5.v1";
pub const SIMULATION_PATH_REQUEST_TYPE_V1: &str = "blockwild.simulation.path-job.r5.v1";
pub const SIMULATION_PATH_RESPONSE_TYPE_V1: &str = "blockwild.simulation.path-result.r5.v1";
pub const SIMULATION_AIR_REQUEST_TYPE_V1: &str = "blockwild.simulation.air-zone-job.r5.v1";
pub const SIMULATION_AIR_RESPONSE_TYPE_V1: &str = "blockwild.simulation.air-zone-result.r5.v1";
pub const SIMULATION_PLAYER_BIND_TYPE_V1: &str = "blockwild.simulation.player-bind.r5.v1";
pub const SIMULATION_PLAYER_BIND_RECEIPT_TYPE_V1: &str = "blockwild.simulation.player-bind-receipt.r5.v1";
pub const SIMULATION_PLAYER_BIND_TYPE_V2: &str = "blockwild.simulation.player-bind.r5.v2";
pub const SIMULATION_PLAYER_BIND_RECEIPT_TYPE_V2: &str = "blockwild.simulation.player-bind-receipt.r5.v2";

pub const ENTITY_COMMAND_TYPE_V1: &str = "blockwild.entities.command-batch.r6.v1";
pub const ENTITY_RECEIPT_TYPE_V1: &str = "blockwild.entities.event-batch.r6.v1";

pub const GAMEPLAY_COMMAND_TYPE_V1: &str = "blockwild.gameplay.command-batch.r7.v1";
pub const GAMEPLAY_RECEIPT_TYPE_V1: &str = "blockwild.gameplay.command-receipt.r7.v1";
pub const GAMEPLAY_ACTOR_GRANT_TYPE_V1: &str = "blockwild.gameplay.actor-grant.r7.v1";
pub const GAMEPLAY_ACTOR_GRANT_RECEIPT_TYPE_V1: &str = "blockwild.gameplay.actor-grant-receipt.r7.v1";

pub const PERSISTENCE_TRANSACTION_TYPE_V1: &str = "blockwild.persistence.transaction.r8.v1";
pub const PERSISTENCE_RECEIPT_TYPE_V1: &str = "blockwild.persistence.journal-receipt.r8.v1";
pub const PERSISTENCE_DISPATCH_TYPE_V1: &str = "blockwild.persistence.dispatch.r8.v1";
pub const PERSISTENCE_DISPATCH_RECEIPT_TYPE_V1: &str = "blockwild.persistence.dispatch-receipt.r8.v1";
pub const PERSISTENCE_STATUS_TYPE_V1: &str = "blockwild.persistence.status.r8.v1";
pub const PERSISTENCE_STATUS_RECEIPT_TYPE_V1: &str = "blockwild.persistence.status-receipt.r8.v1";

pub const NETWORK_REQUEST_TYPE_V1: &str = "blockwild.network.browser-request.r9.v1";
pub const NETWORK_RESPONSE_TYPE_V1: &str = "blockwild.network.browser-response.r9.v1";
pub const NETWORK_PEER_GRANT_TYPE_V1: &str = "blockwild.network.peer-grant.install.v1";
pub const NETWORK_AGENT_GRANT_TYPE_V1: &str = "blockwild.network.agent-grant.install.v1";
pub const NETWORK_GRANT_RECEIPT_TYPE_V1: &str = "blockwild.network.grant-install-receipt.v1";
pub const NETWORK_REPLICATION_UPSERT_TYPE_V1: &str = "blockwild.network.replication-record.upsert.v1";
pub const NETWORK_REPLICATION_REMOVE_TYPE_V1: &str = "blockwild.network.replication-record.remove.v1";
pub const NETWORK_REPLICATION_RECEIPT_TYPE_V1: &str = "blockwild.network.replication-record-receipt.v1";
pub const NETWORK_DELTA_BUILD_TYPE_V1: &str = "blockwild.network.delta.build.v1";
pub const NETWORK_DELTA_BUILD_RESPONSE_TYPE_V1: &str = "blockwild.network.delta.build-response.v1";
pub const NETWORK_RECONNECT_TYPE_V1: &str = "blockwild.network.reconnect-checkpoint.read.v1";
pub const NETWORK_RECONNECT_RESPONSE_TYPE_V1: &str = "blockwild.network.reconnect-checkpoint.response.v1";
pub const NETWORK_PEER_RELEASE_TYPE_V1: &str = "blockwild.network.peer.release.v1";
pub const NETWORK_PEER_RELEASE_RECEIPT_TYPE_V1: &str = "blockwild.network.peer.release-receipt.v1";
pub const NETWORK_COMMAND_RELEASE_TYPE_V1: &str = "blockwild.network.command.release.v1";
pub const NETWORK_COMMAND_RELEASE_RECEIPT_TYPE_V1: &str = "blockwild.network.command.release-receipt.v1";
