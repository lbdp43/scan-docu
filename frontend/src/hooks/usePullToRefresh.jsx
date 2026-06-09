import { useRef, useState, useCallback, useEffect } from 'react';

const THRESHOLD = 64;
const MAX_PULL = 100;

export default function usePullToRefresh(onRefresh) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef(null);
  const startY = useRef(0);
  const pulling = useRef(false);

  const handleTouchStart = useCallback((e) => {
    if (isRefreshing) return;
    const el = containerRef.current;
    if (!el || window.scrollY > 5) return;
    startY.current = e.touches[0].clientY;
    pulling.current = true;
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e) => {
    if (!pulling.current || isRefreshing) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy < 0) { setPullDistance(0); return; }
    const clamped = Math.min(dy * 0.45, MAX_PULL);
    setPullDistance(clamped);
  }, [isRefreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;

    if (pullDistance >= THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(THRESHOLD * 0.6);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd);
    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const progress = Math.min(pullDistance / THRESHOLD, 1);

  const PullIndicator = () => (
    pullDistance > 0 || isRefreshing ? (
      <div
        className="flex justify-center overflow-hidden transition-[height] duration-200"
        style={{ height: isRefreshing ? 40 : pullDistance > 0 ? pullDistance * 0.6 : 0 }}
      >
        <div
          className="flex items-center justify-center"
          style={{
            opacity: Math.min(progress * 1.5, 1),
            transform: `rotate(${progress * 180}deg)`,
          }}
        >
          {isRefreshing ? (
            <span className="w-5 h-5 border-2 border-green-mid/30 border-t-green-light rounded-full animate-spin" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={progress >= 1 ? 'text-green-light' : 'text-text-muted'}
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          )}
        </div>
      </div>
    ) : null
  );

  return { containerRef, PullIndicator, isRefreshing };
}
