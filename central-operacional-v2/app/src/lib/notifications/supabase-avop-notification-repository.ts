import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/db/client';
import type {
  AvopNotificationCandidate,
  AvopNotificationMarker,
  AvopNotificationRepository,
  AvopNotificationResult,
  AvopNotificationStopReason,
  AvopNotificationType,
  ReservedAvopNotification,
} from './avop-email';

type CandidateRow = {
  avop_id: string;
  avop_number: string;
  title: string;
  publication_date: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  profile_id: string;
  recipient_email: string | null;
  profile_active: boolean;
  applicable_now: boolean;
  acknowledged: boolean;
  sent_markers: string[] | null;
};

export class SupabaseAvopNotificationRepository implements AvopNotificationRepository {
  constructor(private readonly client: SupabaseClient = createServerSupabaseClient()) {}

  async listCandidates(now: Date): Promise<AvopNotificationCandidate[]> {
    const date = now.toISOString().slice(0, 10);
    const { data, error } = await this.client.rpc('list_avop_notification_candidates', {
      p_today: date,
    });
    if (error) throw error;
    return ((data ?? []) as CandidateRow[]).map((row) => ({
      avopId: row.avop_id,
      avopNumber: row.avop_number,
      title: row.title,
      publicationDate: row.publication_date,
      status: row.status,
      profileId: row.profile_id,
      recipientEmail: row.recipient_email,
      profileActive: row.profile_active,
      applicableNow: row.applicable_now,
      acknowledged: row.acknowledged,
      sentMarkers: (row.sent_markers ?? []) as AvopNotificationMarker[],
    }));
  }

  async reserve(input: {
    activityId: string;
    profileId: string;
    notificationType: AvopNotificationType;
    marker: AvopNotificationMarker;
    nextSendAt: Date | null;
    reservationTokenHash: string;
    reservedUntil: Date;
    now: Date;
  }): Promise<ReservedAvopNotification | null> {
    const { data, error } = await this.client.rpc('reserve_avop_notification', {
      p_activity_id: input.activityId,
      p_profile_id: input.profileId,
      p_notification_type: input.notificationType,
      p_marker: input.marker,
      p_next_send_at: input.nextSendAt?.toISOString() ?? null,
      p_reservation_token_hash: input.reservationTokenHash,
      p_reserved_until: input.reservedUntil.toISOString(),
      p_now: input.now.toISOString(),
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.reserved) return null;
    return {
      scheduleId: String(row.schedule_id),
      reservationTokenHash: input.reservationTokenHash,
    };
  }

  async recordResult(input: {
    scheduleId: string;
    activityId: string;
    profileId: string;
    recipient: string;
    notificationType: AvopNotificationType;
    marker: AvopNotificationMarker;
    result: AvopNotificationResult;
    idempotencyKey: string;
    providerMessageId?: string | null;
    error?: string | null;
    errorKind?: 'TEMPORARY' | 'PERMANENT' | 'CONFIGURATION' | 'VALIDATION' | null;
    nextSendAt: Date | null;
    stopReason?: AvopNotificationStopReason | null;
    now: Date;
  }): Promise<void> {
    const { error } = await this.client.rpc('record_avop_notification_result', {
      p_schedule_id: input.scheduleId,
      p_activity_id: input.activityId,
      p_profile_id: input.profileId,
      p_recipient: input.recipient,
      p_notification_type: input.notificationType,
      p_marker: input.marker,
      p_result: input.result,
      p_idempotency_key: input.idempotencyKey,
      p_provider_message_id: input.providerMessageId ?? null,
      p_error: input.error ?? null,
      p_error_kind: input.errorKind ?? null,
      p_next_send_at: input.nextSendAt?.toISOString() ?? null,
      p_stop_reason: input.stopReason ?? null,
      p_now: input.now.toISOString(),
    });
    if (error) throw error;
  }

  async stopSchedule(input: {
    activityId: string;
    profileId: string;
    marker: AvopNotificationMarker;
    recipient: string;
    stopReason: AvopNotificationStopReason;
    idempotencyKey: string;
    now: Date;
  }): Promise<void> {
    const reserved = await this.reserve({
      activityId: input.activityId,
      profileId: input.profileId,
      notificationType: 'AVOP_SKIPPED',
      marker: input.marker,
      nextSendAt: null,
      reservationTokenHash: input.idempotencyKey,
      reservedUntil: new Date(input.now.getTime() + 60_000),
      now: input.now,
    });
    if (!reserved) return;
    await this.recordResult({
      scheduleId: reserved.scheduleId,
      activityId: input.activityId,
      profileId: input.profileId,
      recipient: input.recipient,
      notificationType: 'AVOP_SKIPPED',
      marker: input.marker,
      result: 'SKIPPED',
      idempotencyKey: input.idempotencyKey,
      nextSendAt: null,
      stopReason: input.stopReason,
      now: input.now,
    });
  }
}
