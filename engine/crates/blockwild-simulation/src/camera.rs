use blockwild_types::{CanonicalHash, CanonicalHasher};

use crate::{ContractError, Vec3, VoxelRaycastQueryV1, WorldReadWindowV1, raycast_voxels};

pub const CAMERA_MAX_VIEWPORT_V1: u32 = 16_384;
pub const CAMERA_MAX_CLIP_DISTANCE_V1: f64 = 65_536.0;
const CAMERA_COLLISION_MAX_CELLS_V1: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CameraModeV1 {
    FirstPerson,
    ThirdRear,
    ThirdFront,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CameraProfileV1 {
    pub eye_height: f64,
    pub third_person_target_height: f64,
    pub third_person_distance: f64,
    pub third_person_pitch_scale: f64,
    pub rear_shoulder_offset: f64,
    pub collision_radius: f64,
    pub collision_padding: f64,
    pub minimum_distance: f64,
    pub base_vertical_fov_radians: f64,
    pub aim_vertical_fov_radians: f64,
    pub near: f64,
    pub far: f64,
}

impl Default for CameraProfileV1 {
    fn default() -> Self {
        Self {
            eye_height: 1.62,
            third_person_target_height: 1.34,
            third_person_distance: 4.35,
            third_person_pitch_scale: 0.72,
            rear_shoulder_offset: 0.22,
            collision_radius: 0.18,
            collision_padding: 0.16,
            minimum_distance: 0.28,
            base_vertical_fov_radians: 72.0_f64.to_radians(),
            aim_vertical_fov_radians: (72.0_f64 * 0.68).to_radians(),
            near: 0.05,
            far: 512.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CameraPoseInputV1 {
    pub body_position: Vec3,
    pub look_yaw: f64,
    pub look_pitch: f64,
    pub mode: CameraModeV1,
    pub aiming: bool,
    pub viewport: [u32; 2],
    pub profile: CameraProfileV1,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CameraPoseV1 {
    pub position: Vec3,
    pub orientation: [f64; 4],
    pub vertical_fov_radians: f64,
    pub near: f64,
    pub far: f64,
    pub viewport: [u32; 2],
    pub collided: bool,
    pub resolved_distance: f64,
    pub pose_hash: CanonicalHash,
}

fn valid_number(value: f64, minimum: f64, maximum: f64) -> bool {
    value.is_finite() && value >= minimum && value <= maximum
}

fn validate(input: CameraPoseInputV1, has_window: bool) -> Result<(), ContractError> {
    if input
        .viewport
        .iter()
        .any(|value| *value == 0 || *value > CAMERA_MAX_VIEWPORT_V1)
        || !input.body_position.x.is_finite()
        || !input.body_position.y.is_finite()
        || !input.body_position.z.is_finite()
        || !valid_number(input.look_yaw, -core::f64::consts::PI, core::f64::consts::PI)
        || !valid_number(
            input.look_pitch,
            -core::f64::consts::FRAC_PI_2,
            core::f64::consts::FRAC_PI_2,
        )
    {
        return Err(ContractError::InvalidNumber);
    }
    let profile = input.profile;
    for (value, minimum, maximum) in [
        (profile.eye_height, 0.0, 16.0),
        (profile.third_person_target_height, 0.0, 16.0),
        (profile.third_person_distance, 0.05, 64.0),
        (profile.third_person_pitch_scale, 0.0, 4.0),
        (profile.rear_shoulder_offset, -4.0, 4.0),
        (profile.collision_radius, 0.0, 4.0),
        (profile.collision_padding, 0.0, 4.0),
        (profile.minimum_distance, 0.0, 16.0),
        (profile.base_vertical_fov_radians, 0.1, core::f64::consts::PI - 0.1),
        (profile.aim_vertical_fov_radians, 0.1, core::f64::consts::PI - 0.1),
        (profile.near, 0.001, CAMERA_MAX_CLIP_DISTANCE_V1),
        (profile.far, 0.002, CAMERA_MAX_CLIP_DISTANCE_V1),
    ] {
        if !valid_number(value, minimum, maximum) {
            return Err(ContractError::InvalidNumber);
        }
    }
    if profile.far <= profile.near
        || profile.minimum_distance > profile.third_person_distance
        || (input.mode != CameraModeV1::FirstPerson && !has_window)
    {
        return Err(ContractError::InvalidFlags);
    }
    Ok(())
}

fn orientation_from_yaw_pitch(yaw: f64, pitch: f64) -> [f64; 4] {
    let (sin_yaw, cos_yaw) = (yaw * 0.5).sin_cos();
    let (sin_pitch, cos_pitch) = (pitch * 0.5).sin_cos();
    [
        cos_yaw * sin_pitch,
        sin_yaw * cos_pitch,
        -sin_yaw * sin_pitch,
        cos_yaw * cos_pitch,
    ]
}

fn look_orientation(direction: Vec3) -> [f64; 4] {
    let length = direction.length();
    let direction = direction * length.recip();
    let yaw = (-direction.x).atan2(-direction.z);
    let pitch = direction.y.clamp(-1.0, 1.0).asin();
    orientation_from_yaw_pitch(yaw, pitch)
}

fn pose_hash(input: CameraPoseInputV1, pose: &CameraPoseV1) -> CanonicalHash {
    let mut hasher = CanonicalHasher::new("blockwild-camera-pose-v1");
    hasher.write_u16(1);
    hasher.write_u16(input.mode as u16);
    hasher.write_u16(u16::from(input.aiming));
    for value in [pose.position.x, pose.position.y, pose.position.z] {
        hasher.write_bytes(&value.to_le_bytes());
    }
    for value in pose.orientation {
        hasher.write_bytes(&value.to_le_bytes());
    }
    hasher.write_bytes(&pose.vertical_fov_radians.to_le_bytes());
    hasher.write_bytes(&pose.near.to_le_bytes());
    hasher.write_bytes(&pose.far.to_le_bytes());
    hasher.write_u32(pose.viewport[0]);
    hasher.write_u32(pose.viewport[1]);
    hasher.write_u16(u16::from(pose.collided));
    hasher.write_bytes(&pose.resolved_distance.to_le_bytes());
    hasher.finish()
}

/// Derives the renderer-neutral camera pose from authoritative body/look state
/// and browser-owned viewport dimensions. Third-person obstruction uses the
/// same fail-closed voxel DDA as action targeting; unknown residency shortens
/// the camera instead of exposing unloaded space.
pub fn derive_camera_pose_v1(
    window: Option<&WorldReadWindowV1>,
    input: CameraPoseInputV1,
) -> Result<CameraPoseV1, ContractError> {
    validate(input, window.is_some())?;
    let profile = input.profile;
    let vertical_fov_radians = if input.aiming {
        profile.aim_vertical_fov_radians
    } else {
        profile.base_vertical_fov_radians
    };
    let (position, orientation, collided, resolved_distance) = if input.mode == CameraModeV1::FirstPerson {
        (
            input.body_position + Vec3::new(0.0, profile.eye_height, 0.0),
            orientation_from_yaw_pitch(input.look_yaw, input.look_pitch),
            false,
            0.0,
        )
    } else {
        let target = input.body_position + Vec3::new(0.0, profile.third_person_target_height, 0.0);
        let pitch = (-input.look_pitch * profile.third_person_pitch_scale).clamp(-0.78, 0.78);
        let forward = Vec3::new(-input.look_yaw.sin(), 0.0, -input.look_yaw.cos());
        let outward = if input.mode == CameraModeV1::ThirdRear {
            forward * -1.0
        } else {
            forward
        };
        let shoulder = if input.mode == CameraModeV1::ThirdRear {
            profile.rear_shoulder_offset
        } else {
            0.0
        };
        let right = Vec3::new(input.look_yaw.cos(), 0.0, -input.look_yaw.sin());
        let offset = outward * (pitch.cos() * profile.third_person_distance)
            + Vec3::new(0.0, pitch.sin() * profile.third_person_distance, 0.0)
            + right * shoulder;
        let desired_distance = offset.length().max(profile.minimum_distance);
        let direction = offset * offset.length().recip();
        let query_distance = desired_distance + profile.collision_radius;
        let hit = raycast_voxels(
            window.expect("validated third-person window"),
            VoxelRaycastQueryV1 {
                query_id: 1,
                origin: target,
                direction,
                maximum_distance: query_distance,
                maximum_visited_cells: CAMERA_COLLISION_MAX_CELLS_V1,
                hit_liquids: false,
            },
        )?;
        let hit_distance = hit.hit.map(|hit| hit.distance);
        let collided = hit_distance.is_some_and(|distance| distance < desired_distance);
        let resolved_distance = hit_distance
            .filter(|distance| *distance < desired_distance)
            .map_or(desired_distance, |distance| {
                (distance - profile.collision_padding).max(0.0)
            });
        let position = target + direction * resolved_distance;
        (
            position,
            look_orientation(target - position),
            collided,
            resolved_distance,
        )
    };
    let mut pose = CameraPoseV1 {
        position,
        orientation,
        vertical_fov_radians,
        near: profile.near,
        far: profile.far,
        viewport: input.viewport,
        collided,
        resolved_distance,
        pose_hash: CanonicalHash::default(),
    };
    pose.pose_hash = pose_hash(input, &pose);
    Ok(pose)
}
