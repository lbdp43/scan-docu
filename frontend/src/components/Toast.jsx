import React, { useEffect, useState } from 'react';

export default function Toast({ message, type = 'success', onClose, duration = 3000 }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const colors = {
    success: 'bg-green-mid/90 border-green-bright',
    error: 'bg-red-900/90 border-red-500',
    warning: 'bg-amber-900/90 border-amber-500',
    info: 'bg-blue-900/90 border-blue-500',
  };

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⏳',
    info: 'ℹ️',
  };

  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 ${
      visible ? 'animate-toast-in opacity-100' : 'opacity-0 -translate-y-4'
    }`}>
      <div className={`px-5 py-3 rounded-2xl border ${colors[type]} backdrop-blur-lg flex items-center gap-3 shadow-2xl max-w-sm`}>
        <span className="text-lg">{icons[type]}</span>
        <span className="text-sm font-medium text-white">{message}</span>
      </div>
    </div>
  );
}
