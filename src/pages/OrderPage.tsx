import { useEffect, useState } from 'react';
import { menuItems } from '../data/menu';

import type {
  BrewMethod,
  DrinkTemperature,
} from '../types/menu';

import PhoneInput, {
  isValidPhoneNumber,
} from 'react-phone-number-input';

import 'react-phone-number-input/style.css';

import type { Customer } from '../types/customer';

import type {
  Order,
  OrderStatus,
  PaymentMethod,
} from '../types/order';

type TemperatureFilter = 'All' | DrinkTemperature;
type BrewFilter = 'All' | BrewMethod;

type OrderStep =
  | 'menu'
  | 'customer'
  | 'verify'
  | 'review'
  | 'status';

const MOCK_BEAN_CREDITS_AVAILABLE = 100;
const MAX_BEAN_CREDIT_PERCENT = 0.5;

export default function OrderPage() {
  const [cart, setCart] = useState<Record<string, number>>({});

  const [temperatureFilter, setTemperatureFilter] =
    useState<TemperatureFilter>('All');

  const [brewFilter, setBrewFilter] =
    useState<BrewFilter>('All');

  const [showMobileCart, setShowMobileCart] =
    useState(false);

  const [step, setStep] =
    useState<OrderStep>('menu');

  const [customer, setCustomer] = useState<Customer>({
    firstName: '',
    lastName: '',
    whatsappNumber: '',
    whatsappVerified: false,
  });

  const [customerError, setCustomerError] =
    useState('');
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');

  const [resendSeconds, setResendSeconds] =
  useState(30);

  const [beanCreditsToUse, setBeanCreditsToUse] =
  useState('');

  const [showPaymentModal, setShowPaymentModal] =
    useState(false);

  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod | null>(null);

  const [order, setOrder] =
    useState<Order | null>(null);

  function addItem(itemId: string) {
    setCart((currentCart) => ({
      ...currentCart,
      [itemId]: (currentCart[itemId] ?? 0) + 1,
    }));
  }

useEffect(() => {
  if (resendSeconds <= 0) {
    return;
  }

  const timer = window.setTimeout(() => {
    setResendSeconds(
      (current) => current - 1
    );
  }, 1000);

  return () =>
    window.clearTimeout(timer);
}, [resendSeconds]);

  function removeItem(itemId: string) {
    setCart((currentCart) => {
      const currentQuantity =
        currentCart[itemId] ?? 0;

      if (currentQuantity <= 1) {
        const updatedCart = {
          ...currentCart,
        };

        delete updatedCart[itemId];

        return updatedCart;
      }

      return {
        ...currentCart,
        [itemId]: currentQuantity - 1,
      };
    });
  }

  function updateCustomer(
    field:
      | 'firstName'
      | 'lastName'
      | 'whatsappNumber',
    value: string
  ) {
    setCustomer((currentCustomer) => ({
      ...currentCustomer,
      [field]: value,

      whatsappVerified:
        field === 'whatsappNumber'
          ? false
          : currentCustomer.whatsappVerified,
    }));
  }

  function goToCustomerDetails() {
    setShowMobileCart(false);
    setStep('customer');
  }

function sendOtp() {
  if (!customer.firstName.trim()) {
    setCustomerError(
      'Please enter your first name.'
    );
    return;
  }

  if (!customer.lastName.trim()) {
    setCustomerError(
      'Please enter your last name.'
    );
    return;
  }

  if (
    !customer.whatsappNumber ||
    !isValidPhoneNumber(
      customer.whatsappNumber
    )
  ) {
    setCustomerError(
      'Please enter a valid WhatsApp number.'
    );
    return;
  }

  setCustomerError('');
  setOtp('');
  setOtpError('');
  setResendSeconds(30);
  setStep('verify');
}

function resendOtp() {
  if (resendSeconds > 0) {
    return;
  }

  setOtp('');
  setOtpError('');
  setResendSeconds(30);

  // Real WhatsApp OTP sending will go here later.
}

function verifyOtp() {
  if (otp === '123456') {
    setCustomer((currentCustomer) => ({
      ...currentCustomer,
      whatsappVerified: true,
    }));

    setOtpError('');
    setStep('review');

    return;
  }

  setOtpError(
    'That code is incorrect. Try 123456 for now.'
  );
}

  function generateOrderNumber() {
    const number =
      Math.floor(Math.random() * 900) + 100;

    return `BB-${number}`;
  }

  const filteredMenuItems =
    menuItems.filter((item) => {
      const matchesTemperature =
        temperatureFilter === 'All' ||
        item.temperature === temperatureFilter;

      const matchesBrewMethod =
        brewFilter === 'All' ||
        item.brewMethod === brewFilter;

      return (
        matchesTemperature &&
        matchesBrewMethod
      );
    });

  const cartItems =
    menuItems.filter(
      (item) => cart[item.id]
    );

  const totalItems =
    cartItems.reduce(
      (total, item) =>
        total + cart[item.id],
      0
    );

  const totalPrice =
    cartItems.reduce(
      (total, item) =>
        total +
        item.price * cart[item.id],
      0
    );
  const maxCreditsAllowed = Math.min(
    MOCK_BEAN_CREDITS_AVAILABLE,
    Math.floor(totalPrice * MAX_BEAN_CREDIT_PERCENT)
  );

  const requestedBeanCredits =
  Number(beanCreditsToUse || 0);

  const beanCreditsUsed =
      Math.min(
    requestedBeanCredits,
    maxCreditsAllowed
  );

  const finalAmount =
    Math.max(
      totalPrice - beanCreditsUsed,
      0
    );

  function confirmPayment() {
    if (!paymentMethod) {
      return;
    }

    const newOrder: Order = {
      id: crypto.randomUUID(),

      orderNumber: generateOrderNumber(),

      customer: {
        firstName: customer.firstName,
        lastName: customer.lastName,
        whatsappNumber:
          customer.whatsappNumber,
      },

      items: cartItems.map((item) => ({
        menuItemId: item.id,
        name: item.name,
        price: item.price,
        quantity: cart[item.id],
      })),

      subtotal: totalPrice,

      beanCreditsUsed,

      finalAmount,

      paymentMethod,

      status:
        'awaiting_payment_confirmation',

      createdAt: new Date().toISOString(),
    };

    setOrder(newOrder);

    setShowPaymentModal(false);

    setStep('status');
  }

  if (step === 'customer') {
    return (
      <CustomerDetails
        customer={customer}
        error={customerError}
        onChange={updateCustomer}
        onBack={() => setStep('menu')}
        onSendOtp={sendOtp}
      />
    );
  }

  if (step === 'verify') {
    return (
      <OtpVerification
        whatsappNumber={
          customer.whatsappNumber
        }
        otp={otp}
        error={otpError}
        resendSeconds={resendSeconds}
        onOtpChange={setOtp}
        onVerify={verifyOtp}
        onBack={() =>
          setStep('customer')
        }
        onResend={resendOtp}
      />
    );
  }

  if (step === 'review') {
    return (
      <>
        <OrderReview
          customer={customer}
          cart={cart}
          totalItems={totalItems}
          totalPrice={totalPrice}
          beanCreditsAvailable={MOCK_BEAN_CREDITS_AVAILABLE}
          maxCreditsAllowed={maxCreditsAllowed}
          beanCreditsToUse={beanCreditsToUse}
          beanCreditsUsed={beanCreditsUsed}
          finalAmount={finalAmount}
          onBeanCreditsChange={(value: string) => {
            setBeanCreditsToUse(value);
            }}
          onBack={() =>
            setStep('menu')
          }
          onPayNow={() =>
            setShowPaymentModal(true)
          }
        />

        {showPaymentModal && (
          <PaymentModal
            amount={finalAmount}
            paymentMethod={
              paymentMethod
            }
            onSelectMethod={
              setPaymentMethod
            }
            onClose={() => {
              setShowPaymentModal(false);
              setPaymentMethod(null);
            }}
            onConfirm={
              confirmPayment
            }
          />
        )}
      </>
    );
  }

  if (step === 'status' && order) {
    return (
      <OrderStatusPage
        order={order}
      />
    );
  }

  return (
    <>
      <div className="grid gap-8 pb-24 lg:grid-cols-[1fr_320px] lg:pb-0">

        <section className="space-y-6">

          <div>
            <h1 className="text-2xl font-semibold">
              Coffee Menu
            </h1>

            <p className="mt-1 text-gray-600 dark:text-gray-400">
              Find your coffee and add it
              to your order.
            </p>
          </div>

          <div className="space-y-4">

            <FilterGroup
              label="Temperature"
              options={[
                'All',
                'Hot',
                'Cold',
              ]}
              selected={
                temperatureFilter
              }
              onSelect={(value) =>
                setTemperatureFilter(
                  value as TemperatureFilter
                )
              }
            />

            <FilterGroup
              label="Brew method"
              options={[
                'All',
                'Espresso',
                'Manual',
              ]}
              selected={brewFilter}
              onSelect={(value) =>
                setBrewFilter(
                  value as BrewFilter
                )
              }
            />

          </div>

          {filteredMenuItems.length ===
          0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500 dark:border-gray-700">
              No drinks match these
              filters.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">

              {filteredMenuItems.map(
                (item) => {
                  const quantity =
                    cart[item.id] ?? 0;

                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
                    >
                      <div className="flex items-start justify-between gap-4">

                        <div>
                          <h2 className="font-semibold">
                            {item.name}
                          </h2>

                          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                            {
                              item.description
                            }
                          </p>

                          <div className="mt-3 flex flex-wrap gap-2">

                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs dark:bg-gray-800">
                              {
                                item.temperature
                              }
                            </span>

                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs dark:bg-gray-800">
                              {
                                item.brewMethod
                              }
                            </span>

                          </div>
                        </div>

                        <span className="shrink-0 font-semibold">
                          ₹{item.price}
                        </span>

                      </div>

                      <div className="mt-5">

                        {quantity === 0 ? (
                          <button
                            type="button"
                            onClick={() =>
                              addItem(
                                item.id
                              )
                            }
                            className="min-h-12 w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white dark:bg-white dark:text-gray-900"
                          >
                            Add
                          </button>
                        ) : (
                          <div className="flex items-center justify-between">

                            <button
                              type="button"
                              onClick={() =>
                                removeItem(
                                  item.id
                                )
                              }
                              className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-300 text-2xl dark:border-gray-700"
                            >
                              −
                            </button>

                            <span className="min-w-12 text-center text-lg font-semibold">
                              {quantity}
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                addItem(
                                  item.id
                                )
                              }
                              className="flex h-12 w-12 items-center justify-center rounded-lg border border-gray-300 text-2xl dark:border-gray-700"
                            >
                              +
                            </button>

                          </div>
                        )}

                      </div>
                    </div>
                  );
                }
              )}

            </div>
          )}

        </section>

        <aside className="hidden h-fit rounded-xl border border-gray-200 p-5 dark:border-gray-800 lg:sticky lg:top-6 lg:block">

          <CartSummary
            cart={cart}
            totalItems={totalItems}
            totalPrice={totalPrice}
            onContinue={
              goToCustomerDetails
            }
          />

        </aside>
      </div>

      {totalItems > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white p-3 shadow-lg dark:border-gray-800 dark:bg-gray-950 lg:hidden">

          <div className="mx-auto flex max-w-5xl items-center gap-4">

            <div className="min-w-0 flex-1">

              <p className="text-sm text-gray-500">
                {totalItems}{' '}
                {totalItems === 1
                  ? 'item'
                  : 'items'}
              </p>

              <p className="text-lg font-semibold">
                ₹{totalPrice}
              </p>

            </div>

            <button
              type="button"
              onClick={() =>
                setShowMobileCart(true)
              }
              className="min-h-12 rounded-lg bg-gray-900 px-6 font-medium text-white dark:bg-white dark:text-gray-900"
            >
              View order
            </button>

          </div>
        </div>
      )}

      {showMobileCart && (
        <div className="fixed inset-0 z-50 flex items-end lg:hidden">

          <button
            type="button"
            aria-label="Close order"
            onClick={() =>
              setShowMobileCart(false)
            }
            className="absolute inset-0 bg-black/40"
          />

          <div className="relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl dark:bg-gray-950">

            <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />

            <div className="flex items-center justify-between">

              <h2 className="text-xl font-semibold">
                Your order
              </h2>

              <button
                type="button"
                onClick={() =>
                  setShowMobileCart(false)
                }
                className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-300 text-xl dark:border-gray-700"
              >
                ×
              </button>

            </div>

            <div className="mt-5">

              <CartSummary
                cart={cart}
                totalItems={totalItems}
                totalPrice={totalPrice}
                onContinue={
                  goToCustomerDetails
                }
              />

            </div>

          </div>
        </div>
      )}
    </>
  );
}

