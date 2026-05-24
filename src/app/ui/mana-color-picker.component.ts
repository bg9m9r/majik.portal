import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Output,
  computed,
  inject,
  input,
} from '@angular/core';

interface ColorChip {
  symbol: string;
  label: string;
  cssVar: string;
}

const COLOR_META: Record<string, { label: string; cssVar: string }> = {
  W: { label: 'white', cssVar: '--mana-w' },
  U: { label: 'blue', cssVar: '--mana-u' },
  B: { label: 'black', cssVar: '--mana-b' },
  R: { label: 'red', cssVar: '--mana-r' },
  G: { label: 'green', cssVar: '--mana-g' },
  C: { label: 'colorless', cssVar: '--mana-c' },
};

@Component({
  selector: 'app-mana-color-picker',
  standalone: true,
  template: `
    <div
      role="dialog"
      aria-label="choose mana color"
      class="fixed z-50 flex gap-1 rounded-full border border-[color:var(--majik-line)] bg-[color:var(--majik-bg)] px-2 py-1 shadow-[var(--shadow-modal)]"
      [style.left.px]="position().left"
      [style.top.px]="position().top">
      @for (c of chips(); track c.symbol) {
        <button
          type="button"
          class="majik-mana-pip h-6 w-6 rounded-full text-[10px] font-semibold leading-6 text-stone-900 focus:outline focus:outline-2 focus:outline-amber-400"
          [style.background]="'var(' + c.cssVar + ')'"
          [attr.aria-label]="'tap for ' + c.label + ' mana'"
          [title]="c.label"
          (click)="onPick(c.symbol)">
          {{ c.symbol }}
        </button>
      }
    </div>
  `,
})
export class ManaColorPickerComponent {
  readonly colors = input<string>('');
  readonly anchorRect = input<DOMRect | null>(null);

  @Output() readonly colorSelected = new EventEmitter<string>();
  @Output() readonly dismiss = new EventEmitter<void>();

  private readonly host = inject(ElementRef<HTMLElement>);

  readonly chips = computed<ColorChip[]>(() => {
    const out: ColorChip[] = [];
    for (const ch of (this.colors() ?? '').split('')) {
      const meta = COLOR_META[ch];
      if (meta) out.push({ symbol: ch, label: meta.label, cssVar: meta.cssVar });
    }
    return out;
  });

  readonly position = computed<{ left: number; top: number }>(() => {
    const r = this.anchorRect();
    if (!r) return { left: 0, top: 0 };
    const popoverWidth = Math.max(48, this.chips().length * 28 + 16);
    const popoverHeight = 36;
    const gap = 8;
    const margin = 8;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
    let left = r.left + r.width / 2 - popoverWidth / 2;
    if (left + popoverWidth > vw - margin) left = vw - margin - popoverWidth;
    if (left < margin) left = margin;
    let top = r.top - popoverHeight - gap;
    if (top < margin) top = r.bottom + gap;
    if (top + popoverHeight > vh - margin) top = vh - margin - popoverHeight;
    return { left, top };
  });

  onPick(color: string): void {
    this.colorSelected.emit(color);
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.dismiss.emit();
  }

  @HostListener('document:mousedown', ['$event'])
  onDocMouseDown(evt: MouseEvent): void {
    const target = evt.target as Node | null;
    if (target && this.host.nativeElement.contains(target)) return;
    this.dismiss.emit();
  }
}
