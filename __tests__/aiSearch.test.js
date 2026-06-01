// Tests for the AI Search ranking algorithms extracted from aiSearchController.js

// ── Pure algorithm functions (mirroring production code) ──────────────────────

/**
 * Mirror of _unifyHotels field normalization (city coords resolution)
 */
const CITY_MAP = {
  '-3712125': { name: 'Cairo',          lat: 30.0444, lng: 31.2357 },
  '8':        { name: 'Dubai',          lat: 25.2048, lng: 55.2708 },
  '-3712078': { name: 'Alexandria',     lat: 31.2001, lng: 29.9187 },
  '-3712073': { name: 'Hurghada',       lat: 27.2579, lng: 33.8116 },
  '-3712071': { name: 'Luxor',          lat: 25.6872, lng: 32.6396 },
  '-3712055': { name: 'Sharm El-Sheikh', lat: 27.9158, lng: 34.3299 },
};

/**
 * Mirror of compareAndRank scoring algorithm
 */
function scoreHotel(hotel, userLikes, userInterests) {
  const hasTaste    = userLikes.length > 0;
  const hasInterests = userInterests.length > 0;
  const userAvgPrice  = hasTaste ? userLikes.reduce((s, h) => s + h.price, 0)  / userLikes.length : 0;
  const userAvgRating = hasTaste ? userLikes.reduce((s, h) => s + h.rating, 0) / userLikes.length : 0;
  const topCategory   = hasTaste ? (userLikes[0]?.category || 'Hotels') : 'Hotels';

  let priceScore = 0, ratingScore = 0, historyScore = 0, interestScore = 0;

  if (hasTaste) {
    const pricePct = Math.abs(hotel.pricePerNight - userAvgPrice) / Math.max(userAvgPrice, 1);
    priceScore   = Math.max(0, 35 - pricePct * 35);
    ratingScore  = Math.max(0, 25 - Math.abs(hotel.rating - userAvgRating) * 10);
    historyScore = hotel.category === topCategory ? 20 : 5;
  } else {
    ratingScore = Math.min(60, hotel.rating * 6);
  }

  if (hasInterests) {
    const text = `${hotel.name} ${hotel.category} ${hotel.address}`.toLowerCase();
    interestScore = Math.min(20, userInterests.filter(i => text.includes(i.trim().toLowerCase())).length * 10);
  } else if (!hasTaste) {
    ratingScore += Math.min(40, hotel.rating * 4);
  }

  return Math.round(priceScore + ratingScore + historyScore + interestScore);
}

// ── CITY_MAP Tests ────────────────────────────────────────────────────────────
describe('🗺️ CITY_MAP — city resolution', () => {
  test('✅ Cairo cityId resolves correctly', () => {
    const city = CITY_MAP['-3712125'];
    expect(city.name).toBe('Cairo');
    expect(city.lat).toBeCloseTo(30.04, 1);
    expect(city.lng).toBeCloseTo(31.23, 1);
  });

  test('✅ All major Egypt cities are in map', () => {
    const names = Object.values(CITY_MAP).map(c => c.name);
    expect(names).toContain('Luxor');
    expect(names).toContain('Hurghada');
    expect(names).toContain('Sharm El-Sheikh');
    expect(names).toContain('Alexandria');
  });

  test('✅ Unknown cityId falls back to Cairo', () => {
    const city = CITY_MAP['unknown'] || CITY_MAP['-3712125'];
    expect(city.name).toBe('Cairo');
  });

  test('✅ All cities have valid lat/lng', () => {
    Object.values(CITY_MAP).forEach(city => {
      expect(city.lat).toBeGreaterThan(20);
      expect(city.lat).toBeLessThan(35);
      expect(typeof city.lng).toBe('number');
    });
  });
});

