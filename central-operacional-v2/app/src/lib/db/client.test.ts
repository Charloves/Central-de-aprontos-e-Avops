import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from './client';

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ mocked: true })),
}));

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '../../..');
const envExample = readFileSync(resolve(appDir, '.env.example'), 'utf8');
const clientSource = readFileSync(resolve(__dirname, 'client.ts'), 'utf8');
const legacySecretEnvName = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
const publicSecretEnvName = ['NEXT_PUBLIC', 'SUPABASE', 'SECRET', 'KEY'].join('_');
const fakeModernSecret = ['sb', 'secret', 'development', 'test', 'key'].join('_');

const originalEnv = process.env;

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

function withEnv(env: Partial<NodeJS.ProcessEnv>) {
  process.env = { ...originalEnv, ...env };
}

describe('server Supabase client configuration', () => {
  it('uses SUPABASE_SECRET_KEY exclusively on the server', () => {
    withEnv({
      SUPABASE_URL: 'https://project.example.test',
      SUPABASE_SECRET_KEY: fakeModernSecret,
      [legacySecretEnvName]: 'legacy-value-that-must-not-be-used',
    });

    createServerSupabaseClient();

    expect(createClient).toHaveBeenCalledWith(
      'https://project.example.test',
      fakeModernSecret,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  });

  it('fails safely when SUPABASE_SECRET_KEY is absent without leaking values', () => {
    withEnv({
      SUPABASE_URL: 'https://project.example.test',
      [legacySecretEnvName]: 'legacy-secret-that-must-not-leak',
    });

    expect(() => createServerSupabaseClient()).toThrow('Configuração Supabase do servidor ausente.');
    expect(() => createServerSupabaseClient()).not.toThrow(/legacy-secret-that-must-not-leak/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('keeps the sensitive module protected by server-only', () => {
    expect(clientSource.startsWith("import 'server-only';")).toBe(true);
  });

  it('does not declare the legacy service role variable or a public secret key placeholder', () => {
    expect(envExample).toContain('SUPABASE_SECRET_KEY=');
    expect(envExample).not.toContain(legacySecretEnvName);
    expect(envExample).not.toContain(`${publicSecretEnvName}=`);
  });
});
