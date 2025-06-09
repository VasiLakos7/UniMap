import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Destination } from '../../models/destination.model';

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

  destinationList: Destination[] = [
    { name: 'Τμήμα Νοσηλευτικής', lat: 40.6575, lng: 22.8052 },
    { name: 'Τμήμα Μαιευτικής', lat: 40.6579, lng: 22.8041 },
    { name: 'Τμήμα Ηλεκτρονικών', lat: 40.6568, lng: 22.8035 },
    { name: 'Κεντρική Πύλη', lat: 40.6564, lng: 22.8028 },
    { name: 'Βιβλιοθήκη', lat: 40.6581, lng: 22.8049 }
  ];

  onSearchInput() {
    const query = this.normalize(this.searchQuery);
    this.filteredResults = this.destinationList
      .filter(dest => this.normalize(dest.name).includes(query));
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
