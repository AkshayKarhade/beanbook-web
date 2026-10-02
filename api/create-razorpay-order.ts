import Razorpay from 'razorpay';
import { supabaseAdmin } from '../lib/supabase-server';
import { menuItems } from '../src/data/menu';

type RequestItem = {
  menuItemId: string;
  quantity: number;
};

type RequestCustomer = {
  firstName: string;
  lastName: string;
  whatsappNumber: string;
};

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

      const customer =
        body?.customer as RequestCustomer | undefined;

      const requestItems =
        body?.items as RequestItem[] | undefined;

      const paymentMethod = body?.paymentMethod;

      if (
        !customer ||
        typeof customer.firstName !== 'string' ||
        !customer.firstName.trim() ||
        typeof customer.lastName !== 'string' ||
        !customer.lastName.trim() ||
        typeof customer.whatsappNumber !== 'string' ||
        !/^\+[1-9]\d{7,14}$/.test(
          customer.whatsappNumber
        )
      ) {
        return Response.json(
          { error: 'Invalid customer details' },
          { status: 400 }
        );
      }

      if (
        paymentMethod !== 'table_qr' &&
        paymentMethod !== 'upi_app'
      ) {
        return Response.json(
          { error: 'Invalid payment method' },
          { status: 400 }
        );
      }

      if (
        !Array.isArray(requestItems) ||
        requestItems.length === 0
      ) {
        return Response.json(
          { error: 'Order must contain items' },
          { status: 400 }
        );
      }

      const seenItemIds = new Set<string>();

      const orderItems = requestItems.map(
        (requestItem) => {
          if (
            typeof requestItem.menuItemId !== 'string' ||
            !Number.isInteger(requestItem.quantity) ||
            requestItem.quantity < 1 ||
            requestItem.quantity > 20
          ) {
            throw new Error('Invalid order item');
          }

          if (
            seenItemIds.has(requestItem.menuItemId)
          ) {
            throw new Error(
              'Duplicate menu item in order'
            );
          }

          seenItemIds.add(requestItem.menuItemId);

          const menuItem = menuItems.find(
            (item) =>
              item.id === requestItem.menuItemId
          );

          if (!menuItem || !menuItem.available) {
            throw new Error(
              `Menu item is unavailable: ${requestItem.menuItemId}`
            );
          }

          return {
            menuItemId: menuItem.id,
            name: menuItem.name,
            unitPricePaise:
              Math.round(menuItem.price * 100),
            quantity: requestItem.quantity,
          };
        }
      );

      const subtotalPaise = orderItems.reduce(
        (total, item) =>
          total +
          item.unitPricePaise * item.quantity,
        0
      );

      // Bean Credits are intentionally disabled
      // until we have a real server-side credit ledger.
      const beanCreditsUsedPaise = 0;

      const finalAmountPaise =
        subtotalPaise - beanCreditsUsedPaise;

      if (finalAmountPaise <= 0) {
        return Response.json(
          { error: 'Order amount must be positive' },
          { status: 400 }
        );
      }

      const {
        data: existingCustomer,
        error: customerLookupError,
      } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq(
          'whatsapp_number',
          customer.whatsappNumber
        )
        .maybeSingle();

      if (customerLookupError) {
        throw customerLookupError;
      }

      let customerId: string;

      if (existingCustomer) {
        customerId = existingCustomer.id;

        const { error: customerUpdateError } =
          await supabaseAdmin
            .from('customers')
            .update({
              first_name:
                customer.firstName.trim(),
              last_name:
                customer.lastName.trim(),
              updated_at:
                new Date().toISOString(),
            })
            .eq('id', customerId);

        if (customerUpdateError) {
          throw customerUpdateError;
        }
      } else {
        const {
          data: newCustomer,
          error: customerInsertError,
        } = await supabaseAdmin
          .from('customers')
          .insert({
            first_name:
              customer.firstName.trim(),
            last_name:
              customer.lastName.trim(),
            whatsapp_number:
              customer.whatsappNumber,

            // OTP is still mocked in the frontend,
            // so do not claim real verification yet.
            whatsapp_verified: false,
          })
          .select('id')
          .single();

        if (customerInsertError) {
          throw customerInsertError;
        }

        customerId = newCustomer.id;
      }

      const {
        data: beanbookOrder,
        error: orderInsertError,
      } = await supabaseAdmin
        .from('orders')
        .insert({
          customer_id: customerId,
          subtotal_paise: subtotalPaise,
          bean_credits_used_paise:
            beanCreditsUsedPaise,
          final_amount_paise:
            finalAmountPaise,
          payment_method: paymentMethod,
          status: 'awaiting_payment',
        })
        .select('id, order_sequence')
        .single();

      if (orderInsertError) {
        throw orderInsertError;
      }

      const orderNumber =
        `BB-${beanbookOrder.order_sequence}`;

      const { error: itemsInsertError } =
        await supabaseAdmin
          .from('order_items')
          .insert(
            orderItems.map((item) => ({
              order_id: beanbookOrder.id,
              menu_item_id: item.menuItemId,
              name: item.name,
              unit_price_paise:
                item.unitPricePaise,
              quantity: item.quantity,
            }))
          );

      if (itemsInsertError) {
        throw itemsInsertError;
      }

      const razorpay = new Razorpay({
        key_id: keyId,
        key_secret: keySecret,
      });

      let razorpayOrder;

      try {
        razorpayOrder =
          await razorpay.orders.create({
            amount: finalAmountPaise,
            currency: 'INR',
            receipt: orderNumber,
            notes: {
              beanbook_order_id:
                beanbookOrder.id,
              beanbook_order_number:
                orderNumber,
            },
          });
      } catch (error) {
        await supabaseAdmin
          .from('orders')
          .update({
            status: 'cancelled',
            updated_at:
              new Date().toISOString(),
          })
          .eq('id', beanbookOrder.id);

        throw error;
      }

      const { error: orderUpdateError } =
        await supabaseAdmin
          .from('orders')
          .update({
            razorpay_order_id:
              razorpayOrder.id,
            updated_at:
              new Date().toISOString(),
          })
          .eq('id', beanbookOrder.id);

      if (orderUpdateError) {
        throw orderUpdateError;
      }

      return Response.json({
        beanbookOrderId:
          beanbookOrder.id,

        orderNumber,

        razorpayOrderId:
          razorpayOrder.id,

        amount:
          finalAmountPaise,

        currency: 'INR',

        keyId,
      });
    } catch (error) {
      console.error(
        'BeanBook order creation failed:',
        error
      );

      return Response.json(
        {
          error: 'Could not create order',
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