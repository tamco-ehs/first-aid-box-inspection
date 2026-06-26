'use client';

import { usePathname } from 'next/navigation';

// Mobile bottom tab bar for first aiders: Home, My Boxes, Guidance.
const TABS = [
  { href: '/home', label: 'Home', icon: '🏠' },
  { href: '/my-boxes', label: 'My Boxes', icon: '🧰' },
  { href: '/guidance', label: 'Guidance', icon: '📖' },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <a
              key={t.href}
              href={t.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium ${
                active ? 'text-brand' : 'text-slate-500'
              }`}
            >
              <span aria-hidden className={`text-lg ${active ? '' : 'opacity-70'}`}>
                {t.icon}
              </span>
              {t.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
