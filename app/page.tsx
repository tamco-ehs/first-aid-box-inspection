import { redirect } from 'next/navigation';

// Entry point: there is no public landing content. Send everyone to login,
// which then routes by role. (Sensitive data lives behind authenticated API
// routes; nothing is rendered here.)
export default function HomePage() {
  redirect('/login');
}
