import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { APP_VERSION } from '@truffles/shared';
import type { HealthResponse } from '@truffles/shared';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  const response: HealthResponse = {
    status: 'ok',
    service: 'truffles-sidecar',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
  };
  res.json(response);
});

app.listen(PORT, () => {
  console.log(`[truffles-sidecar] listening on port ${PORT}`);
});
