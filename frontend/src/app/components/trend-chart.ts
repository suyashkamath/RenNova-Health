import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DashboardFilters, TrendPoint } from '../models/renewal';
import { RenewalService } from '../services/renewal.service';
import { IconComponent } from './icon';

type Metric = 'due' | 'renewed' | 'pending';
interface XY { x: number; y: number; }

const SERIES: { key: Metric; label: string; color: string }[] = [
  { key: 'due', label: 'Due', color: '#3b82f6' },
  { key: 'renewed', label: 'Renewed', color: '#10b981' },
  { key: 'pending', label: 'Pending', color: '#f43f5e' },
];

@Component({
  selector: 'app-trend-chart',
  standalone: true,
  imports: [IconComponent],
  template: `
    <!-- controls -->
    <div class="ctrl">
      <span class="hint"><span class="pan">↔ Drag to Pan</span><span class="dim">Double-click to reset</span></span>
      <div class="tools">
        <div class="seg">
          <button [class.on]="effBucket() === 'day'" (click)="setTrendBy('day')" title="Daily view">Daily</button>
          <button [class.on]="effBucket() === 'month'" (click)="setTrendBy('month')" title="Monthly view">Monthly</button>
        </div>
        <div class="seg">
          <button [class.on]="chartType() === 'area'" (click)="chartType.set('area')" title="Area chart"><app-icon name="chart-area" [size]="16" /></button>
          <button [class.on]="chartType() === 'bar'" (click)="chartType.set('bar')" title="Bar chart"><app-icon name="chart-column" [size]="16" /></button>
        </div>
        <div class="seg">
          <button (click)="zoom('out')" title="Zoom out">－</button>
          <button (click)="zoom('in')" title="Zoom in">＋</button>
          <button (click)="reset()" title="Reset view">⟲</button>
        </div>
        <div class="legend">
          @for (s of series; track s.key) {
            <button class="chip" [style.--c]="s.color" [class.off]="!visible()[s.key]" (click)="toggle(s.key)">
              <i></i>{{ s.label }}
            </button>
          }
        </div>
      </div>
    </div>

    @if (loading()) {
      <div class="loadwrap">
        <span class="eq"><i></i><i></i><i></i><i></i><i></i></span>
        <span class="loadtxt">Loading trend…</span>
      </div>
    } @else if (displayed().length === 0) {
      <div class="empty">No data for the selected filters.</div>
    } @else {
      <div class="plot" [class.grabbing]="dragging()"
        (mousedown)="down($event)" (mousemove)="move($event)" (mouseup)="up()" (mouseleave)="leave()"
        (dblclick)="reset()">
        <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" class="chart">
          <defs>
            @for (s of series; track s.key) {
              <linearGradient [attr.id]="'grad-' + s.key" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" [attr.stop-color]="s.color" stop-opacity="0.22" />
                <stop offset="95%" [attr.stop-color]="s.color" stop-opacity="0" />
              </linearGradient>
            }
          </defs>

          @for (g of gridlines(); track g.v) {
            <line [attr.x1]="padL" [attr.x2]="W - padR" [attr.y1]="g.y" [attr.y2]="g.y" stroke="#eef0f4" stroke-dasharray="3 3" />
            <text [attr.x]="padL - 8" [attr.y]="g.y + 4" text-anchor="end" class="axis">{{ kfmt(g.v) }}</text>
          }

          @if (chartType() === 'area') {
            @for (s of areaSeries(); track s.key) {
              <path [attr.d]="s.fill" [attr.fill]="'url(#grad-' + s.key + ')'" />
              <path [attr.d]="s.line" fill="none" [attr.stroke]="s.color" stroke-width="2" stroke-linejoin="round" />
            }
          } @else {
            @for (b of bars(); track $index) {
              <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" [attr.fill]="b.color" rx="2" />
            }
          }

          @if (hoverX() !== null) {
            <line [attr.x1]="hoverX()" [attr.x2]="hoverX()" [attr.y1]="padT" [attr.y2]="H - padB" stroke="#cbd5e1" stroke-dasharray="4 4" />
          }

          <!-- divider between the previous period (left) and the current period (right) -->
          @if (dividerX(); as dx) {
            <line [attr.x1]="dx" [attr.x2]="dx" [attr.y1]="padT" [attr.y2]="H - padB" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="5 4" />
            <text [attr.x]="dx - 5" [attr.y]="padT + 9" text-anchor="end" class="divlabel">Last</text>
            <text [attr.x]="dx + 5" [attr.y]="padT + 9" text-anchor="start" class="divlabel">This period</text>
          }

          @for (l of xLabels(); track $index) {
            <text [attr.x]="l.x" [attr.y]="H - 8" [attr.text-anchor]="l.anchor" class="axis">{{ l.t }}</text>
          }
        </svg>

        @if (tip(); as t) {
          <div class="tooltip" [style.left.px]="t.x" [style.top.px]="t.y">
            <div class="tt-date">{{ t.label }}</div>
            @for (r of t.rows; track r.label) {
              <div class="tt-row"><span><i [style.background]="r.color"></i>{{ r.label }}</span><b>{{ r.v.toLocaleString() }}</b></div>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { display:flex; flex-direction:column; min-height:0; }
    .ctrl { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
    .hint { display:flex; align-items:center; gap:8px; }
    .pan { font-size:11px; background:#f9fafb; color:#64748b; padding:4px 8px; border-radius:8px; font-weight:700; }
    .dim { font-size:11px; color:#94a3b8; }
    .tools { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
    .seg { display:flex; background:#f9fafb; border:1px solid var(--border-strong); border-radius:8px; padding:2px; }
    .seg button { border:0; background:transparent; cursor:pointer; font-size:13px; padding:5px 8px; border-radius:6px; color:#64748b; line-height:1; font-weight:800; }
    .seg button:hover { background:#fff; }
    .seg button.on { background:#fff; box-shadow:var(--shadow); color:var(--accent,#6366f1); }
    .legend { display:flex; gap:6px; }
    .chip { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; cursor:pointer; border:1px solid color-mix(in srgb, var(--c) 35%, transparent); background:color-mix(in srgb, var(--c) 10%, transparent); color:var(--c); padding:5px 9px; border-radius:8px; }
    .chip i { width:8px; height:8px; border-radius:50%; background:var(--c); }
    .chip.off { background:#f8fafc; border-color:transparent; color:#94a3b8; opacity:.6; }
    .chip.off i { background:#94a3b8; }
    .plot { position:relative; flex:1; min-height:360px; cursor:grab; user-select:none; }
    .plot.grabbing { cursor:grabbing; }
    .chart { width:100%; height:100%; display:block; }
    .axis { font-size:8.5px; fill:#94a3b8; }
    .divlabel { font-size:8px; font-weight:800; fill:#64748b; text-transform:uppercase; letter-spacing:.04em; }
    .empty { color:var(--muted,#94a3b8); font-size:14px; padding:40px; text-align:center; }
    .loadwrap { flex:1; min-height:280px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; }
    .eq { display:flex; align-items:flex-end; gap:5px; height:42px; }
    .eq i { width:7px; border-radius:4px; background:linear-gradient(180deg, var(--accent,#6366f1), #c7d2fe);
      animation:eq-bounce .9s ease-in-out infinite alternate; }
    .eq i:nth-child(1) { height:40%; animation-delay:0s; }
    .eq i:nth-child(2) { height:75%; animation-delay:.12s; }
    .eq i:nth-child(3) { height:100%; animation-delay:.24s; }
    .eq i:nth-child(4) { height:65%; animation-delay:.36s; }
    .eq i:nth-child(5) { height:85%; animation-delay:.48s; }
    @keyframes eq-bounce { from { transform:scaleY(.35); opacity:.5; } to { transform:scaleY(1); opacity:1; } }
    .loadtxt { font-size:12.5px; font-weight:700; color:var(--muted,#94a3b8); }
    @media (prefers-reduced-motion: reduce) { .eq i { animation:none; } }
    .tooltip { position:fixed; z-index:9999; pointer-events:none; background:#1f2937; color:#e5e7eb; padding:9px 10px; border-radius:10px; box-shadow:0 12px 26px rgba(17,24,39,.24); font-size:11px; width:168px; }
    .tt-date { font-weight:700; color:#fff; margin-bottom:5px; }
    .tt-row { display:flex; justify-content:space-between; gap:14px; align-items:center; }
    .tt-row span { display:flex; align-items:center; gap:6px; white-space:nowrap; }
    .tt-row i { width:8px; height:8px; border-radius:50%; display:inline-block; }
    .tt-row b { color:#fff; }
    @media (max-width:720px) {
      .ctrl { align-items:flex-start; }
      .hint, .tools, .legend { width:100%; }
      .tools { justify-content:flex-start; }
      .legend { flex-wrap:wrap; }
      .plot { min-height:280px; }
    }
  `],
})
export class TrendChartComponent {
  private svc = inject(RenewalService);