type FilterGroupProps = {
  label: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
};

function FilterGroup({
  label,
  options,
  selected,
  onSelect,
}: FilterGroupProps) {
  return (
    <div>

      <p className="mb-2 text-sm font-medium">
        {label}
      </p>

      <div className="flex gap-2 overflow-x-auto pb-1">

        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() =>
              onSelect(option)
            }
            className={`min-h-11 shrink-0 rounded-full px-5 text-sm font-medium ${
              selected === option
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-950'
            }`}
          >
            {option}
          </button>
        ))}

      </div>
    </div>
  );
}

type CartSummaryProps = {
  cart: Record<string, number>;
  totalItems: number;
  totalPrice: number;
  onContinue: () => void;
};

function CartSummary({
  cart,
  totalItems,
  totalPrice,
  onContinue,
}: CartSummaryProps) {
  const cartItems =
    menuItems.filter(
      (item) => cart[item.id]
    );

  if (cartItems.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Your cart is empty.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-4">

        {cartItems.map((item) => {
          const quantity =
            cart[item.id];

          return (
            <div
              key={item.id}
              className="flex items-start justify-between gap-4"
            >
              <div>
                <p className="font-medium">
                  {item.name}
                </p>

                <p className="text-sm text-gray-500">
                  {quantity} × ₹
                  {item.price}
                </p>
              </div>

              <p className="font-medium">
                ₹
                {item.price *
                  quantity}
              </p>
            </div>
          );
        })}

      </div>

      <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-800">

        <div className="flex justify-between text-sm">
          <span>Items</span>
          <span>{totalItems}</span>
        </div>

        <div className="mt-2 flex justify-between text-lg font-semibold">
          <span>Total</span>
          <span>₹{totalPrice}</span>
        </div>

        <button
          type="button"
          onClick={onContinue}
          className="mt-5 min-h-12 w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white dark:bg-white dark:text-gray-900"
        >
          Continue
        </button>

      </div>
    </>
  );
}

