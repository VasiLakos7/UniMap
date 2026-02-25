import { Router } from 'express';
import destinationsRouter from './destinations';
import campusRouter from './campus';
import outdoorRouter from './outdoor';

const router = Router();

router.use('/destinations', destinationsRouter);
router.use('/route/campus', campusRouter);
router.use('/route/outdoor', outdoorRouter);

export default router;
