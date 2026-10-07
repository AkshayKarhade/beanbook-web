import { supabaseAdmin } from '../lib/supabase-server';

export default {
  async fetch(request: Request) {
    if (request.method !== 'GET') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405 }
      );
    }

    try {
      const url = new URL(request.url);
      const eventSlug = url.searchParams.get('event');

      if (!eventSlug) {
        return Response.json(
          { error: 'Event slug is required' },
          { status: 400 }
        );
      }

      const {
        data: event,
        error: eventError,
      } = await supabaseAdmin
        .from('events')
        .select(`
          id,
          brand_id,
          name,
          slug,
          status,
          event_start_date,
          event_end_date,
          location
        `)
        .eq('slug', eventSlug)
        .eq('status', 'active')
        .maybeSingle();

      if (eventError) throw eventError;

      if (!event) {
        return Response.json(
          { error: 'Event not found or inactive' },
          { status: 404 }
        );
      }

      const today = new Date().toISOString().slice(0, 10);

      if (
        (event.event_start_date &&
          today < event.event_start_date) ||
        (event.event_end_date &&
          today > event.event_end_date)
      ) {
        return Response.json(
          { error: 'Event is not currently active' },
          { status: 404 }
        );
      }

      const {
        data: brand,
        error: brandError,
      } = await supabaseAdmin
        .from('brands')
        .select('id, name')
        .eq('id', event.brand_id)
        .single();

      if (brandError) throw brandError;

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

      const {
        data: eventProducts,
        error: eventProductsError,
      } = await supabaseAdmin
        .from('event_products')
        .select(`
          product_id,
          is_available,
          display_order,
          price_override,
          products (
            id,
            name,
            price,
            description,
            is_active
          )
        `)
        .eq('event_id', event.id)
        .eq('is_available', true)
        .order('display_order');

      if (eventProductsError) {
        throw eventProductsError;
      }

      const {
        data: inventory,
        error: inventoryError,
      } = await supabaseAdmin
        .from('inventory_balances')
        .select('product_id, quantity_on_hand')
        .eq('inventory_unit_id', inventoryUnit.id);

      if (inventoryError) {
        throw inventoryError;
      }

      const stockByProduct = new Map(
        (inventory ?? []).map((row) => [
          row.product_id,
          row.quantity_on_hand,
        ])
      );

      const products = (eventProducts ?? [])
        .map((row) => {
          const product = Array.isArray(row.products)
            ? row.products[0]
            : row.products;

          if (!product || !product.is_active) {
            return null;
          }

          const quantityOnHand =
            inventoryUnit.track_inventory
              ? stockByProduct.get(product.id) ?? 0
              : 20;

          return {
            id: product.id,
            name: product.name,
            price:
              row.price_override ??
              product.price,
            description: product.description,
            quantity_on_hand: quantityOnHand,
            available:
              row.is_available &&
              (!inventoryUnit.track_inventory ||
                quantityOnHand > 0),
          };
        })
        .filter(Boolean);

      return Response.json({
        event: {
          id: event.id,
          name: event.name,
          slug: event.slug,
          startDate: event.event_start_date,
          endDate: event.event_end_date,
          location: event.location,
        },
        brand: {
          id: brand.id,
          name: brand.name,
        },
        products,
      });
    } catch (error) {
      console.error(
        'Could not load event menu:',
        error
      );

      return Response.json(
        { error: 'Could not load event menu' },
        { status: 500 }
      );
    }
  },
};
