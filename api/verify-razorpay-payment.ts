import Razorpay from 'razorpay';
import {
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

import { supabaseAdmin } from '../lib/supabase-server';

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405 }
      );
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return Response.json(
        { error: 'Razorpay credentials are missing' },
        { status: 500 }
      );
    }

    try {
      const body = await request.json();

      const orderId = body?.razorpay_order_id;
      const paymentId = body?.razorpay_payment_id;
      const signature = body?.razorpay_signature;

      if (
        typeof orderId !== 'string' ||
        !/^order_[A-Za-z0-9]+$/.test(orderId) ||
        typeof paymentId !== 'string' ||
        !/^pay_[A-Za-z0-9]+$/.test(paymentId) ||
        typeof signature !== 'string' ||
        !/^[a-fA-F0-9]{64}$/.test(signature)
      ) {
        return Response.json(
          { error: 'Invalid or missing payment details' },
          { status: 400 }
        );
      }

      const expectedSignature = createHmac(
        'sha256',
        keySecret
      )
        .update(`${orderId}|${paymentId}`)
        .digest();

      const receivedSignature = Buffer.from(
        signature,
        'hex'
      );

      if (
        receivedSignature.length !==
          expectedSignature.length ||
        !timingSafeEqual(
          expectedSignature,
          receivedSignature
        )
      ) {
        return Response.json(
          { error: 'Invalid payment signature' },
          { status: 400 }
        );
      }

      const {
        data: beanbookOrder,
        error: orderLookupError,
      } = await supabaseAdmin
        .from('orders')
        .select(
          'id, order_sequence, final_amount_paise, razorpay_order_id, status'
        )
        .eq('razorpay_order_id', orderId)
        .maybeSingle();

      if (orderLookupError) {
        throw orderLookupError;
      }

      if (!beanbookOrder) {
        return Response.json(
          { error: 'BeanBook order not found' },
          { status: 404 }
        );
      }

      const razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });

      const [razorpayOrder, payment] =
        await Promise.all([
          razorpay.orders.fetch(orderId),
          razorpay.payments.fetch(paymentId),
        ]);

      const expectedAmount =
        Number(beanbookOrder.final_amount_paise);

      const paymentMatchesOrder =
        razorpayOrder.id === orderId &&
        payment.order_id === orderId &&
        Number(razorpayOrder.amount) ===
          expectedAmount &&
        Number(payment.amount) ===
          expectedAmount &&
        payment.currency === 'INR';

      if (!paymentMatchesOrder) {
        return Response.json(
          {
            error:
              'Payment does not match the BeanBook order',
          },
          { status: 400 }
        );
      }

      if (payment.status !== 'captured') {
        await supabaseAdmin
          .from('orders')
          .update({
            status:
              'awaiting_bank_confirmation',
            updated_at:
              new Date().toISOString(),
          })
          .eq('id', beanbookOrder.id);

        return Response.json(
          {
            verified: false,
            status: payment.status,
            orderId: beanbookOrder.id,
            orderNumber:
              `BB-${beanbookOrder.order_sequence}`,
          },
          { status: 202 }
        );
      }

      const { error: updateError } =
        await supabaseAdmin
          .from('orders')
          .update({
            status: 'paid',
            updated_at:
              new Date().toISOString(),
          })
          .eq('id', beanbookOrder.id);

      if (updateError) {
        throw updateError;
      }

      return Response.json({
        verified: true,
        orderId: beanbookOrder.id,
        orderNumber:
          `BB-${beanbookOrder.order_sequence}`,
        paymentId: payment.id,
        amount: Number(payment.amount),
        currency: payment.currency,
        status: payment.status,
      });
    } catch (error) {
      console.error(
        'Razorpay payment verification failed:',
        error
      );

      return Response.json(
        {
          error: 'Could not verify payment',
          details:
            error instanceof Error
              ? error.message
              : 'Unknown error',
        },
        { status: 500 }
      );
    }
  },
};
