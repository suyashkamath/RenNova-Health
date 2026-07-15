import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RenewalService } from '../services/renewal.service';
import { CalendarDay, DashboardFilters } from '../models/renewal';
import { inr, compact } from '../util/format';
import { IconComponent } from './icon';

interface Cell {
  date: string;        // yyyy-mm-dd
  day: number;
  due: number;
  renewed: number;
  premiumGross: number;
  collectedPremiumGross: number;
  isFuture: boolean;
  isToday: boolean;
  pct: number;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

@Component({
  selector: 'app-calendar-widget',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="cal">
      <div class="cal__head">
        <div class="cal__title">
          <h3>Calendar</h3>
          <button class="dl" (click)="downloadMonth()" title="Download this month's policies"><app-icon name="download" [size]="16" /></button>
          @if (loading()) { <span class="spin" title="Loading month…"></span> }
        </div>
        <div class="nav">
          <button (click)="shift(-1)" aria-label="Previous month">‹</button>
          <span class="month">{{ monthLabel() }}</span>
          <button (click)="shift(1)" aria-label="Next month">›</button>
        </div>
      </div>

      <div class="dow">
        @for (d of dow; track $index) { <div>{{ d }}</div> }
      </div>

      <div class="grid" [class.grid--loading]="loading()">
        @for (e of emptySlots(); track $index) { <div class="empty"></div> }
        @for (c of cells(); track c.date) {
          <div class="cell"
            [class.cell--future]="c.isFuture"
            [class.cell--good]="!c.isFuture && c.pct >= 0.9"
            [class.cell--bad]="!c.isFuture && c.pct < 0.9"
            [class.cell--today]="c.isToday"
            [class.cell--empty]="c.due === 0"
            (click)="openDay(c)"
            (mouseenter)="showTip($event, c)" (mouseleave)="tip.set(null)">
            @if (!c.isFuture && c.due > 0) {
              <span class="rnw" [class.rnw--good]="c.pct >= 0.9" [class.rnw--bad]="c.pct < 0.9">{{ k(c.renewed) }}</span>
            }
            <span class="dnum">{{ c.day }}</span>
            <span class="due">{{ k(c.due) }}</span>
            @if (c.due > 0) {
              <button class="cell__dl" (click)="downloadDay(c, $event)" title="Download this day's report">
                <app-icon name="download" [size]="12" />
              </button>
            }
          </div>
        }
      </div>

      <div class="legend">
        <span><i class="lg lg--good"></i> ≥90%</span>
        <span><i class="lg lg--bad"></i> &lt;90%</span>
        <span><i class="lg lg--future"></i> Future</span>
      </div>

      @if (tip(); as t) {
        <div class="tooltip" [style.left.px]="t.x" [style.top.px]="t.y">
          <div class="tt-date">{{ t.date }}</div>
          <div class="tt-head">Policies</div>
          <div class="tt-row"><span>Due</span><b>{{ t.due }}</b></div>
          <div class="tt-row"><span>Renewed</span><b class="g">{{ t.renewed }}</b></div>
          <div class="tt-row"><span>Pending</span><b class="p">{{ t.due - t.renewed }}</b></div>
          <div class="tt-head">Premium</div>
          <div class="tt-row"><span>Total</span><b>{{ fmt(t.premiumGross) }}</b></div>
          <div class="tt-row"><span>Collected</span><b class="g">{{ fmt(t.collectedPremiumGross) }}</b></div>
          <div class="tt-row"><span>Pending</span><b class="p">{{ fmt(t.premiumGross - t.collectedPremiumGross) }}</b></div>
        </div>
      }
    </div>
  `,
  styles: [`
    .cal { background:var(--card); border:1px solid var(--border); border-radius:var(--radius); padding:18px; box-shadow:var(--shadow); height:100%; display:flex; flex-direction:column; position:relative; }
    .cal__head { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; gap:10px; }
    .cal__title { display:flex; align-items:center; gap:8px; }
    h3 { margin:0; font-size:15px; font-weight:800; color:var(--text); }
    .dl { border:0; background:var(--accent-soft); color:var(--accent); cursor:pointer; font-size:13px; padding:5px 7px; border-radius:7px; font-weight:800; }
    .dl:hover { background:var(--accent-soft); }
    .nav { display:flex; align-items:center; gap:6px; }
    .nav button { border:0; background:#f9fafb; width:28px; height:28px; border-radius:7px; cursor:pointer; color:var(--muted); font-size:16px; font-weight:800; }
    .nav button:hover { background:var(--accent-soft); color:var(--accent); }
    .month { font-size:12px; font-weight:600; color:var(--text); width:108px; text-align:center; user-select:none; }
    .dow { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; text-align:center; margin-bottom:8px; }
    .dow div { font-size:10px; font-weight:800; color:var(--muted-soft,#9ca3af); }
    .grid { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; grid-auto-rows:auto; transition:opacity .25s ease, filter .25s ease; }
    .grid--loading { opacity:.45; filter:saturate(.4); pointer-events:none; animation:cal-breathe 1.2s ease-in-out infinite alternate; }
    @keyframes cal-breathe { from { opacity:.45; } to { opacity:.7; } }
    .spin { width:13px; height:13px; flex:none; border-radius:50%; border:2px solid var(--accent-soft,#eef2ff); border-top-color:var(--accent,#6366f1); animation:cal-spin .7s linear infinite; }
    @keyframes cal-spin { to { transform:rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .grid--loading, .spin { animation:none; } }
    .cell { border:1px solid var(--border); border-radius:8px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; cursor:pointer; position:relative; padding:8px 4px; min-height:72px; transition:transform .14s ease, box-shadow .14s ease; }
    .cell:hover { transform:scale(1.05); z-index:2; box-shadow:var(--shadow-hover); }
    .cell--future { background:#f8fafc; border-color:#eef2f6; color:#94a3b8; }
    .cell--good { background:#ecfdf5; border-color:#a7f3d0; color:#065f46; }
    .cell--bad { background:#fef2f2; border-color:#fecaca; color:#991b1b; }
    .cell--today { outline:2px solid var(--accent); outline-offset:2px; }
    .cell--empty { cursor:default; }
    .cell--empty:hover { transform:none; }
    .dnum { font-size:14px; font-weight:700; opacity:.85; line-height:1; }
    .due { font-size:9px; font-weight:700; line-height:1.1; opacity:.8; }
    .cell__dl { position:absolute; bottom:1px; left:1px; border:0; background:transparent; color:inherit; cursor:pointer; padding:1px; border-radius:5px; opacity:0; transition:opacity .12s ease; line-height:0; }
    .cell:hover .cell__dl { opacity:.65; }
    .cell__dl:hover { opacity:1; background:rgba(0,0,0,.08); }
    .rnw { position:absolute; top:0; right:0; font-size:8px; font-weight:800; padding:0 4px; border-bottom-left-radius:6px; }
    .rnw--good { background:rgba(16,185,129,.25); color:#065f46; }
    .rnw--bad { background:rgba(239,68,68,.22); color:#991b1b; }
    .legend { display:flex; justify-content:space-between; font-size:10px; color:var(--muted); margin-top:12px; gap:8px; }
    .legend span { display:flex; align-items:center; gap:4px; }
    .lg { width:9px; height:9px; border-radius:50%; display:inline-block; }
    .lg--good { background:#ecfdf5; border:1px solid #a7f3d0; }
    .lg--bad { background:#fef2f2; border:1px solid #fecaca; }
    .lg--future { background:#f1f5f9; border:1px solid #e2e8f0; }
    .tooltip { position:fixed; z-index:9999; pointer-events:none; background:#1f2937; color:#e5e7eb; padding:9px 10px; border-radius:10px; box-shadow:0 12px 26px rgba(17,24,39,.24); font-size:11px; min-width:140px; animation:tip-in .14s ease; }
    @keyframes tip-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
    @media (prefers-reduced-motion: reduce) { .tooltip { animation:none; } }
    .tt-date { font-weight:700; color:#fff; margin-bottom:4px; }
    .tt-head { font-size:8.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; color:#94a3b8; margin:6px 0 2px; }
    .tt-head:first-of-type { margin-top:2px; }
    .tt-row { display:flex; justify-content:space-between; gap:14px; white-space:nowrap; }
    .tt-row b { color:#fff; } .tt-row b.g { color:#34d399; } .tt-row b.p { color:#fbbf24; }
    @media (max-width:720px) {
      .cal__head { flex-direction:column; align-items:flex-start; }
      .nav { width:100%; justify-content:space-between; }
      .legend { flex-wrap:wrap; }
    }
  `],
})
export class CalendarWidgetComponent {
  private svc = inject(RenewalService);
  private router = inject(Router);
  filters = input<DashboardFilters>({});

  readonly dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  private now = new Date();
  month = signal<string>(`${this.now.getFullYear()}-${String(this.now.getMonth() + 1).padStart(2, '0')}`);
  // LOCAL yyyy-mm-dd — toISOString() is UTC and would mark yesterday as "today"
  // before 05:30 IST. The server's `today` overwrites this once data arrives.
  today = signal<string>(
    `${this.now.getFullYear()}-${String(this.now.getMonth() + 1).padStart(2, '0')}-${String(this.now.getDate()).padStart(2, '0')}`
  );
  private days = signal<Map<string, CalendarDay>>(new Map());

  tip = signal<{ x: number; y: number; date: string; due: number; renewed: number; premiumGross: number; collectedPremiumGross: number } | null>(null);
  fmt = inr;
  k = compact;

  // Monotonic request id: clicking ‹ › fast fires overlapping requests, and a slow
  // earlier month must not paint over the month currently shown.
  private fetchSeq = 0;
  loading = signal(true);

  constructor() {
    effect(() => {
      const f = this.filters();
      const m = this.month();
      const seq = ++this.fetchSeq;
      this.loading.set(true);
      this.svc.getCalendar(f, m).subscribe({
        next: (res) => {
          if (seq !== this.fetchSeq) return;
          this.today.set(res.today);
          this.days.set(new Map(res.days.map((d) => [d.date, d])));
          this.loading.set(false);
        },
        error: () => { if (seq === this.fetchSeq) this.loading.set(false); },
      });
    });
  }

  monthLabel = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  });

  emptySlots = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return Array(new Date(y, m - 1, 1).getDay()).fill(0);
  });

  cells = computed<Cell[]>(() => {
    const [y, m] = this.month().split('-').map(Number);
    const total = new Date(y, m, 0).getDate();
    const today = this.today();
    const map = this.days();
    return Array.from({ length: total }, (_, i) => {
      const day = i + 1;
      const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const d = map.get(date);
      const due = d?.due ?? 0;
      const renewed = d?.renewed ?? 0;
      return {
        date, day, due, renewed, premiumGross: d?.premiumGross ?? 0,
        collectedPremiumGross: d?.collectedPremiumGross ?? 0,
        isFuture: date > today, isToday: date === today,
        pct: due > 0 ? renewed / due : 0,
      };
    });
  });

  shift(delta: number) {
    const [y, m] = this.month().split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    this.month.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  // Click a day -> open the policy list filtered to that single expiry date.
  openDay(c: Cell) {
    if (c.due === 0) return;
    this.svc.filters.set({ ...this.filters(), from: c.date, to: c.date });
    this.tip.set(null);
    this.router.navigate(['/policies']);
  }

  // Anchor the tooltip to the hovered CELL (not the cursor): centered under it,
  // flipped above when it would run off the bottom, clamped inside the viewport.
  showTip(e: MouseEvent, c: Cell) {
    if (c.due === 0) { this.tip.set(null); return; }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const TW = 175, TH = 195, pad = 8, gap = 7;
    let x = r.left + r.width / 2 - TW / 2;
    x = Math.min(Math.max(x, pad), window.innerWidth - TW - pad);
    let y = r.bottom + gap;
    if (y + TH > window.innerHeight - pad) y = r.top - TH - gap;
    this.tip.set({ x, y, date: c.date, due: c.due, renewed: c.renewed, premiumGross: c.premiumGross, collectedPremiumGross: c.collectedPremiumGross });
  }

  // Daily report: download just this one day's policies, straight from the calendar
  // (no need to open the Policy List and set a date filter). Streams the FULL set.
  downloadDay(c: Cell, ev: MouseEvent) {
    ev.stopPropagation();  // don't also trigger the cell's openDay() navigation
    if (c.due === 0) return;
    this.svc.downloadCsv({ ...this.filters(), from: c.date, to: c.date });
  }

  downloadMonth() {
    const [y, m] = this.month().split('-').map(Number);
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const to = `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    // Full month, no 500-row cap — same authenticated download as the Policy List.
    this.svc.downloadCsv({ ...this.filters(), from, to });
  }
}
