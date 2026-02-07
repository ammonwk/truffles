import express from 'express';
import cors from 'cors';
import { devices } from './devices.js';

const app = express();
const PORT = process.env.BEACON_PORT || 6001;

app.use(cors());
app.set('trust proxy', false);

app.get('/identify', (req, res) => {
  // Express may prefix IPv4 addresses with ::ffff: when listening on IPv6
  const raw = req.ip ?? req.socket.remoteAddress ?? '';
  const ip = raw.replace(/^::ffff:/, '');

  const device = devices[ip];
  if (device) {
    res.json({ ip, name: device.name, role: device.role });
  } else {
    res.json({ ip, name: null, role: null });
  }
});

app.get('/devices', (_req, res) => {
  res.json(devices);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  const count = Object.keys(devices).length;
  console.log(`Beacon listening on 0.0.0.0:${PORT} — ${count} devices mapped`);
});
