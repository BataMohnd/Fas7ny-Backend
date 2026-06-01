/**
 * 🧭 Location Resolver
 * Provides ground-truth coordinates for primary demo cities to ensure 
 * system stability even during external geocoding failures.
 */

function getCityCoordinates(city) {
    if (!city) return null;

    const query = city.toLowerCase().trim();

    const cityMap = {
        'cairo': { lat: 30.0444, lng: 31.2357 },
        'alexandria': { lat: 31.2001, lng: 29.9187 },
        'alex': { lat: 31.2001, lng: 29.9187 },
        'dubai': { lat: 25.2048, lng: 55.2708 },
        'giza': { lat: 30.0131, lng: 31.2089 },
        'luxor': { lat: 25.6872, lng: 32.6396 },
        'aswan': { lat: 24.0889, lng: 32.8998 },
        'hurghada': { lat: 27.2579, lng: 33.8116 },
        'sharm': { lat: 27.9158, lng: 34.3299 },
        'sharm el-sheikh': { lat: 27.9158, lng: 34.3299 }
    };

    // Check direct match
    if (cityMap[query]) {
        console.log(`📍 Using demo coordinates for ${city}`);
        return cityMap[query];
    }

    // Check partial match (substring)
    for (const [name, coords] of Object.entries(cityMap)) {
        if (query.includes(name) || name.includes(query)) {
            console.log(`📍 Using partial match demo coordinates for ${city} -> ${name}`);
            return coords;
        }
    }

    return null;
}

module.exports = { getCityCoordinates };
