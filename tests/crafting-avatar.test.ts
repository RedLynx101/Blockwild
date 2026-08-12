import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import * as THREE from "three";
import { createBlueprintState } from "../app/game/blueprints.ts";
import { BlockId, Item, ITEMS, RECIPES, mirrorRecipePattern } from "../app/game/data.ts";
import { VoxelEngine, bestiaryProgressSignature, isEditableKeyboardTarget, type BestiaryProgress, type InventorySlot } from "../app/game/engine.ts";
import { createAvatarHeldItemModel } from "../app/game/held-items.ts";
import { MOB_DEFS } from "../app/game/mobs.ts";
import { BlockPlayerModel, FEMALE_HAIR_COLOR, playerEyeHeightForVariant } from "../app/game/player-model.ts";
import { createAvatarPreviewFallbackPlan } from "../app/game/AvatarPreviewFallback.tsx";
import {
  createAvatarPreviewFrameScheduler,
  createAvatarPreviewRendererPool,
  observeAvatarPreviewVisibility,
} from "../app/game/avatar-preview-runtime.ts";
import { GAME_RELEASE_NAME, GAME_VERSION, normalizeGameVersion } from "../app/game/version.ts";
import {
  bestiaryEntryCompletion,
  bestiaryFieldNoteUnlocked,
  bestiaryKindsForFilter,
  createHeldStackPositionController,
  captureOrbUiState,
  clearFirstPersonHeldPresentation,
  healingProgressForOrb,
  initialHydrationSettings,
  itemHoverText,
  itemIconKind,
  normalizeMultiplayerRoomCode,
  multiplayerViewStatesEqual,
  normalizeApiaryUiState,
  prepareFirstPersonHeldPresentation,
  recipeMatchesQuery,
  recipeIngredientLabels,
  recipeForOutputItem,
  recipePreviewGrid,
  RecipePreviewIngredient,
  resolveTouchControls,
  runSingleFlight,
  shouldSuppressGameContextMenu,
  shouldCloseItemGuideOnEscape,
  shouldCloseSpellWheelOnKeyRelease,
  slotInteractionAllowed,
  type SingleFlightGate,
} from "../app/game/VoxelGame.tsx";
import VoxelGame from "../app/game/VoxelGame.tsx";

test("Glimmerwood forage reuses the atlas texture in held and dropped models", () => {
  const atlas = new THREE.Texture();
  for (const item of [Item.StarfernFrond, Item.Dreamcap] as const) {
    const model = createAvatarHeldItemModel(item, { atlas });
    assert.ok(model);
    assert.equal(model.userData.worldTextureBlock, ITEMS[item].worldTextureBlock);
    const planes = model.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    assert.equal(planes.length, 2);
    assert.ok(planes.every((plane) => (plane.material as THREE.MeshBasicMaterial).map === atlas));
  }
});

function craftingHarness(inventory: Array<InventorySlot | null>, size: 2 | 3 = 3) {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.inventory = Array.from({ length: 36 }, (_, index) => inventory[index] ? { ...inventory[index]! } : null);
  engine.craftGrid = Array.from({ length: 9 }, () => null);
  engine.craftingSize = size;
  engine.cursor = null;
  engine.activeRecipe = null;
  engine.blueprints = createBlueprintState();
  engine.events = {
    onHud: () => undefined,
    onToast: () => undefined,
    onLockChange: () => undefined,
    onOverlayRequest: () => undefined,
    onDeath: () => undefined,
    onSave: () => undefined,
  };
  engine.audio = { play: () => undefined } as unknown as VoxelEngine["audio"];
  engine.saveSoon = () => undefined;
  engine.emitHud = () => undefined;
  return engine;
}

test("recipe plans stage ingredients without producing the output", () => {
  const engine = craftingHarness([
    { item: BlockId.Cobblestone, count: 3 },
    { item: Item.Stick, count: 2 },
  ]);
  const result = engine.planRecipe("stone_axe");
  assert.equal(result.ok, true);
  assert.equal(engine.inventory.some((slot) => slot?.item === Item.StoneAxe), false);
  assert.equal(engine.findRecipe()?.recipe.id, "stone_axe");
  assert.equal(engine.craftGrid.filter(Boolean).length, 5);
});

