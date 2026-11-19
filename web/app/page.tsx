import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  Armchair, BadgeCheck, BarChart3, BrickWall, Building2, Check, DraftingCompass, Flame, Gift, Grid3x3, HandCoins, Hammer, HardHat,
  Languages, Layers, Megaphone, MessageSquareText, PaintRoller, QrCode, ShieldCheck, Smartphone, Sparkles, Store, Trophy, Users, Wrench, Zap,
} from 'lucide-react';
import { SiteFooter, SiteHeader } from '@/components/site';
import { Pricing } from '@/components/site-pricing';
import { AudienceTabs, CountUp, PointsCalculator, Reveal } from '@/components/site-motion';
import { ArtIncome, ArtRespect, ArtShopGrowth, HeroScene, Rangoli } from '@/components/site-art';

export const metadata: Metadata = {
  title: 'Mere Points: Har bill pe points, har Site Expert ki kadar',
  description: 'Loyalty points for building-material shops and the carpenters, painters, contractors and Site Experts who buy there. Points on every bill, redeemed at the same dukaan. 30 days free.',
};

type Icon = typeof Store;
const TRADES: [Icon, string, string, string][] = [
  [Hammer, 'Carpenter', 'बढ़ई', 'Ply, laminate, hardware: har sheet pe points'],
  [PaintRoller, 'Painter', 'पेंटर', 'Paint buckets pe bonus points'],
  [HardHat, 'Contractor', 'ठेकेदार', 'Bada bill, zyada %: slab ke hisaab se'],
  [Wrench, 'Plumber', 'प्लंबर', 'Pipes aur fittings ki har kharidari'],
  [Zap, 'Electrician', 'इलेक्ट्रीशियन', 'Wire, switch, MCB: sab pe points'],
  [BrickWall, 'Mason', 'राज मिस्त्री', 'Cement, sariya, construction material'],
  [Grid3x3, 'Tile fitter', 'टाइल फिटर', 'Tiles aur adhesive pe offers'],
  [Layers, 'POP & false ceiling', 'पीओपी', 'Boards, channels, POP powder'],
  [Flame, 'Welder / fabricator', 'वेल्डर', 'Steel, rods aur gas'],
  [Armchair, 'Kitchen & wardrobe', 'किचन फिटर', 'Hinges, channels, handles'],
  [DraftingCompass, 'Interior designer', 'इंटीरियर डिज़ाइनर', 'Client ke liye kharido, points aapke'],
  [Building2, 'Builder / supervisor', 'बिल्डर', 'Poori site ka maal, ek jagah points'],
];

function Section({ id, eyebrow, title, sub, children, tone = 'cream', className = '' }: { id?: string; eyebrow?: string; title: ReactNode; sub?: ReactNode; children: ReactNode; tone?: 'cream' | 'white' | 'forest'; className?: string }) {
  const bg = tone === 'forest' ? 'bg-forest text-white jaali-dark' : tone === 'white' ? 'bg-white' : 'bg-cream';
  return (
    <section id={id} className={`scroll-mt-16 py-20 md:py-24 ${bg} ${className}`}>
      <div className="mx-auto max-w-6xl px-5">
        <Reveal className="mx-auto mb-12 max-w-2xl text-center">
          {eyebrow && <p className={`mb-2 text-sm font-extrabold uppercase tracking-[0.18em] ${tone === 'forest' ? 'text-haldi' : 'text-gold'}`}>{eyebrow}</p>}
          <h2 className={`text-3xl font-extrabold leading-tight tracking-tight md:text-[42px] ${tone === 'forest' ? 'text-white' : 'text-soil'}`}>{title}</h2>
          <Rangoli className="mx-auto mt-4 h-5 w-28" />
          {sub && <p className={`mt-3 text-lg ${tone === 'forest' ? 'text-white/75' : 'text-soil/70'}`}>{sub}</p>}
        </Reveal>
        {children}
      </div>
    </section>
  );
}

function Point({ icon: I, title, children, delay = 0 }: { icon: Icon; title: string; children: ReactNode; delay?: number }) {
  return (
    <Reveal delay={delay} className="group rounded-2xl bg-white p-6 ring-1 ring-forest/10 transition hover:-translate-y-1 hover:shadow-xl hover:shadow-forest/10">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-forest-50 text-forest transition group-hover:bg-forest group-hover:text-haldi"><I size={24} /></span>
      <p className="mt-4 text-[17px] font-bold text-soil">{title}</p>
      <p className="mt-1.5 text-[15px] leading-relaxed text-soil/70">{children}</p>
    </Reveal>
  );
}

