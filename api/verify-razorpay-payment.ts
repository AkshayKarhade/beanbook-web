
import Razorpay from "razorpay";
import { createHmac, timingSafeEqual } from "node:crypto";

export default {
  async fetch(request: Request) {
    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405 }
      );
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return Response.json(
        { error: "Razorpay credentials are missing" },
        { status: 500 }
      );
    }

    try {
      const body = await request.json();

      const orderId = body?.razorpay_order_id;
      const paymentId = body?.razorpay_payment_id;
      const signature = body?.razorpay_signature;

      if (
        typeof orderId !== "string" ||
        !/^order_[A-Za-z0-9]+$/.test(orderId) ||
        typeof paymentId !== "string" ||
        !/^pay_[A-Za-z0-9]+$/.test(paymentId) ||
        typeof signature !== "string" ||
        !/^[a-fA-F0-9]{64}$/.test(signature)
      ) {
        return Response.json(
          { error: "Invalid or missing payment details" },
          { status: 400 }
        );
      }

      // Step 1: Verify the payment signature.
      const expectedSignature = createHmac(
        "sha256",
        keySecret
      )
        .update(`${orderId}|${paymentId}`)
        .digest();

      const receivedSignature = Buffer.from(
        signature,
        "hex"
      );

      if (
        !timingSafeEqual(
          expectedSignature,
          receivedSignature
        )
      ) {
        return Response.json(
          { error: "Invalid payment signature" },
          { status: 400 }
        );
      }

      // Step 2: Retrieve payment details from Razorpay.
      const razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });

      const [razorpayOrder, payment] = await Promise.all([
        razorpay.orders.fetch(orderId),
        razorpay.payments.fetch(paymentId),
      ]);

      // Step 3: Verify our fixed ₹1 test transaction.
      // TEST ONLY: Replace this with a database-backed
      // BeanBook order lookup before accepting live payments.
      const isValidTestPayment =
        razorpayOrder.id === orderId &&
        razorpayOrder.receipt?.startsWith(
          "beanbook_test_"
        ) === true &&
        Number(razorpayOrder.amount) === 100 &&
        payment.order_id === orderId &&
        Number(payment.amount) === 100 &&
        payment.currency === "INR";

      if (!isValidTestPayment) {
        return Response.json(
          { error: "Payment does not match the test order" },
          { status: 400 }
        );
      }

      // A successful Checkout callback does not necessarily
      // mean the payment has already been captured.
      if (payment.status !== "captured") {
        return Response.json(
          {
            verified: false,
            status: payment.status,
            message: "Payment has not been captured yet",
          },
          { status: 202 }
        );
      }

      return Response.json({
        verified: true,
        testOnly: true,
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
      });
    } catch (error) {
      console.error(
        "Razorpay payment verification failed:",
        error
      );

      return Response.json(
        { error: "Could not verify payment" },
        { status: 500 }
      );
    }
  },
};
