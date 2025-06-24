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
    if (navigator.share) {
      navigator.share({ title: 'UniMap', text });
    } else {
      alert(text);
    }
  }
}
