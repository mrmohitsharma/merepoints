import type { CSSProperties } from 'react';

/**
 * Hand-drawn style illustrations for the website (plain SVG, no image files).
 * Colours follow the logo: forest green, haldi yellow, gold, cream, terracotta.
 */
const G = '#2E5E3A', GD = '#1D4229', H = '#F4AA04', AU = '#C98500', CR = '#FBF5E6', TC = '#B5532A', SO = '#2A2117';

/** Marigold toran (bunting) across the top of a shop. */
function Toran({ x, y, w, n }: { x: number; y: number; w: number; n: number }) {
  const step = w / n;
  return (
    <g className="mp-swing" style={{ transformOrigin: `${x + w / 2}px ${y}px` }}>
      <path d={`M${x} ${y} Q ${x + w / 2} ${y + 16} ${x + w} ${y}`} stroke={GD} strokeWidth="2" fill="none" />
      {Array.from({ length: n }, (_, i) => {
        const cx = x + step * (i + 0.5);
        const cy = y + 16 * 4 * ((i + 0.5) / n) * (1 - (i + 0.5) / n) + 3;
        return (
          <g key={i}>
            <circle cx={cx} cy={cy + 6} r="6" fill={i % 2 ? H : '#F08A00'} />
            <circle cx={cx} cy={cy + 6} r="2.4" fill={i % 2 ? '#F08A00' : H} />
            <path d={`M${cx - 4} ${cy + 12} l4 8 l4 -8z`} fill={G} />
          </g>
        );
      })}
    </g>
  );
}

