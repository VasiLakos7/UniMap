import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

@Component({
  selector: 'app-destination-panel',
  standalone: true,
  imports: [IonicModule, CommonModule],
  templateUrl: './destination-panel.component.html',
  styleUrls: ['./destination-panel.component.scss']
})
export class DestinationPanelComponent {
  @Input() name!: string;
  @Input() distance!: number;
  @Output() navigate = new EventEmitter<void>();
}
