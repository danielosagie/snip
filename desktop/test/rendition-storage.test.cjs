"use strict";

const path = require("node:path");
const { Readable } = require("node:stream");
const { afterEach, describe, expect, test } = require("bun:test");
const { start } = require("../electron-webdav.cjs");
const {
  buildProxyR2Key,
  mirrorRenditionToR2,
  renditionCacheDirectory,
  selectMountedRendition,
} = require("../lib/rendition-storage.cjs");

let server = null;

afterEach(async () => {
  await server?.stop();
  server = null;
});

describe("mount rendition resolution", () => {
  test("prefers a ready 720p mirror and falls back to the original", () => {
    const original = {
      key: "projects/team/project/originals/video/master.mov",
      size: 8_000,
      contentType: "video/quicktime",
    };
    const proxies = [
      {
        resolution: "1080p",
        status: "ready",
        r2Key: "projects/team/project/proxies/video/1080p.mp4",
        filesizeBytes: 800,
      },
      {
        resolution: "720p",
        status: "ready",
        r2Key: "projects/team/project/proxies/video/720p.mp4",
        filesizeBytes: 400,
      },
    ];

    expect(selectMountedRendition({ original, proxies })).toMatchObject({
      mode: "proxy",
      key: proxies[1].r2Key,
      size: 400,
    });
    expect(
      selectMountedRendition({ preferProxy: false, original, proxies }),
    ).toMatchObject({ mode: "full-res", key: original.key, size: 8_000 });
  });

  test("uses separate persistent cache paths for proxy and full-res bytes", () => {
    const root = path.join("tmp", "snip-cache");
    expect(renditionCacheDirectory(root, true)).toBe(
      path.join(root, "renditions", "proxy"),
    );
    expect(renditionCacheDirectory(root, false)).toBe(
      path.join(root, "renditions", "full-res"),
    );
  });

  test("passes the toggle through WebDAV path resolution", async () => {
    const calls = [];
    server = await start({
      convexCall: async (kind, name, args) => {
        calls.push({ kind, name, args });
        return {
          url: `https://r2.example/${args.preferProxy ? "proxy" : "original"}`,
          contentType: "video/mp4",
          size: args.preferProxy ? 400 : 8_000,
          isProxy: args.preferProxy,
        };
      },
      preferProxy: true,
    });
    const url = `http://127.0.0.1:${server.port}/webdav/team/project/cut.mov`;

    const proxyResponse = await fetch(url, { method: "HEAD", redirect: "manual" });
    expect(proxyResponse.headers.get("x-snip-rendition")).toBe("proxy");
    server.setPreferProxy(false);
    const originalResponse = await fetch(url, { method: "HEAD", redirect: "manual" });
    expect(originalResponse.headers.get("x-snip-rendition")).toBe("full-res");
    expect(calls.map((call) => call.args.preferProxy)).toEqual([true, false]);
  });
});

describe("streaming rendition mirror", () => {
  test("streams a Mux body into a multipart R2 upload", async () => {
    let uploadOptions = null;
    class FakeUpload {
      constructor(options) {
        uploadOptions = options;
      }
      async done() {}
    }
    const key = buildProxyR2Key({
      teamSlug: "editors",
      projectId: "project123",
      videoId: "video456",
      name: "720p.mp4",
    });
    const result = await mirrorRenditionToR2({
      s3: {},
      bucket: "media",
      sourceUrl: "https://stream.mux.com/playback/720p.mp4",
      key,
      UploadClass: FakeUpload,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        body: Readable.from([Buffer.from("first"), Buffer.from("second")]),
        headers: new Headers({
          "content-length": "11",
          "content-type": "video/mp4",
        }),
      }),
    });

    expect(uploadOptions.params).toMatchObject({
      Bucket: "media",
      Key: key,
      ContentType: "video/mp4",
    });
    expect(typeof uploadOptions.params.Body.pipe).toBe("function");
    expect(uploadOptions.partSize).toBe(64 * 1024 * 1024);
    expect(result).toEqual({ key, size: 11, contentType: "video/mp4" });
  });

  test("rejects non-Mux sources and non-proxy destinations", async () => {
    await expect(
      mirrorRenditionToR2({
        s3: {},
        bucket: "media",
        sourceUrl: "https://example.com/video.mp4",
        key: "projects/team/project/proxies/video/720p.mp4",
      }),
    ).rejects.toThrow("stream.mux.com");
    await expect(
      mirrorRenditionToR2({
        s3: {},
        bucket: "media",
        sourceUrl: "https://stream.mux.com/playback/720p.mp4",
        key: "originals/master.mov",
      }),
    ).rejects.toThrow("project proxy key");
  });
});
