/**
 * transportData.js
 * Static database of Egyptian transport options:
 * - ENR Trains (Egyptian National Railways)
 * - GoBus / Superjet / Upper Egypt Bus Co. intercity buses
 * - Microbus shared routes
 * - Car rental estimates
 *
 * Prices in EGP, one-way, per adult (2025 rates).
 */

// ── Train Routes (ENR) ────────────────────────────────────────────────────────

const TRAIN_ROUTES = [
  // Cairo ↔ Alexandria
  { from: 'cairo',     to: 'alexandria', durationMin: 135, classes: {
    firstAC: 120, secondAC: 80, third: 40
  }, trainTypes: ['Spanish Express', 'Turbini'], operator: 'ENR' },

  // Cairo ↔ Luxor
  { from: 'cairo',    to: 'luxor',   durationMin: 600, classes: {
    firstAC: 220, secondAC: 145, sleeperDeluxe: 750, sleeperStandard: 490
  }, trainTypes: ['1st class AC', 'Sleeper'], operator: 'ENR' },

  // Cairo ↔ Aswan
  { from: 'cairo',    to: 'aswan',   durationMin: 720, classes: {
    firstAC: 270, secondAC: 175, sleeperDeluxe: 900, sleeperStandard: 590
  }, trainTypes: ['1st class AC', 'Sleeper'], operator: 'ENR' },

  // Alexandria ↔ Luxor (via Cairo)
  { from: 'alexandria', to: 'luxor', durationMin: 780, classes: {
    firstAC: 290, secondAC: 195
  }, trainTypes: ['1st class AC'], operator: 'ENR' },

  // Cairo ↔ Port Said
  { from: 'cairo',    to: 'port said', durationMin: 180, classes: {
    firstAC: 55, secondAC: 35, third: 20
  }, trainTypes: ['Express'], operator: 'ENR' },

  // Cairo ↔ Ismailia
  { from: 'cairo',    to: 'ismailia', durationMin: 120, classes: {
    firstAC: 45, secondAC: 28, third: 16
  }, trainTypes: ['Express'], operator: 'ENR' },

  // Cairo ↔ Suez
  { from: 'cairo',    to: 'suez',    durationMin: 150, classes: {
    firstAC: 50, secondAC: 32, third: 18
  }, trainTypes: ['Express'], operator: 'ENR' },

  // Luxor ↔ Aswan
  { from: 'luxor',    to: 'aswan',   durationMin: 180, classes: {
    firstAC: 75, secondAC: 50, sleeperDeluxe: 350
  }, trainTypes: ['1st class AC', 'Sleeper'], operator: 'ENR' },

  // Cairo ↔ Mansoura
  { from: 'cairo',    to: 'mansoura', durationMin: 150, classes: {
    firstAC: 55, secondAC: 35, third: 18
  }, trainTypes: ['Express'], operator: 'ENR' },

  // Cairo ↔ Tanta
  { from: 'cairo',    to: 'tanta',   durationMin: 90, classes: {
    firstAC: 40, secondAC: 25, third: 12
  }, trainTypes: ['Express'], operator: 'ENR' },
];

// ── Bus Routes ────────────────────────────────────────────────────────────────

const BUS_ROUTES = [
  // Cairo ↔ Alexandria
  { from: 'cairo',       to: 'alexandria', durationMin: 150, operators: [
    { name: 'GoBus',    price: 100, class: 'VIP' },
    { name: 'Superjet', price: 85,  class: 'AC'  },
    { name: 'West Delta', price: 65, class: 'AC' },
  ]},

  // Cairo ↔ Hurghada
  { from: 'cairo',       to: 'hurghada', durationMin: 360, operators: [
    { name: 'GoBus',    price: 220, class: 'VIP' },
    { name: 'Superjet', price: 180, class: 'AC'  },
    { name: 'Upper Egypt', price: 150, class: 'AC' },
  ]},

  // Cairo ↔ Sharm el Sheikh
  { from: 'cairo',       to: 'sharm el sheikh', durationMin: 420, operators: [
    { name: 'GoBus',    price: 280, class: 'VIP' },
    { name: 'Superjet', price: 230, class: 'AC'  },
    { name: 'East Delta', price: 195, class: 'AC' },
  ]},

  // Cairo ↔ Luxor
  { from: 'cairo',       to: 'luxor',     durationMin: 600, operators: [
    { name: 'GoBus',      price: 280, class: 'VIP' },
    { name: 'Upper Egypt', price: 180, class: 'AC' },
  ]},

  // Cairo ↔ Aswan
  { from: 'cairo',       to: 'aswan',     durationMin: 720, operators: [
    { name: 'GoBus',      price: 340, class: 'VIP' },
    { name: 'Upper Egypt', price: 210, class: 'AC' },
  ]},

  // Cairo ↔ Dahab
  { from: 'cairo',       to: 'dahab',     durationMin: 480, operators: [
    { name: 'GoBus',    price: 310, class: 'VIP' },
    { name: 'Superjet', price: 250, class: 'AC'  },
  ]},

  // Cairo ↔ Marsa Alam
  { from: 'cairo',       to: 'marsa alam', durationMin: 540, operators: [
    { name: 'GoBus',      price: 300, class: 'VIP' },
    { name: 'Upper Egypt', price: 230, class: 'AC' },
  ]},

  // Cairo ↔ Siwa Oasis
  { from: 'cairo',       to: 'siwa',       durationMin: 600, operators: [
    { name: 'West Delta', price: 190, class: 'AC' },
    { name: 'Microbus',   price: 120, class: 'Standard' },
  ]},

  // Alexandria ↔ Hurghada
  { from: 'alexandria',  to: 'hurghada',   durationMin: 480, operators: [
    { name: 'GoBus',    price: 250, class: 'VIP' },
    { name: 'Superjet', price: 195, class: 'AC'  },
  ]},

  // Cairo ↔ El Gouna
  { from: 'cairo',       to: 'el gouna',   durationMin: 370, operators: [
    { name: 'GoBus',    price: 230, class: 'VIP' },
  ]},

  // Cairo ↔ Ain Sokhna
  { from: 'cairo',       to: 'ain sokhna', durationMin: 90, operators: [
    { name: 'East Delta', price: 45, class: 'AC' },
    { name: 'Microbus',   price: 25, class: 'Standard' },
  ]},

  // Luxor ↔ Aswan
  { from: 'luxor',       to: 'aswan',      durationMin: 210, operators: [
    { name: 'Upper Egypt', price: 75, class: 'AC' },
    { name: 'Microbus',    price: 40, class: 'Standard' },
  ]},

  // Hurghada ↔ Sharm el Sheikh
  { from: 'hurghada',    to: 'sharm el sheikh', durationMin: 300, operators: [
    { name: 'GoBus',    price: 185, class: 'VIP' },
    { name: 'Superjet', price: 150, class: 'AC'  },
  ]},
];