test("recipe plans report exact missing materials without mutating the pack", () => {
  const engine = craftingHarness([{ item: BlockId.Cobblestone, count: 2 }]);
  const before = structuredClone(engine.inventory);
  const result = engine.planRecipe("stone_axe");
  assert.equal(result.ok, false);
  assert.equal(result.ok ? "" : result.reason, "missing");
  assert.match(result.message, /Cobblestone|Stick/u);
  assert.deepEqual(engine.inventory, before);
  assert.equal(engine.craftGrid.every((slot) => slot === null), true);
});

test("axe recipes accept the horizontally mirrored blade", () => {
  const engine = craftingHarness([]);
  engine.craftGrid[0] = { item: BlockId.Cobblestone, count: 1 };
  engine.craftGrid[1] = { item: BlockId.Cobblestone, count: 1 };
  engine.craftGrid[3] = { item: Item.Stick, count: 1 };
  engine.craftGrid[4] = { item: BlockId.Cobblestone, count: 1 };
  engine.craftGrid[6] = { item: Item.Stick, count: 1 };
  assert.equal(engine.findRecipe()?.recipe.id, "stone_axe");
  const recipe = RECIPES.find((candidate) => candidate.id === "stone_axe")!;
  assert.notDeepEqual(mirrorRecipePattern(recipe), recipe.pattern);
});

test("charcoal substitutes for coal in crafting and capture-orb batches yield four", () => {
  const torchEngine = craftingHarness([{ item: Item.Charcoal, count: 1 }, { item: Item.Stick, count: 1 }], 2);
  assert.equal(torchEngine.planRecipe("torch").ok, true);
  assert.equal(torchEngine.findRecipe()?.recipe.id, "torch");

  const orbRecipe = RECIPES.find((candidate) => candidate.id === "creature_cage")!;
  assert.equal(orbRecipe.output.item, Item.CaptureOrb);
  assert.equal(orbRecipe.output.count, 4);
  for (const recipe of RECIPES) {
    for (const ingredient of recipe.pattern) {
      if (ingredient === 0 || !Array.isArray(ingredient) || !ingredient.includes(Item.Coal)) continue;
      assert.equal(ingredient.includes(Item.Charcoal), true, `${recipe.id} accepts charcoal wherever it accepts coal`);
    }
  }
});

test("player variants and equipment alter the production rig", () => {
  const player = new BlockPlayerModel({ variant: "female" });
  assert.equal(player.variant, "female");
  assert.equal(player.group.userData.playerVariant, "female");
  assert.equal(player.group.getObjectByName("female-hair")?.visible, true);
  assert.equal(player.group.getObjectByName("male-hair")?.visible, false);
  assert.equal(player.rig.scale.y, 0.8);
  assert.equal(player.materials.hair.color.getHex(), FEMALE_HAIR_COLOR);
  player.setEquipmentAppearance({ head: "#d4b9a7", chest: "#8a6548" });
  assert.equal(player.group.getObjectByName("armor-head-cap")?.visible, true);
  assert.equal(player.group.getObjectByName("armor-chest")?.visible, true);
  const femaleHeight = player.getLocalBounds().getSize(new THREE.Vector3()).y;
  player.setVariant("male");
  assert.equal(player.group.getObjectByName("male-hair")?.visible, true);
  const maleHeight = player.getLocalBounds().getSize(new THREE.Vector3()).y;
  assert.ok(Math.abs(femaleHeight / maleHeight - 0.8) < 0.01);
  assert.ok(Math.abs(playerEyeHeightForVariant("female") - 1.296) < 1e-10);
  assert.ok(Math.abs(playerEyeHeightForVariant("female", true) - 1.04) < 1e-10);
  player.dispose();
});

test("SSR and the first browser render share deterministic settings text", () => {
  assert.deepEqual(initialHydrationSettings(), {
    volume: 0.55, muted: false, sensitivity: 0.0022, fov: 72, weather: "clear",
    renderDistance: 10, simulationDistance: 8, basicRenderDistance: 10, rememberedBasicRenderDistance: 20, showFps: false, showMinimap: false, showBreakingTexture: true, showBreakProgress: false, showToolEffectiveness: true, debugTelemetry: false, debugTelemetryMaxMinutes: 60, musicVolume: 0.72, resourceMode: "auto", agentVoiceMode: "spatial",
  });
  const serverHtml = renderToString(createElement(VoxelGame));
  assert.match(serverHtml, /aria-label="Main menu"/u);
  assert.match(serverHtml, />Worlds<\/strong>/u);
  assert.match(serverHtml, />Characters<\/strong>/u);
  assert.doesNotMatch(serverHtml, /aria-labelledby="character-studio-title"/u, "the title screen should not preload the character workspace");
  assert.doesNotMatch(serverHtml, /aria-label="Worlds stored in this browser"/u, "the title screen should not preload the world catalog");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: { getItem: () => JSON.stringify({ muted: true, volume: 0.1, fov: 99 }) },
      matchMedia: () => ({ matches: true }),
    },
  });
  try {
    assert.equal(renderToString(createElement(VoxelGame)), serverHtml);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  }
});

