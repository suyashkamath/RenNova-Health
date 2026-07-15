import { Component, ElementRef, effect, inject, input, output, signal } from '@angular/core';
import { IconComponent } from './icon';

/**
 * Searchable dropdown (combobox) for filter fields with hundreds of options
 * (Region / Branch / RM). Type to filter, pick with mouse or ↑/↓ + Enter.
 * Empty value ('') means "All" — same contract as the <select> it replaces,
 * and it's styled to sit flush next to the remaining native selects.
 */
@Component({
  selector: 'app-autocomplete',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="ac" [class.is-disabled]="disabled()">
      <input
        #box
        type="text"
        role="combobox"
        [attr.aria-expanded]="open()"
        autocomplete="off"
        spellcheck="false"
        [placeholder]="placeholder()"
        [disabled]="disabled()"
        [value]="text()"
        (input)="onInput($any($event.target).value)"
        (focus)="openList()"
        (click)="openList()"
        (keydown)="onKeydown($event)"
        (blur)="onBlur()"
      />
      @if (value() && !disabled()) {
        <button class="clear" type="button" tabindex="-1" aria-label="Clear"
          (mousedown)="$event.preventDefault(); choose('')">×</button>
      } @else {
        <app-icon class="chev" [name]="open() ? 'search' : 'chevron-down'" [size]="15" />
      }

      @if (open() && !disabled()) {
        <div class="panel" role="listbox">
          @if (!text()) {
            <button type="button" class="opt opt--all" [class.on]="active() === -1"
              (mousedown)="$event.preventDefault(); choose('')">All</button>
          }
          @for (o of filtered(); track o; let i = $index) {
            <button type="button" class="opt" [class.on]="i === active()"
              (mousedown)="$event.preventDefault(); choose(o)">{{ o }}</button>
          }
          @if (filtered().length === 0 && text()) {
            <div class="empty">No matches for “{{ text() }}”</div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .ac { position:relative; min-width:0; }

    input { width:100%; box-sizing:border-box; height:39px; border:1px solid var(--border-strong,#d1d5db);
      border-radius:9px; padding:0 30px 0 12px; font-size:13px; font-weight:650; background:#f9fafb; color:#374151;
      transition:border-color .15s ease, box-shadow .15s ease, background .15s ease;
      text-overflow:ellipsis; }
    input::placeholder { color:#374151; font-weight:650; opacity:1; }
    input:hover { background:#fff; border-color:#d1d5db; }
    input:focus { outline:0; background:#fff; border-color:var(--accent,#6366f1); box-shadow:0 0 0 3px rgba(99,102,241,.12); }
    input:focus::placeholder { color:#c2c7d1; font-weight:500; }
    input:disabled { cursor:not-allowed; background:#eef2ff; border-color:#c7d2fe; opacity:1; }
    input:disabled::placeholder { color:var(--accent,#6366f1); font-weight:750; }

    .chev { position:absolute; right:10px; top:50%; transform:translateY(-50%); color:#9ca3af; pointer-events:none; }
    .is-disabled .chev { color:var(--accent,#6366f1); }
    .clear { position:absolute; right:6px; top:50%; transform:translateY(-50%); width:22px; height:22px;
      border:0; border-radius:6px; background:transparent; color:#9ca3af; font-size:16px; line-height:1;
      cursor:pointer; display:flex; align-items:center; justify-content:center; }
    .clear:hover { background:#eef2ff; color:var(--accent,#6366f1); }

    .panel { position:absolute; top:calc(100% + 6px); left:0; right:0; z-index:40; background:var(--card,#fff);
      border:1px solid var(--border,#e5e7eb); border-radius:12px; box-shadow:0 18px 40px rgba(17,24,39,.16);
      max-height:280px; overflow:auto; padding:5px; animation:drop .16s cubic-bezier(.22,1,.36,1) both; }
    @keyframes drop { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:none; } }

    .opt { display:block; width:100%; text-align:left; border:0; background:transparent; border-radius:8px;
      padding:9px 11px; font-size:13px; font-weight:600; color:#374151; cursor:pointer;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .opt:hover, .opt.on { background:var(--accent-soft,#eef2ff); color:var(--accent,#6366f1); }
    .opt--all { font-weight:750; }

    .empty { padding:12px 11px; font-size:12.5px; color:var(--muted,#94a3b8); }
  `],
})
export class AutocompleteComponent {
  options = input<string[]>([]);
  value = input<string>('');
  placeholder = input<string>('All');
  disabled = input<boolean>(false);
  valueChange = output<string>();

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  text = signal('');
  open = signal(false);
  active = signal(-1);

  // Reflect the outside value into the box (initial load, Reset, cascading clears).
  private syncFromValue = effect(() => { this.text.set(this.value()); });

  filtered = () => {
    const q = this.text().trim().toLowerCase();
    const all = this.options() || [];
    const list = q ? all.filter((o) => o.toLowerCase().includes(q)) : all;
    return list.slice(0, 300);   // hard cap — keeps the DOM light on huge lists
  };

  openList() {
    if (this.disabled()) return;
    // Open with the full list: searching should start from scratch, not from
    // the currently selected value pre-typed into the box.
    if (!this.open()) { this.text.set(''); this.active.set(-1); }
    this.open.set(true);
  }

  onInput(v: string) {
    this.text.set(v);
    this.open.set(true);
    this.active.set(v ? 0 : -1);
  }

  onKeydown(e: KeyboardEvent) {
    if (!this.open() && (e.key === 'ArrowDown' || e.key === 'Enter')) { this.openList(); return; }
    const list = this.filtered();
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active.set(Math.min(this.active() + 1, list.length - 1)); this.scrollActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set(Math.max(this.active() - 1, this.text() ? 0 : -1)); this.scrollActive(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.active() >= 0 && list[this.active()]) this.choose(list[this.active()]);
      else if (this.active() === -1 && !this.text()) this.choose('');
      else if (list.length === 1) this.choose(list[0]);
      else {
        const exact = list.find((o) => o.toLowerCase() === this.text().trim().toLowerCase());
        if (exact) this.choose(exact);
      }
    }
    else if (e.key === 'Escape') { this.close(); (e.target as HTMLElement).blur(); }
  }

  onBlur() {
    // Commit an exact (case-insensitive) match, treat cleared text as "All",
    // otherwise fall back to whatever was selected before.
    const t = this.text().trim();
    if (!this.open()) return;
    if (!t) { if (this.value() !== '') this.choose(''); else this.close(); return; }
    const exact = (this.options() || []).find((o) => o.toLowerCase() === t.toLowerCase());
    if (exact && exact !== this.value()) this.choose(exact);
    else this.close();
  }

  choose(v: string) {
    this.close();
    if (v !== this.value()) this.valueChange.emit(v);
  }

  private close() {
    this.open.set(false);
    this.active.set(-1);
    this.text.set(this.value());
  }

  private scrollActive() {
    queueMicrotask(() => {
      const el = this.host.nativeElement.querySelector('.opt.on') as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    });
  }
}