const FAQ: [string, string][] = [
  ['Kya points cash jaise hain?', 'Points dukaan ki taraf se inaam hain, paisa nahi. Har dukaan tay karti hai ki 1 point kitne ka hai. Points usi dukaan pe use hote hain jahan mile: cash, UPI ya gift, jaisa dukaan de.'],
  ['Site Experts ko kuch dena padta hai?', 'Nahi. Carpenter, painter, contractor aur sabhi Site Experts ke liye app bilkul free hai. Dukaan 30 din free use karke monthly plan leti hai.'],
  ['Counter pe kitna time lagta hai?', 'Aam taur pe 30 second se kam: QR scan karo (ya mobile number likho), bill amount daalo, ho gaya. Site Expert ko SMS bhi chala jata hai.'],
  ['Payout mein dhokha toh nahi hoga?', 'Jab dukaan payout karti hai, points tab tak hold rehte hain jab tak Site Expert app mein "Received" na dabaye ya SMS code na bataye. "Not received" pe Mere Points team dono se baat karti hai.'],
  ['Bade bill pe zyada points de sakte hain?', 'Haan. Bill ke hisaab se % rakho (jaise ₹10,000 tak 2%, ₹20,000 tak 5%, usse upar 7%), Diwali jaise offers chalao (painters ke liye 2x), aur chune hue products pe bonus points do.'],
  ['Plan khatam ho gaya toh?', '7 din ki grace milti hai. Uske baad dukaan read-only ho jati hai: naye points nahi, lekin Site Experts ke points ka payout chalta rehta hai. Kisi ka kamaya hua nahi doobta.'],
  ['Hindi mein chalta hai?', 'Haan, app English aur Hindi dono mein hai. Aur bhi Indian bhashayein jaldi aa rahi hain.'],
];

