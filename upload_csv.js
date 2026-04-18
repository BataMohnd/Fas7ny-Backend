const fs = require('fs');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const Place = require('./models/Place');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("🍃 Connected to MongoDB for CSV upload...");

    const results = [];

    fs.createReadStream('places_data.csv')
      .pipe(csv())
      .on('data', (data) => {
        // تنظيف البيانات لضمان توافقها مع الموديل
        results.push({
          name: data.name || data.Name || data.title || "Unnamed Place",
          description: data.description || data.Description || "",
          price: Number(data.price) || Number(data.Price) || 0,
          neighbourhood: data.neighbourhood || data.Neighbourhood || data.location || "Unknown",
          imageUrl: data.imageUrl || data.image || data.Image || "",
          category: data.category || "General",
          rating: Number(data.rating) || 0,
          numberOfReviews: Number(data.numberOfReviews) || 0
        });
      })
      .on('end', async () => {
        try {
          console.log(`⏳ Processing ${results.length} rows...`);
          await Place.deleteMany(); 
          
          // تقسيم الداتا لمجموعات صغيرة (Chunks) عشان الملف كبير 9 ميجا
          const chunkSize = 500;
          for (let i = 0; i < results.length; i += chunkSize) {
            const chunk = results.slice(i, i + chunkSize);
            await Place.insertMany(chunk);
            console.log(`📦 Inserted ${i + chunk.length} / ${results.length}`);
          }

          console.log(`✅ Successfully uploaded everything to MongoDB!`);
          process.exit();
        } catch (err) {
          console.error("❌ Error saving to MongoDB:", err);
          process.exit(1);
        }
      });
  })
  .catch(err => console.log(err));