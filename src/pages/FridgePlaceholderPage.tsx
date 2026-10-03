import { useParams } from 'react-router-dom';

type FridgePlaceholderPageProps = {
  mode: 'order' | 'explore';
};

export default function FridgePlaceholderPage({
  mode,
}: FridgePlaceholderPageProps) {
  const { fridgeId } = useParams();

  if (fridgeId !== 'F001') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">
          Fridge not found
        </h1>

        <p>
          We could not find this fridge.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Fridge {fridgeId}
      </p>

      <h1 className="text-3xl font-semibold">
        CRAG Fridge
      </h1>

      {mode === 'order' ? (
        <>
          <h2 className="text-xl font-medium">
            Order from this fridge
          </h2>

          <p>
            The CRAG fridge ordering experience is being built here.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-xl font-medium">
            Not sure what to try?
          </h2>

          <p>
            The CRAG drink guide is being built here.
          </p>
        </>
      )}
    </div>
  );
}