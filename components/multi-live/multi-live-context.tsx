"use client";

import { createContext, useContext } from "react";

export type MultiLiveContextValue = {
    /** daftarkan heartbeat tile; kembalian = fungsi pelepas (untuk cleanup useEffect) */
    registerBeat(beat: () => void): () => void;
    /** kamera yang suaranya menyala (paling banyak satu) */
    soundCameraId: string | null;
    setSoundCameraId(id: string | null): void;
};

export const MultiLiveContext = createContext<MultiLiveContextValue | null>(null);

export function useMultiLive(): MultiLiveContextValue {
    const value = useContext(MultiLiveContext);
    if (!value) throw new Error("useMultiLive harus dipakai di dalam MultiLiveGrid");
    return value;
}