export default function Home() {
  return (
    <div className="bg-cream text-[15px] text-soil">
      <SiteHeader />

      {/* ------------------------------------------------ Hero */}
      <section className="relative overflow-hidden bg-cream jaali">
        <div className="pointer-events-none absolute -left-24 top-20 h-72 w-72 rounded-full bg-haldi/25 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-forest/15 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-12 md:grid-cols-[1.05fr_1fr] md:pb-24 md:pt-16">
          <div>
            <Reveal>
              <p className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-sm font-bold text-forest shadow-sm ring-1 ring-forest/15"><Sparkles size={15} className="text-gold" /> Local dukaan aur Site Experts ke liye</p>
            </Reveal>
            <Reveal delay={100}>
              <h1 className="mt-5 text-[40px] font-black leading-[1.05] tracking-tight text-soil md:text-[64px]">
                Har bill pe points.<br /><span className="text-forest">Har Site Expert</span> ki <span className="mp-shine">kadar.</span>
              </h1>
            </Reveal>
            <Reveal delay={200}>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-soil/75">
                Carpenter, painter, contractor, plumber: jo bhi aapki dukaan se maal leta hai, use har bill pe points milte hain, aur woh unhe <b>aapki hi dukaan</b> pe cash, UPI ya gift mein badalta hai. Aapko milte hain wapas aane wale customers.
              </p>
              <p className="mt-2 text-lg font-bold text-forest">हर बिल पर पॉइंट, इनाम आपकी ही दुकान पर।</p>
            </Reveal>
            <Reveal delay={300} className="mt-8 flex flex-wrap gap-3">
              <Link href="/get-started/" className="inline-flex h-13 items-center rounded-xl bg-forest px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-forest/25 transition hover:-translate-y-0.5 hover:bg-forest-dark">Apni dukaan register karein</Link>
              <a href="#kaise" className="inline-flex items-center rounded-xl bg-white px-6 py-3.5 text-base font-bold text-forest ring-1 ring-forest/20 transition hover:ring-forest/50">Kaise kaam karta hai</a>
            </Reveal>
            <Reveal delay={400} className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-soil/60">
              <span className="flex items-center gap-1.5"><Check size={16} className="text-forest" /> 30 din free</span>
              <span className="flex items-center gap-1.5"><Check size={16} className="text-forest" /> Site Experts ke liye hamesha free</span>
              <span className="flex items-center gap-1.5"><Check size={16} className="text-forest" /> Hindi + English</span>
            </Reveal>
          </div>
          <Reveal delay={150} dir="r"><HeroScene className="mx-auto w-full max-w-[560px] drop-shadow-xl" /></Reveal>
        </div>

        {/* trades marquee */}
        <div className="relative border-y border-forest/15 bg-forest py-3.5 text-white">
          <div className="flex w-max mp-marquee">
            {[0, 1].map((k) => (
              <div key={k} className="flex shrink-0 items-center" aria-hidden={k === 1}>
                {TRADES.map(([I, en, hi]) => (
                  <span key={en + k} className="mx-5 flex items-center gap-2 whitespace-nowrap text-[15px] font-semibold">
                    <I size={18} className="text-haldi" /> {en} <span className="text-white/55">· {hi}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Community first */}
      <Section id="community" tone="white" eyebrow="Community ke saath, community ke liye" title={<>Hum aapki community ko <span className="text-forest">aage badhate</span> hain</>} sub="Building-material ka kaam rishton pe chalta hai: dukaandaar aur uske Site Experts. Mere Points us rishte ko mazboot karta hai.">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            [<ArtIncome key="a" />, 'Extra kamaai', 'Site Experts ke liye', 'Jo maal aap client ke liye kharidte ho, uspe har bill pe points. Points usi dukaan pe cash, UPI ya gift mein. Jitna zyada kaam, utni zyada kamaai.'],
            [<ArtRespect key="b" />, 'Izzat aur pehchaan', 'Site Experts ke liye', 'Silver, Gold, Platinum: kharidari ke saath level badhta hai, har level pe naye fayde. Dukaan ko pata hai kaun uska sabse bharosemand Site Expert hai.'],
            [<ArtShopGrowth key="c" />, 'Local dukaan, badhta vyapar', 'Dukaan ke liye', 'Bade chains aur online se muqabla, apne regular customers ke dum pe. Wohi Site Experts baar baar aate hain, bill bade hote hain, aur sab record app mein.'],
          ].map(([art, t, who, s], i) => (
            <Reveal key={t as string} delay={i * 140} className="flex flex-col rounded-3xl bg-cream p-7 ring-1 ring-forest/10">
              {art}
              <p className="mt-4 text-xs font-extrabold uppercase tracking-wider text-gold">{who}</p>
              <p className="mt-1 text-2xl font-extrabold text-soil">{t}</p>
              <p className="mt-2 leading-relaxed text-soil/70">{s}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-10 grid gap-4 rounded-3xl bg-forest p-7 text-white jaali-dark sm:grid-cols-3 md:p-9">
          {[
            [<CountUp key="1" to={9000} prefix="₹" />, 'saal ki extra kamaai', 'painter jo har mahine ₹15,000 ki kharidari kare (5% pe)'],
            [<CountUp key="2" to={30} suffix=" sec" />, 'counter pe', 'QR scan, bill amount, ho gaya'],
            [<CountUp key="3" to={0} prefix="₹" />, 'Site Experts ka kharcha', 'app hamesha free'],
          ].map(([n, t, s], i) => (
            <div key={i} className={`px-2 ${i ? 'sm:border-l sm:border-white/15 sm:pl-6' : ''}`}>
              <p className="text-4xl font-black text-haldi">{n}</p>
              <p className="mt-1 font-bold">{t as string}</p>
              <p className="text-sm text-white/65">{s as string}</p>
            </div>
          ))}
        </Reveal>
      </Section>

      {/* ------------------------------------------------ How it works */}
      <Section id="kaise" eyebrow="Kaise kaam karta hai" title="Counter pe sirf 3 kadam" sub="Koi machine nahi khareedni. Koi bhi Android ya iPhone, ya counter ke computer pe web dashboard.">
        <div className="relative grid gap-6 md:grid-cols-3">
          <svg className="pointer-events-none absolute left-0 top-12 hidden h-10 w-full md:block" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden>
            <path d="M160 20 C 330 -10, 420 50, 500 20 S 690 -10, 840 20" stroke="#C98500" strokeWidth="3" strokeDasharray="8 10" fill="none" />
          </svg>
          {[
            [QrCode, '1', 'Site Expert My QR dikhaye', 'Ya apna mobile number bataye. Naya customer counter pe hi kuch second mein jud jata hai.'],
            [Store, '2', 'Aap bill amount daalein', 'Points aapke rules se: bill ke hisaab se %, chalu offers aur bonus products. SMS turant.'],
            [HandCoins, '3', 'Points se inaam lein', 'Points poore hone pe cash, UPI ya gift. Site Expert "Received" dabaye, tab payout pakka.'],
          ].map(([I, n, t, s], i) => {
            const Ic = I as Icon;
            return (
              <Reveal key={n as string} delay={i * 160} className="relative rounded-3xl bg-white p-7 text-center ring-1 ring-forest/10">
                <span className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-haldi/20">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-forest text-haldi"><Ic size={26} /></span>
                  <span className="absolute -right-1 -top-1 flex h-8 w-8 items-center justify-center rounded-full bg-terracotta text-sm font-black text-white ring-4 ring-white">{n as string}</span>
                </span>
                <p className="mt-5 text-xl font-extrabold">{t as string}</p>
                <p className="mt-2 leading-relaxed text-soil/70">{s as string}</p>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* ------------------------------------------------ Calculator */}
      <Section tone="white" eyebrow="Khud dekhiye" title="Kitna milega?" sub="Bill amount aur kharidari chuniye: Site Expert ko kitne points milenge, aur saal bhar mein kitna.">
        <Reveal><PointsCalculator /></Reveal>
      </Section>

      {/* ------------------------------------------------ Shop / Site Expert */}
      <Section id="fayde" eyebrow="Fayde" title="Dukaan ko bhi, Site Expert ko bhi" sub="Ek hi app, dono ke liye. Dekhiye kisko kya milta hai.">
        <AudienceTabs
          shop={
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Point icon={Layers} title="Bill ke hisaab se %">Sab bills pe ek %, ya range: ₹10,000 tak 2%, ₹20,000 tak 5%, usse upar 7%. 1 point ki value bhi aap tay karein.</Point>
              <Point icon={Sparkles} title="Offers jo wapas laayein" delay={80}>Diwali week mein 1.5x ya 2x points, sabke liye ya sirf painters, carpenters ya contractors ke liye.</Point>
              <Point icon={Gift} title="Gifts aur bonus products" delay={160}>Points se milne wale gifts rakhein, aur chune products pe extra points, jaise har ply sheet pe +40.</Point>
              <Point icon={ShieldCheck} title="Surakshit payout">Site Expert confirm kare tabhi payout pakka. Staff ke manual points pe roz ki limit.</Point>
              <Point icon={Users} title="Staff ke alag login" delay={80}>Counter staff ko sirf utna access jitna zaroori: points add, payout, ya manual bonus.</Point>
              <Point icon={BarChart3} title="Poori report" delay={160}>Points wali bikri, best customers, staff ka kaam. CSV download karke CA ko bhejein.</Point>
              <Point icon={MessageSquareText} title="SMS customers ko">Sabhi painters ko naya offer batayein, ya jinke points expire hone wale hain unhe yaad dilayein.</Point>
              <Point icon={Megaphone} title="App mein apna banner" delay={80}>Aas-paas ke Site Experts ki app ki Home screen pe apni dukaan ka ad. Online pay karein, hum check karke chalayenge.</Point>
              <Point icon={BadgeCheck} title="Simple monthly plan" delay={160}>30 din free. Phir ek monthly price. Plan band ho jaye toh bhi customers apne points le sakte hain.</Point>
            </div>
          }
          expert={
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Point icon={Smartphone} title="Sab dukaanon ke points ek jagah">Har Mere Points dukaan pe kitne points, kitne ke hain, kab expire honge: sab ek app mein.</Point>
              <Point icon={Trophy} title="Levels aur pehchaan" delay={80}>Silver, Gold, Platinum. Har level pe naye fayde, aur dukaan mein aapki alag pehchaan.</Point>
              <Point icon={Gift} title="Kya le sakte ho, turant dikhe" delay={160}>Aapki dukaanon ke gifts, kitne points aur chahiye, aur kin products pe extra points milte hain.</Point>
              <Point icon={HandCoins} title="Cash, UPI ya gift">Points se seedha cash, UPI ya gift: jo dukaan de. Paisa mila tabhi "Received".</Point>
              <Point icon={MessageSquareText} title="Har bill ka SMS" delay={80}>App na bhi kholo, SMS se pata chalta rahega kitne points mile.</Point>
              <Point icon={Languages} title="Hindi mein bhi" delay={160}>App poori Hindi mein bhi chalti hai. Login sirf mobile number aur OTP se.</Point>
            </div>
          }
        />
      </Section>

      {/* ------------------------------------------------ Trades */}
      <Section id="site-experts" tone="forest" eyebrow="Har trade ke liye" title="Har Site Expert ke liye bana hai" sub="Jo bhi site pe kaam karta hai aur building material khareedta hai.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {TRADES.map(([I, en, hi, s], i) => (
            <Reveal key={en} delay={(i % 4) * 70} className="group rounded-2xl bg-white/[0.07] p-5 ring-1 ring-white/10 transition hover:-translate-y-1 hover:bg-white/[0.12]">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-haldi text-forest-dark transition group-hover:rotate-[-8deg] group-hover:scale-110"><I size={22} /></span>
              <p className="mt-3 font-extrabold">{en}</p>
              <p className="text-sm font-semibold text-haldi">{hi}</p>
              <p className="mt-1.5 text-sm leading-snug text-white/65">{s}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------ Example stories (clearly labelled) */}
      <Section eyebrow="Aise kaam aata hai" title="Teen kahaniyan, ek jaisi jeet" sub="Ye udaharan hain: asli app ke rules aur hisaab se. Pehli dukaanein live hone ke baad hum yahan asli logon ki baatein lagayenge.">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            ['Plywood & hardware dukaan, Gurugram', Store, 'Dukaan ne 2% / 5% / 7% ki range rakhi aur Diwali mein painters ke liye 2x offer chalaya. Har ply sheet pe +40 bonus points rakhe.', 'Regular Site Experts ab doosri dukaan ke bajaye yahin se poora order lete hain, kyunki points yahin jud rahe hain.'],
            ['Painter, roz ka kaam', PaintRoller, 'Har mahine ₹15,000 ka paint aur saaman, 5% wali range mein: har bill pe 750 points.', 'Saal mein ₹1,80,000 ki kharidari pe ₹9,000 ke points, aur Gold level. Points UPI mein seedha.'],
            ['Contractor, badi site', HardHat, 'Ek site ka ₹45,000 ka bill: 7% wali range mein 3,150 points.', 'Points se drill machine li. Har kharidari ka SMS aata hai, toh hisaab saaf rehta hai.'],
          ].map(([who, I, a, b], i) => {
            const Ic = I as Icon;
            return (
              <Reveal key={who as string} delay={i * 140} className="relative flex flex-col rounded-3xl bg-white p-7 ring-1 ring-forest/10">
                <span className="absolute right-5 top-5 rounded-full bg-cream px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-soil/60">Example</span>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-forest text-haldi"><Ic size={22} /></span>
                <p className="mt-4 text-lg font-extrabold">{who as string}</p>
                <p className="mt-2 leading-relaxed text-soil/70">{a as string}</p>
                <p className="mt-3 rounded-xl bg-forest-50 p-3 text-[15px] font-semibold leading-relaxed text-forest-dark">{b as string}</p>
              </Reveal>
            );
          })}
        </div>
      </Section>

      {/* ------------------------------------------------ Pricing */}
      <Section id="pricing" tone="white" eyebrow="Pricing" title="Dukaan ke liye ek plan. Site Experts ke liye free." sub="Rupees mein, GST alag. 30 din bilkul free, card ki zaroorat nahi.">
        <Pricing />
      </Section>

      {/* ------------------------------------------------ FAQ */}
      <Section id="sawaal" eyebrow="Aapke sawaal" title="Jaaniye pehle">
        <div className="mx-auto max-w-3xl space-y-3">
          {FAQ.map(([q, a], i) => (
            <Reveal key={q} delay={i * 50}>
              <details className="group rounded-2xl bg-white px-6 py-5 ring-1 ring-forest/10 open:ring-forest/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-bold">
                  {q}<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cream text-xl text-forest transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 leading-relaxed text-soil/70">{a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------ CTA */}
      <section className="relative overflow-hidden bg-forest-dark jaali-dark">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-haldi/20 blur-3xl" />
        <div className="relative mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-8 px-5 py-16">
          <Reveal>
            <p className="text-3xl font-black tracking-tight text-white md:text-4xl">Apne Site Experts ko <span className="text-haldi">inaam dena</span> aaj se shuru karein.</p>
            <p className="mt-2 text-lg text-white/70">Register karein, apna % set karein, aur pehla bill aaj hi.</p>
          </Reveal>
          <Reveal delay={150} className="flex flex-wrap gap-3">
            <Link href="/get-started/" className="inline-flex items-center rounded-xl bg-haldi px-6 py-3.5 text-base font-black text-forest-dark shadow-lg shadow-black/20 transition hover:-translate-y-0.5">Apni dukaan register karein</Link>
            <Link href="/contact/" className="inline-flex items-center rounded-xl px-6 py-3.5 text-base font-bold text-white ring-1 ring-white/30 hover:bg-white/10">Humse baat karein</Link>
          </Reveal>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
