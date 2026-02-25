import { Router, Request, Response } from 'express';
import { destinationList } from '../data/destinations';

const router = Router();

// GET /api/destinations
router.get('/', (_req: Request, res: Response) => {
  res.json(destinationList);
});

// GET /api/destinations/:id
router.get('/:id', (req: Request, res: Response) => {
  const dest = destinationList.find((d) => d.id === req.params['id']);
  if (!dest) {
    res.status(404).json({ error: 'Destination not found' });
    return;
  }
  res.json(dest);
});

export default router;
