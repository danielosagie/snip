"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";
import {
  getFollowSyncChase,
  selectWatchHost,
  WATCH_PRESENCE_STALE_MS,
  type WatchPresenceParticipant,
} from "./model";

const STORAGE_KEY = "snip.watch-presence.client-id";
const HEARTBEAT_INTERVAL_MS = 4_000;
const UPDATE_INTERVAL_MS = 750;
const PAUSE_DETECTION_MS = 1_200;
const DISCONNECT_PATH = "videoPresence:disconnect";

function getOrCreateClientId() {
  const existing = window.sessionStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const clientId = crypto.randomUUID().replace(/-/g, "");
  window.sessionStorage.setItem(STORAGE_KEY, clientId);
  return clientId;
}

function useInferredPlaying(currentTime: number) {
  const previousTimeRef = useRef(currentTime);
  const pauseTimerRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const delta = Math.abs(currentTime - previousTimeRef.current);
    previousTimeRef.current = currentTime;
    if (delta < 0.02) return;

    setPlaying(true);
    if (pauseTimerRef.current !== null) {
      window.clearTimeout(pauseTimerRef.current);
    }
    pauseTimerRef.current = window.setTimeout(() => {
      setPlaying(false);
      pauseTimerRef.current = null;
    }, PAUSE_DETECTION_MS);
  }, [currentTime]);

  useEffect(
    () => () => {
      if (pauseTimerRef.current !== null) {
        window.clearTimeout(pauseTimerRef.current);
      }
    },
    [],
  );

  return playing;
}

export function useWatchTogether(input: {
  videoId?: Id<"videos">;
  shareToken?: string;
  currentTime: number;
  enabled: boolean;
  onChase: (playheadSeconds: number, options: { playing: boolean }) => void;
}) {
  const { videoId, shareToken, enabled } = input;
  const convex = useConvex();
  const heartbeat = useMutation(api.videoPresence.watchHeartbeat);
  const updatePlayback = useMutation(api.videoPresence.updateWatchPlayback);
  const disconnect = useMutation(api.videoPresence.disconnect);
  const playing = useInferredPlaying(input.currentTime);
  const playbackRef = useRef({
    playheadSeconds: input.currentTime,
    playing,
  });
  playbackRef.current = { playheadSeconds: input.currentTime, playing };

  const [clientId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getOrCreateClientId(),
  );
  const joinedAt = useMemo(() => Date.now(), [videoId]);
  const [roomToken, setRoomToken] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const sessionTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !videoId || !clientId) {
      setRoomToken(null);
      setCurrentUserId(null);
      return;
    }

    let active = true;
    const sessionId = crypto.randomUUID();
    const runHeartbeat = async () => {
      try {
        const result = await heartbeat({
          videoId,
          sessionId,
          clientId,
          interval: HEARTBEAT_INTERVAL_MS,
          shareToken,
          joinedAt,
          ...playbackRef.current,
        });
        if (!active) return;
        sessionTokenRef.current = result.sessionToken;
        setRoomToken(result.roomToken);
        setCurrentUserId(result.userId);
      } catch {
        if (active) {
          setRoomToken(null);
          setCurrentUserId(null);
        }
      }
    };

    const handleBeforeUnload = () => {
      const sessionToken = sessionTokenRef.current;
      if (!sessionToken) return;
      const blob = new Blob(
        [JSON.stringify({ path: DISCONNECT_PATH, args: { sessionToken } })],
        { type: "application/json" },
      );
      navigator.sendBeacon(`${convex.url}/api/mutation`, blob);
    };

    void runHeartbeat();
    const intervalId = window.setInterval(() => {
      void runHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      const sessionToken = sessionTokenRef.current;
      sessionTokenRef.current = null;
      setRoomToken(null);
      if (sessionToken) {
        void disconnect({ sessionToken }).catch(() => undefined);
      }
    };
  }, [clientId, convex.url, disconnect, enabled, heartbeat, joinedAt, shareToken, videoId]);

  useEffect(() => {
    if (!enabled || !videoId || !clientId || !roomToken) return;
    const pushPlayback = () => {
      void updatePlayback({
        videoId,
        clientId,
        shareToken,
        joinedAt,
        ...playbackRef.current,
      }).catch(() => undefined);
    };
    pushPlayback();
    const intervalId = window.setInterval(pushPlayback, UPDATE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [clientId, enabled, joinedAt, roomToken, shareToken, updatePlayback, videoId]);

  const state = useQuery(
    api.videoPresence.listWatch,
    roomToken ? { roomToken } : "skip",
  );
  const participants = useMemo(() => {
    const now = Date.now();
    return (state ?? [])
      .filter(
        (entry) =>
          entry.online && now - entry.data.updatedAt <= WATCH_PRESENCE_STALE_MS,
      )
      .map((entry) => ({
        userId: entry.userId,
        online: entry.online,
        lastDisconnected: entry.lastDisconnected,
        displayName: entry.data.displayName,
        avatarUrl: entry.data.avatarUrl,
        joinedAt: entry.data.joinedAt,
        updatedAt: entry.data.updatedAt,
        playheadSeconds: entry.data.playheadSeconds,
        playing: entry.data.playing,
      })) satisfies WatchPresenceParticipant[];
  }, [state]);
  const host = useMemo(
    () => selectWatchHost(participants, Date.now()),
    [participants],
  );
  const isHost = host?.userId === currentUserId;

  useEffect(() => {
    if (isHost) return;
    const chase = getFollowSyncChase({
      following,
      localPlayheadSeconds: input.currentTime,
      localPlaying: playing,
      host,
      now: Date.now(),
    });
    if (chase) input.onChase(chase.playheadSeconds, { playing: chase.playing });
  }, [following, host, input.currentTime, input.onChase, isHost, playing]);

  return {
    participants,
    host,
    isHost,
    following,
    setFollowing,
  };
}

export function WatchTogetherControl({
  videoId,
  shareToken,
  currentTime,
  onChase,
  className,
}: {
  videoId?: Id<"videos">;
  shareToken?: string;
  currentTime: number;
  onChase: (playheadSeconds: number, options: { playing: boolean }) => void;
  className?: string;
}) {
  const featureStatus = useQuery(api.featureFlags.getFeatureStatus, {});
  const enabled = featureStatus?.watchTogether === true && Boolean(videoId);
  const state = useWatchTogether({
    videoId,
    shareToken,
    currentTime,
    enabled,
    onChase,
  });

  if (!enabled || !state.host) return null;

  if (state.isHost) {
    return (
      <span
        className={cn(
          "inline-flex h-7 items-center border-2 border-[#1a1a1a] bg-[#1a1a1a] px-2 font-mono text-[10px] font-bold uppercase tracking-wider text-[#f0f0e8]",
          className,
        )}
      >
        Hosting
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={state.following}
      onClick={() => state.setFollowing((current) => !current)}
      className={cn(
        "inline-flex h-7 items-center border-2 border-[#1a1a1a] px-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-transform focus-visible:outline-2 focus-visible:outline-offset-2",
        state.following
          ? "bg-[#FDBA74] text-[#1a1a1a]"
          : "bg-[#f0f0e8] text-[#1a1a1a] hover:translate-x-px hover:translate-y-px",
        className,
      )}
      title={`${state.host.displayName} hosts`}
    >
      {state.following ? "Following" : "Follow host"}
    </button>
  );
}