type CustomerDetailsProps = {
  customer: Customer;
  error: string;

  onChange: (
    field:
      | 'firstName'
      | 'lastName'
      | 'whatsappNumber',
    value: string
  ) => void;

  onBack: () => void;
  onSendOtp: () => void;
};

function CustomerDetails({
  customer,
  error,
  onChange,
  onBack,
  onSendOtp,
}: CustomerDetailsProps) {
  const canContinue =
    customer.firstName.trim().length > 0 &&
    customer.lastName.trim().length > 0 &&
    customer.whatsappNumber.trim().length > 0;

  return (
    <div className="mx-auto max-w-xl">

      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm text-gray-600 hover:underline dark:text-gray-400"
      >
        ← Back to menu
      </button>

      <h1 className="text-2xl font-semibold">
        Your details
      </h1>

      <p className="mt-2 text-gray-600 dark:text-gray-400">
        We’ll verify your WhatsApp
        number before you place the
        order.
      </p>

      <div className="mt-8 space-y-5">

        <div>
          <label className="mb-2 block text-sm font-medium">
            First name
          </label>

          <input
            type="text"
            value={customer.firstName}
            onChange={(event) =>
              onChange(
                'firstName',
                event.target.value
              )
            }
            className="min-h-12 w-full rounded-lg border border-gray-300 bg-white px-4 dark:border-gray-700 dark:bg-gray-950"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">
            Last name
          </label>

          <input
            type="text"
            value={customer.lastName}
            onChange={(event) =>
              onChange(
                'lastName',
                event.target.value
              )
            }
            className="min-h-12 w-full rounded-lg border border-gray-300 bg-white px-4 dark:border-gray-700 dark:bg-gray-950"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">
            WhatsApp number
          </label>
          {error && (
              <p className="mt-2 text-sm text-red-600">
                {error}
              </p>
            )}  
          <div className="rounded-lg border border-gray-300 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-950">
            <PhoneInput
              international
              defaultCountry="IN"
              value={customer.whatsappNumber}
              onChange={(value) =>
                onChange(
                  'whatsappNumber',
                  value ?? ''
                )
              }
              placeholder="Enter WhatsApp number"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={!canContinue}
          onClick={onSendOtp}
          className="min-h-12 w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-900"
        >
          Send verification code
        </button>

      </div>
    </div>
  );
}

