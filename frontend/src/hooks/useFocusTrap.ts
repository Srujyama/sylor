"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Traps keyboard focus inside a modal/dialog while it is open.
 *
 * - On open, moves focus into the container (or an explicitly preferred element)
 *   and remembers what was focused before so it can be restored on close.
 * - Tab / Shift+Tab wrap around the focusable elements inside the container.
 * - On close (open === false), restores focus to the previously-focused element.
 *
 * The container ref must be attached to the dialog's root element. `open` should
 * mirror the component's visibility so the trap activates/deactivates with it.
 *
 * This does NOT handle Escape-to-close — callers already own that — and it does
 * not render anything; it only manages focus. Pair it with `role="dialog"` and
 * `aria-modal="true"` on the same container for full screen-reader semantics.
 */
export function useFocusTrap<T extends HTMLElement>(open: boolean) {
  const containerRef = useRef<T | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    // Remember what had focus so we can restore it when the dialog closes.
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Move focus inside the dialog. Prefer an element that opted in via
    // data-autofocus, otherwise the first focusable, otherwise the container.
    const focusFirst = () => {
      const preferred = container.querySelector<HTMLElement>("[data-autofocus]");
      if (preferred) {
        preferred.focus();
        return;
      }
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        // Make the container itself focusable as a last resort.
        if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
        container.focus();
      }
    };
    // Defer one frame so inputs that mount with their own autofocus settle first.
    const raf = requestAnimationFrame(focusFirst);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const el = containerRef.current;
      if (!el) return;
      const focusables = Array.from(
        el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((node) => node.offsetParent !== null || node === document.activeElement);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !el.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !el.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown, true);
      // Restore focus to whatever was focused before the dialog opened.
      const prev = previouslyFocused.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [open]);

  return containerRef;
}
