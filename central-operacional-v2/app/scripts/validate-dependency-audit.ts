import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

type AuditVia = string | {
  source?: number;
  name?: string;
  url?: string;
  range?: string;
};

type AuditVulnerability = {
  name?: string;
  severity?: string;
  isDirect?: boolean;
  via?: AuditVia[];
  nodes?: string[];
};

export type AuditReport = {
  vulnerabilities?: Record<string, AuditVulnerability>;
  metadata?: {
    vulnerabilities?: {
      total?: number;
    };
  };
};

export type AuditValidation = {
  ok: boolean;
  messages: string[];
};

const BRACES_ADVISORY_SOURCE = 1240992;
const BRACES_ADVISORY_URL = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const ALLOWED_DEV_CHAIN = new Set([
  '@next/eslint-plugin-next',
  'braces',
  'eslint-config-next',
  'fast-glob',
  'micromatch',
]);

export function validateDependencyAudits(
  productionReport: AuditReport,
  completeReport: AuditReport,
): AuditValidation {
  const messages: string[] = [];
  const production = productionReport.vulnerabilities ?? {};
  if (Object.keys(production).length > 0 || vulnerabilityTotal(productionReport) > 0) {
    messages.push(`Production audit is not clean: ${sortedNames(production).join(', ') || 'unknown'}.`);
  }

  const complete = completeReport.vulnerabilities ?? {};
  const completeNames = Object.keys(complete);
  if (completeNames.length === 0 && vulnerabilityTotal(completeReport) === 0) {
    return { ok: messages.length === 0, messages };
  }

  const unexpectedNames = completeNames.filter((name) => !ALLOWED_DEV_CHAIN.has(name));
  if (unexpectedNames.length > 0) {
    messages.push(`Unexpected audit findings: ${unexpectedNames.sort().join(', ')}.`);
  }

  const braces = complete.braces;
  const advisory = braces?.via?.find((entry): entry is Exclude<AuditVia, string> => (
    typeof entry === 'object' && entry !== null && entry.source === BRACES_ADVISORY_SOURCE
  ));
  if (!braces || !advisory || advisory.url !== BRACES_ADVISORY_URL) {
    messages.push('The temporary braces advisory exception no longer matches the audited advisory.');
  }

  for (const [name, vulnerability] of Object.entries(complete)) {
    if (!ALLOWED_DEV_CHAIN.has(name)) continue;
    const unsupportedVia = (vulnerability.via ?? []).filter((entry) => {
      if (typeof entry === 'string') return !ALLOWED_DEV_CHAIN.has(entry);
      return entry.source !== BRACES_ADVISORY_SOURCE || entry.url !== BRACES_ADVISORY_URL;
    });
    if (unsupportedVia.length > 0) {
      messages.push(`Unexpected advisory source in ${name}.`);
    }
  }

  return { ok: messages.length === 0, messages };
}

function runAudit(extraArguments: string[]): AuditReport {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('npm CLI path is unavailable. Run this validator through npm.');

  const result = spawnSync(
    process.execPath,
    [npmCli, 'audit', '--offline=false', '--json', ...extraArguments],
    { encoding: 'utf8', env: process.env, maxBuffer: 10 * 1024 * 1024 },
  );
  if (!result.stdout) throw new Error('npm audit returned no JSON report.');
  try {
    return JSON.parse(result.stdout) as AuditReport;
  } catch {
    throw new Error('npm audit returned an invalid JSON report.');
  }
}

function vulnerabilityTotal(report: AuditReport): number {
  const total = report.metadata?.vulnerabilities?.total;
  return typeof total === 'number' && Number.isFinite(total) ? total : 0;
}

function sortedNames(vulnerabilities: Record<string, AuditVulnerability>): string[] {
  return Object.keys(vulnerabilities).sort();
}

function main() {
  const productionReport = runAudit(['--omit=dev']);
  const completeReport = runAudit([]);
  const validation = validateDependencyAudits(productionReport, completeReport);
  if (!validation.ok) {
    for (const message of validation.messages) process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  const completeNames = sortedNames(completeReport.vulnerabilities ?? {});
  process.stdout.write('Production dependency audit: clean.\n');
  if (completeNames.length === 0) {
    process.stdout.write('Complete dependency audit: clean.\n');
  } else {
    process.stdout.write('Complete dependency audit: only the documented dev-only braces advisory remains.\n');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
