// Place lookup for the dev-only merchant editor: Google Places and the Apple
// Maps Server API, called from the dev server so neither credential reaches
// the browser. Ported from FinancesApp's tools/m.js.
//
// Credentials come from .env.local (both optional; a missing provider is just
// skipped):
//   GOOGLE_MAPS_API_KEY           server key with the Places API enabled
//   APPLE_MAPS_CREDENTIALS_FILE   JSON with teamId, keyId (or an AuthKey_<ID>.p8
//                                 privateKeyFile name) and privateKey or
//                                 privateKeyFile, relative to the JSON's folder

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const GOOGLE_API = 'https://maps.googleapis.com/maps/api/place';
const APPLE_API = 'https://maps-api.apple.com';
// Two providers' pins for the same shop land this close together
const SAME_PLACE_METRES = 300;

// Google Places types -> MCC. Google lists a place's types most-specific
// first, so the first mapped type wins.
const GOOGLE_TYPE_TO_MCC = {
  restaurant: '5812', food: '5812', cafe: '5812', coffee_shop: '5812',
  meal_takeaway: '5814', meal_delivery: '5814', fast_food_restaurant: '5814',
  bakery: '5462', bar: '5813', night_club: '5813', pub: '5813', liquor_store: '5921',
  ice_cream_shop: '5814', dessert_shop: '5814', candy_store: '5441',
  supermarket: '5411', grocery_or_supermarket: '5411', grocery_store: '5411',
  butcher_shop: '5422', market: '5499', convenience_store: '5499',
  department_store: '5311', discount_store: '5310', shopping_mall: '5399',
  warehouse_store: '5300', wholesaler: '5300', store: '5999',
  clothing_store: '5651', shoe_store: '5661', jewelry_store: '5944',
  electronics_store: '5732', cell_phone_store: '4812', book_store: '5942',
  pharmacy: '5912', drugstore: '5912', sporting_goods_store: '5941',
  bicycle_store: '5940', pet_store: '5995', florist: '5992', gift_shop: '5947',
  toy_store: '5945', hobby_store: '5945', home_goods_store: '5719',
  home_improvement_store: '5200', hardware_store: '5251', furniture_store: '5712',
  garden_center: '5261', art_gallery: '5971', craft_store: '5970',
  cosmetics_store: '5977', beauty_supply_store: '5977', optician: '8043',
  gas_station: '5541', electric_vehicle_charging_station: '5552', parking: '7523',
  taxi_stand: '4121', transit_station: '4111', subway_station: '4111',
  train_station: '4111', light_rail_station: '4111', bus_station: '4111',
  airport: '4511', car_rental: '7512', car_repair: '7538', car_wash: '7542',
  car_dealer: '5511', auto_parts_store: '5533', truck_stop: '5541', ferry_terminal: '4111',
  toll_road: '4784', moving_company: '4214', storage: '4225', courier_service: '4215',
  atm: '6011', bank: '6012', finance: '6012', insurance_agency: '6300',
  real_estate_agency: '6513', accounting: '8931', lawyer: '8111',
  travel_agency: '4722', post_office: '9402',
  hospital: '8062', doctor: '8011', dentist: '8021', physiotherapist: '8049',
  chiropractor: '8041', veterinary_care: '0742', medical_lab: '8071', drugstore_or_pharmacy: '5912',
  hair_care: '7230', hair_salon: '7230', barber_shop: '7230', beauty_salon: '7230',
  nail_salon: '7230', spa: '7298', massage: '7297', tanning_studio: '7298',
  gym: '7997', fitness_center: '7997', yoga_studio: '7997', laundry: '7210',
  dry_cleaner: '7216', locksmith: '7699', funeral_home: '7261', tailor: '5697',
  plumber: '1711', electrician: '1731', painter: '1799', roofing_contractor: '1761',
  general_contractor: '1520',
  lodging: '7011', hotel: '7011', motel: '7011', resort_hotel: '7011',
  bed_and_breakfast: '7011', hostel: '7011', campground: '7033', rv_park: '7033',
  movie_theater: '7832', movie_rental: '7841', amusement_park: '7996',
  amusement_center: '7996', aquarium: '7998', zoo: '7998', museum: '7991',
  tourist_attraction: '7991', bowling_alley: '7933', casino: '7995',
  stadium: '7941', sports_club: '7941', golf_course: '7992', ski_resort: '7999',
  swimming_pool: '7999', performing_arts_theater: '7922', concert_hall: '7922',
  event_venue: '7922', night_market: '5499',
  school: '8211', primary_school: '8211', secondary_school: '8211',
  university: '8220', library: '8299', child_care_agency: '8351', preschool: '8351',
  courthouse: '9399', city_hall: '9399', local_government_office: '9399',
  police: '9399', fire_station: '9399', embassy: '9399', church: '8661',
  hindu_temple: '8661', mosque: '8661', synagogue: '8661',
  telecommunications_service_provider: '4814', internet_cafe: '4816',
  electrician_supply: '5065',
};

