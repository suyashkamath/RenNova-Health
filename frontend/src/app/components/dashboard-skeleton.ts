import { Component } from '@angular/core';

/**
 * Full-page shimmer skeleton shown on the FIRST dashboard load (before any data).
 * Mirrors the real layout — KPI row, trend + calendar, splits, rankings — so the
 * page doesn't jump when real content arrives. Cards rise in staggered, the
 * placeholders shimmer, and the trend card plays an "equalizer" bar animation.
 */
@Component({
  selector: 'app-dashboard-skeleton',
  standalone: true,
  template: `
    <div class="skel" role="status" aria-label="Loading dashboard">
      <div class="pill">
        <span class="ring"></span>
        <span>Crunching lakhs of live records</span>
        <span class="dots"><i>.</i><i>.</i><i>.</i></span>
      </div>

      <!-- KPI row -->
      <div class="kpis">
        @for (i of six; track i) {
          <div class="card kpi" [style.animation-delay.ms]="i * 70">
            <div class="sk ic"></div>
            <div class="lines">
              <div class="sk l1"></div>
              <div class="sk l2"></div>
              <div class="sk l3"></div>
            </div>
          </div>
        }
      </div>

      <!-- trend + calendar -->
      <div class="mid">
        <div class="card chart" style="animation-delay:420ms">
          <div class="head"><div class="sk t"></div><div class="sk chip"></div></div>
          <div class="bars">
            @for (b of bars; track $index) {
              <span class="bar" [style.height.%]="b" [style.animation-delay.ms]="$index * 90"></span>
            }
          </div>
          <div class="sk axis"></div>
        </div>
        <div class="card cal" style="animation-delay:500ms">
          <div class="head"><div class="sk t"></div><div class="sk chip"></div></div>
          <div class="grid">
            @for (c of cells; track $index) {
              <span class="sk cell" [style.animation-delay.ms]="($index % 7) * 60"></span>
            }
          </div>
        </div>
      </div>

      <!-- splits + rankings -->
      <div class="row3">
        @for (i of three; track i) {
          <div class="card box" [style.animation-delay.ms]="560 + i * 80">
            <div class="sk t"></div>
            <div class="sk r"></div><div class="sk r"></div><div class="sk r w70"></div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .skel { display:flex; flex-direction:column; gap:18px; position:relative; }

    /* ---- floating status pill ---- */
    /* centered via left/right + margin auto — NOT translateX(-50%), because the
       rise animation's final transform would override it and shove the pill right */
    .pill { position:absolute; top:-4px; left:0; right:0; margin:0 auto; width:fit-content; z-index:5;
      display:flex; align-items:center; gap:9px; background:var(--card,#fff); border:1px solid var(--border,#e5e7eb);
      border-radius:999px; padding:9px 16px; font-size:12.5px; font-weight:750; color:var(--muted,#64748b);
      box-shadow:var(--shadow-hover,0 12px 26px rgba(17,24,39,.12)); animation:rise .5s cubic-bezier(.22,1,.36,1) both; }
    .ring { width:10px; height:10px; border-radius:50%; background:var(--accent,#6366f1); position:relative; flex:none; }
    .ring::after { content:''; position:absolute; inset:-4px; border-radius:50%; border:2px solid var(--accent,#6366f1); animation:pulse 1.3s ease-out infinite; }
    @keyframes pulse { from { transform:scale(.55); opacity:.75; } to { transform:scale(1.7); opacity:0; } }
    .dots { margin-left:-6px; }
    .dots i { font-style:normal; animation:blink 1.2s ease-in-out infinite; }
    .dots i:nth-child(2) { animation-delay:.2s; }
    .dots i:nth-child(3) { animation-delay:.4s; }
    @keyframes blink { 0%, 100% { opacity:.15; } 45% { opacity:1; } }

    /* ---- shimmer primitive ---- */
    .sk { background:linear-gradient(90deg, #eef1f6 25%, #f8fafc 45%, #eef1f6 65%); background-size:400% 100%;
      animation:shimmer 1.5s ease-in-out infinite; border-radius:8px; }
    @keyframes shimmer { 0% { background-position:100% 0; } 100% { background-position:-100% 0; } }

    /* ---- cards rise in, staggered ---- */
    .card { background:var(--card,#fff); border:1px solid var(--border,#e5e7eb); border-radius:16px;
      box-shadow:var(--shadow,0 1px 2px rgba(17,24,39,.06)); padding:18px; animation:rise .55s cubic-bezier(.22,1,.36,1) both; }
    @keyframes rise { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }

    /* ---- KPI row ---- */
    .kpis { display:grid; grid-template-columns:repeat(6, minmax(0,1fr)); gap:14px; }
    .kpi { display:flex; gap:12px; align-items:flex-start; }
    .ic { width:40px; height:40px; border-radius:12px; flex:none; }
    .lines { flex:1; display:flex; flex-direction:column; gap:8px; }
    .l1 { height:10px; width:62%; }
    .l2 { height:20px; width:80%; }
    .l3 { height:9px; width:48%; }

    /* ---- trend + calendar ---- */
    .mid { display:grid; grid-template-columns:minmax(0, 2.3fr) minmax(300px, .9fr); gap:18px; }
    .head { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
    .t { height:14px; width:180px; }
    .chip { height:24px; width:96px; border-radius:999px; }
    .chart { display:flex; flex-direction:column; min-height:420px; }
    .bars { flex:1; display:flex; align-items:flex-end; gap:10px; padding:8px 6px 0; }
    .bar { flex:1; border-radius:8px 8px 3px 3px; transform-origin:bottom;
      background:linear-gradient(180deg, #c7d2fe, #eef2ff); animation:eq 1.15s ease-in-out infinite alternate; }
    @keyframes eq { from { transform:scaleY(.3); opacity:.55; } to { transform:scaleY(1); opacity:1; } }
    .axis { height:9px; width:100%; margin-top:12px; }
    .cal .grid { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
    .cell { aspect-ratio:1; border-radius:8px; }

    /* ---- bottom rows ---- */
    .row3 { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:18px; }
    .box .t { margin-bottom:16px; }
    .r { height:34px; margin-top:10px; border-radius:10px; }
    .w70 { width:70%; }

    @media (max-width:1100px) {
      .kpis { grid-template-columns:repeat(2,1fr); }
      .mid, .row3 { grid-template-columns:1fr; }
      .chart { min-height:300px; }
    }

    /* respect users who prefer no motion — keep layout, stop the dancing */
    @media (prefers-reduced-motion: reduce) {
      .sk, .bar, .ring::after, .dots i, .card, .pill { animation:none; }
    }
  `],
})
export class DashboardSkeletonComponent {
  readonly six = [0, 1, 2, 3, 4, 5];
  readonly three = [0, 1, 2];
  // pleasant, uneven "chart" heights for the equalizer bars
  readonly bars = [42, 68, 55, 82, 60, 90, 48, 74, 64, 86, 52, 70];
  readonly cells = Array.from({ length: 35 }, (_, i) => i);
}
