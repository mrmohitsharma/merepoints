import type { Metadata } from 'next';
import Link from 'next/link';
import { H, LegalPage } from '@/components/site';
import { COMPANY as C } from '@/lib/company';

export const metadata: Metadata = { title: 'Privacy policy | Mere Points' };

const TOC = ['Who we are', 'What this covers', 'Information we collect', 'How we use it', 'What shops see', 'Who we share it with', 'Payments', 'How long we keep it', 'Security', 'Your rights and choices', 'Children', 'Where data is processed', 'Changes', 'Contact and Grievance Officer'];

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" toc={TOC} intro={<>
      <p>{C.brand} lets building-material shops reward their regular customers with points. This policy explains what information we handle to do that, why, who sees it, how long we keep it and the choices you have. It is written to be read, so it uses plain language.</p>
      <div className="short"><b>The short version.</b> We use your information only to run your points, your shop account and payouts. A shop sees your details only after you buy there. We do not sell your data, we do not share it with other shops, and we do not use it to train AI models.</div>
    </>}>
      <H n={1}>Who we are</H>
      <p>{C.brand} is operated by {C.legalName}, {C.address} (“we”, “us”). We decide how personal data is used for the purposes in this policy, which makes us the Data Fiduciary under India’s Digital Personal Data Protection Act, 2023 (“DPDP Act”). You can reach us at <a href={`mailto:${C.supportEmail}`}>{C.supportEmail}</a>.</p>
      <p>Each Shop also uses its Customers’ details to run its own loyalty programme (for example, to pay out points or send offers about the shop). Shops must use those details only as these terms and the law allow.</p>

      <H n={2}>What this policy covers</H>
      <p>This policy covers the website at {C.domain}, the {C.brand} app for Android and iOS, the shop and admin dashboards, and the SMS messages we send. It applies to Customers (carpenters, painters, contractors and others who earn points), Shop owners and their staff, and visitors to our website.</p>

      <H n={3}>Information we collect</H>
      <table>
        <thead><tr><th>What</th><th>Examples</th><th>Where it comes from</th></tr></thead>
        <tbody>
          <tr><td>Account details</td><td>Mobile number, name, preferred language, and for Customers: work type (e.g. carpenter), city, optional photo</td><td>You, when you sign up</td></tr>
          <tr><td>Payout details</td><td>Your UPI ID, so a Shop can pay out your points</td><td>You (optional)</td></tr>
          <tr><td>Shop details</td><td>Shop name, owner name, address, GPS location of the shop taken at sign-up, categories, phone, email, GSTIN, logo, opening hours, staff names and mobile numbers</td><td>Shop owners</td></tr>
          <tr><td>Points activity</td><td>Bills (amount, invoice number, optional bill photo), points earned, reversed, expired and redeemed, offers applied, bonus products ticked, payouts and how they were paid (cash, UPI reference, gift), “Received” or “Not received” replies, who at the shop made each entry</td><td>Shops and you, as you use the Service</td></tr>
          <tr><td>Products and ads</td><td>Product names, photos, points and stock listed by Shops; banners; counts of how often each banner was seen or tapped (counted per day, not per person)</td><td>Shops, advertisers and the app</td></tr>
          <tr><td>Location</td><td>Your phone’s location when you look for shops or products nearby, or to show banners for shops near you. It is used for that search and not stored with your account. Shops share the shop’s location at sign-up.</td><td>Your phone, only after you allow it</td></tr>
          <tr><td>Billing details (Shops)</td><td>Plan, payments, receipts, SMS balance</td><td>Shops, and Razorpay when a payment completes</td></tr>
          <tr><td>Technical data</td><td>IP address, app version, device type, request logs, error reports, one-time password records (kept as a hash)</td><td>Your browser or device, automatically</td></tr>
        </tbody>
      </table>
      <p><b>Camera and photos.</b> The shop app uses the camera to scan a Customer’s My QR code and to take product photos, and the photo library only when you choose a photo to upload. It does not read your contacts, messages or other files.</p>
      <p><b>Cookies and local storage.</b> Our website and app store a sign-in token on your device so you stay logged in, and small preferences such as language and the selected shop. We use no advertising or third-party analytics cookies.</p>

      <H n={4}>How we use information</H>
      <ul>
        <li>To create and secure your account, and to sign you in with an OTP.</li>
        <li>To record points, show your balance, levels and history, apply each Shop’s rules, and expire points as the Shop has set.</li>
        <li>To run payouts and the Received check, and to look into payouts marked “Not received”.</li>
        <li>To send SMS about bills, payouts, expiring points and offers from Shops where you hold points. You can turn off bill SMS in the app.</li>
        <li>To show shops, products and banners near you or relevant to your work type.</li>
        <li>To approve Shops, process plan and ad payments, and issue receipts.</li>
        <li>To keep the Service safe: prevent fraud and fake bills, enforce limits, investigate faults and fix bugs.</li>
        <li>To meet legal obligations, such as tax records and lawful requests from authorities.</li>
      </ul>
      <p>We rely on your consent when you create an account, allow location or camera, or add a UPI ID, and on the legitimate uses the DPDP Act allows for things like security, fraud prevention and legal compliance. You can withdraw consent at any time (section 10); this stops future processing but does not undo what was already done lawfully.</p>

      <H n={5}>What shops see</H>
      <p>A Shop sees your name, mobile number, work type, city, level and UPI ID only after you buy there (when the Shop scans your QR or enters your number). It sees your points, bills, visits and payouts <b>at that shop only</b>. It does not see your points or activity at other shops. Shop owners decide which of their staff can see this.</p>

      <H n={6}>Who we share it with</H>
      <p>We do not sell personal data. We share it only:</p>
      <ul>
        <li>with the Shops where you hold points, as described in section 5;</li>
        <li>with service providers who work for us under contract and only on our instructions: Amazon Web Services (hosting and file storage), our SMS provider (to deliver messages), and Razorpay (Shop payments);</li>
        <li>when you ask us to, or when the law, a court or a government authority requires it;</li>
        <li>to protect the rights and safety of our users, the public or us, for example to stop fraud;</li>
        <li>if our business is merged or sold, with the new owner, who must keep protecting it as this policy says.</li>
      </ul>

      <H n={7}>Payments</H>
      <p>Shop plan, SMS pack and banner payments are processed by Razorpay on its own secure checkout. You enter card, UPI or bank details with Razorpay, not with us, and we never receive or store them. Razorpay tells us the order number, amount and whether the payment succeeded. Payouts of points between a Shop and a Customer happen directly between them; we record only the method and any reference the Shop enters.</p>

      <H n={8}>How long we keep it</H>
      <ul>
        <li><b>Account details</b>: while your account is active. When you delete it, we remove your name, photo, UPI ID and work type, and replace your mobile number in shop records with a deleted-user marker within 30 days.</li>
        <li><b>Points and billing records</b>: up to 8 years, because Shops and we must keep business and tax records under Indian law. After account deletion these stay without your name or mobile number.</li>
        <li><b>OTP records</b> are deleted after 24 hours; <b>request logs</b> after 90 days; <b>photos</b> when the Shop deletes the product or closes its account.</li>
      </ul>

      <H n={9}>Security</H>
      <p>Data is sent over HTTPS and stored on servers with restricted access. OTPs and passwords are stored only as one-way hashes. My QR codes change every minute and are signed so they cannot be forged. Every change to points is recorded in an audit log, and staff access is limited by role. No system is completely secure; if a breach affects your personal data, we will tell you and the Data Protection Board of India as the law requires.</p>

      <H n={10}>Your rights and choices</H>
      <p>Under the DPDP Act and other laws that apply to you, you can:</p>
      <ul>
        <li>ask for a summary of the personal data we hold about you and how it is used;</li>
        <li>correct or update it (most details can be changed in the app’s Profile);</li>
        <li>ask us to erase it, or delete your account (see <Link href="/delete-account/">how to delete your data</Link>);</li>
        <li>withdraw consent, for example by turning off location or bill SMS, or removing your UPI ID;</li>
        <li>nominate someone to exercise these rights for you if you die or become unable to;</li>
        <li>raise a grievance with us, and if you are not satisfied with our answer, complain to the Data Protection Board of India.</li>
      </ul>
      <p>Email <a href={`mailto:${C.supportEmail}`}>{C.supportEmail}</a> and tell us the mobile number on your account. We may ask you to confirm it with an OTP, and we reply within 30 days.</p>

      <H n={11}>Children</H>
      <p>Accounts are for people aged 18 or older. We do not knowingly create accounts for children. If you believe a child has signed up, email us and we will delete the account.</p>

      <H n={12}>Where data is processed</H>
      <p>Our servers and files are hosted by Amazon Web Services in Mumbai, India. We transfer data outside India only as permitted by Indian law.</p>

      <H n={13}>Changes to this policy</H>
      <p>We will update this page when our practices change and change the date at the top. If a change materially affects how we use your personal data, we will tell you by SMS or in the app before it takes effect, and ask for your consent again where the law requires.</p>

      <H n={14}>Contact and Grievance Officer</H>
      <p>For questions, requests or complaints about privacy, contact our Grievance Officer:</p>
      <p>{C.grievanceOfficer}<br />{C.legalName}<br />{C.address}<br />Email: <a href={`mailto:${C.supportEmail}`}>{C.supportEmail}</a></p>
      <p>We acknowledge complaints within 24 hours and aim to resolve them within 15 days.</p>
    </LegalPage>
  );
}
