"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { createAvatarPreviewFrameScheduler, createAvatarPreviewRendererPool, observeAvatarPreviewVisibility, type PlayerAvatarPreviewProps } from "../game/avatar-preview-runtime";
import { ITEMS } from "../game/data";
import { createAvatarHeldItemModel } from "../game/held-items";
import { BlockPlayerModel, type PlayerEquipmentAppearance } from "../game/player-model";
import { createBlockAtlas } from "../game/world";

let avatarPreviewAtlas: THREE.Texture | null = null;

function createPreviewHeldItem(item: PlayerAvatarPreviewProps["heldItem"]) {
  if (item === undefined) return null;
  avatarPreviewAtlas ??= createBlockAtlas();
  return createAvatarHeldItemModel(item, { atlas: avatarPreviewAtlas });
}

function disposePreviewObject(object: THREE.Object3D | null) {
  object?.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

// Compatibility previews share one off-screen WebGL context and one capped
// frame scheduler. Each result is copied into a cheap 2D canvas, so inactive
// overlays add neither a context nor their own animation loop.
const sharedAvatarPreviewFrameScheduler = createAvatarPreviewFrameScheduler(
  (callback) => requestAnimationFrame(callback),
  (frame) => cancelAnimationFrame(frame),
);
const sharedAvatarPreviewRendererPool = createAvatarPreviewRendererPool<THREE.WebGLRenderer, ReturnType<typeof setTimeout>>({
  createRenderer: () => {
    const surface = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({
      canvas: surface,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 0);
    return renderer;
  },
  scheduleRelease: (callback, delayMs) => setTimeout(callback, delayMs),
  cancelRelease: (timer) => clearTimeout(timer),
  onCreateError: (error) => {
    console.warn("Blockwild character preview is using its 2D fallback.", error);
  },
});

/** Optional Three/WebGL compatibility presentation loaded only after hydration. */
export function PlayerAvatarPreviewThree({
  variant,
  appearance,
  equipment,
  heldItem,
  offhandItem,
  compact = false,
  onUnavailable,
}: PlayerAvatarPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const head = equipment?.head?.item;
  const chest = equipment?.chest?.item;
  const legs = equipment?.legs?.item;
  const feet = equipment?.feet?.item;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) {
      onUnavailable?.(new Error("avatar preview 2D presentation context is unavailable"));
      return;
    }
    const renderer = sharedAvatarPreviewRendererPool.acquire();
    if (!renderer) {
      sharedAvatarPreviewRendererPool.release();
      onUnavailable?.(new Error("avatar preview WebGL renderer is unavailable"));
      return;
    }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(compact ? 28 : 31, 1, 0.1, 20);
    camera.position.set(compact ? 1.9 : 2.65, compact ? 1.92 : 2.18, compact ? -3.25 : -4.3);
    camera.lookAt(0, 1.02, 0);
    scene.add(new THREE.HemisphereLight(0xe7f4ff, 0x604c38, 2.1));
    const key = new THREE.DirectionalLight(0xfff2cf, 2.6);
    key.position.set(-3, 5, -4);
    key.castShadow = true;
    scene.add(key);
    const model = new BlockPlayerModel({ variant, race: appearance?.race, colors: appearance?.colors, mode: "local", castShadow: true, receiveShadow: true });
    if (appearance) model.setAppearance(appearance);
    const equipmentAppearance: PlayerEquipmentAppearance = {
      head: head === undefined ? null : ITEMS[head]?.color,
      chest: chest === undefined ? null : ITEMS[chest]?.color,
      legs: legs === undefined ? null : ITEMS[legs]?.color,
      feet: feet === undefined ? null : ITEMS[feet]?.color,
    };
    model.setEquipmentAppearance(equipmentAppearance);
    model.group.rotation.y = -0.32;
    scene.add(model.group);
    const held = createPreviewHeldItem(heldItem);
    const offhand = createPreviewHeldItem(offhandItem);
    model.setHeldItem(held);
    model.setOffhandItem(offhand, offhandItem !== undefined && ITEMS[offhandItem]?.iconKind === "shield");
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), new THREE.ShadowMaterial({ opacity: 0.28 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    scene.add(floor);

    let previous = performance.now();
    let width = 120;
    let height = 150;
    let pixelRatio = 1;
    let unavailable = false;
    const fail = (error: unknown) => {
      if (unavailable) return;
      unavailable = true;
      onUnavailable?.(error);
    };
    const resize = () => {
      width = Math.max(120, Math.round(canvas.clientWidth));
      height = Math.max(150, Math.round(canvas.clientHeight));
      pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    const frameRegistration = sharedAvatarPreviewFrameScheduler.register({
      isConnected: () => canvas.isConnected,
      render: (now) => {
        const dt = Math.min(0.05, (now - previous) / 1000);
        previous = now;
        model.update(dt, { locomotion: "idle", headYaw: Math.sin(now * 0.0007) * 0.08 });
        model.group.rotation.y = -0.32 + Math.sin(now * 0.00035) * 0.045;
        if (renderer.getContext().isContextLost()) {
          fail(new Error("avatar preview WebGL context was lost"));
          return;
        }
        try {
          renderer.setPixelRatio(pixelRatio);
          renderer.setSize(width, height, false);
          renderer.render(scene, camera);
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
        } catch (error) {
          fail(error);
        }
      },
      onError: fail,
    }, false);
    const stopVisibilityObservation = observeAvatarPreviewVisibility(canvas, frameRegistration.setVisible);
    return () => {
      stopVisibilityObservation();
      frameRegistration.dispose();
      resizeObserver.disconnect();
      model.setHeldItem(null);
      model.setOffhandItem(null);
      disposePreviewObject(held);
      disposePreviewObject(offhand);
      model.dispose();
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      sharedAvatarPreviewRendererPool.release();
    };
  }, [variant, appearance, head, chest, legs, feet, heldItem, offhandItem, compact, onUnavailable]);

  return (
    <canvas
      ref={canvasRef}
      className={`player-avatar-preview ${compact ? "compact" : ""}`}
      aria-label={`${variant === "female" ? "Female" : "Male"} ${appearance?.race ?? "wayfarer"} player model preview`}
      data-avatar-preview="three-compat"
    />
  );
}

export default PlayerAvatarPreviewThree;
