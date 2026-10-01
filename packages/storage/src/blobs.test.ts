import { test, expect } from "vitest";
import { mkdtemp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { FileBlobStore, sha256 } from "./blobs.js";
test("filesystem immutable writes converge under contention and reject conflicting bytes", async () => {
  const root = await mkdtemp(`${tmpdir()}/exhibitos-unit-`);
  try {
    const store = new FileBlobStore(root),
      bytes = Buffer.from("synthetic");
    await Promise.all(
      Array.from({ length: 5 }, () =>
        store.put("tenant/quarantine/hash", bytes),
      ),
    );
    expect(sha256(await store.get("tenant/quarantine/hash"))).toBe(
      sha256(bytes),
    );
    await expect(
      store.put("tenant/quarantine/hash", Buffer.from("conflict")),
    ).rejects.toThrow("conflict");
    expect(await store.list("tenant")).toEqual(["tenant/quarantine/hash"]);
  } finally {
    await rm(root, { recursive: true });
  }
});
test("filesystem rejects traversal and symlinked parent/final files", async () => {
  const root = await mkdtemp(`${tmpdir()}/exhibitos-unit-`);
  try {
    const store = new FileBlobStore(root);
    await expect(
      store.put("tenant/../outside", Buffer.from("test")),
    ).rejects.toThrow("invalid");
    await symlink(tmpdir(), `${root}/tenant`);
    await expect(store.put("tenant/file", Buffer.from("test"))).rejects.toThrow(
      "unsafe",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
test("filesystem bounded writes reject empty and oversized input", async () => {
  const root = await mkdtemp(`${tmpdir()}/exhibitos-unit-`);
  try {
    const store = new FileBlobStore(root);
    await expect(store.put("tenant/file", Buffer.alloc(0))).rejects.toThrow(
      "size",
    );
    await expect(
      store.put("tenant/file", Buffer.alloc(32 * 1024 * 1024 + 1)),
    ).rejects.toThrow("size");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("S3 aborts oversized actual streams despite missing or dishonest ContentLength", async () => {
  const { S3BlobStore } = await import("./blobs.js");
  const { Readable } = await import("node:stream");
  for (const contentLength of [undefined, 1]) {
    let chunks = 0;
    const body = Readable.from(
      (async function* () {
        for (let i = 0; i < 40; i++) {
          chunks++;
          yield Buffer.alloc(1024 * 1024);
        }
      })(),
    );
    const client = {
      send: async () => ({ Body: body, ContentLength: contentLength }),
    } as unknown as import("@aws-sdk/client-s3").S3Client;
    await expect(
      new S3BlobStore(client, "synthetic").get("tenant/file"),
    ).rejects.toThrow("size limit");
    expect(chunks).toBeLessThan(40);
    expect(body.destroyed).toBe(true);
  }
});

test("filesystem list rejects a symlinked configured root", async () => {
  const target = await mkdtemp(`${tmpdir()}/exhibitos-unit-target-`),
    holder = await mkdtemp(`${tmpdir()}/exhibitos-unit-holder-`);
  try {
    await symlink(target, `${holder}/root`);
    await expect(
      new FileBlobStore(`${holder}/root`).list("tenant"),
    ).rejects.toThrow("unsafe root");
  } finally {
    await rm(holder, { recursive: true });
    await rm(target, { recursive: true });
  }
});
