"use client";

import * as React from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface SliderWithInputProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  unitPosition?: "prefix" | "suffix";
  label?: string;
  sublabel?: string;
  className?: string;
  compact?: boolean;
}

export function SliderWithInput({
  min,
  max,
  step,
  value,
  onChange,
  unit,
  unitPosition = "suffix",
  label,
  sublabel,
  className,
  compact = false,
}: SliderWithInputProps) {
  const [inputValue, setInputValue] = React.useState(String(value));

  // Sync input when value changes externally (slider drag)
  React.useEffect(() => {
    setInputValue(String(value));
  }, [value]);

  const computedStep = step ?? (max > 10000 ? Math.max(1, Math.round((max - min) / 200)) : max > 100 ? 1 : 0.1);

  const isPrefix = unit && unitPosition === "prefix";
  const isSuffix = unit && unitPosition === "suffix";
  const unitJoin = unit && ["%" , "x", "K", "pH", "nM", "µM", "bps"].includes(unit) ? "" : " ";

  function formatDisplay(v: number): string {
    if (unit === "$") return `$${v.toLocaleString()}`;
    if (unit) return `${v.toLocaleString()}${unitJoin}${unit}`;
    return v.toLocaleString();
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value);
  }

  function handleInputBlur() {
    const parsed = parseFloat(inputValue.replace(/[^0-9.\-]/g, ""));
    if (isNaN(parsed)) {
      setInputValue(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    const rounded = Math.round(clamped / computedStep) * computedStep;
    onChange(rounded);
    setInputValue(String(rounded));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <div className={cn("group", className)}>
      {/* Header row: label + input */}
      {(label || !compact) && (
        <div className="flex items-center justify-between mb-1">
          {label && <span className="text-xs text-white/70 font-medium">{label}</span>}
          <div className="relative inline-flex items-center">
            {isPrefix && (
              <span className="absolute left-2 text-[10px] text-white/30 pointer-events-none select-none">{unit}</span>
            )}
            <input
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              onKeyDown={handleKeyDown}
              className={cn(
                "w-24 h-7 bg-white/[0.04] border border-white/10 text-sm text-white text-right font-mono",
                "focus:outline-none focus:border-white/25 transition-colors",
                isPrefix && "pl-5 pr-2",
                isSuffix && "pl-2 pr-6",
                !unit && "px-2",
              )}
            />
            {isSuffix && (
              <span className="absolute right-2 text-[10px] text-white/30 pointer-events-none select-none">{unit}</span>
            )}
          </div>
        </div>
      )}

      {/* Sublabel (AI reasoning) */}
      {sublabel && (
        <div className="text-[10px] text-white/20 mb-2.5 leading-relaxed">{sublabel}</div>
      )}

      {/* Slider */}
      <Slider
        min={min}
        max={max}
        step={computedStep}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
      />

      {/* Min/max labels */}
      <div className="flex justify-between text-[10px] text-white/15 mt-1">
        <span>{formatDisplay(min)}</span>
        <span>{formatDisplay(max)}</span>
      </div>
    </div>
  );
}
