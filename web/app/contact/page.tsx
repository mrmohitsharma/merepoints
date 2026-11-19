import type { Metadata } from 'next';
import { Clock, Mail, MapPin, Phone, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { LegalPage } from '@/components/site';
import { COMPANY } from '@/lib/company';

export const metadata: Metadata = { title: 'Contact us | Mere Points' };

export default function Contact() {
  const rows: [LucideIcon, string, ReactNode][] = [
    [Mail, 'Email', <a key="e" href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</a>],
    ...(COMPANY.phone ? [[Phone, 'Phone', <a key="p" href={`tel:${COMPANY.phone}`}>{COMPANY.phone}</a>] as [LucideIcon, string, ReactNode]] : []),
    [Clock, 'Hours', 'Monday to Saturday, 10 am to 7 pm IST. We reply to email within one working day.'],
    [MapPin, 'Registered office', <>{COMPANY.legalName}<br />{COMPANY.address}</>],
    [ShieldCheck, 'Grievance Officer', <>{COMPANY.grievanceOfficer}, at the address above. Email <a href={`mailto:${COMPANY.supportEmail}?subject=Grievance`}>{COMPANY.supportEmail}</a> with “Grievance” in the subject. We acknowledge within 24 hours and resolve within 15 days.</>],
  ];
  return (
    <LegalPage title="Contact us" intro={<p>Questions about your shop account, a payout, a payment or your points? We are here to help.</p>}>
      <div className="mt-8 divide-y divide-line rounded-2xl border border-line">
        {rows.map(([Icon, k, v]) => (
          <div key={k} className="flex gap-4 p-5">
            <Icon className="mt-1 shrink-0 text-brand" size={20} />
            <div><p className="!mt-0 font-semibold text-ink">{k}</p><div className="text-[15px]">{v}</div></div>
          </div>
        ))}
      </div>
      <h2>Payout not received?</h2>
      <p>If a shop says it paid you but you did not get the money or gift, tap <b>Not received yet</b> in the app. Our team contacts you and the shop and checks the payment proof.</p>
    </LegalPage>
  );
}
