use std::collections::{BTreeMap, BTreeSet, VecDeque};

use blockwild_types::{CanonicalHash, CanonicalHasher};

use crate::canonical::{cell_json, hash_canonical_json, identity_hash, json_string, liquid_json};
use crate::read_page::{WorldReadSourceV1, vertical_boundary_cell};
use crate::{
    AuthorityError, AuthorityResult, BlockCatalogV1, CellPositionV1, ChunkAuxiliaryDataV1, ChunkAuxiliaryPatchV1,
    LiquidMetadataV1, ResidencyCompletionV1, ResidencyJobTokenV1, SectionInstallV1, SectionResidencySchedulerV1,
    WORLD_AIR_BLOCK_ID_V1, WORLD_AUTHORITY_SCHEMA_V1, WORLD_MAX_Y_V1, WORLD_MIN_Y_V1,
    WORLD_MUTATION_BATCH_MAX_COMMANDS_V1, WORLD_SECTION_CELL_COUNT_V1, WORLD_SECTION_COUNT_V1, WorldAddressV1,
    WorldAuthorityIdentityV1, WorldAuthorityRevisionV1, WorldBoundaryKindV1, WorldCellReadV1, WorldCellV1,
    WorldChunkAddressV1, WorldSectionAddressV1, WorldSectionRevisionV1, validate_hash, validate_label,
};

pub const WORLD_IMMEDIATE_EVENT_CAPACITY_V1: usize = 4_096;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorldMutationCommandR4V1 {
    SetBlock {
        position: CellPositionV1,
        block_id: u16,
        facing: Option<u8>,
    },
    SetFacing {
        position: CellPositionV1,
        facing: u8,
    },
    SetLiquid {
        position: CellPositionV1,
        liquid: LiquidMetadataV1,
    },
}

impl WorldMutationCommandR4V1 {
    #[must_use]
    pub const fn position(&self) -> CellPositionV1 {
        match self {
            Self::SetBlock { position, .. } | Self::SetFacing { position, .. } | Self::SetLiquid { position, .. } => {
                *position
            }
        }
    }

