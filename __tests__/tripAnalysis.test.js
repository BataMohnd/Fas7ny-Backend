describe('📊 Trip Analysis Logic (Unit)', () => {
  function analyzeTripData(bookings) {
    const aiBookings = bookings.filter(b => b.source === 'ai');
    const manualBookings = bookings.filter(b => b.source !== 'ai');

    const realisticManual = manualBookings.filter(b => b.totalPrice > 0 && b.totalPrice < 50000);
    const realisticAI = aiBookings.filter(b => b.totalPrice > 0 && b.totalPrice < 50000);

    const manualAvgCost = realisticManual.length > 0
      ? realisticManual.reduce((s, b) => s + b.totalPrice, 0) / realisticManual.length
      : 0;

    const aiAvgCost = realisticAI.length > 0
      ? realisticAI.reduce((s, b) => s + b.totalPrice, 0) / realisticAI.length
      : 0;

    const placeTypes = [...new Set(bookings.map(b => b.placeType).filter(Boolean))];
    const interestCoverage = Math.min(100, Math.round((placeTypes.length / 4) * 100));

    const avgRating = bookings.length > 0
      ? bookings.reduce((s, b) => s + (b.rating || 4.0), 0) / bookings.length
      : 0;

    return {
      totalTrips: bookings.length,
      manualCount: manualBookings.length,
      aiCount: aiBookings.length,
      manualAvgCost: Math.round(manualAvgCost),
      aiAvgCost: Math.round(aiAvgCost),
      interestCoverage,
      avgRating: parseFloat(avgRating.toFixed(1)),
    };
  }

  const sampleBookings = [
    { source: 'manual', totalPrice: 1200, placeType: 'hotel',      rating: 4.5 },
    { source: 'manual', totalPrice: 800,  placeType: 'restaurant', rating: 4.0 },
    { source: 'manual', totalPrice: 300,  placeType: 'cafe',       rating: 4.2 },
    { source: 'ai',     totalPrice: 2500, placeType: 'activity',   rating: 4.8 },
  ];

  test('✅ correctly counts manual vs AI trips', () => {
    const result = analyzeTripData(sampleBookings);
    expect(result.manualCount).toBe(3);
    expect(result.aiCount).toBe(1);
    expect(result.totalTrips).toBe(4);
  });

  test('✅ manualCount + aiCount = totalTrips', () => {
    const result = analyzeTripData(sampleBookings);
    expect(result.manualCount + result.aiCount).toBe(result.totalTrips);
  });

  test('✅ manualAvgCost calculated correctly', () => {
    const result = analyzeTripData(sampleBookings);
    expect(result.manualAvgCost).toBe(767); // (1200+800+300)/3 = 766.7 → rounds to 767
  });

  test('✅ interestCoverage max 100%', () => {
    const result = analyzeTripData(sampleBookings);
    expect(result.interestCoverage).toBeLessThanOrEqual(100);
    expect(result.interestCoverage).toBeGreaterThanOrEqual(0);
  });

  test('✅ 4 place types = 100% coverage', () => {
    const result = analyzeTripData(sampleBookings); // hotel, restaurant, cafe, activity
    expect(result.interestCoverage).toBe(100);
  });

  test('✅ unrealistic prices filtered out', () => {
    const withBadData = [
      ...sampleBookings,
      { source: 'manual', totalPrice: 999999, placeType: 'hotel', rating: 4.0 },
    ];
    const result = analyzeTripData(withBadData);
    expect(result.manualAvgCost).toBeLessThan(10000);
  });

  test('✅ empty bookings returns zeros', () => {
    const result = analyzeTripData([]);
    expect(result.totalTrips).toBe(0);
    expect(result.manualAvgCost).toBe(0);
    expect(result.aiCount).toBe(0);
  });

  test('✅ avgRating between 0 and 5', () => {
    const result = analyzeTripData(sampleBookings);
    expect(result.avgRating).toBeGreaterThanOrEqual(0);
    expect(result.avgRating).toBeLessThanOrEqual(5);
  });
});