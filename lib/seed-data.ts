// Data contoh (fiktif) untuk seed database dan mode CAMERA_DATA_SOURCE=mock.
// Bentuknya mengikuti desain Figma: 8 kontraktor, 19 toko, 46 kamera.

export type SeedCamera = {
    label: string;
    area: string;
    status?: "ONLINE" | "OFFLINE" | "UNSTABLE" | "UNKNOWN";
    sdStatus?: "OK" | "NOT_FORMATTED" | "UNREADABLE" | "NONE";
    uptime7d?: number;
    disconnectsToday?: number;
    /** menit yang lalu status saat ini dimulai (untuk OFFLINE/UNSTABLE) */
    sinceMinutes?: number;
};

export type SeedStore = {
    code: string;
    name: string;
    address: string;
    contractor: number; // indeks pada seedContractors
    progress: number;
    targetDate: string; // ISO
    cameras: SeedCamera[];
};

export const seedContractors = [
    { name: "PT Bangun Jaya Konstruksi", phone: "0812-0000-0001", pic: "Budi Santoso" },
    { name: "CV Karya Mandiri Utama", phone: "0812-0000-0002", pic: "Rahmat Hidayat" },
    { name: "PT Cipta Graha Persada", phone: "0812-0000-0003", pic: "Agus Prasetyo" },
    { name: "CV Sinar Baru Teknik", phone: "0812-0000-0004", pic: "Dewi Lestari" },
    { name: "PT Mitra Bangun Persada", phone: "0812-0000-0005", pic: "Yoga Pratama" },
    { name: "CV Tiga Saudara Konstruksi", phone: "0812-0000-0006", pic: "Hendra Wijaya" },
    { name: "PT Wahana Cipta Mandiri", phone: "0812-0000-0007", pic: "Siti Nurhaliza" },
    { name: "CV Dharma Sentosa Abadi", phone: "0812-0000-0008", pic: "Fajar Nugroho" },
];

const AREAS = ["Area depan", "Area belakang", "Area gudang", "Interior"];

function cams(
    count: number,
    overrides: Record<string, Partial<SeedCamera>> = {},
): SeedCamera[] {
    return Array.from({ length: count }, (_, i) => {
        const label = `CAM-0${i + 1}`;
        return {
            label,
            area: AREAS[i] ?? `Area ${i + 1}`,
            ...overrides[label],
        };
    });
}

