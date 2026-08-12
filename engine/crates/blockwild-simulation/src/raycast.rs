use crate::{
    AabbV1, CellPos, ContractError, PHYSICS_MAX_ABS_POSITION_V1, PHYSICS_MAX_ABS_VELOCITY_V1, ProjectileSweepV1,
    SweepHitV1, SweepTargetV1, Vec3, WorldReadWindowV1, sweep_point_aabb,
};

pub const RAYCAST_MAX_QUERIES_V1: usize = 4_096;
pub const RAYCAST_MAX_VISITED_CELLS_V1: usize = 65_536;
pub const ACTION_RAYCAST_MAX_ENTITY_TARGETS_V1: usize = 65_536;
pub const PROJECTILE_MAX_BATCH_V1: usize = 4_096;
pub const PROJECTILE_MAX_TARGETS_V1: usize = 65_536;
pub const PROJECTILE_MAX_RADIUS_V1: f64 = 128.0;

fn finite_bounded_vec3(value: Vec3, maximum: f64) -> bool {
    [value.x, value.y, value.z]
        .iter()
        .all(|component| component.is_finite() && component.abs() <= maximum)
}

fn valid_target_bounds(bounds: AabbV1) -> bool {
    finite_bounded_vec3(bounds.minimum, PHYSICS_MAX_ABS_POSITION_V1)
        && finite_bounded_vec3(bounds.maximum, PHYSICS_MAX_ABS_POSITION_V1)
        && bounds.minimum.x <= bounds.maximum.x
        && bounds.minimum.y <= bounds.maximum.y
        && bounds.minimum.z <= bounds.maximum.z
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VoxelRayHitKindV1 {
    Solid,
    Liquid,
    UnknownBoundary,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VoxelRaycastQueryV1 {
    pub query_id: u64,
    pub origin: Vec3,
    pub direction: Vec3,
    pub maximum_distance: f64,
    pub maximum_visited_cells: usize,
    pub hit_liquids: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VoxelRayHitV1 {
    pub query_id: u64,
    pub kind: VoxelRayHitKindV1,
    pub cell: CellPos,
    pub distance: f64,
    pub point: Vec3,
    pub normal: Vec3,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VoxelRaycastResultV1 {
    pub query_id: u64,
    pub hit: Option<VoxelRayHitV1>,
    pub visited_cells: usize,
    pub budget_exhausted: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ActionRayEntityTargetV1 {
    pub entity_id: u64,
    pub bounds: AabbV1,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ActionRayTargetV1 {
    Entity {
        entity_id: u64,
        distance: f64,
        point: Vec3,
        normal: Vec3,
    },
    Voxel(VoxelRayHitV1),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ActionRaycastResultV1 {
    pub query_id: u64,
    pub target: Option<ActionRayTargetV1>,
    pub visited_cells: usize,
    pub budget_exhausted: bool,
}

fn ray_cell(value: Vec3) -> CellPos {
    CellPos::new(
        (value.x + 0.5).floor() as i32,
        (value.y + 0.5).floor() as i32,
        (value.z + 0.5).floor() as i32,
    )
}

fn ray_hit_kind(window: &WorldReadWindowV1, cell: CellPos, hit_liquids: bool) -> Option<VoxelRayHitKindV1> {
    let Some(sample) = window.sample(cell) else {
        return Some(VoxelRayHitKindV1::UnknownBoundary);
    };
    if !sample.loaded {
        return Some(VoxelRayHitKindV1::UnknownBoundary);
    }
    if window.is_collision_solid(cell) {
        Some(VoxelRayHitKindV1::Solid)
    } else if hit_liquids && sample.liquid_kind != crate::LiquidKindV1::None {
        Some(VoxelRayHitKindV1::Liquid)
    } else {
        None
    }
}

pub fn raycast_voxels(
    window: &WorldReadWindowV1,
    query: VoxelRaycastQueryV1,
) -> Result<VoxelRaycastResultV1, ContractError> {
    window.validate()?;
    let values = [
        query.origin.x,
        query.origin.y,
        query.origin.z,
        query.direction.x,
        query.direction.y,
        query.direction.z,
        query.maximum_distance,
    ];
    if values.iter().any(|value| !value.is_finite())
        || !finite_bounded_vec3(query.origin, PHYSICS_MAX_ABS_POSITION_V1)
        || query.maximum_distance < 0.0
        || query.maximum_distance > PHYSICS_MAX_ABS_POSITION_V1
        || query.maximum_visited_cells == 0
        || query.maximum_visited_cells > RAYCAST_MAX_VISITED_CELLS_V1
    {
        return Err(ContractError::InvalidNumber);
    }
    let length = query.direction.length();
    if length <= f64::EPSILON {
        return Err(ContractError::InvalidNumber);
    }
    let direction = query.direction * length.recip();
    let mut cell = ray_cell(query.origin);
    let steps = [
        direction.x.signum() as i32,
        direction.y.signum() as i32,
        direction.z.signum() as i32,
    ];
    let origins = [query.origin.x, query.origin.y, query.origin.z];
    let directions = [direction.x, direction.y, direction.z];
    let cells = [cell.x, cell.y, cell.z];
    let mut next = [0.0_f64; 3];
    let mut delta = [0.0_f64; 3];
    for axis in 0..3 {
        if steps[axis] == 0 {
            next[axis] = f64::INFINITY;
            delta[axis] = f64::INFINITY;
        } else {
            let boundary = f64::from(cells[axis]) + if steps[axis] > 0 { 0.5 } else { -0.5 };
            next[axis] = ((boundary - origins[axis]) / directions[axis]).max(0.0);
            delta[axis] = directions[axis].abs().recip();
        }
    }
    let mut distance = 0.0_f64;
    let mut normal = Vec3::default();
    for visited in 1..=query.maximum_visited_cells {
        if let Some(kind) = ray_hit_kind(window, cell, query.hit_liquids) {
            return Ok(VoxelRaycastResultV1 {
                query_id: query.query_id,
                hit: Some(VoxelRayHitV1 {
                    query_id: query.query_id,
                    kind,
                    cell,
                    distance,
                    point: query.origin + direction * distance,
                    normal,
                }),
                visited_cells: visited,
                budget_exhausted: false,
            });
        }
        let axis = if next[0] <= next[1] && next[0] <= next[2] {
            0
        } else if next[1] <= next[2] {
            1
        } else {
            2
        };
        distance = next[axis];
        if distance > query.maximum_distance {
            return Ok(VoxelRaycastResultV1 {
                query_id: query.query_id,
                hit: None,
                visited_cells: visited,
                budget_exhausted: false,
            });
        }
        next[axis] += delta[axis];
        normal = Vec3::default();
        match axis {
            0 => {
                cell.x += steps[axis];
                normal.x = -f64::from(steps[axis]);
            }
            1 => {
                cell.y += steps[axis];
                normal.y = -f64::from(steps[axis]);
            }
            _ => {
                cell.z += steps[axis];
                normal.z = -f64::from(steps[axis]);
            }
        }
    }
    Ok(VoxelRaycastResultV1 {
        query_id: query.query_id,
        hit: None,
        visited_cells: query.maximum_visited_cells,
        budget_exhausted: true,
    })
}

/// Stable coarse batch. Query insertion order cannot alter result order.
pub fn raycast_voxel_batch(
    window: &WorldReadWindowV1,
    queries: &[VoxelRaycastQueryV1],
) -> Result<Vec<VoxelRaycastResultV1>, ContractError> {
    if queries.len() > RAYCAST_MAX_QUERIES_V1 {
        return Err(ContractError::InvalidBudget);
    }
    let mut ordered = queries.to_vec();
    ordered.sort_by_key(|query| query.query_id);
    if ordered.windows(2).any(|pair| pair[0].query_id == pair[1].query_id) {
        return Err(ContractError::InvalidFlags);
    }
    ordered.into_iter().map(|query| raycast_voxels(window, query)).collect()
}

/// One deterministic action ray against the authoritative voxel window and a
/// bounded page of exact entity bounds. A voxel hit wins an exact-distance
/// tie, so an entity touching an opaque face can never be selected through the
/// face. Entity input order cannot affect the result.
pub fn raycast_action_target(
    window: &WorldReadWindowV1,
    query: VoxelRaycastQueryV1,
    entities: &[ActionRayEntityTargetV1],
) -> Result<ActionRaycastResultV1, ContractError> {
    if entities.len() > ACTION_RAYCAST_MAX_ENTITY_TARGETS_V1 {
        return Err(ContractError::InvalidBudget);
    }
    let mut entities = entities.to_vec();
    entities.sort_by_key(|target| target.entity_id);
    if entities.windows(2).any(|pair| pair[0].entity_id == pair[1].entity_id)
        || entities.iter().any(|target| !valid_target_bounds(target.bounds))
    {
        return Err(ContractError::InvalidFlags);
    }

    let voxel = raycast_voxels(window, query)?;
    let length = query.direction.length();
    // `raycast_voxels` already rejects a zero/non-finite direction and an
    // invalid distance, so normalization is infallible after it succeeds.
    let direction = query.direction * length.recip();
    let displacement = direction * query.maximum_distance;
    let entity = entities
        .iter()
        .filter_map(|target| {
            sweep_point_aabb(query.origin, displacement, target.bounds).map(|hit| {
                let distance = hit.time * query.maximum_distance;
                (target.entity_id, distance, hit)
            })
        })
        .filter(|(_, distance, _)| voxel.hit.is_none_or(|voxel_hit| *distance < voxel_hit.distance))
        .min_by(|left, right| left.1.total_cmp(&right.1).then_with(|| left.0.cmp(&right.0)));

    let target = match (entity, voxel.hit) {
        (Some((entity_id, distance, hit)), _) => Some(ActionRayTargetV1::Entity {
            entity_id,
            distance,
            point: hit.point,
            normal: hit.normal,
        }),
        (None, Some(hit)) => Some(ActionRayTargetV1::Voxel(hit)),
        (None, None) => None,
    };
    Ok(ActionRaycastResultV1 {
        query_id: query.query_id,
        target,
        visited_cells: voxel.visited_cells,
        budget_exhausted: voxel.budget_exhausted,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProjectileContactKindV1 {
    Target,
    Solid,
    UnknownBoundary,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProjectileContactV1 {
    pub projectile_id: u64,
    pub kind: ProjectileContactKindV1,
    pub target_id: Option<u64>,
    pub cell: Option<CellPos>,
    pub hit: SweepHitV1,
}

fn projectile_world_hit(
    window: &WorldReadWindowV1,
    projectile: ProjectileSweepV1,
) -> Result<Option<(ProjectileContactKindV1, CellPos, SweepHitV1)>, ContractError> {
    let end = projectile.origin + projectile.displacement;
    let minimum = Vec3::new(
        projectile.origin.x.min(end.x) - projectile.radius,
        projectile.origin.y.min(end.y) - projectile.radius,
        projectile.origin.z.min(end.z) - projectile.radius,
    );
    let maximum = Vec3::new(
        projectile.origin.x.max(end.x) + projectile.radius,
        projectile.origin.y.max(end.y) + projectile.radius,
        projectile.origin.z.max(end.z) + projectile.radius,
    );
    let minimum_cell = ray_cell(minimum);
    let maximum_cell = ray_cell(maximum);
    let span_x = i64::from(maximum_cell.x) - i64::from(minimum_cell.x) + 1;
    let span_y = i64::from(maximum_cell.y) - i64::from(minimum_cell.y) + 1;
    let span_z = i64::from(maximum_cell.z) - i64::from(minimum_cell.z) + 1;
    let count = span_x
        .checked_mul(span_y)
        .and_then(|value| value.checked_mul(span_z))
        .and_then(|value| usize::try_from(value).ok())
        .ok_or(ContractError::InvalidBudget)?;
    if count > RAYCAST_MAX_VISITED_CELLS_V1 {
        return Err(ContractError::InvalidBudget);
    }
    let radius = Vec3::new(projectile.radius, projectile.radius, projectile.radius);
    let mut best: Option<(ProjectileContactKindV1, CellPos, SweepHitV1)> = None;
    for y in minimum_cell.y..=maximum_cell.y {
        for z in minimum_cell.z..=maximum_cell.z {
            for x in minimum_cell.x..=maximum_cell.x {
                let cell = CellPos::new(x, y, z);
                let sample = window.sample(cell);
                let kind = if sample.is_none_or(|value| !value.loaded) {
                    Some(ProjectileContactKindV1::UnknownBoundary)
                } else if window.is_collision_solid(cell) {
                    Some(ProjectileContactKindV1::Solid)
                } else {
                    None
                };
                let Some(kind) = kind else { continue };
                let block = AabbV1::new(
                    Vec3::new(f64::from(x) - 0.5, f64::from(y) - 0.5, f64::from(z) - 0.5),
                    Vec3::new(f64::from(x) + 0.5, f64::from(y) + 0.5, f64::from(z) + 0.5),
                )
                .expanded(radius);
                let Some(hit) = sweep_point_aabb(projectile.origin, projectile.displacement, block) else {
                    continue;
                };
                let candidate = (kind, cell, hit);
                if best.as_ref().is_none_or(|current| {
                    hit.time.total_cmp(&current.2.time).is_lt() || (hit.time == current.2.time && cell < current.1)
                }) {
                    best = Some(candidate);
                }
            }
        }
    }
    Ok(best)
}

/// Continuous projectile contacts against one world window and one packed
/// target page. Target contacts win exact-time ties, preserving the legacy
/// target-before-block rule.
pub fn sweep_projectile_contacts_batch(
    window: &WorldReadWindowV1,
    projectiles: &[ProjectileSweepV1],
    targets: &[SweepTargetV1],
) -> Result<Vec<ProjectileContactV1>, ContractError> {
    window.validate()?;
    if projectiles.len() > PROJECTILE_MAX_BATCH_V1 || targets.len() > PROJECTILE_MAX_TARGETS_V1 {
        return Err(ContractError::InvalidBudget);
    }
    let mut projectiles = projectiles.to_vec();
    projectiles.sort_by_key(|projectile| projectile.projectile_id);
    let mut targets = targets.to_vec();
    targets.sort_by_key(|target| target.target_id);
    if projectiles
        .windows(2)
        .any(|pair| pair[0].projectile_id == pair[1].projectile_id)
        || targets.windows(2).any(|pair| pair[0].target_id == pair[1].target_id)
        || targets.iter().any(|target| !valid_target_bounds(target.bounds))
    {
        return Err(ContractError::InvalidFlags);
    }
    let mut contacts = Vec::new();
    for projectile in projectiles {
        if !projectile.radius.is_finite()
            || projectile.radius < 0.0
            || projectile.radius > PROJECTILE_MAX_RADIUS_V1
            || !finite_bounded_vec3(projectile.origin, PHYSICS_MAX_ABS_POSITION_V1)
            || !finite_bounded_vec3(projectile.displacement, PHYSICS_MAX_ABS_VELOCITY_V1)
        {
            return Err(ContractError::InvalidNumber);
        }
        let radius = Vec3::new(projectile.radius, projectile.radius, projectile.radius);
        let target_hit = targets
            .iter()
            .filter_map(|target| {
                sweep_point_aabb(
                    projectile.origin,
                    projectile.displacement,
                    target.bounds.expanded(radius),
                )
                .map(|hit| (target.target_id, hit))
            })
            .min_by(|left, right| left.1.time.total_cmp(&right.1.time).then_with(|| left.0.cmp(&right.0)));
        let world_hit = projectile_world_hit(window, projectile)?;
        match (target_hit, world_hit) {
            (Some((_target_id, hit)), Some((kind, cell, world))) if world.time < hit.time => {
                contacts.push(ProjectileContactV1 {
                    projectile_id: projectile.projectile_id,
                    kind,
                    target_id: None,
                    cell: Some(cell),
                    hit: world,
                });
            }
            (Some((target_id, hit)), _) => contacts.push(ProjectileContactV1 {
                projectile_id: projectile.projectile_id,
                kind: ProjectileContactKindV1::Target,
                target_id: Some(target_id),
                cell: None,
                hit,
            }),
            (None, Some((kind, cell, hit))) => contacts.push(ProjectileContactV1 {
                projectile_id: projectile.projectile_id,
                kind,
                target_id: None,
                cell: Some(cell),
                hit,
            }),
            (None, None) => {}
        }
    }
    Ok(contacts)
}