type OtpVerificationProps = {
  whatsappNumber: string;
  otp: string;
  error: string;
  resendSeconds: number;

  onOtpChange: (value: string) => void;
  onVerify: () => void;
  onBack: () => void;
  onResend: () => void;
};

function OtpVerification({
  whatsappNumber,
  otp,
  error,
  resendSeconds,
  onOtpChange,
  onVerify,
  onBack,
  onResend,
}: OtpVerificationProps) {
    const visibleDigits =
    whatsappNumber.slice(-4);

  const maskedNumber =
    `••••••${visibleDigits}`;
  return (
    <div className="mx-auto max-w-xl">

      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm text-gray-600 hover:underline dark:text-gray-400"
      >
        ← Change details
      </button>

      <h1 className="text-2xl font-semibold">
        Verify your WhatsApp
      </h1>

      <p className="mt-2 text-gray-600 dark:text-gray-400">
        We sent a 6-digit code to{' '}
        <strong>
          {maskedNumber}
        </strong>
      </p>

      <div className="mt-8">

        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={(event) =>
            onOtpChange(
              event.target.value.replace(
                /\D/g,
                ''
              )
            )
          }
          className="min-h-14 w-full rounded-lg border border-gray-300 bg-white px-4 text-center text-2xl tracking-[0.5em] dark:border-gray-700 dark:bg-gray-950"
          placeholder="000000"
        />

        {error && (
          <p className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <p className="mt-3 text-sm text-gray-500">
          Development code:{' '}
          <strong>123456</strong>
        </p>

        <button
          type="button"
          onClick={onVerify}
          disabled={otp.length !== 6}
          className="mt-5 min-h-12 w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-900"
        >
          Verify number
        </button>

        <button
          type="button"
          onClick={onResend}
          disabled={resendSeconds > 0}
          className={`mt-4 w-full rounded-lg px-4 py-3 text-sm font-medium transition ${
            resendSeconds > 0
            ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-900 dark:text-gray-600'
            : 'bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200'
          }`}
        >
          {resendSeconds > 0
            ? `Resend code in ${resendSeconds}s`
            : 'Resend code'}
        </button>

      </div>
    </div>
  );
}

type OrderReviewProps = {
  customer: Customer;
  cart: Record<string, number>;
  totalItems: number;
  totalPrice: number;

  beanCreditsAvailable: number;
  maxCreditsAllowed: number;
  beanCreditsToUse: string;
  beanCreditsUsed: number;
  finalAmount: number;
  onBeanCreditsChange: (
    value: string
  ) => void;
  onBack: () => void;
  onPayNow: () => void;
};

function OrderReview({
  customer,
  cart,
  totalItems,
  totalPrice,
  beanCreditsAvailable,
  maxCreditsAllowed,
  beanCreditsToUse,
  beanCreditsUsed,
  finalAmount,
  onBeanCreditsChange,
  onBack,
  onPayNow,
}: OrderReviewProps) {
  const cartItems =
    menuItems.filter(
      (item) => cart[item.id]
    );

  return (
    <div className="mx-auto max-w-2xl">

      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-sm text-gray-600 hover:underline dark:text-gray-400"
      >
        ← Edit order
      </button>

      <h1 className="text-2xl font-semibold">
        Review your order
      </h1>

      <p className="mt-2 text-gray-600 dark:text-gray-400">
        One last check before payment.
      </p>

      <div className="mt-8 rounded-xl border border-gray-200 p-5 dark:border-gray-800">

        <div className="flex items-start justify-between">

          <div>
            <h2 className="font-semibold">
              Customer
            </h2>

            <p className="mt-3">
              {customer.firstName}{' '}
              {customer.lastName}
            </p>

            <p className="text-sm text-gray-500">
              {
                customer.whatsappNumber
              }
            </p>
          </div>

          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
            WhatsApp verified
          </span>

        </div>
      </div>

      <div className="mt-5 rounded-xl border border-gray-200 p-5 dark:border-gray-800">

        <h2 className="font-semibold">
          Order
        </h2>

        <div className="mt-4 space-y-4">

          {cartItems.map((item) => {
            const quantity =
              cart[item.id];

            return (
              <div
                key={item.id}
                className="flex justify-between gap-4"
              >
                <div>
                  <p className="font-medium">
                    {item.name}
                  </p>

                  <p className="text-sm text-gray-500">
                    {quantity} × ₹
                    {item.price}
                  </p>
                </div>

                <p className="font-medium">
                  ₹
                  {quantity *
                    item.price}
                </p>
              </div>
            );
          })}

        </div>

        <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-800">

          <div className="flex justify-between text-sm text-gray-500">
            <span>
              {totalItems} items
            </span>

            <span>
              Subtotal ₹
              {totalPrice}
            </span>
          </div>

        </div>
      </div>

      <div className="mt-5 rounded-xl border border-gray-200 p-5 dark:border-gray-800">

        <div className="flex items-start justify-between gap-4">

          <div>
            <h2 className="font-semibold">
              Bean Credits
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              You have ₹
              {beanCreditsAvailable}{' '}
              available.
            </p>
            <p className="mt-1 text-sm text-gray-500">
              You can use up to ₹{maxCreditsAllowed}{' '}
              on this order.
            </p>
          </div>
            <div className="relative flex-1">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
                ₹
              </span>

              <input
                type="number"
                min={0}
                max={maxCreditsAllowed}
                value={beanCreditsToUse}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '') {
                    onBeanCreditsChange('');
                    return;
                  }
                  const numericValue = Number(value);
                    if (
                      numericValue >= 0 &&
                      numericValue <= maxCreditsAllowed
                    ) {
                      onBeanCreditsChange(value);
                    }
                  }
                }
                className="min-h-12 w-full rounded-lg border border-gray-300 bg-white pl-8 pr-4 dark:border-gray-700 dark:bg-gray-950"
              />
            </div>

          <button
            type="button"
            onClick={() =>
             onBeanCreditsChange(
                String(maxCreditsAllowed)
              )
            }
            disabled={
              maxCreditsAllowed === 0
            }
            className="min-h-12 rounded-lg border border-gray-300 px-4 font-medium disabled:opacity-40 dark:border-gray-700"
          >
            Use max
          </button>

        </div>

        {beanCreditsUsed > 0 && (
          <div className="mt-4 flex justify-between border-t border-gray-200 pt-4 text-sm dark:border-gray-800">

            <span className="text-gray-500">
              Bean Credits applied
            </span>

            <span className="font-medium">
              − ₹{beanCreditsUsed}
            </span>

          </div>
        )}

      </div>

      <div className="mt-6 space-y-3">

        <div className="flex justify-between text-sm text-gray-500">
          <span>Subtotal</span>
          <span>₹{totalPrice}</span>
        </div>

        {beanCreditsUsed > 0 && (
          <div className="flex justify-between text-sm">
            <span>Bean Credits</span>
            <span>
              − ₹{beanCreditsUsed}
            </span>
          </div>
        )}

        <div className="flex justify-between border-t border-gray-200 pt-4 text-xl font-semibold dark:border-gray-800">
          <span>Amount to pay</span>
          <span>₹{finalAmount}</span>
        </div>

      </div>

      <button
        type="button"
        onClick={onPayNow}
        className="mt-5 min-h-14 w-full rounded-xl bg-gray-900 px-4 py-3 text-lg font-medium text-white dark:bg-white dark:text-gray-900"
      >
        Pay now
      </button>

    </div>
  );
}

