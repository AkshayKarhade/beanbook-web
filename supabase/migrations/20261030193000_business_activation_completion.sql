-- Track the owner invitation lifecycle without creating another business or Auth user.
-- Status transitions: sent -> credentials_set -> sending_confirmation -> activated.
-- The server verifies the authenticated user's business membership before changing status.
ALTER TABLE public.business_invitations
  ADD COLUMN IF NOT EXISTS credentials_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS business_invitations_auth_user_status_idx
  ON public.business_invitations (auth_user_id, status)
  WHERE auth_user_id IS NOT NULL;
