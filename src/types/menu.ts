export type DrinkTemperature = 'Hot' | 'Cold';
export type BrewMethod = 'Espresso' | 'Manual';

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  available: boolean;
  quantityOnHand?: number;

  // Optional presentation metadata.
  // Not every BeanBook product needs these.
  category?: string;
  temperature?: DrinkTemperature;
  brewMethod?: BrewMethod;
};