type PaymentModalProps = {
  amount: number;

  paymentMethod:
    | PaymentMethod
    | null;

  onSelectMethod: (
    method: PaymentMethod
  ) => void;

  onClose: () => void;
  onConfirm: () => void;
};

function PaymentModal({
  amount,
  paymentMethod,
  onSelectMethod,
  onClose,
  onConfirm,
}: PaymentModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">

      <button
        type="button"
        aria-label="Close payment"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />

      <div className="relative z-10 w-full rounded-t-2xl bg-white p-5 shadow-2xl dark:bg-gray-950 sm:max-w-lg sm:rounded-2xl sm:p-6">

        <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-gray-300 sm:hidden dark:bg-gray-700" />

        <div className="flex items-start justify-between">

          <div>
            <h2 className="text-xl font-semibold">
              Pay ₹{amount}
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              How would you like to
              pay?
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-gray-300 text-xl dark:border-gray-700"
          >
            ×
          </button>

        </div>

        <div className="mt-6 space-y-3">

          <button
            type="button"
            onClick={() =>
              onSelectMethod(
                'table_qr'
              )
            }
            className={`w-full rounded-xl border p-5 text-left ${
              paymentMethod ===
              'table_qr'
                ? 'border-gray-900 bg-gray-50 dark:border-white dark:bg-gray-900'
                : 'border-gray-200 dark:border-gray-800'
            }`}
          >
            <p className="font-semibold">
              Scan the QR on the table
            </p>

            <p className="mt-1 text-sm text-gray-500">
              Scan the payment QR
              displayed at the stall.
            </p>
          </button>

          <button
            type="button"
            onClick={() =>
              onSelectMethod(
                'upi_app'
              )
            }
            className={`w-full rounded-xl border p-5 text-left ${
              paymentMethod ===
              'upi_app'
                ? 'border-gray-900 bg-gray-50 dark:border-white dark:bg-gray-900'
                : 'border-gray-200 dark:border-gray-800'
            }`}
          >
            <p className="font-semibold">
              Pay using UPI app
            </p>

            <p className="mt-1 text-sm text-gray-500">
              Use your preferred UPI
              app on this phone.
            </p>
          </button>

        </div>

        {paymentMethod && (
          <div className="mt-6 rounded-xl bg-gray-100 p-4 dark:bg-gray-900">

            {paymentMethod ===
            'table_qr' ? (
              <>
                <p className="font-medium">
                  Scan the QR on the
                  table
                </p>

                <p className="mt-1 text-sm text-gray-500">
                  Pay exactly ₹
                  {amount}, then return
                  here.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">
                  Pay ₹{amount} using
                  your UPI app
                </p>

                <p className="mt-1 text-sm text-gray-500">
                  We’ll connect the
                  actual UPI payment
                  link later.
                </p>
              </>
            )}

          </div>
        )}

        <button
          type="button"
          disabled={!paymentMethod}
          onClick={onConfirm}
          className="mt-6 min-h-14 w-full rounded-xl bg-gray-900 px-4 py-3 text-lg font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-gray-900"
        >
          I’ve paid ₹{amount}
        </button>

        <p className="mt-3 text-center text-xs text-gray-500">
          Payment will still need to
          be confirmed by BeanBook.
        </p>

      </div>
    </div>
  );
}

