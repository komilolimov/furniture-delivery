import { ConflictException } from '@nestjs/common';

export interface PlanningConflictDetails {
  crewId?: string;
  appointmentId?: string;
  from?: string;
  to?: string;
}

/** Only explicitly safe planning details may be reflected by the API error filter. */
export class PlanningConflict extends ConflictException {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: PlanningConflictDetails = {},
  ) {
    super({ message, code, details });
  }
}
