import type { Metadata } from 'next';
import Link from 'next/link';
import { H, LegalPage } from '@/components/site';
import { COMPANY as C } from '@/lib/company';

export const metadata: Metadata = { title: 'Terms of service | Mere Points' };

const TOC = ['Agreement', 'The Service', 'Accounts', 'Points: how they work', 'Rules for shops', 'Payouts and disputes', 'Rules for customers', 'Products, offers and ads', 'Plans, payments and refunds', 'Acceptable use', 'Availability', 'Our rights', 'Suspension and closing', 'Disclaimers', 'Limitation of liability', 'Indemnity', 'Law and disputes', 'Changes', 'Contact and grievances'];

export default function Terms() {
  return (
    <LegalPage title="Terms of service" toc={TOC}>
      <H n={1}>Agreement</H>
      <p>These terms are an agreement between you and {C.legalName}, {C.address} (“we”, “us”), which operates {C.brand}. They apply when you use our website at {C.domain}, the {C.brand} app for Android and iOS, the shop dashboard, or any related service (together, the “Service”). By creating an account, registering a shop or using the Service, you accept these terms and our <Link href="/privacy/">Privacy policy</Link>. If you do not accept them, do not use the Service.</p>
      <p>You must be at least 18 and able to enter a binding contract. If you register a shop, you confirm you are allowed to accept these terms for that business, and “you” includes the business.</p>

      <H n={2}>The Service</H>
      <p>{C.brand} is a loyalty platform. Shops selling building materials and related goods (“Shops”) use it to give reward points to their customers, such as carpenters, painters, contractors and other professionals (“Customers”), and to let them redeem those points. We provide the software, the app, SMS messages and support. We do not sell goods, set prices, hold money for Shops or Customers, or take part in sales between them.</p>
      <p>We improve the Service regularly and may add, change or remove features. If we remove something a Shop relies on and has paid for, we will give reasonable notice where we can.</p>

      <H n={3}>Accounts</H>
      <ul>
        <li>You sign in with your mobile number and a one-time password (OTP). Keep your phone and OTPs private; you are responsible for activity under your account.</li>
        <li>Give accurate details, including your name, work type, city and, for Shops, the shop’s legal name, address and location. Shops are checked and approved by us before going live, and we may refuse or remove a registration.</li>
        <li>Shop owners decide which staff get access and what each can do. Owners are responsible for their staff’s actions in the Service. Remove staff access as soon as it should end.</li>
        <li>Tell us straight away at <a href={`mailto:${C.supportEmail}`}>{C.supportEmail}</a> if you think your account has been misused.</li>
      </ul>

      <H n={4}>Points: how they work</H>
      <div className="short"><b>In short:</b> points are a reward from the Shop that gave them. They can be used only at that Shop, on that Shop’s rules. They are not money and are not issued by us.</div>
      <ul>
        <li><b>Issued by the Shop.</b> Each Shop decides how many points a bill earns (for example a % of the bill, bill-amount ranges, offers and bonus products), what one point is worth at that Shop, the minimum and maximum to redeem, how redemptions are paid (cash, UPI or a gift) and when points expire. The app shows each Shop’s current rules.</li>
        <li><b>Only at the same Shop.</b> Points earned at one Shop cannot be used at, moved to or combined with another Shop, another Customer or {C.brand} itself.</li>
        <li><b>Not money.</b> Points are a promotional reward. They are not a deposit, a prepaid payment instrument, a wallet balance, a security or legal tender, have no value outside the Shop that issued them, and cannot be bought, sold or exchanged for money with us.</li>
        <li><b>Rule changes.</b> A Shop may change its rules for future bills. Points already earned keep the value and expiry they had when earned, unless the Shop closes, the points were given by mistake or the law requires otherwise.</li>
        <li><b>Expiry.</b> If a Shop sets an expiry, points expire on the date shown in the app. We remind Customers by SMS or in the app where we can.</li>
        <li><b>Mistakes.</b> A Shop may reverse points given in error (for example a wrong bill amount). Every reversal is recorded with a reason.</li>
        <li><b>If a Shop stops.</b> If a Shop’s plan ends, it can no longer give new points, but Customers can still ask that Shop to pay out the points they hold. If a Shop closes for good, we will tell its Customers through the app or SMS. We are not liable for points a Shop does not honour, but we will help Customers raise it with the Shop.</li>
      </ul>

      <H n={5}>Rules for shops</H>
      <ul>
        <li>Give points only for real purchases, at the rules you have set, and record the correct bill amount and invoice number.</li>
        <li>Honour redemptions for points you issued, at the value and method shown in the app, while you have Customers holding points with you.</li>
        <li>Do not ask Customers to pay to receive or redeem points, and do not use points to give anything unlawful or anything that breaks tax or GST rules. You are responsible for your own invoices, taxes and accounting, including any tax on rewards you give.</li>
        <li>Use Customer details only to run your loyalty programme and serve that Customer. Do not sell them or share them with others. Send SMS only through the Service and only about your shop, your offers and the Customer’s points.</li>
        <li>Keep your listed gifts, products, stock and prices accurate.</li>
      </ul>

      <H n={6}>Payouts and disputes</H>
      <ul>
        <li>When a Customer redeems, the points are held. The Shop pays (cash, UPI or gift) and marks it paid. The redemption is complete when the Customer taps <b>Received</b> in the app or gives the one-time code sent by SMS.</li>
        <li>If the Customer taps <b>Not received yet</b>, or does not confirm in time, the redemption goes to our team. We may ask both sides for proof (for example a UPI reference) and decide, on the information we have, whether to close it as received or return the points. Our decision is about the points record in the Service; it does not decide any legal claim between the Shop and the Customer.</li>
        <li>Payments between Shops and Customers do not pass through us. We are not responsible for the money or goods themselves.</li>
      </ul>

      <H n={7}>Rules for customers</H>
      <ul>
        <li>The app is free for Customers.</li>
        <li>Your My QR code changes regularly. Show it only at the Shop counter, and do not share screenshots of it or the SMS codes we send you.</li>
        <li>Do not try to earn points for purchases you did not make, use another person’s account, or create several accounts.</li>
        <li>Tap <b>Received</b> only when you actually received the payment or gift.</li>
      </ul>

      <H n={8}>Products, offers and ads</H>
      <p>Shops list gifts and products, and run offers, through the Service. Shops are responsible for these listings, their stock and their accuracy. Product details are information only: the app does not take orders or payments for goods.</p>
      <p>The Home screen of the app may show banners from brands, from Shops and from {C.brand}. Banners requested by Shops are paid and reviewed by us before they run. We may decline, pause or remove any banner, for example if it is misleading, unlawful or about something other than the advertiser’s own business. Advertisers are responsible for what their banners say.</p>

      <H n={9}>Plans, payments and refunds</H>
      <ul>
        <li><b>Free trial.</b> A new Shop gets a free trial from the day we approve it. The length is shown on our website and in the dashboard.</li>
        <li><b>Plans.</b> After the trial, a Shop pays a monthly plan, which sets things like the number of staff logins and the SMS included. Extra SMS can be bought in packs. Prices are in Indian rupees; GST is added where it applies and shown at checkout.</li>
        <li><b>Payment.</b> Payments are processed by Razorpay. Plans are paid in advance for one month at a time and do not renew automatically; we remind you before the end of each month.</li>
        <li><b>Late payment.</b> If a plan is not renewed, the Shop gets 7 days of grace. After that the Shop becomes read-only: it cannot give new points, add customers, start offers or send SMS, but it can still pay out points to Customers.</li>
        <li><b>Price changes.</b> We may change prices for the future with at least 15 days’ notice on our website or in the dashboard. A month already paid is not affected.</li>
        <li><b>Refunds</b> are covered by our <Link href="/refunds/">Refund and cancellation policy</Link>.</li>
      </ul>

      <H n={10}>Acceptable use</H>
      <p>Do not use the Service to:</p>
      <ul>
        <li>create fake bills, points or redemptions, launder money, evade tax, or deceive Customers or Shops;</li>
        <li>send spam, or messages that are unlawful, hateful, harassing or unrelated to the Shop’s business;</li>
        <li>list or advertise goods that are illegal or that you have no right to sell;</li>
        <li>impersonate anyone, or register a shop you do not own or run;</li>
        <li>break, overload, probe or get around the security of the Service, or access accounts or data that are not yours;</li>
        <li>copy, resell or rebuild the Service, or reverse engineer it except where the law allows.</li>
      </ul>
      <p>We may remove content, reverse entries made in breach of these terms, or suspend an account that breaks these rules, and we cooperate with lawful requests from authorities.</p>

      <H n={11}>Availability</H>
      <p>We work to keep the Service running, but it depends on mobile networks, SMS operators, phones and other things outside our control. We do not promise that it will be uninterrupted or error-free. We may pause the Service for maintenance and will try to do so outside shop hours.</p>

      <H n={12}>Our rights</H>
      <p>The Service, its software, design and the {C.brand} name and logo belong to us or our licensors. These terms give you a limited, non-exclusive, non-transferable right to use the Service while your account is active. Shops keep the rights to their own names, logos and product photos and let us show them in the Service. If you send us feedback, we may use it without any obligation to you.</p>

      <H n={13}>Suspension and closing an account</H>
      <p>You can stop using the Service and ask us to delete your account at any time (see <Link href="/delete-account/">how to delete your data</Link>). A Shop that closes its account should first pay out points its Customers hold. We may suspend or close an account if you break these terms, do not pay, put the Service or others at risk, or if the law requires it. Where it is reasonable we will warn you first and explain why. Sections 4, 6, 9 and 14 to 17 continue after an account is closed.</p>

      <H n={14}>Disclaimers</H>
      <p>The Service is provided “as is” and “as available”. To the extent the law allows, we disclaim all warranties not stated in these terms, including fitness for a particular purpose. Bill amounts, points, products, offers and banners are entered by Shops and advertisers; we do not check them. We are not a party to any sale between a Shop and a Customer.</p>

      <H n={15}>Limitation of liability</H>
      <p>To the extent the law allows, we are not liable for indirect or consequential losses, such as loss of profits, business, goodwill or data, or for losses caused by networks, devices, SMS operators or payment providers. We are not liable for points a Shop issues or fails to honour. Our total liability to you for all claims relating to the Service is limited to the amount you paid us in the 12 months before the event that gave rise to the claim (for Customers, who pay nothing, ₹1,000). Nothing in these terms limits liability that cannot be limited by law.</p>

      <H n={16}>Indemnity</H>
      <p>You will compensate us for reasonable losses and costs, including legal fees, arising from claims by others that your use of the Service, your listings, banners or messages, or the points you issued broke the law, these terms or someone else’s rights.</p>

      <H n={17}>Law and disputes</H>
      <p>These terms are governed by the laws of India. Before going to court, contact us and we will try in good faith to resolve the issue within 30 days. The courts at {C.jurisdiction} have exclusive jurisdiction, subject to any rights you have under consumer protection law to bring a claim where you live.</p>

      <H n={18}>Changes to these terms</H>
      <p>We may update these terms. We will post the new version here with a new date and, for material changes, tell you by SMS or in the app at least 15 days before they apply. If you keep using the Service after that, the new terms apply; if you do not agree, stop using the Service and ask us to close your account.</p>

      <H n={19}>Contact and grievances</H>
      <p>Questions about these terms: <a href={`mailto:${C.supportEmail}`}>{C.supportEmail}</a>.</p>
      <p>Under the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 and the Consumer Protection (E-Commerce) Rules, 2020, complaints can be sent to our Grievance Officer: {C.grievanceOfficer}, {C.legalName}, {C.address}, <a href={`mailto:${C.supportEmail}`}>{C.supportEmail}</a>. We acknowledge complaints within 24 hours (48 hours for consumer complaints) and aim to resolve them within 15 days.</p>
    </LegalPage>
  );
}
