import {
  Component, Input, Output, EventEmitter,
  AfterViewInit, ElementRef, ViewChild, NgZone,
  OnChanges, SimpleChanges, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { createGesture, Gesture } from '@ionic/core';
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
export class DepartmentPopupComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() destination!: Destination;
  @Input() routeReady = false;
  @Input() navigationActive = false;
  @Input() hasArrived = false;
  @Input() outsideCampus = false;
  @Input() startDisabled = false;


  @Input() meters: number | null = null;
  @Input() etaMin: number | null = null;

  @Input() units: 'm' | 'km' = 'm';

  // directions output
  @Output() directions = new EventEmitter<void>();

  @Output() navigate = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  @ViewChild('sheet', { read: ElementRef }) sheetRef!: ElementRef<HTMLElement>;

  expanded = true;

  private gesture?: Gesture;
  private maxUp = 0;
  private collapsedY = 0;
  private currentY = 0;

  private ready = false;
  private pendingCollapse = false;

  constructor(
    private zone: NgZone,
    private translate: TranslateService
  ) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      const el = this.sheetRef?.nativeElement;
      if (!el) return;

      this.maxUp = Math.min(Math.round(window.innerHeight * 0.42), 340);
      el.style.setProperty('--sheet-max', `${this.maxUp}px`);

      this.gesture = createGesture({
        el,
        gestureName: 'um-sheet',
        direction: 'y',
        threshold: 0,
        onMove: (detail) => {
          const y = this.clamp(this.currentY + detail.deltaY, 0, this.collapsedY);
          el.style.transform = `translateY(${y}px)`;
        },
        onEnd: (detail) => {
          const endY = this.clamp(this.currentY + detail.deltaY, 0, this.collapsedY);
          const snapToCollapsed = endY > this.collapsedY * 0.55 || detail.velocityY > 0.35;
          const target = snapToCollapsed ? this.collapsedY : 0;
          this.snapTo(target);
        },
      });

      this.gesture.enable(true);

      requestAnimationFrame(() => {
        this.recalcSnapPoints();
        this.ready = true;

        if (this.pendingCollapse) {
          this.pendingCollapse = false;
          this.snapTo(this.collapsedY);
        }

        this.zone.run(() => (this.expanded = true));
      });
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    const modeChanged =
      !!changes['navigationActive'] || !!changes['hasArrived'] || !!changes['destination'];

    if (modeChanged && this.sheetRef?.nativeElement) {
      setTimeout(() => this.recalcSnapPoints(), 0);
    }

    if (changes['navigationActive'] && this.navigationActive && !this.hasArrived) {
      if (this.ready) this.snapTo(this.collapsedY);
      else this.pendingCollapse = true;
    }
  }

  ngOnDestroy(): void {
    try { this.gesture?.destroy(); } catch {}
    this.gesture = undefined;
  }

  toggleExpand() {
    const target = this.expanded ? this.collapsedY : 0;
    this.snapTo(target);
  }

  private snapTo(target: number) {
    const el = this.sheetRef?.nativeElement;
    if (!el) return;

    el.style.transition = 'transform 180ms ease';
    el.style.transform = `translateY(${target}px)`;
    setTimeout(() => (el.style.transition = ''), 200);

    this.currentY = target;

    this.zone.run(() => {
      this.expanded = target === 0;
    });
  }

  private clamp(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
  }

  onClose() {
    this.close.emit();
  }

  onExit() {
    this.cancel.emit();
  }

  onStart() {
    if (this.startDisabled) return;
    this.navigate.emit();
  }

  // directions handler
  onDirections() {
    this.directions.emit();
  }

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
      const txt = km.toFixed(decimals);
      return `${txt} ${unitKM}`;
    }

    return `${Math.max(0, Math.round(meters))} ${unitM}`;
  }


  private recalcSnapPoints() {
    const el = this.sheetRef?.nativeElement;
    if (!el) return;

    const effectiveH = Math.min(el.scrollHeight, this.maxUp);
    const peek = (this.navigationActive && !this.hasArrived) ? 90 : 130;

    this.collapsedY = Math.max(0, effectiveH - peek);

    this.currentY = this.clamp(this.currentY, 0, this.collapsedY);
    el.style.transform = `translateY(${this.currentY}px)`;
  }

  async openWebsite(): Promise<void> {
    const url = this.destination?.website;
    if (!url) return;
    await Browser.open({ url });
  } 

}
