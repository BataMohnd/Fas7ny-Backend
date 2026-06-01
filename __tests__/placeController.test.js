const placeController = require('../controllers/placeController');

// ── Mock external dependencies ────────────────────────────────────────────────
jest.mock('../utils/photoEnricher', () => ({
  enrichPlacesWithPhotos: jest.fn().mockImplementation(async (hotels) => hotels),
}));

jest.mock('../utils/currencyConverter', () => ({
  normalizeHotelPrice: jest.fn().mockResolvedValue({ priceEGP: 1200 }),
}));

jest.mock('../services/sentimentAnalyzer', () => ({
  generateSentimentSummary: jest.fn().mockResolvedValue('تجربة سياحية رائعة.'),
}));

jest.mock('../models/HotelModel', () => ({
  find:      jest.fn(),
  findOne:   jest.fn(),
  findById:  jest.fn(),
  updateOne: jest.fn().mockResolvedValue({}),
}));

jest.mock('../models/NearbyPlaceCache', () => ({
  findOne:        jest.fn().mockResolvedValue(null),
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
}));

const axios  = require('axios');
const Hotel  = require('../models/HotelModel');

// ── Helper ────────────────────────────────────────────────────────────────────
function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('🏨 placeController.getHotels — fallback chain', () => {
  beforeEach(() => jest.clearAllMocks());

  test('✅ RapidAPI success → returns 200 with hotels array', async () => {
    axios.request = jest.fn().mockResolvedValue({
      data: {
        result: [
          {
            hotel_id: 'h-001',
            hotel_name: 'Nile Ritz-Carlton',
            address: 'El Nil St, Cairo',
            review_score: 9.2,
            review_nr: 500,
            price: 30,
            currency: 'USD',
          },
        ],
      },
    });

    const req = { query: { cityId: '-3712125' } };
    const res = mockRes();

    await placeController.getHotels(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('✅ RapidAPI fails → MongoDB fallback returns data', async () => {
    axios.request = jest.fn().mockRejectedValue(new Error('RapidAPI 429'));
    Hotel.find.mockResolvedValue([
      {
        hotelId: 'db-001',
        hotelName: 'Four Seasons Cairo',
        address: 'Nile Plaza',
        price: 3500,
        reviewCount: 200,
        mainPhotoUrl: 'https://example.com/img.jpg',
      },
    ]);

    const req = { query: { cityId: '-3712125' } };
    const res = mockRes();

    await placeController.getHotels(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.source).toBe('mongodb');
    expect(body.data.length).toBe(1);
    expect(body.data[0].hotelName).toBe('Four Seasons Cairo');
  });

  test('✅ RapidAPI + MongoDB both fail → static fallback returns 2 hotels', async () => {
    axios.request = jest.fn().mockRejectedValue(new Error('API down'));
    Hotel.find.mockResolvedValue([]);

    const req = { query: {} };
    const res = mockRes();

    await placeController.getHotels(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.source).toBe('static');
    expect(body.data.length).toBe(2);
  });

  test('✅ static fallback always has required fields', async () => {
    axios.request = jest.fn().mockRejectedValue(new Error('API down'));
    Hotel.find.mockResolvedValue([]);

    const req = { query: {} };
    const res = mockRes();

    await placeController.getHotels(req, res);

    const hotels = res.json.mock.calls[0][0].data;
    hotels.forEach(h => {
      expect(h).toHaveProperty('hotelId');
      expect(h).toHaveProperty('hotelName');
      expect(h).toHaveProperty('price');
      expect(typeof h.price).toBe('number');
      expect(h.price).toBeGreaterThan(0);
    });
  });

  test('✅ static hotel "Pyramids View Hotel" is in fallback', async () => {
    axios.request = jest.fn().mockRejectedValue(new Error('API down'));
    Hotel.find.mockResolvedValue([]);

    const req = { query: {} };
    const res = mockRes();

    await placeController.getHotels(req, res);

    const names = res.json.mock.calls[0][0].data.map(h => h.hotelName);
    expect(names).toContain('Pyramids View Hotel');
  });

  test('✅ MongoDB throws → static fallback used', async () => {
    axios.request = jest.fn().mockRejectedValue(new Error('API down'));
    Hotel.find.mockRejectedValue(new Error('DB connection lost'));

    const req = { query: {} };
    const res = mockRes();

    await placeController.getHotels(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].source).toBe('static');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🏨 placeController.getHotelDetails', () => {
  beforeEach(() => jest.clearAllMocks());

  test('✅ found by hotelId returns 200', async () => {
    Hotel.findOne.mockResolvedValue({
      hotelId: 'h-001',
      hotelName: 'Test Hotel',
      price: 2500,
    });

    const req = { params: { hotelId: 'h-001' } };
    const res = mockRes();

    await placeController.getHotelDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  test('✅ not found in DB → checks static fallback', async () => {
    Hotel.findOne.mockResolvedValue(null);
    Hotel.findById.mockResolvedValue(null);

    const req = { params: { hotelId: 'static-1' } };
    const res = mockRes();

    await placeController.getHotelDetails(req, res);

    // Should find it in static fallback data
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.hotelName).toBe('Pyramids View Hotel');
  });
});
