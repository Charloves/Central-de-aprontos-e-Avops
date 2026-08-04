import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/db/client';
import {
  effectiveNetworkScopeEnabled,
  type AuthSecurityRepository,
  type BlockCheckResult,
  type LoginFailureResult,
  type PersistentSessionRecord,
} from './security';

type RpcSingle<T> = T | T[] | null;

export class SupabaseAuthSecurityRepository implements AuthSecurityRepository {
  constructor(private readonly client: SupabaseClient = createServerSupabaseClient()) {}

  async checkTemporaryBlock(input: Parameters<AuthSecurityRepository['checkTemporaryBlock']>[0]): Promise<BlockCheckResult> {
    const { data, error } = await this.client.rpc('auth_check_temporary_block', {
      p_trigram_fingerprint: input.context.trigramFingerprint,
      p_network_fingerprint: input.context.networkFingerprint,
      p_enable_trigram: input.config.enableTrigramScope,
      p_enable_network: effectiveNetworkScopeEnabled(input.config, input.context.networkFingerprint),
      p_now: resolveNow(input.now),
    });
    if (error) throw error;
    const row = firstRow<{ blocked: boolean; blocked_until: string | null; scope: BlockCheckResult['scope'] }>(data);
    return {
      blocked: row?.blocked ?? false,
      blockedUntil: row?.blocked_until ?? null,
      scope: row?.scope ?? null,
    };
  }

  async recordLoginFailure(input: Parameters<AuthSecurityRepository['recordLoginFailure']>[0]): Promise<LoginFailureResult> {
    const { data, error } = await this.client.rpc('auth_finalize_login_failure', {
      p_trigram_fingerprint: input.context.trigramFingerprint,
      p_network_fingerprint: input.context.networkFingerprint,
      p_reason: input.reason,
      p_max_attempts: input.config.maxAttempts,
      p_window_seconds: input.config.windowSeconds,
      p_block_seconds: input.config.blockSeconds,
      p_enable_trigram: input.config.enableTrigramScope,
      p_enable_network: effectiveNetworkScopeEnabled(input.config, input.context.networkFingerprint),
      p_now: resolveNow(input.now),
    });
    if (error) throw error;
    const row = firstRow<{ blocked: boolean; blocked_until: string | null }>(data);
    return {
      blocked: row?.blocked ?? false,
      blockedUntil: row?.blocked_until ?? null,
    };
  }

  async recordLoginSuccess(input: Parameters<AuthSecurityRepository['recordLoginSuccess']>[0]): Promise<{ sessionId: string }> {
    const { data, error } = await this.client.rpc('auth_finalize_login_success', {
      p_profile_id: input.profile.id,
      p_trigram_fingerprint: input.context.trigramFingerprint,
      p_network_fingerprint: input.context.networkFingerprint,
      p_user_agent_fingerprint: input.context.userAgentFingerprint,
      p_session_identifier_hash: input.sessionIdentifierHash,
      p_nonce_hash: input.nonceHash,
      p_expires_at: new Date(input.session.exp).toISOString(),
      p_enable_trigram: input.config.enableTrigramScope,
      p_enable_network: effectiveNetworkScopeEnabled(input.config, input.context.networkFingerprint),
      p_now: resolveNow(input.now),
    });
    if (error) throw error;
    const row = firstRow<{ session_id: string | null; blocked: boolean; blocked_until: string | null }>(data);
    if (!row?.session_id || row.blocked) throw new Error('authentication blocked');
    const sessionId = row.session_id;
    return { sessionId };
  }

  async touchSession(input: Parameters<AuthSecurityRepository['touchSession']>[0]): Promise<PersistentSessionRecord | null> {
    const { data, error } = await this.client.rpc('auth_touch_session', {
      p_nonce_hash: input.nonceHash,
      p_touch_interval_seconds: input.touchIntervalSeconds,
      p_now: resolveNow(input.now),
    });
    if (error) throw error;
    const row = firstRow<{ session_id: string; profile_id: string; expires_at: string; revoked_at: string | null }>(data);
    if (!row) return null;
    return {
      sessionId: row.session_id,
      profileId: row.profile_id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  async revokeSession(input: Parameters<AuthSecurityRepository['revokeSession']>[0]): Promise<{ sessionId: string | null }> {
    const { data, error } = await this.client.rpc('auth_revoke_session', {
      p_nonce_hash: input.nonceHash,
      p_reason: input.reason,
      p_now: resolveNow(input.now),
    });
    if (error) throw error;
    return { sessionId: data ? String(data) : null };
  }

  async revokeProfileSessions(input: Parameters<AuthSecurityRepository['revokeProfileSessions']>[0]): Promise<{ revokedCount: number }> {
    const { data, error } = await this.client.rpc('auth_revoke_profile_sessions', {
      p_profile_id: input.profileId,
      p_reason: input.reason,
      p_now: resolveNow(input.now),
    });
    if (error) throw error;
    return { revokedCount: Number(data ?? 0) };
  }

  async recordAuditEvent(input: Parameters<AuthSecurityRepository['recordAuditEvent']>[0]): Promise<void> {
    const { error } = await this.client.rpc('auth_record_audit_event', {
      p_profile_id: input.profileId ?? null,
      p_session_id: input.sessionId ?? null,
      p_event_type: input.eventType,
      p_result: input.result,
      p_trigram_fingerprint: input.context?.trigramFingerprint ?? null,
      p_network_fingerprint: input.context?.networkFingerprint ?? null,
      p_reason: input.reason ?? null,
      p_metadata: input.metadata ?? {},
      p_now: resolveNow(input.now),
    });
    if (error) throw error;
  }
}

function firstRow<T>(data: RpcSingle<T>): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

function resolveNow(now: Date | undefined): string {
  return (now ?? new Date()).toISOString();
}
