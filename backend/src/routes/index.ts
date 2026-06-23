import { Router } from 'express';
import destinationsRouter from './destinations';
import campusRouter from './campus';

const router = Router();

router.use('/destinations', destinationsRouter);
router.use('/route/campus', campusRouter);

export default router;
