import { Router } from 'express';
import { chat } from '../controllers/ai.controller';
import { adminChat } from '../controllers/admin-ai.controller';
import { agentChat } from '../controllers/agent.controller';

const router = Router();
router.post('/chat', chat);
router.post('/admin-chat', adminChat);
router.post('/agent', agentChat);
export default router;
