import { createClient } from '@supabase/supabase-js';
import { BUSINESS_ADMIN_ROLE_LABEL } from '../src/admin/businessAdminAccess';

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const safe = (input: string) =>
  input.replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch] || ch);


export default async function businessOnboarding(request: Request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) {
    return json({ error: 'Cross-origin request blocked.' }, 403);
  }
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return json({ error: 'JSON required.' }, 415);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    return json({ error: 'Business onboarding is not configured.' }, 503);
  }

  let action = '';
  let pilotTier = '';
  try {
    const body = await request.json() as { action?: unknown; pilotTier?: unknown };
    action = typeof body?.action === 'string' ? body.action : '';
    pilotTier = typeof body?.pilotTier === 'string' ? body.pilotTier : '';
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (action !== 'credentials-set' && action !== 'complete') {
    return json({ error: 'Unknown action.' }, 400);
  }

  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!bearer) return json({ error: 'Sign in to complete onboarding.' }, 401);
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: identity, error: authError } = await admin.auth.getUser(bearer);
    const user = identity.user;
    if (authError || !user?.id || user.is_anonymous || !user.email) {
      return json({ error: 'Your session has expired. Sign in again.' }, 401);
    }
    const { data: membership, error: memberError } = await admin.from('admin_users')
      .select('brand_id,role').eq('supabase_user_id', user.id).maybeSingle();
    if (memberError) throw memberError;
    if (!membership || membership.role !== 'owner') {
      return json({ error: 'Business Admin privileges required.' }, 403);
    }
    const { data: invitation, error: invitationError } = await admin.from('business_invitations')
      .select('id,brand_id,auth_user_id,email,status,confirmation_started_at')
      .eq('brand_id', membership.brand_id).eq('auth_user_id', user.id).maybeSingle();
    if (invitationError) throw invitationError;
    if (!invitation || invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      return action === 'complete'
        ? json({ status: 'not_applicable' })
        : json({ error: 'No matching invitation for this account.' }, 404);
    }

    if (action === 'credentials-set') {
      if (!['base', 'growth', 'complete'].includes(pilotTier)) return json({ error: 'Choose a valid pilot plan.' }, 400);
      const { error: tierError } = await admin.from('business_invitations').update({ pilot_tier: pilotTier }).eq('id', invitation.id);
      if (tierError) throw tierError;
      if (invitation.status === 'activated') return json({ status: 'completed' });
      if (invitation.status === 'credentials_set' || invitation.status === 'sending_confirmation') {
        return json({ status: 'credentials_set' });
      }
      if (invitation.status !== 'sent') {
        return json({ error: 'Your invitation is not ready for activation. Contact BeanBook support.' }, 409);
      }
      const { data: updated, error: updateError } = await admin.from('business_invitations')
        .update({ status: 'credentials_set', credentials_set_at: new Date().toISOString() })
        .eq('id', invitation.id).eq('status', 'sent').select('id').maybeSingle();
      if (updateError) throw updateError;
      if (!updated) return json({ error: 'Activation was updated elsewhere. Refresh and try again.' }, 409);
      return json({ status: 'credentials_set' });
    }

    if (invitation.status === 'activated') return json({ status: 'already_completed' });
    if (invitation.status === 'sent') return json({ status: 'awaiting_credentials' });
    if (invitation.status === 'sending_confirmation') {
      const stale = !invitation.confirmation_started_at ||
        Date.parse(invitation.confirmation_started_at) < Date.now() - 10 * 60 * 1000;
      if (!stale) return json({ status: 'processing' }, 202);
      const { error: releaseError } = await admin.from('business_invitations')
        .update({ status: 'credentials_set' }).eq('id', invitation.id)
        .eq('status', 'sending_confirmation');
      if (releaseError) throw releaseError;
    } else if (invitation.status !== 'credentials_set') {
      return json({ status: 'not_ready' }, 409);
    }

    if (!process.env.RESEND_API_KEY) {
      return json({ error: 'Welcome email delivery is not configured. Please retry later.' }, 503);
    }
    const [{ data: sender, error: senderError }, { data: brand, error: brandError }] = await Promise.all([
      admin.from('platform_settings').select('sender_name,sender_email,reply_to_email').eq('id', 1).maybeSingle(),
      admin.from('brands').select('name').eq('id', membership.brand_id).single(),
    ]);
    if (senderError || brandError) throw senderError || brandError;
    if (!sender?.sender_email || !sender.sender_name || !brand) {
      return json({ error: 'Welcome email settings are incomplete. Please retry later.' }, 503);
    }

    // Atomic compare-and-swap: only one dashboard request may send the welcome email.
    const { data: claimed, error: claimError } = await admin.from('business_invitations')
      .update({ status: 'sending_confirmation', confirmation_started_at: new Date().toISOString() })
      .eq('id', invitation.id).eq('status', 'credentials_set').select('id').maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return json({ status: 'processing' }, 202);

    const destination = new URL('/beanbook/admin', request.url).toString();
    const businessName = safe(brand.name);
    const roleLabel = safe(BUSINESS_ADMIN_ROLE_LABEL);
    const html = '<div style="max-width:620px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;color:#1b2822">' +
      '<p style="color:#17704e;letter-spacing:2px;font-weight:700">BEANBOOK</p>' +
      '<div style="background:#f1f6ef;border-radius:20px;padding:28px">' +
      '<p style="font-size:38px;margin:0">🎉</p>' +
      '<h1 style="font-size:28px;margin:12px 0">You\'re officially on BeanBook!</h1>' +
      '<p style="font-size:17px">Welcome aboard! Your Business Admin account for <strong>' + businessName + '</strong> is now active.</p>' +
      '</div><h2>Everything is ready for your first steps</h2>' +
      '<p>You\'ve created your password and accessed your business dashboard. That\'s a milestone worth celebrating!</p>' +
      '<p><strong>Business:</strong> ' + businessName + '<br/><strong>Your role:</strong> ' + roleLabel + '</p>' +
      '<p>Your workspace is now yours to explore. As BeanBook grows, you\'ll be able to manage products, orders, team access and reporting in one place.</p>' +
      '<p><a href="' + safe(destination) + '" style="display:inline-block;background:#1b2822;color:white;padding:15px 22px;border-radius:10px;text-decoration:none;font-weight:bold">Explore your business dashboard</a></p>' +
      '<p style="font-size:13px;color:#546459">Only ' + businessName + ' is accessible with your business role. Some features are coming soon. You can sign in again using this email address and the password you created.</p>' +
      '<p>Here\'s to everything you\'ll build. ☕<br/>The BeanBook Team</p></div>';

    let sent = false;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'beanbook-owner-welcome-' + invitation.id,
        },
        body: JSON.stringify({
          from: sender.sender_name + ' <' + sender.sender_email + '>',
          to: [user.email],
          ...(sender.reply_to_email ? { reply_to: sender.reply_to_email } : {}),
          subject: '🎉 Welcome to BeanBook, ' + brand.name.replace(/[\r\n]/g, ' ') + '! Your account is ready',
          html,
        }),
      });
      sent = response.ok;
      if (!sent) console.error('Business welcome email rejected, HTTP', response.status);
    } catch (error) {
      console.error('Business welcome email request failed', error);
    }

    if (!sent) {
      const { error: retryError } = await admin.from('business_invitations')
        .update({ status: 'credentials_set', error_message: 'Welcome email pending retry.' })
        .eq('id', invitation.id).eq('status', 'sending_confirmation');
      if (retryError) console.error('Unable to release welcome email claim', retryError);
      return json({ error: 'Your account is ready, but we could not send the welcome email. Please retry from your dashboard.' }, 502);
    }
    const now = new Date().toISOString();
    const { error: doneError } = await admin.from('business_invitations')
      .update({ status: 'activated', activated_at: now, confirmation_email_sent_at: now, error_message: null })
      .eq('id', invitation.id).eq('status', 'sending_confirmation');
    if (doneError) throw doneError;
    const { error: auditError } = await admin.from('platform_audit').insert({
      action: 'business_admin_activated', actor_user_id: user.id,
      brand_id: membership.brand_id, details: { invitation_id: invitation.id },
    });
    if (auditError) console.error('Activation completed but audit insert failed', auditError);
    return json({ status: 'completed', message: 'Your account is active. Welcome to BeanBook!' });
  } catch (error) {
    console.error('Business activation completion failed:', error);
    return json({ error: 'Could not finish onboarding. Your dashboard remains available; please retry.' }, 500);
  }
}