// Apple Maps POI categories -> MCC
const APPLE_POI_TO_MCC = {
  Restaurant: '5812', Cafe: '5812', Bakery: '5462', FoodMarket: '5411',
  Nightlife: '5813', Brewery: '5813', Winery: '5813', Distillery: '5813',
  Store: '5999', Pharmacy: '5912',
  GasStation: '5541', EVCharger: '5552', Parking: '7523', PublicTransport: '4111',
  Airport: '4511', AirportGate: '4511', AirportTerminal: '4511', CarRental: '7512',
  Marina: '4468', ATM: '6011', Bank: '6012', Hospital: '8062', AnimalService: '0742',
  Beauty: '7230', Spa: '7298', FitnessCenter: '7997', Laundry: '7210',
  AutomotiveRepair: '7538', MailDropoff: '9402', PostOffice: '9402',
  Police: '9399', FireStation: '9399',
  MovieTheater: '7832', Theater: '7922', MusicVenue: '7922', AmusementPark: '7996',
  Aquarium: '7998', Zoo: '7998', Museum: '7991', Planetarium: '7991',
  Fairground: '7996', Bowling: '7933', MiniGolf: '7999', GoKart: '7999', Casino: '7995',
  Golf: '7992', Tennis: '7999', Swimming: '7999', Skiing: '7999', Skating: '7999',
  RockClimbing: '7999', Soccer: '7999', Baseball: '7999', Basketball: '7999',
  Volleyball: '7999', Kayaking: '7999', Surfing: '7999', Fishing: '7999',
  Stadium: '7941', ConventionCenter: '7999', Landmark: '7991', NationalMonument: '7991',
  Castle: '7991', Fortress: '7991',
  Hotel: '7011', Campground: '7033', RVPark: '7033',
  School: '8211', University: '8220', Library: '8299',
};

const GENERIC_TYPES = new Set(['point_of_interest', 'establishment']);

function deriveMcc(googleTypes, applePoi) {
  const candidates = [];
  const add = (mcc, source) => {
    if (mcc && !candidates.some((c) => c.mcc === mcc)) candidates.push({ mcc, source });
  };
  for (const t of googleTypes || []) add(GOOGLE_TYPE_TO_MCC[t], `Google type “${t}”`);
  if (applePoi) add(APPLE_POI_TO_MCC[applePoi], `Apple category “${applePoi}”`);
  return candidates;
}

function distanceMetres(a, b) {
  if (a?.latitude == null || b?.latitude == null) return Infinity;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// "Café Sacher" and "CAFE SACHER WIEN" are the same name here
const nameKey = (name) =>
  (name || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

function similarName(a, b) {
  const [x, y] = [nameKey(a), nameKey(b)];
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
}

// The same place from the other provider: within SAME_PLACE_METRES, and a
// similar name wins over a nearer neighbour (shops sit next to each other)
function samePlace(candidates, target) {
  const near = candidates
    .map((c) => ({ c, d: distanceMetres(target, c) }))
    .filter(({ d }) => d < SAME_PLACE_METRES)
    .sort((a, b) => a.d - b.d);
  return (near.find(({ c }) => similarName(c.name, target.name)) || near[0])?.c ?? null;
}

// Google hands back store-locator URLs with tracking parameters attached
function cleanWebsite(website) {
  if (!website) return '';
  try {
    const u = new URL(website);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|gclid|fbclid|y_source|mc_)/i.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\?$/, '').replace(/\/+$/, '');
  } catch {
    return website.replace(/\/+$/, '');
  }
}

