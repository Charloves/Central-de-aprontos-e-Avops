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
      p_expires_at: input.sessionExpiresAt,
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
    const now = new Date(resolveNow(input.now));
    const { data: current, error: currentError } = await this.client
      .from('auth_sessions')
      .select('id,profile_id,expires_at,revoked_at,last_seen_at')
      .eq('session_identifier_hash', input.sessionIdentifierHash)
      .maybeSingle<{
        id: string;
        profile_id: string;
        expires_at: string;
        revoked_at: string | null;
        last_seen_at: string | null;
      }>();
    if (currentError) throw currentError;
    if (!current || current.revoked_at || Date.parse(current.expires_at) <= now.getTime()) return null;

    const shouldTouch =
      !current.last_seen_at || Date.parse(current.last_seen_at) <= now.getTime() - input.touchIntervalSeconds * 1000;
    if (!shouldTouch) {
      return {
        sessionId: current.id,
        profileId: current.profile_id,
        expiresAt: current.expires_at,
        revokedAt: current.revoked_at,
      };
    }

    const { data, error } = await this.client
      .from('auth_sessions')
      .update({ last_seen_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('session_identifier_hash', input.sessionIdentifierHash)
      .is('revoked_at', null)
      .gt('expires_at', now.toISOString())
      .select('id,profile_id,expires_at,revoked_at')
      .maybeSingle<{ id: string; profile_id: string; expires_at: string; revoked_at: string | null }>();
    if (error) throw error;
    if (!data) return null;
    return {
      sessionId: data.id,
      profileId: data.profile_id,
      expiresAt: data.expires_at,
      revokedAt: data.revoked_at,
    };
  }

  async revokeSession(input: Parameters<AuthSecurityRepository['revokeSession']>[0]): Promise<{ sessionId: string | null }> {
    const now = resolveNow(input.now);
    const { data, error } = await this.client
      .from('auth_sessions')
      .update({ revoked_at: now, revoked_reason: input.reason, updated_at: now })
      .eq('session_identifier_hash', input.sessionIdentifierHash)
      .is('revoked_at', null)
      .select('id,profile_id')
      .maybeSingle<{ id: string; profile_id: string }>();
    if (error) throw error;
    if (!data) return { sessionId: null };
    await this.recordAuditEvent({
      eventType: 'LOGOUT',
      result: 'OK',
      profileId: data.profile_id,
      sessionId: data.id,
      reason: input.reason,
      now: input.now,
    });
    return { sessionId: data.id };
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
