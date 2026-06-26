'use client';

import { RequireAuth } from '@/components/RequireAuth';
import { AppHeader } from '@/components/AppHeader';
import { BottomNav } from '@/components/BottomNav';

export default function GuidancePage() {
  return (
    <RequireAuth>
      {() => (
        <>
          <AppHeader title="Guidance" subtitle="How to inspect" />
          <main className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
            <Card title="1. Quick inspection (every box, every time)">
              Answer the 4 quick questions. If the box is accessible, clean, sealed and the contact is
              visible, you are done — no need to open the box or check every item.
            </Card>
            <Card title="2. When the item check opens">
              If the <strong>seal is not intact</strong> (the box may have been used) or an{' '}
              <strong>item is expired</strong>, the item checklist opens automatically so you can verify
              quantities and expiry dates.
            </Card>
            <Card title="3. Item buttons">
              <ul className="ml-4 list-disc space-y-1">
                <li><strong>OK</strong> — enough quantity and not expired.</li>
                <li><strong>Low Qty</strong> — enter the current quantity and a short remark.</li>
                <li><strong>Missing</strong> — item not there; add a short remark.</li>
                <li><strong>Expired</strong> — confirm; add the new expiry only if already replaced.</li>
              </ul>
            </Card>
            <Card title="4. What happens next">
              Any issue you report automatically creates an action for the ESH team. They restock or
              replace items and close the action — the box status updates to Ready when everything is
              resolved.
            </Card>
            <Card title="Tip">
              Your progress is saved on this device, so you won&apos;t lose anything if the signal is
              weak. Just submit again when you&apos;re back online.
            </Card>
          </main>
          <BottomNav />
        </>
      )}
    </RequireAuth>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="mb-1 font-bold">{title}</h2>
      <div className="text-sm text-slate-600">{children}</div>
    </section>
  );
}
