import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Destination, destinationList } from '../../models/destination.model';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent {
  @Output() destinationSelected = new EventEmitter<Destination>();

  searchQuery = '';
  filteredResults: Destination[] = [];

  // χρήση της κεντρικής λίστας από το model (όχι δεύτερο αντίγραφο)
  destinationList: Destination[] = destinationList;

  onSearchInput() {
    const q = this.normalize(this.searchQuery);
    this.filteredResults = this.destinationList.filter(dest => this.normalize(dest.name).includes(q));
  }

  normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ς/g, 'σ');
  }

  selectDestination(destination: Destination) {
    this.searchQuery = '';
    this.filteredResults = [];
    this.destinationSelected.emit(destination);
  }
}