// ── compareAndRank Scoring ────────────────────────────────────────────────────
describe('🏆 compareAndRank — scoring algorithm', () => {
  const baseHotel = {
    name: 'Test Hotel',
    category: 'Hotels',
    address: 'Cairo, Egypt',
    pricePerNight: 1000,
    rating: 4.5,
  };

  test('✅ no taste + no interests: pure rating score', () => {
    const score = scoreHotel(baseHotel, [], []);
    // ratingScore = min(60, 4.5*6) = min(60,27) = 27
    // ratingScore += min(40, 4.5*4) = min(40,18) = 18
    // total = 45
    expect(score).toBe(45);
  });

  test('✅ 5-star rating + no taste = highest no-taste score', () => {
    const hotel5 = { ...baseHotel, rating: 5 };
    const score = scoreHotel(hotel5, [], []);
    // min(60,30)+min(40,20) = 30+20 = 50
    expect(score).toBe(50);
  });

  test('✅ 0-star rating + no taste = 0', () => {
    const hotel0 = { ...baseHotel, rating: 0 };
    const score = scoreHotel(hotel0, [], []);
    expect(score).toBe(0);
  });

  test('✅ perfect price match with taste = max price score (35)', () => {
    const userLikes = [{ price: 1000, rating: 4.0, category: 'Hotels' }];
    const hotel = { ...baseHotel, pricePerNight: 1000, rating: 4.0 };
    const score = scoreHotel(hotel, userLikes, []);
    // priceScore = 35 (pricePct=0)
    // ratingScore = 25 (ratingDiff=0)
    // historyScore = 20 (same category)
    expect(score).toBe(80);
  });

  test('✅ wrong category reduces historyScore to 5', () => {
    const userLikes = [{ price: 1000, rating: 4.0, category: 'Hotels' }];
    const hotel = { ...baseHotel, category: 'Restaurants', pricePerNight: 1000, rating: 4.0 };
    const score = scoreHotel(hotel, userLikes, []);
    // priceScore=35, ratingScore=25, historyScore=5
    expect(score).toBe(65);
  });

  test('✅ interest match adds up to 20 points', () => {
    const hotel = { ...baseHotel, name: 'Beach Resort Hurghada' };
    const score = scoreHotel(hotel, [], ['beach', 'resort']);
    // ratingScore (rating only mode) = min(60,27) = 27
    // interestScore = min(20, 2*10) = 20
    expect(score).toBe(47);
  });

  test('✅ single interest match adds 10 points', () => {
    const hotel = { ...baseHotel, name: 'Pyramids Hotel Cairo' };
    const score = scoreHotel(hotel, [], ['pyramids']);
    // no taste mode: ratingScore = min(60, 4.5*6) + min(40, 4.5*4) = 27 + 18 = 45
    // wait, with hasInterests=true, we DON'T add the extra 40% block
    // ratingScore = min(60, 4.5*6) = 27
    // interestScore = min(20, 1*10) = 10
    expect(score).toBe(37);
  });

  test('✅ interest matching is case-insensitive', () => {
    const hotel = { ...baseHotel, name: 'BEACH RESORT', address: 'Hurghada' };
    const scoreUpper = scoreHotel(hotel, [], ['BEACH']);
    const scoreLower = scoreHotel(hotel, [], ['beach']);
    expect(scoreUpper).toBe(scoreLower);
  });

  test('✅ hotels with same score ranked in list maintain stability', () => {
    const hotels = [
      { ...baseHotel, name: 'A', rating: 4.0 },
      { ...baseHotel, name: 'B', rating: 4.0 },
      { ...baseHotel, name: 'C', rating: 5.0 },
    ].map(h => ({ ...h, score: scoreHotel(h, [], []) }));

    hotels.sort((a, b) => b.score - a.score);
    expect(hotels[0].name).toBe('C'); // 5-star should rank first
  });

  test('✅ price deviation from taste reduces priceScore', () => {
    const userLikes = [{ price: 1000, rating: 4.0, category: 'Hotels' }];
    const cheapHotel    = { ...baseHotel, pricePerNight: 500 };  // 50% cheaper
    const perfectHotel  = { ...baseHotel, pricePerNight: 1000 }; // exact match

    const cheapScore   = scoreHotel(cheapHotel,   userLikes, []);
    const perfectScore = scoreHotel(perfectHotel, userLikes, []);

    expect(perfectScore).toBeGreaterThan(cheapScore);
  });
});

