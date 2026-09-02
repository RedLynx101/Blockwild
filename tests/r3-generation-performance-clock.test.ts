import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceR3PerformanceClock, assertR3PerformanceClockReplay, assertR3PerformanceStreamingClock,
  createR3PerformanceClock, r3PerformanceStartPoint, r3PerformanceTracePoints, R3_PERFORMANCE_TRACE_V2,
  type R3PerformanceLandscape, type R3PerformanceStreamingFrame,
} from "./fixtures/r3-generation-performance-contract.ts";

const landscape: R3PerformanceLandscape = { id: "synthetic-clock-only", seed: "clock", chunk: [-3, 4], focus: "clock",
  camera: { position: [-40, 70, 72], lookAt: [-40, 50, 72], fov: 60 } };
const baseline = 1000;

/** Clock-only records: these do not claim measured work, readiness, or browser execution. */
function replay(hz: number, delayAt = -1) {
  let clock = createR3PerformanceClock(baseline); const frames: R3PerformanceStreamingFrame[] = [];
  const points = r3PerformanceTracePoints(landscape); const start = r3PerformanceStartPoint(landscape);
  let delayedMilliseconds = 0;
  for (let callback = 1; callback < 10_000; callback += 1) {
    if (callback === delayAt) delayedMilliseconds += 200;
    const timestamp = baseline + callback * 1000 / hz + delayedMilliseconds;
    const advanced = advanceR3PerformanceClock(clock, timestamp);
    frames.push({ point: clock.simulationTick === 0 ? start : points[clock.simulationTick - 1],
      updates: 1, rafTimestamp: timestamp, rafIntervalMilliseconds: timestamp - clock.previousTimestamp,
      ...advanced.sample } as R3PerformanceStreamingFrame);
    clock = advanced.clock;
    if (advanced.sample.finalPositionUpdate) return frames;
  }
  throw new Error("Synthetic clock failed to finish");
}

for (const hz of [60, 120, 240]) test(`${hz} Hz callbacks preserve 420 movement ticks and seven-second path`, () => {
  const frames = replay(hz); const terminal = frames.at(-1)!;
  assert.doesNotThrow(() => assertR3PerformanceClockReplay(frames, baseline, landscape));
  assert.doesNotThrow(() => assertR3PerformanceStreamingClock({ landscape,
    startupFrames: [{ rafTimestamp: baseline } as never], frames }));
  assert.equal(frames.reduce((sum, frame) => sum + frame.physicsSteps, 0), 420);
  assert.equal(terminal.simulationTick, 420); assert.equal(terminal.simulationTimeSeconds, 7);
  assert.equal(terminal.physicsSteps, 0); assert.equal(terminal.finalPositionUpdate, true);
  assert.equal(frames.filter(frame => frame.finalPositionUpdate).length, 1);
  assert.deepEqual(terminal.point, r3PerformanceTracePoints(landscape).at(-1));
  assert(Math.abs(terminal.point.x - r3PerformanceStartPoint(landscape).x) < 1e-8);
  const movementComplete = frames.at(-2)!;
  assert(movementComplete.rafTimestamp - baseline >= 7000 - 1e-6, "high refresh must not accelerate movement");
  assert(movementComplete.rafTimestamp - baseline <= 7000 + 1000 / hz + 1e-6);
  assert(frames.length >= hz * 7 + 1 && frames.length <= hz * 7 + 2);
  if (hz > 60) assert(frames.some(frame => frame.physicsSteps === 0 && !frame.finalPositionUpdate));
  for (let index = 1; index < frames.length; index += 1) {
    assert.equal(frames[index].point.ordinal, frames[index - 1].simulationTickAfter,
      "streaming must see the previous callback's physics result, never future movement");
  }
});

test("production clamp and accumulator cap bound delayed callbacks to four ticks", () => {
  const first = advanceR3PerformanceClock(createR3PerformanceClock(0), 10);
  assert.equal(first.sample.physicsSteps, 0); assert.equal(first.sample.accumulatorSecondsAfter, 0.01);
  const delayed = advanceR3PerformanceClock(first.clock, 210);
  assert.equal(delayed.sample.rawDeltaSeconds, 0.2); assert.equal(delayed.sample.clampedDeltaSeconds, 0.08);
  assert.equal(delayed.sample.accumulatorSecondsBefore, 0.01); assert.equal(delayed.sample.physicsSteps, 4);
  assert.equal(delayed.sample.simulationTick, 0); assert.equal(delayed.sample.simulationTickAfter, 4);
  assert(delayed.sample.accumulatorSecondsAfter < 1e-12);
  const frames = replay(240, 31);
  assert.doesNotThrow(() => assertR3PerformanceClockReplay(frames, baseline, landscape));
  assert.equal(frames.reduce((sum, frame) => sum + frame.physicsSteps, 0), 420);
  assert(frames.at(-1)!.rafTimestamp - baseline > 7100, "capped lost wall time must not become extra movement");
});

test("the original complete walk/sprint/reverse path remains bound to movement ticks", () => {
  const points = r3PerformanceTracePoints(landscape); const start = r3PerformanceStartPoint(landscape);
  assert.equal(points.length, R3_PERFORMANCE_TRACE_V2.totalMovementTicks);
  assert.deepEqual(R3_PERFORMANCE_TRACE_V2.phases.map(phase => phase.movementTicks), [120, 120, 180]);
  assert(Math.abs(points[119].x - start.x - 8) < 1e-8);
  assert(Math.abs(points[239].x - start.x - 24) < 1e-8);
  assert(Math.abs(points[419].x - start.x) < 1e-8);
});

const invalid: [string, (frames: R3PerformanceStreamingFrame[]) => void][] = [
  ["dropped zero-physics callback", frames => { frames.splice(0, 1); }],
  ["dropped interior callback", frames => { frames.splice(100, 1); }],
  ["forged steps", frames => { frames[0].physicsSteps = 1; }],
  ["forged pre-physics time", frames => { frames[0].simulationTimeSeconds = 1 / 60; }],
  ["forged post-physics time", frames => { frames[0].simulationTimeSecondsAfter = 1 / 60; }],
  ["forged accumulator", frames => { frames[0].accumulatorSecondsAfter = 0; }],
  ["forged raw delta", frames => { frames[0].rawDeltaSeconds = 1 / 60; }],
  ["forged interval", frames => { frames[0].rafIntervalMilliseconds = 1000 / 60; }],
  ["future point", frames => { frames[0].point = r3PerformanceTracePoints(landscape)[0]; }],
  ["omitted final position", frames => { frames.pop(); }],
  ["forged final position", frames => { frames.at(-1)!.point = r3PerformanceTracePoints(landscape)[418]; }],
  ["extra terminal callback", frames => { frames.push(structuredClone(frames.at(-1)!)); }],
];
for (const [name, mutate] of invalid) test(`timestamp-based replay rejects ${name}`, () => {
  const frames = replay(240); mutate(frames);
  assert.throws(() => assertR3PerformanceClockReplay(frames, baseline, landscape), /R3 generation performance/);
});