test("touch controls follow actual input on hybrids and remain available on tablets", () => {
  const hybrid = { coarsePrimary: false, hoverNone: false, anyFine: true, primaryPointer: "unknown" as const };
  assert.equal(resolveTouchControls("auto", hybrid), false);
  assert.equal(resolveTouchControls("auto", { ...hybrid, coarsePrimary: true, hoverNone: true }), false);
  assert.equal(resolveTouchControls("auto", { ...hybrid, coarsePrimary: true, hoverNone: true, anyFine: false }), true);
  assert.equal(resolveTouchControls("auto", { ...hybrid, primaryPointer: "touch" }), true);
  assert.equal(resolveTouchControls("auto", { ...hybrid, primaryPointer: "mouse" }), false);
  assert.equal(resolveTouchControls("on", { ...hybrid, primaryPointer: "mouse" }), true);
  assert.equal(resolveTouchControls("off", { ...hybrid, primaryPointer: "touch" }), false);
});

test("held inventory stacks coalesce pointer motion without scheduling an inactive cursor", () => {
  let nextFrame = 1;
  const pending = new Map<number, () => void>();
  const controller = createHeldStackPositionController(
    (callback) => {
      const frame = nextFrame++;
      pending.set(frame, callback);
      return frame;
    },
    (frame) => { pending.delete(frame); },
  );
  const target = { style: { left: "", top: "", transform: "" } };
  controller.attach(target);
  assert.equal(controller.track(90, 110, false), false);
  assert.equal(pending.size, 0, "ordinary inventory pointer movement must stay off the React/frame path");

  controller.track(12, 24, true);
  controller.track(36, 48, true);
  assert.equal(pending.size, 1, "multiple pointer moves should share one animation frame");
  const frame = [...pending.entries()][0];
  pending.delete(frame[0]);
  frame[1]();
  assert.equal(target.style.left, "0px");
  assert.equal(target.style.top, "0px");
  assert.equal(target.style.transform, "translate3d(36px, 48px, 0) translate(-18px, -18px)");

  controller.seed(72, 84);
  controller.attach(null);
  controller.attach(target);
  assert.equal(target.style.transform, "translate3d(72px, 84px, 0) translate(-18px, -18px)", "a newly mounted held stack should start at the initiating pointer");
  controller.dispose();
});

test("avatar previews share one capped frame scheduler and skip hidden or disconnected canvases", () => {
  let nextFrame = 1;
  const pending = new Map<number, (now: number) => void>();
  const scheduler = createAvatarPreviewFrameScheduler(
    (callback) => {
      const frame = nextFrame++;
      pending.set(frame, callback);
      return frame;
    },
    (frame) => { pending.delete(frame); },
    1000 / 22,
  );
  const renders: string[] = [];
  let firstConnected = true;
  const first = scheduler.register({
    isConnected: () => firstConnected,
    render: () => { renders.push("first"); },
  });
  const second = scheduler.register({
    isConnected: () => true,
    render: () => { renders.push("second"); },
  }, false);
  assert.equal(pending.size, 1, "multiple previews must share one pending animation frame");

  const fireFrame = (now: number) => {
    const frame = pending.entries().next().value as [number, (timestamp: number) => void] | undefined;
    assert.ok(frame, "a shared frame should be pending");
    pending.delete(frame[0]);
    frame[1](now);
  };
  fireFrame(0);
  assert.deepEqual(renders, ["first"]);
  assert.equal(pending.size, 1);
  fireFrame(20);
  assert.deepEqual(renders, ["first"], "the shared loop must remain capped below display refresh rate");
  fireFrame(50);
  assert.deepEqual(renders, ["first", "first"]);

  second.setVisible(true);
  firstConnected = false;
  fireFrame(100);
  assert.deepEqual(renders, ["first", "first", "second"], "disconnected previews must not render");
  second.setVisible(false);
  assert.equal(pending.size, 0, "the scheduler should sleep when no visible connected preview remains");
  first.dispose();
  second.dispose();
});

