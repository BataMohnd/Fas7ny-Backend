const mongoose = require('mongoose');
const Place = require('./models/Place'); // اتأكد إن المسار ده صح
require('dotenv').config();

const dummyPlaces = [
  {
    name: "Blue Lagoon - Dahab",
    description: "A paradise for divers and nature lovers.",
    price: 120,
    neighbourhood: "South Sinai",
    imageUrl: "https://images.unsplash.com/photo-1506744038136-46273834b3fb",
    category: "Beaches",
    rating: 4.9,
    numberOfReviews: 85
  },
  {
    name: "Mount Catherine",
    description: "The highest peak in Egypt.",
    price: 80,
    neighbourhood: "Saint Catherine",
    imageUrl: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b",
    category: "Mountains",
    rating: 4.7,
    numberOfReviews: 45
  }
];

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("Seed: Connected to MongoDB...");
    await Place.deleteMany(); 
    await Place.insertMany(dummyPlaces);
    console.log("✅ Data Seeded Successfully!");
    process.exit();
  })
  .catch(err => {
    console.error("❌ Seed Error:", err);
    process.exit(1);
  });