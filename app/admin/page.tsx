'use client';

import { useState } from 'react';
import type { Me } from '@/lib/client/types.ts';
import { RequireAuth } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { BoxesAdmin } from '@/components/admin/BoxesAdmin';
import { AssignmentsAdmin } from '@/components/admin/AssignmentsAdmin';
import { TemplateAdmin } from '@/components/admin/TemplateAdmin';
import { BoxItemsAdmin } from '@/components/admin/BoxItemsAdmin';
import { TopupsAdmin } from '@/components/admin/TopupsAdmin';
import { UsersAdmin } from '@/components/admin/UsersAdmin';

type Tab = 'boxes' | 'assignments' | 'template' | 'box-items' | 'topups' | 'users';

const TABS: [Tab, string][] = [
  ['boxes', 'Boxes'],
  ['assignments', 'Assignments'],
  ['template', 'Checklist'],
  ['box-items', 'Box items'],
  ['topups', 'Top-ups'],
  ['users', 'Users'],
];

export default function AdminPage() {
  return <RequireAuth roles={['admin']}>{(me) => <Admin me={me} />}</RequireAuth>;
}

function Admin({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>('boxes');
  return (
    <>
      <AppHeader
        title="Admin"
        subtitle={me.full_name}
        right={
          <a href="/reports" className="btn btn-ghost btn-md text-slate-600" data-tour="admin-reports-link">
            Dashboard
          </a>
        }
      />
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex flex-wrap gap-2" data-tour="admin-tabs">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`btn btn-md ${tab === key ? 'btn-primary' : 'btn-secondary'}`}
              data-tour={key === 'topups' ? 'admin-topups-tab' : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'boxes' && <BoxesAdmin />}
        {tab === 'assignments' && <AssignmentsAdmin />}
        {tab === 'template' && <TemplateAdmin />}
        {tab === 'box-items' && <BoxItemsAdmin />}
        {tab === 'topups' && <TopupsAdmin />}
        {tab === 'users' && <UsersAdmin />}
      </main>
    </>
  );
}
