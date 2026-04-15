const express = require('express');
const movieController = require('../controllers/movie.controller');

const router = express.Router();

router.get('/', movieController.listMovies);
router.get('/search', movieController.searchMovies);
router.get('/recommendations', movieController.getRecommendations);
router.get('/:movieId', movieController.getMovieById);

module.exports = router;
