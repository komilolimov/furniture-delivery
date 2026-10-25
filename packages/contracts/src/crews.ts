import type { PublicUser } from './identity';

export type WorkEnvironment = 'INDOOR' | 'OUTDOOR';

export interface CrewSummary {
  id: string;
  code: string;
  name: string;
  active: boolean;
  workEnvironment: WorkEnvironment;
  serviceArea: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrewMembership {
  id: string;
  userId: string;
  crewId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  user: PublicUser;
}

export interface ExternalContact {
  id: string;
  crewId: string;
  name: string;
  specialty: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CrewDetail extends CrewSummary {
  members: CrewMembership[];
  contacts: ExternalContact[];
}

export interface CrewListResponse {
  crews: CrewSummary[];
}

export interface CrewResponse {
  crew: CrewDetail;
}

export interface MemberCandidatesResponse {
  users: PublicUser[];
}

export interface CreateCrewRequest {
  code: string;
  name: string;
  workEnvironment: WorkEnvironment;
  serviceArea: string;
  active?: boolean;
}

export interface UpdateCrewRequest {
  name?: string;
  workEnvironment?: WorkEnvironment;
  serviceArea?: string;
  active?: boolean;
}

export interface AddCrewMemberRequest {
  userId: string;
}

export interface UpdateCrewMembershipRequest {
  active: boolean;
}

export interface CreateExternalContactRequest {
  name: string;
  specialty: string;
  phone?: string | null;
  email?: string | null;
  active?: boolean;
}

export interface UpdateExternalContactRequest {
  name?: string;
  specialty?: string;
  phone?: string | null;
  email?: string | null;
  active?: boolean;
}
