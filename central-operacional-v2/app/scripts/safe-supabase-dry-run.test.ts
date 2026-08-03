import { describe, expect, it } from 'vitest';
import { runSafeSupabaseDryRun } from './safe-supabase-dry-run';

const VALID_PROJECT_REF = 'abcdefghijklmnopqrst';
const OTHER_PROJECT_REF = 'tsrqponmlkjihgfedcba';
const CWD = 'C:/repo/app';
const LOCAL_NODE = 'C:/Program Files/nodejs/node.exe';
const LOCAL_SUPABASE_ENTRYPOINT = 'C:/repo/app/node_modules/supabase/dist/supabase.js';

type HarnessOptions = {
  env?: Record<string, string | undefined>;
  argv?: string[];
  linkedProjectRef?: string | null;
  dotEnvLocal?: string | null;
  spawnStatus?: number;
  spawnError?: Error;
  cwd?: string;
  supabaseCommand?: string;
  supabaseArgsPrefix?: string[];
};

function runHarness(options: HarnessOptions = {}) {
  const calls: Array<{
    command: string;
    args: string[];
    options: { cwd: string; stdio: 'inherit'; shell: boolean };
  }> = [];
  const output: string[] = [];
  const linkedPathSuffix = 'supabase/.temp/project-ref';
  const envPathSuffix = '.env.local';

  const status = runSafeSupabaseDryRun({
    cwd: options.cwd ?? CWD,
    env: options.env ?? {
      SUPABASE_DEV_PROJECT_REF: VALID_PROJECT_REF,
      SUPABASE_TARGET_ENV: 'development',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-that-must-not-be-printed',
    },
    supabaseCommand: options.supabaseCommand ?? LOCAL_NODE,
    supabaseArgsPrefix: options.supabaseArgsPrefix ?? [LOCAL_SUPABASE_ENTRYPOINT],
    argv: options.argv ?? ['node', 'scripts/safe-supabase-dry-run.ts'],
    exists: (path) => {
      const normalized = path.replace(/\\/g, '/');
      if (normalized.endsWith(linkedPathSuffix)) return options.linkedProjectRef !== null;
      if (normalized.endsWith(envPathSuffix)) return options.dotEnvLocal !== null && options.dotEnvLocal !== undefined;
      return false;
    },
    readFile: (path) => {
      const normalized = path.replace(/\\/g, '/');
      if (normalized.endsWith(linkedPathSuffix)) return options.linkedProjectRef ?? VALID_PROJECT_REF;
      if (normalized.endsWith(envPathSuffix)) return options.dotEnvLocal ?? '';
      throw new Error(`Unexpected read: ${path}`);
    },
    spawn: (command, args, spawnOptions) => {
      calls.push({ command, args, options: spawnOptions });
      return {
        status: options.spawnStatus ?? 0,
        signal: null,
        error: options.spawnError,
      };
    },
    log: (message) => output.push(message),
    error: (message) => output.push(message),
  });

  return { status, calls, output: output.join('\n') };
}

