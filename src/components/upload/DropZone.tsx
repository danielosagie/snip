"use client";

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { Upload } from "lucide-react";

interface DropZoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
}

export function DropZone({ onFilesSelected, disabled, className }: DropZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);

      if (disabled) return;

      // No video-only filter on drop — the dashboard accepts any
      // file the user can drag in (videos, source files, contracts,
      // images, archives). Filtering here would silently swallow
      // perfectly-valid docs.
      const files = Array.from(e.dataTransfer.files);

      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [disabled, onFilesSelected]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return;

      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [disabled, onFilesSelected]
  );

  return (
    <div
      className={cn(
        "relative rounded-[14px] border border-dashed p-12 text-center transition-colors",
        isDragActive
          ? "border-[#FF6600] bg-[#FFF0E6]"
          : "border-[#D8D8DE] bg-white hover:border-[#A0A0A5]",
        disabled && "opacity-40 cursor-not-allowed",
        className
      )}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        type="file"
        multiple
        onChange={handleChange}
        disabled={disabled}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
      />
      <div className="flex flex-col items-center gap-4">
        <div
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-[12px] border transition-colors",
            isDragActive
              ? "border-[#FF6600] bg-[#FF6600] text-white"
              : "border-[#E8E8EC] bg-[#FAFAFA] text-[#6E6E73]"
          )}
        >
          <Upload className="h-6 w-6" />
        </div>
        <div>
          <p className="text-[15px] font-semibold text-[#131315]">
            {isDragActive ? "Drop to add" : "Drop files here or click to add"}
          </p>
          <p className="mt-1 text-[13px] leading-[18px] text-[#6E6E73]">
            Video, docs, images, audio, project files. Video gets transcoded,
            everything else is stored as is.
          </p>
        </div>
      </div>
    </div>
  );
}
