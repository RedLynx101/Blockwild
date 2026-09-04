//! Native-only exact player continuation. This is not a legacy-save executor,
//! consent validator, grant creator, or Wasm capability. The caller must already
//! own a completely bound native player and pass an exact runtime CAS identity.
//! R6 and V1 input remain compatibility projections; V17 stores the f64 authority.

use super::*;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeExactPlayerBindingV1 {
    pub actor_id: String,
    pub external_entity_id: String,
    pub player_id: PlayerId,
    pub entity_id: EntityId,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimePlayerExactContinuationV1 {
    pub expected: IntegratedRuntimeIdentityV2,
    pub binding: RuntimeExactPlayerBindingV1,
    pub position: [f64; 3],
    pub velocity: [f64; 3],
    pub yaw: f64,
    pub pitch: f64,
}

/// V1 controls retain their exact sequence/target/button semantics. The two
/// legacy look fields must equal the canonical i16 projection of the f64 look.
#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeExactInputFrameV2 {
    pub binding: RuntimeExactPlayerBindingV1,
    pub controls: RuntimeInputFrameV1,
    pub yaw: f64,
    pub pitch: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimePlayerExactStateV1 {
    pub continuation: RuntimePlayerExactContinuationV1,
    pub yaw: f64,
    pub pitch: f64,
    pub input_sequence: u64,
    pub(super) queued: BTreeMap<u64, RuntimeExactInputFrameV2>,
}

impl IntegratedRuntimeV2 {
    #[must_use]
    pub fn exact_player_state_v1(&self) -> Option<&RuntimePlayerExactStateV1> {
        self.exact_player.as_ref()
    }

    /// A trusted native-only CAS, not a migration authorization API. No grants,
    /// custody, transient-state defaults or historical-save interpretation are
    /// introduced here. Existing body latches/profile are retained deliberately.
    pub fn continue_player_exact_pose_v1(
        &mut self,
        request: RuntimePlayerExactContinuationV1,
    ) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        validate_exact_continuation(&request)?;
        if request.expected != self.identity() {
            return Err(exact_error(
                "exact-pose-cas",
                "exact continuation requires the current complete identity",
            ));
        }
        let player = self
            .player
            .as_ref()
            .ok_or_else(|| exact_error("exact-pose-binding", "a native player must already be bound"))?;
        validate_exact_binding(&request.binding, player)?;
        if !self.queued_inputs.is_empty() || !self.queued_context_commands.is_empty() || self.mining_state.is_some() {
            return Err(exact_error(
                "exact-pose-pending",
                "continuation cannot replace pending input, actions or mining",
            ));
        }
        validate_world_view_runtime_links_v1(&self.world_view.state, &self.gameplay.state, &self.entities)
            .map_err(|error| exact_error("exact-pose-custody", &error.to_string()))?;
        let mut candidate = self.clone();
        let mut record = candidate
            .entities
            .hot()
            .get(&player.entity_id)
            .ok_or_else(|| exact_error("exact-pose-binding", "bound entity is not resident"))?
            .record
            .clone();
        record.position = EntityVec3::new(
            request.position[0] as f32,
            request.position[1] as f32,
            request.position[2] as f32,
        );
        record.velocity = EntityVec3::new(
            request.velocity[0] as f32,
            request.velocity[1] as f32,
            request.velocity[2] as f32,
        );
        record.yaw = request.yaw as f32;
        let sequence = candidate
            .entity_command_sequence
            .checked_add(1)
            .ok_or_else(|| exact_error("exact-pose-sequence", "entity command sequence exhausted"))?;
        let receipt = candidate
            .entities
            .apply_batch(&EntityCommandBatch {
                schema: ENTITY_COMMAND_SCHEMA,
                sequence,
                expected_revision: candidate.entities.revision(),
                tick: candidate.tick,
                commands: vec![EntityCommand::ReplaceCompatibilityRecord {
                    id: player.entity_id,
                    value: record,
                }],
            })
            .map_err(|error| IntegratedRuntimeError::domain("exact-pose-entity", error))?;
        candidate.entity_command_sequence = sequence;
        candidate.sync_entity_schedules(std::slice::from_ref(&receipt))?;
        let current = candidate.player.as_mut().expect("validated bound player");
        current.body.position = SimulationVec3::new(request.position[0], request.position[1], request.position[2]);
        current.body.velocity = SimulationVec3::new(request.velocity[0], request.velocity[1], request.velocity[2]);
        validate_body_domain(&current.body)?;
        let (yaw, pitch) = exact_look_projection(request.yaw, request.pitch);
        current.look_pitch = pitch;
        candidate.camera.look_yaw = yaw;
        candidate.camera.look_pitch = pitch;
        candidate.exact_player = Some(RuntimePlayerExactStateV1 {
            yaw: request.yaw,
            pitch: request.pitch,
            input_sequence: current.last_input_sequence,
            continuation: request,
            queued: BTreeMap::new(),
        });
        candidate.simulation_revision = candidate
            .simulation_revision
            .checked_add(1)
            .ok_or_else(|| exact_error("exact-pose-revision", "simulation revision exhausted"))?;
        candidate.invalidate_state_hash();
        candidate.validate_exact_player_projection()?;
        *self = candidate;
        Ok(())
    }

    pub fn accept_exact_inputs_v2(
        &mut self,
        inputs: &[RuntimeExactInputFrameV2],
    ) -> Result<(), IntegratedRuntimeError> {
        self.ensure_running()?;
        if inputs.len() > MAX_INPUT_FRAMES {
            return Err(exact_error(
                "input-capacity",
                "exact input batch exceeds bounded capacity",
            ));
        }
        let player = self
            .player
            .as_ref()
            .ok_or_else(|| exact_error("exact-pose-binding", "native player is missing"))?;
        if self.exact_player.is_none() {
            return Err(exact_error(
                "exact-pose-required",
                "exact input requires an explicit exact continuation",
            ));
        }
        for input in inputs {
            validate_exact_input(input)?;
            validate_exact_binding(&input.binding, player)?;
        }
        // Reuse every legacy admission check transactionally, then attach the
        // exact sidecars to the very same validated controls/sequence queue.
        let mut candidate = self.clone();
        let controls: Vec<_> = inputs.iter().map(|input| input.controls).collect();
        candidate.accept_inputs(&controls)?;
        let exact = candidate.exact_player.as_mut().expect("validated exact authority");
        for input in inputs {
            if exact.queued.insert(input.controls.sequence, input.clone()).is_some() {
                return Err(exact_error(
                    "exact-input-duplicate",
                    "exact input sequence already exists",
                ));
            }
        }
        candidate.invalidate_state_hash();
        *self = candidate;
        Ok(())
    }

    pub(super) fn consume_exact_look(&mut self, input: RuntimeInputFrameV1) -> Result<(), IntegratedRuntimeError> {
        if self.exact_player.is_some() {
            self.validate_exact_player_projection()?;
            let mut candidate = self.clone();
            let exact = candidate.exact_player.as_mut().expect("exact mode");
            let (yaw, pitch) = if let Some(sidecar) = exact.queued.remove(&input.sequence) {
                if sidecar.controls != input || sidecar.binding != exact.continuation.binding {
                    return Err(exact_error(
                        "exact-input-binding",
                        "exact sidecar contradicts the consumed controls",
                    ));
                }
                (sidecar.yaw, sidecar.pitch)
            } else {
                legacy_look(input.look_yaw, input.look_pitch)
            };
            exact.yaw = yaw;
            exact.pitch = pitch;
            exact.input_sequence = input.sequence;
            let projected = exact_look_projection(yaw, pitch);
            candidate.camera.look_yaw = projected.0;
            candidate.camera.look_pitch = projected.1;
            let player = candidate.player.as_mut().expect("validated exact player");
            player.look_pitch = projected.1;
            player.last_input_sequence = input.sequence;
            // Action dispatch follows look resolution, before physics. Keep
            // its cross-domain CAS state coherent even for a look-only input.
            let entity_id = player.entity_id;
            let mut record = candidate
                .entities
                .hot()
                .get(&entity_id)
                .expect("validated resident")
                .record
                .clone();
            if record.yaw.to_bits() != (yaw as f32).to_bits() {
                record.yaw = yaw as f32;
                let sequence = candidate
                    .entity_command_sequence
                    .checked_add(1)
                    .ok_or_else(|| exact_error("exact-pose-sequence", "entity command sequence exhausted"))?;
                let receipt = candidate
                    .entities
                    .apply_batch(&EntityCommandBatch {
                        schema: ENTITY_COMMAND_SCHEMA,
                        sequence,
                        expected_revision: candidate.entities.revision(),
                        tick: candidate.tick,
                        commands: vec![EntityCommand::ReplaceCompatibilityRecord {
                            id: entity_id,
                            value: record,
                        }],
                    })
                    .map_err(|error| IntegratedRuntimeError::domain("exact-look-entity", error))?;
                candidate.entity_command_sequence = sequence;
                candidate.sync_entity_schedules(std::slice::from_ref(&receipt))?;
            }
            candidate.invalidate_state_hash();
            candidate.validate_exact_player_projection()?;
            *self = candidate;
        }
        Ok(())
    }

    /// Seals a read-only projection from runtime-owned values, never from a
    /// guest pose. The codec's hash alone does not attest this producer origin.
    pub fn network_player_pose_v2(&self) -> Result<blockwild_network::NetworkPlayerPoseV2, IntegratedRuntimeError> {
        self.ensure_running()?;
        self.validate_exact_player_projection()?;
        let player = self
            .player
            .as_ref()
            .ok_or_else(|| exact_error("exact-pose-binding", "network pose requires a bound native player"))?;
        let identity = self.identity();
        let revision = identity.revision;
        let (yaw, pitch) = self.resolved_look(RuntimeInputFrameV1 {
            look_yaw: self.camera.look_yaw,
            look_pitch: self.camera.look_pitch,
            ..RuntimeInputFrameV1::default()
        });
        blockwild_network::NetworkPlayerPoseV2::new(blockwild_network::NetworkPlayerPoseSourceV2 {
            universe_id: identity.universe_id,
            location_id: identity.location_id,
            session_id: self.config.session_id.clone(),
            actor_id: player.binding.actor_id.clone(),
            external_entity_id: player.binding.external_entity_id.clone(),
            player_id: player.binding.player_id,
            entity_id: player.entity_id,
            tick: self.tick,
            input_sequence: player.last_input_sequence,
            revision: blockwild_network::NetworkPlayerPoseRevisionV2 {
                epoch: revision.epoch,
                world: revision.world,
                entities: revision.entities,
                gameplay: revision.gameplay,
                persistence: revision.persistence,
                network: revision.network,
                simulation: revision.simulation,
            },
            state_hash: identity.state_hash,
            position: [player.body.position.x, player.body.position.y, player.body.position.z],
            velocity: [player.body.velocity.x, player.body.velocity.y, player.body.velocity.z],
            yaw,
            pitch,
            grounded: player.body.grounded,
        })
        .map_err(|error| IntegratedRuntimeError::domain("exact-network-pose", error))
    }

    pub(super) fn resolved_look(&self, input: RuntimeInputFrameV1) -> (f64, f64) {
        self.exact_player.as_ref().map_or_else(
            || legacy_look(input.look_yaw, input.look_pitch),
            |exact| (exact.yaw, exact.pitch),
        )
    }

    pub(super) fn directional_placement_facing(&self, input: RuntimeInputFrameV1) -> u8 {
        self.exact_player.as_ref().map_or_else(
            || directional_placement_facing_v1(input.look_yaw),
            |_| directional_placement_facing_exact_v1(self.resolved_look(input).0),
        )
    }

    pub(super) fn validate_exact_player_projection(&self) -> Result<(), IntegratedRuntimeError> {
        if let Some(exact) = &self.exact_player {
            validate_exact_state(exact, self.player.as_ref(), self.camera, &self.queued_inputs)?;
            let player = self.player.as_ref().expect("validated exact player");
            let record = &self
                .entities
                .hot()
                .get(&player.entity_id)
                .ok_or_else(|| exact_error("exact-pose-binding", "exact player entity is not resident"))?
                .record;
            if !f32_projection_matches(record.position, player.body.position)
                || !f32_projection_matches(record.velocity, player.body.velocity)
                || record.yaw.to_bits() != (exact.yaw as f32).to_bits()
            {
                return Err(exact_error(
                    "exact-pose-projection",
                    "R6 bits contradict the runtime-owned exact pose",
                ));
            }
        }
        Ok(())
    }
}

