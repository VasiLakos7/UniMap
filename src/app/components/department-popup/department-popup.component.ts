import {
  Component, Input, Output, EventEmitter,
  AfterViewInit, ElementRef, ViewChild, NgZone,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Destination } from '../../models/destination.model';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Browser } from '@capacitor/browser';

@Component({
  standalone: true,
  selector: 'app-department-popup',
  templateUrl: './department-popup.component.html',
  styleUrls: ['./department-popup.component.scss'],
  imports: [IonicModule, CommonModule, TranslateModule],
})
export class DepartmentPopupComponent implements AfterViewInit, OnDestroy {
  @Input() destination!: Destination;
  @Input() routeReady = false;
  @Input() navigationActive = false;
  @Input() hasArrived = false;
  @Input() outsideCampus = false;
  @Input() startDisabled = false;

  @Input() meters: number | null = null;
  @Input() etaMin: number | null = null;
  @Input() units: 'm' | 'km' = 'm';

  @Output() directions = new EventEmitter<void>();
  @Output() navigate = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();
  @Output() heightChange = new EventEmitter<number>();

  @ViewChild('sheet', { read: ElementRef }) sheetRef!: ElementRef<HTMLElement>;

  private sheetRO?: ResizeObserver;

  constructor(private zone: NgZone, private translate: TranslateService) {}

  get isBrowseMode(): boolean {
    return !this.routeReady && !this.navigationActive && !this.hasArrived;
  }

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      const el = this.sheetRef?.nativeElement;
      if (!el) return;

      this.sheetRO = new ResizeObserver((entries) => {
        const h = Math.ceil(entries[0]?.contentRect?.height ?? 0);
        this.zone.run(() => this.heightChange.emit(h));
      });
      this.sheetRO.observe(el);
    });
  }

  ngOnDestroy(): void {
    this.sheetRO?.disconnect();
    this.sheetRO = undefined;
  }

  onClose() { this.close.emit(); }
  onExit()  { this.cancel.emit(); }
  onStart() { if (!this.startDisabled) this.navigate.emit(); }
  onDirections() { this.directions.emit(); }

  getImage(): string {
    return this.destination?.image ?? 'assets/images/branding/logo.svg';
  }

  getPhone(): string | null {
    return this.destination?.phone ?? null;
  }

  callNumber() {
    const phone = this.getPhone();
    if (!phone) return;
    window.location.href = `tel:${phone}`;
  }

  async shareLocation() {
    const lat = this.destination?.entranceLat ?? this.destination?.lat;
    const lng = this.destination?.entranceLng ?? this.destination?.lng;
    if (lat == null || lng == null) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    await Browser.open({ url });
  }

  formatDistance(meters: number | null): string {
    if (meters == null) return '—';
    const unitM = this.translate.instant('SETTINGS.UNITS.M');
    const unitKM = this.translate.instant('SETTINGS.UNITS.KM');
    if (this.units === 'km') {
      const km = meters / 1000;
      const decimals = km < 1 ? 2 : (km < 10 ? 1 : 0);
      return `${km.toFixed(decimals)} ${unitKM}`;
    }
    return `${Math.max(0, Math.round(meters))} ${unitM}`;
  }

  async openWebsite(): Promise<void> {
    const url = this.destination?.website;
    if (!url) return;
    await Browser.open({ url });
  }
}