function OrderStatusPage({
  order,
}: {
  order: Order;
}) {
  return (
    <div className="mx-auto max-w-xl py-6 text-center">

      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl dark:bg-amber-950">
        ☕
      </div>

      <p className="mt-6 text-sm font-medium uppercase tracking-wider text-gray-500">
        Order number
      </p>

      <h1 className="mt-1 text-4xl font-bold tracking-tight">
        {order.orderNumber}
      </h1>

      <div className="mt-8 rounded-2xl border border-gray-200 p-6 text-left dark:border-gray-800">

        <OrderStatusDisplay
          status={order.status}
        />

        <div className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-800">

          <div className="flex justify-between text-sm">
            <span className="text-gray-500">
              Customer
            </span>

            <span className="font-medium">
              {
                order.customer
                  .firstName
              }{' '}
              {
                order.customer
                  .lastName
              }
            </span>
          </div>

          <div className="mt-3 flex justify-between text-sm">
            <span className="text-gray-500">
              Subtotal
            </span>

            <span className="font-medium">
              ₹{order.subtotal}
            </span>
          </div>

          {order.beanCreditsUsed > 0 && (
            <div className="mt-3 flex justify-between text-sm">

              <span className="text-gray-500">
                Bean Credits
              </span>

              <span className="font-medium">
                − ₹
                {order.beanCreditsUsed}
              </span>

            </div>
          )}

          <div className="mt-3 flex justify-between text-sm">
            <span className="text-gray-500">
              Amount
            </span>

            <span className="font-medium">
              ₹{order.finalAmount}
            </span>
          </div>

          <div className="mt-3 flex justify-between text-sm">
            <span className="text-gray-500">
              Payment
            </span>

            <span className="font-medium">
              {order.paymentMethod ===
              'table_qr'
                ? 'Table QR'
                : 'UPI App'}
            </span>
          </div>

        </div>
      </div>

      <p className="mt-6 text-sm leading-6 text-gray-500">
        Keep this page open. Your
        order status will update after
        the payment is confirmed.
      </p>

    </div>
  );
}

