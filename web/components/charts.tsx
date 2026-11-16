'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dayLabel, numShort } from '@/lib/format';

const BLUE = '#0F4C81';
const AMBER = '#F2A007';
const GRID = '#E3E8EE';
const AXIS = { fontSize: 11, fill: '#5E6B78' };

type Series = { key: string; label: string; color?: 'blue' | 'amber' };
const color = (c?: string) => (c === 'amber' ? AMBER : BLUE);

/** Day series (x = 'day' YYYY-MM-DD). Bars for counts, area for trends. */
export function DayChart({ data, series, kind = 'bar', height = 240, money }: { data: any[]; series: Series[]; kind?: 'bar' | 'area'; height?: number; money?: boolean }) {
  const fmt = (v: number) => (money ? '₹' : '') + numShort(v);
  const tip = (
    <Tooltip
      cursor={{ fill: 'rgba(15,76,129,0.06)' }}
      labelFormatter={(d) => dayLabel(String(d))}
      formatter={(v, name) => [fmt(Number(v)), series.find((s) => s.key === name)?.label ?? String(name)]}
      contentStyle={{ borderRadius: 8, border: `1px solid ${GRID}`, fontSize: 12 }}
    />
  );
  const common = { data, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={GRID} />
      <XAxis dataKey="day" tickFormatter={dayLabel} tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
      <YAxis tickFormatter={fmt} tick={AXIS} tickLine={false} axisLine={false} width={52} />
    </>
  );
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        {kind === 'bar' ? (
          <BarChart {...common}>
            {axes}{tip}
            {series.map((s) => <Bar key={s.key} dataKey={s.key} fill={color(s.color)} radius={[3, 3, 0, 0]} maxBarSize={22} />)}
          </BarChart>
        ) : (
          <AreaChart {...common}>
            {axes}{tip}
            {series.map((s) => <Area key={s.key} dataKey={s.key} type="monotone" stroke={color(s.color)} strokeWidth={2} fill={color(s.color)} fillOpacity={0.1} />)}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars for ranked categories (cities, plans). */
export function RankBars({ rows, label, value, money }: { rows: any[]; label: string; value: string; money?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[value]) || 0));
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="truncate font-medium">{r[label]}</span>
            <span className="tabular text-muted">{money ? '₹' : ''}{numShort(r[value])}</span>
          </div>
          <div className="h-2 rounded-full bg-page"><div className="h-2 rounded-full bg-brand" style={{ width: `${(Number(r[value]) / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