// 8 toko berkamera 3 + 11 toko berkamera 2 = 46 kamera.
// Kondisi bermasalah: 2 offline, 1 tidak stabil, 2 MicroSD bermasalah (di kamera online).
export const seedStores: SeedStore[] = [
    {
        code: "ALF-BKS-0421",
        name: "Alfamart Cibubur Raya 2",
        address: "Jl. Alternatif Cibubur KM 4, Bekasi",
        contractor: 0,
        progress: 68,
        targetDate: "2026-11-28",
        cameras: cams(2, {
            "CAM-01": { uptime7d: 99.2 },
            "CAM-02": {
                status: "UNSTABLE",
                uptime7d: 93.4,
                disconnectsToday: 6,
                sinceMinutes: 190,
            },
        }),
    },
    {
        code: "ALF-BGR-0388",
        name: "Alfamart Cileungsi Jonggol",
        address: "Jl. Raya Cileungsi–Jonggol KM 3, Bogor",
        contractor: 0,
        progress: 32,
        targetDate: "2026-12-19",
        cameras: [
            { label: "CAM-01", area: "Fasad", sdStatus: "NOT_FORMATTED", uptime7d: 98.7 },
            {
                label: "CAM-02",
                area: "Area gudang",
                status: "OFFLINE",
                sdStatus: "UNREADABLE",
                uptime7d: 90.1,
                sinceMinutes: 87,
            },
        ],
    },
    {
        code: "ALF-BKS-0455",
        name: "Alfamart Tambun Selatan",
        address: "Jl. Raya Tambun Selatan No. 12, Bekasi",
        contractor: 1,
        progress: 54,
        targetDate: "2026-12-05",
        cameras: [
            { label: "CAM-01", area: "Area depan" },
            { label: "CAM-02", area: "Area belakang" },
            { label: "CAM-03", area: "Interior", status: "OFFLINE", sinceMinutes: 170, uptime7d: 88.3 },
        ],
    },
    {
        code: "ALF-BKS-0462",
        name: "Alfamart Setu Raya",
        address: "Jl. Raya Setu No. 21, Bekasi",
        contractor: 2,
        progress: 41,
        targetDate: "2026-12-12",
        cameras: [
            { label: "CAM-01", area: "Area parkir", sdStatus: "UNREADABLE" },
            { label: "CAM-02", area: "Area belakang" },
        ],
    },
    { code: "ALF-DPK-0210", name: "Alfamart Sawangan Permai", address: "Jl. Raya Sawangan KM 2, Depok", contractor: 3, progress: 77, targetDate: "2026-11-14", cameras: cams(3) },
    { code: "ALF-DPK-0218", name: "Alfamart Cinere Mas", address: "Jl. Cinere Raya No. 8, Depok", contractor: 4, progress: 23, targetDate: "2027-01-09", cameras: cams(2) },
    { code: "ALF-BGR-0391", name: "Alfamart Citeureup Indah", address: "Jl. Mayor Oking No. 5, Bogor", contractor: 5, progress: 60, targetDate: "2026-12-01", cameras: cams(3) },
    { code: "ALF-BGR-0397", name: "Alfamart Cibinong Kota", address: "Jl. Tegar Beriman No. 17, Bogor", contractor: 6, progress: 88, targetDate: "2026-11-03", cameras: cams(2) },
    { code: "ALF-BKS-0470", name: "Alfamart Cikarang Baru", address: "Jl. Cikarang Baru Raya, Bekasi", contractor: 7, progress: 15, targetDate: "2027-01-23", cameras: cams(3) },
    { code: "ALF-BKS-0474", name: "Alfamart Babelan Utara", address: "Jl. Raya Babelan No. 44, Bekasi", contractor: 1, progress: 47, targetDate: "2026-12-10", cameras: cams(2) },
    { code: "ALF-TGR-0302", name: "Alfamart Pamulang Barat", address: "Jl. Siliwangi No. 30, Tangerang Selatan", contractor: 2, progress: 71, targetDate: "2026-11-20", cameras: cams(3) },
    { code: "ALF-TGR-0307", name: "Alfamart Ciputat Timur", address: "Jl. Ir. H. Juanda No. 9, Tangerang Selatan", contractor: 3, progress: 36, targetDate: "2026-12-22", cameras: cams(2) },
    { code: "ALF-TGR-0311", name: "Alfamart Serpong Utara", address: "Jl. Raya Serpong No. 15, Tangerang Selatan", contractor: 4, progress: 52, targetDate: "2026-12-08", cameras: cams(3) },
    { code: "ALF-JKT-0150", name: "Alfamart Cipayung Jaya", address: "Jl. Bambu Apus Raya, Jakarta Timur", contractor: 5, progress: 65, targetDate: "2026-11-25", cameras: cams(2) },
    { code: "ALF-JKT-0158", name: "Alfamart Ciracas Selatan", address: "Jl. Raya Bogor KM 25, Jakarta Timur", contractor: 6, progress: 29, targetDate: "2027-01-05", cameras: cams(3) },
    { code: "ALF-BDG-0090", name: "Alfamart Cimahi Tengah", address: "Jl. Jenderal Amir Machmud, Cimahi", contractor: 7, progress: 83, targetDate: "2026-11-08", cameras: cams(2) },
    { code: "ALF-KRW-0075", name: "Alfamart Karawang Barat", address: "Jl. Tuparev No. 60, Karawang", contractor: 0, progress: 44, targetDate: "2026-12-15", cameras: cams(3) },
    { code: "ALF-KRW-0081", name: "Alfamart Telukjambe", address: "Jl. Telukjambe Raya, Karawang", contractor: 1, progress: 58, targetDate: "2026-12-02", cameras: cams(2) },
    { code: "ALF-PWK-0033", name: "Alfamart Purwakarta Kota", address: "Jl. Veteran No. 3, Purwakarta", contractor: 2, progress: 19, targetDate: "2027-01-16", cameras: cams(2) },
];

/** Serial perangkat contoh yang konsisten antara mock data dan MockGateway. */
export function mockSerial(storeIndex: number, cameraIndex: number) {
    return `BD77${String(12045 + storeIndex * 10 + cameraIndex).padStart(5, "0")}`;
}

/** ID akun EZVIZ contoh: satu per kontraktor. */
export function mockAccountId(contractorIndex: number) {
    return `mock-${contractorIndex}`;
}
