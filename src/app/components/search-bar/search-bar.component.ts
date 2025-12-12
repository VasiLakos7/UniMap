import {
  Component,
  EventEmitter,
  Output,
  Input,
  ElementRef,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Destination, destinationList } from '../../models/destination.model';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss'],
})
export class SearchBarComponent {
  @Output() destinationSelected = new EventEmitter<Destination>();
  @Output() searchOpenChange = new EventEmitter<boolean>();

  // ✅ όταν είναι locked, δεν επιτρέπουμε αναζήτηση/επιλογή
  @Input() locked = false;

  searchQuery = '';
  filteredResults: Destination[] = [];
  destinationList: Destination[] = destinationList;

  constructor(private elRef: ElementRef) {}

  onSearchInput() {
    if (this.locked) {
      this.clearSearch();
      return;
    }

    const q = this.normalize(this.searchQuery);

    if (!q.trim()) {
      this.filteredResults = [];
      this.searchOpenChange.emit(false);
      return;
    }

    this.filteredResults = this.destinationList.filter(dest =>
      this.normalize(dest.name).includes(q)
    );

    this.searchOpenChange.emit(this.filteredResults.length > 0);
  }

  normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ς/g, 'σ');
  }

  clearSearch() {
    this.searchQuery = '';
    this.filteredResults = [];
    this.searchOpenChange.emit(false);
  }

  selectDestination(destination: Destination) {
    if (this.locked) return;

    this.destinationSelected.emit(destination);
    this.clearSearch();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.elRef.nativeElement.contains(event.target)) {
      this.clearSearch();
    }
  }
}
