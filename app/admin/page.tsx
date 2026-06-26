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
import { UsersAdmin } from '@/components/admin/UsersAdmin';
import { EshNav } from '@/components/esh/EshNav';

type Tab = 'boxes' | 'assignments' | 'template' | 'box-items' | 'users';

const TABS: [Tab, string][] = [
  ['boxes', 'Boxes'],
  ['assignments', 'Assignments'],
  ['template', 'Checklist'],
  ['box-items', 'Box items'],
  ['users', 'Users'],
];

export default function AdminPage() {
  return <RequireAuth roles={['admin']}>{(me) => <Admin me={me} />}</RequireAuth>;
}

function Admin({ me }: { me: Me }) {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(() => (isTab(requestedTab) ? requestedTab : 'boxes'));

  useEffect(() => {
    if (isTab(requestedTab)) setTab(requestedTab);
  }, [requestedTab]);

  return (
    <>
      <AppHeader title="Admin" subtitle={me.full_name} right={<EshNav role={me.role} />} />
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {TABS.map(([key, label]) => (
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
        {tab === 'users' && <UsersAdmin />}
      </main>
    </>
  );
}

function isTab(value: string | null): value is Tab {
  return TABS.some(([key]) => key === value);
}
