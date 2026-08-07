"use client";

import * as React from "react";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Chip-style multi-select with a free-form add field.
 *
 * Why this and not a plain `<select multiple>`:
 *   - Lets the user pick from a quick-options list (deliverable
 *     formats, color spaces, anything finite we can pre-enumerate)
 *     AND add custom values not in the list (typing in their own
 *     terms with Enter or the inline add button).
 *   - Values are stored as a single semicolon-separated string so
 *     the existing wizard answers blob doesn't need a schema change.
 *
 * Output shape: a `;`-joined string. Empty string when nothing
 * selected. Mirrors the `WizardAnswers[string]` contract.
 */

const SEPARATOR = "; ";

interface Option {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  options: Option[];
  placeholder?: string;
  /** Help copy for the custom-add field. */
  customHint?: string;
  disabled?: boolean;
}

export function MultiCombobox({
  value,
  onChange,
  options,
  placeholder = "Add custom…",
  customHint = "Type your own and press Enter",
  disabled,
}: Props) {
  const selected = parseValue(value);
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const setSelected = (next: string[]) => {
    onChange(serializeValue(next));
  };

  const toggleOption = (val: string) => {
    if (selectedSet.has(val)) {
      setSelected(selected.filter((s) => s !== val));
    } else {
      setSelected([...selected, val]);
    }
  };

  const addCustom = () => {
    const next = draft.trim();
    if (!next) return;
    if (!selectedSet.has(next)) {
      setSelected([...selected, next]);
    }
    setDraft("");
    inputRef.current?.focus();
  };

  const removeChip = (val: string) => {
    setSelected(selected.filter((s) => s !== val));
  };

  return (
    <div className="space-y-3">
      {/* Quick options grid — click to toggle. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map((opt) => {
          const isOn = selectedSet.has(opt.value);
          return (
            <button
              type="button"
              key={opt.value}
              onClick={() => toggleOption(opt.value)}
              disabled={disabled}
              className={cn(
                "flex items-center gap-2 rounded-[10px] border px-3 py-2 text-left text-sm transition-[border-color,box-shadow,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#131315] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-40",
                isOn
                  ? "border-[#FF6600] bg-[#FFF0E6] font-medium text-[#D14E00]"
                  : "border-[#E8E8EC] bg-white text-[#131315] hover:bg-[#F7F7F8]",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] border",
                  isOn
                    ? "border-[#FF6600] bg-[#FF6600] text-white"
                    : "border-[#D8D8DE] bg-white",
                )}
              >
                {isOn ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
              </span>
              <span className="flex-1">{opt.label}</span>
            </button>
          );
        })}
      </div>

      {/* Custom add row. */}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-[10px] border border-[#E8E8EC] bg-white px-3 py-2 text-sm text-[#131315] outline-none transition-[border-color,box-shadow] placeholder:text-[#A0A0A5] focus:!border-[#FF6600] focus:!ring-[3px] focus:!ring-[rgba(255,102,0,0.12)] disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={disabled || !draft.trim()}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-transparent bg-[#131315] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#131315] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#131315] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
      <p className="text-xs text-[#A0A0A5]">{customHint}</p>

      {/* Chips of currently-selected values — both quick + custom. */}
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((v) => {
            const label = options.find((o) => o.value === v)?.label ?? v;
            return (
              <span
                key={v}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#F1F1F3] px-2.5 py-1 text-xs font-medium text-[#6E6E73]"
              >
                {label}
                <button
                  type="button"
                  onClick={() => removeChip(v)}
                  className="rounded-full p-0.5 text-[#A0A0A5] transition-colors hover:bg-[#FFF5F5] hover:text-[#D8434F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#131315]"
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function parseValue(value: string): string[] {
  if (!value) return [];
  return value
    .split(/;\s*|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function serializeValue(values: string[]): string {
  return values.join(SEPARATOR);
}
