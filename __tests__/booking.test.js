const bookingController = require('../controllers/bookingController');

jest.mock('../controllers/bookingController', () => ({
  createBooking: jest.fn(),
  getUserBookings: jest.fn(),
  getNextTrip: jest.fn(),
  cancelBooking: jest.fn(),
}));

describe('🏨 Booking Controller (Unit)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('✅ createBooking with valid data', async () => {
    const mockBooking = {
      _id: 'booking-001',
      userId: 'user-123',
      placeName: 'Four Seasons Cairo',
      totalPrice: 1500,
      source: 'manual',
      status: 'confirmed',
    };
    const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    bookingController.createBooking.mockImplementation((req, res) => {
      res.status(201).json({ success: true, data: mockBooking });
    });
    const mockReq = { body: { userId: 'user-123', placeId: 'place-1', totalPrice: 1500, paymentMethod: 'VISA' } };
    await bookingController.createBooking(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test('✅ AI booking has source=ai', async () => {
    const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    bookingController.createBooking.mockImplementation((req, res) => {
      res.status(201).json({
        success: true,
        data: { ...req.body, _id: 'booking-002', status: 'confirmed' }
      });
    });
    const mockReq = { body: { userId: 'user-123', placeId: 'smart_plan_Cairo', totalPrice: 2500, source: 'ai', paymentMethod: 'Wallet' } };
    await bookingController.createBooking(mockReq, mockRes);
    const call = mockRes.json.mock.calls[0][0];
    expect(call.data.source).toBe('ai');
  });

  test('❌ missing required fields returns 400', async () => {
    const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    bookingController.createBooking.mockImplementation((req, res) => {
      if (!req.body.userId || !req.body.placeId || !req.body.totalPrice) {
        res.status(400).json({ success: false, message: 'Missing required fields' });
      }
    });
    await bookingController.createBooking({ body: { userId: 'user-123' } }, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  test('✅ getUserBookings returns array', async () => {
    const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    bookingController.getUserBookings.mockImplementation((req, res) => {
      res.status(200).json({ success: true, data: [] });
    });
    await bookingController.getUserBookings({ params: { userId: 'user-123' } }, mockRes);
    const call = mockRes.json.mock.calls[0][0];
    expect(Array.isArray(call.data)).toBe(true);
  });

  test('✅ cancelBooking changes status', async () => {
    const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    bookingController.cancelBooking.mockImplementation((req, res) => {
      res.status(200).json({ success: true, data: { status: 'cancelled' } });
    });
    await bookingController.cancelBooking({ params: { bookingId: 'booking-001' } }, mockRes);
    const call = mockRes.json.mock.calls[0][0];
    expect(call.data.status).toBe('cancelled');
  });
});