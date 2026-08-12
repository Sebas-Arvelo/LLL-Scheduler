import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ACTIVITY_CATALOG } from './activity-catalog';
import { buildSchedule } from './scheduler';
import { Assignment, CampActivity, CampGroup, CampGroupConfig, DailyPlan, SeasonOption } from './models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  readonly seasons: SeasonOption[] = [
    { id: 'season-1', label: 'Temporada 1', days: 14 },
    { id: 'season-2', label: 'Temporada 2', days: 21 },
    { id: 'season-3', label: 'Temporada 3', days: 14 },
    { id: 'season-4', label: 'Temporada 4', days: 7 },
  ];

  readonly groupTemplates: CampGroupConfig[] = [
    { key: 'sabana', label: 'Cabañas de Sabana', count: 12 },
    { key: 'bosque', label: 'Cabañas de Bosque', count: 12 },
    { key: 'aventura', label: 'Grupos de Aventura', count: 6 },
    { key: 'cit', label: 'Grupos de CIT', count: 6 },
  ];

  seasonId = 'season-1';
  seed = 2026;
  activitySearch = '';
  groupInputs = {
    sabana: 12,
    bosque: 12,
    aventura: 6,
    cit: 6,
  };

  activities: CampActivity[] = ACTIVITY_CATALOG.map((activity) => ({ ...activity }));
  generatedPlan: DailyPlan[] = [];

  ngOnInit(): void {
    this.rebuildPlan();
  }

  get selectedSeason(): SeasonOption {
    return this.seasons.find((season) => season.id === this.seasonId) ?? this.seasons[0];
  }

  get totalGroups(): number {
    return this.buildGroups().length;
  }

  get enabledActivities(): CampActivity[] {
    const search = this.activitySearch.trim().toLowerCase();
    return this.activities.filter((activity) => {
      const matchesSearch = search.length === 0 || activity.name.toLowerCase().includes(search) || activity.category.toLowerCase().includes(search);
      return matchesSearch;
    });
  }

  get totalCapacity(): number {
    return this.activities.filter((activity) => activity.enabled).reduce((sum, activity) => sum + Math.max(1, activity.capacity), 0);
  }

  onGroupCountChange(): void {
    this.rebuildPlan();
  }

  getGroupCount(key: string): number {
    return this.groupInputs[key as keyof typeof this.groupInputs];
  }

  setGroupCount(key: string, value: number): void {
    this.groupInputs[key as keyof typeof this.groupInputs] = Number(value);
    this.rebuildPlan();
  }

  onSeasonChange(): void {
    this.rebuildPlan();
  }

  onActivityChange(): void {
    this.rebuildPlan();
  }

  onSeedChange(): void {
    this.rebuildPlan();
  }

  toggleActivity(activity: CampActivity): void {
    activity.enabled = !activity.enabled;
    this.rebuildPlan();
  }

  rebuildPlan(): void {
    this.generatedPlan = buildSchedule(this.buildGroups(), this.activities, this.selectedSeason.days, this.seed);
  }

  buildGroups(): CampGroup[] {
    return this.groupTemplates.flatMap((template) => {
      const count = this.groupInputs[template.key as keyof typeof this.groupInputs];
      return Array.from({ length: Math.max(0, count) }, (_, index) => ({
        id: `${template.key}-${index + 1}`,
        name: `${template.label} ${index + 1}`,
        category: template.label,
      }));
    });
  }

  getCycleLength(): number {
    return this.activities.filter((activity) => activity.enabled).length;
  }

  trackByActivityId(_: number, activity: CampActivity): string {
    return activity.id;
  }

  trackByDay(_: number, plan: DailyPlan): number {
    return plan.day;
  }

  trackByGroupId(_: number, assignment: Assignment): string {
    return assignment.group.id;
  }
}
