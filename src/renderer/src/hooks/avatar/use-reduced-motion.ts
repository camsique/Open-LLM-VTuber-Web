import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** True when the OS asks for reduced motion. Updates live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    try {
      return typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}
