/**
 * The customer-safe details of a product — the fields the public QR page may show.
 * Takes exactly those fields so it cannot be handed a price by accident.
 */
export interface ProductSpecFields {
  category?: string | null;
  description?: string | null;
  sizes?: string | null;
  dimensions?: string | null;
  material?: string | null;
  finish?: string | null;
}

const ROWS: ReadonlyArray<[keyof ProductSpecFields, string]> = [
  ["sizes", "Sizes"],
  ["dimensions", "Dimensions"],
  ["material", "Material"],
  ["finish", "Finish / colour"],
  ["category", "Category"],
];

export default function ProductSpecs({ product }: { product: ProductSpecFields }) {
  const rows = ROWS.filter(([key]) => product[key]);
  return (
    <div className="space-y-3">
      {product.description && (
        <p className="whitespace-pre-line text-body text-t2">{product.description}</p>
      )}
      {rows.length > 0 && (
        <dl className="divide-y divide-ln2 rounded-card border border-ln bg-sf">
          {rows.map(([key, label]) => (
            <div key={key} className="flex items-start justify-between gap-4 px-3 py-2.5">
              <dt className="shrink-0 text-caption text-t3">{label}</dt>
              <dd className="text-right text-ui text-t1 whitespace-pre-line">{product[key]}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
