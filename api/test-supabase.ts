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
      const { data, error } = await supabaseAdmin
        .from('customers')
        .select('id')
        .limit(1);

      if (error) {
        console.error(
          'Supabase connection test failed:',
          error
        );

        return Response.json(
          {
            connected: false,
            error: error.message,
          },
          { status: 500 }
        );
      }

      return Response.json({
        connected: true,
        database: 'Supabase',
        customersFound: data.length,
      });
    } catch (error) {
      console.error(
        'Supabase connection test failed:',
        error
      );

      return Response.json(
        {
          connected: false,
          error:
            error instanceof Error
              ? error.message
              : 'Unknown error',
        },
        { status: 500 }
      );
    }
  },
};