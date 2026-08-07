import test from "node:test";
import assert from "node:assert/strict";
import { defaultPlaybackProvider } from "./playbackProvider";

function withProviderEnv(
  defaultValue: string | undefined,
  byTier: string | undefined,
  run: () => void,
) {
  const oldDefault = process.env.PLAYBACK_PROVIDER_DEFAULT;
  const oldByTier = process.env.PLAYBACK_PROVIDER_BY_TIER;
  if (defaultValue === undefined) delete process.env.PLAYBACK_PROVIDER_DEFAULT;
  else process.env.PLAYBACK_PROVIDER_DEFAULT = defaultValue;
  if (byTier === undefined) delete process.env.PLAYBACK_PROVIDER_BY_TIER;
  else process.env.PLAYBACK_PROVIDER_BY_TIER = byTier;
  try { run(); } finally {
    if (oldDefault === undefined) delete process.env.PLAYBACK_PROVIDER_DEFAULT;
    else process.env.PLAYBACK_PROVIDER_DEFAULT = oldDefault;
    if (oldByTier === undefined) delete process.env.PLAYBACK_PROVIDER_BY_TIER;
    else process.env.PLAYBACK_PROVIDER_BY_TIER = oldByTier;
  }
}

test("new review uploads default to Mux", () => {
  withProviderEnv(undefined, undefined, () => {
    assert.equal(defaultPlaybackProvider("free"), "mux");
    assert.equal(defaultPlaybackProvider("pro"), "mux");
  });
});

test("Cloudflare Stream remains an explicit fallback", () => {
  withProviderEnv("cloudflare_stream", undefined, () => {
    assert.equal(defaultPlaybackProvider("pro"), "cloudflare_stream");
  });
});