test("avatar preview visibility observation is deterministic with a visible fallback", () => {
  const element = {} as Element;
  const otherElement = {} as Element;
  const visibility: boolean[] = [];
  let observed: Element | null = null;
  let disconnected = 0;
  let notify!: (entries: ReadonlyArray<Pick<IntersectionObserverEntry, "intersectionRatio" | "isIntersecting" | "target">>) => void;
  const stop = observeAvatarPreviewVisibility(element, (visible) => { visibility.push(visible); }, (callback) => {
    notify = callback;
    return {
      observe: (target) => { observed = target; },
      disconnect: () => { disconnected += 1; },
    };
  });
  assert.equal(observed, element);
  assert.deepEqual(visibility, [], "an observer-backed preview waits for actual intersection state");
  notify([{ target: otherElement, isIntersecting: true, intersectionRatio: 1 }]);
  assert.deepEqual(visibility, []);
  notify([{ target: element, isIntersecting: false, intersectionRatio: 0 }]);
  notify([{ target: element, isIntersecting: true, intersectionRatio: 0.5 }]);
  assert.deepEqual(visibility, [false, true]);
  stop();
  assert.equal(disconnected, 1);

  const fallbackVisibility: boolean[] = [];
  const stopFallback = observeAvatarPreviewVisibility(element, (visible) => { fallbackVisibility.push(visible); }, null);
  assert.deepEqual(fallbackVisibility, [true], "missing IntersectionObserver support must keep previews usable");
  stopFallback();
});

test("avatar preview renderer pool reuses one context across release and reacquire", () => {
  type FakeRenderer = { id: number; dispose: () => void; forceContextLoss: () => void };
  let nextRenderer = 1;
  let nextTimer = 1;
  let maxLiveContexts = 0;
  const liveContexts = new Set<number>();
  const disposed: number[] = [];
  const contextLosses: number[] = [];
  const timers = new Map<number, { callback: () => void; delayMs: number }>();
  const pool = createAvatarPreviewRendererPool<FakeRenderer, number>({
    createRenderer: () => {
      const id = nextRenderer++;
      liveContexts.add(id);
      maxLiveContexts = Math.max(maxLiveContexts, liveContexts.size);
      return {
        id,
        dispose: () => { disposed.push(id); },
        forceContextLoss: () => {
          contextLosses.push(id);
          liveContexts.delete(id);
        },
      };
    },
    scheduleRelease: (callback, delayMs) => {
      const timer = nextTimer++;
      timers.set(timer, { callback, delayMs });
      return timer;
    },
    cancelRelease: (timer) => { timers.delete(timer); },
    idleMs: 30_000,
  });

  const first = pool.acquire();
  const second = pool.acquire();
  assert.equal(second, first);
  assert.equal(nextRenderer, 2, "concurrent previews should create exactly one renderer");
  pool.release();
  pool.release();
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0]?.delayMs, 30_000);

  const reacquired = pool.acquire();
  assert.equal(reacquired, first, "normal overlay switching should cancel teardown and retain the context");
  assert.equal(timers.size, 0);
  pool.release();
  const expiration = [...timers.entries()][0];
  assert.ok(expiration);
  timers.delete(expiration[0]);
  expiration[1].callback();
  assert.deepEqual(disposed, [first?.id]);
  assert.deepEqual(contextLosses, [first?.id]);

  const afterIdle = pool.acquire();
  assert.notEqual(afterIdle, first);
  assert.equal(maxLiveContexts, 1, "the pool must never keep two preview WebGL contexts alive");
  pool.release();
});

test("avatar preview fallback is deterministic, visible, and preserves carried silhouettes", () => {
  const props = {
    variant: "female" as const,
    heldItem: Item.StoneAxe,
    offhandItem: Item.WoodenShield,
  };
  const first = createAvatarPreviewFallbackPlan(props);
  const second = createAvatarPreviewFallbackPlan(props);
  assert.deepEqual(second, first);
  assert.ok(first.length >= 13, "fallback must draw a complete, nonblank paper doll");
  assert.ok(first.every((rectangle) => rectangle.width > 0 && rectangle.height > 0 && rectangle.color !== "transparent"));
  assert.ok(first.some((rectangle) => rectangle.x === 36 && rectangle.height === 50), "main-hand silhouette is retained");
  assert.ok(first.some((rectangle) => rectangle.x === -48 && rectangle.width === 24 && rectangle.height === 48), "shield silhouette is retained");
  const male = createAvatarPreviewFallbackPlan({ variant: "male" });
  assert.equal(first[0]?.height, 28);
  assert.equal(male[0]?.height, 23);
});

