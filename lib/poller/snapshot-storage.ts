import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SnapshotImage } from "@/lib/cameras/gateway";

// Penyimpanan snapshot terbaru per kamera. Satu berkas per kamera (ditimpa tiap kali),
// ditulis ke berkas sementara lalu di-rename agar pembaca tidak pernah melihat berkas setengah jadi.

export interface SnapshotStorage {
    /** Mengembalikan nama berkas (relatif terhadap direktori) yang disimpan di Camera.snapshotPath. */
    save(cameraId: string, image: SnapshotImage): Promise<string>;
}

const EXTENSIONS: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/svg+xml": "svg",
};
const CONTENT_TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type === "image/jpg" ? "image/jpeg" : type]));

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export class FsSnapshotStorage implements SnapshotStorage {
    constructor(private readonly dir: string) {}

    async save(cameraId: string, image: SnapshotImage): Promise<string> {
        if (!SAFE_ID.test(cameraId)) throw new Error("ID kamera tidak valid untuk nama berkas");
        const ext = EXTENSIONS[image.contentType.split(";")[0].trim().toLowerCase()];
        if (!ext) throw new Error(`Tipe gambar tidak didukung: ${image.contentType}`);

        await mkdir(/*turbopackIgnore: true*/ this.dir, { recursive: true });
        const name = `${cameraId}.${ext}`;
        const tmp = path.join(/*turbopackIgnore: true*/ this.dir, `${name}.${process.pid}.tmp`);
        await writeFile(tmp, image.bytes);
        await rename(tmp, path.join(/*turbopackIgnore: true*/ this.dir, name));
        return name;
    }
}

/** Baca berkas snapshot dari nama yang tersimpan di database; menolak nama yang mengandung path. */
export async function readSnapshotFile(
    dir: string,
    storedName: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
    if (storedName !== path.basename(storedName)) return null;
    const ext = path.extname(storedName).slice(1).toLowerCase();
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) return null;
    try {
        return { bytes: await readFile(path.join(/*turbopackIgnore: true*/ dir, storedName)), contentType };
    } catch {
        return null;
    }
}

export function snapshotDir() {
    return path.resolve(/*turbopackIgnore: true*/ process.env.SNAPSHOT_DIR ?? "./storage/snapshots");
}
