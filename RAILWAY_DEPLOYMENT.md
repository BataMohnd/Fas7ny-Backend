# Railway Deployment

## Deploy

1. Push this repository to GitHub.
2. In Railway, create a project and choose **Deploy from GitHub repo**.
3. Add the variables from `.env.example` in the service **Variables** tab.
4. Set `MONGO_URI` to a hosted MongoDB connection string, such as MongoDB Atlas.
5. Generate a public Railway domain for the service.

Railway reads `railway.json`, runs `npm start`, and verifies `GET /health`
before activating a deployment. Railway injects `PORT`; leave `PORT` unset in
the dashboard unless a custom port is intentionally required.

## Firebase

`serviceAccountKey.json` is intentionally ignored by Git. For push
notifications in Railway, set `FIREBASE_SERVICE_ACCOUNT_JSON` to the complete
Firebase service-account JSON object. If this variable is omitted, the app
starts with Firebase messaging disabled.

## Secrets

Treat every API key as a Railway variable. Do not commit `.env` or
`serviceAccountKey.json`.
