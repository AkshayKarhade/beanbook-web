import {
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

import { supabaseAdmin } from '../lib/supabase-server';

type RazorpayWebhookPayment = {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
};

type RazorpayWebhookBody = {
  event?: string;
  payload?: {
    payment?: {
      entity?: RazorpayWebhookPayment;
    };
  };
};

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405 }
      );
    }

    const webhookSecret =
      process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return Response.json(
        { error: 'Webhook secret is missing' },
        { status: 500 }
      );
    }

    const rawBody = await request.text();
    const signature =
      request.headers.get('x-razorpay-signature');

    if (
      !signature ||
      !/^[a-fA-F0-9]{64}$/.test(signature)
    ) {
      return Response.json(
        { error: 'Invalid webhook signature' },
        { status: 400 }
      );
    }

    const expectedSignature = createHmac(
      'sha256',
      webhookSecret
    )
      .update(rawBody)
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
        { error: 'Invalid webhook signature' },
        { status: 400 }
      );
    }

    let body: RazorpayWebhookBody;

    try {
      body =
        JSON.parse(rawBody) as RazorpayWebhookBody;
    } catch {
      return Response.json(
        { error: 'Invalid webhook payload' },
        { status: 400 }
      );
    }

    if (body.event !== 'payment.captured') {
      return Response.json({
        received: true,
        handled: false,
      });
    }

    const payment =
      body.payload?.payment?.entity;

    if (
      !payment ||
      typeof payment.order_id !== 'string' ||
      typeof payment.amount !== 'number' ||
      payment.currency !== 'INR' ||
      payment.status !== 'captured'
    ) {
      return Response.json(
        { error: 'Invalid payment payload' },
        { status: 400 }
      );
    }

    const {
      data: beanbookOrder,
      error: lookupError,
    } = await supabaseAdmin
      .from('orders')
      .select(
        'id, total_amount, payment_status'
      )
      .eq(
        'razorpay_order_id',
        payment.order_id
      )
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    if (!beanbookOrder) {
      return Response.json(
        { error: 'BeanBook order not found' },
        { status: 404 }
      );
    }

    const expectedAmount =
      Math.round(
        Number(beanbookOrder.total_amount) *
          100
      );

    if (expectedAmount !== payment.amount) {
      return Response.json(
        { error: 'Payment amount mismatch' },
        { status: 400 }
      );
    }

    if (
      typeof payment.id !== 'string' ||
      !payment.id.trim()
    ) {
      return Response.json(
        { error: 'Payment ID is missing' },
        { status: 400 }
      );
    }

    const {
      data: finalizeResult,
      error: finalizeError,
    } = await supabaseAdmin.rpc(
      'finalize_paid_order',
      {
        p_order_id: beanbookOrder.id,
        p_razorpay_payment_id: payment.id,
      }
    );

    if (finalizeError) {
      throw finalizeError;
    }

    return Response.json({
      received: true,
      handled: true,
      stockIssue:
        finalizeResult?.stock_issue === true,
      alreadyProcessed:
        finalizeResult?.already_processed === true,
      paymentStatus:
        finalizeResult?.payment_status ??
        'paid',
    });
  },
};
