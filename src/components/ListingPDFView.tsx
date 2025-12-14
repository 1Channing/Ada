interface ListingPDFViewProps {
  listing: {
    title: string;
    year: number | null;
    car_image_urls: string[] | null;
  };
  brand?: string;
  model?: string;
}

export function ListingPDFView({ listing, brand, model }: ListingPDFViewProps) {
  const images = listing.car_image_urls || [];
  const displayImages = images.slice(0, 10);

  const title = brand && model
    ? `${brand} ${model}${listing.year ? ` ${listing.year}` : ''}`
    : listing.title;

  return (
    <div
      style={{
        width: '210mm',
        minHeight: '297mm',
        backgroundColor: '#ffffff',
        padding: '15mm',
        fontFamily: 'Arial, sans-serif',
        color: '#000000',
      }}
    >
      <h1 style={{
        fontSize: '28pt',
        fontWeight: 'bold',
        margin: '0 0 15mm 0',
        color: '#1a1a1a',
        textAlign: 'center'
      }}>
        {title}
      </h1>

      {displayImages.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '5mm',
          }}
        >
          {displayImages.map((url, index) => (
            <div
              key={index}
              style={{
                width: '100%',
                height: '80mm',
                overflow: 'hidden',
              }}
            >
              <img
                src={url}
                alt={`Car ${index + 1}`}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
                crossOrigin="anonymous"
              />
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: '30pt',
            textAlign: 'center',
            color: '#9ca3af',
            fontSize: '12pt',
          }}
        >
          No images available
        </div>
      )}
    </div>
  );
}
