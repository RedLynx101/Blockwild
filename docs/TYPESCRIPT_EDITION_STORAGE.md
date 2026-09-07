# TypeScript Edition browser data

The TypeScript Edition owns a separate browser-data namespace. Normal startup does not read, import, rewrite, or delete the generic keys used before the editions were split, and it does not traverse the Rust edition's persistence database.

## Owned names

All TypeScript-owned browser keys begin with `blockwild-typescript-`:

| Data | Name |
| --- | --- |
| World catalog | `blockwild-typescript-world-catalog-v1` |
| World documents | `blockwild-typescript-world-data-v1:<world-id>` |
| Legacy TypeScript singleton | `blockwild-typescript-world-v2` |
| Settings | `blockwild-typescript-settings-v2` |
| UI preferences | `blockwild-typescript-ui-preferences-v1` |
| Character profiles | `blockwild-typescript-character-profiles-v1` |
| Browser player identity | `blockwild-typescript-browser-player-id-v1` |
| Multiplayer player identity | `blockwild-typescript-multiplayer-player-id` |
| Agent identity | `blockwild-typescript-agent-id` |
| Disposable terrain-cache IndexedDB | `blockwild-typescript-terrain-cache-v2` |
| WebRTC protocol | `blockwild-typescript-webrtc` |
| Rendezvous application | `blockwild-typescript-multiplayer-v1` |

The legacy singleton above is legacy only within this edition's namespace. It is not the generic pre-split `blockwild-world-v2` key.

## Previous-edition data

When the title screen detects generic pre-split localStorage records by key name, it explains that they remain outside the TypeScript world list. Detection reads key names only. It does not read the record values.

The **Review & export** flow offers **Export previous-edition data**. This explicit action downloads `blockwild-previous-edition-backup-v1.json` and includes exact, unparsed localStorage strings for this allowlist:

- `blockwild-agent-id`
- `blockwild-browser-player-id-v1`
- `blockwild-character-profiles-v1`
- `blockwild-multiplayer-player-id`
- `blockwild-player-variant`
- `blockwild-settings-v2`
- `blockwild-ui-preferences-v1`
- `blockwild-world-catalog-v1`
- `blockwild-world-v2`
- each nonempty `blockwild-world-data-v1:<world-id>` key

Collection is read-only and deterministic. It does not parse or normalize values, write a migration marker, import a world, or remove source data. Unrelated and lookalike keys are excluded.

The backup reports, but does not copy, the authoritative Rust IndexedDB `blockwild-rust-persistence-v1` version 3. That database contains typed byte payloads across private stores and does not expose a versioned whole-database export contract. Use the Rust edition's own world export to retrieve that data. The generic `blockwild-terrain-cache-v2` database is also excluded because it is deterministic disposable terrain cache data. Neither database is changed by the TypeScript Edition.

## World files and compatibility

TypeScript worlds can be moved explicitly with the existing version-1 `blockwild-world` export and import flow. Imports are validated before any TypeScript catalog or world document is written. Unsupported formats and versions fail without mutating the target store.

Internal normalization can upgrade supported older TypeScript world documents to the current Generator 18 representation. That is not cross-edition conversion. Generic pre-split records and Rust persistence are never imported automatically, and cross-edition save compatibility is not promised.

Multiplayer is likewise edition-bound. Invite codes must identify protocol version 3 and `blockwild-typescript-webrtc`; generic or Rust protocol names are rejected before their payloads are inspected. Rendezvous discovery uses the TypeScript-specific application label, so independently deployed editions do not intentionally share rooms.