fn exact_error(code: &'static str, message: &str) -> IntegratedRuntimeError {
    IntegratedRuntimeError::new(code, message)
}

pub(super) fn f32_projection_matches(legacy: EntityVec3, exact: SimulationVec3) -> bool {
    legacy.x.to_bits() == (exact.x as f32).to_bits()
        && legacy.y.to_bits() == (exact.y as f32).to_bits()
        && legacy.z.to_bits() == (exact.z as f32).to_bits()
}

fn legacy_look(yaw: i16, pitch: i16) -> (f64, f64) {
    (
        normalized_i16(yaw) * std::f64::consts::PI,
        normalized_i16(pitch) * std::f64::consts::FRAC_PI_2,
    )
}

#[must_use]
pub fn exact_look_projection(yaw: f64, pitch: f64) -> (i16, i16) {
    (
        (yaw / std::f64::consts::PI * f64::from(i16::MAX)).round() as i16,
        (pitch / std::f64::consts::FRAC_PI_2 * f64::from(i16::MAX)).round() as i16,
    )
}

fn validate_look(yaw: f64, pitch: f64) -> Result<(), IntegratedRuntimeError> {
    if !yaw.is_finite()
        || !pitch.is_finite()
        || yaw.abs() > std::f64::consts::PI
        || pitch.abs() > std::f64::consts::FRAC_PI_2
    {
        return Err(exact_error(
            "exact-look-bounds",
            "look must be finite and within the native camera domain, without normalization",
        ));
    }
    Ok(())
}

