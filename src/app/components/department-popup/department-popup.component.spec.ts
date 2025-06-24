import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { DepartmentPopupComponent } from './department-popup.component';

describe('DepartmentPopupComponent', () => {
  let component: DepartmentPopupComponent;
  let fixture: ComponentFixture<DepartmentPopupComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [DepartmentPopupComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DepartmentPopupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
