"use client";

import { useEffect, useRef } from "react";
import { ITEMS } from "./data";
import type { PlayerAvatarPreviewProps } from "./avatar-preview-runtime";

type AvatarPreviewFallbackRect = Readonly<{
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}>;

function cssColor(value: string | number | null | undefined, fallback: string) {
  if (typeof value === "number") return `#${value.toString(16).padStart(6, "0").slice(-6)}`;
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/**
 * Returns the renderer-independent paper-doll plan used whenever the optional
 * Three preview cannot load. Keeping this pure makes the failure presentation
 * deterministic and testable without Canvas or WebGL.
 */
export function createAvatarPreviewFallbackPlan({
  variant,
  appearance,
  equipment,
  heldItem,
  offhandItem,
}: PlayerAvatarPreviewProps): readonly AvatarPreviewFallbackRect[] {
  const colors = appearance?.colors;
  const headItem = equipment?.head?.item;
  const chestItem = equipment?.chest?.item;
  const legsItem = equipment?.legs?.item;
  const feetItem = equipment?.feet?.item;
  const skin = cssColor(colors?.skin, "#bf815e");
  const hair = cssColor(colors?.hair, variant === "female" ? "#171313" : "#4d3424");
  const shirt = cssColor(chestItem === undefined ? colors?.shirt : ITEMS[chestItem]?.color, variant === "female" ? "#674f79" : "#557080");
  const trousers = cssColor(legsItem === undefined ? colors?.trousers : ITEMS[legsItem]?.color, "#3a4652");
  const boots = cssColor(feetItem === undefined ? undefined : ITEMS[feetItem]?.color, "#2f2823");
  const rectangles: AvatarPreviewFallbackRect[] = [
    { color: hair, x: -25, y: 0, width: 50, height: variant === "female" ? 28 : 23 },
    { color: skin, x: -22, y: 13, width: 44, height: 38 },
    { color: "#24211f", x: -12, y: 27, width: 5, height: 4 },
    { color: "#24211f", x: 7, y: 27, width: 5, height: 4 },
    { color: cssColor(headItem === undefined ? undefined : ITEMS[headItem]?.color, "transparent"), x: -26, y: 5, width: 52, height: 20 },
    { color: shirt, x: -25, y: 52, width: 50, height: 56 },
    { color: skin, x: -39, y: 55, width: 13, height: 59 },
    { color: skin, x: 26, y: 55, width: 13, height: 59 },
    { color: trousers, x: -22, y: 108, width: 20, height: 51 },
    { color: trousers, x: 3, y: 108, width: 20, height: 51 },
    { color: boots, x: -23, y: 157, width: 21, height: 13 },
    { color: boots, x: 3, y: 157, width: 21, height: 13 },
  ];
  if (heldItem !== undefined) {
    rectangles.push({ color: cssColor(ITEMS[heldItem]?.color, "#9b7c4a"), x: 36, y: 78, width: 11, height: 50 });
  }
  if (offhandItem !== undefined) {
    const shield = ITEMS[offhandItem]?.iconKind === "shield";
    rectangles.push({
      color: cssColor(ITEMS[offhandItem]?.color, "#9b7c4a"),
      x: shield ? -48 : -45,
      y: shield ? 64 : 78,
      width: shield ? 24 : 11,
      height: shield ? 48 : 50,
    });
  }
  return rectangles.filter((rectangle) => rectangle.color !== "transparent");
}

export function drawAvatarPreviewFallback(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  props: PlayerAvatarPreviewProps,
) {
  context.clearRect(0, 0, width, height);
  const scale = Math.max(1, Math.min(width / 112, height / 180));
  const centerX = width * 0.5;
  const top = height * 0.09;
  context.save();
  context.translate(0.5, 0.5);
  context.shadowColor = "rgba(21, 18, 15, .24)";
  context.shadowBlur = 7 * scale;
  context.shadowOffsetY = 4 * scale;
  for (const rectangle of createAvatarPreviewFallbackPlan(props)) {
    context.fillStyle = rectangle.color;
    context.fillRect(
      Math.round(centerX + rectangle.x * scale),
      Math.round(top + rectangle.y * scale),
      Math.ceil(rectangle.width * scale),
      Math.ceil(rectangle.height * scale),
    );
  }
  context.restore();
}

export function AvatarPreviewFallback(props: PlayerAvatarPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const redraw = () => {
      const width = Math.max(120, Math.round(canvas.clientWidth));
      const height = Math.max(150, Math.round(canvas.clientHeight));
      const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      drawAvatarPreviewFallback(context, canvas.width, canvas.height, props);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(redraw);
    observer?.observe(canvas);
    redraw();
    return () => observer?.disconnect();
  }, [props]);

  return (
    <canvas
      ref={canvasRef}
      className={`player-avatar-preview ${props.compact ? "compact" : ""}`}
      aria-label={`${props.variant === "female" ? "Female" : "Male"} ${props.appearance?.race ?? "wayfarer"} player model preview`}
      data-avatar-preview="fallback"
    />
  );
}
