import {
  Component,
  EventEmitter,
  Output,
  Input,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, IonSearchbar } from '@ionic/angular';
import { Destination, destinationList } from '../../models/destination.model';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss'],
})
export class SearchBarComponent implements OnInit {
  @Output() destinationSelected = new EventEmitter<Destination>();
  @Output() searchOpenChange = new EventEmitter<boolean>();

  // ✅ όταν ο χρήστης προσπαθεί να ψάξει ενώ είναι locked
  @Output() lockedAttempt = new EventEmitter<void>();

  // ✅ ζητάει ακύρωση (πατάει Ακύρωση στο pill)
  @Output() cancelRequested = new EventEmitter<void>();

  // ✅ lock από HomePage
  @Input() locked = false;

  // ✅ pill ορατό/κείμενο
  @Input() showLockBadge = false;
  @Input() lockBadgeText = '🔒 Διαδρομή ενεργή';
  @Input() placeholderText = 'Προορισμός...';

  @ViewChild(IonSearchbar) sb?: IonSearchbar;

  searchQuery = '';
  filteredResults: Destination[] = [];
  destinationList: Destination[] = destinationList;

  // ✅ Recents
  recentResults: Destination[] = [];
  private readonly RECENTS_KEY = 'unimap_recent_destinations_v1';
  private readonly RECENTS_LIMIT = 6;

  // ✅ dropdown ανοικτό μόνο όταν ο χρήστης κάνει focus/γράφει
  panelOpen = false;

  constructor(private elRef: ElementRef) {}

  ngOnInit(): void {
    this.loadRecents();
    this.panelOpen = false;
    this.searchOpenChange.emit(false);
  }

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

    const q = this.normalize(this.searchQuery);
    this.panelOpen = true;

    // άδειο query -> δείξε recents (αν υπάρχουν)
    if (!q.trim()) {
      this.filteredResults = [];
      this.emitOpenState();
      return;
    }

    this.filteredResults = this.destinationList.filter((dest) =>
      this.normalize(dest.name).includes(q)
    );

    this.emitOpenState();
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

    // ✅ κλείνει αμέσως dropdown + keyboard
    await this.closeDropdown(true);
  }

  // -----------------------------
  // ✅ RECENTS
  // -----------------------------
  private loadRecents() {
    try {
      const raw = localStorage.getItem(this.RECENTS_KEY);
      if (!raw) {
        this.recentResults = [];
        return;
      }

      const names: string[] = JSON.parse(raw);

      // name -> Destination (από τρέχον destinationList)
      const byName = new Map(this.destinationList.map((d) => [d.name, d]));
      const recents: Destination[] = [];

      for (const n of names) {
        const found = byName.get(n);
        if (found) recents.push(found);
      }

      this.recentResults = recents.slice(0, this.RECENTS_LIMIT);
    } catch {
      this.recentResults = [];
    }
  }

  private saveRecents() {
    try {
      const names = this.recentResults.map((d) => d.name).slice(0, this.RECENTS_LIMIT);
      localStorage.setItem(this.RECENTS_KEY, JSON.stringify(names));
    } catch {}
  }

  private pushRecent(dest: Destination) {
    this.recentResults = [
      dest,
      ...this.recentResults.filter((d) => d.name !== dest.name),
    ].slice(0, this.RECENTS_LIMIT);

    this.saveRecents();
  }

  clearRecents() {
    this.recentResults = [];
    try {
      localStorage.removeItem(this.RECENTS_KEY);
    } catch {}

    // αν δεν γράφει κάτι, κλείσε dropdown
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