/** Hero: a local hardware shop counter. A bill prints, points fly into the Site Expert's phone. */
export function HeroScene({ className = '' }: { className?: string }) {
  const coins = [
    { dx: '150px', dy: '-60px', d: '1.3s' }, { dx: '160px', dy: '-90px', d: '1.55s' }, { dx: '140px', dy: '-75px', d: '1.8s' },
    { dx: '155px', dy: '-50px', d: '2.05s' }, { dx: '165px', dy: '-80px', d: '2.3s' },
  ];
  return (
    <svg viewBox="0 0 560 470" className={className} role="img" aria-label="A Site Expert gets points on his bill at a local hardware shop">
      {/* sun / ground */}
      <circle cx="455" cy="88" r="58" fill={H} opacity=".22" />
      <g className="mp-spin-slow" style={{ transformOrigin: '455px 88px' }}>
        {Array.from({ length: 12 }, (_, i) => <rect key={i} x="452" y="14" width="6" height="16" rx="3" fill={H} opacity=".5" transform={`rotate(${i * 30} 455 88)`} />)}
      </g>
      <ellipse cx="280" cy="448" rx="260" ry="14" fill={SO} opacity=".08" />

      {/* shop building */}
      <rect x="40" y="96" width="330" height="340" rx="10" fill={CR} stroke={GD} strokeWidth="3" />
      {/* signboard */}
      <rect x="58" y="62" width="294" height="54" rx="8" fill={G} />
      <text x="205" y="86" textAnchor="middle" fontSize="17" fontWeight="800" fill={CR} fontFamily="Inter, sans-serif" letterSpacing="1">SHARMA HARDWARE &amp; PLY</text>
      <text x="205" y="106" textAnchor="middle" fontSize="13" fontWeight="700" fill={H} fontFamily="'Noto Sans Devanagari', sans-serif">शर्मा हार्डवेयर एंड प्लाई</text>
      {/* awning */}
      <g>
        {Array.from({ length: 11 }, (_, i) => (
          <path key={i} d={`M${40 + i * 30} 126 h30 v22 q-15 14 -30 0z`} fill={i % 2 ? H : G} />
        ))}
      </g>
      <Toran x={52} y={160} w={306} n={13} />

      {/* shelves: ply sheets, paint buckets, pipes */}
      <rect x="62" y="196" width="138" height="150" rx="4" fill="#F3E7C9" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={70 + i * 25} y="206" width="20" height="132" rx="2" fill={['#D9A86C', '#C8925A', '#E2B77D', '#BF8650', '#D3A06A'][i]} />)}
      <rect x="214" y="196" width="138" height="70" rx="4" fill="#F3E7C9" />
      {[[232, TC], [272, G], [312, '#2B6CB0']].map(([x, c]) => (
        <g key={x as number}>
          <rect x={(x as number) - 15} y="214" width="32" height="40" rx="4" fill={c as string} />
          <rect x={(x as number) - 15} y="210" width="32" height="7" rx="3" fill={SO} opacity=".55" />
          <rect x={(x as number) - 9} y="226" width="20" height="12" rx="2" fill={CR} opacity=".85" />
        </g>
      ))}
      <rect x="214" y="276" width="138" height="70" rx="4" fill="#F3E7C9" />
      {[0, 1, 2, 3].map((i) => <rect key={i} x="224" y={286 + i * 14} width="118" height="8" rx="4" fill={['#9AA7B3', '#B7C1CA', '#8C99A6', '#A9B4BE'][i]} />)}

      {/* counter */}
      <rect x="40" y="350" width="330" height="86" rx="8" fill={G} />
      <rect x="40" y="350" width="330" height="14" rx="6" fill={GD} />
      {Array.from({ length: 6 }, (_, i) => <path key={i} d={`M${70 + i * 52} 392 l10 -10 l10 10 l-10 10z`} fill={H} opacity=".55" />)}

      {/* billing machine + printing bill */}
      <rect x="150" y="318" width="86" height="40" rx="6" fill={SO} />
      <rect x="160" y="326" width="40" height="12" rx="2" fill="#7BE0A8" opacity=".9" />
      <g className="mp-print">
        <rect x="160" y="270" width="66" height="56" rx="3" fill="#fff" stroke="#E3DCC8" />
        <rect x="168" y="279" width="38" height="4" rx="2" fill="#C9C2B0" />
        <rect x="168" y="288" width="50" height="4" rx="2" fill="#C9C2B0" />
        <text x="193" y="315" textAnchor="middle" fontSize="13" fontWeight="800" fill={SO} fontFamily="Inter, sans-serif">₹12,000</text>
      </g>

      {/* flying points */}
      {coins.map((c, i) => (
        <g key={i} className="mp-coin" style={{ '--dx': c.dx, '--dy': c.dy, animationDelay: c.d } as CSSProperties}>
          <circle cx="232" cy="300" r="11" fill={H} stroke={AU} strokeWidth="2.5" />
          <text x="232" y="304.5" textAnchor="middle" fontSize="11" fontWeight="900" fill={AU} fontFamily="Inter, sans-serif">P</text>
        </g>
      ))}

      {/* Site Expert (painter) with phone */}
      <g>
        <rect x="392" y="300" width="66" height="136" rx="26" fill="#3B6FB0" />
        <rect x="404" y="330" width="42" height="60" rx="6" fill="#2E5C94" />
        <circle cx="425" cy="270" r="30" fill="#B9784B" />
        <path d="M393 262 q32 -40 64 0 v-6 q-32 -26 -64 0z" fill={H} />
        <rect x="390" y="256" width="72" height="9" rx="4" fill={AU} />
        <circle cx="414" cy="274" r="3" fill={SO} /><circle cx="436" cy="274" r="3" fill={SO} />
        <path d="M414 288 q11 8 22 0" stroke={SO} strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M418 284 q7 3 14 0" stroke="#7A4A2B" strokeWidth="5" fill="none" strokeLinecap="round" />
        {/* paint roller on shoulder */}
        <g transform="translate(-26 56)"><g className="mp-float" style={{ '--r': '-8deg' } as CSSProperties}>
          <rect x="470" y="236" width="8" height="70" rx="4" fill={SO} transform="rotate(-20 474 271)" />
          <rect x="448" y="214" width="56" height="22" rx="10" fill={TC} transform="rotate(-20 476 225)" />
        </g></g>
        {/* arm + phone */}
        <path d="M398 330 q-22 -6 -26 -44" stroke="#3B6FB0" strokeWidth="18" strokeLinecap="round" fill="none" />
        <rect x="352" y="208" width="48" height="84" rx="9" fill={SO} />
        <rect x="356" y="215" width="40" height="70" rx="5" fill="#fff" />
        <rect x="356" y="215" width="40" height="16" rx="5" fill={G} />
        <g className="mp-pop" style={{ animationDelay: '0s' }}>
          <text x="376" y="252" textAnchor="middle" fontSize="15" fontWeight="900" fill={G} fontFamily="Inter, sans-serif">+600</text>
          <text x="376" y="266" textAnchor="middle" fontSize="8" fontWeight="700" fill="#5E6B78" fontFamily="Inter, sans-serif">points</text>
        </g>
        <rect x="363" y="273" width="26" height="6" rx="3" fill={H} />
      </g>

      {/* diya on the counter */}
      <g transform="translate(92 334)">
        <path d="M-16 0 q16 14 32 0 z" fill={TC} />
        <ellipse cx="0" cy="0" rx="16" ry="4" fill="#8E3D1C" />
        <path className="mp-flame" d="M0 -16 q6 8 0 14 q-6 -6 0 -14z" fill={H} />
      </g>
      {/* tools floating */}
      <g className="mp-float" style={{ animationDelay: '.8s', '--r': '12deg' } as CSSProperties}>
        <rect x="500" y="330" width="10" height="56" rx="4" fill="#8B5A2B" />
        <rect x="486" y="322" width="38" height="16" rx="4" fill="#7A8794" />
      </g>
      <g className="mp-float" style={{ animationDelay: '1.6s' } as CSSProperties}>
        <path d="M12 250 l22 -10 l6 14 l-22 10z" fill={H} />
        <circle cx="22" cy="252" r="3" fill={SO} />
      </g>
    </svg>
  );
}

