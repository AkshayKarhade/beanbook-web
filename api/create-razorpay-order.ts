import Razorpay from 'razorpay';
import { randomUUID } from 'node:crypto';

import { supabaseAdmin } from '../lib/supabase-server';

type RequestItem = {
  menuItemId: string;
  quantity: number;
};

type RequestCustomer = {
  firstName: string;
  lastName: string;
  whatsappNumber: string;
};

type FulfillmentType = 'pickup' | 'delivery';

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

      const eventSlug = body?.eventSlug;
      const paymentMethod = body?.paymentMethod;

      if (
        typeof eventSlug !== 'string' ||
        !eventSlug.trim()
      ) {
        return Response.json(
          { error: 'Event is required' },
          { status: 400 }
        );
      }

      if (paymentMethod !== 'razorpay') {
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

      const {
        data: event,
        error: eventError,
      } = await supabaseAdmin
        .from('events')
        .select('id, brand_id, slug')
        .eq('slug', eventSlug.trim())
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

      // Guest Scan & Pay checkout is restricted to inventory-tracked pickup locations.
      const isGuestCheckout = event.slug === 'crag-fridge' ||
        (body?.checkoutMode === 'scan-pay' && event.slug !== 'direct-delivery');

      if (
        !isGuestCheckout &&
        (
          !customer ||
          typeof customer.firstName !== 'string' ||
          !customer.firstName.trim() ||
          typeof customer.lastName !== 'string' ||
          !customer.lastName.trim() ||
          typeof customer.whatsappNumber !== 'string' ||
          !/^\+[1-9]\d{7,14}$/.test(
            customer.whatsappNumber
          )
        )
      ) {
        return Response.json(
          { error: 'Invalid customer details' },
          { status: 400 }
        );
      }

      let fulfillmentType: FulfillmentType | null = null;
      let deliveryAddress: string | null = null;
      let deliveryPhone: string | null = null;

      if (event.slug === 'direct-delivery') {
        const requestedFulfillmentType =
          body?.fulfillmentType;

        if (
          requestedFulfillmentType !== 'pickup' &&
          requestedFulfillmentType !== 'delivery'
        ) {
          return Response.json(
            { error: 'Please select pickup or delivery' },
            { status: 400 }
          );
        }

        fulfillmentType = requestedFulfillmentType;

        if (fulfillmentType === 'delivery') {
          const requestedAddress =
            body?.deliveryAddress;
          const requestedDeliveryPhone =
            body?.deliveryPhone;

          if (
            typeof requestedAddress !== 'string' ||
            requestedAddress.trim().length < 5 ||
            requestedAddress.trim().length > 1000
          ) {
            return Response.json(
              { error: 'A valid delivery address is required' },
              { status: 400 }
            );
          }

          if (
            typeof requestedDeliveryPhone !== 'string' ||
            !/^\+[1-9]\d{7,14}$/.test(
              requestedDeliveryPhone
            )
          ) {
            return Response.json(
              { error: 'A valid delivery phone number is required' },
              { status: 400 }
            );
          }

          deliveryAddress =
            requestedAddress.trim();
          deliveryPhone =
            requestedDeliveryPhone;
        }
      }

      const {
        data: inventoryUnit,
        error: inventoryUnitError,
      } = await supabaseAdmin
        .from('inventory_units')
        .select('id, track_inventory')
        .eq('legacy_event_id', event.id)
        .eq('status', 'active')
        .maybeSingle();

      if (inventoryUnitError) {
        throw inventoryUnitError;
      }

      if (!inventoryUnit) {
        return Response.json(
          { error: 'Inventory unit is not configured for this fridge' },
          { status: 409 }
        );
      }

      if (isGuestCheckout && !inventoryUnit.track_inventory) {
        return Response.json(
          { error: 'Scan & Pay requires inventory tracking at this location' },
          { status: 409 }
        );
      }

      const seenItemIds = new Set<string>();

      for (const requestItem of requestItems) {
        if (
          typeof requestItem?.menuItemId !== 'string' ||
          !Number.isInteger(requestItem.quantity) ||
          requestItem.quantity < 1 ||
          requestItem.quantity > 20
        ) {
          return Response.json(
            { error: 'Invalid order item' },
            { status: 400 }
          );
        }

        if (seenItemIds.has(requestItem.menuItemId)) {
          return Response.json(
            { error: 'Duplicate menu item in order' },
            { status: 400 }
          );
        }

        seenItemIds.add(requestItem.menuItemId);
      }

      const itemIds = Array.from(seenItemIds);

      const {
        data: eventProducts,
        error: eventProductsError,
      } = await supabaseAdmin
        .from('event_products')
        .select(`
          product_id,
          is_available,
          price_override,
          products (
            id,
            name,
            price,
            is_active
          )
        `)
        .eq('event_id', event.id)
        .eq('is_available', true)
        .in('product_id', itemIds);

      if (eventProductsError) {
        throw eventProductsError;
      }

      if (
        !eventProducts ||
        eventProducts.length !== itemIds.length
      ) {
        return Response.json(
          {
            error:
              'One or more products are unavailable for this event',
          },
          { status: 400 }
        );
      }

      const {
        data: inventory,
        error: inventoryError,
      } = await supabaseAdmin
        .from('inventory_balances')
        .select('product_id, quantity_on_hand')
        .eq('inventory_unit_id', inventoryUnit.id)
        .in('product_id', itemIds);

      if (inventoryError) {
        throw inventoryError;
      }

      const inventoryByProduct = new Map(
        (inventory ?? []).map((row) => [
          row.product_id,
          row.quantity_on_hand,
        ])
      );

      const eventProductsById = new Map(
        eventProducts.map((row) => [
          row.product_id,
          row,
        ])
      );

      const orderItems = requestItems.map(
        (requestItem) => {
          const eventProduct =
            eventProductsById.get(
              requestItem.menuItemId
            );

          const product = Array.isArray(
            eventProduct?.products
          )
            ? eventProduct?.products[0]
            : eventProduct?.products;

          if (!eventProduct || !product || !product.is_active) {
            throw new Error(
              'Product validation failed'
            );
          }

          if (inventoryUnit.track_inventory) {
            const quantityOnHand =
              inventoryByProduct.get(product.id) ?? 0;

            if (requestItem.quantity > quantityOnHand) {
              throw new Error(
                `Insufficient stock for product: ${product.id}`
              );
            }
          }

          const priceRupees = Number(
            eventProduct.price_override ??
              product.price
          );

          if (
            !Number.isFinite(priceRupees) ||
            priceRupees <= 0
          ) {
            throw new Error(
              `Invalid price for product: ${product.id}`
            );
          }

          return {
            productId: product.id,
            unitPriceRupees: priceRupees,
            quantity: requestItem.quantity,
          };
        }
      );

      const totalAmountRupees = orderItems.reduce(
        (total, item) =>
          total +
          item.unitPriceRupees * item.quantity,
        0
      );

      const finalAmountPaise =
        Math.round(totalAmountRupees * 100);

      // No fabricated customer profile for guest fridge purchases.
      let customerId: string | null = null;
      if (!isGuestCheckout && customer) {
      const customerName =
        `${customer.firstName.trim()} ${customer.lastName.trim()}`.trim();

      const {
        data: existingCustomer,
        error: customerLookupError,
      } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('brand_id', event.brand_id)
        .eq('phone', customer.whatsappNumber)
        .maybeSingle();

      if (customerLookupError) {
        throw customerLookupError;
      }

      customerId = existingCustomer?.id ?? null;

      if (customerId) {
        const { error: customerUpdateError } =
          await supabaseAdmin
            .from('customers')
            .update({
              name: customerName,
              first_name: customer.firstName.trim(),
              last_name: customer.lastName.trim(),
              phone: customer.whatsappNumber,
              whatsapp_verification_status: 'unverified',
              whatsapp_verified_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', customerId);

        if (customerUpdateError) {
          throw customerUpdateError;
        }
      } else {
        const { data: newCustomer, error: customerInsertError } =
          await supabaseAdmin
            .from('customers')
            .insert({
              brand_id: event.brand_id,
              name: customerName,
              first_name: customer.firstName.trim(),
              last_name: customer.lastName.trim(),
              phone: customer.whatsappNumber,
              whatsapp_verification_status: 'unverified',
              whatsapp_verified_at: null,
              updated_at: new Date().toISOString(),
            })
            .select('id')
            .single();

        if (customerInsertError) {
          throw customerInsertError;
        }

        customerId = newCustomer.id;
      }

      }

      const orderNumber =
        `BB-${randomUUID()
          .slice(0, 8)
          .toUpperCase()}`;

      const {
        data: beanbookOrder,
        error: orderInsertError,
      } = await supabaseAdmin
        .from('orders')
        .insert({
          brand_id: event.brand_id,
          event_id: event.id,
          inventory_unit_id: inventoryUnit.id,
          customer_id: customerId,
          order_number: orderNumber,
          total_amount: totalAmountRupees,
          fulfillment_type: fulfillmentType,
          delivery_address: deliveryAddress,
          delivery_phone: deliveryPhone,
        })
        .select('id, order_number')
        .single();

      if (orderInsertError) {
        throw orderInsertError;
      }

      const { error: itemsInsertError } =
        await supabaseAdmin
          .from('order_items')
          .insert(
            orderItems.map((item) => ({
              order_id: beanbookOrder.id,
              product_id: item.productId,
              quantity: item.quantity,
              unit_price: item.unitPriceRupees,
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
              beanbook_event_slug:
                event.slug,
              beanbook_fulfillment:
                fulfillmentType ?? 'event',
            },
          });
      } catch (error) {
        await supabaseAdmin
          .from('orders')
          .update({
            payment_status: 'failed',
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
          details: getErrorMessage(error),
        },
        { status: 500 }
      );
    }
  },
};