function loadAppleCredentials(file) {
  if (!file || !fs.existsSync(file)) return null;
  const creds = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (creds.privateKeyFile && !creds.privateKey) {
    const keyPath = path.isAbsolute(creds.privateKeyFile) ? creds.privateKeyFile : path.join(path.dirname(file), creds.privateKeyFile);
    creds.privateKey = fs.readFileSync(keyPath, 'utf8');
    if (!creds.keyId) creds.keyId = path.basename(creds.privateKeyFile).match(/^AuthKey_([A-Z0-9]+)\.p8$/i)?.[1];
  }
  return creds.teamId && creds.keyId && creds.privateKey ? creds : null;
}

const b64u = (input) => Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function signAppleJwt(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'ES256', kid: creds.keyId, typ: 'JWT' }));
  const claims = b64u(JSON.stringify({ iss: creds.teamId, iat: now, exp: now + 1800 }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: creds.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${b64u(signature)}`;
}

// PNG width from the IHDR chunk, so the form can flag a tiny favicon
function pngWidth(buffer) {
  return buffer.length > 24 && buffer.toString('ascii', 1, 4) === 'PNG' ? buffer.readUInt32BE(16) : null;
}

export function createPlaces({ googleKey, appleCredentialsFile }) {
  let apple = null;
  let appleError = null;
  try {
    apple = loadAppleCredentials(appleCredentialsFile);
  } catch (err) {
    appleError = err.message;
  }
  let appleToken = null;

  async function googleGet(route, params) {
    const url = `${GOOGLE_API}/${route}/json?${new URLSearchParams({ ...params, key: googleKey })}`;
    const data = await (await fetch(url)).json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(`Google ${data.status}${data.error_message ? `: ${data.error_message}` : ''}`);
    }
    return data;
  }

  async function appleGet(route, params) {
    if (!appleToken || Date.now() > appleToken.expiresAt) {
      const res = await fetch(`${APPLE_API}/v1/token`, { headers: { Authorization: `Bearer ${signAppleJwt(apple)}` } });
      if (!res.ok) throw new Error(`Apple token exchange failed: HTTP ${res.status}`);
      const { accessToken, expiresInSeconds } = await res.json();
      appleToken = { token: accessToken, expiresAt: Date.now() + (expiresInSeconds - 60) * 1000 };
    }
    const res = await fetch(`${APPLE_API}${route}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${appleToken.token}` },
    });
    if (!res.ok) throw new Error(`Apple HTTP ${res.status}`);
    return res.json();
  }

  async function appleSearch(q, near) {
    const params = { q, lang: 'en-AU', resultTypeFilter: 'Poi' };
    if (near?.latitude != null) params.searchLocation = `${near.latitude},${near.longitude}`;
    const data = await appleGet('/v1/search', params);
    return (data.results || []).map((r) => ({
      provider: 'apple',
      place_id: r.id || '',
      name: r.name,
      address: (r.formattedAddressLines || []).join(', '),
      latitude: r.coordinate?.latitude ?? null,
      longitude: r.coordinate?.longitude ?? null,
      poi_category: r.poiCategory || '',
      country: r.countryCode || '',
      locality: r.structuredAddress?.locality || '',
    }));
  }

  async function googleDetails(placeId, sessionToken) {
    const data = await googleGet('details', {
      place_id: placeId,
      fields: 'name,formatted_address,website,geometry,types,address_component',
      ...(sessionToken ? { sessiontoken: sessionToken } : {}),
    });
    const r = data.result || {};
    const component = (type) => r.address_components?.find((c) => c.types.includes(type));
    return {
      provider: 'google',
      place_id: placeId,
      name: r.name,
      address: r.formatted_address || '',
      website: cleanWebsite(r.website),
      latitude: r.geometry?.location?.lat ?? null,
      longitude: r.geometry?.location?.lng ?? null,
      types: (r.types || []).filter((t) => !GENERIC_TYPES.has(t)),
      country: component('country')?.short_name || '',
      // UK addresses carry the town as postal_town, not locality
      locality: (component('locality') || component('postal_town') || component('sublocality'))?.long_name || '',
    };
  }

  return {
    status() {
      return {
        google: Boolean(googleKey),
        apple: Boolean(apple),
        ...(appleError ? { appleError } : {}),
      };
    },

    // Suggestions from both providers, side by side. One provider failing
    // still returns the other's results.
    async search(q, { sessionToken } = {}) {
      const [google, appleResults] = await Promise.allSettled([
        googleKey
          ? googleGet('autocomplete', { input: q, types: 'establishment', ...(sessionToken ? { sessiontoken: sessionToken } : {}) }).then((d) =>
              (d.predictions || []).map((p) => ({
                provider: 'google',
                place_id: p.place_id,
                name: p.structured_formatting?.main_text || p.description,
                address: p.structured_formatting?.secondary_text || '',
              }))
            )
          : Promise.resolve([]),
        apple ? appleSearch(q).then((r) => r.slice(0, 5)) : Promise.resolve([]),
      ]);
      const errors = [google, appleResults].filter((r) => r.status === 'rejected').map((r) => r.reason.message);
      return {
        results: [...(google.value || []), ...(appleResults.value || [])],
        errors,
      };
    },

    // Full details for one picked suggestion, plus the same place from the
    // other provider when one sits within SAME_PLACE_METRES of it.
    async details(pick, { sessionToken } = {}) {
      let google = null;
      let applePlace = null;
      const notes = [];

      if (pick.provider === 'google') {
        google = await googleDetails(pick.place_id, sessionToken);
        if (apple) {
          try {
            applePlace = samePlace(await appleSearch(google.name, google), google);
            if (applePlace && !similarName(applePlace.name, google.name)) {
              notes.push(`Apple Maps match “${applePlace.name}” has a different name. Check it.`);
            }
            if (!applePlace) notes.push('No Apple Maps place found at the same spot.');
          } catch (err) {
            notes.push(err.message);
          }
        }
      } else {
        applePlace = pick;
        if (googleKey) {
          try {
            const found = await googleGet('textsearch', {
              query: pick.name,
              location: `${pick.latitude},${pick.longitude}`,
              radius: String(SAME_PLACE_METRES),
            });
            const near = samePlace(
              (found.results || []).map((r) => ({
                place_id: r.place_id,
                name: r.name,
                latitude: r.geometry?.location?.lat,
                longitude: r.geometry?.location?.lng,
              })),
              pick
            );
            if (near) {
              google = await googleDetails(near.place_id);
              if (!similarName(google.name, pick.name)) notes.push(`Google Maps match “${google.name}” has a different name. Check it.`);
            } else {
              notes.push('No Google Maps place found at the same spot.');
            }
          } catch (err) {
            notes.push(err.message);
          }
        }
      }

      return {
        name: google?.name || applePlace?.name || '',
        address: google?.address || applePlace?.address || '',
        latitude: google?.latitude ?? applePlace?.latitude ?? null,
        longitude: google?.longitude ?? applePlace?.longitude ?? null,
        website: google?.website || '',
        google_place_id: google?.place_id || '',
        apple_place_id: applePlace?.place_id || '',
        country: google?.country || applePlace?.country || '',
        locality: google?.locality || applePlace?.locality || '',
        mccCandidates: deriveMcc(google?.types, applePlace?.poi_category),
        notes,
      };
    },

    // An icon for a website domain: Google's favicon service, then the
    // site's own apple-touch-icon
    async icon(domain) {
      const sources = [
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`,
        `https://${domain}/apple-touch-icon.png`,
      ];
      for (const url of sources) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          const type = res.headers.get('content-type') || '';
          if (!res.ok || !type.startsWith('image/')) continue;
          const buffer = Buffer.from(await res.arrayBuffer());
          return { data: buffer.toString('base64'), type, width: pngWidth(buffer), source: new URL(url).hostname };
        } catch {
          // try the next source
        }
      }
      return null;
    },
  };
}