  // Period-aware trend: driven by the active filters' `preset`. The backend returns one
  // continuous window = previous comparable period + current period, its `bucket`
  // granularity, and `curFrom` (the divider between "last period" and "this period").
  filters = input<DashboardFilters>({});
  // Manual Daily/Monthly override; null = follow the preset's bucket from the backend.
  trendByOverride = signal<'day' | 'month' | null>(null);
  bucket = signal<'day' | 'month'>('month');   // granularity the backend actually used
  curFrom = signal<string | null>(null);       // start of the current period (divider)
  points = signal<TrendPoint[]>([]);
  loading = signal(true);

  // Effective granularity shown in the Daily/Monthly toggle.
  effBucket = computed<'day' | 'month'>(() => this.trendByOverride() ?? this.bucket());

  readonly series = SERIES;
  readonly W = 760; readonly H = 280;
  readonly padL = 44; readonly padR = 14; readonly padT = 12; readonly padB = 30;
  private get plotW() { return this.W - this.padL - this.padR; }
  private get plotH() { return this.H - this.padT - this.padB; }
  private get baseY() { return this.padT + this.plotH; }

  // Show the whole current+previous window by default (a custom daily range can reach
  // ~184 points); zoom in to narrow.
  readonly DEFAULT_WINDOW = 366;
  chartType = signal<'area' | 'bar'>('area');
  // Pending starts OFF: it's ~= Due (renewal rate is low), so drawing it by default
  // just doubles the blue mountain and buries the Renewed line. One click re-adds it.
  visible = signal<Record<Metric, boolean>>({ due: true, renewed: true, pending: false });
  windowSize = signal(this.DEFAULT_WINDOW);
  windowStart = signal(0);
  dragging = signal(false);
  private dragStartX = 0;
  hoverX = signal<number | null>(null);
  tip = signal<{ x: number; y: number; label: string; rows: { label: string; color: string; v: number }[] } | null>(null);

