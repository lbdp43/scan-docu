import React, { useMemo } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { path: '/', label: 'Accueil', icon: '🏠' },
  { path: '/scan', label: 'Scanner', icon: '📷' },
  { path: '/history', label: 'Historique', icon: '📊' },
];

const adminNavItem = { path: '/admin', label: 'Admin', icon: '⚙️' };
const profileNavItem = { path: '/profile', label: 'Profil', icon: '👤' };

export default function Layout() {
  const { user } = useAuth();
  const location = useLocation();

  const items = useMemo(() => {
    const list = [...navItems];
    if (user?.role === 'admin') {
      list.push(adminNavItem, profileNavItem);
    } else {
      list.push(profileNavItem);
    }
    return list;
  }, [user?.role]);

  return (
    <div className="min-h-screen bg-bg pb-24">
      <main className="max-w-lg mx-auto px-4 pt-6">
        <Outlet />
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 h-[84px] bg-black/95 backdrop-blur-xl border-t border-white/[0.08] z-50">
        <div className="max-w-lg mx-auto h-full flex items-center justify-around px-2">
          {items.map(item => {
            const isActive = item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path);

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center gap-1 py-2 px-3 transition-all duration-200 ${
                  isActive ? 'text-green-light -translate-y-0.5' : 'text-text-dim'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