    const fn order(&self) -> u8 {
        match self {
            Self::SetBlock { .. } => 0,
            Self::SetFacing { .. } => 1,
            Self::SetLiquid { .. } => 2,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldMutationBatchR4V1 {
    pub schema_version: u16,
    pub batch_id: String,
    pub authority_id: String,
    pub address: WorldAddressV1,
    pub expected_revision: WorldAuthorityRevisionV1,
    pub commands: Vec<WorldMutationCommandR4V1>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldCommittedCellR4V1 {
    pub position: CellPositionV1,
    pub previous: WorldCellV1,
    pub current: WorldCellV1,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum DirtySubsystemV1 {
    Lighting,
    Liquids,
    Topology,
    Meshing,
    Navigation,
    Maps,
    Persistence,
}

impl DirtySubsystemV1 {
    #[must_use]
    pub const fn wire_name(self) -> &'static str {
        match self {
            Self::Lighting => "lighting",
            Self::Liquids => "liquids",
            Self::Topology => "topology",
            Self::Meshing => "meshing",
            Self::Navigation => "navigation",
            Self::Maps => "maps",
            Self::Persistence => "persistence",
        }
    }
}

pub const DIRTY_SUBSYSTEMS_R4_V1: [DirtySubsystemV1; 7] = [
    DirtySubsystemV1::Lighting,
    DirtySubsystemV1::Liquids,
    DirtySubsystemV1::Topology,
    DirtySubsystemV1::Meshing,
    DirtySubsystemV1::Navigation,
    DirtySubsystemV1::Maps,
    DirtySubsystemV1::Persistence,
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DirtySubsystemSeedV1 {
    pub subsystem: DirtySubsystemV1,
    pub seed: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldDirtySetR4V1 {
    pub sections: Vec<WorldSectionAddressV1>,
    pub columns: Vec<(i32, i32)>,
    pub subsystem_seeds: Vec<DirtySubsystemSeedV1>,
}

impl WorldDirtySetR4V1 {
    #[must_use]
    pub fn empty() -> Self {
        Self {
            sections: Vec::new(),
            columns: Vec::new(),
            subsystem_seeds: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MutationRejectionCodeR4V1 {
    AddressMismatch,
    StaleRevision,
    InvalidCommand,
    UnloadedCell,
    VerticalBoundary,
    FacingNotSupported,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorldMutationReceiptR4V1 {
    Rejected {
        batch_id: String,
        code: MutationRejectionCodeR4V1,
        message: String,
        identity: WorldAuthorityIdentityV1,
    },
    Accepted {
        batch_id: String,
        mutated: bool,
        before: WorldAuthorityIdentityV1,
        after: WorldAuthorityIdentityV1,
        changes: Vec<WorldCommittedCellR4V1>,
        dirty: WorldDirtySetR4V1,
        delta: Option<Box<WorldNetworkDeltaR4V1>>,
        immediate_event: Option<Box<ImmediateWorldEditEventR4V1>>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorldNetworkDeltaR4V1 {
    pub schema_version: u16,
    pub address: WorldAddressV1,
    pub batch_id: String,
    pub from_revision: WorldAuthorityRevisionV1,
    pub to_revision: WorldAuthorityRevisionV1,
    pub changes: Vec<WorldCommittedCellR4V1>,
    pub checksum: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImmediateWorldEditEventR4V1 {
    pub sequence: u64,
    pub address: WorldAddressV1,
    pub batch_id: String,
    pub identity: WorldAuthorityIdentityV1,
    pub changes: Vec<WorldCommittedCellR4V1>,
    pub dirty_sections: Vec<WorldSectionAddressV1>,
}

#[derive(Clone, Debug)]
pub(crate) struct SectionRecord {
    pub(crate) cells: Vec<WorldCellV1>,
    pub(crate) content_hash: CanonicalHash,
    pub(crate) revision: WorldSectionRevisionV1,
    pub(crate) source_revision: u64,
    pub(crate) source_hash: String,
    pub(crate) dirty: BTreeSet<DirtySubsystemV1>,
}

#[derive(Clone, Debug)]
pub(crate) struct ChunkAuxiliaryRecord {
    pub(crate) data: ChunkAuxiliaryDataV1,
    pub(crate) content_hash: CanonicalHash,
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct JournalDigestV1 {
    sum_low: u64,
    sum_high: u64,
    xor_low: u64,
    xor_high: u64,
}

impl JournalDigestV1 {
    fn add(&mut self, hash: CanonicalHash) {
        let (low, high) = hash_lanes(hash);
        self.sum_low = self.sum_low.wrapping_add(low);
        self.sum_high = self.sum_high.wrapping_add(high);
        self.xor_low ^= low;
        self.xor_high ^= high;
    }

    fn remove(&mut self, hash: CanonicalHash) {
        let (low, high) = hash_lanes(hash);
        self.sum_low = self.sum_low.wrapping_sub(low);
        self.sum_high = self.sum_high.wrapping_sub(high);
        self.xor_low ^= low;
        self.xor_high ^= high;
    }

    fn write_hash(self, hasher: &mut CanonicalHasher) {
        hasher.write_u64(self.sum_low);
        hasher.write_u64(self.sum_high);
        hasher.write_u64(self.xor_low);
        hasher.write_u64(self.xor_high);
    }
}

#[derive(Clone, Debug)]
pub(crate) struct LocationShard {
    pub(crate) address: WorldAddressV1,
    pub(crate) revision: WorldAuthorityRevisionV1,
    pub(crate) sections: BTreeMap<WorldSectionAddressV1, SectionRecord>,
    pub(crate) revisions: BTreeMap<WorldSectionAddressV1, WorldSectionRevisionV1>,
    pub(crate) chunk_auxiliary: BTreeMap<crate::WorldChunkAddressV1, ChunkAuxiliaryRecord>,
    pub(crate) edit_journal: BTreeMap<CellPositionV1, WorldCellV1>,
    pub(crate) edit_journal_digest: JournalDigestV1,
    pub(crate) residency: SectionResidencySchedulerV1,
    pub(crate) events: VecDeque<ImmediateWorldEditEventR4V1>,
    pub(crate) next_event_sequence: u64,
}

impl LocationShard {
    fn new(address: WorldAddressV1, epoch: u64) -> Self {
        Self {
            address,
            revision: WorldAuthorityRevisionV1 {
                epoch,
                mutation: 0,
                residency: 0,
            },
            sections: BTreeMap::new(),
            revisions: BTreeMap::new(),
            chunk_auxiliary: BTreeMap::new(),
            edit_journal: BTreeMap::new(),
            edit_journal_digest: JournalDigestV1::default(),
            residency: SectionResidencySchedulerV1::new(epoch),
            events: VecDeque::new(),
            next_event_sequence: 1,
        }
    }

    fn identity(&self) -> WorldAuthorityIdentityV1 {
        WorldAuthorityIdentityV1 {
            address: self.address.clone(),
            revision: self.revision,
            state_hash: identity_hash(&self.address, self.revision),
        }
    }

    fn revision_for(&self, address: &WorldSectionAddressV1) -> Option<WorldSectionRevisionV1> {
        self.sections
            .contains_key(address)
            .then(|| self.revisions.get(address).copied().unwrap_or_default())
    }
}

#[derive(Clone, Debug)]
pub struct WorldAuthorityStoreR4V1 {
    pub(crate) catalog: BlockCatalogV1,
    pub(crate) locations: BTreeMap<WorldAddressV1, LocationShard>,
    pub(crate) active: WorldAddressV1,
    pub(crate) next_epoch: u64,
}

impl WorldAuthorityStoreR4V1 {
    pub fn new(address: WorldAddressV1, catalog: BlockCatalogV1) -> AuthorityResult<Self> {
        address.validate()?;
        let shard = LocationShard::new(address.clone(), 1);
        Ok(Self {
            catalog,
            locations: BTreeMap::from([(address.clone(), shard)]),
            active: address,
            next_epoch: 2,
        })
    }

    fn active_shard(&self) -> &LocationShard {
        self.locations
            .get(&self.active)
            .expect("active location always has a shard")
    }

    fn active_shard_mut(&mut self) -> &mut LocationShard {
        self.locations
            .get_mut(&self.active)
            .expect("active location always has a shard")
    }

    #[must_use]
    pub fn active_address(&self) -> &WorldAddressV1 {
        &self.active
    }

    #[must_use]
    pub fn block_catalog(&self) -> &BlockCatalogV1 {
        &self.catalog
    }

    #[must_use]
    pub fn identity(&self) -> WorldAuthorityIdentityV1 {
        self.active_shard().identity()
    }

    #[must_use]
    pub fn revision(&self) -> WorldAuthorityRevisionV1 {
        self.active_shard().revision
    }

    #[must_use]
    pub fn resident_section_count(&self) -> usize {
        self.active_shard().sections.len()
    }

    /// Canonical coordinates for every chunk with resident generated state in
    /// the active location. The union includes auxiliary-only chunks so an
    /// exact residency reconciler cannot leak metadata after partial recovery.
    #[must_use]
    pub fn resident_chunk_coordinates(&self) -> Vec<(i32, i32)> {
        let shard = self.active_shard();
        let mut chunks = shard
            .sections
            .keys()
            .map(|section| (section.chunk_x, section.chunk_z))
            .collect::<BTreeSet<_>>();
        chunks.extend(shard.chunk_auxiliary.keys().map(|chunk| (chunk.chunk_x, chunk.chunk_z)));
        chunks.into_iter().collect()
    }

    /// Returns the bounded canonical chunk set containing disposable residency
    /// state. Besides resident sections and auxiliary data, this includes
    /// scheduler-only work and legacy generated-only revision entries. Revision
    /// entries required to replay an authored edit and its generation halo are
    /// durable authored state rather than residency state.
    #[must_use]
    pub fn disposable_residency_chunk_coordinates_bounded(&self, maximum: usize) -> Option<Vec<(i32, i32)>> {
        let shard = self.active_shard();
        let journal_halo = journal_revision_chunk_coordinates(shard);
        let mut chunks = BTreeSet::new();
        let mut insert = |coordinate| {
            chunks.insert(coordinate);
            chunks.len() <= maximum
        };
        for section in shard.sections.keys() {
            if !insert((section.chunk_x, section.chunk_z)) {
                return None;
            }
        }
        for chunk in shard.chunk_auxiliary.keys() {
            if !insert((chunk.chunk_x, chunk.chunk_z)) {
                return None;
            }
        }
        for section in shard.revisions.keys() {
            let coordinate = (section.chunk_x, section.chunk_z);
            if !journal_halo.contains(&coordinate) && !insert(coordinate) {
                return None;
            }
        }
        for section in shard.residency.job_addresses() {
            if section.world != self.active || !insert((section.chunk_x, section.chunk_z)) {
                return None;
            }
        }
        Some(chunks.into_iter().collect())
    }

    #[must_use]
    pub fn scheduler_jobs_within_chunks(&self, chunks: &BTreeSet<(i32, i32)>) -> bool {
        let scheduler = &self.active_shard().residency;
        !scheduler.has_orphaned_cancelled_jobs()
            && scheduler
                .job_addresses()
                .all(|section| section.world == self.active && chunks.contains(&(section.chunk_x, section.chunk_z)))
    }

    pub fn scheduler_mut(&mut self) -> &mut SectionResidencySchedulerV1 {
        &mut self.active_shard_mut().residency
    }

    pub fn install_section(
        &mut self,
        token: &ResidencyJobTokenV1,
        mut install: SectionInstallV1,
    ) -> AuthorityResult<ResidencyCompletionV1> {
        install.validate()?;
        if install.address.world != self.active {
            return Err(AuthorityError::new(
                "address-mismatch",
                "section belongs to another location",
            ));
        }
        if install.address != token.request.address || install.source_hash != token.source_hash {
            return Err(AuthorityError::new(
                "source-mismatch",
                "section result does not match residency job",
            ));
        }
        let current_revision = self.revision();
        let completion = self.active_shard_mut().residency.finish(token, current_revision);
        if !matches!(completion, ResidencyCompletionV1::Accepted(_)) {
            return Ok(completion);
        }
        let journal = self
            .active_shard()
            .edit_journal
            .iter()
            .filter(|(position, _)| position.section_address(&self.active) == install.address)
            .map(|(position, cell)| (*position, *cell))
            .collect::<Vec<_>>();
        for (position, cell) in journal {
            install.cells[position.section_index()] = cell;
        }
        let shard = self.active_shard_mut();
        let revision = shard
            .revisions
            .get(&install.address)
            .copied()
            .unwrap_or(WorldSectionRevisionV1 {
                blocks: install.source_revision,
                metadata: install.source_revision,
                halo: install.source_revision,
            });
        let content_hash = hash_section_cells(&install.cells);
        shard.sections.insert(
            install.address.clone(),
            SectionRecord {
                cells: install.cells,
                content_hash,
                revision,
                source_revision: install.source_revision,
                source_hash: install.source_hash.clone(),
                dirty: BTreeSet::new(),
            },
        );
        shard.revisions.insert(install.address.clone(), revision);
        shard.revision.residency = shard.revision.residency.saturating_add(1);
        Ok(completion)
    }

    pub fn install_section_for_replay(&mut self, mut install: SectionInstallV1) -> AuthorityResult<()> {
        self.install_section_for_replay_inner(&mut install, false)
    }

    /// Replays deterministic generated bytes while retaining any authored
    /// section revision lane preserved across residency eviction.
    pub fn install_section_for_residency_replay(&mut self, mut install: SectionInstallV1) -> AuthorityResult<()> {
        self.install_section_for_replay_inner(&mut install, true)
    }

    fn install_section_for_replay_inner(
        &mut self,
        install: &mut SectionInstallV1,
        retain_revision: bool,
    ) -> AuthorityResult<()> {
        install.validate()?;
        if install.address.world != self.active {
            return Err(AuthorityError::new(
                "address-mismatch",
                "section belongs to another location",
            ));
        }
        let shard = self.active_shard_mut();
        let generated_revision = WorldSectionRevisionV1 {
            blocks: install.source_revision,
            metadata: install.source_revision,
            halo: install.source_revision,
        };
        let revision = if retain_revision {
            shard
                .revisions
                .get(&install.address)
                .copied()
                .unwrap_or(generated_revision)
        } else {
            generated_revision
        };
        for (position, cell) in shard
            .edit_journal
            .iter()
            .filter(|(position, _)| position.section_address(&shard.address) == install.address)
        {
            install.cells[position.section_index()] = *cell;
        }
        let content_hash = hash_section_cells(&install.cells);
        shard.sections.insert(
            install.address.clone(),
            SectionRecord {
                cells: std::mem::take(&mut install.cells),
                content_hash,
                revision,
                source_revision: install.source_revision,
                source_hash: install.source_hash.clone(),
                dirty: BTreeSet::new(),
            },
        );
        shard.revisions.insert(install.address.clone(), revision);
        shard.revision.residency = shard.revision.residency.saturating_add(1);
        Ok(())
    }

    pub fn evict_section(&mut self, address: &WorldSectionAddressV1) -> bool {
        if address.world != self.active {
            return false;
        }
        let shard = self.active_shard_mut();
        shard.residency.cancel_section(address);
        let removed = shard.sections.remove(address).is_some();
        if removed {
            let chunk = address.chunk();
            if !shard.sections.keys().any(|section| section.chunk() == chunk) {
                shard.chunk_auxiliary.remove(&chunk);
            }
            shard.revision.residency = shard.revision.residency.saturating_add(1);
        }
        removed
    }

    /// Evicts all disposable generated state for one active-location chunk in
    /// one revision step. Authored edits and only the section revision ledger
    /// required by their generation halo stay intact so revisit replay remains
    /// exact without retaining generated-only travel history.
    pub fn evict_chunk(&mut self, address: &WorldChunkAddressV1) -> u16 {
        if address.world != self.active {
            return 0;
        }
        let shard = self.active_shard_mut();
        let scheduled_removed = shard.residency.remove_chunk(address);
        let sections = shard
            .sections
            .keys()
            .filter(|section| section.chunk_x == address.chunk_x && section.chunk_z == address.chunk_z)
            .cloned()
            .collect::<Vec<_>>();
        for section in &sections {
            shard.residency.cancel_section(section);
            shard.sections.remove(section);
        }
        let auxiliary_removed = shard.chunk_auxiliary.remove(address).is_some();
        let journal_halo = journal_revision_chunk_coordinates(shard);
        let revisions_before = shard.revisions.len();
        shard.revisions.retain(|section, _| {
            section.chunk_x != address.chunk_x
                || section.chunk_z != address.chunk_z
                || journal_halo.contains(&(section.chunk_x, section.chunk_z))
        });
        let revisions_removed = shard.revisions.len() != revisions_before;
        if !sections.is_empty() || auxiliary_removed || scheduled_removed != 0 || revisions_removed {
            shard.revision.residency = shard.revision.residency.saturating_add(1);
        }
        u16::try_from(sections.len()).expect("a world chunk has at most the bounded section count")
    }

    pub fn switch_active_location(&mut self, address: WorldAddressV1) -> AuthorityResult<()> {
        address.validate()?;
        if address == self.active {
            return Ok(());
        }
        {
            let old = self.active_shard_mut();
            old.sections.clear();
            old.chunk_auxiliary.clear();
            old.events.clear();
            old.revision.epoch = old.revision.epoch.saturating_add(1);
            old.revision.residency = old.revision.residency.saturating_add(1);
            old.residency.reset(old.revision.epoch);
        }
        let epoch = self.next_epoch;
        self.next_epoch = self.next_epoch.saturating_add(1);
        let shard = self
            .locations
            .entry(address.clone())
            .or_insert_with(|| LocationShard::new(address.clone(), epoch));
        shard.sections.clear();
        shard.chunk_auxiliary.clear();
        shard.events.clear();
        shard.revision.epoch = epoch;
        shard.revision.residency = shard.revision.residency.saturating_add(1);
        shard.residency.reset(epoch);
        self.active = address;
        Ok(())
    }

    pub fn apply_mutation_batch(&mut self, mut batch: WorldMutationBatchR4V1) -> WorldMutationReceiptR4V1 {
        let current = self.identity();
        if let Err(error) = validate_mutation_batch(&mut batch) {
            return WorldMutationReceiptR4V1::Rejected {
                batch_id: batch.batch_id.clone(),
                code: MutationRejectionCodeR4V1::InvalidCommand,
                message: error.to_string(),
                identity: current,
            };
        }
        let reject = |code, message: String| WorldMutationReceiptR4V1::Rejected {
            batch_id: batch.batch_id.clone(),
            code,
            message,
            identity: current.clone(),
        };
        if batch.address != self.active {
            return reject(
                MutationRejectionCodeR4V1::AddressMismatch,
                "mutation batch belongs to another world location".into(),
            );
        }
        if batch.expected_revision != current.revision {
            return reject(
                MutationRejectionCodeR4V1::StaleRevision,
                "mutation batch expected an obsolete world revision".into(),
            );
        }

        let mut desired = BTreeMap::<CellPositionV1, (WorldCellV1, WorldCellV1)>::new();
        for command in &batch.commands {
            let position = command.position();
            if position.y < WORLD_MIN_Y_V1 || position.y > WORLD_MAX_Y_V1 {
                return reject(
                    MutationRejectionCodeR4V1::VerticalBoundary,
                    format!("cannot edit outside {WORLD_MIN_Y_V1}..{WORLD_MAX_Y_V1}"),
                );
            }
            let entry = if let Some(value) = desired.get_mut(&position) {
                value
            } else {
                let WorldCellReadV1::Loaded {
                    cell,
                    boundary: WorldBoundaryKindV1::None,
                    ..
                } = self.read_authoritative_cell(position)
                else {
                    return reject(
                        MutationRejectionCodeR4V1::UnloadedCell,
                        format!("cannot edit unloaded cell {},{},{}", position.x, position.y, position.z),
                    );
                };
                desired.entry(position).or_insert((cell, cell))
            };
            match command {
                WorldMutationCommandR4V1::SetBlock { block_id, facing, .. } => {
                    let old_block = entry.1.block_id;
                    entry.1.block_id =
                        if *block_id == WORLD_AIR_BLOCK_ID_V1 && self.catalog.waterlogged_blocks.contains(&old_block) {
                            self.catalog.water_block_id
                        } else {
                            *block_id
                        };
                    if self.catalog.directional_blocks.contains(&entry.1.block_id) {
                        if let Some(value) = facing {
                            entry.1.facing = *value;
                        }
                    } else {
                        entry.1.facing = 0;
                    }
                }
                WorldMutationCommandR4V1::SetFacing { facing, .. } => {
                    if !self.catalog.directional_blocks.contains(&entry.1.block_id) {
                        return reject(
                            MutationRejectionCodeR4V1::FacingNotSupported,
                            format!(
                                "block {} at {},{},{} is not directional",
                                entry.1.block_id, position.x, position.y, position.z
                            ),
                        );
                    }
                    entry.1.facing = *facing;
                }
                WorldMutationCommandR4V1::SetLiquid { liquid, .. } => entry.1.liquid = *liquid,
            }
        }

        let changes = desired
            .into_iter()
            .filter_map(|(position, (previous, current))| {
                (previous != current).then_some(WorldCommittedCellR4V1 {
                    position,
                    previous,
                    current,
                })
            })
            .collect::<Vec<_>>();
        if changes.is_empty() {
            return WorldMutationReceiptR4V1::Accepted {
                batch_id: batch.batch_id,
                mutated: false,
                before: current.clone(),
                after: current,
                changes,
                dirty: WorldDirtySetR4V1::empty(),
                delta: None,
                immediate_event: None,
            };
        }

        let mutation_seed = mutation_seed(&batch, &current, &changes);
        let dirty = create_dirty_set(&self.active, &changes, &mutation_seed);
        let shard = self.active_shard_mut();
        shard.revision.mutation = shard.revision.mutation.saturating_add(1);
        let mutation_revision = shard.revision.mutation;
        let mut changed_sections = BTreeSet::new();
        for change in &changes {
            let address = change.position.section_address(&shard.address);
            let record = shard
                .sections
                .get_mut(&address)
                .expect("preflight required resident section");
            record.cells[change.position.section_index()] = change.current;
            record.revision.blocks = mutation_revision;
            if change.previous.facing != change.current.facing || change.previous.liquid != change.current.liquid {
                record.revision.metadata = mutation_revision;
            }
            shard.revisions.insert(address.clone(), record.revision);
            if let Some(previous) = shard.edit_journal.insert(change.position, change.current) {
                shard
                    .edit_journal_digest
                    .remove(hash_edit_journal_entry(change.position, previous));
            }
            shard
                .edit_journal_digest
                .add(hash_edit_journal_entry(change.position, change.current));
            changed_sections.insert(address);
        }
        for address in changed_sections {
            let record = shard
                .sections
                .get_mut(&address)
                .expect("changed section remains resident through commit");
            record.content_hash = hash_section_cells(&record.cells);
        }
        for address in &dirty.sections {
            let revision = shard.revisions.entry(address.clone()).or_default();
            revision.halo = mutation_revision;
            if let Some(record) = shard.sections.get_mut(address) {
                record.revision.halo = mutation_revision;
                record.dirty.extend(DIRTY_SUBSYSTEMS_R4_V1);
            }
        }
        let after = shard.identity();
        let delta = create_network_delta(&batch.batch_id, current.clone(), after.clone(), changes.clone());
        let immediate = ImmediateWorldEditEventR4V1 {
            sequence: shard.next_event_sequence,
            address: shard.address.clone(),
            batch_id: batch.batch_id.clone(),
            identity: after.clone(),
            changes: changes.clone(),
            dirty_sections: dirty.sections.clone(),
        };
        shard.next_event_sequence = shard.next_event_sequence.saturating_add(1);
        if shard.events.len() == WORLD_IMMEDIATE_EVENT_CAPACITY_V1 {
            shard.events.pop_front();
        }
        shard.events.push_back(immediate.clone());
        WorldMutationReceiptR4V1::Accepted {
            batch_id: batch.batch_id,
            mutated: true,
            before: current,
            after,
            changes,
            dirty,
            delta: Some(Box::new(delta)),
            immediate_event: Some(Box::new(immediate)),
        }
    }

    pub fn drain_immediate_events(&mut self) -> Vec<ImmediateWorldEditEventR4V1> {
        self.active_shard_mut().events.drain(..).collect()
    }

    #[must_use]
    pub fn read_cell(&self, position: CellPositionV1) -> WorldCellReadV1 {
        self.read_authoritative_cell(position)
    }

    #[must_use]
    pub fn current_section_revision(&self, address: &WorldSectionAddressV1) -> Option<WorldSectionRevisionV1> {
        self.section_revision(address)
    }

    #[must_use]
    pub fn section_source_identity(&self, address: &WorldSectionAddressV1) -> Option<(u64, &str)> {
        self.active_shard()
            .sections
            .get(address)
            .map(|record| (record.source_revision, record.source_hash.as_str()))
    }

    #[must_use]
    pub fn edit_journal(&self) -> &BTreeMap<CellPositionV1, WorldCellV1> {
        &self.active_shard().edit_journal
    }

    pub fn install_chunk_auxiliary(&mut self, data: ChunkAuxiliaryDataV1) -> AuthorityResult<()> {
        data.validate()?;
        if data.address.world != self.active {
            return Err(AuthorityError::new(
                "address-mismatch",
                "chunk auxiliary data belongs to another location",
            ));
        }
        let content_hash = hash_chunk_auxiliary(&data);
        let shard = self.active_shard_mut();
        shard
            .chunk_auxiliary
            .insert(data.address.clone(), ChunkAuxiliaryRecord { data, content_hash });
        shard.revision.residency = shard.revision.residency.saturating_add(1);
        Ok(())
    }

    /// Applies a sparse auxiliary update only when it extends the exact source
    /// identity currently resident for the chunk. The candidate is validated
    /// before replacement, so stale, malformed, or interrupted patches leave
    /// every auxiliary stream unchanged.
    pub fn patch_chunk_auxiliary(&mut self, patch: ChunkAuxiliaryPatchV1) -> AuthorityResult<()> {
        patch.validate()?;
        if patch.address.world != self.active {
            return Err(AuthorityError::new(
                "address-mismatch",
                "chunk auxiliary patch belongs to another location",
            ));
        }
        let current = self.active_shard().chunk_auxiliary.get(&patch.address).ok_or_else(|| {
            AuthorityError::new("chunk-auxiliary-missing", "auxiliary patch requires a resident base")
        })?;
        if current.data.source_revision != patch.expected_source_revision
            || current.data.source_hash != patch.expected_source_hash
        {
            return Err(AuthorityError::new(
                "chunk-auxiliary-stale",
                "auxiliary patch does not extend the resident source identity",
            ));
        }
        let mut data = current.data.clone();
        data.source_revision = patch.source_revision;
        data.source_hash = patch.source_hash;
        for (section, values) in patch.light_sections {
            let start = section as usize * WORLD_SECTION_CELL_COUNT_V1;
            data.light[start..start + WORLD_SECTION_CELL_COUNT_V1].copy_from_slice(&values);
        }
        for (index, value) in patch.section_block_counts {
            data.section_block_counts[usize::from(index)] = value;
        }
        for (index, value) in patch.sky_tops {
            data.sky_tops[usize::from(index)] = value;
        }
        if let Some(values) = patch.light_indices {
            data.light_indices = values;
        }
        if let Some(values) = patch.leaf_indices {
            data.leaf_indices = values;
        }
        if let Some(values) = patch.markers {
            data.markers = values;
        }
        data.validate()?;
        let content_hash = hash_chunk_auxiliary(&data);
        let next_residency = self.active_shard().revision.residency.saturating_add(1);
        let shard = self.active_shard_mut();
        shard
            .chunk_auxiliary
            .insert(data.address.clone(), ChunkAuxiliaryRecord { data, content_hash });
        shard.revision.residency = next_residency;
        Ok(())
    }

    #[must_use]
    pub fn chunk_auxiliary(&self, address: &crate::WorldChunkAddressV1) -> Option<&ChunkAuxiliaryDataV1> {
        (address.world == self.active)
            .then(|| self.active_shard().chunk_auxiliary.get(address))
            .flatten()
            .map(|record| &record.data)
    }

    /// Canonical digest of every authoritative location, resident section, and
    /// authored edit. Presentation queues and disposable cache bytes are
    /// intentionally excluded; the scheduler's committed residency revision is
    /// included through each shard revision.
    #[must_use]
    pub fn canonical_state_hash(&self) -> CanonicalHash {
        let mut hasher = CanonicalHasher::new("blockwild-world-authority-store-v1");
        hasher.write_str(&self.active.key());
        hasher.write_u64(self.next_epoch);
        hasher.write_u16(self.catalog.water_block_id);
        hasher.write_u32(self.catalog.directional_blocks.len() as u32);
        for block in &self.catalog.directional_blocks {
            hasher.write_u16(*block);
        }
        hasher.write_u32(self.catalog.waterlogged_blocks.len() as u32);
        for block in &self.catalog.waterlogged_blocks {
            hasher.write_u16(*block);
        }
        hasher.write_u32(self.locations.len() as u32);
        for (address, shard) in &self.locations {
            hasher.write_str(&address.key());
            hasher.write_u64(shard.revision.epoch);
            hasher.write_u64(shard.revision.mutation);
            hasher.write_u64(shard.revision.residency);
            hasher.write_u64(shard.next_event_sequence);
            hasher.write_bytes(shard.residency.canonical_hash().as_bytes());
            hasher.write_u32(shard.revisions.len() as u32);
            for (section_address, revision) in &shard.revisions {
                hasher.write_str(&section_address.key());
                hasher.write_u64(revision.blocks);
                hasher.write_u64(revision.metadata);
                hasher.write_u64(revision.halo);
            }
            hasher.write_u32(shard.sections.len() as u32);
            for (section_address, section) in &shard.sections {
                hasher.write_str(&section_address.key());
                hasher.write_u64(section.revision.blocks);
                hasher.write_u64(section.revision.metadata);
                hasher.write_u64(section.revision.halo);
                hasher.write_u64(section.source_revision);
                hasher.write_str(&section.source_hash);
                hasher.write_bytes(section.content_hash.as_bytes());
            }
            hasher.write_u32(shard.chunk_auxiliary.len() as u32);
            for (chunk_address, record) in &shard.chunk_auxiliary {
                hasher.write_str(&chunk_address.key());
                hasher.write_bytes(record.content_hash.as_bytes());
            }
            hasher.write_u32(shard.edit_journal.len() as u32);
            shard.edit_journal_digest.write_hash(&mut hasher);
        }
        hasher.finish()
    }

    #[must_use]
    pub fn is_directional_block(&self, block_id: u16) -> bool {
        self.catalog.directional_blocks.contains(&block_id)
    }

    pub(crate) fn replace_active_journal(
        &mut self,
        cells: BTreeMap<CellPositionV1, WorldCellV1>,
        recorded_revision: WorldAuthorityRevisionV1,
        preserve_recorded_epoch: bool,
    ) {
        let shard = self.active_shard_mut();
        shard.sections.clear();
        shard.revisions.clear();
        shard.chunk_auxiliary.clear();
        shard.events.clear();
        shard.edit_journal_digest = digest_edit_journal(&cells);
        shard.edit_journal = cells;
        shard.revision = WorldAuthorityRevisionV1 {
            epoch: if preserve_recorded_epoch {
                recorded_revision.epoch
            } else {
                shard.revision.epoch
            },
            mutation: recorded_revision.mutation,
            residency: if preserve_recorded_epoch {
                recorded_revision.residency
            } else {
                0
            },
        };
        shard.residency.reset(shard.revision.epoch);
    }

    /// Starts a new live identity after an atomic state replacement.
    ///
    /// Reusing the previous epoch while resetting residency would make the
    /// revision tuple regress and could let an in-flight page or residency job
    /// be mistaken for current work. Replacement therefore consumes a fresh
    /// monotonic epoch even when the imported save recorded an older epoch.
    pub(crate) fn advance_active_replacement_epoch(&mut self) {
        let current_epoch = self.active_shard().revision.epoch;
        let epoch = self.next_epoch.max(current_epoch.saturating_add(1));
        self.next_epoch = epoch.saturating_add(1);
        let shard = self.active_shard_mut();
        shard.revision.epoch = epoch;
        shard.revision.residency = 0;
        shard.events.clear();
        shard.residency.reset(epoch);
    }

    /// Keeps later live epochs monotonic after an explicit replay restore.
    pub(crate) fn reserve_epoch_after(&mut self, epoch: u64) {
        self.next_epoch = self.next_epoch.max(epoch.saturating_add(1));
    }
}

fn write_cell_hash(hasher: &mut CanonicalHasher, cell: WorldCellV1) {
    hasher.write_u16(cell.block_id);
    hasher.write_u16(u16::from(cell.facing));
    hasher.write_u16(u16::from(cell.liquid.kind as u8));
    hasher.write_u16(u16::from(cell.liquid.level));
    hasher.write_u16(u16::from(cell.liquid.flags()));
}

pub(crate) fn hash_section_cells(cells: &[WorldCellV1]) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-world-section-cells-v1");
    hasher.write_u32(cells.len() as u32);
    for cell in cells {
        write_cell_hash(&mut hasher, *cell);
    }
    hasher.finish()
}

fn hash_edit_journal_entry(position: CellPositionV1, cell: WorldCellV1) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-world-authored-edit-v1");
    hasher.write_i32(position.x);
    hasher.write_i32(position.y);
    hasher.write_i32(position.z);
    write_cell_hash(&mut hasher, cell);
    hasher.finish()
}

pub(crate) fn digest_edit_journal(journal: &BTreeMap<CellPositionV1, WorldCellV1>) -> JournalDigestV1 {
    let mut digest = JournalDigestV1::default();
    for (position, cell) in journal {
        digest.add(hash_edit_journal_entry(*position, *cell));
    }
    digest
}

fn hash_lanes(hash: CanonicalHash) -> (u64, u64) {
    let bytes = hash.as_bytes();
    (
        u64::from_le_bytes(bytes[..8].try_into().expect("canonical hash low lane")),
        u64::from_le_bytes(bytes[8..].try_into().expect("canonical hash high lane")),
    )
}

pub(crate) fn hash_chunk_auxiliary(data: &ChunkAuxiliaryDataV1) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-world-chunk-auxiliary-v1");
    hasher.write_u64(data.source_revision);
    hasher.write_str(&data.source_hash);
    hash_i16_slice(&mut hasher, &data.heightmap);
    hasher.write_bytes(&data.biomes);
    hash_u16_slice(&mut hasher, &data.section_block_counts);
    hash_i16_slice(&mut hasher, &data.sky_tops);
    hash_u16_slice(&mut hasher, &data.light);
    hash_u32_slice(&mut hasher, &data.light_indices);
    hash_u32_slice(&mut hasher, &data.leaf_indices);
    hasher.write_u32(data.markers.len() as u32);
    for (key, canonical_json) in &data.markers {
        hasher.write_str(key);
        hasher.write_str(canonical_json);
    }
    hasher.finish()
}

fn hash_i16_slice(hasher: &mut CanonicalHasher, values: &[i16]) {
    hasher.write_u32(values.len() as u32);
    for value in values {
        hasher.write_bytes(&value.to_le_bytes());
    }
}

fn hash_u16_slice(hasher: &mut CanonicalHasher, values: &[u16]) {
    hasher.write_u32(values.len() as u32);
    for value in values {
        hasher.write_u16(*value);
    }
}

fn hash_u32_slice(hasher: &mut CanonicalHasher, values: &[u32]) {
    hasher.write_u32(values.len() as u32);
    for value in values {
        hasher.write_u32(*value);
    }
}

impl WorldReadSourceV1 for WorldAuthorityStoreR4V1 {
    fn address(&self) -> &WorldAddressV1 {
        &self.active
    }

    fn identity(&self) -> WorldAuthorityIdentityV1 {
        WorldAuthorityStoreR4V1::identity(self)
    }

    fn read_authoritative_cell(&self, position: CellPositionV1) -> WorldCellReadV1 {
        if let Some(boundary) = vertical_boundary_cell(position) {
            return boundary;
        }
        let address = position.section_address(&self.active);
        let Some(section) = self.active_shard().sections.get(&address) else {
            return WorldCellReadV1::Unloaded { position };
        };
        WorldCellReadV1::Loaded {
            position,
            boundary: WorldBoundaryKindV1::None,
            cell: section.cells[position.section_index()],
        }
    }

    fn section_cells(&self, address: &WorldSectionAddressV1) -> Option<&[WorldCellV1]> {
        if address.world != self.active {
            return None;
        }
        self.active_shard()
            .sections
            .get(address)
            .map(|section| section.cells.as_slice())
    }

    fn section_revision(&self, address: &WorldSectionAddressV1) -> Option<WorldSectionRevisionV1> {
        if address.world != self.active {
            return None;
        }
        self.active_shard().revision_for(address)
    }
}

fn journal_revision_chunk_coordinates(shard: &LocationShard) -> BTreeSet<(i32, i32)> {
    let mut chunks = BTreeSet::new();
    for position in shard.edit_journal.keys() {
        let chunk_x = position.chunk_x();
        let chunk_z = position.chunk_z();
        for delta_z in [-1_i32, 0, 1] {
            for delta_x in [-1_i32, 0, 1] {
                if let (Some(chunk_x), Some(chunk_z)) = (chunk_x.checked_add(delta_x), chunk_z.checked_add(delta_z)) {
                    chunks.insert((chunk_x, chunk_z));
                }
            }
        }
    }
    chunks
}

fn validate_mutation_batch(batch: &mut WorldMutationBatchR4V1) -> AuthorityResult<()> {
    if batch.schema_version != WORLD_AUTHORITY_SCHEMA_V1 {
        return Err(AuthorityError::new(
            "schema-mismatch",
            "mutation batch schema is incompatible",
        ));
    }
    validate_label(&batch.batch_id, 160, "batchId")?;
    validate_label(&batch.authority_id, 128, "authorityId")?;
    batch.address.validate()?;
    batch.expected_revision.validate()?;
    if batch.commands.len() > WORLD_MUTATION_BATCH_MAX_COMMANDS_V1 {
        return Err(AuthorityError::new(
            "batch-size",
            "mutation batch exceeds command bound",
        ));
    }
    let mut seen = BTreeSet::new();
    for command in &batch.commands {
        let position = command.position();
        if !seen.insert((position, command.order())) {
            return Err(AuthorityError::new(
                "duplicate-command",
                "duplicate command kind at cell",
            ));
        }
        match command {
            WorldMutationCommandR4V1::SetBlock { block_id, facing, .. } => {
                if *block_id == u16::MAX {
                    return Err(AuthorityError::new("block-id", "cannot set unloaded sentinel"));
                }
                if facing.is_some_and(|value| value > 3) {
                    return Err(AuthorityError::new("facing", "facing must be in 0..3"));
                }
            }
            WorldMutationCommandR4V1::SetFacing { facing, .. } => {
                if *facing > 3 {
                    return Err(AuthorityError::new("facing", "facing must be in 0..3"));
                }
            }
            WorldMutationCommandR4V1::SetLiquid { liquid, .. } => liquid.validate()?,
        }
    }
    batch.commands.sort_by_key(|command| {
        let position = command.position();
        (position.y, position.z, position.x, command.order())
    });
    Ok(())
}

fn mutation_seed(
    batch: &WorldMutationBatchR4V1,
    before: &WorldAuthorityIdentityV1,
    changes: &[WorldCommittedCellR4V1],
) -> String {
    let block_changes = changes
        .iter()
        .map(|change| cell_json(change.position, change.current, change.previous))
        .collect::<Vec<_>>()
        .join(",");
    let has_liquid_change = changes
        .iter()
        .any(|change| change.previous.liquid != change.current.liquid);
    let canonical = if has_liquid_change {
        let liquid_changes = changes
            .iter()
            .filter(|change| change.previous.liquid != change.current.liquid)
            .map(|change| {
                format!(
                    "{{\"current\":{},\"previous\":{},\"x\":{},\"y\":{},\"z\":{}}}",
                    liquid_json(change.current.liquid),
                    liquid_json(change.previous.liquid),
                    change.position.x,
                    change.position.y,
                    change.position.z
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "{{\"authorityId\":{},\"batchId\":{},\"before\":{},\"changes\":[{}],\"liquidChanges\":[{}]}}",
            json_string(&batch.authority_id),
            json_string(&batch.batch_id),
            json_string(&before.state_hash),
            block_changes,
            liquid_changes
        )
    } else {
        format!(
            "{{\"authorityId\":{},\"batchId\":{},\"before\":{},\"changes\":[{}]}}",
            json_string(&batch.authority_id),
            json_string(&batch.batch_id),
            json_string(&before.state_hash),
            block_changes
        )
    };
    hash_canonical_json("blockwild-world-mutation-v1", &canonical)
}

fn create_dirty_set(
    address: &WorldAddressV1,
    changes: &[WorldCommittedCellR4V1],
    mutation_seed: &str,
) -> WorldDirtySetR4V1 {
    let mut sections = BTreeSet::new();
    let mut columns = BTreeSet::new();
    for change in changes {
        let position = change.position;
        let section = position.section_address(address);
        add_valid_section(&mut sections, section.clone());
        if position.local_y() == 0 {
            let mut neighbor = section.clone();
            neighbor.section_y -= 1;
            add_valid_section(&mut sections, neighbor);
        }
        if position.local_y() == 15 {
            let mut neighbor = section.clone();
            neighbor.section_y += 1;
            add_valid_section(&mut sections, neighbor);
        }
        if position.local_x() == 0 {
            let mut neighbor = section.clone();
            neighbor.chunk_x -= 1;
            add_valid_section(&mut sections, neighbor);
        }
        if position.local_x() == 15 {
            let mut neighbor = section.clone();
            neighbor.chunk_x += 1;
            add_valid_section(&mut sections, neighbor);
        }
        if position.local_z() == 0 {
            let mut neighbor = section.clone();
            neighbor.chunk_z -= 1;
            add_valid_section(&mut sections, neighbor);
        }
        if position.local_z() == 15 {
            let mut neighbor = section;
            neighbor.chunk_z += 1;
            add_valid_section(&mut sections, neighbor);
        }
        columns.insert((position.x, position.z));
    }
    let mut sections = sections.into_iter().collect::<Vec<_>>();
    sections.sort_by_key(WorldSectionAddressV1::key);
    let columns = columns.into_iter().collect::<Vec<_>>();
    let section_json = sections
        .iter()
        .map(|section| json_string(&section.key()))
        .collect::<Vec<_>>()
        .join(",");
    let column_json = columns
        .iter()
        .map(|(x, z)| format!("{{\"x\":{x},\"z\":{z}}}"))
        .collect::<Vec<_>>()
        .join(",");
    let subsystem_seeds = DIRTY_SUBSYSTEMS_R4_V1
        .into_iter()
        .map(|subsystem| {
            let canonical = format!(
                "{{\"columns\":[{}],\"mutationSeed\":{},\"sections\":[{}]}}",
                column_json,
                json_string(mutation_seed),
                section_json
            );
            DirtySubsystemSeedV1 {
                subsystem,
                seed: hash_canonical_json(
                    &format!("blockwild-world-dirty-{}-v1", subsystem.wire_name()),
                    &canonical,
                ),
            }
        })
        .collect();
    WorldDirtySetR4V1 {
        sections,
        columns,
        subsystem_seeds,
    }
}

fn add_valid_section(sections: &mut BTreeSet<WorldSectionAddressV1>, section: WorldSectionAddressV1) {
    if (0..WORLD_SECTION_COUNT_V1).contains(&i32::from(section.section_y)) {
        sections.insert(section);
    }
}

fn create_network_delta(
    batch_id: &str,
    before: WorldAuthorityIdentityV1,
    after: WorldAuthorityIdentityV1,
    changes: Vec<WorldCommittedCellR4V1>,
) -> WorldNetworkDeltaR4V1 {
    let canonical_changes = changes
        .iter()
        .map(|change| cell_json(change.position, change.current, change.previous))
        .collect::<Vec<_>>()
        .join(",");
    let canonical = format!(
        "{{\"address\":{{\"locationId\":{},\"universeId\":{}}},\"batchId\":{},\"changes\":[{}],\"fromRevision\":{{\"epoch\":{},\"mutation\":{},\"residency\":{}}},\"schemaVersion\":1,\"toRevision\":{{\"epoch\":{},\"mutation\":{},\"residency\":{}}}}}",
        json_string(&before.address.location_id),
        json_string(&before.address.universe_id),
        json_string(batch_id),
        canonical_changes,
        before.revision.epoch,
        before.revision.mutation,
        before.revision.residency,
        after.revision.epoch,
        after.revision.mutation,
        after.revision.residency
    );
    WorldNetworkDeltaR4V1 {
        schema_version: WORLD_AUTHORITY_SCHEMA_V1,
        address: before.address,
        batch_id: batch_id.into(),
        from_revision: before.revision,
        to_revision: after.revision,
        changes,
        checksum: hash_canonical_json("blockwild-world-network-delta-v1", &canonical),
    }
}

pub fn validate_world_job_current_v1(
    authority: &WorldAuthorityStoreR4V1,
    expected_identity: &WorldAuthorityIdentityV1,
    address: &WorldSectionAddressV1,
    expected_revision: WorldSectionRevisionV1,
    source_hash: &str,
) -> bool {
    validate_hash(source_hash, "sourceHash").is_ok()
        && authority.identity() == *expected_identity
        && authority.section_revision(address) == Some(expected_revision)
}