describe('safe Supabase dry-run wrapper', () => {
  it('falha quando SUPABASE_DEV_PROJECT_REF esta ausente', () => {
    const result = runHarness({
      env: { SUPABASE_TARGET_ENV: 'development' },
      linkedProjectRef: VALID_PROJECT_REF,
    });

    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(0);
  });

  it('rejeita ambiente diferente de development', () => {
    for (const targetEnv of ['production', 'prod', 'homologation', 'staging']) {
      const result = runHarness({
        env: { SUPABASE_DEV_PROJECT_REF: VALID_PROJECT_REF, SUPABASE_TARGET_ENV: targetEnv },
        linkedProjectRef: VALID_PROJECT_REF,
      });
      expect(result.status).toBe(1);
      expect(result.calls).toHaveLength(0);
    }
  });

  it('falha quando nao ha projeto linkado', () => {
    const result = runHarness({ linkedProjectRef: null });

    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(0);
  });

  it('falha quando project ref linkado diverge do esperado', () => {
    const result = runHarness({ linkedProjectRef: OTHER_PROJECT_REF });

    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(0);
  });

  it('aceita project ref correspondente a partir de .env.local', () => {
    const result = runHarness({
      env: {},
      dotEnvLocal: `SUPABASE_DEV_PROJECT_REF=${VALID_PROJECT_REF}\nSUPABASE_TARGET_ENV=development\n`,
      linkedProjectRef: VALID_PROJECT_REF,
    });

    expect(result.status).toBe(0);
    expect(result.calls).toMatchObject([{ command: LOCAL_NODE, args: [LOCAL_SUPABASE_ENTRYPOINT, 'db', 'push', '--dry-run'] }]);
    expect(result.output).toContain(`project_ref=${VALID_PROJECT_REF}`);
    expect(result.output).toContain('env=development');
  });

  it('nao aceita argumentos externos que possam remover dry-run', () => {
    const result = runHarness({
      argv: ['node', 'scripts/safe-supabase-dry-run.ts', '--include-all'],
      linkedProjectRef: VALID_PROJECT_REF,
    });

    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(0);
  });

  it('propaga codigo de falha da CLI', () => {
    const result = runHarness({ linkedProjectRef: VALID_PROJECT_REF, spawnStatus: 42 });

    expect(result.status).toBe(42);
    expect(result.calls).toMatchObject([{ command: LOCAL_NODE, args: [LOCAL_SUPABASE_ENTRYPOINT, 'db', 'push', '--dry-run'] }]);
  });

  it('nao imprime segredo na saida do wrapper e nao captura stdout/stderr da CLI', () => {
    const result = runHarness({ linkedProjectRef: VALID_PROJECT_REF });

    expect(result.status).toBe(0);
    expect(result.output).not.toContain('service-role-secret-that-must-not-be-printed');
    expect(result.calls[0]?.options.stdio).toBe('inherit');
  });

  it('garante que db push real, db reset e seed nunca sao chamados', () => {
    const result = runHarness({ linkedProjectRef: VALID_PROJECT_REF });
    const commandLine = result.calls.map((call) => [call.command, ...call.args].join(' ')).join('\n');

    expect(result.calls[0]?.args.slice(-3)).toEqual(['db', 'push', '--dry-run']);
    expect(commandLine).not.toContain('db reset');
    expect(commandLine).not.toContain('seed');
    expect(commandLine).not.toBe(`${LOCAL_NODE} ${LOCAL_SUPABASE_ENTRYPOINT} db push`);
  });

  it('rejeita project refs com espacos, quebras de linha ou caracteres invalidos', () => {
    for (const projectRef of [' abcdefghijklmnopqrst ', 'abcdefghijklmnopqrs\n', 'abcdefghijklmnopqrs-', 'ABCDEFGHIJKLMNOPQRST']) {
      const result = runHarness({
        env: { SUPABASE_DEV_PROJECT_REF: projectRef, SUPABASE_TARGET_ENV: 'development' },
        linkedProjectRef: projectRef,
      });

      expect(result.status).toBe(1);
      expect(result.calls).toHaveLength(0);
    }
  });

  it('resolve project-ref dentro da pasta app/supabase', () => {
    const result = runHarness({ linkedProjectRef: VALID_PROJECT_REF });

    expect(result.status).toBe(0);
    expect(result.calls[0]?.options.cwd).toBe(CWD);
  });

  it('executa no Windows sem shell quando o caminho absoluto contem Charles Angelo', () => {
    const windowsAppRoot = 'C:/Users/Charles Angelo/OneDrive/Documentos/Google AppScript/Central Operacional/central-operacional-v2/app';
    const windowsNode = 'C:/Program Files/nodejs/node.exe';
    const windowsSupabaseEntrypoint = `${windowsAppRoot}/node_modules/supabase/dist/supabase.js`;
    const result = runHarness({
      cwd: windowsAppRoot,
      supabaseCommand: windowsNode,
      supabaseArgsPrefix: [windowsSupabaseEntrypoint],
      linkedProjectRef: VALID_PROJECT_REF,
    });

    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toEqual({
      command: windowsNode,
      args: [windowsSupabaseEntrypoint, 'db', 'push', '--dry-run'],
      options: { cwd: windowsAppRoot, stdio: 'inherit', shell: false },
    });
  });

  it('preserva caminho com multiplos espacos como argumento separado', () => {
    const spacedAppRoot = 'C:/Users/Charles Angelo/Projetos/Central Operacional V2/app';
    const spacedEntrypoint = `${spacedAppRoot}/node_modules/supabase/dist/supabase.js`;
    const result = runHarness({
      cwd: spacedAppRoot,
      supabaseCommand: LOCAL_NODE,
      supabaseArgsPrefix: [spacedEntrypoint],
      linkedProjectRef: VALID_PROJECT_REF,
    });

    expect(result.status).toBe(0);
    expect(result.calls[0]?.command).toBe(LOCAL_NODE);
    expect(result.calls[0]?.args).toEqual([spacedEntrypoint, 'db', 'push', '--dry-run']);
    expect(result.calls[0]?.options.shell).toBe(false);
  });

  it('executa em sistema nao Windows sem shell e sem shim .cmd', () => {
    const posixAppRoot = '/home/operator/central operacional v2/app';
    const posixNode = '/usr/local/bin/node';
    const posixSupabaseEntrypoint = `${posixAppRoot}/node_modules/supabase/dist/supabase.js`;
    const result = runHarness({
      cwd: posixAppRoot,
      supabaseCommand: posixNode,
      supabaseArgsPrefix: [posixSupabaseEntrypoint],
      linkedProjectRef: VALID_PROJECT_REF,
    });

    expect(result.status).toBe(0);
    expect(result.calls[0]).toEqual({
      command: posixNode,
      args: [posixSupabaseEntrypoint, 'db', 'push', '--dry-run'],
      options: { cwd: posixAppRoot, stdio: 'inherit', shell: false },
    });
    expect(result.calls[0]?.command).not.toContain('.cmd');
  });

  it('interrompe project ref divergente antes de qualquer chamada a CLI', () => {
    const result = runHarness({
      linkedProjectRef: OTHER_PROJECT_REF,
      cwd: 'C:/Users/Charles Angelo/Central Operacional/app',
      supabaseCommand: LOCAL_NODE,
      supabaseArgsPrefix: ['C:/Users/Charles Angelo/Central Operacional/app/node_modules/supabase/dist/supabase.js'],
    });

    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(0);
    expect(result.output).toContain('Project ref linkado difere');
  });
});