/** Pillar 1: extra kamaai: coin stacks rising. */
export function ArtIncome() {
  return (
    <svg viewBox="0 0 200 140" className="h-36 w-full" aria-hidden>
      <ellipse cx="100" cy="128" rx="80" ry="8" fill={SO} opacity=".07" />
      {[[50, 3], [90, 5], [130, 7]].map(([x, n], j) => (
        <g key={x} className="bar" style={{ animationDelay: `${j * 180}ms` }}>
          {Array.from({ length: n }, (_, i) => (
            <g key={i}>
              <ellipse cx={x} cy={120 - i * 11} rx="17" ry="6" fill={AU} />
              <ellipse cx={x} cy={117 - i * 11} rx="17" ry="6" fill={H} />
            </g>
          ))}
        </g>
      ))}
      <g className="mp-float"><circle cx="168" cy="34" r="16" fill={H} stroke={AU} strokeWidth="3" /><text x="168" y="40" textAnchor="middle" fontSize="16" fontWeight="900" fill={AU}>₹</text></g>
      <path className="draw" d="M30 96 C 70 90, 100 60, 150 40" stroke={G} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M144 34 l10 4 l-6 9" stroke={G} strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Pillar 2: izzat aur pehchaan: level badges appear one by one. */
export function ArtRespect() {
  const lv = [['Silver', '#AEB7C0', 46], ['Gold', H, 100], ['Platinum', '#7FB7A0', 154]] as const;
  return (
    <svg viewBox="0 0 200 140" className="h-36 w-full" aria-hidden>
      {lv.map(([n, c, x], i) => (
        <g key={n} className="badge-in" style={{ animationDelay: `${i * 220}ms` }}>
          <path d={`M${x - 14} ${78} l-8 34 l22 -10 l22 10 l-8 -34z`} fill={i === 1 ? TC : G} />
          <circle cx={x} cy={62} r={i === 1 ? 30 : 24} fill={c} stroke="#fff" strokeWidth="4" />
          <path d={`M${x} ${48} l4 9 l10 1 l-8 6 l3 10 l-9 -6 l-9 6 l3 -10 l-8 -6 l10 -1z`} fill="#fff" opacity=".9" />
          <text x={x} y={132} textAnchor="middle" fontSize="12" fontWeight="800" fill={SO}>{n}</text>
        </g>
      ))}
    </svg>
  );
}

/** Pillar 3: local dukaan, badhta vyapar: a little shop and rising bars. */
export function ArtShopGrowth() {
  return (
    <svg viewBox="0 0 200 140" className="h-36 w-full" aria-hidden>
      <rect x="18" y="56" width="74" height="66" rx="6" fill={CR} stroke={GD} strokeWidth="2.5" />
      {Array.from({ length: 5 }, (_, i) => <path key={i} d={`M${18 + i * 15} 56 h15 v12 q-7.5 8 -15 0z`} fill={i % 2 ? H : G} />)}
      <rect x="34" y="86" width="22" height="36" rx="2" fill={G} />
      <rect x="62" y="84" width="20" height="16" rx="2" fill={H} opacity=".7" />
      {[[112, 34, G], [136, 56, AU], [160, 82, G]].map(([x, h, c], i) => (
        <rect key={x as number} className="bar" style={{ animationDelay: `${i * 160}ms` }} x={x as number} y={122 - (h as number)} width="18" height={h as number} rx="4" fill={c as string} />
      ))}
      <path className="draw" d="M108 84 L 130 64 L 152 52 L 178 26" stroke={TC} strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="178" cy="26" r="6" fill={TC} />
    </svg>
  );
}

/** Small rangoli-style divider. */
export function Rangoli({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 24" className={className} aria-hidden>
      <path d="M0 12 H44" stroke={AU} strokeWidth="2" strokeLinecap="round" />
      <path d="M76 12 H120" stroke={AU} strokeWidth="2" strokeLinecap="round" />
      <g transform="translate(60 12)">
        {Array.from({ length: 8 }, (_, i) => <ellipse key={i} cx="0" cy="-6" rx="3" ry="6" fill={i % 2 ? G : H} transform={`rotate(${i * 45})`} />)}
        <circle r="3" fill={TC} />
      </g>
    </svg>
  );
}
