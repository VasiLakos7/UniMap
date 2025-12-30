import {
  Component,
  EventEmitter,
  Output,
  Input,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, IonSearchbar } from '@ionic/angular';
import { Destination, destinationList } from '../../models/destination.model';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, TranslateModule],
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss'],
})
export class SearchBarComponent implements OnInit, OnDestroy {
  @Output() destinationSelected = new EventEmitter<Destination>();
  @Output() searchOpenChange = new EventEmitter<boolean>();

  @Output() lockedAttempt = new EventEmitter<void>();
  @Output() cancelRequested = new EventEmitter<void>();

  @Input() locked = false;

  @Input() showLockBadge = false;
  @Input() lockBadgeText = '🔒 Διαδρομή ενεργή';
  @Input() placeholderText = 'Προορισμός...';

  @ViewChild(IonSearchbar) sb?: IonSearchbar;

  searchQuery = '';
  filteredResults: Destination[] = [];
  destinationList: Destination[] = destinationList;

  // ✅ Recents by id (stable across languages)
  recentResults: Destination[] = [];
  private readonly RECENTS_KEY = 'unimap_recent_destinations_v2'; // ✅ bumped
  private readonly RECENTS_LIMIT = 6;

  panelOpen = false;

  // cache translated names for filtering
  private nameCache = new Map<string, string>();
  private langSub?: Subscription;

  constructor(
    private elRef: ElementRef,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.rebuildNameCache();
    this.loadRecents();

    // when language changes -> rebuild cache + re-filter
    this.langSub = this.translate.onLangChange.subscribe(() => {
      this.rebuildNameCache();

      if (this.panelOpen && this.searchQuery.trim()) {
        this.filteredResults = this.filterByQuery(this.searchQuery);
      }
      this.emitOpenState();
    });

    this.panelOpen = false;
    this.searchOpenChange.emit(false);
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
  }

  // ---------- i18n helpers ----------
  displayName(dest: Destination): string {
    const cached = this.nameCache.get(dest.id);
    if (cached) return cached;

    // fallback (should not happen if cache built)
    const t = this.translate.instant(`DEST.${dest.id}.NAME`);
    return (t && t !== `DEST.${dest.id}.NAME`) ? t : dest.name;
  }

  private rebuildNameCache() {
    this.nameCache.clear();
    for (const d of this.destinationList) {
      const key = `DEST.${d.id}.NAME`;
      const t = this.translate.instant(key);
      this.nameCache.set(d.id, (t && t !== key) ? t : d.name);
    }
  }

  // ---------- dropdown logic ----------
  private canShowAnyList(): boolean {
    const hasQuery = !!this.searchQuery.trim();
    if (hasQuery) return this.filteredResults.length > 0;
    return this.recentResults.length > 0;
  }

  private emitOpenState() {
    this.searchOpenChange.emit(this.panelOpen && this.canShowAnyList());
  }

  private async closeDropdown(clearQuery = false) {
    if (clearQuery) this.searchQuery = '';
    this.filteredResults = [];
    this.panelOpen = false;
    this.searchOpenChange.emit(false);

    try {
      const input = await this.sb?.getInputElement();
      input?.blur();
    } catch {}
  }

  onCancelClick(ev: Event) {
    ev.preventDefault();
    ev.stopPropagation();
    this.cancelRequested.emit();
  }

  onSearchFocus() {
    if (this.locked) {
      this.lockedAttempt.emit();
      this.closeDropdown(true);
      return;
    }

    this.panelOpen = true;
    this.emitOpenState();
  }

  onSearchInput() {
    if (this.locked) {
      this.lockedAttempt.emit();
      this.closeDropdown(true);
      return;
    }

    this.panelOpen = true;

    if (!this.searchQuery.trim()) {
      this.filteredResults = [];
      this.emitOpenState();
      return;
    }

    this.filteredResults = this.filterByQuery(this.searchQuery);
    this.emitOpenState();
  }

  private filterByQuery(query: string): Destination[] {
    const q = this.normalize(query);
    return this.destinationList.filter(dest =>
      this.normalize(this.displayName(dest)).includes(q)
    );
  }

  normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ς/g, 'σ');
  }

  clearSearch() {
    this.closeDropdown(true);
  }

  async selectDestination(destination: Destination) {
    if (this.locked) {
      this.lockedAttempt.emit();
      await this.closeDropdown(true);
      return;
    }

    this.pushRecent(destination);
    this.destinationSelected.emit(destination);

    await this.closeDropdown(true);
  }

  // -----------------------------
  // ✅ RECENTS (by id)
  // -----------------------------
  private loadRecents() {
    try {
      const raw = localStorage.getItem(this.RECENTS_KEY);
      if (!raw) {
        this.recentResults = [];
        return;
      }

      const ids: string[] = JSON.parse(raw);

      const byId = new Map(this.destinationList.map(d => [d.id, d]));
      const recents: Destination[] = [];

      for (const id of ids) {
        const found = byId.get(id);
        if (found) recents.push(found);
      }

      this.recentResults = recents.slice(0, this.RECENTS_LIMIT);
    } catch {
      this.recentResults = [];
    }
  }

  private saveRecents() {
    try {
      const ids = this.recentResults.map(d => d.id).slice(0, this.RECENTS_LIMIT);
      localStorage.setItem(this.RECENTS_KEY, JSON.stringify(ids));
    } catch {}
  }

  private pushRecent(dest: Destination) {
    this.recentResults = [
      dest,
      ...this.recentResults.filter(d => d.id !== dest.id),
    ].slice(0, this.RECENTS_LIMIT);

    this.saveRecents();
  }

  clearRecents() {
    this.recentResults = [];
    try {
      localStorage.removeItem(this.RECENTS_KEY);
    } catch {}

    if (!this.searchQuery.trim()) {
      this.panelOpen = false;
      this.searchOpenChange.emit(false);
    } else {
      this.emitOpenState();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.elRef.nativeElement.contains(event.target)) {
      this.closeDropdown(true);
    }
  }
}
