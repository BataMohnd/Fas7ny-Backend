// ── Mock mongoose completely ──────────────────────────────────────────────
jest.mock('mongoose', () => {
  const mockSchema = {
    index: jest.fn().mockReturnThis(),
    pre: jest.fn().mockReturnThis(),
    methods: {},
    statics: {},
  };

  const mockModel = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ _id: 'mock-id-123' }),
    save: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue([]),
    lean: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
  };

  function MockSchema(definition, options) {
    return mockSchema;
  }
  const MockObjectId = function() {};
  MockObjectId.isValid = jest.fn().mockReturnValue(false);

  MockSchema.Types = {
    ObjectId: MockObjectId,
    Mixed: Object,
  };

  return {
    connect: jest.fn().mockResolvedValue({ connection: { host: 'mock' } }),
    disconnect: jest.fn().mockResolvedValue({}),
    connection: { readyState: 1, host: 'mock' },
    Schema: MockSchema,
    model: jest.fn().mockReturnValue(mockModel),
    startSession: jest.fn().mockResolvedValue({
      withTransaction: jest.fn(),
      endSession: jest.fn(),
    }),
    Types: { ObjectId: MockObjectId },
  };
});

// ── Mock Firebase Admin ───────────────────────────────────────────────────
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn().mockReturnValue({}),
  },
  auth: () => ({
    verifyIdToken: jest.fn().mockResolvedValue({
      uid: 'test-user-123',
      email: 'test@test.com',
    }),
    getUser: jest.fn().mockResolvedValue({
      uid: 'test-user-123',
      email: 'test@test.com',
      displayName: 'Test User',
    }),
    createUser: jest.fn().mockResolvedValue({ uid: 'new-user-123' }),
  }),
  firestore: () => ({
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
    set: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  }),
  messaging: () => ({
    send: jest.fn().mockResolvedValue('mock-message-id'),
    sendMulticast: jest.fn().mockResolvedValue({ successCount: 1 }),
  }),
  apps: [true],
}));

// ── Mock Cron Service ─────────────────────────────────────────────────────
jest.mock('../services/cronService', () => jest.fn());

// ── Mock Gemini Client ────────────────────────────────────────────────────
jest.mock('../utils/geminiClient', () => ({
  callGemini: jest.fn().mockResolvedValue({
    ok: true,
    source: 'mock',
    text: 'Mock AI response for testing purposes.',
  }),
}));

// ── Mock Nodemailer ───────────────────────────────────────────────────────
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-email-id' }),
  }),
}));

// ── Mock Axios ────────────────────────────────────────────────────────────
jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({ data: { results: [], places: [] } }),
  post: jest.fn().mockResolvedValue({
    data: {
      candidates: [{
        content: { parts: [{ text: 'Mock Gemini response' }] }
      }]
    }
  }),
  create: jest.fn().mockReturnThis(),
}));

// ── Mock node-cache ───────────────────────────────────────────────────────
jest.mock('node-cache', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn().mockReturnValue(null),
    set: jest.fn().mockReturnValue(true),
    del: jest.fn().mockReturnValue(1),
    has: jest.fn().mockReturnValue(false),
  }));
});

// ── Suppress console logs during tests ───────────────────────────────────
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// ── Global test helpers ───────────────────────────────────────────────────
global.testUserId = 'test-user-123';
global.testPlaceId = 'test-place-001';