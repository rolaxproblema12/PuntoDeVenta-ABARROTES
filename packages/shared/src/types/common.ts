import type { UserRole } from '../enums.js';

export type UUID = string;
export type ISODateString = string;

export interface AuditFields {
  created_at: ISODateString;
  created_by: UUID | null;
  updated_at: ISODateString | null;
}

export interface Sucursal {
  id: UUID;
  code: string;
  name: string;
  address: string | null;
  currency: string;
  timezone: string;
  active: boolean;
  settings: Record<string, unknown>;
}

export interface Profile {
  id: UUID;
  full_name: string;
  email: string;
  role: UserRole;
  active: boolean;
  default_sucursal_id: UUID | null;
}

/** Usuario autenticado tal como lo expone la API en `request.user`. */
export interface AuthUser {
  id: UUID;
  email: string;
  role: UserRole;
  active: boolean;
  sucursalIds: UUID[];
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
