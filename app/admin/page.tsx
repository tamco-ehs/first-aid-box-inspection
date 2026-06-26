'use client';

import { useState } from 'react';
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
  const [tab, setTab] = useState<Tab>('boxes');
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