// ── Car Rental Estimates ──────────────────────────────────────────────────────

const CAR_RENTAL_RATES = {
  // per KM rates + base day rate
  economy:  { perDay: 450,  perKm: 1.8,  model: 'Kia Cerato / Hyundai Elantra' },
  standard: { perDay: 650,  perKm: 2.2,  model: 'Toyota Corolla / Kia Sportage' },
  suv:      { perDay: 950,  perKm: 3.0,  model: 'Hyundai Tucson / Toyota RAV4' },
  luxury:   { perDay: 1800, perKm: 5.0,  model: 'BMW 5 / Mercedes E-Class' },
  minivan:  { perDay: 750,  perKm: 2.5,  model: 'Hyundai H1 / Toyota HiAce' },
};

// ── Approximate Distances (km) ────────────────────────────────────────────────

const CITY_DISTANCES = {
  'cairo-alexandria':       220,
  'cairo-hurghada':         490,
  'cairo-sharm el sheikh':  490,
  'cairo-luxor':            680,
  'cairo-aswan':            880,
  'cairo-dahab':            570,
  'cairo-marsa alam':       750,
  'cairo-siwa':             720,
  'cairo-ain sokhna':       130,
  'cairo-el gouna':         500,
  'cairo-ismailia':         135,
  'cairo-port said':        220,
  'cairo-suez':             135,
  'cairo-tanta':            90,
  'cairo-mansoura':         125,
  'alexandria-hurghada':    620,
  'luxor-aswan':            215,
  'hurghada-sharm el sheikh': 330,
};

function getDistance(from, to) {
  const key1 = `${from.toLowerCase()}-${to.toLowerCase()}`;
  const key2 = `${to.toLowerCase()}-${from.toLowerCase()}`;
  return CITY_DISTANCES[key1] || CITY_DISTANCES[key2] || null;
}

// ── Route Lookup ──────────────────────────────────────────────────────────────

function findTrainRoute(from, to) {
  const f = from.toLowerCase().trim();
  const t = to.toLowerCase().trim();
  return TRAIN_ROUTES.find(r =>
    (r.from === f && r.to === t) || (r.from === t && r.to === f)
  ) || null;
}

function findBusRoutes(from, to) {
  const f = from.toLowerCase().trim();
  const t = to.toLowerCase().trim();
  const route = BUS_ROUTES.find(r =>
    (r.from === f && r.to === t) || (r.from === t && r.to === f)
  );
  return route ? route.operators.map(op => ({ ...op, durationMin: route.durationMin })) : [];
}

function estimateCarCost(from, to, type = 'standard') {
  const dist = getDistance(from, to);
  if (!dist) return null;
  const rate = CAR_RENTAL_RATES[type] || CAR_RENTAL_RATES.standard;
  const totalCost = rate.perDay + (dist * rate.perKm);
  return {
    type,
    model: rate.model,
    distanceKm: dist,
    estimatedCostEGP: Math.round(totalCost),
    breakdown: { dayRate: rate.perDay, kmRate: rate.perKm, distance: dist }
  };
}

module.exports = {
  TRAIN_ROUTES,
  BUS_ROUTES,
  CAR_RENTAL_RATES,
  CITY_DISTANCES,
  findTrainRoute,
  findBusRoutes,
  estimateCarCost,
  getDistance,
};
