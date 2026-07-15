import { Component, computed, input } from '@angular/core';
import { IconComponent } from './icon';

@Component({
  selector: 'app-kpi-card',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="kpi">
      <div class="kpi__row">
        <div>
          <p class="kpi__label">{{ label() }}</p>
          <!-- track-by-value: a new value recreates the span, replaying the entry
               animation — old number fades out, new one rises in. -->
          <h3 class="kpi__value">@for (v of [value()]; track v) {<span class="v-in">{{ v }}</span>}</h3>
        </div>
        <div class="kpi__chip" [class]="'chip--' + tone()"><app-icon [name]="icon()" [size]="22" /></div>
      </div>
      <div class="kpi__foot">
        @if (delta() !== null && delta() !== undefined) {
          @for (d of [delta()]; track d) {
            <span class="kpi__delta v-in" [class.d--good]="good()" [class.d--bad]="!good() && delta() !== 0" [class.d--flat]="delta() === 0">
              <app-icon [name]="delta()! < 0 ? 'trending-down' : 'trending-up'" [size]="14" />
              {{ deltaText() }} {{ compare() }}
            </span>
          }
        }
        @if (sub()) { <p class="kpi__sub">{{ sub() }}</p> }
      </div>
    </div>
  `,
  styles: [`
    .kpi {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px;
      box-shadow: var(--shadow);
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
      height: 100%;
      display: flex; flex-direction: column; justify-content: space-between;
      min-height: 116px;
    }
    .kpi:hover { transform:translateY(-2px); box-shadow: var(--shadow-hover); border-color:var(--border-strong); }
    .kpi__row { display: flex; justify-content: space-between; align-items: flex-start; gap:14px; min-width:0; }
    .kpi__row > div:first-child { min-width:0; }
    .kpi__label { margin: 0 0 7px; font-size: 13px; font-weight: 600; color: var(--muted); line-height:1.3; }
    .kpi__value { margin: 0; font-size: clamp(22px, 1.9vw, 29px); font-weight: 800; color: var(--text); line-height: 1.1; letter-spacing: 0; white-space: nowrap; }
    .v-in { display: inline-block; animation: v-in .45s cubic-bezier(.22, 1, .36, 1); }
    @keyframes v-in { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .v-in { animation: none; } }
    .kpi__foot { margin-top:12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .kpi__sub { margin: 0; font-size: 12px; color: var(--muted-soft,#9ca3af); line-height:1.35; }
    .kpi__delta { display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:800; white-space:nowrap; }
    .d--good { color:#059669; }
    .d--bad { color:#e11d48; }
    .d--flat { color:var(--muted-soft,#9ca3af); }
    .kpi__chip { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    @media (max-width:720px) {
      .kpi { padding:16px; min-height:106px; }
      .kpi__value { font-size: 24px; }
    }
    .chip--indigo { background: #eef2ff; color:#4f46e5; }
    .chip--green  { background: #ecfdf5; color:#059669; }
    .chip--amber  { background: #fffbeb; color:#d97706; }
    .chip--red    { background: #fff1f2; color:#e11d48; }
    .chip--blue   { background: #eff6ff; color:#2563eb; }
    .chip--violet { background: #f5f3ff; color:#7c3aed; }
    .chip--teal   { background: #f0fdfa; color:#0d9488; }
    .chip--slate  { background: #f8fafc; color:#64748b; }
  `],
})
export class KpiCardComponent {
  label = input.required<string>();
  value = input.required<string>();
  sub = input<string>('');
  icon = input<string>('');
  tone = input<string>('indigo');

  /** % (or pts) change vs the previous equal-length period; null/undefined hides the badge. */
  delta = input<number | null | undefined>(undefined);
  /** '%' for relative change, 'pts' for percentage-point diffs (e.g. Renewal %). */
  deltaUnit = input<'%' | 'pts'>('%');
  /** Comparison caption after the delta — preset-aware ("vs last month" / "vs last week" …). */
  compare = input<string>('vs last period');

  // Purely directional: growth = green, dip = red — same rule on every card.
  good = computed(() => (this.delta() ?? 0) > 0);

  // Value only, no +/− sign — the arrow icon and the red/green color carry direction.
  deltaText = computed(() => {
    const d = this.delta() ?? 0;
    const unit = this.deltaUnit() === 'pts' ? ' pts' : '%';
    return `${Math.abs(d)}${unit}`;
  });
}
