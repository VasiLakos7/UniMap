import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Destination } from '../../models/destination.model';

@Component({
  standalone: true,
  selector: 'app-department-popup',
  templateUrl: './department-popup.component.html',
  styleUrls: ['./department-popup.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class DepartmentPopupComponent {
  @Input() destination!: Destination;

  @Input() routeReady = false;
  @Input() navigationActive = false;
  @Input() hasArrived = false;

  // ✅ για να δείχνεις “Απόσταση: Χ μ” πριν το ΞΕΚΙΝΑ
  @Input() distanceMeters: number | null = null;

  @Output() navigate = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  getImage(): string {
    return this.destination?.image ?? 'assets/default-building.jpg';
  }

  getPhone(): string | null {
    return this.destination?.phone ?? null;
  }

  callNumber() {
    const phone = this.getPhone();
    if (!phone) return;
    window.open(`tel:${phone}`, '_system');
  }

  shareLocation() {
    if (!this.destination) return;

    const lat = this.destination.entranceLat ?? this.destination.lat;
    const lng = this.destination.entranceLng ?? this.destination.lng;
    const name = this.destination.name;

    const text = `Συνάντηση στο ${name} (${lat}, ${lng})`;
    const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;

    if (navigator.share) {
      navigator.share({ title: name, text, url }).catch(() => {});
      return;
    }

    // ✅ πιο “clean”: απλά copy, χωρίς message UI
    navigator.clipboard?.writeText(`${text}\n${url}`).catch(() => {});
  }
}
