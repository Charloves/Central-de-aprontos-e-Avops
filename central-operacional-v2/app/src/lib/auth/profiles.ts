import type { Profile, Role } from '@/lib/domain/types';

export type AuthProfile = Pick<Profile, 'id' | 'trigram' | 'name' | 'active'> & {
  roles: Role[];
};

export type ProfileRepository = {
  findByTrigram(trigram: string): Promise<AuthProfile | null>;
  findById(profileId: string): Promise<AuthProfile | null>;
};

export type LoginAuditContract = {
  action: 'LOGIN';
  status: 'OK' | 'NEGADO';
  reason:
    | 'VALID'
    | 'INVALID_CREDENTIALS'
    | 'INVALID_FORMAT'
    | 'INACTIVE'
    | 'BLOCKED'
    | 'SECURITY_ERROR'
    | 'CONFIG_ERROR';
  trigramHash: string | null;
  occurredAt: string;
};
