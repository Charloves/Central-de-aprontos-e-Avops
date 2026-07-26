import { describe, expect, it } from 'vitest';
import { buildRoleTransfer, INITIAL_ADMIN_ASSIGNMENT } from './roles';

describe('roles', () => {
  it('define CHA como admin inicial', () => {
    expect(INITIAL_ADMIN_ASSIGNMENT).toMatchObject({
      trigram: 'CHA',
      roles: ['USER', 'COORDINATOR', 'ADMIN'],
    });
  });

  it('gera transferencia auditavel de coordenacao', () => {
    const result = buildRoleTransfer({ fromTrigram: 'CHA', toTrigram: 'ABC', actorTrigram: 'CHA' });
    expect(result.previous.roles).toEqual(['USER']);
    expect(result.next).toMatchObject({ trigram: 'ABC', roles: ['USER', 'COORDINATOR', 'ADMIN'] });
  });
});
