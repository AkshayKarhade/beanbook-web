export type PaymentMethod = 'table_qr' | 'upi_app';

export type OrderStatus =
  | 'awaiting_payment'
  | 'awaiting_payment_confirmation'
  | 'awaiting_bank_confirmation'
  | 'paid'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled';

export type Order = {
  id: string;
  orderNumber: string;

  customer: {
    firstName: string;
    lastName: string;
    whatsappNumber: string;
  };

  items: {
    menuItemId: string;
    name: string;
    price: number;
    quantity: number;
  }[];

  subtotal: number;
  beanCreditsUsed: number;
  finalAmount: number;

  paymentMethod: PaymentMethod;
  status: OrderStatus;

  createdAt: string;
};