const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

try {
    if (fs.existsSync(serviceAccountPath)) {
        // ✅ Real mode: use the service account file
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: serviceAccount.project_id,
            });
        }
        // ── Startup Diagnostics ───────────────────────────────────────────
        console.log(`🔥 Firebase Admin initialized`);
        console.log(`   ├─ Credential source : serviceAccountKey.json`);
        console.log(`   ├─ Project ID        : ${admin.app().options.projectId}`);
        console.log(`   └─ Service account   : ${serviceAccount.client_email}`);
        console.log(`   ⚠️  Flutter app must use this SAME project: ${admin.app().options.projectId}`);
    } else {
        // ⚠️ Demo mode: stub out messaging so no crash occurs
        console.warn("⚠️ serviceAccountKey.json not found — Firebase running in STUB mode (FCM disabled)");
        if (!admin.apps.length) {
            // Initialize with a dummy app so admin.messaging() doesn't hard-crash
            admin.initializeApp({ projectId: 'fas7ny-demo' });
        }
    }
} catch (error) {
    console.warn("⚠️ Firebase Admin init warning:", error.message);
}

module.exports = admin;
