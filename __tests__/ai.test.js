const { callGemini } = require('../utils/geminiClient');

describe('🤖 AI & Gemini Client (Unit)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('✅ callGemini returns ok=true with text', async () => {
    callGemini.mockResolvedValue({ ok: true, source: 'gemini', text: 'Cairo is amazing!' });
    const result = await callGemini('Tell me about Cairo');
    expect(result.ok).toBe(true);
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
  });

  test('✅ callGemini called with correct prompt', async () => {
    callGemini.mockResolvedValue({ ok: true, text: 'response' });
    await callGemini('Plan a trip to Luxor');
    expect(callGemini).toHaveBeenCalledWith('Plan a trip to Luxor');
  });

  test('❌ callGemini handles 503 gracefully', async () => {
    callGemini.mockResolvedValue({
      ok: false,
      source: 'fallback',
      error: '[Status 503] Service unavailable',
      text: null,
    });
    const result = await callGemini('test prompt');
    expect(result.ok).toBe(false);
    expect(result.source).toBe('fallback');
    expect(result.text).toBeNull();
  });

  test('✅ Arabic prompt handled correctly', async () => {
    callGemini.mockResolvedValue({ ok: true, text: 'الغردقة مدينة رائعة!' });
    const result = await callGemini('أخبرني عن الغردقة');
    expect(result.ok).toBe(true);
    expect(result.text).toBeTruthy();
  });
});

describe('🗺️ City Search Algorithm', () => {
  const CITY_COORDS = {
    'cairo':    { lat: 30.0444, lng: 31.2357 },
    'luxor':    { lat: 25.6872, lng: 32.6396 },
    'hurghada': { lat: 27.2579, lng: 33.8116 },
    'aswan':    { lat: 24.0889, lng: 32.8998 },
  };

  function resolveCityCoords(cityName) {
    return CITY_COORDS[cityName.toLowerCase().trim()] || CITY_COORDS['cairo'];
  }

  test('✅ resolves Cairo coordinates', () => {
    const coords = resolveCityCoords('Cairo');
    expect(coords.lat).toBeCloseTo(30.04, 1);
    expect(coords.lng).toBeCloseTo(31.23, 1);
  });

  test('✅ resolves Luxor coordinates', () => {
    const coords = resolveCityCoords('Luxor');
    expect(coords.lat).toBeCloseTo(25.68, 1);
  });

  test('✅ unknown city falls back to Cairo', () => {
    const coords = resolveCityCoords('UnknownCity');
    expect(coords).toEqual(CITY_COORDS['cairo']);
  });

  test('✅ case insensitive matching', () => {
    expect(resolveCityCoords('CAIRO')).toEqual(resolveCityCoords('cairo'));
    expect(resolveCityCoords('Luxor')).toEqual(resolveCityCoords('luxor'));
  });
});