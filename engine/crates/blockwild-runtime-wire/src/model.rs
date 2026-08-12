use std::fmt;

pub const RUNTIME_WIRE_V1: u16 = 1;
pub const RUNTIME_SCHEMA_V2: u16 = 2;
/// Schema 3 adds bounded rising-edge action receipts to fixed-step responses.
pub const RUNTIME_SCHEMA_V3: u16 = 3;
/// Schema 4 adds immutable terrain corpus identity and canonical generation
/// options to Create requests. Other request/response payloads retain their
/// existing schemas.
pub const RUNTIME_SCHEMA_V4: u16 = 4;
/// Schema 5 adds browser-owned viewport dimensions and a presentation-only
/// view revision to Extract requests. No response operation uses schema 5.
pub const RUNTIME_SCHEMA_V5: u16 = 5;
pub const DEFAULT_TERRAIN_CONTENT_HASH_V2: WireHash = WireHash([
    0xcc, 0x59, 0x90, 0x3b, 0xe7, 0x7d, 0xfe, 0x30, 0x10, 0x9d, 0x15, 0xbf, 0xaf, 0x0e, 0x30, 0x22,
]);
pub const DEFAULT_GENERATION_OPTIONS_JSON_V1: &str = concat!(
    "{\"biomeScale\":1.35,\"caveFrequency\":1,\"enabledFactions\":[\"hobbits\",\"goblins\",",
    "\"atlantians\",\"sugarcourt\",\"wood-elves\",\"dwarves\"],\"largeTownFrequency\":\"balanced\",",
    "\"profile\":\"world-below-v15\",\"resourceAbundance\":1,",
    "\"roadCoverage\":\"regional\",\"settlementClustering\":\"regional\",\"settlementDensity\":1,",
    "\"settlementPattern\":\"heartlands-v2\",\"structures\":true}",
);
pub const MAX_GENERATION_OPTIONS_JSON_BYTES: usize = 16 * 1024;
pub const RUNTIME_FIXED_STEP_US: u64 = 50_000;
pub const MAX_WIRE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_DOMAIN_PAYLOAD_BYTES: usize = 1024 * 1024;
pub const MAX_EXTRACTION_BYTES: usize = 6 * 1024 * 1024;
pub const MAX_OPERATIONS: usize = 256;
pub const MAX_INPUT_FRAMES: usize = 128;
pub const MAX_ACTION_RECEIPTS: usize = MAX_INPUT_FRAMES * 6;
pub const MAX_SAFE_U64: u64 = 9_007_199_254_740_991;
pub const MAX_VIEWPORT_DIMENSION_V1: u32 = 16_384;

// RuntimeInputFrameV1 is a public cross-language ABI. Buttons are a sampled
// bitset; consumers detect rising edges for toggle actions rather than relying
// on browser event timing. Axes are signed-normalized i16 values and lookYaw
// is an absolute wrapped heading (-32768..32767 maps to -PI..PI).
pub const RUNTIME_INPUT_BUTTON_JUMP_V1: u32 = 1 << 0;
pub const RUNTIME_INPUT_BUTTON_CROUCH_V1: u32 = 1 << 1;
pub const RUNTIME_INPUT_BUTTON_SPRINT_V1: u32 = 1 << 2;
pub const RUNTIME_INPUT_BUTTON_ASCEND_V1: u32 = 1 << 3;
pub const RUNTIME_INPUT_BUTTON_DESCEND_V1: u32 = 1 << 4;
pub const RUNTIME_INPUT_BUTTON_PRIMARY_ATTACK_V1: u32 = 1 << 5;
pub const RUNTIME_INPUT_BUTTON_SECONDARY_USE_V1: u32 = 1 << 6;
pub const RUNTIME_INPUT_BUTTON_INTERACT_V1: u32 = 1 << 7;
pub const RUNTIME_INPUT_BUTTON_MOUNT_TOGGLE_V1: u32 = 1 << 8;
pub const RUNTIME_INPUT_BUTTON_CREATIVE_FLIGHT_TOGGLE_V1: u32 = 1 << 9;
pub const RUNTIME_INPUT_BUTTON_DROP_V1: u32 = 1 << 10;
pub const RUNTIME_INPUT_BUTTON_MASK_V1: u32 = (1 << 11) - 1;
pub const RUNTIME_INPUT_LIVE_MOVEMENT_BUTTON_MASK_V1: u32 = RUNTIME_INPUT_BUTTON_JUMP_V1
    | RUNTIME_INPUT_BUTTON_CROUCH_V1
    | RUNTIME_INPUT_BUTTON_SPRINT_V1
    | RUNTIME_INPUT_BUTTON_ASCEND_V1
    | RUNTIME_INPUT_BUTTON_DESCEND_V1;

