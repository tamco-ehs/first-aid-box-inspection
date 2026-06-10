// Shown by the service worker when a navigation fails offline. Intentionally
// static and data-free.
export const metadata = { title: 'Offline - First Aid Box Inspection' };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl">📴</div>
      <h1 className="text-xl font-bold">You are offline</h1>
      <p className="text-slate-600">
        This page needs an internet connection. Any inspection you have started is
        saved on this device as a draft and will still be here when you reconnect.
      </p>
      <a href="/login" className="btn btn-lg btn-primary">
        Try again
      </a>
    </main>
  );
}
