create index if not exists notification_log_profile_id_idx
  on public.notification_log using btree (profile_id);
