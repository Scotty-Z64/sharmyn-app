import type { ReactNode } from 'react';
import BackButton from '@/components/BackButton';

export default function LegalPageLayout({
  title, updated, children,
}: { title: string; updated: string; children: ReactNode }) {
  return (
    <div>
      <section className="bg-blush-100 py-10 border-b border-gold-400/30">
        <div className="max-w-2xl mx-auto px-4">
          <BackButton />
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-ink-900 mt-2">{title}</h1>
          <p className="mt-1 text-[13px] text-ink-500">Last updated: {updated}</p>
        </div>
      </section>
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-7">
        {children}
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-xl font-semibold text-ink-900 mb-2">{title}</h2>
      <div className="text-[15px] text-ink-500 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}