  // Monotonic request id so a slow stale response can never overwrite a newer one
  // (e.g. toggling Daily/Monthly fast, or rapid filter changes).
  private fetchSeq = 0;

  constructor() {
    // Fetch the period-aware trend whenever the filters (incl. `preset`) or a manual
    // Daily/Monthly override change. The preset rides along in the filters; trendBy is
    // only sent when the user has manually overridden the preset's bucket.
    effect(() => {
      const ov = this.trendByOverride();
      const f = { ...this.filters(), ...(ov ? { trendBy: ov } : {}) };
      const seq = ++this.fetchSeq;
      this.loading.set(true);
      this.svc.getTrend(f).subscribe({
        next: (res) => {
          if (seq !== this.fetchSeq) return;
          this.points.set(res.trend);
          this.bucket.set(res.bucket);
          this.curFrom.set(res.curFrom);
          this.applyDefaultWindow(res.trend, res.bucket, res.curFrom);
          this.loading.set(false);
        },
        error: () => { if (seq === this.fetchSeq) this.loading.set(false); },
      });
    });
    // Whenever the data set or zoom changes, snap the window to the latest points.
    effect(() => {
      const len = this.points().length;
      const size = this.windowSize();
      this.windowStart.set(Math.max(0, len - size));
    });
  }

