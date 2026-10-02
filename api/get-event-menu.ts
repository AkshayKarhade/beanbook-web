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
          event_date,
          location
        `)
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

      const {
        data: brand,
        error: brandError,
      } = await supabaseAdmin
        .from('brands')
        .select('id, name')
        .eq('id', event.brand_id)
        .single();

      if (brandError) {
        throw brandError;
      }

      const {
        data: products,
        error: productsError,
      } = await supabaseAdmin
        .from('products')
        .select(`
          id,
          name,
          price,
          description
        `)
        .eq('brand_id', event.brand_id)
        .eq('is_active', true)
        .order('name');

      if (productsError) {
        throw productsError;
      }

      return Response.json({
        event: {
          id: event.id,
          name: event.name,
          slug: event.slug,
          date: event.event_date,
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
        {
          error: 'Could not load event menu',
        },
        { status: 500 }
      );
    }
  },
};