fn validate_binding_shape(binding: &RuntimeExactPlayerBindingV1) -> Result<(), IntegratedRuntimeError> {
    if [&binding.actor_id, &binding.external_entity_id]
        .iter()
        .any(|label| label.is_empty() || label.len() > 512 || label.chars().any(char::is_control))
        || binding.player_id.packed() == 0
        || binding.entity_id.0.generation() == 0
    {
        return Err(exact_error(
            "exact-pose-binding",
            "exact actor/player/entity generation binding is invalid",
        ));
    }
    Ok(())
}

fn validate_exact_binding(
    binding: &RuntimeExactPlayerBindingV1,
    player: &IntegratedRuntimePlayerStateV2,
) -> Result<(), IntegratedRuntimeError> {
    validate_binding_shape(binding)?;
    if binding.actor_id != player.binding.actor_id
        || binding.external_entity_id != player.binding.external_entity_id
        || binding.player_id != player.binding.player_id
        || binding.entity_id != player.entity_id
    {
        return Err(exact_error(
            "exact-pose-binding",
            "exact input or continuation belongs to another native binding",
        ));
    }
    Ok(())
}

fn validate_exact_continuation(request: &RuntimePlayerExactContinuationV1) -> Result<(), IntegratedRuntimeError> {
    validate_binding_shape(&request.binding)?;
    validate_look(request.yaw, request.pitch)?;
    if request
        .position
        .iter()
        .any(|v| !v.is_finite() || v.abs() > blockwild_simulation::PHYSICS_MAX_ABS_POSITION_V1)
        || request
            .velocity
            .iter()
            .any(|v| !v.is_finite() || v.abs() > blockwild_simulation::PHYSICS_MAX_ABS_VELOCITY_V1)
        || request.expected.schema_version != INTEGRATED_RUNTIME_SCHEMA_V2
    {
        return Err(exact_error(
            "exact-pose-bounds",
            "exact continuation exceeds the native finite physics/identity domain",
        ));
    }
    for component in request.position {
        // Keep the world-window/floor conversion prerequisite explicit even
        // though the tighter physics bound currently sits well inside i32.
        floor_i32(component)?;
    }
    AuthorityWorldAddressV1::new(&request.expected.universe_id, &request.expected.location_id)
        .map_err(|error| IntegratedRuntimeError::domain("exact-pose-world", error))?;
    Ok(())
}