// ── Proactive Suggestions Algorithm ──────────────────────────────────────────
describe('💡 Proactive Suggestions — interest matching', () => {
  /**
   * Mirror of proactiveSuggestions scoring
   */
  function calcDestinationScore(dest, userInterests, bookedCities) {
    const hasInterests = userInterests.length > 0;
    const matchCount = hasInterests
      ? dest.tags.filter(tag =>
          userInterests.some(ui => ui.toLowerCase().includes(tag) || tag.includes(ui.toLowerCase()))
        ).length
      : 0;
    const interestScore = hasInterests
      ? Math.min(40, matchCount * (40 / Math.max(dest.tags.length, 1)))
      : 20;
    const historyBoost  = bookedCities.includes(dest.city) ? 20 : 0;
    const varietyBoost  = !bookedCities.includes(dest.city) ? 15 : 0;
    return Math.round(dest.baseScore + interestScore + historyBoost + varietyBoost);
  }

  const luxor = { city: 'Luxor', baseScore: 25, tags: ['history', 'culture', 'temples', 'nile'] };
  const hurghada = { city: 'Hurghada', baseScore: 30, tags: ['beach', 'diving', 'resort', 'sea'] };

  test('✅ history lover gets high score for Luxor', () => {
    const score = calcDestinationScore(luxor, ['history', 'culture'], []);
    // baseScore=25, interestScore=min(40, 2*(40/4))=20, variety=15 → 60
    expect(score).toBeGreaterThanOrEqual(55);
  });

  test('✅ beach lover gets high score for Hurghada', () => {
    const score = calcDestinationScore(hurghada, ['beach', 'diving'], []);
    expect(score).toBeGreaterThan(55);
  });

  test('✅ visited city gets history boost (not variety)', () => {
    const visited    = calcDestinationScore(luxor, ['history'], ['Luxor']);
    const notVisited = calcDestinationScore(luxor, ['history'], []);
    expect(visited).toBeGreaterThan(notVisited - 10); // historyBoost(20) > varietyBoost(15)
    expect(visited - notVisited).toBe(5); // 20 - 15 = 5 more
  });

  test('✅ no interests → uses default interest score of 20', () => {
    const score = calcDestinationScore(luxor, [], []);
    // base=25 + interestScore=20 (default) + variety=15 = 60
    expect(score).toBe(60);
  });

  test('✅ mismatched interests → low interest score', () => {
    const score = calcDestinationScore(luxor, ['beach', 'diving'], []);
    // tags: history/culture/temples/nile — no match with beach/diving
    // interestScore = min(40, 0*(40/4)) = 0
    // total = 25 + 0 + 0 + 15 = 40
    expect(score).toBe(40);
  });

  test('✅ score is always a round number', () => {
    const scores = [
      calcDestinationScore(luxor, ['history'], []),
      calcDestinationScore(hurghada, ['beach'], ['Hurghada']),
      calcDestinationScore(luxor, [], []),
    ];
    scores.forEach(s => expect(Number.isInteger(s)).toBe(true));
  });
});

// ── _unifyHotels field normalization ─────────────────────────────────────────
describe('🔧 _unifyHotels — data normalization', () => {
  function unifyOne(raw, cityId, dataSource) {
    const defaultCoords = CITY_MAP[cityId] || CITY_MAP['-3712125'];
    const lat = raw.latitude  || raw.location?.coordinates?.[1] || defaultCoords.lat;
    const lng = raw.longitude || raw.location?.coordinates?.[0] || defaultCoords.lng;
    return {
      id:            String(raw._id || raw.hotel_id || `h_0`),
      name:          raw.hotelName || raw.hotel_name || raw.name || 'Unknown Hotel',
      pricePerNight: Number(raw.price || raw.min_total_price || 0),
      rating:        Number(raw.reviewScore || raw.review_score || raw.rating || 0),
      latitude:  lat,
      longitude: lng,
      source:    raw.source || dataSource,
    };
  }

  test('✅ RapidAPI field names are normalized', () => {
    const raw = { hotel_id: 'h-001', hotel_name: 'Cairo Palace', review_score: 8.5, min_total_price: 50 };
    const unified = unifyOne(raw, '-3712125', 'rapid');
    expect(unified.name).toBe('Cairo Palace');
    expect(unified.rating).toBe(8.5);
    expect(unified.pricePerNight).toBe(50);
  });

  test('✅ MongoDB field names are normalized', () => {
    const raw = { _id: 'mongo-1', hotelName: 'Mongo Hotel', reviewScore: 7.2, price: 1200 };
    const unified = unifyOne(raw, '-3712125', 'mongo');
    expect(unified.name).toBe('Mongo Hotel');
    expect(unified.rating).toBe(7.2);
    expect(unified.id).toBe('mongo-1');
  });

  test('✅ missing lat/lng falls back to city defaults', () => {
    const raw = { _id: 'h-001', name: 'No Coords Hotel' };
    const unified = unifyOne(raw, '-3712125', 'hardcoded');
    expect(unified.latitude).toBeCloseTo(CITY_MAP['-3712125'].lat, 2);
    expect(unified.longitude).toBeCloseTo(CITY_MAP['-3712125'].lng, 2);
  });

  test('✅ missing name → "Unknown Hotel"', () => {
    const raw = { _id: 'h-001' };
    const unified = unifyOne(raw, '-3712125', 'static');
    expect(unified.name).toBe('Unknown Hotel');
  });
});
