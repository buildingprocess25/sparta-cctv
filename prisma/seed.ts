import "dotenv/config";
import prisma from "../lib/prisma";
import { mockSerial, seedContractors, seedStores } from "../lib/seed-data";

async function main() {
    // Idempotent: bersihkan lalu isi ulang data contoh.
    await prisma.cameraEvent.deleteMany();
    await prisma.camera.deleteMany();
    await prisma.store.deleteMany();
    await prisma.contractor.deleteMany();

    const now = Date.now();
    const contractors = await Promise.all(
        seedContractors.map((c) =>
            prisma.contractor.create({
                data: { name: c.name, phone: c.phone, picName: c.pic },
            }),
        ),
    );

    for (const [si, store] of seedStores.entries()) {
        await prisma.store.create({
            data: {
                code: store.code,
                name: store.name,
                address: store.address,
                progress: store.progress,
                targetDate: new Date(store.targetDate),
                contractorId: contractors[store.contractor].id,
                cameras: {
                    create: store.cameras.map((cam, ci) => ({
                        label: cam.label,
                        deviceSerial: mockSerial(si, ci),
                        deviceModel: "EZVIZ H8c 4G",
                        area: cam.area,
                        status: cam.status ?? "ONLINE",
                        statusSince: cam.sinceMinutes
                            ? new Date(now - cam.sinceMinutes * 60_000)
                            : null,
                        disconnectsToday: cam.disconnectsToday ?? 0,
                        sdStatus: cam.sdStatus ?? "OK",
                        sdCapacityGb: 128,
                        sdUsedPercent: 40,
                        uptime7d: cam.uptime7d ?? 99.5,
                        lastCheckedAt: new Date(now),
                    })),
                },
            },
        });
    }

    const [stores, cameras] = await Promise.all([
        prisma.store.count(),
        prisma.camera.count(),
    ]);
    console.log(
        `Seed selesai: ${contractors.length} kontraktor, ${stores} toko, ${cameras} kamera`,
    );
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
