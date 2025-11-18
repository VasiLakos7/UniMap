import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Destination } from '../../models/destination.model';

@Component({
  selector: 'app-department-popup',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './department-popup.component.html',
  styleUrls: ['./department-popup.component.scss']
})
export class DepartmentPopupComponent {
  @Input() destination!: Destination;
  @Output() navigate = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  shareMessage: string | null = null; 

  getImage(): string {
    return this.destination.image && this.destination.image.trim() !== ''
      ? this.destination.image
      : 'assets/images/dipae_logo.png';
  }

  getPhone(): string {
    return this.destination.phone ?? '';
  }

  callNumber(): void {
    const phone = this.getPhone();
    if (phone) {
      window.open(`tel:${phone}`, '_system');
    }
  }

  shareLocation(): void {
    const text = `Δες πού βρίσκεται το ${this.destination.name} στην Πανεπιστημιούπολη του ΔΙΠΑΕ!`;
    const shareUrl = `https://maps.google.com/?q=${this.destination.lat},${this.destination.lng}`;
    
    if (navigator.share) {
      navigator.share({
        title: 'UniMap - Κοινοποίηση Προορισμού', 
        text: text,
        url: shareUrl
      }).catch(error => console.error('Error sharing:', error));
    } else {
      console.warn('Web Share API not supported. Please copy the text manually:', text);
      this.shareMessage = `Αντιγραφή κειμένου: ${text} - URL: ${shareUrl}`; 
    }
  }
}