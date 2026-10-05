import { supabaseAdmin } from '../lib/supabase-server';

type VerifyCustomerRequest = {
  eventSlug?: string;
  accessToken?: string;
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
      const accessToken = body.accessToken?.trim();
      const firstName =
        body.customer?.firstName?.trim();
      const lastName =
        body.customer?.lastName?.trim();
      const whatsappNumber =
        body.customer?.whatsappNumber?.trim();

      if (
        !eventSlug ||
        !accessToken ||
        !firstName ||
        !lastName ||
        !whatsappNumber ||
        !/^\+[1-9]\d{7,14}$/.test(
          whatsappNumber
        )
      ) {
        return Response.json(
          { error: 'Invalid customer details' },
          { status: 400 }
        );
      }

      const {
        data: authData,
        error: authError,
      } = await supabaseAdmin.auth.getUser(
        accessToken
      );

      if (
        authError ||
        !authData.user ||
        authData.user.phone !== whatsappNumber
      ) {
        return Response.json(
          {
            error:
              'WhatsApp verification could not be confirmed',
          },
          { status: 401 }
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
      const verifiedAt =
        new Date().toISOString();

      const {
        data: existingCustomer,
        error: lookupError,
      } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('brand_id', event.brand_id)
        .eq('phone', whatsappNumber)
        .maybeSingle();

      if (lookupError) {
        throw lookupError;
      }

      if (existingCustomer) {
        const { error: updateError } =
          await supabaseAdmin
            .from('customers')
            .update({
              name: fullName,
              first_name: firstName,
              last_name: lastName,
              phone: whatsappNumber,
              whatsapp_verification_status:
                'verified',
              whatsapp_verified_at:
                verifiedAt,
              updated_at: verifiedAt,
            })
            .eq('id', existingCustomer.id);

        if (updateError) {
          throw updateError;
        }

        return Response.json({
          verified: true,
          verificationStatus: 'verified',
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
            'verified',
          whatsapp_verified_at: verifiedAt,
          updated_at: verifiedAt,
        })
        .select('id')
        .single();

      if (insertError) {
        throw insertError;
      }

      return Response.json({
        verified: true,
        verificationStatus: 'verified',
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
