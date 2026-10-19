"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Penghubung kartu "Rekaman MicroSD" dengan panel video: memilih rentang di kartu
// memindahkan panel ke tab Playback dan memutar rentang itu.

export type PlaybackRange = { start: Date; end: Date };
export type MediaTab = "live" | "playback";

type PlaybackState = {
    tab: MediaTab;
    setTab: (tab: MediaTab) => void;
    /** rentang yang sedang/terakhir diputar; null = belum memilih */
    range: PlaybackRange | null;
    play: (range: PlaybackRange) => void;
};

const PlaybackContext = createContext<PlaybackState | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
    const [tab, setTab] = useState<MediaTab>("live");
    const [range, setRange] = useState<PlaybackRange | null>(null);
    const play = (next: PlaybackRange) => {
        setRange(next);
        setTab("playback");
    };
    return <PlaybackContext.Provider value={{ tab, setTab, range, play }}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackState {
    const value = useContext(PlaybackContext);
    if (!value) throw new Error("usePlayback harus dipakai di dalam PlaybackProvider");
    return value;
}