function OrderStatusDisplay({
  status,
}: {
  status: OrderStatus;
}) {
  const statusContent: Record<
    OrderStatus,
    {
      title: string;
      description: string;
    }
  > = {
    awaiting_payment: {
      title: 'Waiting for payment',
      description:
        'Complete your payment to continue.',
    },

    awaiting_payment_confirmation: {
      title:
        'We’re confirming your payment',
      description:
        'Your payment has been submitted. We’ll confirm it shortly.',
    },

    awaiting_bank_confirmation: {
      title:
        'Bank confirmation is taking a little longer',
      description:
        'Your order is safe with us. We’re waiting for the payment confirmation.',
    },

    paid: {
      title: 'Payment confirmed',
      description:
        'Everything looks good.',
    },

    preparing: {
      title:
        'Your coffee is being prepared ☕',
      description:
        'The good stuff is underway.',
    },

    ready: {
      title:
        'Your coffee is ready!',
      description:
        'Come collect your order.',
    },

    completed: {
      title: 'Enjoy your coffee!',
      description:
        'Thanks for visiting us.',
    },

    cancelled: {
      title: 'Order cancelled',
      description:
        'This order is no longer active.',
    },
  };

  const content =
    statusContent[status];

  return (
    <div>
      <p className="text-lg font-semibold">
        {content.title}
      </p>

      <p className="mt-2 text-sm leading-6 text-gray-500">
        {content.description}
      </p>
    </div>
  );
}