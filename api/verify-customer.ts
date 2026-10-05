import { supabaseAdmin } from '../lib/supabase-server';

type VerifyCustomerRequest = {
  eventSlug?: string;
  otp?: string;
  customer?: {
    firstName?: string;
    lastName?: string;
    whatsappNumber?: string;
  };
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error
  ) {
    return String(
      (error as { message?: unknown }).message ??
        'Unknown error'
    );
  }

  return 'Unknown error';
}

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405 }
      );
    }

    try {
      const body =
        (await request.json()) as VerifyCustomerRequest;

      const eventSlug = body.eventSlug?.trim();
      const firstName =
        body.customer?.firstName?.trim();
      const lastName =
        body.customer?.lastName?.trim();
      const whatsappNumber =
        body.customer?.whatsappNumber?.trim();
      const otp = body.otp?.trim();

      if (
        !eventSlug ||
        !firstName ||
        !lastName ||
        !whatsappNumber ||
        !/^\+[1-9]\d{7,14}$/.test(whatsappNumber)
      ) {
        return Response.json(
          { error: 'Invalid customer details' },
          { status: 400 }
        );
      }

      // Development-only verification until a real
      // WhatsApp OTP provider is connected.
      if (otp !== '123456') {
        return Response.json(
          { error: 'Invalid verification code' },
          { status: 400 }
        );
      }

      const {
        data: event,
        error: eventError,
      } = await supabaseAdmin
        .from('events')
        .select('id, brand_id')
        .eq('slug', eventSlug)
        .eq('status', 'active')
        .maybeSingle();

      if (eventError) {
        throw eventError;
      }

      if (!event) {
        return Response.json(
          { error: 'Event not found or inactive' },
          { status: 404 }
        );
      }

      const fullName =
        `${firstName} ${lastName}`.trim();

      const {
        data: existingCustomer,
        error: lookupError,
      } = await supabaseAdmin
        .from('customers')
        .select(
          'id, whatsapp_verification_status, whatsapp_verified_at'
        )
        .eq('brand_id', event.brand_id)
        .eq('phone', whatsappNumber)
        .maybeSingle();

      if (lookupError) {
        throw lookupError;
      }

      if (existingCustomer) {
        const verificationStatus =
          existingCustomer.whatsapp_verification_status ===
          'verified'
            ? 'verified'
            : 'development_mock';

        const { error: updateError } =
          await supabaseAdmin
            .from('customers')
            .update({
              name: fullName,
              first_name: firstName,
              last_name: lastName,
              phone: whatsappNumber,
              whatsapp_verification_status:
                verificationStatus,
              whatsapp_verified_at:
                verificationStatus === 'verified'
                  ? existingCustomer.whatsapp_verified_at
                  : null,
              updated_at:
                new Date().toISOString(),
            })
            .eq('id', existingCustomer.id);

        if (updateError) {
          throw updateError;
        }

        return Response.json({
          verified: true,
          verificationStatus,
          customerId: existingCustomer.id,
        });
      }

      const {
        data: newCustomer,
        error: insertError,
      } = await supabaseAdmin
        .from('customers')
        .insert({
          brand_id: event.brand_id,
          name: fullName,
          first_name: firstName,
          last_name: lastName,
          phone: whatsappNumber,
          whatsapp_verification_status:
            'development_mock',
          whatsapp_verified_at: null,
          updated_at:
            new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError) {
        throw insertError;
      }

      return Response.json({
        verified: true,
        verificationStatus:
          'development_mock',
        customerId: newCustomer.id,
      });
    } catch (error) {
      console.error(
        'Customer verification failed:',
        error
      );

      return Response.json(
        {
          error: 'Could not verify customer',
          details: getErrorMessage(error),
        },
        { status: 500 }
      );
    }
  },
};
