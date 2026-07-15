import { Component, HostListener, computed, input, output, signal } from '@angular/core';
import { IconComponent } from './icon';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

interface Day { date: string; day: number; disabled: boolean; }

/**
 * Elegant range calendar to replace the two native <input type="date"> boxes.
 *
 * Slide-to-select: press on a day and drag across the grid to sweep out the
 * from→to range (the in-between days highlight live). Or click a start day then
 * click an end day. Selection is LOCAL only — nothing is emitted until Apply, so
 * dragging never triggers a query (the aggregations run on lakhs of live rows).
 */
@Component({
  selector: 'app-date-range-picker',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="drp">
      <button class="trigger" [class.trigger--open]="open()" (click)="toggle()" type="button">
        <app-icon name="calendar" [size]="16" />
        <span class="trigger__txt" [class.trigger__txt--empty]="!from() && !to()">{{ triggerLabel() }}</span>
        <span class="trigger__chev" [class.trigger__chev--open]="open()">⌄</span>
      </button>

      @if (open()) {
        <div class="backdrop" (click)="cancel()"></div>
        <div class="pop" (pointerup)="onUp()" (pointerleave)="onUp()">
          <div class="pop__head">
            <button class="navbtn" (click)="shift(-1)" type="button" aria-label="Previous month">‹</button>
            <span class="pop__month">{{ monthLabel() }}</span>
            <button class="navbtn" (click)="shift(1)" type="button" aria-label="Next month">›</button>
          </div>

          <div class="dow">
            @for (d of dow; track $index) { <span>{{ d }}</span> }
          </div>

          <div class="grid" (pointerleave)="hover.set(null)">
            @for (e of emptySlots(); track $index) { <span class="pad"></span> }
            @for (c of cells(); track c.date) {
              <button type="button" class="day"
                [class.day--disabled]="c.disabled"
                [class.day--start]="isStart(c.date)"
                [class.day--end]="isEnd(c.date)"
                [class.day--in]="inRange(c.date)"
                [class.day--today]="c.date === today"
                [disabled]="c.disabled"
                (pointerdown)="onDown(c, $event)"
                (pointerenter)="onEnter(c)">
                <span>{{ c.day }}</span>
              </button>
            }
          </div>

          <div class="pop__foot">
            <div class="chips">
              <button type="button" class="chip" (click)="quick(0)">Today</button>
              <button type="button" class="chip" (click)="quick(6)">7d</button>
              <button type="button" class="chip" (click)="quick(29)">30d</button>
            </div>
            <div class="acts">
              <button type="button" class="btn btn--ghost" (click)="clear()">Clear</button>
              <button type="button" class="btn btn--primary" (click)="apply()" [disabled]="!selStart()">Apply</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .drp { position:relative; }
    .trigger { display:flex; align-items:center; gap:8px; width:100%; box-sizing:border-box; height:39px; border:1px solid var(--border-strong); border-radius:9px; padding:0 12px; font-size:13px; font-weight:650; background:#f9fafb; color:#374151; cursor:pointer; transition:border-color .15s ease, box-shadow .15s ease, background .15s ease; }
    .trigger:hover { background:#fff; border-color:#d1d5db; }
    .trigger--open { background:#fff; border-color:var(--accent); box-shadow:0 0 0 3px rgba(99,102,241,.12); }
    .trigger__txt { flex:1; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .trigger__txt--empty { color:var(--muted-soft); }
    .trigger__chev { color:var(--muted-soft); font-size:15px; transition:transform .18s ease; }
    .trigger__chev--open { transform:rotate(180deg); }

    .backdrop { position:fixed; inset:0; z-index:40; }
    .pop { position:absolute; z-index:41; top:calc(100% + 8px); left:0; width:308px; background:var(--card); border:1px solid var(--border); border-radius:14px; box-shadow:var(--shadow-hover); padding:16px 18px; animation:pop .16s ease; touch-action:none; user-select:none; }
    @keyframes pop { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }

    .pop__head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
    .pop__month { font-size:14px; font-weight:800; color:var(--text); }
    .navbtn { border:0; background:#f3f4f6; width:30px; height:30px; border-radius:8px; cursor:pointer; color:var(--muted); font-size:17px; font-weight:800; line-height:1; transition:background .14s ease, color .14s ease; }
    .navbtn:hover { background:var(--accent-soft); color:var(--accent); }

    .dow { display:grid; grid-template-columns:repeat(7,1fr); margin-bottom:6px; }
    .dow span { text-align:center; font-size:10px; font-weight:800; color:var(--muted-soft); }

    .grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px 0; }
    .pad { height:36px; }
    .day { position:relative; display:flex; align-items:center; justify-content:center; height:36px; width:100%; padding:0; margin:0; border:0; background:transparent; cursor:pointer; font-size:12.5px; font-weight:650; color:var(--text); border-radius:0; transition:background .1s ease, color .1s ease; }
    .day span { position:relative; z-index:1; display:flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:8px; }
    .day:hover:not(.day--disabled) span { background:var(--accent-soft); }
    .day--disabled { color:#d1d5db; cursor:default; }
    .day--today span { box-shadow:inset 0 0 0 1.5px var(--accent); }
    .day--in { background:var(--accent-soft); }
    .day--start { background:linear-gradient(to right, transparent 50%, var(--accent-soft) 50%); }
    .day--end { background:linear-gradient(to left, transparent 50%, var(--accent-soft) 50%); }
    .day--start.day--end { background:transparent; }
    .day--start span, .day--end span { background:var(--accent); color:#fff; font-weight:800; }
    .day--start:hover span, .day--end:hover span { background:var(--accent-dark); }

    .pop__foot { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:12px; padding-top:12px; border-top:1px solid var(--border-soft); }
    .chips { display:flex; gap:5px; }
    .chip { border:1px solid var(--border-strong); background:#f9fafb; color:var(--muted); font-size:11px; font-weight:750; padding:5px 9px; border-radius:7px; cursor:pointer; transition:all .14s ease; }
    .chip:hover { color:var(--accent); border-color:#c7d2fe; background:var(--accent-soft); }
    .acts { display:flex; gap:6px; }
    .btn { border:0; font-size:12px; font-weight:750; padding:7px 13px; border-radius:8px; cursor:pointer; transition:all .14s ease; }
    .btn--ghost { background:transparent; color:var(--muted); }
    .btn--ghost:hover { color:var(--danger); background:#fef2f2; }
    .btn--primary { background:var(--accent); color:#fff; }
    .btn--primary:hover { background:var(--accent-dark); }
    .btn--primary:disabled { background:#c7d2fe; cursor:default; }
  `],
})
export class DateRangePickerComponent {
  from = input<string>('');
  to = input<string>('');
  min = input<string>('');
  max = input<string>('');
  rangeChange = output<{ from: string; to: string }>();

  readonly dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  readonly today = this.iso(new Date());

  open = signal(false);
  private view = signal<string>('');            // yyyy-mm shown in the grid
  selStart = signal<string | null>(null);       // committed local selection (not yet applied)
  selEnd = signal<string | null>(null);
  private dragging = signal(false);
  hover = signal<string | null>(null);          // live preview endpoint while sliding

  monthLabel = computed(() => {
    const [y, m] = this.view().split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  });

  triggerLabel = computed(() => {
    const f = this.from(), t = this.to();
    if (!f && !t) return 'Any date';
    if (f && t) return f === t ? this.pretty(f) : `${this.pretty(f)}  →  ${this.pretty(t)}`;
    return this.pretty(f || t);
  });

  emptySlots = computed(() => {
    const [y, m] = this.view().split('-').map(Number);
    return Array(new Date(y, m - 1, 1).getDay()).fill(0);
  });

  cells = computed<Day[]>(() => {
    const [y, m] = this.view().split('-').map(Number);
    const total = new Date(y, m, 0).getDate();
    const lo = this.min(), hi = this.max();
    return Array.from({ length: total }, (_, i) => {
      const day = i + 1;
      const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { date, day, disabled: (!!lo && date < lo) || (!!hi && date > hi) };
    });
  });

  // The endpoints to paint right now: committed selection, or start→hover while sliding.
  private paint = computed<[string, string] | null>(() => {
    const s = this.selStart();
    if (!s) return null;
    const e = this.selEnd() ?? this.hover() ?? s;
    return s <= e ? [s, e] : [e, s];
  });

  toggle() { this.open() ? this.cancel() : this.openPicker(); }

  private openPicker() {
    // Seed the local selection + grid from the currently applied range.
    const f = this.from(), t = this.to();
    this.selStart.set(f || null);
    this.selEnd.set(t || (f || null));
    this.hover.set(null);
    this.view.set((f || this.today).slice(0, 7));
    this.open.set(true);
  }

  cancel() { this.open.set(false); this.dragging.set(false); }

  shift(delta: number) {
    const [y, m] = this.view().split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    this.view.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  onDown(c: Day, ev: PointerEvent) {
    if (c.disabled) return;
    ev.preventDefault();
    if (this.selStart() && !this.selEnd()) {
      // Second click of a click-click selection: close the range.
      this.commit(c.date);
    } else {
      // Begin a fresh slide/selection at this day.
      this.selStart.set(c.date);
      this.selEnd.set(null);
      this.hover.set(c.date);
      this.dragging.set(true);
    }
  }

  onEnter(c: Day) {
    if (c.disabled) return;
    if (this.dragging() || (this.selStart() && !this.selEnd())) this.hover.set(c.date);
  }

  onUp() {
    if (!this.dragging()) return;
    this.dragging.set(false);
    const h = this.hover();
    // Only finish the range if the slide actually moved off the start day;
    // a plain click leaves selEnd null so a second click can set the end.
    if (h && h !== this.selStart()) this.commit(h);
  }

  private commit(end: string) {
    const s = this.selStart()!;
    const [lo, hi] = s <= end ? [s, end] : [end, s];
    this.selStart.set(lo);
    this.selEnd.set(hi);
    this.hover.set(null);
  }

  isStart(d: string) { const p = this.paint(); return !!p && d === p[0]; }
  isEnd(d: string) { const p = this.paint(); return !!p && d === p[1]; }
  inRange(d: string) { const p = this.paint(); return !!p && d > p[0] && d < p[1]; }

  quick(daysBack: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - daysBack);
    this.selStart.set(this.iso(start));
    this.selEnd.set(this.iso(end));
    this.hover.set(null);
    this.view.set(this.iso(start).slice(0, 7));
  }

  clear() {
    this.selStart.set(null);
    this.selEnd.set(null);
    this.hover.set(null);
    this.rangeChange.emit({ from: '', to: '' });
    this.cancel();
  }

  apply() {
    const s = this.selStart();
    if (!s) return;
    const e = this.selEnd() ?? s;
    this.rangeChange.emit({ from: s, to: e });
    this.cancel();
  }

  @HostListener('document:keydown.escape')
  onEsc() { if (this.open()) this.cancel(); }

  private iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private pretty(d: string): string {
    const [y, m, day] = d.split('-').map(Number);
    return `${day} ${MON_SHORT[m - 1]} ${y}`;
  }
}
