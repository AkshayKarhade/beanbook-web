export type DrinkTemperature = 'Hot' | 'Cold';
export type BrewMethod = 'Espresso' | 'Manual';

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  temperature: DrinkTemperature;
  brewMethod: BrewMethod;
  available: boolean;
};