test("multiplayer actions are single-flight and title mode clears first-person held geometry", async () => {
  const gate: SingleFlightGate = { current: null };
  let operationCalls = 0;
  let release!: () => void;
  const first = runSingleFlight(gate, async () => {
    operationCalls += 1;
    await new Promise<void>((resolve) => { release = resolve; });
    return "connected";
  });
  const second = await runSingleFlight(gate, async () => {
    operationCalls += 1;
    return "duplicate";
  });
  assert.deepEqual(second, { started: false });
  release();
  assert.deepEqual(await first, { started: true, value: "connected" });
  assert.equal(operationCalls, 1);

  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  engine.heldRoot = new THREE.Group();
  engine.heldRoot.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  let disposed = 0;
  engine.disposeObject = () => { disposed += 1; };
  engine.selectedSlot = () => ({ item: Item.Stick, count: 1 });
  clearFirstPersonHeldPresentation(engine);
  assert.equal(engine.heldRoot.children.length, 0);
  assert.equal(engine.heldRoot.visible, false);
  assert.equal(engine.heldItemCode, Item.Stick);
  assert.equal(disposed, 1);
  prepareFirstPersonHeldPresentation(engine);
  assert.equal(engine.heldRoot.visible, true);
  assert.equal(engine.heldItemCode, -1);
});

test("workstation UI normalizes apiary production and exact capture-orb metadata", () => {
  const apiary = normalizeApiaryUiState({
    queen: { alive: true, home: true, name: "Queen Marigold" },
    workers: Array.from({ length: 10 }, (_, index) => ({ alive: index !== 9, home: index > 2 })),
    nectar: 22,
    honey: 99,
    royalJelly: 99,
    productionProgress: 68,
  });
  assert.equal(apiary.queenPresent, true);
  assert.equal(apiary.queenName, "Queen Marigold");
  assert.equal(apiary.workerCount, 8);
  assert.equal(apiary.maxWorkers, 8);
  assert.match(apiary.nectarStatus, /nectar return pending/u);
  assert.equal(apiary.honey, 12);
  assert.equal(apiary.royalJelly, 12);
  assert.equal(apiary.productionProgress, 0.68);
  assert.equal(apiary.slots.length, 11, "queen + eight removable workers + honey and royal-jelly output slots");

  const fullHostile: InventorySlot = {
    item: Item.CaptureOrb,
    count: 1,
    metadata: {
      captureOrb: JSON.stringify({
        schema: 1,
        orbId: "orb-shadecrawler",
        capturedAt: 42,
        creature: {
          schema: 1,
          entityId: "shade-1",
          kind: "shadecrawler",
          health: 16,
          maxHealth: 16,
          ageTicks: 500,
          baby: false,
          temperament: "Hostile",
          hostile: true,
          tamed: false,
          ownerId: null,
          name: "Nightglass",
          geneticSeed: 7,
          command: null,
          custom: {},
        },
      }),
    },
  };
  const specimen = captureOrbUiState(fullHostile);
  assert.equal(specimen.kind, "shadecrawler");
  assert.equal(specimen.name, "Nightglass");
  assert.equal(specimen.hostile, true);
  assert.equal(specimen.fullyHealed, true);
  assert.equal(healingProgressForOrb(fullHostile, { healClock: 2 }, 0), 1, "fully healed hostile specimens remain valid station occupants");

  const wounded = structuredClone(fullHostile);
  const encoded = JSON.parse(String(wounded.metadata?.captureOrb)) as { creature: { health: number } };
  encoded.creature.health = 5;
  wounded.metadata!.captureOrb = JSON.stringify(encoded);
  assert.equal(healingProgressForOrb(wounded, { healClock: 5, healIntervalSeconds: 10 }, 0), 0.5);
});

test("human release identity stays separate from save schemas", () => {
  assert.equal(GAME_VERSION, "1.12.0");
  assert.equal(GAME_RELEASE_NAME, "Field Archive");
  assert.equal(normalizeGameVersion("garbage"), "0.1.0");
});

test("recipe search includes output and ingredient names while previews stay 3×3", () => {
  const torch = RECIPES.find((recipe) => recipe.id === "torch")!;
  assert.equal(recipeMatchesQuery(torch, "coal"), true);
  assert.equal(recipeMatchesQuery(torch, "torches"), true);
  assert.equal(recipeMatchesQuery(torch, "banana"), false);
  const cells = recipePreviewGrid(torch);
  assert.equal(cells.length, 9);
  assert.equal(cells[0], Item.Coal);
  assert.equal(cells[3], Item.Stick);
  assert.deepEqual(recipeIngredientLabels(torch), ["Coal or Charcoal", "Stick"]);
});

