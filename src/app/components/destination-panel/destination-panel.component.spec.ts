import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { DestinationPanelComponent } from './destination-panel.component';

describe('DestinationPanelComponent', () => {
  let component: DestinationPanelComponent;
  let fixture: ComponentFixture<DestinationPanelComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [DestinationPanelComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DestinationPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
