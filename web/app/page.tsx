import Link from 'next/link';
import { Store, ShieldCheck } from 'lucide-react';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-navy p-6">
      <div className="mb-10 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber text-2xl font-black text-navy">V</span>
        <span className="text-3xl font-bold text-white">Vyapar Point</span>
      </div>
      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        <Link href="/merchant/login/" className="rounded-2xl bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-xl">
          <Store className="text-brand" size={30} />
          <p className="mt-4 text-lg font-bold">Shop login</p>
          <p className="mt-1 text-muted">Counter, customers, offers, reports and billing for your shop.</p>
        </Link>
        <Link href="/admin/login/" className="rounded-2xl bg-white/8 p-6 text-white ring-1 ring-white/15 transition hover:bg-white/12">
          <ShieldCheck className="text-amber" size={30} />
          <p className="mt-4 text-lg font-bold">Vyapar Point team</p>
          <p className="mt-1 text-white/70">Super Admin: shop approvals, disputes, plans and analytics.</p>
        </Link>
      </div>
    </div>
  );
}
