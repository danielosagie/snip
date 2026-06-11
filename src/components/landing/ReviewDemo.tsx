import { Player } from "@remotion/player";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";

/**
 * Hero demo for the landing page: a Remotion composition of a review
 * session — playhead sweeps the timeline, comments pop in on their
 * frames, the approval lands at the end. Rendered with @remotion/player
 * (muted, looped, no controls), so it reads as a living screenshot.
 *
 * Visually matches the static MockReview fallback in -home.tsx — same
 * dark window (#161618), orange timeline, comment rail — so the swap
 * from fallback to player is seamless.
 */

const FPS = 30;
const DURATION = 260; // ~8.7s loop

const ORANGE = "#FF6600";

function Marker({ at, left }: { at: number; left: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - at, fps, config: { damping: 12, mass: 0.6 } });
  return (
    <div
      style={{
        position: "absolute",
        top: -4,
        left,
        width: 11,
        height: 11,
        borderRadius: "50%",
        background: "#fff",
        border: `2px solid ${ORANGE}`,
        transform: `scale(${frame < at ? 0 : pop})`,
      }}
    />
  );
}

function CommentCard({
  at,
  name,
  time,
  text,
  accent,
}: {
  at: number;
  name: string;
  time: string;
  text: string;
  accent: boolean;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - at, fps, config: { damping: 14, mass: 0.7 } });
  const shown = frame >= at;
  return (
    <div
      style={{
        borderRadius: 10,
        padding: 12,
        backgroundColor: "rgba(255,255,255,0.05)",
        opacity: shown ? enter : 0,
        transform: `translateY(${shown ? (1 - enter) * 18 : 18}px)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            fontWeight: 600,
            color: "#fff",
            backgroundColor: accent ? ORANGE : "#4a4a52",
          }}
        >
          {name[0]}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: "#fff" }}>{name}</span>
        <span
          style={{
            fontSize: 10,
            marginLeft: "auto",
            color: ORANGE,
            fontFamily: "'Geist Mono', ui-monospace, monospace",
          }}
        >
          {time}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.4, color: "rgba(255,255,255,0.75)" }}>
        {text}
      </p>
    </div>
  );
}

function ReviewDemoComposition() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Playhead sweeps 4% -> 88% over the loop, easing out near the end.
  const progress = interpolate(frame, [0, durationInFrames - 30], [4, 88], {
    extrapolateRight: "clamp",
  });

  // Play overlay fades as "playback" starts.
  const playFade = interpolate(frame, [8, 26], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Running timecode under the playhead.
  const totalSeconds = 42 * 60 + 17 + Math.floor(frame / fps) * 3;
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const ff = String(frame % fps).padStart(2, "0");

  const APPROVE_AT = 190;
  const approve = spring({ frame: frame - APPROVE_AT, fps, config: { damping: 11, mass: 0.8 } });

  // Everything fades briefly at the very end so the loop restart reads
  // as a cut, not a glitch.
  const loopFade = interpolate(frame, [durationInFrames - 12, durationInFrames - 1], [1, 0], {
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#161618",
        fontFamily: "'Inter Tight', 'Geist', system-ui, sans-serif",
        flexDirection: "row",
        opacity: loopFade,
      }}
    >
      {/* Video pane */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16, gap: 12, minWidth: 0 }}>
        <div
          style={{
            position: "relative",
            flex: 1,
            borderRadius: 8,
            background: "linear-gradient(135deg, #1d1d22 0%, #131316 60%, #1a1208 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* play overlay, fading out as playback begins */}
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              backgroundColor: "rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: playFade,
              transform: `scale(${1 + (1 - playFade) * 0.3})`,
            }}
          >
            <div
              style={{
                width: 0,
                height: 0,
                borderTop: "9px solid transparent",
                borderBottom: "9px solid transparent",
                borderLeft: "15px solid #fff",
                marginLeft: 4,
              }}
            />
          </div>
          <span
            style={{
              position: "absolute",
              left: 12,
              bottom: 12,
              fontSize: 11,
              padding: "2px 6px",
              borderRadius: 4,
              backgroundColor: "rgba(0,0,0,0.55)",
              color: "#fff",
              fontFamily: "'Geist Mono', ui-monospace, monospace",
            }}
          >
            00:{mm.slice(-2)}:{ss}:{ff}
          </span>
          <span
            style={{
              position: "absolute",
              right: 12,
              top: 12,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              padding: "4px 8px",
              borderRadius: 999,
              backgroundColor: "rgba(255,102,0,0.18)",
              color: "#ffb380",
              fontFamily: "'Geist Mono', ui-monospace, monospace",
            }}
          >
            v3 · ProRes
          </span>
        </div>

        {/* timeline */}
        <div style={{ position: "relative", height: 6, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.1)" }}>
          <div
            style={{
              position: "absolute",
              insetBlock: 0,
              left: 0,
              width: `${progress}%`,
              borderRadius: 999,
              backgroundColor: ORANGE,
            }}
          />
          <Marker at={55} left="22%" />
          <Marker at={120} left="46%" />
          <Marker at={APPROVE_AT} left="84%" />
        </div>
      </div>

      {/* Comment rail */}
      <div
        style={{
          width: "37%",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <CommentCard at={55} name="Matt" time="00:42" text="That's great!" accent />
        <CommentCard at={120} name="Ana" time="01:18" text="Trim two frames here" accent={false} />
        <div
          style={{
            marginTop: "auto",
            alignSelf: "flex-start",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 500,
            padding: "6px 12px",
            borderRadius: 999,
            backgroundColor: "rgba(41,199,64,0.15)",
            color: "#6fdd8b",
            opacity: frame >= APPROVE_AT ? 1 : 0,
            transform: `scale(${frame < APPROVE_AT ? 0.4 : 1.5 - approve * 0.5}) rotate(${(1 - approve) * -6}deg)`,
          }}
        >
          ✓ Approved
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** Auto-playing, looped, muted player — a living screenshot. */
export default function ReviewDemoPlayer() {
  return (
    <Player
      component={ReviewDemoComposition}
      durationInFrames={DURATION}
      fps={FPS}
      compositionWidth={1024}
      compositionHeight={420}
      autoPlay
      loop
      controls={false}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
