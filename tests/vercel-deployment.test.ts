import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const root = process.cwd();

test("Vercel uses a native Next build without replacing the Sites build", () => {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const vercelConfig = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8")) as {
    buildCommand: string;
  };

  assert.equal(packageJson.scripts.build, "bash scripts/build-verified.sh");
  assert.equal(packageJson.scripts["build:vercel"], "node scripts/clean-next-build-cache.mjs && npm run build:wiki && next build --webpack");
  assert.equal(vercelConfig.buildCommand, "npm run build:vercel");
});

test("Cardforge helpers do not collide with Next route conventions", () => {
  assert.equal(existsSync(resolve(root, "app/game/tcg/layout.ts")), false);
  assert.equal(existsSync(resolve(root, "app/game/tcg/card-layout.ts")), true);
});

test("production metadata points at the Blockwild domain", () => {
  const layout = readFileSync(resolve(root, "app/layout.tsx"), "utf8");
  assert.match(layout, /metadataBase: new URL\("https:\/\/blockwild\.app"\)/u);
});