pub const RUNTIME_INPUT_FLAG_CREATIVE_V1: u8 = 1 << 0;
pub const RUNTIME_INPUT_FLAG_FLYING_V1: u8 = 1 << 1;
pub const RUNTIME_INPUT_FLAG_MOUNTED_V1: u8 = 1 << 2;
pub const RUNTIME_INPUT_FLAG_MASK_V1: u8 = (1 << 3) - 1;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WireError {
    pub code: &'static str,
    pub message: String,
}

impl WireError {
    #[must_use]
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for WireError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for WireError {}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
pub struct WireHash(pub [u8; 16]);

impl WireHash {
    #[must_use]
    pub fn to_hex(self) -> String {
        self.0.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    pub fn from_hex(value: &str) -> Result<Self, WireError> {
        if value.len() != 32
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(WireError::new(
                "invalid-hash",
                "wire hash must be 32 lowercase hexadecimal characters",
            ));
        }
        let mut output = [0_u8; 16];
        for (index, target) in output.iter_mut().enumerate() {
            *target = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
                .map_err(|_| WireError::new("invalid-hash", "wire hash is not hexadecimal"))?;
        }
        Ok(Self(output))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum RuntimeDomainV1 {
    World = 0,
    Simulation = 1,
    Entities = 2,
    Gameplay = 3,
    Persistence = 4,
    Network = 5,
}

impl RuntimeDomainV1 {
    pub fn from_code(code: u8) -> Result<Self, WireError> {
        match code {
            0 => Ok(Self::World),
            1 => Ok(Self::Simulation),
            2 => Ok(Self::Entities),
            3 => Ok(Self::Gameplay),
            4 => Ok(Self::Persistence),
            5 => Ok(Self::Network),
            _ => Err(WireError::new("invalid-domain", "runtime domain code is unknown")),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RuntimeRevisionV1 {
    pub epoch: u64,
    pub world: u64,
    pub entities: u64,
    pub gameplay: u64,
    pub persistence: u64,
    pub network: u64,
    pub simulation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeIdentityV1 {
    pub universe_id: String,
    pub location_id: String,
    pub revision: RuntimeRevisionV1,
    pub tick: u64,
    pub state_hash: WireHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeConfigV1 {
    pub world_seed: String,
    pub universe_id: String,
    pub location_id: String,
    pub session_id: String,
    pub content_hash: WireHash,
    pub generator_hash: WireHash,
    pub terrain_content_hash: WireHash,
    pub generation_options_json: String,
    pub water_block_id: u16,
    pub directional_block_ids: Vec<u16>,
    pub waterlogged_block_ids: Vec<u16>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RuntimeInputFrameV1 {
    pub sequence: u64,
    pub target_tick: u64,
    pub move_x: i16,
    pub move_z: i16,
    pub look_yaw: i16,
    pub look_pitch: i16,
    pub buttons: u32,
    pub selected_slot: u8,
    pub flags: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum RuntimeInputActionKindV1 {
    PrimaryAttack = 0,
    SecondaryUse = 1,
    Interact = 2,
    MountToggle = 3,
    CreativeFlightToggle = 4,
    Drop = 5,
}

impl RuntimeInputActionKindV1 {
    pub fn from_code(code: u8) -> Result<Self, WireError> {
        match code {
            0 => Ok(Self::PrimaryAttack),
            1 => Ok(Self::SecondaryUse),
            2 => Ok(Self::Interact),
            3 => Ok(Self::MountToggle),
            4 => Ok(Self::CreativeFlightToggle),
            5 => Ok(Self::Drop),
            _ => Err(WireError::new(
                "input-action-kind",
                "input action receipt kind is unknown",
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum RuntimeInputActionOutcomeV1 {
    Applied = 0,
    NoTarget = 1,
    Ineligible = 2,
    EmptySlot = 3,
    Blocked = 4,
}

impl RuntimeInputActionOutcomeV1 {
    pub fn from_code(code: u8) -> Result<Self, WireError> {
        match code {
            0 => Ok(Self::Applied),
            1 => Ok(Self::NoTarget),
            2 => Ok(Self::Ineligible),
            3 => Ok(Self::EmptySlot),
            4 => Ok(Self::Blocked),
            _ => Err(WireError::new(
                "input-action-outcome",
                "input action receipt outcome is unknown",
            )),
        }
    }
}

/// One deterministic rising-edge result emitted by a fixed-step request.
/// `target_entity_id` is the packed generational identity, with zero meaning
/// that the action did not resolve an entity target.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RuntimeInputActionReceiptV1 {
    pub sequence: u64,
    pub input_sequence: u64,
    pub tick: u64,
    pub kind: RuntimeInputActionKindV1,
    pub outcome: RuntimeInputActionOutcomeV1,
    pub selected_slot: u8,
    pub authoritative_flags: u8,
    pub target_entity_id: u64,
    pub effect_hash: WireHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeDomainOperationV1 {
    pub domain: RuntimeDomainV1,
    pub type_id: String,
    pub schema: u16,
    pub payload: Vec<u8>,
    pub payload_hash: WireHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeCommandBatchV1 {
    pub command_id: String,
    pub idempotency_key: String,
    pub actor_id: String,
    pub expected: RuntimeIdentityV1,
    pub operations: Vec<RuntimeDomainOperationV1>,
    pub command_hash: WireHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuntimeRequestV1 {
    Create {
        request_id: u32,
        client_epoch: u32,
        config: RuntimeConfigV1,
    },
    Command {
        request_id: u32,
        client_epoch: u32,
        batch: RuntimeCommandBatchV1,
    },
    /// Lookup-only retry after an attested checkpoint restore. The command
    /// bytes are identical to the original BWRQ command; a cache miss never
    /// dispatches authority work.
    RecoverCommand {
        request_id: u32,
        client_epoch: u32,
        batch: RuntimeCommandBatchV1,
    },
    Step {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeIdentityV1,
        monotonic_time_us: u64,
        budget_us: u32,
        inputs: Vec<RuntimeInputFrameV1>,
    },
    Extract {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeIdentityV1,
        after_revision: u64,
        max_bytes: u32,
    },
    /// View-aware extraction keeps the schema-2 payload as an exact prefix.
    /// The viewport is presentation-only and must never enter authority hashes.
    ExtractView {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeIdentityV1,
        after_revision: u64,
        max_bytes: u32,
        viewport_width: u32,
        viewport_height: u32,
        view_revision: u64,
    },
    Restore {
        request_id: u32,
        client_epoch: u32,
        expected_checkpoint_hash: WireHash,
        checkpoint: Vec<u8>,
    },
    Shutdown {
        request_id: u32,
        client_epoch: u32,
        expected: Option<RuntimeIdentityV1>,
    },
    Checkpoint {
        request_id: u32,
        client_epoch: u32,
        expected: RuntimeIdentityV1,
    },
}

impl RuntimeRequestV1 {
    #[must_use]
    pub const fn request_id(&self) -> u32 {
        match self {
            Self::Create { request_id, .. }
            | Self::Command { request_id, .. }
            | Self::RecoverCommand { request_id, .. }
            | Self::Step { request_id, .. }
            | Self::Extract { request_id, .. }
            | Self::ExtractView { request_id, .. }
            | Self::Restore { request_id, .. }
            | Self::Shutdown { request_id, .. }
            | Self::Checkpoint { request_id, .. } => *request_id,
        }
    }

    #[must_use]
    pub const fn client_epoch(&self) -> u32 {
        match self {
            Self::Create { client_epoch, .. }
            | Self::Command { client_epoch, .. }
            | Self::RecoverCommand { client_epoch, .. }
            | Self::Step { client_epoch, .. }
            | Self::Extract { client_epoch, .. }
            | Self::ExtractView { client_epoch, .. }
            | Self::Restore { client_epoch, .. }
            | Self::Shutdown { client_epoch, .. }
            | Self::Checkpoint { client_epoch, .. } => *client_epoch,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuntimeCommandReceiptV1 {
    Accepted {
        command_id: String,
        idempotency_key: String,
        command_hash: WireHash,
        before: RuntimeIdentityV1,
        after: RuntimeIdentityV1,
        domain_receipts: Vec<RuntimeDomainOperationV1>,
        receipt_hash: WireHash,
    },
    Rejected {
        command_id: String,
        idempotency_key: String,
        command_hash: WireHash,
        code: String,
        message: String,
        current: RuntimeIdentityV1,
        receipt_hash: WireHash,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeExtractionV1 {
    pub identity: RuntimeIdentityV1,
    pub extraction_revision: u64,
    pub render: Vec<u8>,
    pub hud: Vec<u8>,
    pub audio: Vec<u8>,
    pub platform_requests: Vec<u8>,
    pub diagnostics: Vec<u8>,
    pub extraction_hash: WireHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RuntimeResponseV1 {
    Ready {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        runtime_handle: u32,
        identity: RuntimeIdentityV1,
        artifact_hash: String,
        instance_id: String,
        capabilities: Vec<String>,
    },
    CommandReceipt {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        receipt: RuntimeCommandReceiptV1,
    },
    StepResult {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        identity: RuntimeIdentityV1,
        fixed_steps: u16,
        inputs_applied: u16,
        commands_processed: u16,
        commands_accepted: u16,
        action_receipts: Vec<RuntimeInputActionReceiptV1>,
        replay_hash: WireHash,
    },
    Extraction {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        extraction: RuntimeExtractionV1,
    },
    Restored {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        runtime_handle: u32,
        identity: RuntimeIdentityV1,
        checkpoint_hash: WireHash,
        artifact_hash: String,
        instance_id: String,
        capabilities: Vec<String>,
    },
    Shutdown {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
    },
    Checkpoint {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        identity: RuntimeIdentityV1,
        checkpoint: Vec<u8>,
        checkpoint_hash: WireHash,
    },
    Error {
        request_id: u32,
        client_epoch: u32,
        worker_epoch: u32,
        code: String,
        message: String,
        current: Option<RuntimeIdentityV1>,
    },
}

impl RuntimeResponseV1 {
    #[must_use]
    pub const fn request_id(&self) -> u32 {
        match self {
            Self::Ready { request_id, .. }
            | Self::CommandReceipt { request_id, .. }
            | Self::StepResult { request_id, .. }
            | Self::Extraction { request_id, .. }
            | Self::Restored { request_id, .. }
            | Self::Shutdown { request_id, .. }
            | Self::Checkpoint { request_id, .. }
            | Self::Error { request_id, .. } => *request_id,
        }
    }

    #[must_use]
    pub const fn client_epoch(&self) -> u32 {
        match self {
            Self::Ready { client_epoch, .. }
            | Self::CommandReceipt { client_epoch, .. }
            | Self::StepResult { client_epoch, .. }
            | Self::Extraction { client_epoch, .. }
            | Self::Restored { client_epoch, .. }
            | Self::Shutdown { client_epoch, .. }
            | Self::Checkpoint { client_epoch, .. }
            | Self::Error { client_epoch, .. } => *client_epoch,
        }
    }

    #[must_use]
    pub const fn worker_epoch(&self) -> u32 {
        match self {
            Self::Ready { worker_epoch, .. }
            | Self::CommandReceipt { worker_epoch, .. }
            | Self::StepResult { worker_epoch, .. }
            | Self::Extraction { worker_epoch, .. }
            | Self::Restored { worker_epoch, .. }
            | Self::Shutdown { worker_epoch, .. }
            | Self::Checkpoint { worker_epoch, .. }
            | Self::Error { worker_epoch, .. } => *worker_epoch,
        }
    }
}