test("recipe-board ingredients drill into their own recipes without staging a craft", () => {
  const stickRecipe = recipeForOutputItem(Item.Stick);
  assert.equal(stickRecipe?.id, "sticks");
  assert.equal(recipeForOutputItem(Item.RawMeat), null);

  const linkedMarkup = renderToString(createElement(RecipePreviewIngredient, {
    item: Item.Stick,
    label: "Stick",
    onNavigate: () => undefined,
  }));
  assert.match(linkedMarkup, /<button[^>]*type="button"/u);
  assert.match(linkedMarkup, /data-recipe-target="sticks"/u);
  assert.match(linkedMarkup, /aria-label="Stick: view Sticks recipe"/u);

  const passiveMarkup = renderToString(createElement(RecipePreviewIngredient, {
    item: Item.RawMeat,
    label: "Raw Meat",
    onNavigate: () => undefined,
  }));
  assert.doesNotMatch(passiveMarkup, /<button/u);
  assert.match(passiveMarkup, /aria-label="Raw Meat"/u);
});

test("hotbar selection sends its lightweight UI signal before the full HUD refresh", () => {
  const engine = Object.create(VoxelEngine.prototype) as VoxelEngine;
  const calls: string[] = [];
  engine.selected = 0;
  engine.events = {
    onHud: () => undefined,
    onSelectedSlot: (slot) => calls.push(`selected:${slot}`),
    onToast: () => undefined,
    onLockChange: () => undefined,
    onOverlayRequest: () => undefined,
    onDeath: () => undefined,
    onSave: () => undefined,
  };
  engine.audio = { play: () => calls.push("audio") } as unknown as VoxelEngine["audio"];
  engine.emitHud = () => { calls.push("hud"); };
  engine.selectSlot(3);
  assert.equal(engine.selected, 3);
  assert.deepEqual(calls, ["selected:3", "audio", "hud"]);

  calls.length = 0;
  engine.keys = new Set(["KeyW"]);
  engine.selectSlot(6);
  assert.equal(engine.selected, 6, "hotbar selection remains responsive while forward movement is held");
  assert.deepEqual(calls, ["selected:6", "audio", "hud"]);
});

test("text fields suppress gameplay shortcuts", () => {
  assert.equal(isEditableKeyboardTarget({ tagName: "INPUT" } as unknown as EventTarget), true);
  assert.equal(isEditableKeyboardTarget({ tagName: "TEXTAREA" } as unknown as EventTarget), true);
  assert.equal(isEditableKeyboardTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isEditableKeyboardTarget({ tagName: "CANVAS" } as unknown as EventTarget), false);
  assert.equal(shouldSuppressGameContextMenu(true, { tagName: "CANVAS" } as unknown as EventTarget), true);
  assert.equal(shouldSuppressGameContextMenu(true, { tagName: "INPUT" } as unknown as EventTarget), false);
  assert.equal(shouldSuppressGameContextMenu(false, { tagName: "CANVAS" } as unknown as EventTarget), false);
});

test("newly opened container slots ignore the opening pointer event", () => {
  assert.equal(slotInteractionAllowed(1_180, 1_000), false);
  assert.equal(slotInteractionAllowed(1_180, 1_179), false);
  assert.equal(slotInteractionAllowed(1_180, 1_180), true);
});

test("releasing Q closes only the active spell wheel", () => {
  assert.equal(shouldCloseSpellWheelOnKeyRelease("KeyQ", "spell-wheel"), true);
  assert.equal(shouldCloseSpellWheelOnKeyRelease("KeyQ", null), false);
  assert.equal(shouldCloseSpellWheelOnKeyRelease("Escape", "spell-wheel"), false);
});

