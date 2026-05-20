import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CardTileComponent } from './card-tile.component';

describe('CardTileComponent', () => {
  function render(props: { name: string; count?: number }) {
    TestBed.configureTestingModule({ imports: [CardTileComponent] });
    const fixture = TestBed.createComponent(CardTileComponent);
    fixture.componentRef.setInput('name', props.name);
    if (props.count !== undefined) fixture.componentRef.setInput('count', props.count);
    fixture.detectChanges();
    return fixture;
  }

  it('renders Scryfall image URL with exact name', () => {
    const fx = render({ name: 'Grizzly Bears' });
    const img = fx.nativeElement.querySelector('img');
    expect(img.getAttribute('src')).toBe('https://api.scryfall.com/cards/named?exact=Grizzly+Bears&format=image&version=small');
    expect(img.getAttribute('alt')).toBe('Grizzly Bears');
  });

  it('shows count badge when count > 0', () => {
    const fx = render({ name: 'Forest', count: 4 });
    expect(fx.nativeElement.textContent).toContain('4');
  });

  it('hides count badge when count is 0', () => {
    const fx = render({ name: 'Forest', count: 0 });
    expect(fx.nativeElement.querySelector('[data-count-badge]')).toBeNull();
  });
});
