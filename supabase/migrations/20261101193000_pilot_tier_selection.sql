-- Pilot tier is an invitation-level preference, not a subscription or entitlement.
ALTER TABLE public.business_invitations
  ADD COLUMN IF NOT EXISTS pilot_tier text;
ALTER TABLE public.business_invitations
  DROP CONSTRAINT IF EXISTS business_invitations_pilot_tier_check;
ALTER TABLE public.business_invitations
  ADD CONSTRAINT business_invitations_pilot_tier_check
  CHECK (pilot_tier IS NULL OR pilot_tier IN ('base','growth','complete'));
