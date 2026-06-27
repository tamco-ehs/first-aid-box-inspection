'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Me } from '@/lib/client/types.ts';
import { RequireAuth } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { BoxesAdmin } from '@/components/admin/BoxesAdmin';
import { AssignmentsAdmin } from '@/components/admin/AssignmentsAdmin';
import { TemplateAdmin } from '@/components/admin/TemplateAdmin';
import { BoxItemsAdmin } from '@/components/admin/BoxItemsAdmin';
import { ExpiringItemsAdmin } from '@/components/admin/ExpiringItemsAdmin';
import { UsersAdmin } from '@/components/admin/UsersAdmin';
import { EshNav } from '@/components/esh/EshNav';

type Tab = 'boxes' | 'assignments' | 'template' | 'box-items' | 'expiring-items' | 'users';

const TABS: [Tab, string][] = [
  ['boxes', 'Boxes'],
  ['assignments', 'Assignments'],
  ['template', 'Checklist'],
  ['box-items', 'Box items'],
  ['expiring-items', 'Expiring items'],
  ['users', 'Users'],
];

export default function AdminPage() {
  return <RequireAuth roles={['superadmin', 'admin']}>{(me) => <Admin me={me} />}</RequireAuth>;
}

function Admin({ me }: { me: Me }) {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const visibleTabs = me.role === 'superadmin' ? TABS : TABS.filter(([key]) => key !== 'users');
  const [tab, setTab] = useState<Tab>(() =>
    isTab(requestedTab) && (requestedTab !== 'users' || me.role === 'superadmin') ? requestedTab : 'boxes',
  );

  useEffect(() => {
    if (!isTab(requestedTab)) return;
    setTab(requestedTab !== 'users' || me.role === 'superadmin' ? requestedTab : 'boxes');
  }, [me.role, requestedTab]);

  return (
    <>
      <AppHeader title="Admin" subtitle={me.full_name} right={<EshNav role={me.role} />} />
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {visibleTabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`btn btn-md ${tab === key ? 'btn-primary' : 'btn-secondary'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'boxes' && <BoxesAdmin />}
        {tab === 'assignments' && <AssignmentsAdmin />}
        {tab === 'template' && <TemplateAdmin />}
        {tab === 'box-items' && <BoxItemsAdmin />}
        {tab === 'expiring-items' && <ExpiringItemsAdmin />}
        {tab === 'users' && me.role === 'superadmin' && <UsersAdmin />}
      </main>
    </>
  );
}

function isTab(value: string | null): value is Tab {
  return TABS.some(([key]) => key === value);
}
