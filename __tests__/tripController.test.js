const tripController = require('../controllers/tripController');
const axios = require('axios');
const { callGemini } = require('../utils/geminiClient');

// ── Helpers ───────────────────────────────────────────────────────────────────
function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

const fakeHotels = [
  {
    _id: 'h-001',
    name: 'Sofitel Luxor',
    price: 600,
    city: 'Luxor',
    category: 'hotel',
    rating: 4.8,
  },
];

const fakeActivities = [
  { _id: 'a-001', name: 'Karnak Temple Tour', price: 150, city: 'Luxor', category: 'activity' },
  { _id: 'a-002', name: 'Valley of Kings', price: 200, city: 'Luxor', category: 'activity' },
  { _id: 'a-003', name: 'Luxor Museum', price: 100, city: 'Luxor', category: 'museum' },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('🗺️ tripController.searchTrips', () => {
  beforeEach(() => jest.clearAllMocks());

  test('✅ returns 200 with hotels, attractions, restaurants, flights, aiItinerary', async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: {
        data: {
          data: [
            { name: 'Test Hotel', rating: 4.5, description: 'Nice place', thumbnail: 'https://img.jpg' },
          ],
        },
      },
    });
    callGemini.mockResolvedValue({ ok: true, text: 'Day 1: Visit Karnak Temple...' });

    const req = { query: { query: 'Luxor', origin: 'Cairo', destination: 'Luxor', date: '2026-08-01' } };
    const res = mockRes();

    await tripController.searchTrips(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('hotels');
    expect(body.data).toHaveProperty('attractions');
    expect(body.data).toHaveProperty('restaurants');
    expect(body.data).toHaveProperty('flights');
    expect(body.data).toHaveProperty('aiItinerary');
    expect(body.data.location).toBe('Luxor');
  });

  test('✅ 3 mock flights always returned', async () => {
    axios.get = jest.fn().mockResolvedValue({ data: {} });
    callGemini.mockResolvedValue({ ok: false, error: 'overloaded' });

    const req = { query: { query: 'Cairo', origin: 'Alexandria', destination: 'Cairo' } };
    const res = mockRes();

    await tripController.searchTrips(req, res);

    const { flights } = res.json.mock.calls[0][0].data;
    expect(flights).toHaveLength(3);
    expect(flights.map(f => f.name)).toEqual([
      'EgyptAir to Cairo',
      'Nile Air to Cairo',
      'Air Cairo to Cairo',
    ]);
  });

  test('✅ Gemini fallback text used when AI call fails', async () => {
    axios.get = jest.fn().mockResolvedValue({ data: {} });
    callGemini.mockResolvedValue({ ok: false, error: 'quota exceeded' });

    const req = { query: { query: 'Aswan' } };
    const res = mockRes();

    await tripController.searchTrips(req, res);

    const { aiItinerary } = res.json.mock.calls[0][0].data;
    expect(typeof aiItinerary).toBe('string');
    expect(aiItinerary.length).toBeGreaterThan(10);
  });

  test('✅ uses default city Cairo when no query given', async () => {
    axios.get = jest.fn().mockResolvedValue({ data: {} });
    callGemini.mockResolvedValue({ ok: true, text: 'Cairo plan' });

    const req = { query: {} };
    const res = mockRes();

    await tripController.searchTrips(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.location).toBe('Cairo');
  });

  test('✅ Gemini AI text is used in aiItinerary when ok=true', async () => {
    axios.get = jest.fn().mockResolvedValue({ data: {} });
    callGemini.mockResolvedValue({ ok: true, text: 'Custom Gemini plan for Luxor!' });

    const req = { query: { query: 'Luxor' } };
    const res = mockRes();

    await tripController.searchTrips(req, res);

    expect(res.json.mock.calls[0][0].data.aiItinerary).toBe('Custom Gemini plan for Luxor!');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('📅 tripController.generateTripPlan — Greedy Algorithm', () => {
  let Place;

  beforeAll(() => {
    Place = require('../models/Place');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset Place.find to return empty by default
    Place.find = jest.fn();
    Place.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });
  });

  test('❌ missing destination returns 400', async () => {
    const req = { body: { days: 3, totalBudget: 5000 } };
    const res = mockRes();

    await tripController.generateTripPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  test('❌ missing days returns 400', async () => {
    const req = { body: { destination: 'Luxor', totalBudget: 5000 } };
    const res = mockRes();

    await tripController.generateTripPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ missing totalBudget returns 400', async () => {
    const req = { body: { destination: 'Luxor', days: 3 } };
    const res = mockRes();

    await tripController.generateTripPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('❌ no places found → 404', async () => {
    // Both find calls return empty (default mock)
    const req = { body: { destination: 'Luxor', days: 2, totalBudget: 5000 } };
    const res = mockRes();

    await tripController.generateTripPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toMatch(/Not enough places/);
  });

  test('✅ with places → returns itinerary with correct number of days', async () => {
    Place.find
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(fakeHotels) }),
      })
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(fakeActivities) }),
      });

    const req = { body: { destination: 'Luxor', days: 2, totalBudget: 5000 } };
    const res = mockRes();

    await tripController.generateTripPlan(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.itinerary).toHaveLength(2);
    expect(body.data.destination).toBe('Luxor');
  });

  test('✅ each itinerary day has hotel + activities + dailyCost', async () => {
    Place.find
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(fakeHotels) }),
      })
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(fakeActivities) }),
      });

    const req = { body: { destination: 'Luxor', days: 1, totalBudget: 3000 } };
    const res = mockRes();

    await tripController.generateTripPlan(req, res);

    const day = res.json.mock.calls[0][0].data.itinerary[0];
    expect(day).toHaveProperty('day', 1);
    expect(day).toHaveProperty('hotel');
    expect(day).toHaveProperty('activities');
    expect(day).toHaveProperty('dailyCost');
    expect(typeof day.dailyCost).toBe('number');
    expect(day.dailyCost).toBeGreaterThan(0);
  });

  test('✅ greedy: hotel costs ≤ 50% of daily budget when affordable', async () => {
    const budget = 3000;
    const days = 1;
    const dailyBudget = budget / days; // 3000

    Place.find
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(fakeHotels) }), // hotel price 600 ≤ 1500
      })
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(fakeActivities) }),
      });

    const req = { body: { destination: 'Luxor', days, totalBudget: budget } };
    const res = mockRes();

    await tripController.generateTripPlan(req, res);

    const day = res.json.mock.calls[0][0].data.itinerary[0];
    expect(day.hotel.price).toBeLessThanOrEqual(dailyBudget * 0.5);
  });

  test('✅ totalCost = sum of all daily costs', async () => {
    Place.find
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(fakeHotels) }),
      })
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(fakeActivities) }),
      });

    const req = { body: { destination: 'Luxor', days: 2, totalBudget: 5000 } };
    const res = mockRes();

    await tripController.generateTripPlan(req, res);

    const { data } = res.json.mock.calls[0][0];
    const sumOfDays = data.itinerary.reduce((sum, d) => sum + d.dailyCost, 0);
    expect(data.totalCost).toBeCloseTo(sumOfDays, 0);
  });
});
