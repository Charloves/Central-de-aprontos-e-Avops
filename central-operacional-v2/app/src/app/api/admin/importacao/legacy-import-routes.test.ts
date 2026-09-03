import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeDir = join(process.cwd(), 'src/app/api/admin/importacao');

describe('legacy import admin routes contract', () => {
  it('protects mutating routes with CSRF and authenticated server session', () => {
    for (const route of ['preview/route.ts', 'apply/route.ts', 'cancel/route.ts']) {
      const source = readFileSync(join(routeDir, route), 'utf8');
      expect(source).toContain('validateMutableRequest');
      expect(source).toContain('readSession');
      expect(source).toContain('process.env.APP_ORIGIN');
      expect(source).not.toContain('actor_profile_id');
    }
  });

  it('stores confirmation as HttpOnly cookie and never accepts token from the form body', () => {
    const preview = readFileSync(join(routeDir, 'preview/route.ts'), 'utf8');
    const apply = readFileSync(join(routeDir, 'apply/route.ts'), 'utf8');

    expect(preview).toContain('httpOnly: true');
    expect(preview).toContain("sameSite: 'lax'");
    expect(apply).toContain('decodeConfirmationCookie');
    expect(apply).not.toContain("formData.get('confirmation");
  });

  it('returns only a sanitized report download for ADMIN sessions', () => {
    const report = readFileSync(join(routeDir, 'report/route.ts'), 'utf8');

    expect(report).toContain('readSession');
    expect(report).toContain("roles.includes('ADMIN')");
    expect(report).toContain('relatorio-importacao-sanitizado.json');
    expect(report).not.toContain('original_content');
  });
});
