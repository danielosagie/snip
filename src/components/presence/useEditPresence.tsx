"use client";

import type { Id } from "@convex/_generated/dataModel";
import { useConvex, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  TimelineClipId,
  TimelinePresencePayload,
  TimelineRange,
  TimelineSequenceId,
  TimelineSoftLockClaim,
  TimelineTime,
} from "@/lib/timeline/types";
import {
  isEditPresenceActive,
  type TimelinePresenceParticipant,
} from "./model";

const STORAGE_KEY = "snip.edit-presence.client-id";
const HEARTBEAT_INTERVAL_MS = 12_000;
const UPDATE_DELAY_MS = 120;
const DISCONNECT_PATH = "editPresence:disconnect";

// This new Convex module is referenced explicitly so the branch typechecks
// before deployment-owned `convex codegen` refreshes `_generated/api.d.ts`.
const editPresenceApi = {
  heartbeat: makeFunctionReference<
    "mutation",
    {
      timelineDocId: Id<"timelineDocs">;
      sessionId: string;
      clientId: string;
      interval?: number;
      payload: TimelinePresencePayload;
    },
    { roomToken: string; sessionToken: string; actorId: string; userId: string }
  >("editPresence:heartbeat"),
  update: makeFunctionReference<
    "mutation",
    {
      timelineDocId: Id<"timelineDocs">;
      clientId: string;
      payload: TimelinePresencePayload;
    },
    null
  >("editPresence:update"),
  list: makeFunctionReference<
    "query",
    { roomToken: string },
    TimelinePresenceParticipant[]
  >("editPresence:list"),
  disconnect: makeFunctionReference<
    "mutation",
    { sessionToken: string },
    null
  >("editPresence:disconnect"),
} as const;

function createClientId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function getOrCreateClientId() {
  const existing = window.sessionStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const clientId = createClientId();
  window.sessionStorage.setItem(STORAGE_KEY, clientId);
  return clientId;
}

export function useEditPresence(input: {
  timelineDocId?: Id<"timelineDocs">;
  payload: TimelinePresencePayload;
  enabled?: boolean;
  intervalMs?: number;
}) {
  const convex = useConvex();
  const heartbeat = useMutation(editPresenceApi.heartbeat);
  const update = useMutation(editPresenceApi.update);
  const disconnect = useMutation(editPresenceApi.disconnect);
  const payloadRef = useRef(input.payload);
  payloadRef.current = input.payload;

  const [clientId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getOrCreateClientId(),
  );
  const [roomToken, setRoomToken] = useState<string | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  const {
    timelineDocId,
    enabled = true,
    intervalMs = HEARTBEAT_INTERVAL_MS,
  } = input;

  useEffect(() => {
    if (!enabled || !timelineDocId || !clientId) {
      setRoomToken(null);
      setActorId(null);
      setCurrentUserId(null);
      return;
    }

    let active = true;
    const sessionId = crypto.randomUUID();

    const runHeartbeat = async () => {
      try {
        const result = await heartbeat({
          timelineDocId,
          sessionId,
          clientId,
          interval: intervalMs,
          payload: payloadRef.current,
        });
        if (!active) return;
        sessionTokenRef.current = result.sessionToken;
        setRoomToken(result.roomToken);
        setActorId(result.actorId);
        setCurrentUserId(result.userId);
        setError(null);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause
              : new Error("Presence unavailable."),
          );
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
    }, intervalMs);
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
  }, [clientId, convex.url, disconnect, enabled, heartbeat, intervalMs, timelineDocId]);

  useEffect(() => {
    if (!enabled || !timelineDocId || !clientId || !roomToken) return;
    const timeoutId = window.setTimeout(() => {
      void update({
        timelineDocId,
        clientId,
        payload: payloadRef.current,
      }).catch((cause) => {
        setError(
          cause instanceof Error ? cause : new Error("Presence unavailable."),
        );
      });
    }, UPDATE_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [clientId, enabled, input.payload, roomToken, timelineDocId, update]);

  const state = useQuery(
    editPresenceApi.list,
    roomToken ? { roomToken } : "skip",
  );

  const participants = useMemo(() => {
    const now = Date.now();
    return (state ?? []).filter((participant) =>
      isEditPresenceActive(participant, now),
    ) satisfies TimelinePresenceParticipant[];
  }, [state]);

  const peers = useMemo(
    () => participants.filter((participant) => participant.userId !== currentUserId),
    [currentUserId, participants],
  );

  return {
    actorId,
    currentUserId,
    participants,
    peers,
    error,
    isConnecting: enabled && Boolean(timelineDocId) && roomToken === null && !error,
  };
}

interface EditPresenceContextValue {
  actorId: string | null;
  participants: TimelinePresenceParticipant[];
  peers: TimelinePresenceParticipant[];
  error: Error | null;
  isConnecting: boolean;
}

const EditPresenceContext = createContext<EditPresenceContextValue | null>(null);

export function TimelinePresenceProvider({
  timelineDocId,
  playheadPosition,
  selectedClipIds,
  viewportRange,
  sequenceId,
  filePath,
  enabled = true,
  children,
}: {
  timelineDocId?: Id<"timelineDocs">;
  playheadPosition: TimelineTime;
  selectedClipIds: TimelineClipId[];
  viewportRange: TimelineRange;
  sequenceId?: TimelineSequenceId;
  filePath?: string;
  enabled?: boolean;
  children: ReactNode;
}) {
  const claimedAtByTargetRef = useRef(new Map<string, number>());
  const softLocks = useMemo(() => {
    const targets: TimelineSoftLockClaim["target"][] = [];
    if (sequenceId) targets.push({ kind: "sequence", sequenceId });
    if (filePath?.trim()) targets.push({ kind: "file", path: filePath.trim() });

    return targets.map((target) => {
      const key = target.kind === "sequence" ? `sequence:${target.sequenceId}` : `file:${target.path}`;
      let claimedAt = claimedAtByTargetRef.current.get(key);
      if (!claimedAt) {
        claimedAt = Date.now();
        claimedAtByTargetRef.current.set(key, claimedAt);
      }
      return { target, holder: "pending", claimedAt };
    });
  }, [filePath, sequenceId]);

  const payload = useMemo(
    () => ({
      playheadPosition,
      selectedClipIds,
      viewportRange,
      softLocks,
    }),
    [playheadPosition, selectedClipIds, softLocks, viewportRange],
  );
  const presenceState = useEditPresence({ timelineDocId, payload, enabled });

  const value = useMemo<EditPresenceContextValue>(
    () => ({
      actorId: presenceState.actorId,
      participants: presenceState.participants,
      peers: presenceState.peers,
      error: presenceState.error,
      isConnecting: presenceState.isConnecting,
    }),
    [
      presenceState.actorId,
      presenceState.error,
      presenceState.isConnecting,
      presenceState.participants,
      presenceState.peers,
    ],
  );

  return (
    <EditPresenceContext.Provider value={value}>
      {children}
    </EditPresenceContext.Provider>
  );
}

export function useTimelinePresence() {
  const value = useContext(EditPresenceContext);
  if (!value) {
    throw new Error(
      "useTimelinePresence must be used inside TimelinePresenceProvider.",
    );
  }
  return value;
}
