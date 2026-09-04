//! Print the synthetic native-codec vector file; never publish an engine artifact.
#[path = "../tests/support/pose_v2_vectors.rs"]
mod vectors;
fn main() {
    print!("{}", vectors::render());
}
