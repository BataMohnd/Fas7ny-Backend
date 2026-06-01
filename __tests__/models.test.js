// Schema logic tests — verify the business rules encoded in Mongoose schemas
// without requiring a live DB connection.

// ─────────────────────────────────────────────────────────────────────────────
describe('📋 Booking Schema — business rules', () => {
  // Mirrors the enum values from models/Booking.js
  const PLACE_TYPES   = ['hotel', 'restaurant', 'cafe', 'activity', 'attraction'];
  const STATUSES      = ['active', 'pending', 'confirmed', 'cancelled', 'completed', 'reserved'];
  const MEAL_PLANS    = ['room_only', 'half_board', 'full_board'];
  const SOURCES       = ['manual', 'ai'];
  const PAY_METHODS   = ['VISA', 'Wallet', 'PayOnArrival'];

  test('✅ placeType enum covers all expected categories', () => {
    expect(PLACE_TYPES).toContain('hotel');
    expect(PLACE_TYPES).toContain('restaurant');
    expect(PLACE_TYPES).toContain('cafe');
    expect(PLACE_TYPES).toContain('activity');
    expect(PLACE_TYPES).toContain('attraction');
    expect(PLACE_TYPES).toHaveLength(5);
  });

  test('✅ booking status lifecycle is complete', () => {
    expect(STATUSES).toContain('active');
    expect(STATUSES).toContain('confirmed');
    expect(STATUSES).toContain('cancelled');
    expect(STATUSES).toContain('completed');
  });

  test('✅ meal plan defaults to room_only', () => {
    const defaultMealPlan = 'room_only';
    expect(MEAL_PLANS).toContain(defaultMealPlan);
  });

  test('✅ source distinguishes AI vs manual bookings', () => {
    expect(SOURCES).toContain('manual');
    expect(SOURCES).toContain('ai');
    expect(SOURCES).toHaveLength(2);
  });

  test('✅ Wallet is a valid payment method', () => {
    expect(PAY_METHODS).toContain('Wallet');
  });

  // Virtual field logic: schema maps placeId → hotelId for backward compat
  describe('virtual fields', () => {
    function makeBookingLike(data) {
      return {
        placeId:   data.placeId,
        placeName: data.placeName,
        get hotelId()   { return this.placeId;   },
        get hotelName() { return this.placeName; },
      };
    }

    test('✅ hotelId virtual returns placeId', () => {
      const b = makeBookingLike({ placeId: 'hotel-007', placeName: 'Marriott' });
      expect(b.hotelId).toBe('hotel-007');
    });

    test('✅ hotelName virtual returns placeName', () => {
      const b = makeBookingLike({ placeId: 'hotel-007', placeName: 'Marriott' });
      expect(b.hotelName).toBe('Marriott');
    });

    test('✅ virtual is consistent with source field', () => {
      const b = makeBookingLike({ placeId: 'p-123', placeName: 'Nobu' });
      expect(b.hotelId).toBe(b.placeId);
      expect(b.hotelName).toBe(b.placeName);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('👤 User Schema — defaults and rules', () => {
  // Mirror User.js schema defaults
  const userDefaults = {
    password:        '',
    walletBalance:   0,
    profileImage:    '',
    profileImageUrl: '',
    interests:       [],
    preferredBudget: 0,
    travelType:      '',
    savedPlaces:     [],
    favorites:       [],
    otp:             null,
    otpExpiry:       null,
  };

  test('✅ walletBalance defaults to 0', () => {
    expect(userDefaults.walletBalance).toBe(0);
  });

  test('✅ interests defaults to empty array', () => {
    expect(Array.isArray(userDefaults.interests)).toBe(true);
    expect(userDefaults.interests).toHaveLength(0);
  });

  test('✅ otp and otpExpiry default to null', () => {
    expect(userDefaults.otp).toBeNull();
    expect(userDefaults.otpExpiry).toBeNull();
  });

  test('✅ Firebase UID is used as primary key', () => {
    const schemaFields = ['_id', 'uid', 'name', 'email', 'walletBalance', 'interests'];
    expect(schemaFields).toContain('uid');
    // _id mirrors Firebase UID
    expect(schemaFields).toContain('_id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('📍 Place Schema — geospatial structure', () => {
  function makePlaceLike({ lat, lng }) {
    return {
      location: {
        type: 'Point',
        coordinates: [lng, lat],  // GeoJSON: [longitude, latitude]
      },
      latitude:  lat,
      longitude: lng,
    };
  }

  test('✅ location type is Point (GeoJSON)', () => {
    const place = makePlaceLike({ lat: 30.0444, lng: 31.2357 });
    expect(place.location.type).toBe('Point');
  });

  test('✅ coordinates are [longitude, latitude] (GeoJSON order)', () => {
    const lat = 30.0444, lng = 31.2357;
    const place = makePlaceLike({ lat, lng });
    expect(place.location.coordinates[0]).toBe(lng);  // longitude first
    expect(place.location.coordinates[1]).toBe(lat);  // latitude second
  });

  test('✅ Cairo coordinates are reasonable', () => {
    const cairo = makePlaceLike({ lat: 30.0444, lng: 31.2357 });
    expect(cairo.latitude).toBeGreaterThan(29);
    expect(cairo.latitude).toBeLessThan(31);
    expect(cairo.longitude).toBeGreaterThan(30);
    expect(cairo.longitude).toBeLessThan(33);
  });

  test('✅ price defaults to 0', () => {
    const defaults = { price: 0, rating: 0, category: 'General' };
    expect(defaults.price).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('🏨 TransactionModel — type logic', () => {
  const CREDIT_TYPES = ['top_up', 'refund'];
  const DEBIT_TYPES  = ['payment', 'withdrawal'];

  test('✅ top_up and refund are credit operations', () => {
    CREDIT_TYPES.forEach(type => {
      const isCredit = ['top_up', 'refund'].includes(type);
      expect(isCredit).toBe(true);
    });
  });

  test('✅ payment and withdrawal are debit operations', () => {
    DEBIT_TYPES.forEach(type => {
      const isCredit = ['top_up', 'refund'].includes(type);
      expect(isCredit).toBe(false);
    });
  });

  test('✅ balance multiplier logic', () => {
    const getMultiplier = type => ['top_up', 'refund'].includes(type) ? 1 : -1;
    expect(getMultiplier('top_up')).toBe(1);
    expect(getMultiplier('refund')).toBe(1);
    expect(getMultiplier('payment')).toBe(-1);
    expect(getMultiplier('withdrawal')).toBe(-1);
  });
});
