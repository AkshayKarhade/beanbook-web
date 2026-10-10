import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

type FridgeProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  available: boolean;
  quantity_on_hand: number;
};

type MenuResponse = {
  event?: { name?: string; location?: string | null };
  products: Array<{
    id: string;
    name: string;
    description: string | null;
    price: number | string;
    available: boolean;
    quantity_on_hand: number;
  }>;
};

type CheckoutStage =
  | 'menu'
  | 'verifying'
  | 'paid'
  | 'paid_stock_issue'
  | 'verification_delayed';

type RazorpayPaymentResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayCheckout = { open: () => void };
type RazorpayWindow = Window & {
  Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
};

const currency = (amount: number) => '₹' + amount.toLocaleString('en-IN');

export default function CragExpressPage() {
  const { eventSlug } = useParams();
  const locationSlug = eventSlug || 'crag-fridge';
  const [locationName, setLocationName] = useState('');
  const [products, setProducts] = useState<FridgeProduct[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [stage, setStage] = useState<CheckoutStage>('menu');
  const [orderNumber, setOrderNumber] = useState('');
  const startingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadMenu() {
      try {
        const response = await fetch(
          '/api/get-event-menu?event=' + encodeURIComponent(locationSlug),
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error('The fridge menu could not be loaded.');
        }

        const menu = (await response.json()) as MenuResponse;
        if (!Array.isArray(menu.products)) {
          throw new Error('The fridge menu is unavailable.');
        }

        setLocationName(menu.event?.location || menu.event?.name || locationSlug.replace(/-/g, ' '));
        setProducts(menu.products.map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description,
          price: Number(product.price),
          available: product.available,
          quantity_on_hand: Math.max(0, Number(product.quantity_on_hand) || 0),
        })));
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Unable to load fridge menu:', error);
        setMenuError('We could not load the fridge menu. Please try again.');
      } finally {
        if (!controller.signal.aborted) setMenuLoading(false);
      }
    }

    void loadMenu();
    return () => controller.abort();
  }, [locationSlug]);

  function changeQuantity(product: FridgeProduct, delta: number) {
    if (isStarting) return;
    setQuantities((current) => ({
      ...current,
      [product.id]: Math.max(
        0,
        Math.min(
          product.available ? product.quantity_on_hand : 0,
          (current[product.id] ?? 0) + delta
        )
      ),
    }));
  }

  const selectedProducts = products.filter((product) => (quantities[product.id] ?? 0) > 0);
  const itemCount = selectedProducts.reduce(
    (count, product) => count + quantities[product.id], 0
  );
  const total = selectedProducts.reduce(
    (amount, product) => amount + product.price * quantities[product.id], 0
  );

  async function verifyPayment(payment: RazorpayPaymentResponse) {
    setStage('verifying');

    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await fetch('/api/verify-razorpay-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payment),
        });
        const result = await response.json();

        if (response.ok && result.verified === true) {
          setStage(result.stockIssue === true ? 'paid_stock_issue' : 'paid');
          return;
        }

        if (response.status !== 202) {
          throw new Error(result.error || 'Unable to verify payment right now.');
        }

        await new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
      }

      setStage('verification_delayed');
    } catch (error) {
      console.error('Payment verification pending:', error);
      // The signed Razorpay webhook can still finalize the order independently.
      // Never show a failed-payment message after Razorpay has returned success.
      setStage('verification_delayed');
    }
  }

  async function payNow() {
    if (startingRef.current || itemCount === 0 || stage !== 'menu') return;

    startingRef.current = true;
    setIsStarting(true);
    setCheckoutError('');
    let checkoutOpened = false;

    try {
      const response = await fetch('/api/create-razorpay-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventSlug: locationSlug,
          items: selectedProducts.map((product) => ({
            menuItemId: product.id,
            quantity: quantities[product.id],
          })),
          paymentMethod: 'razorpay',
        }),
      });

      const created = await response.json();
      if (!response.ok) {
        throw new Error(created.error || created.details || 'Could not start payment.');
      }

      if (Number(created.amount) !== Math.round(total * 100)) {
        throw new Error('Prices have changed. Please reload the menu before paying.');
      }

      const Razorpay = (window as RazorpayWindow).Razorpay;
      if (!Razorpay) {
        throw new Error('Payment checkout is unavailable. Please try again.');
      }

      const checkout = new Razorpay({
        key: created.keyId,
        amount: created.amount,
        currency: created.currency,
        name: 'The 8th Coffee Bean',
        description: locationName ? 'Cold brew at ' + locationName : 'Cold brew bottles',
        order_id: created.razorpayOrderId,
        handler: (payment: RazorpayPaymentResponse) => {
          setOrderNumber(created.orderNumber);
          void verifyPayment(payment);
        },
        modal: {
          ondismiss: () => {
            startingRef.current = false;
            setIsStarting(false);
          },
        },
        theme: { color: '#222222' },
      });

      checkout.open();
      checkoutOpened = true;
    } catch (error) {
      console.error('Unable to start express checkout:', error);
      setCheckoutError(
        error instanceof Error ? error.message : 'Unable to start payment. Please retry.'
      );
    } finally {
      if (!checkoutOpened) {
        startingRef.current = false;
        setIsStarting(false);
      }
    }
  }

  if (stage !== 'menu') {
    const completed = stage === 'paid';
    const stockIssue = stage === 'paid_stock_issue';
    return (
      <section className="mx-auto max-w-md py-12 text-center" role="status" aria-live="polite">
        <div className="mb-5 text-5xl">{completed ? '✓' : '☕'}</div>
        <h1 className="text-2xl font-bold">
          {completed
            ? 'Payment successful'
            : stockIssue
              ? 'Paid — please see reception'
              : stage === 'verifying'
                ? 'Confirming your payment'
                : 'Payment confirmation is taking longer'}
        </h1>
        <p className="mt-4 text-lg font-semibold">{orderNumber}</p>
        <p className="mt-3 text-gray-600 dark:text-gray-400">
          {completed
            ? 'Show this confirmation at reception and collect your bottles.'
            : stockIssue
              ? 'Your payment is confirmed, but the fridge stock changed. Please show this screen at reception.'
              : 'Please keep this page open. Do not pay again while confirmation is pending.'}
        </p>
      </section>
    );
  }

  if (menuLoading) {
    return <p className="py-16 text-center text-gray-500">Loading fridge menu...</p>;
  }

  if (menuError) {
    return (
      <section className="py-16 text-center">
        <h1 className="text-xl font-semibold">Menu unavailable</h1>
        <p className="mt-3 text-gray-500">{menuError}</p>
        <button type="button" className="mt-6 rounded-lg border px-5 py-3" onClick={() => window.location.reload()}>
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl pb-28">
      <h1 className="text-2xl font-bold">Cold Brews at {locationName || 'The 8th Coffee Bean'}</h1>
      <p className="mt-2 text-gray-600 dark:text-gray-400">
        Choose your bottles and pay. That's it.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {products.map((product) => {
          const quantity = quantities[product.id] ?? 0;
          const inStock = product.available && product.quantity_on_hand > 0;
          return (
            <article key={product.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{product.name}</h2>
                  {product.description && (
                    <p className="mt-1 text-sm text-gray-500">{product.description}</p>
                  )}
                </div>
                <span className="shrink-0 font-semibold">{currency(product.price)}</span>
              </div>
              <p className="mt-3 text-sm text-gray-500">
                {inStock ? product.quantity_on_hand + ' available' : 'Sold out'}
              </p>
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  aria-label={'Remove ' + product.name}
                  disabled={quantity === 0 || isStarting}
                  onClick={() => changeQuantity(product, -1)}
                  className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-300 text-2xl disabled:opacity-30 dark:border-gray-700"
                >−</button>
                <span className="text-lg font-semibold" aria-label={'Quantity ' + quantity}>{quantity}</span>
                <button
                  type="button"
                  aria-label={'Add ' + product.name}
                  disabled={!inStock || isStarting || quantity >= product.quantity_on_hand}
                  onClick={() => changeQuantity(product, 1)}
                  className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-900 text-2xl text-white disabled:opacity-30 dark:bg-white dark:text-gray-900"
                >+</button>
              </div>
            </article>
          );
        })}
      </div>

      {products.length === 0 && (
        <p className="mt-8 text-center text-gray-500">No bottles are currently listed.</p>
      )}
      {checkoutError && (
        <p role="alert" className="mt-5 rounded-lg border border-red-300 p-3 text-sm text-red-700 dark:text-red-300">
          {checkoutError}
        </p>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white p-3 shadow-lg dark:border-gray-800 dark:bg-gray-950">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-500">{itemCount} {itemCount === 1 ? 'bottle' : 'bottles'}</p>
            <p className="text-xl font-bold">{currency(total)}</p>
          </div>
          <button
            type="button"
            disabled={itemCount === 0 || isStarting}
            onClick={() => void payNow()}
            className="min-h-14 rounded-xl bg-gray-900 px-7 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900"
          >
            {isStarting ? 'Opening payment...' : 'Pay Now'}
          </button>
        </div>
      </div>
    </section>
  );
}