fn validate_exact_input(input: &RuntimeExactInputFrameV2) -> Result<(), IntegratedRuntimeError> {
    validate_binding_shape(&input.binding)?;
    validate_look(input.yaw, input.pitch)?;
    if exact_look_projection(input.yaw, input.pitch) != (input.controls.look_yaw, input.controls.look_pitch)
        || input.controls.sequence == 0
        || input.controls.selected_slot > 8
        || input.controls.buttons & !RUNTIME_INPUT_BUTTON_MASK_V1 != 0
        || input.controls.flags & !RUNTIME_INPUT_FLAG_MASK_V1 != 0
    {
        return Err(exact_error(
            "exact-input-projection",
            "exact input controls or legacy look projection are noncanonical",
        ));
    }
    Ok(())
}

pub(super) fn validate_exact_state(
    exact: &RuntimePlayerExactStateV1,
    player: Option<&IntegratedRuntimePlayerStateV2>,
    camera: IntegratedRuntimeCameraStateV1,
    queue: &VecDeque<RuntimeInputFrameV1>,
) -> Result<(), IntegratedRuntimeError> {
    validate_exact_continuation(&exact.continuation)?;
    validate_look(exact.yaw, exact.pitch)?;
    let player = player.ok_or_else(|| exact_error("exact-pose-binding", "exact continuation has no player"))?;
    validate_exact_binding(&exact.continuation.binding, player)?;
    validate_body_domain(&player.body)?;
    if exact_look_projection(exact.yaw, exact.pitch) != (camera.look_yaw, camera.look_pitch)
        || player.look_pitch != camera.look_pitch
        || player.last_input_sequence != exact.input_sequence
        || exact.queued.len() > MAX_INPUT_FRAMES
    {
        return Err(exact_error(
            "exact-pose-projection",
            "exact state contradicts camera/player projections or sequence",
        ));
    }
    for (sequence, input) in &exact.queued {
        validate_exact_input(input)?;
        if *sequence != input.controls.sequence
            || input.binding != exact.continuation.binding
            || !queue.iter().any(|controls| *controls == input.controls)
        {
            return Err(exact_error(
                "exact-input-binding",
                "exact queued sidecar is orphaned or contradicts its control queue",
            ));
        }
    }
    Ok(())
}

