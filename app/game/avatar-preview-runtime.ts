import type { CharacterAppearance } from "./character-profiles";
import type { HudState, ItemCode, PlayerVariant } from "./engine";

export type PlayerAvatarPreviewProps = Readonly<{
  variant: PlayerVariant;
  appearance?: CharacterAppearance;
  equipment?: HudState["equipment"];
  heldItem?: ItemCode;
  offhandItem?: ItemCode;
  compact?: boolean;
  onUnavailable?: (error?: unknown) => void;
}>;

const AVATAR_PREVIEW_FRAME_INTERVAL_MS = 1000 / 22;
const AVATAR_PREVIEW_RENDERER_IDLE_MS = 30_000;

type AvatarPreviewFrameTask = {
  isConnected: () => boolean;
  render: (now: number) => void;
  onError?: (error: unknown) => void;
};

/**
 * Shares one capped animation-frame loop across every visible avatar preview.
 * The scheduler is renderer-neutral so title and inventory UI do not load Three.
 */
export function createAvatarPreviewFrameScheduler(
  requestFrame: (callback: (now: number) => void) => number,
  cancelFrame: (frame: number) => void,
  frameIntervalMs = AVATAR_PREVIEW_FRAME_INTERVAL_MS,
) {
  type Entry = AvatarPreviewFrameTask & { visible: boolean };
  const entries = new Set<Entry>();
  let animationFrame: number | null = null;
  let lastRenderedAt = Number.NEGATIVE_INFINITY;

  const runnableEntries = () => [...entries].filter((entry) => entry.visible && entry.isConnected());
  const cancelIfIdle = () => {
    if (animationFrame === null || runnableEntries().length > 0) return;
    cancelFrame(animationFrame);
    animationFrame = null;
  };
  const schedule = () => {
    if (animationFrame !== null || runnableEntries().length === 0) return;
    animationFrame = requestFrame(renderFrame);
  };
  function renderFrame(now: number) {
    animationFrame = null;
    const runnable = runnableEntries();
    if (runnable.length === 0) return;
    if (now - lastRenderedAt >= frameIntervalMs) {
      lastRenderedAt = now;
      for (const entry of runnable) {
        try {
          entry.render(now);
        } catch (error) {
          entry.onError?.(error);
        }
      }
    }
    schedule();
  }

  return {
    register(task: AvatarPreviewFrameTask, initiallyVisible = true) {
      const entry: Entry = { ...task, visible: initiallyVisible };
      entries.add(entry);
      schedule();
      return {
        setVisible(visible: boolean) {
          if (entry.visible === visible) return;
          entry.visible = visible;
          if (visible) schedule();
          else cancelIfIdle();
        },
        dispose() {
          entries.delete(entry);
          cancelIfIdle();
        },
      };
    },
  };
}

type AvatarPreviewVisibilityEntry = Pick<IntersectionObserverEntry, "intersectionRatio" | "isIntersecting" | "target">;
type AvatarPreviewVisibilityObserver = Pick<IntersectionObserver, "disconnect" | "observe">;
type AvatarPreviewVisibilityObserverFactory = (
  callback: (entries: ReadonlyArray<AvatarPreviewVisibilityEntry>) => void,
) => AvatarPreviewVisibilityObserver | null;

function createBrowserAvatarPreviewVisibilityObserver(
  callback: (entries: ReadonlyArray<AvatarPreviewVisibilityEntry>) => void,
): AvatarPreviewVisibilityObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  return new IntersectionObserver((entries) => callback(entries));
}

/** Keeps previews usable when intersection observation is unavailable or broken. */
export function observeAvatarPreviewVisibility(
  element: Element,
  onVisibilityChange: (visible: boolean) => void,
  createObserver: AvatarPreviewVisibilityObserverFactory | null = createBrowserAvatarPreviewVisibilityObserver,
) {
  let observer: AvatarPreviewVisibilityObserver | null = null;
  try {
    observer = createObserver?.((entries) => {
      const entry = entries.find((candidate) => candidate.target === element);
      if (entry) onVisibilityChange(entry.isIntersecting && entry.intersectionRatio > 0);
    }) ?? null;
  } catch {
    observer = null;
  }
  if (!observer) {
    onVisibilityChange(true);
    return () => undefined;
  }
  try {
    observer.observe(element);
  } catch {
    observer.disconnect();
    onVisibilityChange(true);
    return () => undefined;
  }
  return () => observer.disconnect();
}

type AvatarPreviewRendererResource = {
  dispose: () => void;
  forceContextLoss: () => void;
};

/** Retains at most one renderer while overlays switch, then releases it after idle. */
export function createAvatarPreviewRendererPool<Renderer extends AvatarPreviewRendererResource, TimerHandle>({
  createRenderer,
  scheduleRelease,
  cancelRelease,
  idleMs = AVATAR_PREVIEW_RENDERER_IDLE_MS,
  onCreateError,
}: {
  createRenderer: () => Renderer;
  scheduleRelease: (callback: () => void, delayMs: number) => TimerHandle;
  cancelRelease: (timer: TimerHandle) => void;
  idleMs?: number;
  onCreateError?: (error: unknown) => void;
}) {
  let renderer: Renderer | null = null;
  let users = 0;
  let releaseTimer: TimerHandle | null = null;
  let unavailable = false;

  return {
    acquire() {
      if (releaseTimer !== null) {
        cancelRelease(releaseTimer);
        releaseTimer = null;
      }
      users += 1;
      if (renderer || unavailable) return renderer;
      try {
        renderer = createRenderer();
      } catch (error) {
        unavailable = true;
        onCreateError?.(error);
      }
      return renderer;
    },
    release() {
      users = Math.max(0, users - 1);
      if (users > 0 || releaseTimer !== null || !renderer) return;
      releaseTimer = scheduleRelease(() => {
        releaseTimer = null;
        if (users > 0 || !renderer) return;
        const releasedRenderer = renderer;
        renderer = null;
        releasedRenderer.dispose();
        releasedRenderer.forceContextLoss();
      }, idleMs);
    },
  };
}
