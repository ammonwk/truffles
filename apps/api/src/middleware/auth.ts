import type { Request, Response, NextFunction } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    res.status(500).json({ error: 'ADMIN_PASSWORD not configured' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({ error: 'Invalid authorization format. Expected: Bearer <password>' });
    return;
  }

  if (parts[1] !== adminPassword) {
    res.status(403).json({ error: 'Invalid admin password' });
    return;
  }

  next();
}
