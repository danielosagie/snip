import { useEffect, useRef } from "react";

import {
  createPlaybackController,
  type PlaybackController,
  type PlaybackSource,
} from "@/lib/playback";
import { cn } from "@/lib/utils";

type PlaybackSurfaceProps = {
  source: PlaybackSource | null;
  className?: string;
  onControllerChange?: (controller: PlaybackController | null) => void;
  onLoadError?: (error: Error) => void;
};

/** Canvas/video output only. Wave 2 can mount its own transport around it. */
export function PlaybackSurface({
  source,
  className,
  onControllerChange,
  onLoadError,
}: PlaybackSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const sourceRef = useRef(source);
  const loadedSourceKeyRef = useRef<string | null>(null);
  const onControllerChangeRef = useRef(onControllerChange);
  const onLoadErrorRef = useRef(onLoadError);
  sourceRef.current = source;
  onControllerChangeRef.current = onControllerChange;
  onLoadErrorRef.current = onLoadError;

  useEffect(() => {
    const canvas = canvasRef.current;
    const fallbackVideo = videoRef.current;
    if (!canvas || !fallbackVideo) return;

    const controller = createPlaybackController({ canvas, fallbackVideo });
    controllerRef.current = controller;
    onControllerChangeRef.current?.(controller);
    const initialSource = sourceRef.current;
    if (initialSource) {
      loadedSourceKeyRef.current = `${initialSource.contentHash}\n${initialSource.url}`;
      void controller.load(initialSource).catch((error: unknown) =>
        onLoadErrorRef.current?.(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
    }

    return () => {
      onControllerChangeRef.current?.(null);
      controllerRef.current = null;
      controller.destroy();
    };
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!source) {
      loadedSourceKeyRef.current = null;
      return;
    }
    if (!controller) return;
    const sourceKey = `${source.contentHash}\n${source.url}`;
    if (loadedSourceKeyRef.current === sourceKey) return;
    loadedSourceKeyRef.current = sourceKey;
    void controller.load(source).catch((error: unknown) =>
      onLoadErrorRef.current?.(
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
  }, [source?.contentHash, source?.url]);

  return (
    <div
      className={cn(
        "relative grid aspect-video w-full place-items-center overflow-hidden bg-[#11110f]",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full object-contain"
        aria-label="WebCodecs proxy playback"
      />
      <video
        ref={videoRef}
        className="block h-full w-full object-contain"
        aria-label="Proxy playback fallback"
      />
      {source ? null : (
        <p className="max-w-sm px-6 text-center font-mono text-xs uppercase tracking-[0.18em] text-[#aaa99f]">
          Select an R2-mirrored proxy
        </p>
      )}
    </div>
  );
}
