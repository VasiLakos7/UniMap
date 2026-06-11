import { Router, Request, Response } from 'express';
import {
  getNodeIdForName,
  getAccessibleAlt,
  findNearestNodeId,
  calculateRouteFromPosition,
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

  // 2. Για wheelchair: αντικατέστησε με accessible είσοδο αν υπάρχει
  //    Για non-wheelchair: δοκίμασε και τις δύο εισόδους, επέστρεψε την κοντύτερη
  const accAlt = getAccessibleAlt(endNodeId);
  if (wheelchair && accAlt) {
    endNodeId = accAlt;
  }

  // 3. Υπολόγισε διαδρομή με virtual start node στη θέση του χρήστη
  const result = calculateRouteFromPosition(fromLat, fromLng, endNodeId, opts);

  let finalResult = result;
  if (!wheelchair && accAlt) {
    const altResult = calculateRouteFromPosition(fromLat, fromLng, accAlt, opts);
    if (altResult && (!finalResult || altResult.lengthM < finalResult.lengthM)) {
      finalResult = altResult;
    }
  }

  if (!finalResult) {
    res.status(422).json({ error: 'Δεν βρέθηκε διαδρομή. Βρίσκεσαι εντός campus;' });
    return;
  }

  res.json(finalResult);
});

export default router;
