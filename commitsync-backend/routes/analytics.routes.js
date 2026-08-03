/**
 * Analytics Routes
 */
const express = require('express');
const analyticsController = require('../controllers/analyticsController');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Routes
router.get('/overview', analyticsController.getOverview);
router.get('/risk-overview', analyticsController.getRiskOverview);
router.get('/behavioral-profile', analyticsController.getBehavioralProfile);
router.post('/update-behavioral-profile', analyticsController.updateBehavioralProfile);
router.get('/risk-trends/:commitmentId', analyticsController.getRiskTrends);
router.get('/category-performance', analyticsController.getCategoryPerformance);
router.post('/recalculate-all-risks', analyticsController.recalculateAllRisks);
router.get('/ai-insights', analyticsController.getAiInsights);

module.exports = router;