  // Toggling to the granularity the preset already uses clears the override (back to
  // "follow the preset"); otherwise it forces the chosen granularity.
  setTrendBy(by: 'day' | 'month') {
    this.trendByOverride.set(by === this.bucket() ? null : by);
  }

  // Long daily windows open pre-zoomed to just the CURRENT period — two months of
  // daily sawtooth in one frame reads as noise. Pan left for the previous period;
  // double-click / ⟲ zooms back out to the whole window.
  private applyDefaultWindow(pts: TrendPoint[], bucket: 'day' | 'month', curFrom: string | null) {
    let size = this.DEFAULT_WINDOW;
    if (bucket === 'day' && curFrom && pts.length > 35) {
      const idx = pts.findIndex((p) => p.date >= curFrom);
      if (idx > 0) size = pts.length - idx;
    }
    this.windowSize.set(Math.max(5, size));
    this.windowStart.set(Math.max(0, pts.length - size));
  }

  // X of the divider between the previous period and the current period, placed midway
  // between the last "previous" point and the first "current" point. null when the
  // current period starts at the very first visible point (nothing before it to split).
  dividerX = computed<number | null>(() => {
    const cf = this.curFrom();
    const pts = this.displayed();
    if (!cf || pts.length === 0) return null;
    const month = this.bucket() === 'month';
    const key = month ? cf.slice(0, 7) : cf;
    const idx = pts.findIndex((p) => (month ? p.date.slice(0, 7) : p.date) >= key);
    if (idx <= 0) return null;
    const xs = this.xs(pts.length);
    return (xs[idx - 1] + xs[idx]) / 2;
  });

  displayed = computed<TrendPoint[]>(() => {
    const pts = this.points();
    const size = this.windowSize();
    const start = Math.max(0, Math.min(this.windowStart(), Math.max(0, pts.length - size)));
    return pts.slice(start, start + size);
  });

  private niceMax = computed(() => {
    const v = this.visible();
    const pts = this.displayed();
    let m = 1;
    for (const p of pts) for (const s of SERIES) if (v[s.key]) m = Math.max(m, p[s.key]);
    const pow = Math.pow(10, Math.floor(Math.log10(m)));
    return Math.ceil(m / pow) * pow || 1;
  });

  gridlines = computed(() => {
    const m = this.niceMax();
    return Array.from({ length: 5 }, (_, i) => {
      const v = Math.round((m / 4) * i);
      return { v, y: this.baseY - (v / m) * this.plotH };
    });
  });

  private xs(n: number): number[] {
    if (n === 1) return [this.padL + this.plotW / 2];
    return Array.from({ length: n }, (_, i) => this.padL + (i / (n - 1)) * this.plotW);
  }

  private coords(key: Metric): XY[] {
    const pts = this.displayed();
    const m = this.niceMax();
    const xs = this.xs(pts.length);
    return pts.map((p, i) => ({ x: xs[i], y: this.baseY - (p[key] / m) * this.plotH }));
  }

