import React from 'react';

// SVG icon library for expense types — replaces emojis
const ICON_CATALOG = {
  fuel: (p) => (
    <svg {...p}><path d="M3 22V5a2 2 0 012-2h6a2 2 0 012 2v17" /><path d="M13 10h2a2 2 0 012 2v3a2 2 0 002 2h0a2 2 0 002-2V8.5L17.5 5" /><path d="M3 22h10" /><rect x="5" y="8" width="6" height="4" rx="1" /></svg>
  ),
  food: (p) => (
    <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 3v4M8 7.5l1 3M16 7.5l-1 3" /><path d="M7 14h10" /></svg>
  ),
  toll: (p) => (
    <svg {...p}><path d="M4 20V4h16v16" /><path d="M4 12h16" /><path d="M12 4v16" /><circle cx="8" cy="8" r="1.5" fill="currentColor" /><circle cx="16" cy="16" r="1.5" fill="currentColor" /></svg>
  ),
  hotel: (p) => (
    <svg {...p}><path d="M3 21V7a2 2 0 012-2h14a2 2 0 012 2v14" /><path d="M3 21h18" /><rect x="7" y="9" width="4" height="5" rx="1" /><rect x="13" y="9" width="4" height="5" rx="1" /><path d="M10 5V3M14 5V3" /></svg>
  ),
  transport: (p) => (
    <svg {...p}><rect x="2" y="6" width="20" height="12" rx="3" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /><path d="M5 10h14" /></svg>
  ),
  train: (p) => (
    <svg {...p}><rect x="4" y="3" width="16" height="16" rx="3" /><path d="M4 11h16" /><path d="M12 3v8" /><circle cx="8.5" cy="15" r="1" fill="currentColor" /><circle cx="15.5" cy="15" r="1" fill="currentColor" /><path d="M7 19l-2 3M17 19l2 3" /></svg>
  ),
  plane: (p) => (
    <svg {...p}><path d="M2 12l5-1 3-7h2l-1.5 7H17l2-2h1l-1 3 1 3h-1l-2-2h-6.5L12 20h-2l-3-7-5-1z" /></svg>
  ),
  shopping: (p) => (
    <svg {...p}><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 01-8 0" /></svg>
  ),
  tools: (p) => (
    <svg {...p}><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
  ),
  coffee: (p) => (
    <svg {...p}><path d="M17 8h1a4 4 0 010 8h-1" /><path d="M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z" /><path d="M6 2v3M10 2v3M14 2v3" /></svg>
  ),
  medical: (p) => (
    <svg {...p}><path d="M8 2h8v6h6v8h-6v6H8v-6H2v-8h6z" /></svg>
  ),
  parking: (p) => (
    <svg {...p}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 17V7h4a3 3 0 010 6H9" /></svg>
  ),
  phone: (p) => (
    <svg {...p}><rect x="5" y="2" width="14" height="20" rx="3" /><path d="M12 18h0" /></svg>
  ),
  receipt: (p) => (
    <svg {...p}><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1-1V2l-1 1-3-1-3 1-3-1-3 1z" /><path d="M8 7h8M8 11h8M8 15h4" /></svg>
  ),
  car: (p) => (
    <svg {...p}><path d="M5 17h14v-5l-2-5H7L5 12z" /><circle cx="7.5" cy="17" r="2" /><circle cx="16.5" cy="17" r="2" /><path d="M5 12h14" /></svg>
  ),
  gift: (p) => (
    <svg {...p}><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13" /><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /><path d="M7.5 8C7.5 6.34 9 4 12 4s4.5 2.34 4.5 4" /></svg>
  ),
  office: (p) => (
    <svg {...p}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
  ),
  leaf: (p) => (
    <svg {...p}><path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.71c.75.75 1.6 1.34 2.51 1.76C13.18 23.14 19 22 22 18c.91-1.22 1.38-2.66 1-4-.38-1.34-2.07-2-4-2-1.59 0-3.19.5-4.53 1.4-.52-.98-.84-2.09-.97-3.4z" /></svg>
  ),
  other: (p) => (
    <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
  ),
};

// All available icon keys for the picker
export const AVAILABLE_ICONS = Object.keys(ICON_CATALOG);

// Labels for the icon picker
export const ICON_LABELS = {
  fuel: 'Carburant',
  food: 'Repas',
  toll: 'P\u00E9age',
  hotel: 'H\u00F4tel',
  transport: 'Transport',
  train: 'Train',
  plane: 'Avion',
  shopping: 'Courses',
  tools: 'Outils',
  coffee: 'Caf\u00E9',
  medical: 'Sant\u00E9',
  parking: 'Parking',
  phone: 'T\u00E9l\u00E9phone',
  receipt: 'Re\u00E7u',
  car: 'Voiture',
  gift: 'Cadeau',
  office: 'Bureau',
  leaf: 'Nature',
  other: 'Autre',
};

// Render an SVG icon by key, with fallback to colored initial
export default function TypeIcon({ icon, color, size = 20, className = '' }) {
  const svgProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };

  const renderFn = ICON_CATALOG[icon];

  if (renderFn) {
    return <span className={className}>{renderFn(svgProps)}</span>;
  }

  // Fallback: if icon is an old emoji or unknown key, show colored dot with first letter
  if (icon && icon.length <= 2 && /\p{Emoji}/u.test(icon)) {
    // It's an emoji — show a colored dot instead
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: color ? color + '30' : 'rgba(107,114,128,0.2)',
        }}
      >
        <span
          className="rounded-full"
          style={{
            width: size * 0.4,
            height: size * 0.4,
            backgroundColor: color || '#6B7280',
          }}
        />
      </span>
    );
  }

  // Unknown string key — try as icon name, fall back to "other"
  const fallbackRender = ICON_CATALOG.other;
  return <span className={className}>{fallbackRender(svgProps)}</span>;
}

// Icon picker grid component for AdminTypes
export function IconPicker({ value, onChange, color }) {
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {AVAILABLE_ICONS.map((key) => {
        const isSelected = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
              isSelected
                ? 'bg-green-mid/20 border-2 border-green-mid text-green-light'
                : 'bg-bg border border-card-border text-text-muted hover:text-text hover:border-text-muted/40'
            }`}
            title={ICON_LABELS[key] || key}
            style={isSelected && color ? { color } : undefined}
          >
            <TypeIcon icon={key} size={18} />
          </button>
        );
      })}
    </div>
  );
}
