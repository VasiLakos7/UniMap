import { Router, Request, Response } from 'express';
import {
  getNodeIdForName,
  findNearestNodeId,
  findBestStartNode,
  calculatePathWithLength,
} from '../services/campus-graph';
import { CampusRouteRequest } from '../types';

const router = Router();

/**
 * POST /api/route/campus
 * Body: { fromLat, fromLng, destinationName?, destLat?, destLng?, wheelchair? }
 *
 * Η app στέλνει το όνομα τμήματος (π.χ. "Τμήμα Μαιευτικής").
 * Αν δεν βρεθεί με όνομα, χρησιμοποιεί τις συντεταγμένες destLat/destLng.
 */
router.post('/', (req: Request, res: Response) => {
  const { fromLat, fromLng, destinationName, destLat, destLng, wheelchair } =
    req.body as CampusRouteRequest;

  if (fromLat == null || fromLng == null) {
    res.status(400).json({ error: 'Απαιτούνται: fromLat, fromLng' });
    return;
  }

  const opts = { wheelchair: !!wheelchair };

  // 1. Βρες το end node: πρώτα με όνομα, μετά με συντεταγμένες
  let endNodeId: string | null = null;

  if (destinationName) {
    endNodeId = getNodeIdForName(destinationName);
  }

  if (!endNodeId && destLat != null && destLng != null) {
    endNodeId = findNearestNodeId(destLat, destLng, opts);
  }

  if (!endNodeId) {
    res.status(404).json({ error: 'Δεν βρέθηκε node για τον προορισμό.' });
    return;
  }

  // 2. Βρες το καλύτερο σημείο εκκίνησης
  const startNodeId = findBestStartNode(fromLat, fromLng, endNodeId, opts);
  if (!startNodeId) {
    res.status(422).json({ error: 'Δεν βρέθηκε κοντινό node στη θέση σου. Βρίσκεσαι εντός campus;' });
    return;
  }

  // 3. Υπολόγισε διαδρομή
  const result = calculatePathWithLength(startNodeId, endNodeId, opts);
  if (!result) {
    res.status(422).json({ error: 'Δεν βρέθηκε διαδρομή προς τον προορισμό.' });
    return;
  }

  res.json(result);
});

export default router;