  // Catmull-Rom -> cubic bezier for a smooth (monotone-like) curve.
  private smooth(pts: XY[]): string {
    if (!pts.length) return '';
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  areaSeries = computed(() =>
    SERIES.filter((s) => this.visible()[s.key]).map((s) => {
      const c = this.coords(s.key);
      const line = this.smooth(c);
      const fill = c.length ? `${line} L ${c[c.length - 1].x} ${this.baseY} L ${c[0].x} ${this.baseY} Z` : '';
      return { key: s.key, color: s.color, line, fill };
    })
  );

  bars = computed(() => {
    const pts = this.displayed();
    const m = this.niceMax();
    const active = SERIES.filter((s) => this.visible()[s.key]);
    const group = this.plotW / pts.length;
    const bw = Math.min(16, (group * 0.7) / Math.max(1, active.length));
    const out: { x: number; y: number; w: number; h: number; color: string }[] = [];
    pts.forEach((p, i) => {
      const gx = this.padL + group * i + group * 0.15;
      active.forEach((s, j) => {
        const h = (p[s.key] / m) * this.plotH;
        out.push({ x: gx + j * bw, y: this.baseY - h, w: Math.max(1, bw - 1), h, color: s.color });
      });
    });
    return out;
  });

  xLabels = computed(() => {
    const pts = this.displayed();
    const xs = this.xs(pts.length);
    // Aim for ~12 labels: shows every month in the 12-month view, and thins the
    // daily view down to a readable dozen. Smaller axis font keeps them from touching.
    const step = Math.ceil(pts.length / 12) || 1;
    const last = pts.length - 1;
    const keep = pts
      .map((p, i) => ({ x: xs[i], t: this.fmtKey(p.date), i }))
      .filter((l) => l.i % step === 0 || l.i === last);
    // The last label is always forced in; if it lands right next to the previous
    // stepped label (e.g. 12 monthly points -> ...,idx10,idx11), they collide.
    // Drop the second-to-last one so there's always a gap before the end label.
    if (keep.length >= 2 && keep[keep.length - 1].i - keep[keep.length - 2].i < step) {
      keep.splice(keep.length - 2, 1);
    }
    // anchor the edge labels inward so they don't clip outside the card
    return keep.map((l) => ({ ...l, anchor: l.i === 0 ? 'start' : l.i === last ? 'end' : 'middle' }));
  });

  kfmt(v: number): string {
    if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
    return String(v);
  }

  private fmtKey(k: string): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (k.length === 7) { const [y, m] = k.split('-'); return `${months[+m - 1]} ${y}`; }   // Jul 2026
    if (k.length === 10) { const [, m, d] = k.split('-'); return `${+d} ${months[+m - 1]}`; }  // 1 Jul
    return k;
  }

  toggle(key: Metric) { this.visible.update((v) => ({ ...v, [key]: !v[key] })); }

  zoom(dir: 'in' | 'out') {
    const len = this.points().length;
    this.windowSize.update((s) => dir === 'in' ? Math.max(5, s - 5) : Math.min(Math.max(5, len), s + 5));
  }

  reset() { this.windowSize.set(this.DEFAULT_WINDOW); this.windowStart.set(Math.max(0, this.points().length - this.DEFAULT_WINDOW)); }

  down(e: MouseEvent) { this.dragging.set(true); this.dragStartX = e.clientX; this.tip.set(null); this.hoverX.set(null); }

  move(e: MouseEvent) {
    if (this.dragging()) {
      const sens = 22;
      const delta = this.dragStartX - e.clientX;
      if (Math.abs(delta) > sens) {
        const shift = Math.sign(delta) * Math.ceil(Math.abs(delta) / sens);
        const len = this.points().length;
        const next = Math.min(Math.max(0, this.windowStart() + shift), Math.max(0, len - this.windowSize()));
        if (next !== this.windowStart()) { this.windowStart.set(next); this.dragStartX = e.clientX; }
      }
      return;
    }
    this.showTip(e);
  }

  up() { this.dragging.set(false); }
  leave() { this.dragging.set(false); this.tip.set(null); this.hoverX.set(null); }

  private showTip(e: MouseEvent) {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const pts = this.displayed();
    if (!pts.length || rect.width === 0) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(ratio * (pts.length - 1))));
    const p = pts[i];
    const rows = SERIES.filter((s) => this.visible()[s.key]).map((s) => ({ label: s.label, color: s.color, v: p[s.key] }));
    this.hoverX.set(this.xs(pts.length)[i]);
    const tipW = 188;
    const tipH = 120;
    const x = e.clientX + tipW > window.innerWidth ? e.clientX - tipW : e.clientX + 14;
    const y = e.clientY + tipH > window.innerHeight ? e.clientY - tipH : e.clientY + 14;
    this.tip.set({
      x: Math.max(8, x),
      y: Math.max(8, y),
      label: this.fmtKey(p.date),
      rows,
    });
  }
}
