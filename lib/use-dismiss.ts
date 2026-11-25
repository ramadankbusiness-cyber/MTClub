import { useEffect, useRef, type RefObject } from "react";

type DismissOptions = {
  enabled: boolean;
  onDismiss: () => void;
  refs: Array<RefObject<HTMLElement | null>>;
};

/**
 * Closes an open menu/popover on outside pointer interaction or Escape.
 * Consumers should keep trigger toggle behavior and close-on-selection as needed.
 */
export function useDismiss({ enabled, onDismiss, refs }: DismissOptions) {
  const refsRef = useRef(refs);
  refsRef.current = refs;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const inside = refsRef.current.some((ref) => ref.current?.contains(target));
      if (!inside) onDismissRef.current();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismissRef.current();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled]);
}
