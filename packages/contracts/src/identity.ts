export type UserRole = 'ADMIN' | 'DISPATCHER' | 'CREW_MEMBER';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  active: boolean;
}

export interface AuthUser extends PublicUser {
  crewIds: string[];
}

export interface AuthResponse {
  user: AuthUser;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface MessageResponse {
  message: string;
}

export interface UsersResponse {
  users: AuthUser[];
}

export interface CreateUserRequest {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
  active?: boolean;
}

export interface UpdateUserRequest {
  displayName?: string;
  password?: string;
  role?: UserRole;
  active?: boolean;
}