test("Escape dismisses the layered Item Wiki before its base overlay", () => {
  assert.equal(shouldCloseItemGuideOnEscape("Escape", true), true);
  assert.equal(shouldCloseItemGuideOnEscape("Escape", false), false);
  assert.equal(shouldCloseItemGuideOnEscape("KeyE", true), false);

  const ui = readFileSync(new URL("../app/game/VoxelGame.tsx", import.meta.url), "utf8");
  assert.match(
    ui,
    /if \(shouldCloseItemGuideOnEscape\(event\.code, itemGuideOpenRef\.current\)\) \{[\s\S]*?setItemGuideVisible\(false\);[\s\S]*?return;[\s\S]*?if \(current === "bestiary"/u,
    "the Item Wiki consumes Escape before any underlying overlay branch",
  );
});

test("inventory artwork stays semantic at real slot sizes and food hover copy is explicit", () => {
  assert.equal(itemIconKind(Item.Stick), "stick");
  assert.equal(itemIconKind(Item.RottenFlesh), "rotten-flesh");
  assert.equal(itemIconKind(Item.Wheat), "wheat");
  assert.equal(itemIconKind(BlockId.CraftingTable), "crafting-table");
  assert.equal(itemIconKind(BlockId.RedFlower), "world-flora-red");
  assert.equal(itemIconKind(BlockId.Chest), "chest");
  assert.equal(itemIconKind(Item.CaptureOrb), "capture-orb");
  assert.equal(itemIconKind(BlockId.Apiary), "apiary");
  assert.equal(itemIconKind(BlockId.CaptureOrbRack), "orb-rack");
  assert.equal(itemIconKind(BlockId.CreatureHealer), "orb-healer");
  assert.equal(itemIconKind(Item.Honeycomb), "honeycomb");
  assert.equal(itemIconKind(Item.RoyalJelly), "jelly");
  assert.equal(itemIconKind(Item.QueenCell), "queen-cell");
  assert.equal(itemIconKind(Item.WorkerBee), "bee");
  assert.equal(itemIconKind(Item.HealthPotion), "potion-health");
  assert.equal(itemIconKind(Item.GlassBottle), "bottle-empty");
  assert.equal(itemIconKind(Item.WaterBottle), "bottle-water");
  assert.equal(itemIconKind(BlockId.AlchemyStand), "alchemy");
  assert.equal(itemIconKind(Item.CrystalShard), "star-crystal");
  assert.equal(itemIconKind(BlockId.CrystalBlock), "star-crystal-block");
  assert.equal(itemIconKind(Item.Shellfruit), "shellfruit");
  for (const tome of [Item.TomeFlameJet, Item.TomeFrostLance, Item.TomeSteelSpear, Item.TomeHealingLight, Item.TomeBlinkstep, Item.TomeArcaneWard, Item.TomeVerdantVolley, Item.TomeStarlightSnare]) {
    assert.equal(itemIconKind(tome), "tome");
  }
  assert.match(itemHoverText({ item: Item.Apple, count: 1 }), /Food \+4/u);
  assert.equal(itemHoverText({ item: Item.CaveGel, count: 1 }), "Cave Gel");
});

test("v0.5 furniture and capture orbs use production held and drop silhouettes", () => {
  for (const item of [BlockId.Chest, BlockId.Apiary, BlockId.CaptureOrbRack, BlockId.CreatureHealer, Item.CaptureOrb]) {
    const model = createAvatarHeldItemModel(item);
    assert.ok(model && model.children.length >= 3, `${item} needs a readable multi-part held model`);
  }
  const filled = createAvatarHeldItemModel(Item.CaptureOrb, { filledCaptureOrb: true });
  const empty = createAvatarHeldItemModel(Item.CaptureOrb);
  assert.equal(filled?.userData.filledCaptureOrb, true);
  assert.equal(empty?.userData.filledCaptureOrb, false);
});

test("bestiary filters and completion respond to care progress", () => {
  assert.equal(bestiaryKindsForFilter("birds").includes("emberjay"), true);
  assert.equal(bestiaryKindsForFilter("birds").includes("frostquill"), true);
  assert.equal(bestiaryKindsForFilter("butterflies").includes("meadowwing"), true);
  assert.equal(bestiaryKindsForFilter("monsters").includes("zombie"), true);
  assert.equal(bestiaryKindsForFilter("golems").includes("copper-scout-golem"), true);
  assert.equal(bestiaryKindsForFilter("monsters").includes("copper-scout-golem"), false);
  assert.equal(bestiaryKindsForFilter("surface").includes("copper-scout-golem"), false);
  assert.equal(bestiaryKindsForFilter("companions").includes("peelop"), true);
  assert.equal(bestiaryKindsForFilter("companions").includes("rimecoat-hound"), true);
  assert.equal(bestiaryKindsForFilter("companions").includes("bramblewhisk-cat"), true);
  assert.equal(bestiaryEntryCompletion(MOB_DEFS.peelop, { seen: false, kills: 0, captures: 0 }), 0);
  assert.equal(bestiaryEntryCompletion(MOB_DEFS.peelop, { seen: true, kills: 0, captures: 0, tames: 1, breeds: 1, secretUnlocked: true }), 100);
  const dragonNotes = MOB_DEFS["fire-dragon"].fieldNotes ?? [];
  assert.equal(dragonNotes.length, 8);
  assert.equal(bestiaryFieldNoteUnlocked(dragonNotes[2], { seen: true, kills: 0, captures: 0, milestones: { "egg-recovered": 1 } }), true);
  assert.equal(bestiaryFieldNoteUnlocked(dragonNotes[3], { seen: true, kills: 0, captures: 0, milestones: { hatched: 1 } }), true);
  assert.equal(bestiaryEntryCompletion(MOB_DEFS["fire-dragon"], {
    seen: true, kills: 1, captures: 0, tames: 1, breeds: 1,
    milestones: { "mature-defeated": 1, "egg-recovered": 1, hatched: 1, "stage-3": 1, "scale-harvested": 1 },
  }), 100);
});

test("bestiary portraits stay contained above their navigation chrome", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const viewportRule = css.split(".bestiary-portrait > .creature-render {")
    .slice(1)
    .map((rule) => rule.split("}")[0])
    .find((rule) => /inset:\s*0\s+0\s+38px/u.test(rule)) ?? "";
  const portraitRule = css.split(".bestiary-portrait .creature-render-hero img {").at(-1)?.split("}")[0] ?? "";
  assert.match(viewportRule, /position:\s*absolute/u);
  assert.match(viewportRule, /inset:\s*0\s+0\s+38px/u);
  assert.match(viewportRule, /overflow:\s*hidden/u);
  assert.match(portraitRule, /height:\s*100%/u);
  assert.match(portraitRule, /max-height:\s*100%/u);
  assert.match(portraitRule, /object-fit:\s*contain/u);
  assert.match(portraitRule, /transform:\s*none/u);
});

test("field workstations keep four readable orb slots and responsive single-column fallbacks", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const orbGridRule = css.split(".orb-specimen-grid {").slice(1).map((rule) => rule.split("}")[0]).find((rule) => /repeat\(4,/u.test(rule)) ?? "";
  const mobileRules = css.split("@media (max-width: 520px)").at(-1) ?? "";
  assert.match(orbGridRule, /grid-template-columns:\s*repeat\(4,/u);
  assert.match(css, /\.apiary-workspace\s*\{[\s\S]*grid-template-columns:/u);
  assert.match(css, /\.worker-honeycomb\s*\{[\s\S]*repeat\(8,/u);
  assert.match(mobileRules, /\.orb-specimen-grid\s*\{\s*grid-template-columns:\s*1fr/u);
  assert.match(mobileRules, /\.apiary-yield\s*\{\s*grid-template-columns:\s*1fr/u);
});

test("multiplayer room codes remain short and shareable", () => {
  assert.equal(normalizeMultiplayerRoomCode(" wild  trail!! 42 "), "WILDTRAIL42");
  assert.equal(normalizeMultiplayerRoomCode("A".repeat(40)).length, 24);
});

test("unchanged bestiary HUD snapshots have a stable allocation-free signature", () => {
  const progress = Object.fromEntries(Object.keys(MOB_DEFS).map((kind) => [kind, {
    seen: false,
    kills: 0,
    captures: 0,
  }])) as BestiaryProgress;
  const initial = bestiaryProgressSignature(progress);
  assert.equal(bestiaryProgressSignature(progress), initial);
  progress.peelop.seen = true;
  assert.notEqual(bestiaryProgressSignature(progress), initial);
  const seen = bestiaryProgressSignature(progress);
  progress["fire-dragon"].milestones = { hatched: 1 };
  assert.notEqual(bestiaryProgressSignature(progress), seen);
});

test("multiplayer polling retains React state when the visible session is unchanged", () => {
  const state = {
    supported: true,
    reasons: [],
    status: "connected",
    role: "host" as const,
    peers: [{ id: "guest", identity: { id: "guest", name: "Trailkeeper" }, state: "connected", latencyMs: 24 }],
    inviteCode: "WILD-42",
    answerCode: "",
    roomCode: "WILD-42",
    rendezvousStatus: "connected" as const,
    error: null,
    agents: [],
    chat: [],
    newestChatSequence: 0,
    agentTasks: [],
    agentWaypoints: [],
  };
  assert.equal(multiplayerViewStatesEqual(state, structuredClone(state)), true);
  assert.equal(multiplayerViewStatesEqual(state, { ...structuredClone(state), peers: [{ ...state.peers[0], latencyMs: 25 }] }), false);
});
