import { describe, expect, it } from 'vitest';

import { type AuditReport, validateDependencyAudits } from './validate-dependency-audit.ts';

const cleanReport: AuditReport = {
  vulnerabilities: {},
  metadata: { vulnerabilities: { total: 0 } },
};

const knownDevReport: AuditReport = {
  vulnerabilities: {
    braces: {
      via: [{
        source: 1240992,
        name: 'braces',
        url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
        range: '<=3.0.3',
      }],
    },
    micromatch: { via: ['braces'] },
    'fast-glob': { via: ['micromatch'] },
    '@next/eslint-plugin-next': { via: ['fast-glob'] },
    'eslint-config-next': { via: ['@next/eslint-plugin-next'] },
  },
  metadata: { vulnerabilities: { total: 5 } },
};

describe('dependency audit validation', () => {
  it('accepts a completely clean audit', () => {
    expect(validateDependencyAudits(cleanReport, cleanReport)).toEqual({ ok: true, messages: [] });
  });

  it('accepts only the documented dev-only braces advisory chain', () => {
    expect(validateDependencyAudits(cleanReport, knownDevReport)).toEqual({ ok: true, messages: [] });
  });

  it('rejects any production vulnerability', () => {
    const production: AuditReport = {
      vulnerabilities: { sharp: { via: [] } },
      metadata: { vulnerabilities: { total: 1 } },
    };
    expect(validateDependencyAudits(production, knownDevReport).ok).toBe(false);
  });

  it('rejects an additional full-audit finding', () => {
    const complete: AuditReport = {
      ...knownDevReport,
      vulnerabilities: {
        ...knownDevReport.vulnerabilities,
        unexpected: { via: [] },
      },
    };
    expect(validateDependencyAudits(cleanReport, complete).ok).toBe(false);
  });

  it('rejects a changed braces advisory instead of silently broadening the exception', () => {
    const complete: AuditReport = {
      vulnerabilities: {
        braces: {
          via: [{ source: 9999999, url: 'https://example.test/different-advisory' }],
        },
      },
      metadata: { vulnerabilities: { total: 1 } },
    };
    expect(validateDependencyAudits(cleanReport, complete).ok).toBe(false);
  });
});
