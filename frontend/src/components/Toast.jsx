import React, { useEffect, useState, useRef } from 'react';

export default function Toast({ message, type = 'success', onClose, duration = 3000 }) {
  const [phase, setPhase] = useState('enter'); // enter | visible | exit
  const startRef = useRef(Date.now());
  const barRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const enterTimer = setTimeout(() => setPhase('visible'), 20);

    const exitTimer = setTimeout(() => {
      setPhase('exit');
      setTimeout(onClose, 340);
    }, duration);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(exitTimer);
    };
  }, [duration, onClose]);

  useEffect(() => {
    function tick() {
      if (!barRef.current) return;
      const elapsed = Date.now() - startRef.current;
      const pct = Math.max(0, 1 - elapsed / duration);
      barRef.current.style.transform = `scaleX(${pct})`;
      if (pct > 0) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [duration]);

  const colors = {
    success: { bg: 'bg-green-mid/90', border: 'border-green-bright', bar: '#7FD472' },
    error:   { bg: 'bg-red-900/90',   border: 'border-red-500',      bar: '#EF4444' },
    warning: { bg: 'bg-amber-900/90',  border: 'border-amber-500',    bar: '#F59E0B' },
    info:    { bg: 'bg-blue-900/90',   border: 'border-blue-500',     bar: '#3B82F6' },
  };

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⏳',
    info: 'ℹ️',
  };

  const c = colors[type] || colors.success;

  return (
    <div
      className="fixed top-4 left-1/2 z-[100]"
      style={{
        transform: phase === 'enter'
          ? 'translateX(-50%) translateY(-24px) scale(0.95)'
          : phase === 'exit'
            ? 'translateX(-50%) translateY(-18px) scale(0.96)'
            : 'translateX(-50%) translateY(0) scale(1)',
        opacity: phase === 'enter' ? 0 : phase === 'exit' ? 0 : 1,
        transition: phase === 'exit'
          ? 'all 320ms cubic-bezier(0.4, 0, 1, 1)'
          : 'all 380ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <div className={`relative overflow-hidden px-5 py-3 rounded-2xl border ${c.bg} ${c.border} backdrop-blur-lg flex items-center gap-3 shadow-2xl max-w-sm`}>
        <span className="text-lg">{icons[type]}</span>
        <span className="text-sm font-medium text-white">{message}</span>
        <div
          ref={barRef}
          className="absolute bottom-0 left-0 right-0 h-[3px] origin-left"
          style={{ backgroundColor: c.bar, opacity: 0.5 }}
        />
      </div>
    </div>
  );
}
