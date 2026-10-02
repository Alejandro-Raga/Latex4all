import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A chat's name, edited in place: Enter or leaving keeps it, Escape
 * leaves it as it was.
 */
export function RenameInput({
  value,
  onDone,
  className,
}: {
  value: string;
  /** The new name, or null to keep the old one. */
  onDone: (name: string | null) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.select();
  }, []);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      ref={ref}
      defaultValue={value}
      aria-label="Chat name"
      maxLength={72}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className={cn(
        "min-w-0 rounded border border-border bg-background px-1 py-0.5 text-xs outline-none focus:border-primary",
        className,
      )}
    />
  );
}
