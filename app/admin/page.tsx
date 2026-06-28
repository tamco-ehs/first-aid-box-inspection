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
import { BoxExpiryAdmin } from '@/components/admin/BoxExpiryAdmin';
import { ExpiringItemsAdmin } from '@/components/admin/ExpiringItemsAdmin';
import { UsersAdmin } from '@/components/admin/UsersAdmin';
import { EmailTestAdmin } from '@/components/admin/EmailTestAdmin';
import { EshNav } from '@/components/esh/EshNav';

type Tab = 'boxes' | 'box-expiry' | 'assignments' | 'template' | 'box-items' | 'expiring-items' | 'email-test' | 'users';
type Group = 'boxes' | 'items' | 'people';

const GROUPS: Array<{ key: Group; label: string; tabs: [Tab, string][] }> = [
  {
    key: 'boxes',
    label: 'Boxes',
    tabs: [
      ['boxes', 'Box masterlist'],
      ['box-expiry', 'Box expiry'],
      ['assignments', 'Assignments'],
    ],
  },
  {
    key: 'items',
    label: 'Items',
    tabs: [
      ['template', 'Checklist'],
      ['box-items', 'Box items'],
      ['expiring-items', 'Expiring items'],
    ],
  },
  {
    key: 'people',
    label: 'People',
    tabs: [
      ['email-test', 'Email test'],
      ['users', 'Users'],
    ],
  },
];
const TABS = GROUPS.flatMap((group) => group.tabs);

export default function AdminPage() {
  return <RequireAuth roles={['superadmin', 'admin']}>{(me) => <Admin me={me} />}</RequireAuth>;
}

function Admin({ me }: { me: Me }) {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter(([key]) => canSeeTab(key, me.role)),
  })).filter((group) => group.tabs.length > 0);
  const visibleTabs = visibleGroups.flatMap((group) => group.tabs);
  const [tab, setTab] = useState<Tab>(() =>
    isTab(requestedTab) && canSeeTab(requestedTab, me.role) ? requestedTab : 'boxes',
  );
  const activeGroup = visibleGroups.find((group) => group.tabs.some(([key]) => key === tab)) ?? visibleGroups[0] ?? GROUPS[0]!;

  useEffect(() => {
    if (!isTab(requestedTab)) return;
    setTab(canSeeTab(requestedTab, me.role) ? requestedTab : 'boxes');
  }, [me.role, requestedTab]);

  return (
    <>
      <AppHeader title="Admin" subtitle={me.full_name} right={<EshNav role={me.role} />} />
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {visibleGroups.map((group) => (
            <button
              key={group.key}
              onClick={() => setTab(firstTab(group))}
              className={`btn btn-md ${activeGroup.key === group.key ? 'btn-primary' : 'btn-secondary'}`}
            >
              {group.label}
            </button>
          ))}
        </div>

        {activeGroup && (
          <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-2">
            {activeGroup.tabs
              .filter(([key]) => visibleTabs.some(([visibleKey]) => visibleKey === key))
              .map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold ${
                    tab === key ? 'bg-emerald-50 text-brand' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
          </div>
        )}

        {tab === 'boxes' && <BoxesAdmin />}
        {tab === 'box-expiry' && <BoxExpiryAdmin />}
        {tab === 'assignments' && <AssignmentsAdmin />}
        {tab === 'template' && <TemplateAdmin />}
        {tab === 'box-items' && <BoxItemsAdmin />}
        {tab === 'expiring-items' && <ExpiringItemsAdmin />}
        {tab === 'email-test' && <EmailTestAdmin />}
        {tab === 'users' && me.role === 'superadmin' && <UsersAdmin />}
      </main>
    </>
  );
}

function isTab(value: string | null): value is Tab {
  return TABS.some(([key]) => key === value);
}

function firstTab(group: { tabs: [Tab, string][] }): Tab {
  return group.tabs[0]?.[0] ?? 'boxes';
}

function canSeeTab(tab: Tab, role: Me['role']): boolean {
  if (tab === 'users') return role === 'superadmin';
  return true;
}
