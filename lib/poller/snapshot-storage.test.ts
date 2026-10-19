import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { FsSnapshotStorage, readSnapshotFile } from "./snapshot-storage";

let dir: string;
before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "snap-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const jpeg = (bytes: number[]) => ({ bytes: new Uint8Array(bytes), contentType: "image/jpeg" });

describe("FsSnapshotStorage", () => {
    it("menyimpan lalu membaca kembali, dengan tipe konten dari ekstensi", async () => {
        const storage = new FsSnapshotStorage(dir);
        const name = await storage.save("cam123", jpeg([1, 2, 3]));
        assert.equal(name, "cam123.jpg");
        const file = await readSnapshotFile(dir, name);
        assert.deepEqual([...file!.bytes], [1, 2, 3]);
        assert.equal(file!.contentType, "image/jpeg");
    });

    it("menimpa snapshot lama dan tidak meninggalkan berkas sementara", async () => {
        const storage = new FsSnapshotStorage(dir);
        await storage.save("camX", jpeg([1]));
        await storage.save("camX", jpeg([9, 9]));
        assert.deepEqual([...(await readSnapshotFile(dir, "camX.jpg"))!.bytes], [9, 9]);
        assert.ok((await readdir(dir)).every((f) => !f.endsWith(".tmp")));
    });

    it("membuat direktori bila belum ada", async () => {
        const nested = path.join(dir, "a", "b");
        await new FsSnapshotStorage(nested).save("c1", jpeg([1]));
        assert.ok((await readdir(nested)).includes("c1.jpg"));
    });

    it("menolak ID kamera berbahaya dan tipe gambar tak didukung", async () => {
        const storage = new FsSnapshotStorage(dir);
        await assert.rejects(storage.save("../../etc/passwd", jpeg([1])), /tidak valid/);
        await assert.rejects(storage.save("a/b", jpeg([1])), /tidak valid/);
        await assert.rejects(storage.save("ok", { bytes: new Uint8Array([1]), contentType: "text/html" }), /tidak didukung/);
    });

    it("mendukung parameter pada content-type", async () => {
        assert.equal(await new FsSnapshotStorage(dir).save("cp", { bytes: new Uint8Array([1]), contentType: "image/png; charset=binary" }), "cp.png");
    });
});

describe("readSnapshotFile", () => {
    it("menolak nama dengan path (path traversal)", async () => {
        await writeFile(path.join(dir, "rahasia.jpg"), "x");
        assert.equal(await readSnapshotFile(path.join(dir, "a"), "../rahasia.jpg"), null);
        assert.equal(await readSnapshotFile(dir, "../x.jpg"), null);
        assert.equal(await readSnapshotFile(dir, "sub/x.jpg"), null);
    });

    it("null bila berkas tidak ada atau ekstensi tak dikenal", async () => {
        assert.equal(await readSnapshotFile(dir, "tidak-ada.jpg"), null);
        await writeFile(path.join(dir, "x.exe"), "x");
        assert.equal(await readSnapshotFile(dir, "x.exe"), null);
    });
});
