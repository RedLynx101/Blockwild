import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";
import { resolveWorldgenBuildProfile } from "./build/worldgen-build-profile";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const worldgenBuildProfile = resolveWorldgenBuildProfile();

const RUST_ENGINE_CANDIDATE_PREFIX = "/engine-locator-candidate";

export function rewriteRustEngineCandidateRequestUrl(requestUrl: string) {
  const queryIndex = requestUrl.indexOf("?");
  const pathname = queryIndex >= 0 ? requestUrl.slice(0, queryIndex) : requestUrl;
  const query = queryIndex >= 0 ? requestUrl.slice(queryIndex) : "";
  if (pathname === "/engine") return `${RUST_ENGINE_CANDIDATE_PREFIX}${query}`;
  if (pathname.startsWith("/engine/")) {
    return `${RUST_ENGINE_CANDIDATE_PREFIX}${pathname.slice("/engine".length)}${query}`;
  }
  return requestUrl;
}

export function rustEngineCandidateAliasPlugin(
  enabled = process.env.BLOCKWILD_RUST_ENGINE_CANDIDATE_ALIAS === "1",
): Plugin {
  return {
    name: "blockwild-rust-engine-candidate-alias",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((request, _response, next) => {
        if (request.url) request.url = rewriteRustEngineCandidateRequestUrl(request.url);
        next();
      });
    },
  };
}

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    define: {
      "process.env.NEXT_PUBLIC_BLOCKWILD_WORLDGEN_BUILD_PROFILE": JSON.stringify(worldgenBuildProfile),
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      rustEngineCandidateAliasPlugin(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