fn write_binding(
    writer: &mut NativeWriterV1,
    binding: &RuntimeExactPlayerBindingV1,
) -> Result<(), IntegratedRuntimeError> {
    writer.string(&binding.actor_id)?;
    writer.string(&binding.external_entity_id)?;
    writer.u64(binding.player_id.packed());
    writer.u64(binding.entity_id.packed());
    Ok(())
}

fn read_binding(reader: &mut NativeReaderV1<'_>) -> Result<RuntimeExactPlayerBindingV1, IntegratedRuntimeError> {
    let actor_id = reader.string()?;
    let external_entity_id = reader.string()?;
    let player = reader.u64()?;
    let entity = reader.u64()?;
    let value = RuntimeExactPlayerBindingV1 {
        actor_id,
        external_entity_id,
        player_id: PlayerId::new(player as u32, (player >> 32) as u32),
        entity_id: EntityId::new(entity as u32, (entity >> 32) as u32),
    };
    validate_binding_shape(&value)?;
    Ok(value)
}

fn validate_body_domain(body: &PhysicsBodyV1) -> Result<(), IntegratedRuntimeError> {
    if [body.position.x, body.position.y, body.position.z]
        .iter()
        .any(|v| !v.is_finite() || v.abs() > blockwild_simulation::PHYSICS_MAX_ABS_POSITION_V1)
        || [body.velocity.x, body.velocity.y, body.velocity.z]
            .iter()
            .any(|v| !v.is_finite() || v.abs() > blockwild_simulation::PHYSICS_MAX_ABS_VELOCITY_V1)
    {
        return Err(exact_error(
            "exact-pose-body",
            "exact body exceeds finite native physics coordinates/velocity",
        ));
    }
    Ok(())
}

pub fn encode_runtime_exact_input_v2(value: &RuntimeExactInputFrameV2) -> Result<Vec<u8>, IntegratedRuntimeError> {
    validate_exact_input(value)?;
    let mut writer = NativeWriterV1::default();
    writer.raw(b"BWXI");
    writer.u16(2);
    writer.u16(0);
    write_binding(&mut writer, &value.binding)?;
    write_runtime_input_v1(&mut writer, value.controls);
    writer.f64(value.yaw);
    writer.f64(value.pitch);
    let hash = persistence_payload_hash_v1(&writer.bytes);
    writer.hash(hash);
    Ok(writer.finish())
}

