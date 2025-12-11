import {
  Component,
  EventEmitter,
  Output,
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

  // ενημερώνει τον γονέα (HomePage) αν το popup είναι ανοιχτό ή κλειστό
  @Output() searchOpenChange = new EventEmitter<boolean>();

  searchQuery = '';
  filteredResults: Destination[] = [];

  // κεντρική λίστα προορισμών από το model
  destinationList: Destination[] = destinationList;

  constructor(private elRef: ElementRef) {}

  // κάθε φορά που γράφει ο χρήστης
  onSearchInput() {
    const q = this.normalize(this.searchQuery);

    // αν είναι κενό input → κλείσε τη λίστα
    if (!q.trim()) {
      this.filteredResults = [];
      this.searchOpenChange.emit(false);
      return;
    }

    this.filteredResults = this.destinationList.filter(dest =>
      this.normalize(dest.name).includes(q)
    );

    // αν έχουμε αποτελέσματα → popup ανοιχτό
    this.searchOpenChange.emit(this.filteredResults.length > 0);
  }

  // απλοποιημένη αναζήτηση για ελληνικά
  normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ς/g, 'σ');
  }

  // καθαρισμός input + λίστας
  clearSearch() {
    this.searchQuery = '';
    this.filteredResults = [];
    this.searchOpenChange.emit(false);
  }

  // όταν ο χρήστης επιλέξει προορισμό
  selectDestination(destination: Destination) {
    this.destinationSelected.emit(destination);
    this.clearSearch();
  }

  // ΚΛΕΙΣΙΜΟ όταν γίνει click οπουδήποτε έξω από το component
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    // αν το click ΔΕΝ είναι μέσα στο στοιχείο του component
    if (!this.elRef.nativeElement.contains(event.target)) {
      this.clearSearch();
    }
  }
}
