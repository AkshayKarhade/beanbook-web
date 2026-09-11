import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">
        BeanBook — The 8th Coffee Bean
      </h1>

      <p className="text-gray-600 dark:text-gray-400">
        Simple for the operator. Frictionless for the customer. Structured enough to scale.
      </p>

      <div className="flex gap-3">
        <Link
          to="/order"
          className="rounded-md bg-gray-900 px-4 py-2 text-white dark:bg-white dark:text-gray-900"
        >
          Start an order
        </Link>

        <Link
          to="/admin"
          className="rounded-md border border-gray-300 px-4 py-2 dark:border-gray-700"
        >
          Open admin view
        </Link>
      </div>
    </div>
  );
}