pub fn decode_runtime_exact_input_v2(bytes: &[u8]) -> Result<RuntimeExactInputFrameV2, IntegratedRuntimeError> {
    if bytes.len() < 80 || bytes.len() > 1_200 {
        return Err(exact_error(
            "exact-input-length",
            "exact input packet is outside its bounded size",
        ));
    }
    let mut reader = NativeReaderV1::new(bytes);
    reader.magic(b"BWXI")?;
    if reader.u16()? != 2 || reader.u16()? != 0 {
        return Err(exact_error("exact-input-schema", "unknown exact input schema or flags"));
    }
    let value = RuntimeExactInputFrameV2 {
        binding: read_binding(&mut reader)?,
        controls: read_runtime_input_v1(&mut reader)?,
        yaw: reader.f64()?,
        pitch: reader.f64()?,
    };
    let hash = reader.hash()?;
    reader.finish()?;
    validate_exact_input(&value)?;
    if hash != persistence_payload_hash_v1(&bytes[..bytes.len() - 16])
        || encode_runtime_exact_input_v2(&value)? != bytes
    {
        return Err(exact_error(
            "exact-input-hash",
            "exact input is corrupt or noncanonical",
        ));
    }
    Ok(value)
}

pub(super) fn encode_exact_state(exact: &RuntimePlayerExactStateV1) -> Result<Vec<u8>, IntegratedRuntimeError> {
    let mut writer = NativeWriterV1::default();
    writer.u16(1);
    let request = &exact.continuation;
    writer.u16(request.expected.schema_version);
    writer.string(&request.expected.universe_id)?;
    writer.string(&request.expected.location_id)?;
    write_runtime_revision_v1(&mut writer, request.expected.revision);
    writer.u64(request.expected.tick);
    writer.hash(request.expected.state_hash);
    write_binding(&mut writer, &request.binding)?;
    for value in
        request
            .position
            .into_iter()
            .chain(request.velocity)
            .chain([request.yaw, request.pitch, exact.yaw, exact.pitch])
    {
        writer.f64(value);
    }
    writer.u64(exact.input_sequence);
    writer.u32(exact.queued.len() as u32);
    for input in exact.queued.values() {
        writer.bytes(&encode_runtime_exact_input_v2(input)?)?;
    }
    Ok(writer.finish())
}

pub(super) fn decode_exact_state(bytes: &[u8]) -> Result<RuntimePlayerExactStateV1, IntegratedRuntimeError> {
    let mut reader = NativeReaderV1::new(bytes);
    if reader.u16()? != 1 {
        return Err(exact_error("exact-state-schema", "unknown exact continuation schema"));
    }
    let expected = IntegratedRuntimeIdentityV2 {
        schema_version: reader.u16()?,
        universe_id: reader.string()?,
        location_id: reader.string()?,
        revision: read_runtime_revision_v1(&mut reader)?,
        tick: reader.u64()?,
        state_hash: reader.hash()?,
    };
    let binding = read_binding(&mut reader)?;
    let request = RuntimePlayerExactContinuationV1 {
        expected,
        binding,
        position: [reader.f64()?, reader.f64()?, reader.f64()?],
        velocity: [reader.f64()?, reader.f64()?, reader.f64()?],
        yaw: reader.f64()?,
        pitch: reader.f64()?,
    };
    let mut exact = RuntimePlayerExactStateV1 {
        continuation: request,
        yaw: reader.f64()?,
        pitch: reader.f64()?,
        input_sequence: reader.u64()?,
        queued: BTreeMap::new(),
    };
    let count = reader.count(MAX_INPUT_FRAMES, "exact queued inputs")?;
    let mut previous = 0;
    for _ in 0..count {
        let input = decode_runtime_exact_input_v2(&reader.bytes(1_200)?)?;
        if input.controls.sequence <= previous {
            return Err(exact_error("exact-input-order", "exact queued inputs are not ordered"));
        }
        previous = input.controls.sequence;
        exact.queued.insert(previous, input);
    }
    reader.finish()?;
    validate_exact_continuation(&exact.continuation)?;
    validate_look(exact.yaw, exact.pitch)?;
    Ok(exact)
}
