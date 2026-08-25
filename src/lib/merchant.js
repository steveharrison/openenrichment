// Display helpers for merchant records.

const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#6366f1'];

export function avatarColor(merchant) {
  const custom = (merchant.colour || merchant.color || '').trim();
  // Only use the merchant's own color when white text stays readable on it
  if (/^#[0-9a-f]{6}$/i.test(custom)) {
    const r = parseInt(custom.slice(1, 3), 16);
    const g = parseInt(custom.slice(3, 5), 16);
    const b = parseInt(custom.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (luminance < 0.7) return custom;
  }
  let hash = 0;
  for (const ch of merchant.name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function merchantLocation(merchant) {
  const lat = Number.parseFloat(merchant.latitude);
  const lng = Number.parseFloat(merchant.longitude);
  return {
    address: (merchant.address || '').trim(),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

// Best link each provider can offer: place-id deep link to the actual
// business listing, then a coordinate pin, then an address search. Either
// link can be missing; returns null when both are.
export function mapLinks(merchant, location) {
  const { address, lat, lng } = location;
  const hasCoords = lat != null && lng != null;
  const applePlaceId = (merchant.apple_place_id || '').trim();
  const googlePlaceId = (merchant.google_place_id || '').trim();

  let apple = null;
  if (applePlaceId) {
    apple = new URL('https://maps.apple.com/place');
    apple.searchParams.set('place-id', applePlaceId);
  } else if (hasCoords || address) {
    apple = new URL('https://maps.apple.com/');
    if (hasCoords) {
      apple.searchParams.set('q', merchant.name || 'Merchant');
      apple.searchParams.set('ll', `${lat},${lng}`);
    } else {
      apple.searchParams.set('q', address);
    }
  }

  let google = null;
  if (googlePlaceId || hasCoords || address) {
    google = new URL('https://www.google.com/maps/search/');
    google.searchParams.set('api', '1');
    // `query` is mandatory even with a place id; the id wins when both are set
    google.searchParams.set('query', hasCoords ? `${lat},${lng}` : address || merchant.name || 'Merchant');
    if (googlePlaceId) google.searchParams.set('query_place_id', googlePlaceId);
  }

  if (!apple && !google) return null;
  return { apple: apple?.href ?? null, google: google?.href ?? null };
}
