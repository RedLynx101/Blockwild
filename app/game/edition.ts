export const BLOCKWILD_EDITION = "typescript" as const;
export const TYPESCRIPT_STORAGE_PREFIX = `blockwild-${BLOCKWILD_EDITION}` as const;

export const TYPESCRIPT_SETTINGS_KEY = `${TYPESCRIPT_STORAGE_PREFIX}-settings-v2` as const;
export const TYPESCRIPT_UI_PREFERENCES_KEY = `${TYPESCRIPT_STORAGE_PREFIX}-ui-preferences-v1` as const;
export const TYPESCRIPT_AGENT_ID_KEY = `${TYPESCRIPT_STORAGE_PREFIX}-agent-id` as const;
export const TYPESCRIPT_MULTIPLAYER_PLAYER_ID_KEY = `${TYPESCRIPT_STORAGE_PREFIX}-multiplayer-player-id` as const;
export const TYPESCRIPT_TERRAIN_CACHE_DATABASE = `${TYPESCRIPT_STORAGE_PREFIX}-terrain-cache-v2` as const;
export const TYPESCRIPT_MULTIPLAYER_PROTOCOL = `${TYPESCRIPT_STORAGE_PREFIX}-webrtc` as const;
export const TYPESCRIPT_RENDEZVOUS_APP_ID = `${TYPESCRIPT_STORAGE_PREFIX}-multiplayer-v1` as const;
