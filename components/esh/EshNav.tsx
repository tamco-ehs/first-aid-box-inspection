'use client';

import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/client/types.ts';

// Top navigation links for the ESH side (dashboard / actions / admin).
export function EshNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const links = [
    { href: '/reports', label: 'Dashboard' },
    { href: '/actions', label: 'Actions' },
    ...(role === 'admin' ? [{ href: '/admin', label: 'Admin' }] : []),
  ];
  return (
    <div className="flex gap-1">
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className={`btn btn-md ${pathname.startsWith(l.href) ? 'btn-primary' : 'btn-ghost text-slate-600'}`}
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}
