const authController = require('../controllers/authController');

jest.mock('../models/User', () => ({
  findOneAndUpdate: jest.fn(),
}));

const User = require('../models/User');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('👤 authController.updateName', () => {
  beforeEach(() => jest.clearAllMocks());

  test('✅ updates name and returns 200', async () => {
    const updated = { uid: 'user-123', name: 'Ahmed Updated' };
    User.findOneAndUpdate.mockResolvedValue(updated);

    const req = { body: { userId: 'user-123', newName: 'Ahmed Updated' } };
    const res = mockRes();

    await authController.updateName(req, res);

    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { uid: 'user-123' },
      { name: 'Ahmed Updated' },
      { new: true }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe('success');
    expect(body.data.name).toBe('Ahmed Updated');
  });

  test('✅ finds user by uid field (not _id)', async () => {
    User.findOneAndUpdate.mockResolvedValue({ uid: 'abc', name: 'Test' });

    const req = { body: { userId: 'abc', newName: 'Test' } };
    const res = mockRes();

    await authController.updateName(req, res);

    const [filter] = User.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ uid: 'abc' });
  });

  test('✅ returns updated data (new: true)', async () => {
    const updated = { uid: 'user-001', name: 'Nour' };
    User.findOneAndUpdate.mockResolvedValue(updated);

    const req = { body: { userId: 'user-001', newName: 'Nour' } };
    const res = mockRes();

    await authController.updateName(req, res);

    const [,, options] = User.findOneAndUpdate.mock.calls[0];
    expect(options.new).toBe(true);
  });

  test('✅ user not found → 200 with null data', async () => {
    User.findOneAndUpdate.mockResolvedValue(null);

    const req = { body: { userId: 'ghost', newName: 'Nobody' } };
    const res = mockRes();

    await authController.updateName(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data).toBeNull();
  });

  test('❌ DB error returns 400', async () => {
    User.findOneAndUpdate.mockRejectedValue(new Error('DB connection failed'));

    const req = { body: { userId: 'user-123', newName: 'Test' } };
    const res = mockRes();

    await authController.updateName(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].status).toBe('fail');
    expect(res.json.mock.calls[0][0].message).toBe('DB connection failed');
  });
});
