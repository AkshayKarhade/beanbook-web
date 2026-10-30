import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beanbookPublicSupabaseKey } from '../src/admin/publicConfig';
import { BUSINESS_ADMIN_ROLE_LABEL, BUSINESS_ADMIN_PRIVILEGES, BUSINESS_ADMIN_SCOPE_NOTE } from '../src/admin/businessAdminAccess';

type Payload = Record<string, unknown>;
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const clean = (input: unknown) => typeof input === 'string' ? input.trim() : '';
const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
const safeText = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c] || c);

async function platformUser(request: Request, supabaseAdmin: SupabaseClient) {
  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!bearer) return null;
  const { data: user, error } = await supabaseAdmin.auth.getUser(bearer);
  if (error || !user.user || user.user.is_anonymous) return null;
  const { data: admin, error: membershipError } = await supabaseAdmin
    .from('platform_admins')
    .select('auth_user_id, username')
    .eq('auth_user_id', user.user.id)
    .eq('username', 'admin')
    .eq('is_active', true)
    .maybeSingle();
  if (membershipError || !admin) return null;
  return user.user.id;
}

// Netlify Functions require a callable default export; explicit path avoids rewrite ambiguity.
export const config = { path: '/api/platform-admin' };

export default async function platformAdmin(request: Request) {
    // Avoid a module-load crash if the preview Function lacks runtime credentials.
    if (request.method === 'GET') {
      const ready = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
      return json({ service: 'platform-admin', ready }, ready ? 200 : 503);
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      return json({ error: 'Netlify Function environment is missing Supabase runtime credentials.' }, 503);
    }
    const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) {
      return json({ error: 'Cross-origin request blocked.' }, 403);
    }
    if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      return json({ error: 'JSON body required.' }, 415);
    }
    let body: Payload;
    try {
      body = await request.json() as Payload;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ error: 'Invalid request' }, 400);
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const action = clean(body.action);
    try {
      if (action === 'login') {
        const username = clean(body.username);
        const password = typeof body.password === 'string' ? body.password : '';
        if (username !== 'admin' || password.length < 12 || password.length > 200) {
          return json({ error: 'Invalid credentials' }, 401);
        }
        const { data: account, error } = await supabaseAdmin.from('platform_admins')
          .select('auth_user_id, auth_email')
          .eq('username', 'admin')
          .eq('is_active', true)
          .maybeSingle();
        if (error || !account) return json({ error: 'Invalid credentials' }, 401);
        const url = process.env.SUPABASE_URL;
        const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || beanbookPublicSupabaseKey;
        if (!url || !key) return json({ error: 'Authentication is not configured' }, 503);
        // Supabase Auth checks password, hashing, account status and auth rate limits.
        const signInClient = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const result = await signInClient.auth.signInWithPassword({
          email: account.auth_email, password,
        });
        if (result.error || !result.data.session || result.data.user?.id !== account.auth_user_id) {
          return json({ error: 'Invalid credentials' }, 401);
        }
        return json({
          access_token: result.data.session.access_token,
          refresh_token: result.data.session.refresh_token,
        });
      }

      const userId = await platformUser(request, supabaseAdmin);
      if (!userId) return json({ error: 'Platform administrator access required.' }, 403);

      if (action === 'summary') {
        const [{ data: businesses, error: businessError }, { data: settings, error: settingsError }, { data: invitations, error: invitesError }] = await Promise.all([
          supabaseAdmin.from('brands').select('id,name,created_at').order('created_at', { ascending: false }).limit(100),
          supabaseAdmin.from('platform_settings').select('sender_name,sender_email,reply_to_email').eq('id', 1).maybeSingle(),
          supabaseAdmin.from('business_invitations').select('id,brand_id,email,status,created_at,sent_at').order('created_at', { ascending: false }).limit(100),
        ]);
        if (businessError || settingsError || invitesError) throw businessError || settingsError || invitesError;
        return json({ businesses, settings: settings || {}, invitations });
      }

      if (action === 'save-email-settings') {
        const senderName = clean(body.senderName);
        const senderEmail = clean(body.senderEmail).toLowerCase();
        const replyTo = clean(body.replyTo).toLowerCase();
        if (senderName.length < 2 || senderName.length > 100 || !validEmail(senderEmail) ||
          (replyTo && !validEmail(replyTo))) return json({ error: 'Enter a valid sender name, sender email and reply-to address.' }, 400);
        const { error } = await supabaseAdmin.from('platform_settings').upsert({
          id: 1, sender_name: senderName, sender_email: senderEmail, reply_to_email: replyTo || null,
          updated_by: userId, updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        await supabaseAdmin.from('platform_audit').insert({
          actor_user_id: userId, action: 'email_settings_updated', details: { senderEmail },
        });
        return json({ saved: true, message: 'Sender settings saved. Email delivery requires a verified domain and RESEND_API_KEY.' });
      }

      if (action === 'create-business') {
        const name = clean(body.businessName);
        if (name.length < 2 || name.length > 120) return json({ error: 'Business name must be 2–120 characters.' }, 400);
        const { data: business, error } = await supabaseAdmin.from('brands')
          .insert({ name })
          .select('id,name,created_at')
          .single();
        if (error) throw error;
        await supabaseAdmin.from('platform_audit').insert({
          actor_user_id: userId, action: 'business_created', brand_id: business.id, details: { name },
        });
        return json({ business }, 201);
      }

      if (action === 'invite-owner') {
        const brandId = clean(body.brandId);
        const email = clean(body.email).toLowerCase();
        if (!/^[0-9a-f-]{36}$/i.test(brandId) || !validEmail(email)) return json({ error: 'Valid business and email are required.' }, 400);
        if (!process.env.RESEND_API_KEY) return json({ error: 'Email delivery is not configured. Set RESEND_API_KEY on the server.' }, 503);
        const redirectBase = process.env.BEANBOOK_INVITE_REDIRECT_URL;
        if (!redirectBase || !redirectBase.startsWith('https://')) {
          return json({ error: 'Secure invitation redirect is not configured.' }, 503);
        }

        const [{ data: business, error: businessError }, { data: sender, error: senderError }] = await Promise.all([
          supabaseAdmin.from('brands').select('id,name').eq('id', brandId).maybeSingle(),
          supabaseAdmin.from('platform_settings').select('sender_name,sender_email,reply_to_email').eq('id',1).maybeSingle(),
        ]);
        if (businessError || senderError) throw businessError || senderError;
        if (!business) return json({ error: 'Business not found.' }, 404);
        if (!sender?.sender_email || !sender?.sender_name) return json({ error: 'Configure your sender address first.' }, 409);

        const { data: existingInvite, error: existingError } = await supabaseAdmin
          .from('business_invitations').select('id,auth_user_id,status').eq('brand_id', brandId)
          .eq('email', email).maybeSingle();
        if (existingError) throw existingError;
        // Avoid creating a second account for an already registered email.
        const { data: invitation, error: inviteError } = existingInvite
          ? await supabaseAdmin.from('business_invitations').update({ status: 'pending', error_message: null }).eq('id', existingInvite.id).select('id').single()
          : await supabaseAdmin.from('business_invitations').insert({ brand_id: brandId, email, status: 'pending', created_by: userId }).select('id').single();
        if (inviteError) throw inviteError;

        // A previous failed send may already have created an unconfirmed
        // Supabase Auth user. Reissue a link for that account, never a duplicate.
        const linkType = existingInvite?.auth_user_id ? 'recovery' : 'invite';
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: linkType,
          email,
          options: { redirectTo: redirectBase },
        });
        if (linkError || !linkData?.user?.id || !linkData.properties?.action_link) {
          await supabaseAdmin.from('business_invitations').update({ status: 'failed', error_message: 'Could not generate invitation link.' }).eq('id', invitation.id);
          return json({ error: 'Unable to generate an invitation for this address. Check whether this user already exists.' }, 409);
        }
        if (existingInvite?.auth_user_id && linkData.user.id !== existingInvite.auth_user_id) {
          return json({ error: 'Invitation account does not match the existing user. Manual review required.' }, 409);
        }
        const { data: membership, error: membershipError } = await supabaseAdmin.from('admin_users')
          .select('brand_id').eq('supabase_user_id', linkData.user.id).maybeSingle();
        if (membershipError) throw membershipError;
        if (membership && membership.brand_id !== brandId) return json({ error: 'This email already belongs to a different business.' }, 409);
        if (!membership) {
          const { error } = await supabaseAdmin.from('admin_users').insert({
            supabase_user_id: linkData.user.id, brand_id: brandId, email, role: 'owner',
          });
          if (error) throw error;
        }

        const message = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: sender.sender_name + ' <' + sender.sender_email + '>',
            to: [email],
            ...(sender.reply_to_email ? { reply_to: sender.reply_to_email } : {}),
            subject: 'Your Business Admin invitation — ' + business.name,
            html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1b2822">' +
              '<p style="color:#087f60;letter-spacing:2px;font-weight:700">BEANBOOK</p>' +
              '<h1>You are invited to become Business Admin</h1>' +
              '<p><strong>Business:</strong> ' + safeText(business.name) + '</p>' +
              '<p><strong>Assigned role:</strong> ' + safeText(BUSINESS_ADMIN_ROLE_LABEL) + '</p>' +
              '<p>Your business already has a BeanBook account. This invitation establishes your access as its Business Admin.</p>' +
              '<h2 style="font-size:18px">Your privileges</h2><ul>' +
              BUSINESS_ADMIN_PRIVILEGES.map(item => '<li style="margin-bottom:8px">' + safeText(item) + '</li>').join('') +
              '</ul><p style="font-size:13px;color:#52635a">' + safeText(BUSINESS_ADMIN_SCOPE_NOTE) + '</p>' +
              '<p><a style="display:inline-block;padding:14px 20px;background:#1b2822;color:white;text-decoration:none;border-radius:8px" href="' + safeText(linkData.properties.action_link) + '">Activate Business Admin access</a></p>' +
              '<p style="font-size:12px;color:#52635a">If you were not expecting this invitation, you may ignore it.</p></div>',
          }),
        });
        if (!message.ok) {
          await supabaseAdmin.from('business_invitations').update({ status:'failed', error_message: 'Email provider rejected send.' }).eq('id', invitation.id);
          return json({ error: 'Invitation was created, but the email provider did not accept the message. No email was sent.' }, 502);
        }
        await supabaseAdmin.from('business_invitations').update({ status:'sent', sent_at:new Date().toISOString(), error_message:null, auth_user_id:linkData.user.id }).eq('id', invitation.id);
        await supabaseAdmin.from('platform_audit').insert({
          actor_user_id:userId, action:'business_owner_invited', brand_id:brandId, details:{ email },
        });
        return json({ sent:true, status:'sent', message:'Business Admin invitation email sent to ' + email + ' for ' + business.name + '. Account activation is pending.' });
      }

      return json({ error: 'Unknown action.' }, 400);
    } catch (error) {
      console.error('Platform administration request failed:', error);
      return json({ error: 'Platform operation failed. Review server logs.' }, 500);
    }
}
