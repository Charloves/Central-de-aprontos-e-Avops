import type { Role } from '@/lib/domain/types';
import { normalizeTrigram } from '@/lib/domain/normalization';

export type RoleAssignment = {
  trigram: string;
  roles: Role[];
  updatedBy: string;
  reason: string;
};

export const INITIAL_ADMIN_ASSIGNMENT: RoleAssignment = {
  trigram: 'CHA',
  roles: ['USER', 'COORDINATOR', 'ADMIN'],
  updatedBy: 'SYSTEM_SEED',
  reason: 'Coordenador e administrador inicial da V2.',
};

export function buildRoleTransfer(input: {
  fromTrigram: string;
  toTrigram: string;
  actorTrigram: string;
  keepOldAsUser?: boolean;
}): { previous: RoleAssignment; next: RoleAssignment } {
  const from = normalizeTrigram(input.fromTrigram);
  const to = normalizeTrigram(input.toTrigram);
  const actor = normalizeTrigram(input.actorTrigram);

  if (!from || !to || !actor) throw new Error('Trigramas de origem, destino e operador são obrigatórios.');
  if (from === to) throw new Error('O novo coordenador deve ser diferente do coordenador atual.');

  return {
    previous: {
      trigram: from,
      roles: input.keepOldAsUser === false ? [] : ['USER'],
      updatedBy: actor,
      reason: `Transferência de coordenação para ${to}.`,
    },
    next: {
      trigram: to,
      roles: ['USER', 'COORDINATOR', 'ADMIN'],
      updatedBy: actor,
      reason: `Recebeu coordenação de ${from}.`,
    },
  };
}
